/**
 * app/api/parse-fdd/route.ts
 * Pipeline: receive a Vercel Blob URL for the FDD + buyer context → fetch the
 * PDF from Blob → extract (Gemini) → score (code) → underwrite (code)
 * → Insights (code) → return one combined payload, then delete the blob.
 *
 * Runtime notes:
 * - Must run on the Node.js runtime (Files API + Blob), not Edge.
 * - Large-doc processing is slow; maxDuration is 300s (the Vercel Pro ceiling).
 *   The largest FDDs (e.g. Five Iron) run well past 60s, so do NOT drop this
 *   back to 60 — that silently breaks the big docs.
 * - The FDD no longer rides in the request body, so the ~4.5MB serverless body
 *   limit no longer caps file size. The browser uploads straight to Blob (see
 *   app/api/blob-upload/route.ts) and we fetch it here.
 */

import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { extractFddFromFile } from "@/lib/gemini";
import { scoreFdd } from "@/lib/scoring";
import { underwrite, BuyerContext } from "@/lib/underwriting";
import { buildInsights } from "@/lib/insights";
import { INSIGHTS_ENABLED } from "@/lib/features";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

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
      return NextResponse.json(
        { error: "Could not retrieve the uploaded file. Please try again." },
        { status: 400 },
      );
    }
    const bytes = await fileRes.arrayBuffer();
    if (bytes.byteLength < 20_000) {
      return NextResponse.json(
        { error: "That file looks too small to be a full FDD — it may have been truncated." },
        { status: 400 },
      );
    }

    // 1) Extract structured facts (Gemini).
    const extracted = await extractFddFromFile(bytes, "application/pdf");

    // 2) Score deterministically (code).
    const scoring = scoreFdd(extracted, buyer);

    // 3) Underwrite against the buyer (code).
    const underwriting = underwrite(extracted, scoring, buyer);

    // 4) Insights — concept benchmarks + disclosed-margin cross-check (toggleable).
    const insights = INSIGHTS_ENABLED ? buildInsights(extracted, scoring) : null;

    return NextResponse.json({ extracted, scoring, underwriting, buyer, insights });
  } catch (err) {
    console.error("[parse-fdd] pipeline error:", err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    return NextResponse.json(
      { error: `Failed to analyze the FDD. ${message}` },
      { status: 500 },
    );
  } finally {
    // Best-effort cleanup of the transient blob, success or failure.
    if (blobUrl) {
      try {
        await del(blobUrl);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}
