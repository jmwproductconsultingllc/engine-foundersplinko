/**
 * lib/sampleReport.ts
 * The canonical SAMPLE report behind "See a sample report".
 *
 * One hand-authored, ANONYMIZED extraction (fictional brand, realistic numbers)
 * run through the REAL deterministic pipeline — scoreFdd → underwrite →
 * buildInsights → assessFinancialCondition — so the sample is an authentic engine
 * output, not faked figures, and it tracks the engine if scoring logic changes.
 *
 * The fixture is deliberately RICH (Item 19 franchised cohorts, full build-out,
 * fees + hidden costs, tripwires, leadership, audited financials) so the sample
 * exercises every surface of the report. The financials are a textbook
 * growth-stage profile — clean (unmodified) audit, growing revenue, but net
 * losses and a members' deficit — which lands the Financial Condition card on its
 * nuanced MEDIUM-with-context read rather than a false alarm.
 */

import type { ExtractedFDD } from "./schema";
import type { DiligenceResult } from "./types";
import { scoreFdd } from "./scoring";
import { underwrite, type BuyerContext } from "./underwriting";
import { buildInsights } from "./insights";
import { assessFinancialCondition } from "./financialCondition";

const SAMPLE_FDD: ExtractedFDD = {
  documentCheck: {
    appearsComplete: true,
    appearsScanned: false,
    itemsFound: ["Item 1", "Item 5", "Item 6", "Item 7", "Item 8", "Item 12", "Item 15", "Item 19", "Item 20", "Item 21"],
    warnings: [],
  },
  brandName: "Verde Bowls",
  franchisorEntity: "Verde Bowls Franchising, LLC",
  // CITY + STATE ONLY — deliberately no street address and no ZIP. This fixture
  // publishes a distress narrative (negative net worth, related-party funding)
  // about a named LLC; a real ZIP geocodes to real buildings and would attach
  // that narrative to whoever actually occupies them. The brand is fictional,
  // so the address must be too — city/state reads exactly as credible and
  // carries none of the risk. Do not add a street back.
  headquarters: "Austin, Texas",
  brandBackground:
    "Fast-casual restaurant serving build-your-own grain and salad bowls with locally-sourced ingredients, counter service, and a compact kitchen footprint.",
  leadership: [
    {
      name: "Maya Ellison",
      role: "Chief Executive Officer",
      background: "Co-founded the brand in 2016; previously led operations for a 60-unit regional fast-casual chain.",
      whyItMatters: "Sets growth strategy and how much weight goes to franchisee support versus new-unit sales.",
    },
    {
      name: "Daniel Cho",
      role: "Chief Financial Officer",
      background: "Joined in 2021 from a private-equity-backed restaurant group, where he ran unit-economics planning.",
      whyItMatters: "Owns capital planning and the audited financials you're underwriting here.",
    },
    {
      name: "Priya Nair",
      role: "Vice President, Franchise Development",
      background: "Leads franchise sales and onboarding since 2019; previously a multi-unit franchisee herself.",
      whyItMatters: "Your primary contact from awarding through opening — and the person selling you the deal.",
    },
  ],
  item19: {
    hasItem19: true,
    unitsReported: 41,
    cohorts: [
      {
        label: "Top 25% — Average",
        ownership: "franchised",
        sampleSize: 10,
        revenueType: "gross_sales",
        avgMonthlyRevenue: 61500,
        basis: "Franchised units open 12+ months at fiscal year-end",
      },
      {
        label: "Middle 50% — Average",
        ownership: "franchised",
        sampleSize: 21,
        revenueType: "gross_sales",
        avgMonthlyRevenue: 40800,
        basis: "Franchised units open 12+ months at fiscal year-end",
      },
      {
        label: "Bottom 25% — Average",
        ownership: "franchised",
        sampleSize: 10,
        revenueType: "gross_sales",
        avgMonthlyRevenue: 26900,
        basis: "Franchised units open 12+ months at fiscal year-end",
      },
    ],
    networkAverageMonthly: 42600,
    notes: "Figures are franchised units only; company-operated locations are excluded.",
    sourcePage: "Item 19, p.71",
  },
  item17: {
    // Line items sum EXACTLY to the low/high totals (340,000 / 720,000) — the
    // report shows both, and a fixture whose parts don't add up teaches the
    // reader to distrust the arithmetic everywhere else on the page.
    initialInvestmentLow: 340000,
    initialInvestmentHigh: 720000,
    lineItems: [
      { category: "Initial Franchise Fee", low: 35000, high: 35000, recurring: false, notes: "Single-unit." },
      { category: "Leasehold Improvements / Construction", low: 155000, high: 375000, recurring: false, notes: "Varies widely by market and condition." },
      { category: "Equipment", low: 62000, high: 108000, recurring: false, notes: "Kitchen line, refrigeration, hoods." },
      { category: "Furniture & Fixtures", low: 20000, high: 44000, recurring: false, notes: "" },
      { category: "Signage", low: 9000, high: 24000, recurring: false, notes: "" },
      { category: "Opening Inventory", low: 13000, high: 22000, recurring: false, notes: "" },
      { category: "POS & Technology", low: 7000, high: 16000, recurring: false, notes: "" },
      { category: "Grand Opening Marketing", low: 10000, high: 15000, recurring: false, notes: "" },
      { category: "Training Travel & Living", low: 3000, high: 8000, recurring: false, notes: "" },
      { category: "Additional Funds — 3 Months", low: 26000, high: 73000, recurring: false, notes: "Working capital before breakeven." },
    ],
    sourcePage: "Item 7, p.23",
  },
  ongoingFees: {
    royaltyPct: 7.5,
    brandFundPct: 2,
    localAdPct: 1,
    /*
     * THE SAMPLE'S RECORD IS COMPLETE, SO IT MUST SAY SO.
     *
     * resolvePercentageFees() shows an amber "this record predates the full
     * Item 6 fee capture" caveat whenever percentageFees is absent. That is
     * correct on a real brand extracted before the field existed. It is wrong
     * here: /sample is the page whose job is to show what the product does,
     * and a caveat conceding our own fee load may be understated is the last
     * thing a first-time reader should meet under the hero.
     *
     * The honest fix is not to suppress the caveat — it is to complete the
     * record. Verde Bowls is an invented disclosure, so this list IS the whole
     * of its percentage-of-sales fees, and its technology fee is deliberately
     * a FLAT $350/mo (see flatMonthlyFees below, rung 3) — which is the exact
     * hypothetical the caveat raises, answered two rungs down.
     *
     * These three lines restate royaltyPct/brandFundPct/localAdPct verbatim.
     * resolvePercentageFees dedupes the named slots against them, so the total
     * stays 10.5% and not one figure on the sample moves. Asserted in
     * components/CashLadder.test.tsx.
     */
    percentageFees: [
      { label: "Royalty", pct: 7.5, source: "Item 6, p.31" },
      { label: "Brand fund", pct: 2, source: "Item 6, p.31" },
      { label: "Local advertising", pct: 1, source: "Item 6, p.32" },
    ],
    flatMonthlyFees: [
      { name: "Technology & POS Fee", monthlyAmount: 350, source: "Item 6, p.32" },
      { name: "Supply Chain Access Fee", monthlyAmount: 200, source: "Item 6, p.33" },
    ],
  },
  hiddenCosts: [
    {
      name: "Mandatory Remodel",
      description: "A full refresh is required every 7 years at your expense; the prior cycle averaged $45,000–$85,000 per location.",
      estimatedAnnualAmount: null,
      source: "Item 6, p.34",
    },
    {
      name: "Transfer Fee",
      description: "Selling your franchise triggers a transfer fee equal to 50% of the then-current initial franchise fee, plus a training fee for the buyer.",
      estimatedAnnualAmount: null,
      source: "Item 17, p.66",
    },
  ],
  averageRentMonthly: 11200,
  rentDetail: {
    rawValue: 56,
    unit: "per_sqft_per_year",
    squareFootage: 2400,
    source: "Item 7, p.23 (estimated)",
  },
  requiredNetWorth: 500000,
  requiredLiquidCapital: 150000,
  systemScale: {
    totalUnits: 58,
    openedLastYear: 19,
    closedLastYear: 3,
    transfersLastYear: 2,
    sourcePage: "Item 20, p.74",
  },
  operationalRisks: [
    {
      title: "Personal Guarantee",
      description: "You and your spouse must personally guarantee all financial obligations under the franchise agreement.",
      severity: "high",
      source: "Item 15, p.59",
    },
    {
      title: "No Exclusive Territory",
      description: "The franchisor may operate or license other Verde Bowls units near yours, including company-owned locations.",
      severity: "medium",
      source: "Item 12, p.51",
    },
    {
      title: "Approved-Supplier Lock-In",
      description: "Core ingredients and packaging must be purchased from the franchisor or approved suppliers at prices it sets.",
      severity: "medium",
      source: "Item 8, p.44",
    },
  ],
  conceptType: "food_beverage_qsr",
  conceptRationale: "Fast-casual build-your-own bowls with counter service and a compact kitchen footprint.",
  staffingModel: "staffed",
  staffingRationale: "Counter-service line with prep and cook stations requires a moderate hourly team.",
  financialCondition: {
    specialRiskPresent: true,
    auditorName: "Hartwell & Boyd CPAs, P.C.",
    auditOpinion: "unmodified",
    goingConcernRaised: false,
    priorPeriodRestatement: false,
    parentName: null,
    parentGuaranteeOfPerformance: false,
    years: [
      {
        fiscalYearEnd: "2025-12-31",
        revenue: 8200000,
        netIncome: -1100000,
        totalAssets: 3100000,
        totalLiabilities: 5500000,
        cash: 600000,
        currentAssets: 1200000,
        currentLiabilities: 3800000,
        relatedPartyDebt: 2200000,
        deferredRevenue: 1900000,
        netWorth: -2400000,
      },
      {
        fiscalYearEnd: "2024-12-31",
        revenue: 5400000,
        netIncome: -1600000,
        totalAssets: 2400000,
        totalLiabilities: 3700000,
        cash: 450000,
        currentAssets: 900000,
        currentLiabilities: 2900000,
        relatedPartyDebt: 1800000,
        deferredRevenue: 1300000,
        netWorth: -1300000,
      },
      {
        fiscalYearEnd: "2023-12-31",
        revenue: 3100000,
        netIncome: -1400000,
        totalAssets: 1900000,
        totalLiabilities: 2600000,
        cash: 380000,
        currentAssets: 700000,
        currentLiabilities: 2100000,
        relatedPartyDebt: 1200000,
        deferredRevenue: 900000,
        netWorth: -700000,
      },
    ],
  },
};

// The buyer is deliberately set EXACTLY at the franchisor's own stated minimums
// (requiredLiquidCapital 150,000 / requiredNetWorth 500,000 is comfortably met).
// That is the whole lesson of the sample: you can clear every box the franchisor
// asks you to clear and still be carrying a ~2.5x capital gap. A buyer with
// 250k liquid hides that, and the showcase becomes the thin case.
const SAMPLE_BUYER: BuyerContext = { liquidCapital: 150000, netWorth: 600000 };

/** Build the full sample DiligenceResult through the real pipeline. Insights and
 *  Financial Condition are always included here so the sample shows the complete
 *  feature set regardless of the live feature toggles. */
export function getSampleResult(): DiligenceResult {
  const scoring = scoreFdd(SAMPLE_FDD, SAMPLE_BUYER);
  const underwriting = underwrite(SAMPLE_FDD, scoring, SAMPLE_BUYER);
  const insights = buildInsights(SAMPLE_FDD, scoring);
  const financialCondition = assessFinancialCondition(SAMPLE_FDD.financialCondition);
  return {
    extracted: SAMPLE_FDD,
    scoring,
    underwriting,
    buyer: SAMPLE_BUYER,
    insights,
    financialCondition,
  };
}
