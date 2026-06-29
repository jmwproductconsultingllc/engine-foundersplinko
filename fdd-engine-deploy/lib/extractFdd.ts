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
import type { FinancialConditionExtraction } from "./financialCondition";

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

// Whether the AUDITED financial statements were actually captured. This reads the
// DATA, not the model's prose. A balance sheet (totalAssets / totalLiabilities) or
// a real audit opinion only ever comes from the statements themselves; an Item 21
// narrative scrape yields a stray revenue or net-worth figure but never a balance
// sheet — so "we have a couple of numbers" must NOT count as complete. That was the
// old bug: a narrative scrape read as "not thin" and wrongly skipped recovery.
// auditOpinion is a non-nullable enum whose "unknown" value means "not seen," so it
// is treated the same as missing.
function financialsIncomplete(fin: unknown): boolean {
  const f = fin as
    | {
        auditorName?: unknown;
        auditOpinion?: unknown;
        years?: Array<{ totalAssets?: unknown; totalLiabilities?: unknown } | null>;
      }
    | null
    | undefined;
  const years = f?.years;
  if (!Array.isArray(years) || years.length === 0) return true;
  const hasBalanceSheet = years.some(
    (y) => y != null && (y.totalAssets != null || y.totalLiabilities != null),
  );
  const auditorName = typeof f?.auditorName === "string" ? f.auditorName.trim() : "";
  const auditOpinion = typeof f?.auditOpinion === "string" ? f.auditOpinion : "";
  const hasAuditMeta = auditorName !== "" || (auditOpinion !== "" && auditOpinion !== "unknown");
  return !hasBalanceSheet && !hasAuditMeta;
}

// The recovery pass reads ONLY the financial-statement pages, so it is authoritative
// for the statements (years + auditor + opinion + going-concern) but blind to
// narrative context (parent entity, special-risk flag) the full-doc main pass
// already captured. Merge accordingly — never let a statements-only pass null out
// e.g. UPS's parent name by wholesale-replacing the object.
function mergeRecoveredFinancials(
  base: ExtractedFDD["financialCondition"],
  recovered: FinancialConditionExtraction,
): ExtractedFDD["financialCondition"] {
  const recoveredOpinion =
    recovered.auditOpinion && recovered.auditOpinion !== "unknown" ? recovered.auditOpinion : null;
  return {
    ...base,
    years: recovered.years ?? base.years,
    auditorName: recovered.auditorName ?? base.auditorName ?? null,
    auditOpinion: recoveredOpinion ?? base.auditOpinion,
    goingConcernRaised: recovered.goingConcernRaised ?? base.goingConcernRaised,
  };
}

// A warning counts as "financials are missing" only if it mentions financials AND an
// absence/partial phrase — so once we recover them we drop exactly those (now-false)
// warnings without disturbing legitimate financial FINDINGS (e.g. an equity deficit),
// which also live in documentCheck.warnings. The model rewords the absence every run
// ("not provided" / "not fully provided" / "description only" / ...), so match the
// family, not one phrasing — the narrow old pattern missed "not fully provided" and
// left the stale note on the report.
const FIN_TERM_RE =
  /(financial statement|balance sheet|income statement|statement of operations|audited|financial condition|financial data|financial figures)/i;
const MISSING_RE =
  /(not (?:fully |directly )?(?:provided|reproduced|included|present|available|extracted|attached|reflected)|not in (?:the )?(?:provided|uploaded)|could not be (?:located|extracted|read|found)|description only|referenced but|outside the provided|limited to|are null|largely null)/i;
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
    // Fire recovery when the audited statements were not captured — judged from the
    // DATA (robust to the model scraping a stray Item 21 figure), with the warning
    // text as a secondary backstop. The data check is primary precisely because the
    // warning phrasing is unreliable run-to-run.
    if (financialsIncomplete(outcome.result.financialCondition) || warnsFinancialsMissing) {
      console.log("[extract] financials look incomplete — attempting targeted recovery from full doc.");
      const recovered = await recoverFinancials(fileBytes);
      if (recovered && !financialsIncomplete(recovered)) {
        outcome.result.financialCondition = mergeRecoveredFinancials(
          outcome.result.financialCondition,
          recovered,
        );
        if (dc && Array.isArray(dc.warnings) && dc.warnings.length) {
          dc.warnings = dc.warnings.filter((w) => !isFinancialsMissingWarning(w));
        }
        console.warn(
          "[extract] financials recovered from full doc via targeted pass; stale warning cleared.",
        );
      } else {
        // Recovery ran but came back empty/thin — the statements are likely a scanned
        // image with no text layer (densestRange scores on EXTRACTED text, so an
        // image-only exhibit scores zero and never gets carved). Leave the main-pass
        // financials and the honest warning intact; never fabricate. If this branch
        // fires on docs we know contain statements, the next fix is to carve the
        // late-exhibit page range directly and let Claude's vision read it.
        console.warn(
          "[extract] targeted recovery yielded no audited statements — leaving main-pass financials and warning intact.",
        );
      }
    }
  } catch (e) {
    console.warn("[extract] financials backfill skipped:", e instanceof Error ? e.message : e);
  }

  return outcome;
}
