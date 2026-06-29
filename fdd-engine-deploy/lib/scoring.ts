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

export interface CohortEconomics {
  label: string;
  monthlyRevenue: number;
  monthlyVariable: number;
  monthlyFixed: number;
  monthlyEbitda: number; // excludes payroll + debt service
  annualEbitda: number;
  coversCosts: boolean;
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

function findCohort(cohorts: Item19Cohort[], keys: string[]): Item19Cohort | null {
  const lower = (s: string) => s.toLowerCase();
  for (const c of cohorts) {
    const l = lower(c.label);
    if (keys.some((k) => l.includes(k))) return c;
  }
  return null;
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

  // ---- variable rate (royalty + brand fund + local ad), as a fraction ----
  const f = fdd.ongoingFees;
  const royalty = f.royaltyPct ?? 0;
  const brand = f.brandFundPct ?? 0;
  const localAd = f.localAdPct ?? 0;
  const variableRate = (royalty + brand + localAd) / 100;
  if (f.royaltyPct == null) notes.push("Royalty % not found; variable costs may be understated.");

  // ---- fixed monthly: flat fees + average rent ----
  // NOTE: we intentionally do NOT auto-sum hidden/contingent costs (step-in
  // fees, ACH penalties) — they're situational. They surface as flags instead.
  const flatFees = (f.flatMonthlyFees || []).reduce((s, x) => s + (x.monthlyAmount ?? 0), 0);
  const rent = fdd.averageRentMonthly ?? 0;
  if (fdd.averageRentMonthly == null) notes.push("Average rent not found; fixed costs may be understated.");
  const fixedMonthly = flatFees + rent;

  // ---- cohorts ----
  const cohorts = fdd.item19?.cohorts ?? [];
  let midRaw =
    findCohort(cohorts, ["middle", "mid", "60", "median", "2nd", "second"]) ?? null;
  const bottomRaw = findCohort(cohorts, ["bottom", "30", "lowest", "4th", "fourth"]) ?? null;

  let midRevenue =
    midRaw?.avgMonthlyRevenue ?? fdd.item19?.networkAverageMonthly ?? null;

  // P1 — LEAD WITH THE FRANCHISED COHORT. When the percentile-tier search finds
  // nothing (e.g. an FDD that reports Company vs Franchised instead of tiers,
  // like Five Iron), build the pro forma off the FRANCHISED operating figure —
  // never company/affiliate-owned (which runs ~2x higher) and never pre-sale.
  if (midRevenue == null) {
    const franchised = cohorts.find(
      (c) =>
        c.avgMonthlyRevenue != null &&
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
      midRevenue = franchised.avgMonthlyRevenue;
      if (franchised.sampleSize != null && franchised.sampleSize <= 5) {
        reasons.push(
          `Pro forma is built on only ${franchised.sampleSize} franchised location${
            franchised.sampleSize === 1 ? "" : "s"
          } — a very thin sample; treat the modeled franchisee economics as low-confidence.`,
        );
      }
    }
  }

  const bottomRevenue = bottomRaw?.avgMonthlyRevenue ?? null;

  let midCohort: CohortEconomics | null = null;
  let bottomCohort: CohortEconomics | null = null;

  if (midRevenue != null) {
    midCohort = buildCohort(
      midRaw?.label ?? "Network Average",
      midRevenue,
      variableRate,
      fixedMonthly,
    );
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
    reasons.push(
      `Debt-service coverage is thin: mid-cohort DSCR ≈ ${dscr.toFixed(2)} (below ${RUBRIC.dscrStress}).`,
    );
  }
  if (bottomCohort && !bottomCohort.coversCosts) {
    points += 2;
    reasons.push(
      `Bottom cohort (~$${Math.round(bottomCohort.monthlyRevenue).toLocaleString()}/mo) does not cover operating costs before debt — a slow ramp risks early default.`,
    );
  }
  if (rentPctOfRevenue != null && rentPctOfRevenue > RUBRIC.rentPctStress) {
    points += 1;
    reasons.push(
      `Rent is heavy: ~${Math.round(rentPctOfRevenue * 100)}% of mid-cohort revenue (above ${Math.round(
        RUBRIC.rentPctStress * 100,
      )}%).`,
    );
  }
  if (paybackYears != null && paybackYears > RUBRIC.paybackYearsStress) {
    points += 1;
    reasons.push(`Long payback: ~${paybackYears.toFixed(1)} years on the build-out before financing.`);
  }
  if (royalty > RUBRIC.highRoyaltyPct) {
    points += 1;
    reasons.push(`Above-market royalty at ${royalty}%.`);
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
    notes,
  };
}
