// fdd-engine-deploy/lib/pipeline.ts
//
// The diligence pipeline as ONE callable function, lifted verbatim out of
// app/api/parse-fdd/route.ts so the API route AND the eval harness run the
// EXACT same code path (one source of truth — no drift). route.ts keeps its
// HTTP/streaming/blob wrapper and heartbeat; it just awaits runDiligence().
//
// Imports are relative (./x), not the @/ alias, so this file resolves cleanly
// both under Next.js and under the harness's tsx runner.

import { extractFddFromFile } from "./gemini";
import { scoreFdd } from "./scoring";
import { underwrite, type BuyerContext } from "./underwriting";
import { buildInsights } from "./insights";
import { assessFinancialCondition } from "./financialCondition";
import { INSIGHTS_ENABLED, FINCON_ENABLED } from "./features";

export type { BuyerContext };

export interface DiligenceInput {
  /** Raw PDF bytes of the FDD (fetched from Blob in prod, read from disk in the harness). */
  bytes: ArrayBuffer;
  /** MIME type handed to the extractor, e.g. "application/pdf". */
  mimeType: string;
  /** Buyer financial context (liquid capital + net worth). */
  buyer: BuyerContext;
}

/**
 * Extract → score → underwrite → Insights → financial condition.
 * Extraction is the ONLY step that talks to the model; everything after is
 * deterministic and fully testable offline. Returns the exact object route.ts
 * used to assemble inline, so the streamed payload is byte-for-byte unchanged.
 */
export async function runDiligence(input: DiligenceInput) {
  const { bytes, mimeType, buyer } = input;

  // 1) Extract structured facts (Gemini).
  const extracted = await extractFddFromFile(bytes, mimeType);
  // 2) Score deterministically (code).
  const scoring = scoreFdd(extracted, buyer);
  // 3) Underwrite against the buyer (code).
  const underwriting = underwrite(extracted, scoring, buyer);
  // 4) Insights — concept benchmarks + disclosed-margin cross-check (toggleable).
  const insights = INSIGHTS_ENABLED ? buildInsights(extracted, scoring) : null;
  // 5) Financial-condition severity from the raw facts (toggleable).
  const financialCondition = FINCON_ENABLED
    ? assessFinancialCondition(extracted.financialCondition)
    : null;

  return { extracted, scoring, underwriting, buyer, insights, financialCondition };
}
