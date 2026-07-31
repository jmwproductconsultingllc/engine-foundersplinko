/**
 * feeLoad.ts — the corrected `royaltyLoad`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The cash ladder's fee rung and the headroom screen's `royaltyLoad` were both
 * built from royalty + brand fund. Item 6 routinely discloses MORE recurring
 * percentage-of-sales obligations than those two: a co-op, a regional or local
 * advertising minimum, sometimes a technology fee expressed as a percentage.
 *
 * Omitting them makes every affected brand screen optimistic. On a $1,093,071
 * brand, one point of missed load is $911/mo — enough to move headline cash
 * after debt from +$472 to -$439 and midpoint DSCR from 1.03 to 0.97.
 *
 * THE DOUBLE-COUNT TRAP — read before editing EXCLUDED_PATTERNS
 * ------------------------------------------------------------
 * Not every percentage-of-sales line in Item 6 belongs in this number.
 * Payment / transaction processing is disclosed as a percentage but is already
 * inside the operating cost band (it lives in "other operating costs"). Adding
 * it here double-counts it against the band and understates the brand twice.
 *
 * The rule this file implements: a fee belongs in the load if and only if it is
 * (a) recurring, (b) expressed as a percentage of sales, and (c) paid to the
 * franchisor or to a franchisor-directed fund. Everything else is either a
 * fixed fee, an event-driven fee, or an operating cost inside the band.
 *
 * NOTHING IS INFERRED HERE. If a fee cannot be classified, this module reports
 * it as unclassified and marks the result incomplete rather than guessing. An
 * incomplete load must never be published as a customer-facing figure.
 */

export type FeeBucket =
  | "load" // recurring % of sales, franchisor-directed -> enters royaltyLoad
  | "fixed" // recurring flat dollars -> enters fixedFeesAnnual
  | "operating" // % of sales but already inside the operating cost band
  | "event" // one-time or event-driven (transfer, renewal, training)
  | "unclassified"; // could not be determined -> result is incomplete

export interface RawFee {
  /** Fee name exactly as disclosed. Used for classification and for display. */
  label: string;
  /** Low end of the disclosed rate. 0.08 for "8%". Null when the fee is flat. */
  ratePctLow?: number | null;
  /** High end. Equal to low when a single rate is disclosed. */
  ratePctHigh?: number | null;
  /** Flat recurring amount in dollars, if disclosed that way. */
  flatAmount?: number | null;
  /** "month" | "week" | "year" — required when flatAmount is present. */
  flatPeriod?: string | null;
  /** True when the fee is one-time or triggered by an event, not recurring. */
  oneTime?: boolean | null;
  /** Item / page citation, carried through for provenance. */
  citation?: string | null;
}

export interface FeeComponent {
  label: string;
  bucket: FeeBucket;
  low: number;
  high: number;
  citation: string | null;
}

export interface FeeLoad {
  /** Sum of the low ends. Use this end for severity triggers. */
  low: number;
  /** Sum of the high ends. */
  high: number;
  /** Midpoint. Use for reported figures, never for severity. */
  mid: number;
  /** Recurring flat fees, annualised. Feeds `fixedFeesAnnual`. */
  fixedAnnual: number;
  components: FeeComponent[];
  /** Labels that could not be classified. Non-empty => complete === false. */
  unclassified: string[];
  /** False when anything was unclassified, or when a flat fee had no period. */
  complete: boolean;
}

/**
 * Order matters. EXCLUDED is tested first so that a fee named
 * "Marketing services — credit card processing" lands in `operating`, not `load`.
 */
const EXCLUDED_PATTERNS: readonly RegExp[] = [
  /credit\s*card/i,
  /debit\s*card/i,
  /transaction\s+(processing|fee)/i,
  /payment\s+processing/i,
  /merchant\s+(services|processing|account)/i,
  /interchange/i,
  /gift\s*card\s+processing/i,
  /delivery\s+(service|aggregator|platform)/i,
  /third[-\s]?party\s+(delivery|ordering)/i,
  /rent\b/i,
  /occupancy/i,
  /percentage\s+rent/i,
  /insurance/i,
  /utilit/i,
];

const EVENT_PATTERNS: readonly RegExp[] = [
  /transfer/i,
  /renewal/i,
  /relocation/i,
  /training/i,
  /initial\s+franchise/i,
  /grand\s+opening/i,
  /audit/i,
  /late\s+(fee|charge)/i,
  /interest\s+on\s+late/i,
  /indemnif/i,
  /liquidated\s+damages/i,
  /remodel/i,
  /refresh/i,
  /testing\b/i,
];

const LOAD_PATTERNS: readonly RegExp[] = [
  /royalt/i,
  /brand\s*(fund|development)/i,
  /(national|system|general)\s+(advertis|marketing)/i,
  /advertis\w*\s+(fund|fee|contribution)/i,
  /marketing\s+(fund|fee|contribution)/i,
  /\bad\s+fund\b/i,
  /co[-\s]?op/i,
  /cooperative\s+advertis/i,
  /regional\s+(advertis|marketing)/i,
  /local\s+(advertis|marketing)/i,
  /technology\s+(fee|fund)/i,
  /software\s+fee/i,
];

function matchesAny(label: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(label));
}

function periodsPerYear(period: string | null | undefined): number | null {
  if (!period) return null;
  const p = period.toLowerCase();
  if (p.startsWith("month")) return 12;
  if (p.startsWith("week")) return 52;
  if (p.startsWith("year") || p.startsWith("annual")) return 1;
  if (p.startsWith("quarter")) return 4;
  if (p.startsWith("day")) return 365;
  return null;
}

export function classifyFee(fee: RawFee): FeeBucket {
  if (fee.oneTime === true) return "event";
  if (matchesAny(fee.label, EXCLUDED_PATTERNS)) return "operating";
  if (matchesAny(fee.label, EVENT_PATTERNS)) return "event";

  const hasRate =
    typeof fee.ratePctLow === "number" && Number.isFinite(fee.ratePctLow);
  const hasFlat =
    typeof fee.flatAmount === "number" && Number.isFinite(fee.flatAmount);

  if (hasRate) {
    return matchesAny(fee.label, LOAD_PATTERNS) ? "load" : "unclassified";
  }
  if (hasFlat) return "fixed";
  return "unclassified";
}

/**
 * Build the corrected load from a brand's disclosed recurring fees.
 *
 * The returned `low` is the sum of the low ends of every disclosed range. It is
 * the correct input for any severity decision, because a claim built on the low
 * end is a claim that survives the franchisor's most favourable reading of its
 * own document.
 */
export function computeFeeLoad(fees: readonly RawFee[]): FeeLoad {
  const components: FeeComponent[] = [];
  const unclassified: string[] = [];
  let low = 0;
  let high = 0;
  let fixedAnnual = 0;
  let complete = true;

  for (const fee of fees) {
    const bucket = classifyFee(fee);
    const rLow = typeof fee.ratePctLow === "number" ? fee.ratePctLow : 0;
    const rHighRaw =
      typeof fee.ratePctHigh === "number" ? fee.ratePctHigh : fee.ratePctLow;
    const rHigh = typeof rHighRaw === "number" ? rHighRaw : 0;

    if (bucket === "load") {
      low += rLow;
      high += rHigh;
    } else if (bucket === "fixed") {
      const n = periodsPerYear(fee.flatPeriod);
      if (n === null) {
        complete = false;
        unclassified.push(`${fee.label} (flat amount with no period)`);
      } else {
        fixedAnnual += (fee.flatAmount ?? 0) * n;
      }
    } else if (bucket === "unclassified") {
      complete = false;
      unclassified.push(fee.label);
    }

    components.push({
      label: fee.label,
      bucket,
      low: bucket === "load" ? rLow : 0,
      high: bucket === "load" ? rHigh : 0,
      citation: fee.citation ?? null,
    });
  }

  return {
    low,
    high,
    mid: (low + high) / 2,
    fixedAnnual,
    components,
    unclassified,
    complete,
  };
}

/**
 * READER — FIELD NAMES ARE GUESSES. The build thread binds this to the real
 * computed-record shape. Returns null when the fee table cannot be located, so
 * callers can count coverage instead of silently producing a zero load.
 *
 * A zero load and a missing load are not the same thing and must never collapse.
 */
export function rawFeesFromComputed(rec: unknown): RawFee[] | null {
  const r = rec as Record<string, any> | null;
  const table =
    r?.ongoingFees?.items ?? r?.ongoingFees ?? r?.fees?.ongoing ?? r?.item6?.fees;
  if (!Array.isArray(table)) return null;

  return table.map((row: Record<string, any>): RawFee => {
    const label = String(row?.label ?? row?.name ?? row?.fee ?? "");
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    return {
      label,
      ratePctLow: num(row?.ratePctLow ?? row?.pctLow ?? row?.percentLow ?? row?.ratePct),
      ratePctHigh: num(row?.ratePctHigh ?? row?.pctHigh ?? row?.percentHigh ?? row?.ratePct),
      flatAmount: num(row?.flatAmount ?? row?.amount ?? row?.dollars),
      flatPeriod: typeof row?.flatPeriod === "string" ? row.flatPeriod : (row?.period ?? null),
      oneTime: typeof row?.oneTime === "boolean" ? row.oneTime : null,
      citation: typeof row?.citation === "string" ? row.citation : null,
    };
  });
}
