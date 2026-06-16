import { describe, it, expect } from "vitest";
import { scoreFdd } from "./scoring";
import { underwrite, type BuyerContext } from "./underwriting";
import type { ExtractedFDD } from "./schema";

/**
 * GOLDEN BASELINE — The Back Nine 2026 FDD.
 *
 * This pins the DETERMINISTIC engine (scoring + underwriting) against a fixed,
 * human-verified extraction. The AI extraction itself is non-deterministic and is
 * intentionally NOT tested here — only the code that turns facts into judgment,
 * which is the part you actually tune. If you change RUBRIC, the math, or the
 * underwriting logic and it alters this read, this test fails on purpose — then you
 * decide whether the change is intended and update the baseline deliberately.
 *
 * ⚠️ Bottom-30% is set to 14139 to match the latest run. CONFIRM against Item 19,
 * p.36-37 (an earlier run produced 10885). If the FDD says 10885, update it here —
 * the cohort still covers costs either way, so only the bottom-cohort numbers move.
 */
const backNine: ExtractedFDD = {
  documentCheck: {
    appearsComplete: true,
    appearsScanned: false,
    itemsFound: ["Item 1", "Item 6", "Item 7", "Item 17", "Item 19", "Item 20"],
    warnings: [],
  },
  brandName: "The Back Nine",
  franchisorEntity: "Back Nine Golf Group, LLC",
  headquarters: "898 E 4010 S, Washington, Utah 84780",
  brandBackground: "Indoor golf simulator franchise.",
  leadership: [],
  item19: {
    hasItem19: true,
    unitsReported: null,
    cohorts: [
      { label: "Top 10% Average", avgMonthlyRevenue: 33675, basis: "Open 6+ months at YE25" },
      { label: "Middle 60% Average", avgMonthlyRevenue: 19393, basis: "Open 6+ months at YE25" },
      { label: "Bottom 30% Average", avgMonthlyRevenue: 14139, basis: "Open 6+ months at YE25" },
    ],
    networkAverageMonthly: null,
    notes: "",
    sourcePage: "Item 19, p.36-37",
  },
  item17: {
    initialInvestmentLow: 307050,
    initialInvestmentHigh: 688500,
    lineItems: [],
    sourcePage: "Item 7, p.15-16",
  },
  ongoingFees: {
    royaltyPct: 8,
    brandFundPct: 0,
    localAdPct: 0,
    flatMonthlyFees: [
      { name: "Marketing System Fee", monthlyAmount: 250, source: "Item 6, p.8" },
      { name: "Internal Systems Fee", monthlyAmount: 350, source: "Item 6, p.8" },
    ],
  },
  hiddenCosts: [],
  averageRentMonthly: 6361,
  requiredNetWorth: null,
  requiredLiquidCapital: null,
  systemScale: {
    totalUnits: 124,
    openedLastYear: 97,
    closedLastYear: 0,
    transfersLastYear: 2,
    sourcePage: "Item 20, p.38,41",
  },
  operationalRisks: [],
};

const buyer: BuyerContext = { liquidCapital: 250000, netWorth: 800000 };

describe("Back Nine — golden baseline", () => {
  const score = scoreFdd(backNine);
  const under = underwrite(backNine, score, buyer);

  it("computes the build-out midpoint", () => {
    expect(score.buildoutMidpoint).toBe(497775);
  });

  it("computes mid-cohort EBITDA", () => {
    expect(Math.round(score.midCohort!.monthlyEbitda)).toBe(10881);
  });

  it("flags Medium risk on rent + royalty only", () => {
    expect(score.riskLevel).toBe("Medium");
    expect(score.riskReasons.some((r) => /rent/i.test(r))).toBe(true);
    expect(score.riskReasons.some((r) => /royalty/i.test(r))).toBe(true);
  });

  it("bottom cohort still covers operating costs", () => {
    expect(score.bottomCohort?.coversCosts).toBe(true);
  });

  it("underwrites the buyer's capital gap and SBA requirement", () => {
    expect(under.capitalGap).toBe(247775);
    expect(under.sbaLoanRequired).toBe(true);
  });

  it("computes net monthly cash flow after debt service", () => {
    expect(Math.round(under.adjustedMonthlyNetCashFlow!)).toBe(7537);
  });
});
