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

export function scoreFdd(fdd: ExtractedFDD): ScoringResult {
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
  const midRaw =
    findCohort(cohorts, ["middle", "mid", "60", "median", "2nd", "second"]) ?? null;
  const bottomRaw = findCohort(cohorts, ["bottom", "30", "lowest", "4th", "fourth"]) ?? null;

  const midRevenue =
    midRaw?.avgMonthlyRevenue ?? fdd.item19?.networkAverageMonthly ?? null;
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

  let riskLevel: ScoringResult["riskLevel"] = "Low";
  if (points >= 4) riskLevel = "High";
  else if (points >= 2) riskLevel = "Medium";

  if (reasons.length === 0) {
    reasons.push("No major stress flags triggered on the available data.");
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
