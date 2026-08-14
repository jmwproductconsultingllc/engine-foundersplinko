// lib/severity.ts — THE SINGLE SEVERITY RESOLVER.
//
// WHY THIS IS ITS OWN FILE
//
// components/DiligenceReport.tsx is a "use client" component and it needs to
// resolve a persisted severity. lib/financialCondition.ts is 33KB and exports
// FINANCIAL_CONDITION_EXTRACTION_PROMPT — importing it from a client component
// would ship our extraction prompt to the browser in the page bundle. So the
// resolver lives here, in a module with no dependencies and nothing to leak,
// and lib/financialCondition.ts re-exports it for the server-side call sites.
//
// WHY IT EXISTS AT ALL
//
// components/DiligenceReport.tsx indexed a four-key object literal with
// `fc.severity` and read `.color` off the result. Two records in the catalog
// (the-back-nine, golftrk) carry `severity: 'INSUFFICIENT'` — one token short
// of the real enum — so the lookup returned undefined and THE PAID REPORT THREW
// ON RENDER for exactly those two brands. A total lookup would have produced a
// wrong colour. A partial lookup produced a blank page.

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';

export const SEVERITIES: readonly Severity[] = [
  'HIGH',
  'MEDIUM',
  'LOW',
  'INSUFFICIENT_DATA',
] as const;

/**
 * Off-enum severities that DO appear in persisted brand records, and what each
 * one means in canonical terms.
 *
 * Why an alias table rather than "just fix the two records": these values were
 * not written by assessFinancialCondition(). They were written by a producer
 * outside this repo — the two records carrying 'INSUFFICIENT' also carry
 * `summary: "Engine financial-condition audit pending full parse."`, a string
 * that exists nowhere in this codebase. Repairing the JSON fixes today's
 * catalog and nothing about the next batch. Normalising at READ fixes both.
 *
 * Add a row here when a new spelling shows up. lib/severity.test.ts fails on
 * any persisted value that is neither canonical nor listed here.
 */
const SEVERITY_ALIASES: Record<string, Severity> = {
  INSUFFICIENT: 'INSUFFICIENT_DATA',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  NONE: 'INSUFFICIENT_DATA',
  UNKNOWN: 'INSUFFICIENT_DATA',
};

function severityKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/**
 * Resolve a persisted severity to the canonical union.
 *
 * WHY THE FALLBACK IS INSUFFICIENT_DATA AND NOT MEDIUM
 *
 * An unrecognised grade is the ABSENCE of information, not the presence of a
 * concern. Every consumer suppresses at INSUFFICIENT_DATA, so an unparseable
 * value produces silence. We do not publish a concern about a NAMED FRANCHISOR
 * on the strength of a token we failed to read.
 */
export function normalizeSeverity(raw: unknown): Severity {
  const key = severityKey(raw);
  if (key === null) return 'INSUFFICIENT_DATA';
  if (key in SEVERITY_ALIASES) return SEVERITY_ALIASES[key];
  return (SEVERITIES as readonly string[]).includes(key)
    ? (key as Severity)
    : 'INSUFFICIENT_DATA';
}

/**
 * True when `raw` is a value normalizeSeverity() understands ON PURPOSE,
 * rather than one it fell back on.
 *
 * That distinction is the lint's whole question. normalizeSeverity() alone can
 * never be red — it returns a valid Severity for `null`, for `42`, for
 * "banana". A lint built on it would be THE ALWAYS-PASSING VERIFIER. This is
 * the predicate that can actually fail.
 */
export function isKnownSeverity(raw: unknown): boolean {
  const key = severityKey(raw);
  if (key === null) return false;
  return key in SEVERITY_ALIASES || (SEVERITIES as readonly string[]).includes(key);
}

/* ------------------------------------------------------------------ *
 * THE SIGN GATE, AT READ.
 * ------------------------------------------------------------------ */

/** The only two fields of ComputedMetrics this resolver needs. Structural on
 *  purpose — this module imports nothing, and a type import from
 *  financialCondition.ts would invite a value import next. */
export interface SignedMetrics {
  netIncome?: number | null;
  netWorthSign?: 'positive' | 'negative' | 'unknown' | null;
}

/** Copy that asserts a DIRECTION. Every phrase here is a claim about the sign
 *  of a figure, so every phrase here is falsifiable against that figure. */
const LOSS_ASSERTIONS =
  /run losses|running losses|carry a deficit|carries a deficit|spending ahead of revenue|net loss/i;

/**
 * Resolve a persisted financial-condition context paragraph.
 *
 * WHY THIS EXISTS
 *
 * buildContext() shipped for months without ever reading the sign of net
 * income or net worth. 21 of the 29 catalog records carrying that paragraph
 * assert a direction the record cannot support: 8 say the franchisor "commonly
 * runs losses and carries a deficit" in the same sentence that reports positive
 * net worth, on records reporting positive net income; 13 say it on records
 * where netIncome and netWorth were never extracted at all. The producer is
 * fixed in lib/financialCondition.ts. This is the second lock: a stale record —
 * or one written by a batch path outside this repo — still cannot print a claim
 * its own numbers refute.
 *
 * WHY SUPPRESSION AND NOT REPAIR
 *
 * This module has the insight, not the extraction. It cannot know what the
 * right sentence is; it can only know that this one is wrong. The headline is
 * computed separately and is correct in all 21 cases, so suppressing the
 * context leaves a true, complete card. Silence beats a confident falsehood —
 * the same reason normalizeSeverity() falls back to INSUFFICIENT_DATA.
 *
 * A null netIncome with a non-negative netWorthSign suppresses too. An
 * unextracted figure is not evidence of a loss.
 */
export function resolveFinancialContext(
  context: unknown,
  metrics: SignedMetrics | null | undefined
): string | null {
  if (typeof context !== 'string' || context.trim() === '') return null;
  if (!LOSS_ASSERTIONS.test(context)) return context;

  const ni = metrics?.netIncome;
  const hasLoss = typeof ni === 'number' && Number.isFinite(ni) && ni < 0;
  const hasDeficit = metrics?.netWorthSign === 'negative';

  // The paragraph asserts losses or a deficit. At least one must actually be
  // there, or the sentence is describing a company that does not exist.
  return hasLoss || hasDeficit ? context : null;
}
