/**
 * app/api/parse-fdd/route.ts
 * Receive a Vercel Blob URL for the FDD + buyer context → fetch the PDF from
 * Blob → runDiligence() → stream the combined payload back.
 *
 * The pipeline steps (extract + score + underwrite + Insights + financial
 * condition) now live in lib/pipeline.ts so the eval harness runs the EXACT
 * same code path. This route owns only the transport: Blob fetch, buyer
 * parsing, the heartbeat stream, and cleanup. The streamed payload is
 * unchanged — runDiligence returns the same object this route used to build.
 *
 * Why this STREAMS the response:
 * - The server has up to 300s (Vercel Pro), but browsers don't. Safari in
 *   particular drops a request that sits silent ~60s, and a rich FDD (which
 *   triggers the minimal-mode extraction retry) can run ~90s+. So we emit a
 *   whitespace heartbeat every few seconds to keep the socket warm, then send
 *   one final JSON line: the result, or an { error } payload. The client trims
 *   the heartbeats and parses the trailing JSON.
 *
 * Runtime notes:
 * - Must run on the Node.js runtime (Files API + Blob), not Edge.
 * - maxDuration is 300s (the Vercel Pro ceiling). The largest FDDs run well past
 *   60s, so do NOT drop this back to 60 — that silently breaks the big docs.
 * - The FDD no longer rides in the request body (no ~4.5MB serverless body
 *   limit); the browser uploads straight to Blob and we fetch it here.
 */

import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { runDiligence } from "@/lib/pipeline";
import { BuyerContext } from "@/lib/underwriting";

export const runtime = "nodejs";
export const maxDuration = 300;
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
          controller.enqueue(enc.encode("\n" + JSON.stringify(result)));
        } catch (err) {
          console.error("[parse-fdd] pipeline error:", err);
          const message = err instanceof Error ? err.message : "Unknown error.";
          controller.enqueue(
            enc.encode("\n" + JSON.stringify({ error: `Failed to analyze the FDD. ${message}` })),
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
