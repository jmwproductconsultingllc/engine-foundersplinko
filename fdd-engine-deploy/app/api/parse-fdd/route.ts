/**
 * app/api/parse-fdd/route.ts
 * Receive a Vercel Blob URL for the FDD + buyer context → fetch the PDF from
 * Blob → runDiligence() → PERSIST the report → stream the payload back.
 *
 * The pipeline steps live in lib/pipeline.ts (so the eval harness runs the same
 * code path). This route owns transport: Blob fetch, buyer parsing, persistence,
 * the heartbeat stream, and cleanup.
 *
 * Persistence (part 1 of the report-delivery work): after analysis we save the
 * result to Blob under a random reportId and include that id in the streamed
 * JSON. The response still carries the full result too, so the in-session
 * render is unchanged — the redirect to /report/[reportId] is a later step.
 *
 * Why this STREAMS the response:
 * - The server has up to 300s (Vercel Pro), but browsers don't. Safari in
 *   particular drops a request that sits silent ~60s, and a rich FDD (which
 *   triggers the minimal-mode extraction retry) can run ~90s+. So we emit a
 *   whitespace heartbeat every few seconds to keep the socket warm, then send
 *   one final JSON line: the result (+ reportId), or an { error } payload.
 *
 * Runtime notes:
 * - Must run on the Node.js runtime (Files API + Blob), not Edge.
 * - maxDuration is 800s (Pro/Enterprise GA ceiling; default is 300s). The
 *   richest FDDs trigger the full+minimal extraction double-pass and run several
 *   minutes, so do NOT drop this — a lower ceiling silently breaks the big docs.
 * - The FDD no longer rides in the request body (no ~4.5MB serverless body
 *   limit); the browser uploads straight to Blob and we fetch it here.
 */

import { NextRequest, NextResponse } from "next/server";
import { del, put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { runDiligence } from "@/lib/pipeline";
import { saveReport } from "@/lib/reports";
import { sendFailureAlert } from "@/lib/email";
import { BuyerContext } from "@/lib/underwriting";
import type { DiligenceResult } from "@/lib/types";

export const runtime = "nodejs";
// 800s is the Pro/Enterprise GA ceiling (the platform DEFAULT is 300s — which is
// what the rich-doc double-pass was timing out against). The full+minimal
// extraction on the densest FDDs runs ~5-6 min, so we lift the ceiling to let it
// finish at full numerical fidelity. Under Fluid compute, time spent waiting on
// the Gemini call is billed as idle I/O, not CPU, so this is cheap. The
// heartbeat stream below keeps the client socket warm across the long wait.
export const maxDuration = 800;
export const dynamic = "force-dynamic";

async function delSafe(url: string | null) {
  if (!url) return;
  try {
    await del(url);
  } catch {
    /* ignore cleanup errors */
  }
}

export async function POST(req: NextRequest) {
  let blobUrl: string | null = null;
  try {
    const body = await req.json();
    blobUrl = typeof body?.blobUrl === "string" ? body.blobUrl : null;
    if (!blobUrl) {
      return NextResponse.json({ error: "No FDD was uploaded." }, { status: 400 });
    }

    const buyer: BuyerContext = {
      liquidCapital: Number(body?.liquidAssets ?? 0) || 0,
      netWorth: Number(body?.netWorth ?? 0) || 0,
    };

    // Pull the PDF back from Blob — a server-side fetch, no request-body limit.
    const fileRes = await fetch(blobUrl);
    if (!fileRes.ok) {
      await delSafe(blobUrl);
      return NextResponse.json(
        { error: "Could not retrieve the uploaded file. Please try again." },
        { status: 400 },
      );
    }
    const bytes = await fileRes.arrayBuffer();
    if (bytes.byteLength < 20_000) {
      await delSafe(blobUrl);
      return NextResponse.json(
        { error: "That file looks too small to be a full FDD — it may have been truncated." },
        { status: 400 },
      );
    }

    // Bytes are in memory now; the transient blob is no longer needed — drop it
    // immediately (and so the heartbeat path below doesn't have to clean up).
    await delSafe(blobUrl);
    blobUrl = null;

    // Stream the heavy work behind a heartbeat (see header comment).
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const beat = setInterval(() => {
          try {
            controller.enqueue(enc.encode(" "));
          } catch {
            /* stream already closing */
          }
        }, 5000);
        try {
          // One call — the exact same pipeline the eval harness runs.
          const result = await runDiligence({
            bytes,
            mimeType: "application/pdf",
            buyer,
          });

          // Persist so the report has a permanent URL (and a paid flag for #6).
          // Cast: runDiligence's inferred return matches DiligenceResult
          // structurally; the cast just sidesteps optional-vs-null nitpicks.
          const fileHash = createHash("sha256")
            .update(Buffer.from(bytes))
            .digest("hex")
            .slice(0, 16);
          const reportId = await saveReport(result as DiligenceResult, fileHash);
          console.log("[parse-fdd] report saved:", reportId);

          // Stream the full result (so the in-session render is unchanged) plus
          // the reportId (used by the redirect in part 2).
          controller.enqueue(enc.encode("\n" + JSON.stringify({ ...result, reportId })));
        } catch (err) {
          console.error("[parse-fdd] pipeline error:", err);
          const message = err instanceof Error ? err.message : "Unknown error.";

          // --- Failure capture -------------------------------------------------
          // Retain the failed doc for replay + alert the operator. Both steps are
          // wrapped so a capture failure can NEVER block the user's response.
          let failedDocUrl: string | null = null;
          try {
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            const hash = createHash("sha256")
              .update(Buffer.from(bytes))
              .digest("hex")
              .slice(0, 12);
            const saved = await put(`failures/${stamp}-${hash}.pdf`, Buffer.from(bytes), {
              access: "public",
              contentType: "application/pdf",
            });
            failedDocUrl = saved.url;
            console.log("[parse-fdd] retained failed doc:", failedDocUrl);
          } catch (capErr) {
            console.error("[parse-fdd] could not retain failed doc:", capErr);
          }
          try {
            await sendFailureAlert({
              error: message,
              failedDocUrl,
              fileSizeBytes: bytes.byteLength,
              buyer,
            });
          } catch (alertErr) {
            console.error("[parse-fdd] failure alert send error:", alertErr);
          }

          // Calm, branded message for the user. The raw technical detail goes to
          // the operator alert + server logs — never to the buyer's screen.
          controller.enqueue(
            enc.encode(
              "\n" +
                JSON.stringify({
                  error:
                    "This FDD didn't go through — it may be an unusual or scanned format. " +
                    "We've been automatically notified and we're looking into it. Please try again " +
                    "in a few minutes, and if it keeps happening, email jason@foundersplinko.com.",
                }),
            ),
          );
        } finally {
          clearInterval(beat);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[parse-fdd] request error:", err);
    await delSafe(blobUrl);
    return NextResponse.json(
      { error: "Could not read the request. Please try again." },
      { status: 400 },
    );
  }
}
