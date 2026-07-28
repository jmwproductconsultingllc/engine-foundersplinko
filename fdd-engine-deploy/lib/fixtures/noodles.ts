/**
 * lib/fixtures/noodles.ts — Noodles & Company, FDD issued April 20, 2026.
 *
 * Every figure below is DISCLOSED in the FDD. Page references are the FDD's own
 * internal numbering (add 9 for the PDF page). This fixture exists because
 * Noodles is the rare brand that discloses its full unit-level cost structure —
 * which makes it the cleanest possible proof that the ladder is right and that
 * reading rung 5 as EBITDA is wrong.
 */
import type { LadderInput } from "../ladder";

/** Item 19, p.76 — blended Company + Franchise average Net Sales, FY2025 (52 wks ended 12/30/2025) */
export const NOODLES_ANNUAL_NET_SALES_BLENDED = 1_352_345;

export const NOODLES_LADDER_INPUT: LadderInput = {
  monthlyRevenue: Math.round(NOODLES_ANNUAL_NET_SALES_BLENDED / 12), // 112,695
  revenueLabel: "Network average, all units",
  revenueSource:
    "Item 19, p.76 — average Net Sales of $1,352,345 across 463 Company and Franchise restaurants open the full 52 weeks ended 12/30/2025",
  revenueOwnership: "mixed",

  // Item 6, pp.10-11. All four are percentage-of-sales fees a franchisee pays.
  feePcts: [
    { label: "Royalty", pct: 5.0 },
    { label: "Brand Development Fund", pct: 1.75 },
    { label: "Field Marketing Fund", pct: 1.0 },
    { label: "Marketing Administration Fee", pct: 1.25 },
  ],
  // Item 6, p.11 — Restaurant Technology Support.
  fixedFees: [{ label: "Restaurant Technology Support", monthly: 1_000 }],

  // Item 19, p.78 — Occupancy Cost 9.3% of Net Sales ($129,543/yr avg).
  rentMonthly: Math.round((NOODLES_ANNUAL_NET_SALES_BLENDED * 0.093) / 12), // 10,481
  rentBasis: "disclosed",
  rentSource:
    "Item 19, p.78 — Occupancy Cost averaged 9.3% of Net Sales ($129,543/yr) across 371 company restaurants; includes base rent, percentage rent, CAM and real estate taxes",

  // Item 19, p.78 — the full company-unit P&L, as disclosed.
  costs: {
    cogsPct: [26.4, 26.4],
    laborPct: [31.8, 31.8],
    // Controllable Expenses 14.3% + Non-Controllable Expenses 6.3%
    otherOpexPct: [20.6, 20.6],
    occupancyPct: [8, 12],
    basis: "disclosed",
    source:
      "Item 19, p.78 — Cost of Sales 26.4%, Labor 31.8%, Controllable Expenses 14.3%, Non-Controllable Expenses 6.3%, averaged across 371 company-operated restaurants",
    note:
      "These are company-operated results. Company restaurants pay no royalty and no marketing fees, which is why those are subtracted separately at rung 2.",
  },

  // Item 7, p.18 — total estimated initial investment $1,061,500 to $1,707,500.
  buildoutMidpoint: (1_061_500 + 1_707_500) / 2, // 1,384,500

  financing: { loan: 1_209_500, ratePct: 10.5, termYears: 10 },
};

/**
 * Item 19, p.76 — the highest Net Sales reported by any single restaurant among
 * the 463 Company and Franchise restaurants open the full 52 weeks ended 12/30/2025.
 * Used as the ceiling when testing whether sales performance alone can carry a loan.
 */
export const NOODLES_SYSTEM_HIGH_ANNUAL = 2_698_058;
