/**
 * underwriting.ts
 * The "killer feature": join the BUYER's balance sheet to the FDD's reality.
 * Fully deterministic — built from the extracted facts + the scoring output.
 * The assessment string is assembled from the computed numbers (not generated
 * by the LLM), so it can't hallucinate about someone's money.
 */

import { ExtractedFDD } from "./schema";
import { ScoringResult, RUBRIC, amortize } from "./scoring";

export interface BuyerContext {
  liquidCapital: number;
  netWorth: number;
}

export interface UnderwritingResult {
  capitalGap: number | null; // buildout midpoint - liquid capital
  sbaLoanRequired: boolean;
  recommendedLoan: number | null;
  meetsNetWorthRequirement: boolean | null;
  meetsLiquidRequirement: boolean | null;
  adjustedMonthlyDebtService: number | null;
  adjustedMonthlyNetCashFlow: number | null; // mid-cohort EBITDA - adjusted debt
  survivesBottomCohort: boolean | null;
  assessment: string;
}

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function underwrite(
  fdd: ExtractedFDD,
  scoring: ScoringResult,
  buyer: BuyerContext,
): UnderwritingResult {
  const buildout = scoring.buildoutMidpoint;
  const capitalGap = buildout != null ? Math.max(0, buildout - buyer.liquidCapital) : null;
  const sbaLoanRequired = capitalGap != null ? capitalGap > 0 : false;
  const recommendedLoan = capitalGap; // finance the gap

  const meetsNetWorthRequirement =
    fdd.requiredNetWorth != null ? buyer.netWorth >= fdd.requiredNetWorth : null;
  const meetsLiquidRequirement =
    fdd.requiredLiquidCapital != null ? buyer.liquidCapital >= fdd.requiredLiquidCapital : null;

  const adjustedDebt =
    recommendedLoan != null
      ? amortize(recommendedLoan, RUBRIC.defaultSbaRate, RUBRIC.defaultSbaTermYears)
      : null;
  const adjustedNet =
    scoring.midCohort && adjustedDebt != null ? scoring.midCohort.monthlyEbitda - adjustedDebt : null;

  const survivesBottomCohort = scoring.bottomCohort ? scoring.bottomCohort.coversCosts : null;

  // ---- assemble a factual, harsh-but-objective assessment from the numbers ----
  const parts: string[] = [];

  if (buildout != null) {
    if (capitalGap != null && capitalGap > 0) {
      parts.push(
        `With ${usd(buyer.liquidCapital)} liquid against a ${usd(buildout)} mid-point build-out, there is a ${usd(
          capitalGap,
        )} capital gap. An SBA loan or an equity partner is required to do this deal.`,
      );
    } else {
      parts.push(
        `${usd(buyer.liquidCapital)} liquid covers the ${usd(buildout)} mid-point build-out without financing, though that leaves little working-capital cushion.`,
      );
    }
  } else {
    parts.push("Item 17 investment range was not found, so the capital gap cannot be computed from this document.");
  }

  if (meetsNetWorthRequirement === false && fdd.requiredNetWorth != null) {
    parts.push(
      `Net worth of ${usd(buyer.netWorth)} is below the franchisor's stated requirement of ${usd(
        fdd.requiredNetWorth,
      )} — this buyer may not qualify.`,
    );
  }

  if (adjustedNet != null) {
    if (adjustedNet < 0) {
      parts.push(
        `At mid-cohort revenue, monthly cash flow after debt service is negative (${usd(
          adjustedNet,
        )}/mo) before payroll — this deal does not cash-flow at the typical performance tier.`,
      );
    } else {
      parts.push(
        `At mid-cohort revenue, modeled cash flow after debt service is about ${usd(
          adjustedNet,
        )}/mo before payroll and maintenance — a thin margin of error.`,
      );
    }
  }

  if (survivesBottomCohort === false) {
    parts.push(
      "If this location lands in the bottom cohort, it does not cover operating costs before debt — meaning default risk within the first year.",
    );
  }

  if (parts.length === 0) {
    parts.push("Insufficient extracted data to underwrite this deal against the buyer profile.");
  }

  return {
    capitalGap,
    sbaLoanRequired,
    recommendedLoan,
    meetsNetWorthRequirement,
    meetsLiquidRequirement,
    adjustedMonthlyDebtService: adjustedDebt,
    adjustedMonthlyNetCashFlow: adjustedNet,
    survivesBottomCohort,
    assessment: parts.join(" "),
  };
}
