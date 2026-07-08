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
//
// DETERMINISM CACHE (see lib/extractionCache.ts)
// ----------------------------------------------
// An FDD is immutable for its filing year, and the model has slight run-to-run
// variance that a downstream deterministic scorer can amplify into a HIGH↔MEDIUM
// flip. So we content-hash the bytes and, on a cache HIT, return the previously
// finished extraction verbatim — no model call, no variance, identical score
// every time. On a MISS we run the normal provider+backfill flow and then store
// the FINISHED result (post-backfill — see the boundary note below). The cache is
// keyed by `fileHash` passed in from the route (which already computes it for the
// report record), so we hash the document exactly once per request.
//
// Backfill boundary (critical): we cache the result AFTER the financials backfill,
// not the raw provider output. A cache hit must return the same complete data a
// fresh run would — caching pre-backfill would freeze the "financials missing"
// state permanently on any doc whose statements were a late exhibit.

import { ExtractedFDD } from "./schema";
import { extractFddFromFile } from "./gemini";
import { extractFddWithClaude } from "./claude";
import { recoverFinancials } from "./financialsPass";
import type { FinancialConditionExtraction } from "./financialCondition";
import { getCachedExtraction, putCachedExtraction } from "./extractionCache";

// "cache" is a virtual provider: it means the result was served from the
// content-addressed store, no model vendor was called this request.
export type ExtractionProvider = "gemini" | "claude" | "cache";

type ProviderFn = (bytes: ArrayBuffer, mimeType: string) => Promise<ExtractedFDD>;

const EXTRACTORS: Record<"gemini" | "claude", ProviderFn> = {
  gemini: extractFddFromFile,
  claude: extractFddWithClaude,
};

export interface ExtractionOutcome {
  result: ExtractedFDD;
  provider: ExtractionProvider;
  fellBack: boolean;
  /** True when the result came from the determinism cache (no model call). */
  fromCache: boolean;
}

function resolvePrimary(): "gemini" | "claude" {
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
): FinancialConditionExtraction {
  // Build on `recovered` (always fully-formed) rather than `base` — base is an
  // OPTIONAL field (FinancialConditionExtraction | undefined), and spreading a
  // possibly-undefined value makes every property optional, which is not
  // assignable to the strict return type. recovered owns the statements it just
  // read (years + auditor + opinion + going-concern + prior-period); base owns the
  // narrative/cover fields a statements-only pass can't see (special-risk flag,
  // parent entity + guarantee), so those are pulled back in with undefined-guards.
  return {
    ...recovered,
    specialRiskPresent: base?.specialRiskPresent ?? recovered.specialRiskPresent,
    parentName: base?.parentName ?? recovered.parentName ?? null,
    parentGuaranteeOfPerformance:
      base?.parentGuaranteeOfPerformance ?? recovered.parentGuaranteeOfPerformance,
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

/**
 * Run the raw provider extraction with primary→secondary failover.
 * (No cache, no backfill — that wrapping lives in extractFdd below.)
 */
async function extractWithFailover(
  fileBytes: ArrayBuffer,
  mimeType: string,
): Promise<{ result: ExtractedFDD; provider: "gemini" | "claude"; fellBack: boolean }> {
  const primary = resolvePrimary();
  const secondary: "gemini" | "claude" = primary === "gemini" ? "claude" : "gemini";

  try {
    const result = await EXTRACTORS[primary](fileBytes, mimeType);
    return { result, provider: primary, fellBack: false };
  } catch (primaryErr) {
    console.error(
      `[extract] primary provider "${primary}" failed — failing over to "${secondary}": ${msgOf(primaryErr)}`,
    );
    try {
      const result = await EXTRACTORS[secondary](fileBytes, mimeType);
      console.warn(`[extract] recovered via fallback provider "${secondary}".`);
      return { result, provider: secondary, fellBack: true };
    } catch (secondaryErr) {
      console.error(
        `[extract] fallback provider "${secondary}" also failed: ${msgOf(secondaryErr)}`,
      );
      throw new Error(
        `Extraction failed on both providers (primary "${primary}": ${msgOf(primaryErr)}; ` +
          `fallback "${secondary}": ${msgOf(secondaryErr)}).`,
      );
    }
  }
}

// Apply the transparency financials backfill IN PLACE on a freshly-extracted result
// (see the long note on the original inline block). Only runs on cache MISSES.
async function backfillFinancials(result: ExtractedFDD, fileBytes: ArrayBuffer): Promise<void> {
  try {
    const dc = result.documentCheck;
    const warnsFinancialsMissing =
      !!dc && Array.isArray(dc.warnings) && dc.warnings.some(isFinancialsMissingWarning);
    if (financialsIncomplete(result.financialCondition) || warnsFinancialsMissing) {
      console.log("[extract] financials look incomplete — attempting targeted recovery from full doc.");
      const recovered = await recoverFinancials(fileBytes);
      if (recovered && !financialsIncomplete(recovered)) {
        result.financialCondition = mergeRecoveredFinancials(result.financialCondition, recovered);
        if (dc && Array.isArray(dc.warnings) && dc.warnings.length) {
          dc.warnings = dc.warnings.filter((w) => !isFinancialsMissingWarning(w));
        }
        console.warn(
          "[extract] financials recovered from full doc via targeted pass; stale warning cleared.",
        );
      } else {
        console.warn(
          "[extract] targeted recovery yielded no audited statements — leaving main-pass financials and warning intact.",
        );
      }
    }
  } catch (e) {
    console.warn("[extract] financials backfill skipped:", e instanceof Error ? e.message : e);
  }
}

/**
 * Extract an FDD with determinism cache + provider failover + financials backfill.
 *
 * @param fileBytes  the PDF bytes
 * @param mimeType   e.g. "application/pdf"
 * @param fileHash   OPTIONAL content hash (sha256, as computed by the route). When
 *                   provided, enables the read-through / write-through cache. When
 *                   omitted (e.g. the eval harness, which runs offline with no Blob
 *                   creds), the function behaves exactly as before — extract fresh,
 *                   no cache I/O. This is why the harness keeps working unchanged.
 */
export async function extractFdd(
  fileBytes: ArrayBuffer,
  mimeType: string,
  fileHash?: string,
): Promise<ExtractionOutcome> {
  // 1) Read-through: identical document → identical finished extraction, no model
  //    call, no variance. This is the guarantee that kills the flip-flop.
  if (fileHash) {
    const cached = await getCachedExtraction(fileHash);
    if (cached) {
      console.log(`[extract] cache HIT for ${fileHash} — served without a model call.`);
      return { result: cached, provider: "cache", fellBack: false, fromCache: true };
    }
    console.log(`[extract] cache MISS for ${fileHash} — extracting fresh.`);
  }

  // 2) Miss (or no hash): real extraction with provider failover…
  const { result, provider, fellBack } = await extractWithFailover(fileBytes, mimeType);

  // 3) …then the financials backfill, IN PLACE, before anything is cached. The
  //    cached object must be the finished, complete extraction (see boundary note).
  await backfillFinancials(result, fileBytes);

  // 4) Write-through: store the FINISHED result so every future run of this exact
  //    document is an instant, byte-identical cache hit. Non-fatal on failure.
  if (fileHash) {
    await putCachedExtraction(fileHash, result);
  }

  return { result, provider, fellBack, fromCache: false };
}
