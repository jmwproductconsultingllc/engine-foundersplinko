// fdd-engine-deploy/lib/extractFdd.ts
//
// Provider failover for FDD extraction. The engine must not have a single point
// of failure on one model vendor — when the primary is unavailable (e.g. Gemini
// 503 "high demand" spikes) we automatically fail over to the other provider.
//
// - Primary is selectable at runtime: EXTRACTION_PRIMARY = "gemini" (default) or
//   "claude". During a provider outage, flip the env var to skip the dead vendor
//   entirely — no code change, no waiting on retries.
// - Failover triggers on ANY primary error. The cost of one extra attempt on a
//   genuinely-bad PDF is small; the cost of NOT trying the healthy provider when
//   we could have served the customer is a lost sale. Resilience wins.
// - Returns which provider served the result so the pipeline/logs can see when a
//   fallback happened (a signal to check on the primary).

import { ExtractedFDD } from "./schema";
import { extractFddFromFile } from "./gemini";
import { extractFddWithClaude } from "./claude";
import { recoverFinancials } from "./financialsPass";

export type ExtractionProvider = "gemini" | "claude";

type Extractor = (bytes: ArrayBuffer, mimeType: string) => Promise<ExtractedFDD>;

const EXTRACTORS: Record<ExtractionProvider, Extractor> = {
  gemini: extractFddFromFile,
  claude: extractFddWithClaude,
};

export interface ExtractionOutcome {
  result: ExtractedFDD;
  provider: ExtractionProvider;
  fellBack: boolean;
}

function resolvePrimary(): ExtractionProvider {
  return process.env.EXTRACTION_PRIMARY === "claude" ? "claude" : "gemini";
}

function msgOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "unknown error";
  }
}

// --- Financials backfill helpers -------------------------------------------

/** True when the main pass produced no usable financial-statement figures. */
function financialsAreThin(fin: unknown): boolean {
  const years = (fin as { years?: Array<Record<string, unknown> | null> } | null | undefined)?.years;
  if (!Array.isArray(years) || years.length === 0) return true;
  return years.every(
    (y) => !y || (y.revenue == null && y.netIncome == null && y.totalAssets == null && y.netWorth == null),
  );
}

// A warning counts as "financials are missing" only if it mentions financials
// AND an absence phrase — so once we recover them we can drop exactly those
// (now-false) warnings without disturbing legitimate ones.
const FIN_TERM_RE =
  /(financial statement|balance sheet|income statement|statement of operations|audited|financial condition|financial data)/i;
const MISSING_RE =
  /(not included|not present|not in the provided|not in provided|not in the uploaded|not in uploaded|referenced but|largely null|are null|not provided|outside the provided|could not be located)/i;
function isFinancialsMissingWarning(w: string): boolean {
  return FIN_TERM_RE.test(w) && MISSING_RE.test(w);
}

export async function extractFdd(
  fileBytes: ArrayBuffer,
  mimeType: string,
): Promise<ExtractionOutcome> {
  const primary = resolvePrimary();
  const secondary: ExtractionProvider = primary === "gemini" ? "claude" : "gemini";

  let outcome: ExtractionOutcome;
  try {
    const result = await EXTRACTORS[primary](fileBytes, mimeType);
    outcome = { result, provider: primary, fellBack: false };
  } catch (primaryErr) {
    console.error(
      `[extract] primary provider "${primary}" failed — failing over to "${secondary}": ${msgOf(primaryErr)}`,
    );
    try {
      const result = await EXTRACTORS[secondary](fileBytes, mimeType);
      console.warn(`[extract] recovered via fallback provider "${secondary}".`);
      outcome = { result, provider: secondary, fellBack: true };
    } catch (secondaryErr) {
      // Both providers are down or the document is genuinely unprocessable.
      console.error(
        `[extract] fallback provider "${secondary}" also failed: ${msgOf(secondaryErr)}`,
      );
      throw new Error(
        `Extraction failed on both providers (primary "${primary}": ${msgOf(primaryErr)}; ` +
          `fallback "${secondary}": ${msgOf(secondaryErr)}).`,
      );
    }
  }

  // Transparency backfill — if the franchisor's financial statements were a late
  // exhibit outside the trimmed window, the main pass returns empty financials
  // and (worse) warns they're "not in the provided pages," which to someone who
  // uploaded the complete FDD looks like we altered their document. Find and
  // extract the statements from the FULL doc, then drop the now-false warning.
  try {
    const dc = outcome.result.documentCheck;
    const warnsFinancialsMissing =
      !!dc && Array.isArray(dc.warnings) && dc.warnings.some(isFinancialsMissingWarning);
    // Fire recovery if the main pass produced no usable figures OR if it flagged the
    // audited statements as missing — even when it scraped partial numbers from the
    // Item 21 narrative (which alone would look "not thin" and wrongly skip recovery).
    if (financialsAreThin(outcome.result.financialCondition) || warnsFinancialsMissing) {
      console.log("[extract] financials look incomplete — attempting targeted recovery from full doc.");
      const recovered = await recoverFinancials(fileBytes);
      if (recovered && !financialsAreThin(recovered)) {
        outcome.result.financialCondition = recovered;
        if (dc && Array.isArray(dc.warnings) && dc.warnings.length) {
          dc.warnings = dc.warnings.filter((w) => !isFinancialsMissingWarning(w));
        }
        console.warn(
          "[extract] financials recovered from full doc via targeted pass; stale warning cleared.",
        );
      }
    }
  } catch (e) {
    console.warn("[extract] financials backfill skipped:", e instanceof Error ? e.message : e);
  }

  return outcome;
}
