/**
 * app/api/parse-fdd/route.ts
 * Pipeline: receive FDD + buyer context → extract (Gemini) → score (code)
 * → underwrite (code) → return one combined payload.
 *
 * Runtime notes:
 * - Must run on the Node.js runtime (Files API + Blob), not Edge.
 * - Large-doc processing is slow; maxDuration is set to 300s (the Vercel Pro
 *   ceiling). The largest FDDs (e.g. Five Iron) run well past 60s, so do NOT
 *   drop this back to 60 — that silently breaks the big docs.
 * - Vercel serverless has a ~4.5MB request-body limit. Text FDDs usually fit;
 *   large/scanned PDFs may not. See README for the Vercel Blob upgrade path.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractFddFromFile } from "@/lib/gemini";
import { scoreFdd } from "@/lib/scoring";
import { underwrite, BuyerContext } from "@/lib/underwriting";
import { buildInsights } from "@/lib/insights";
import { INSIGHTS_ENABLED } from "@/lib/features";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("fdd");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No FDD file was uploaded." }, { status: 400 });
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "Please upload a PDF." }, { status: 400 });
    }
    if (file.size < 20_000) {
      return NextResponse.json(
        { error: "That file looks too small to be a full FDD — it may have been truncated." },
        { status: 400 },
      );
    }

    const buyer: BuyerContext = {
      liquidCapital: Number(form.get("liquidAssets") ?? 0) || 0,
      netWorth: Number(form.get("netWorth") ?? 0) || 0,
    };

    const bytes = await file.arrayBuffer();

    // 1) Extract structured facts (Gemini).
    const extracted = await extractFddFromFile(bytes, file.type || "application/pdf");

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
  }
}
