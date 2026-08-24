/**
 * scoring.ts
 * DETERMINISTIC risk scoring. No LLM here — given the extracted facts, this
 * computes the unit economics and a Low/Medium/High score from an explicit,
 * tunable rubric. Same input → same output, every time, with reasons you can
 * defend ("HIGH because mid-cohort DSCR < 1.25").
 *
 * Tune RUBRIC as you learn from real deals.
 */

import { ExtractedFDD, Item19Cohort } from "./schema";
import { resolveMonthlyRent, premisesModel, type RentResolution } from "./rent";
import { resolvePercentageFees, resolveFlatFees, obligationOf } from "./feeObligation";
import { resolveCurrency, currencyDisclosure } from "./currency";

export const RUBRIC = {
  dscrStress: 1.25, // debt-service coverage below this = stressed
  rentPctStress: 0.25, // rent above this share of revenue = stressed
  paybackYearsStress: 5, // payback longer than this = stressed
  highRoyaltyPct: 7, // royalty above this = a flag
  // assumptions used when the buyer hasn't given their own financing terms:
  defaultSbaRate: 10.5,
  defaultSbaTermYears: 10,
  defaultLoanToBuildout: 0.8,
  // ---- contextual risk escalation (tunable) ----
  // capital gap as a multiple of the buyer's liquid capital:
  capitalGapModerateRatio: 2.5, // >= this → +1
  capitalGapHighRatio: 4, //       >= this → +2
  capitalGapExtremeRatio: 8, //    >= this → +3
  // count of HIGH-severity operational tripwires:
  someHighTripwires: 2, // >= this → +1
  manyHighTripwires: 4, // >= this → +2
};

/**
 * Past this, a computed payback is a division artifact, not a finding.
 *
 * Payback = build-out ÷ annual EBITDA. As EBITDA approaches zero the quotient
 * explodes, and we were printing the result verbatim to one decimal place —
 * "Long payback: ~801.1 years" shipped on a live brand page. Deliberately NOT
 * in RUBRIC: RUBRIC holds scoring thresholds (this changes no score — the
 * paybackYearsStress flag already fired). This is a copy guard, and keeping it
 * out of RUBRIC keeps "every RUBRIC value is a scoring bar" true.
 */
export const PAYBACK_NOT_MEANINGFUL_YEARS = 40;

export interface CohortEconomics {
  label: string;
  monthlyRevenue: number;
  monthlyVariable: number;
  monthlyFixed: number;
  monthlyEbitda: number; // excludes payroll + debt service
  annualEbitda: number;
  coversCosts: boolean;
  /**
   * Provenance of monthlyRevenue — where the pro-forma top line actually came
   * from, recorded at the point the routing decision is made (NOT reverse-
   * engineered downstream). Powers the report's "How this is calculated" line.
   * Raw enum values (revenueType/ownership) are passed through; the renderer
   * maps them to prose. Optional so legacy callers/tests stay valid.
   */
  source?: {
    basis: "disclosed" | "network";
    label: string;
    math: string | null;
    revenueType?: string | null;
    ownership?: string | null;
    sample?: number | null;
  } | null;
}

export interface ScoringResult {
  riskLevel: "Low" | "Medium" | "High";
  riskReasons: string[];
  midCohort: CohortEconomics | null;
  bottomCohort: CohortEconomics | null;
  buildoutMidpoint: number | null;
  assumedLoan: number | null;
  assumedMonthlyDebtService: number | null;
  dscr: number | null;
  rentPctOfRevenue: number | null;
  paybackYears: number | null;
  /** total variable rate applied to revenue (royalty + brand + local ad), as a fraction */
  variableRate: number;
  /** flat monthly fixed costs (fees + rent) used in the model */
  fixedMonthly: number;
  /** resolved rent inside fixedMonthly (rent-resolver hotfix). null = unresolvable —
   *  the renderer splits the line and says "not disclosed" out loud. Optional so
   *  stored pre-hotfix results stay type-valid (lib/rentCorrection.ts patches those). */
  rentResolution?: RentResolution | null;
  /** flat monthly fees only (fixedMonthly minus rent) — powers the split line */
  fixedFeesMonthly?: number;
  /**
   * Why no pro forma was built, when none was. A filing with no Item 19 revenue
   * and a filing whose Item 19 we read and refused both produce a null cohort
   * and are not remotely the same thing to a buyer. The ladder renders this
   * instead of guessing which happened.
   */
  item19Unusable?: { reason: string; whatToAsk?: string };
  notes: string[];
}

/** Standard amortized monthly payment. */
export function amortize(principal: number, annualRatePct: number, years: number): number {
  if (principal <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

/**
 * THE TOP LINE MUST BE GROSS SALES.
 *
 * Motivating bug, found reading the stored corpus rather than the code: Ellie
 * Mental Health's pro forma was built on the cohort "Franchised Clinics New
 * Patients", whose disclosed figure is 400 — four hundred NEW PATIENTS A YEAR.
 * The engine read it as $400 of annual revenue, made the top line $33/month,
 * and every rung below inherited it. The $3-$5 monthly rent that surfaced in
 * the corpus audit was not a rent defect at all; it was 10-15% occupancy
 * applied to $33.
 *
 * Gorilla Property Services failed the same way through the other door: the
 * cohort "Canadian Franchisees Profit and Loss Table 4 Median" matched the
 * keyword "median" and became the top line at $11,431/month. It is a PROFIT
 * table. The brand's disclosed gross revenue is $835,748/month, in the same
 * filing, in a cohort sitting right beside it.
 *
 * In both cases the extractor did its job: it tagged those cohorts "other" and
 * "net_or_ebitda" respectively. The selection logic simply never read the tag —
 * findCohort matched on the LABEL alone, and the franchised fallback excluded
 * net_or_ebitda and pre_sale_only while quietly allowing "other", which is the
 * bucket that by definition means "this is not gross sales".
 *
 * undefined is permissive on purpose: revenueType postdates some stored
 * records, and a legacy cohort with no tag is not evidence of a bad tag. An
 * EXPLICIT non-revenue tag disqualifies.
 */
/**
 * The revenue ONE outlet earned, which is the only figure a pro forma may use.
 *
 * Bar-B-Clean's Item 19 reports by market: "Central Texas, 11 Bar-B-Clean
 * Businesses, $1,512,928". Read as one unit that is $126,077 a month. Divided
 * by the count printed in the next column it is $137,539 a YEAR. The filing
 * publishes no per-business figure at all — division is the only route to one,
 * and the divisor is sitting right there in the table.
 *
 * Absent outletsCovered means a record extracted before the field existed, and
 * those are treated as per-unit because that is what the old contract assumed.
 * suspectedSystemTotals() is the net under that assumption.
 */
export function perOutletAnnualRevenue(c: Item19Cohort | null | undefined): number | null {
  if (c == null) return null;
  const annual = c.annualRevenue ?? (c.avgMonthlyRevenue != null ? c.avgMonthlyRevenue * 12 : null);
  if (annual == null || !(annual > 0)) return null;
  // ONLY AN EXPLICIT "combined" DIVIDES. A missing scope is the contract every
  // stored record was built under, and an ambiguous count is worse than none —
  // see the schema note on figureScope for the run where that was proven.
  if (c.figureScope !== "combined") return annual;
  const across = c.combinedAcross;
  if (across == null || !Number.isFinite(across) || across < 1) return null;
  return annual / across;
}

export function isRevenueCohort(c: Item19Cohort | null | undefined): boolean {
  return c != null && (c.revenueType == null || c.revenueType === "gross_sales");
}

/**
 * A SYSTEM TOTAL IS NOT A UNIT.
 *
 * Second defect in the same filing, confirmed against the source document.
 * Gorilla Property Services' Item 19 Table 1 prints "Total gross revenue
 * $10,028,981.01" for 32 Canadian franchisees, and directly beneath it
 * "Average gross revenue per franchisee $313,405.66". The extraction took the
 * total. The pro forma was built on $835,748 a month of revenue for a single
 * gutter-cleaning franchise — 32 times the disclosed per-outlet figure, in a
 * filing whose own highest-performing single franchisee did $1.31M for the
 * YEAR.
 *
 * Code cannot tell a large outlet from a summed one by looking at a number in
 * isolation. It can tell when a cohort is a wild outlier against its siblings
 * AND dividing it by its own sample size lands it right back among them, which
 * is the arithmetic signature of a total and nothing else.
 *
 * WHAT WE DO NOT DO IS DIVIDE. The suspicion is that this filing's Item 19 was
 * read wrong, and a filing read wrong once is not a filing to guess at twice:
 * Gorilla's SECOND revenue cohort is a total as well, and quietly dividing the
 * one we caught would have produced a confident number off by a factor of two
 * instead of a factor of thirty-two. Every revenue cohort in a filing carrying
 * one of these is refused, the pro forma comes out UNVERIFIED rather than
 * wrong, and the note says exactly what was seen.
 */
/**
 * The explicit field first; then the note the extractor already captured.
 * Gorilla's stored record predates the field but carries the sentence verbatim
 * in item19.notes — "All dollar amounts in Item 19 are presented in CAD and not
 * USD." The fact was extracted correctly and then read by nobody, which is the
 * same shape of failure as the revenueType tag two functions up.
 */
export { resolveCurrency as resolveItem19Currency } from "./currency";

export function suspectedSystemTotals(cohorts: Item19Cohort[]): boolean {
  // FRANCHISED cohorts only. Measured across the 83-brand corpus, this filter
  // is the difference between a usable detector and a blunt one: Amazing
  // Athletes and Soccer Stars both trip on an "Affiliate-Owned Outlets" cohort
  // whose figure never reaches a franchisee pro forma anyway, and condemning
  // their filings for it would have destroyed two perfectly good top lines.
  // A total sitting in a company or affiliate table is not our problem.
  const rev = cohorts.filter(
    (c) =>
      isRevenueCohort(c) &&
      (c.annualRevenue ?? 0) > 0 &&
      (c.sampleSize ?? 0) >= 2 &&
      c.ownership !== "company" &&
      c.ownership !== "affiliate" &&
      !/\b(?:affiliate|company)[- ]owned\b/i.test(c.label ?? ""),
  );
  if (rev.length < 2) return false;
  for (const c of rev) {
    const mine = c.annualRevenue as number;
    const others = rev.filter((o) => o !== c).map((o) => o.annualRevenue as number).sort((a, b) => a - b);
    const median = others[Math.floor(others.length / 2)];
    if (!(median > 0)) continue;
    const perUnit = mine / (c.sampleSize as number);
    // A genuine top quintile runs a few times its siblings, not five.
    const isOutlier = mine > 5 * median;
    const dividingFixesIt = perUnit >= median / 5 && perUnit <= median * 5;
    if (isOutlier && dividingFixesIt) return true;
  }
  return false;
}

function findCohort(cohorts: Item19Cohort[], keys: string[]): Item19Cohort | null {
  const lower = (s: string) => s.toLowerCase();
  for (const c of cohorts) {
    const l = lower(c.label);
    if (keys.some((k) => l.includes(k))) return c;
  }
  return null;
}

const fmtUsd0 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/**
 * How the monthly figure was derived from a disclosed cohort, for the
 * "How this is calculated" line. If the cohort carries an annual figure that
 * reconciles to the stored monthly average, we show "$X/yr ÷ 12"; otherwise it
 * is the disclosed monthly average as-is. annualRevenue is read defensively so
 * this stays valid even if the field isn't on the cohort type.
 */
function cohortMath(c: Item19Cohort): string | null {
  if (c.avgMonthlyRevenue == null) return null;
  const annual = (c as { annualRevenue?: number | null }).annualRevenue ?? null;
  if (annual != null && Math.abs(annual / 12 - c.avgMonthlyRevenue) <= Math.max(2, c.avgMonthlyRevenue * 0.02)) {
    return `${fmtUsd0(annual)}/yr ÷ 12`;
  }
  return "disclosed monthly average";
}

function disclosedSource(c: Item19Cohort): NonNullable<CohortEconomics["source"]> {
  return {
    basis: "disclosed",
    label: c.label,
    math: cohortMath(c),
    revenueType: c.revenueType ?? null,
    ownership: c.ownership ?? null,
    sample: c.sampleSize ?? null,
  };
}

function buildCohort(
  label: string,
  monthlyRevenue: number,
  variableRate: number,
  fixedMonthly: number,
): CohortEconomics {
  const monthlyVariable = monthlyRevenue * variableRate;
  const monthlyEbitda = monthlyRevenue - monthlyVariable - fixedMonthly;
  return {
    label,
    monthlyRevenue,
    monthlyVariable,
    monthlyFixed: fixedMonthly,
    monthlyEbitda,
    annualEbitda: monthlyEbitda * 12,
    coversCosts: monthlyEbitda >= 0,
  };
}

export function scoreFdd(
  fdd: ExtractedFDD,
  buyer?: { liquidCapital?: number },
): ScoringResult {
  const notes: string[] = [];
  const reasons: string[] = [];

  const f = fdd.ongoingFees;
  if (f.royaltyPct == null) notes.push("Royalty % not found; variable costs may be understated.");

  // The royalty risk flag below reads the DISCLOSED royalty slot, deliberately.
  // It is a statement about what Item 6 says the royalty is, not about the
  // resolved fee stack. (Known gap, pre-existing: a record that carries the
  // royalty only in percentageFees and leaves the named slot null does not
  // trip this flag. Out of scope here.)
  const royalty = f.royaltyPct ?? 0;

  // FE-142 / FE-144 · variableRate and the flat-fee total are resolved FURTHER
  // DOWN, immediately before fixedMonthly. They used to be computed here, which
  // was the defect: a floor is max(rate x revenue, floor) and this point in the
  // function has no revenue yet — midRevenue is not resolved until the cohort
  // search below. Summing flatMonthlyFees raw was the only thing possible here,
  // and summing it raw is exactly what charged a minimum on top of the
  // percentage it bounds.
  //
  // NOTE: we intentionally do NOT auto-sum hidden/contingent costs (step-in
  // fees, ACH penalties) — they're situational. They surface as flags instead.

  // ---- cohorts ----
  const allCohorts = fdd.item19?.cohorts ?? [];
  // Label matching runs ONLY over cohorts that are actually revenue. A profit
  // table headed "Median" is still a profit table.
  const cohorts = allCohorts.filter(isRevenueCohort);
  const excludedByType = allCohorts.length - cohorts.length;
  if (excludedByType > 0) {
    notes.push(
      `Item 19 in this filing also publishes ${excludedByType === 1 ? "a table that is" : `${excludedByType} tables that are`} not gross sales — patient or visit counts, a profit-and-loss table, or pre-sale figures. ${excludedByType === 1 ? "It is" : "They are"} excluded from the top line, which is built only on disclosed gross revenue.`,
    );
  }

  let item19Unusable: { reason: string; whatToAsk?: string } | undefined;

  const item19IsSuspect = suspectedSystemTotals(cohorts);
  if (item19IsSuspect) {
    item19Unusable = {
      reason:
        "Item 19 discloses revenue, but it reports outlets together rather than one at a time — one table is many times its siblings and divides back into line by its own franchisee count. A per-outlet figure cannot be read from it, and this report will not estimate one.",
      whatToAsk:
        "Ask the franchisor for gross revenue PER FRANCHISED OUTLET for the most recent year, and for the Item 20 franchisee roster. Three owners in markets like yours will tell you in ten minutes what this table does not.",
    };
    // Refuse the whole Item 19 rather than pick the least wrong number.
    cohorts.length = 0;
    reasons.push(
      "Item 19 in this filing appears to report SYSTEM TOTALS where a per-outlet figure is required — one revenue table is many times its siblings and divides back into line by its own franchisee count. No franchisee pro forma is built from it. Read the Item 19 tables directly and check whether each figure is a total or a per-outlet average before relying on any number below.",
    );
  }

  let midRaw =
    findCohort(cohorts, ["middle", "mid", "60", "median", "2nd", "second"]) ?? null;
  const bottomRaw = findCohort(cohorts, ["bottom", "30", "lowest", "4th", "fourth"]) ?? null;

  let midSource: CohortEconomics["source"] = null;
  let midRevenue: number | null = null;
  const perOutletMonthly = (c: Item19Cohort | null | undefined): number | null => {
    const annual = perOutletAnnualRevenue(c);
    return annual == null ? null : annual / 12;
  };
  const noteDivision = (c: Item19Cohort) => {
    const outlets = c.figureScope === "combined" ? c.combinedAcross : null;
    if (outlets != null && outlets > 1) {
      notes.push(
        `The Item 19 row this pro forma runs on reports ${outlets} outlets together ("${c.label}"). The top line above is that figure divided by ${outlets} — the revenue of ONE outlet. The filing does not publish a per-outlet number directly.`,
      );
    }
  };

  if (midRaw != null && perOutletMonthly(midRaw) != null) {
    midRevenue = perOutletMonthly(midRaw);
    midSource = disclosedSource(midRaw);
    noteDivision(midRaw);
  } else if (!item19IsSuspect && fdd.item19?.networkAverageMonthly != null) {
    // A tier cohort may have matched by keyword but carried no value (the
    // median / blank-cohort case) — the NUMBER is still the network average, so
    // record it as such rather than inheriting the unmatched tier's label.
    midRevenue = fdd.item19.networkAverageMonthly;
    midSource = { basis: "network", label: "network average of disclosed cohorts", math: null };
  }

  // P1 — LEAD WITH THE FRANCHISED COHORT. When the percentile-tier search finds
  // nothing (e.g. an FDD that reports Company vs Franchised instead of tiers,
  // like Five Iron), build the pro forma off the FRANCHISED operating figure —
  // never company/affiliate-owned (which runs ~2x higher) and never pre-sale.
  if (midRevenue == null) {
    const franchised = cohorts.find(
      (c) =>
        c.avgMonthlyRevenue != null &&
        isRevenueCohort(c) &&
        c.revenueType !== "pre_sale_only" &&
        c.revenueType !== "net_or_ebitda" &&
        !/pre-?sale/i.test(c.label) &&
        (c.ownership === "franchised" ||
          (/franchis/i.test(c.label) &&
            c.ownership !== "company" &&
            c.ownership !== "affiliate")),
    );
    if (franchised) {
      midRaw = franchised;
      midRevenue = perOutletMonthly(franchised);
      midSource = disclosedSource(franchised);
      noteDivision(franchised);
      if (franchised.sampleSize != null && franchised.sampleSize <= 5) {
        reasons.push(
          `Pro forma is built on only ${franchised.sampleSize} franchised location${
            franchised.sampleSize === 1 ? "" : "s"
          } — a very thin sample; treat the modeled franchisee economics as low-confidence.`,
        );
      }
    }
  }

  const bottomRevenue = perOutletMonthly(bottomRaw);

  // Currency is reported, never converted. The franchisor's own parity claim —
  // Gorilla argues a Canadian franchisee charges $250 CAD where a US one
  // charges $250 USD for the same service — is an argument the BUYER should
  // weigh, not one we should silently resolve with an exchange rate.
  const currency = resolveCurrency(fdd);
  if (typeof currency === "string" && currency.trim() && currency.trim().toUpperCase() !== "USD") {
    const disclosure = currencyDisclosure(fdd);
    if (disclosure) notes.push(disclosure);
  }

  // ---- rent (rent-resolver hotfix): disclosed number → normalized rentDetail →
  // disclosed annual range → Item 7 rent line ÷ horizon → category occupancy
  // benchmark × the SAME top line the pro forma uses. $0-by-null NEVER silently
  // enters a rent-labeled line; unresolved rent is called out and the renderer
  // splits the fixed-cost line. ----
  const rentRes = resolveMonthlyRent(fdd, midRevenue ?? fdd.item19?.networkAverageMonthly ?? null);
  const rent = rentRes?.mid ?? 0;
  if (rentRes == null && premisesModel(fdd).homeBased) {
    // FE-143 · say the true thing. "Could not be resolved" and "the filing says
    // there is nothing to resolve" are different statements, and a buyer who
    // reads the first one goes looking for a number that does not exist.
    notes.push(
      "This filing states the business is operated from the franchisee's home and requires no site approval, so no premises rent is modeled. Any vehicle storage or equipment parking disclosed in Item 7 is charged; confirm what you will actually pay.",
    );
  } else if (rentRes == null) {
    notes.push("Rent could not be resolved from the FDD or benchmarks; fixed costs EXCLUDE rent and the report labels the margin accordingly.");
  } else if (rentRes.basis !== "disclosed") {
    notes.push(
      `Rent modeled at $${rentRes.lo.toLocaleString()}–$${rentRes.hi.toLocaleString()}/mo (${
        rentRes.basis === "benchmark" ? "category occupancy benchmark" : "disclosed range"
      }); the math uses the midpoint.`,
    );
  }
  // ---- fees, resolved against the revenue they are charged on ----
  // The ladder (lib/ladderInput.ts) runs these same two resolvers on the same
  // inputs. That is deliberate and it is the point: before this, the score and
  // the ladder could print different fee loads for the same brand, and a buyer
  // had no way to know which half to trust. lib/feeAgreement.test.ts pins them
  // together.
  const pctFees = resolvePercentageFees(fdd);
  const flat = resolveFlatFees(f?.flatMonthlyFees, pctFees.fees, midRevenue);
  const flatFees = flat.totalMonthly;
  const variableRate =
    pctFees.fees
      .filter((x) => obligationOf(x) === "FIXED")
      .filter((x) => !flat.supersededPctLabels.includes(x.label))
      .reduce((a, x) => a + x.pct, 0) / 100;

  const fixedMonthly = flatFees + rent;

  let midCohort: CohortEconomics | null = null;
  let bottomCohort: CohortEconomics | null = null;

  if (midRevenue != null) {
    // When the figure is the network average, label it as such — don't inherit
    // an unmatched tier cohort's label (which produced the "2nd Quartile" pro
    // forma whose number was actually the network average). Label only; the
    // risk math is unchanged.
    const midLabel =
      midSource?.basis === "network" ? "Network Average" : midRaw?.label ?? "Network Average";
    midCohort = buildCohort(midLabel, midRevenue, variableRate, fixedMonthly);
    midCohort.source = midSource;
  } else {
    notes.push("No Item 19 middle-cohort or network-average revenue found; economics are indeterminate.");
  }
  if (bottomRevenue != null) {
    bottomCohort = buildCohort(bottomRaw?.label ?? "Bottom cohort", bottomRevenue, variableRate, fixedMonthly);
  }

  // ---- buildout + assumed debt service ----
  const lo = fdd.item17?.initialInvestmentLow ?? null;
  const hi = fdd.item17?.initialInvestmentHigh ?? null;
  const buildoutMidpoint =
    lo != null && hi != null ? (lo + hi) / 2 : hi ?? lo ?? null;

  let assumedLoan: number | null = null;
  let assumedDebt: number | null = null;
  if (buildoutMidpoint != null) {
    assumedLoan = buildoutMidpoint * RUBRIC.defaultLoanToBuildout;
    assumedDebt = amortize(assumedLoan, RUBRIC.defaultSbaRate, RUBRIC.defaultSbaTermYears);
  } else {
    notes.push("Item 17 initial investment not found; debt-service and payback cannot be computed.");
  }

  // ---- ratios ----
  const dscr =
    midCohort && assumedDebt && assumedDebt > 0
      ? midCohort.annualEbitda / (assumedDebt * 12)
      : null;
  const rentPctOfRevenue =
    midCohort && midCohort.monthlyRevenue > 0 ? rent / midCohort.monthlyRevenue : null;
  const paybackYears =
    midCohort && buildoutMidpoint != null && midCohort.annualEbitda > 0
      ? buildoutMidpoint / midCohort.annualEbitda
      : null;

  // ---- rubric → score ----
  let points = 0;

  if (dscr != null && dscr < RUBRIC.dscrStress) {
    points += 2;
    // NAME THE OUTPUT, NEVER THE CUTOFF. This used to append
    // "(below ${RUBRIC.dscrStress})" — which publishes our internal bar to the
    // buyer. That is a disclosure about US, not about the franchise: it invites
    // "why 1.25?", and it goes stale the day the rubric is retuned, at which
    // point every stored report contradicts the live one. Enforced by
    // lib/reasonCopy.test.ts.
    reasons.push(`Debt-service coverage is thin: mid-cohort DSCR ≈ ${dscr.toFixed(2)}.`);
  }
  if (bottomCohort && !bottomCohort.coversCosts) {
    points += 2;
    reasons.push(
      `Bottom cohort (~$${Math.round(bottomCohort.monthlyRevenue).toLocaleString()}/mo) does not cover operating costs before debt — a slow ramp risks early default.`,
    );
  }
  if (rentPctOfRevenue != null && rentPctOfRevenue > RUBRIC.rentPctStress) {
    points += 1;
    // Cutoff parenthetical removed — see the DSCR note above.
    reasons.push(`Rent is heavy: ~${Math.round(rentPctOfRevenue * 100)}% of mid-cohort revenue.`);
  }
  if (paybackYears != null && paybackYears > RUBRIC.paybackYearsStress) {
    points += 1;
    // Payback is buildout ÷ annual EBITDA. When EBITDA is near zero the quotient
    // explodes and we were printing it verbatim — ellie-mental-health shipped
    // "Long payback: ~801.1 years", to one decimal place, on a live public page.
    // That is not a finding, it is a division artifact wearing false precision,
    // and a reader who spots it stops trusting every other number on the page.
    // Past a realistic operating horizon the honest statement is that the
    // payback cannot be computed, not that it is eight centuries.
    reasons.push(
      paybackYears > PAYBACK_NOT_MEANINGFUL_YEARS
        ? "Payback on the build-out is not meaningfully computable — modeled mid-cohort earnings are too thin to amortize the investment over any realistic horizon."
        : `Long payback: ~${paybackYears.toFixed(1)} years on the build-out before financing.`,
    );
  }
  if (royalty > RUBRIC.highRoyaltyPct) {
    points += 1;
    // "Above-market royalty at 8.25%" asserts a fact about the franchise MARKET
    // that we cannot cite. The FDD discloses the royalty; it does not disclose
    // the market. State the disclosed figure and let it carry the weight.
    reasons.push(`Royalty runs ${royalty}% of gross revenue — verify what that leaves at the bottom line.`);
  }
  if (!fdd.item19?.hasItem19) {
    reasons.push("No Item 19 financial performance representation — earnings are undisclosed, which is itself a caution.");
    points += 1;
  }

  // ---- contextual escalation: capital intensity + operational tripwires ----
  // Previously ignored — which is how a $3M capital gap or a stack of HIGH
  // tripwires could still score "Low." Both now feed the risk level.
  const liquid = buyer?.liquidCapital ?? null;
  const capitalGap =
    buildoutMidpoint != null && liquid != null
      ? Math.max(0, buildoutMidpoint - liquid)
      : null;
  const gapRatio =
    capitalGap != null && liquid && liquid > 0 ? capitalGap / liquid : null;
  if (gapRatio != null && capitalGap != null) {
    const gapStr = `$${Math.round(capitalGap).toLocaleString()}`;
    if (gapRatio >= RUBRIC.capitalGapExtremeRatio) {
      points += 3;
      reasons.push(
        `Capital gap of ${gapStr} is ~${gapRatio.toFixed(0)}x your liquid — extreme leverage; the deal rests almost entirely on outside capital.`,
      );
    } else if (gapRatio >= RUBRIC.capitalGapHighRatio) {
      points += 2;
      reasons.push(`Capital gap of ${gapStr} is ~${gapRatio.toFixed(1)}x your liquid — heavy reliance on outside financing.`);
    } else if (gapRatio >= RUBRIC.capitalGapModerateRatio) {
      points += 1;
      reasons.push(`Capital gap of ${gapStr} is ~${gapRatio.toFixed(1)}x your liquid — meaningful outside financing required.`);
    }
  }

  // Financial condition is now its own dedicated signal (the FinCon card), and
  // the report display drops it from the tripwire list. Exclude it here too, so
  // this count — and the "see the tripwires section" bullet — matches what the
  // reader actually sees, and the boilerplate financial-condition risk (which
  // over-fires) no longer double-counts against the score.
  const highTripwires = (fdd.operationalRisks ?? []).filter(
    (r) => r.severity === "high" && !/financial condition/i.test(r.title),
  ).length;
  // HIGH operational tripwires are existential/major disclosed risks — immediate
  // termination, mandatory mid-term capital calls, unilateral revenue cuts. The
  // old rubric let three of them contribute just +1 (which alone maps to "Low"),
  // so a stack of severe disclosed risks could be erased by a clean-looking
  // economic model. Beyond adding points we now FLOOR the level (applied after the
  // points→level map below) — a franchise that can be terminated overnight is not
  // low-risk no matter how the pro forma pencils.
  let tripwireFloor: ScoringResult["riskLevel"] | null = null;
  if (highTripwires >= RUBRIC.manyHighTripwires) {
    points += 3;
    tripwireFloor = "High";
    reasons.push(`${highTripwires} high-severity operational tripwires disclosed — see the tripwires section.`);
  } else if (highTripwires >= RUBRIC.someHighTripwires) {
    points += 2;
    tripwireFloor = "Medium";
    reasons.push(`${highTripwires} high-severity operational tripwires disclosed — see the tripwires section.`);
  } else if (highTripwires >= 1) {
    points += 1;
    reasons.push("A high-severity operational tripwire is disclosed — see the tripwires section.");
  }

  // Franchisor financial distress — judged from the FIGURES, not the boilerplate
  // "Special Risks" financial-condition flag (which over-fires on routine
  // disclosure; UPS trips that flag but its statements are fine). Going-concern
  // doubt or a negative net worth means the franchisor's ability to support the
  // system is genuinely in question, so it both scores and floors the level.
  const fc = fdd.financialCondition;
  const negativeNetWorth = (fc?.years ?? []).some(
    (y) => y?.netWorth != null && y.netWorth < 0,
  );
  let finconFloor: ScoringResult["riskLevel"] | null = null;
  if (fc?.goingConcernRaised || negativeNetWorth) {
    points += 2;
    finconFloor = "Medium";
    reasons.push(
      `Franchisor financial distress disclosed (${
        fc?.goingConcernRaised ? "going-concern doubt" : "negative net worth"
      }) — confirm its ability to support the system against the audited statements.`,
    );
  }

  // ---- map points → level ----
  let riskLevel: ScoringResult["riskLevel"] = "Low";
  if (points >= 4) riskLevel = "High";
  else if (points >= 2) riskLevel = "Medium";

  // ---- hard floors: a serious DISCLOSED risk cannot be overridden by a clean
  // economic model. Raise (never lower) the level to any floor that was set. ----
  const levelOrder = { Low: 0, Medium: 1, High: 2 } as const;
  const floorTo = (lvl: ScoringResult["riskLevel"]) => {
    if (levelOrder[lvl] > levelOrder[riskLevel]) riskLevel = lvl;
  };
  if (tripwireFloor) floorTo(tripwireFloor);
  if (finconFloor) floorTo(finconFloor);

  // ---- "couldn't assess" floor: absence of data is NOT absence of risk ----
  // If no pro forma could be built (company/affiliate-owned only, or no FPR),
  // never report "Low" — the economics are unverified, not safe.
  if (midCohort == null) {
    reasons.push(
      "Franchisee unit economics could not be scored — no usable Item 19 (company/affiliate-owned only, or no FPR). Treat this as UNVERIFIED, not low-risk.",
    );
    if (riskLevel === "Low") riskLevel = "Medium";
    item19Unusable ??= {
      reason:
        "No franchisee revenue figure could be read from Item 19 — this filing publishes company or affiliate results only, or no financial performance representation at all.",
      whatToAsk:
        "Ask the franchisor why no franchisee FPR is published, and go straight to the Item 20 roster. A franchisor that will not put franchisee revenue in writing has told you something.",
    };
  }

  if (reasons.length === 0) {
    reasons.push("Economics were assessable and no major stress flags triggered.");
  }

  return {
    riskLevel,
    riskReasons: reasons,
    midCohort,
    bottomCohort,
    buildoutMidpoint,
    assumedLoan,
    assumedMonthlyDebtService: assumedDebt,
    dscr,
    rentPctOfRevenue,
    paybackYears,
    variableRate,
    fixedMonthly,
    rentResolution: rentRes ?? null,
    fixedFeesMonthly: flatFees,
    ...(item19Unusable ? { item19Unusable } : {}),
    notes,
  };
}
