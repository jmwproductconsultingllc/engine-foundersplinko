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
