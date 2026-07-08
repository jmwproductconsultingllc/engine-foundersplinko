// fdd-engine-deploy/lib/pipeline.ts
//
// The diligence pipeline as ONE callable function, lifted verbatim out of
// app/api/parse-fdd/route.ts so the API route AND the eval harness run the
// EXACT same code path (one source of truth — no drift). route.ts keeps its
// HTTP/streaming/blob wrapper and heartbeat; it just awaits runDiligence().
//
// Imports are relative (./x), not the @/ alias, so this file resolves cleanly
// both under Next.js and under the harness's tsx runner.
//
// DEPLOY 1 of 2 (determinism cache). This version threads the optional fileHash
// into extraction for the content-addressed cache. The financial-condition call
// is UNCHANGED from prod on purpose — the cluster-escalator (Deploy 2) ships
// separately so its grade-changing behavior doesn't collide with this deploy's
// "same document → identical grade" acceptance test.

import { extractFdd } from "./extractFdd";
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
  /**
   * OPTIONAL content hash (sha256) of the PDF bytes. When provided, extraction is
   * read/write-through the determinism cache: the same document returns the same
   * finished extraction with no model call and no run-to-run variance. Omit it and
   * the pipeline extracts fresh every time — which is exactly what the eval harness
   * wants (it runs offline with no Blob credentials, and it's measuring model
   * variance on purpose). The route passes the hash it already computes for the
   * report record, so the document is hashed once per request.
   */
  fileHash?: string;
}

/**
 * Extract → score → underwrite → Insights → financial condition.
 * Extraction is the ONLY step that talks to the model; everything after is
 * deterministic and fully testable offline. Returns the exact object route.ts
 * used to assemble inline, so the streamed payload is byte-for-byte unchanged.
 */
export async function runDiligence(input: DiligenceInput) {
  const { bytes, mimeType, buyer, fileHash } = input;

  // 1) Extract structured facts — determinism cache (when fileHash given) in front
  //    of provider failover (Claude primary in prod via EXTRACTION_PRIMARY; Gemini
  //    fallback — flip with the env var). A cache hit returns provider "cache".
  const { result: extracted, provider, fellBack, fromCache } = await extractFdd(
    bytes,
    mimeType,
    fileHash,
  );
  if (fromCache) {
    console.log("[pipeline] extraction served from determinism cache (no model call).");
  } else if (fellBack) {
    console.warn(`[pipeline] extraction served by FALLBACK provider: ${provider}`);
  }
  // 2) Score deterministically (code).
  const scoring = scoreFdd(extracted, buyer);
  // 3) Underwrite against the buyer (code).
  const underwriting = underwrite(extracted, scoring, buyer);
  // 4) Insights — concept benchmarks + disclosed-margin cross-check (toggleable).
  const insights = INSIGHTS_ENABLED ? buildInsights(extracted, scoring) : null;
  // 5) Financial-condition severity from the raw facts (toggleable).
  //    UNCHANGED from prod for Deploy 1 — the systemScale escalator lands in Deploy 2.
  const financialCondition = FINCON_ENABLED
    ? assessFinancialCondition(extracted.financialCondition)
    : null;

  return { extracted, scoring, underwriting, buyer, insights, financialCondition };
}
