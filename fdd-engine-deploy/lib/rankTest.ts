/**
 * rankTest.ts — where the deal's breakeven sits inside the franchisor's own
 * disclosure.
 *
 * WHAT IT IS
 * ----------
 * The report already computes what a deal NEEDS (`requiredRevenue`). Item 19
 * already prints what the system PRODUCES (low / median / average / high). This
 * module puts those two numbers in the same place and states the rank.
 *
 *   requiredRevenue(dscr) =
 *       (annualDebtService * dscr + fixedFeesAnnual) / (1 - feeLoad - band)
 *
 * There is no forecast in this file. Every input is a disclosed figure, a loan
 * term, or a versioned benchmark band that is labelled as inferred.
 *
 * THE BOUNDARY THAT IS NOT NEGOTIABLE
 * -----------------------------------
 * The rank test compares a deal to ITS OWN franchisor's disclosure and to
 * nothing else. It never compares one brand's disclosed set to another's, and
 * it never substitutes a comparable brand's revenue for a missing Item 19. Both
 * of those manufacture a financial performance representation on behalf of a
 * franchisor. When Item 19 is absent the result is `unavailable`, with a reason.
 *
 * SEVERITY IS COMPUTED FROM THE FAVOURABLE CASE ON PURPOSE
 * -------------------------------------------------------
 * The trigger uses the LOW end of the fee load and the LOW end of the operating
 * band — the franchisor's best reading of its own document. A HIGH severity
 * therefore means: even under the most favourable assumptions we can defend,
 * this deal requires more revenue than the franchisor's best disclosed unit.
 * The figures REPORTED to the buyer use the midpoints. Do not merge these.
 *
 * FREE VS PAID
 * ------------
 * `freeCopy` is the conclusion and contains no figures at all — it is enforced
 * by a test that rejects any digit. `coverageCopy` may contain the two disclosed
 * unit counts, because counts are free under the standing rule. `figures` is
 * paid and must never be passed to a client component in a locked state.
 */

export type Severity = "high" | "medium" | "low" | "none";

export interface Band {
  low: number;
  mid: number;
  high: number;
  /** "brand" when sourced from a franchisor disclosure, else "category". */
  sourced: "brand" | "category";
  /** Band table version, e.g. "bands.v1". Carried onto the report. */
  version: string;
}

export interface Item19Distribution {
  lowAnnual?: number | null;
  medianAnnual?: number | null;
  averageAnnual?: number | null;
  highAnnual?: number | null;
  /** Units described by the Item 19 table. */
  unitsDescribed?: number | null;
  /** Total system units, from Item 20. */
  systemUnits?: number | null;
  /** e.g. "gross sales". Free text, carried through for the honesty note. */
  basis?: string | null;
  /** True when the table shows multiple years for the same units. */
  multiYearSameUnit?: boolean | null;
}

export interface RankTestInput {
  capitalGap: number;
  annualRatePct: number;
  termYears: number;
  fixedFeesAnnual: number;
  feeLoad: { low: number; mid: number; high: number; complete: boolean };
  band: Band;
  /** The lender coverage bar used for the trigger. Default 1.25. */
  lenderBar?: number;
  item19: Item19Distribution;
}

export interface RankFigures {
  annualDebtService: number;
  breakevenLow: number;
  breakevenMid: number;
  breakevenHigh: number;
  atBarLow: number;
  atBarMid: number;
  atBarHigh: number;
  lenderBar: number;
  /** atBarMid minus the highest disclosed figure it clears. Negative = clears. */
  gapToDisclosedHigh: number | null;
  gapToDisclosedMedian: number | null;
}

export interface Coverage {
  described: number;
  total: number;
  notDescribed: number;
  pct: number;
}

export interface RankTestResult {
  status: "computed" | "unavailable";
  reason: string | null;
  severity: Severity | null;
  /** Conclusion only. Contains no digits. Safe to ship unlocked. */
  freeCopy: { headline: string; note: string } | null;
  /** May contain the two disclosed unit counts. Counts are free. */
  coverageCopy: string | null;
  coverage: Coverage | null;
  /** PAID. Never send to a client component while locked. */
  figures: RankFigures | null;
  /** Notes that are free prose and always safe to render. */
  honesty: string[];
  bandVersion: string;
}

/** Annual debt service per $1 of principal, level-payment monthly amortisation. */
export function annuityFactor(annualRatePct: number, termYears: number): number {
  const i = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (i === 0) return 1 / termYears;
  return 12 * (i / (1 - Math.pow(1 + i, -n)));
}

function required(
  debtService: number,
  dscr: number,
  fixedAnnual: number,
  feeLoad: number,
  band: number,
): number | null {
  const denom = 1 - feeLoad - band;
  if (!(denom > 0)) return null;
  return (debtService * dscr + fixedAnnual) / denom;
}

const HONESTY_CONTEXT =
  "This table gives a number and a rank. It does not say what kind of location " +
  "produced it, who owned it, how it was paid for, or what market it was in. " +
  "A buyer with a stronger market has no way to prove that from this document, " +
  "and neither does the franchisor.";

const HONESTY_SMALL_SET =
  "This table describes very few units. In a set this small the ordering is not " +
  "a stable signal, because a single soft year at the top compresses the ranking.";

const HONESTY_TOP_OF_RANGE =
  "The top of this range can include locations that are larger, older, built " +
  "with cash, or run by owners operating several. Those carry no debt service " +
  "or spread their overhead. A single financed location is not comparing " +
  "itself to them.";

const HONESTY_MULTI_YEAR =
  "This disclosure shows more than one year for the same locations, which is " +
  "uncommon. It is the only way year-to-year swing is visible at all.";

/** Below this many described units, the ordering warning fires. */
export const SMALL_SET_THRESHOLD = 12;

export function computeRankTest(input: RankTestInput): RankTestResult {
  const bar = input.lenderBar ?? 1.25;
  const { item19, band, feeLoad } = input;
  const bandVersion = band.version;

  const coverage: Coverage | null =
    typeof item19.unitsDescribed === "number" &&
    typeof item19.systemUnits === "number" &&
    item19.systemUnits > 0
      ? {
          described: item19.unitsDescribed,
          total: item19.systemUnits,
          notDescribed: item19.systemUnits - item19.unitsDescribed,
          pct: item19.unitsDescribed / item19.systemUnits,
        }
      : null;

  const coverageCopy = coverage
    ? `This describes ${coverage.described} of the franchisor's ${coverage.total} locations. ` +
      `The other ${coverage.notDescribed} are not described here.`
    : null;

  const honesty: string[] = [HONESTY_CONTEXT];
  if (coverage && coverage.described < SMALL_SET_THRESHOLD) honesty.push(HONESTY_SMALL_SET);
  if (typeof item19.highAnnual === "number") honesty.push(HONESTY_TOP_OF_RANGE);
  if (item19.multiYearSameUnit === true) honesty.push(HONESTY_MULTI_YEAR);

  const unavailable = (reason: string): RankTestResult => ({
    status: "unavailable",
    reason,
    severity: null,
    freeCopy: null,
    coverageCopy,
    coverage,
    figures: null,
    honesty,
    bandVersion,
  });

  const anchors = [item19.medianAnnual, item19.averageAnnual, item19.highAnnual].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0,
  );
  if (anchors.length === 0) {
    return unavailable(
      "No disclosed performance figures. The rank test compares a deal to its own " +
        "franchisor's disclosure and has nothing to compare against.",
    );
  }
  if (!feeLoad.complete) {
    return unavailable(
      "The disclosed fee table contains a recurring charge that could not be " +
        "classified. Publishing a required-revenue figure against an incomplete " +
        "fee load would understate what the location has to produce.",
    );
  }
  if (!(input.capitalGap > 0)) {
    return unavailable("No financed amount, so there is no coverage requirement to rank.");
  }

  const A = annuityFactor(input.annualRatePct, input.termYears);
  const debtService = input.capitalGap * A;

  const breakevenLow = required(debtService, 1, input.fixedFeesAnnual, feeLoad.low, band.low);
  const breakevenMid = required(debtService, 1, input.fixedFeesAnnual, feeLoad.mid, band.mid);
  const breakevenHigh = required(debtService, 1, input.fixedFeesAnnual, feeLoad.high, band.high);
  const atBarLow = required(debtService, bar, input.fixedFeesAnnual, feeLoad.low, band.low);
  const atBarMid = required(debtService, bar, input.fixedFeesAnnual, feeLoad.mid, band.mid);
  const atBarHigh = required(debtService, bar, input.fixedFeesAnnual, feeLoad.high, band.high);

  if (
    breakevenLow === null ||
    breakevenMid === null ||
    breakevenHigh === null ||
    atBarLow === null ||
    atBarMid === null ||
    atBarHigh === null
  ) {
    return unavailable(
      "Disclosed fees plus the operating range leave no margin, so a required " +
        "revenue cannot be solved. That is itself the finding.",
    );
  }

  // SEVERITY USES THE FAVOURABLE CASE. See the header note.
  const trigger = atBarLow;
  const median = typeof item19.medianAnnual === "number" ? item19.medianAnnual : null;
  const average = typeof item19.averageAnnual === "number" ? item19.averageAnnual : null;
  const high = typeof item19.highAnnual === "number" ? item19.highAnnual : null;
  const central = [median, average].filter((v): v is number => v !== null);

  let severity: Severity;
  let headline: string;
  if (high !== null && trigger > high) {
    severity = "high";
    headline =
      "To cover debt at the level lenders require, this location needs revenue " +
      "above the best unit this franchisor disclosed.";
  } else if (central.length > 0 && trigger > Math.max(...central)) {
    severity = "medium";
    headline =
      "To cover debt at the level lenders require, this location needs revenue " +
      "above the typical unit this franchisor disclosed.";
  } else if (central.length > 0 && trigger > Math.min(...central)) {
    severity = "low";
    headline =
      "To cover debt at the level lenders require, this location needs revenue " +
      "near the upper half of what this franchisor disclosed.";
  } else {
    severity = "none";
    headline =
      "To cover debt at the level lenders require, this location needs revenue " +
      "below what a typical disclosed unit produced.";
  }

  const note =
    "Lenders typically want a coverage ratio of one and a quarter or better, and " +
    "some require one and a half. The bar is set by the individual lender and it " +
    "is pass or fail. This comparison uses the franchisor's own disclosure and no " +
    "other brand.";

  return {
    status: "computed",
    reason: null,
    severity,
    freeCopy: { headline, note },
    coverageCopy,
    coverage,
    figures: {
      annualDebtService: debtService,
      breakevenLow,
      breakevenMid,
      breakevenHigh,
      atBarLow,
      atBarMid,
      atBarHigh,
      lenderBar: bar,
      gapToDisclosedHigh: high !== null ? atBarMid - high : null,
      gapToDisclosedMedian: median !== null ? atBarMid - median : null,
    },
    honesty,
    bandVersion,
  };
}
