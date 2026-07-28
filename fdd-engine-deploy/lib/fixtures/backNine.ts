/**
 * lib/fixtures/backNine.ts — The Back Nine (Back Nine Golf Group, LLC),
 * FDD issued March 6, 2026. Every figure traced to an Item and a page.
 *
 * WHY THIS FIXTURE EXISTS ALONGSIDE noodles.ts
 * --------------------------------------------
 * Noodles & Company is the best case: Item 19 discloses a full unit-level P&L,
 * so the ladder runs with usesBenchmark === false and every rung is exact.
 * The Back Nine is the ordinary case, and the one most FDDs look like: Item 19
 * discloses REVENUE AND RENT AND NOTHING ELSE. No cost of sales, no labor, no
 * operating costs. Rungs 6, 7 and 8 therefore rest on category ranges, and the
 * ladder returns a BAND rather than a number.
 *
 * That is not a defect in the model, it is the disclosure reality, and the two
 * fixtures together are how we prove the ladder behaves correctly in both.
 */
import type { LadderInput } from "../ladder";

/** Item 19, p.37 — Total Network Average monthly revenue, 2025, for the 45
 *  franchised outlets with 3+ simulator bays open 6+ months. */
export const B9_NETWORK_AVG_MONTHLY = 19_770;

/** Item 19, p.37 — Top 10% Average monthly revenue, 2025. */
export const B9_TOP10_MONTHLY = 33_675;

/** Item 19, p.37 — Bottom 30% Average monthly revenue, 2025. */
export const B9_BOTTOM30_MONTHLY = 10_885;

/** Item 19, p.37 — highest single unit's 2025 average month, of the 45 reporting
 *  outlets. The best OPERATOR in the system, on a full-year average basis. */
export const B9_SYSTEM_HIGH_ANNUAL = 34_867 * 12; // 418,404

/** Item 19, p.37 — Average Rent across the reporting units. Range $1,750–$14,865. */
export const B9_AVG_RENT_MONTHLY = 6_361;
export const B9_RENT_LOW_MONTHLY = 1_750;
export const B9_RENT_HIGH_MONTHLY = 14_865;

/** Item 7, p.15–16 — total estimated initial investment. */
export const B9_INVESTMENT_LOW = 307_050;
export const B9_INVESTMENT_HIGH = 688_500;

/**
 * Item 6, p.13 — Full Swing simulator software & maintenance is $2,000 per
 * simulator per year. Item 7 Note 4 sets the minimum at 3 simulators and prices
 * the high end of the equipment range at 5. We model 4 — the midpoint — and say
 * so on the page rather than burying it.
 */
export const B9_SIMULATORS_MODELED = 4;

export const BACK_NINE_LADDER_INPUT: LadderInput = {
  monthlyRevenue: B9_NETWORK_AVG_MONTHLY,
  revenueLabel: "Network average, franchised units",
  revenueSource:
    "Item 19, p.37 — Total Network Average of $19,770 per month across 45 franchised outlets with 3+ simulator bays open 6+ months, FY2025. Excludes 75 outlets open under 6 months and 4 outlets with fewer than 3 bays.",
  revenueOwnership: "franchised",

  // Item 6, pp.8–9 — the only percentage-of-revenue fees currently assessed.
  feePcts: [{ label: "Royalty", pct: 8.0 }],

  // Item 6, pp.8, 13 — flat monthly obligations.
  fixedFees: [
    { label: "Marketing System Fee (SQRD Media CRM)", monthly: 250 },
    { label: "Internal Systems Fee", monthly: 350 },
    {
      label: `Full Swing simulator software & maintenance (${B9_SIMULATORS_MODELED} bays)`,
      monthly: Math.round((2_000 * B9_SIMULATORS_MODELED) / 12),
    },
  ],

  // Item 19, p.37 — rent is DISCLOSED for this brand, which is unusual and is
  // the single most consequential number in the document.
  rentMonthly: B9_AVG_RENT_MONTHLY,
  rentBasis: "disclosed",
  rentSource:
    "Item 19, p.37 — Average Rent of $6,361 per month across the reporting units; lowest $1,750, highest $14,865. Base rent only as reported; CAM and real estate taxes are not broken out.",

  /**
   * BENCHMARK, not disclosure. Item 19 contains no cost or profit line of any
   * kind. These are the engine's curated ranges for an experiential /
   * entertainment venue (lib/insights.ts), plus the [6,10] other-operating
   * catch-all. The Back Nine is a 24-hour simulator, lesson and event concept
   * with no required kitchen or bar in Item 7's equipment schedule, so the
   * bar-forward band does not apply.
   */
  costs: {
    cogsPct: [8, 18],
    laborPct: [22, 30],
    otherOpexPct: [6, 10],
    occupancyPct: [10, 18],
    basis: "benchmark",
    source:
      "Category range (experiential / entertainment venue) — Item 19 of this FDD discloses no cost of sales, no labor and no operating expense line",
    note: "No franchisor is required to disclose the franchisee's cost structure, and this one does not. Every figure below rung 5 is therefore a range, and the range is wide because the disclosure is silent.",
  },

  // Item 7, p.16 — TOTAL $307,050 to $688,500.
  buildoutMidpoint: (B9_INVESTMENT_LOW + B9_INVESTMENT_HIGH) / 2, // 497,775

  financing: { loan: 497_775, ratePct: 10.5, termYears: 10 },
};
