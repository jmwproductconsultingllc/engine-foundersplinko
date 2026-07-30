/**
 * reportShell.fixture.ts
 *
 * The Crumbl report (13b0d65a-6c40-4b68-b77a-6df430745fe7) transcribed into
 * ReportSource. Two jobs:
 *
 *   1. It is the leak test's adversary — every figure in here is a real
 *      derived figure, and none of them may appear in the built shell.
 *   2. It is the worked example for the adapter. When the build thread wires
 *      reportSourceFromComputed(), this is the shape it must produce.
 *
 * Figures are the real ones from the live report. This file is server-side and
 * test-only. It must never be imported by a client component.
 */

import type { ReportSource } from "./reportShell";

export const CRUMBL_SOURCE: ReportSource = {
  brandSlug: "crumbl",
  brandName: "Crumbl",
  ladderRungs: 13,
  capitalRange: [848566, 1472533],

  badges: [
    { label: "1 document warning", severity: "medium" },
    { label: "3 things to verify", severity: "medium" },
    { label: "Franchisor financials: high concern", severity: "high" },
  ],

  sections: [
    {
      id: "what-it-costs",
      title: "What it costs to open",
      anchor: "What it costs",
      blurb: "Item 7, as the franchisor states it. Twelve line items.",
      figures: [
        { label: "Initial franchise fee", value: 50000, unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Real estate and improvements", value: [350000, 700000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Equipment", value: [180000, 300000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Furniture and fixtures", value: [45000, 90000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Signage", value: [15000, 40000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Opening inventory", value: [12000, 25000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Training expenses", value: [4000, 15000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Professional fees", value: [5000, 15000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Insurance", value: [3500, 9000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Licenses and permits", value: [2500, 8000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Grand opening advertising", value: [10000, 20000], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Additional funds, 3 months", value: [171066, 200533], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" } },
        { label: "Total investment", value: [848566, 1472533], unit: "usd", provenance: "disclosed", citation: { item: 7, page: "28-30" }, lockId: "what-it-costs.total" },
      ],
    },

    {
      id: "buyer-fit",
      title: "Buyer-fit underwriting",
      anchor: "Buyer fit",
      blurb: "What the deal asks of you, against what you told us you have.",
      figures: [
        { label: "Capital gap", value: 1160550, unit: "usd", provenance: "derived", lockId: "buyer-fit.gap" },
        { label: "Loan needed", value: 1, unit: "text", provenance: "derived" },
        { label: "Net worth requirement", value: null, unit: "usd", provenance: "disclosed", citation: { item: 5 } },
        { label: "Margin after fees, rent and debt", value: 58313, unit: "usd_year", provenance: "derived" },
      ],
    },

    {
      id: "cash-ladder",
      title: "The cash ladder",
      anchor: "Cash ladder",
      blurb:
        "Thirteen rungs, monthly, from disclosed revenue down to what the operator actually keeps. Every rung is labelled with where its number came from.",
      figures: [
        { label: "1. Gross revenue", value: 91089, unit: "usd_month", provenance: "disclosed", citation: { item: 19, page: "70" } },
        { label: "2. Less franchise fees (royalty and brand fund)", value: 9109, unit: "usd_month", provenance: "disclosed", citation: { item: 6 } },
        { label: "3. Less fixed monthly fees", value: 720, unit: "usd_month", provenance: "disclosed", citation: { item: 6 } },
        { label: "4. Less rent and occupancy", value: 7287, unit: "usd_month", provenance: "benchmark", isMethodBand: true },
        {
          label: "5. Margin after fees and rent",
          value: 73973,
          unit: "usd_month",
          provenance: "benchmark",
          note: "Not profit. Cost of goods, labor and operating costs have not been subtracted yet.",
        },
        { label: "6. Less cost of goods", value: [25505, 30059], unit: "usd_month", provenance: "benchmark", isMethodBand: true },
        { label: "7. Less labor", value: [20040, 25505], unit: "usd_month", provenance: "benchmark", isMethodBand: true },
        { label: "8. Less other operating costs", value: [5465, 9109], unit: "usd_month", provenance: "benchmark", isMethodBand: true },
        {
          label: "9. Operating EBITDA",
          value: [9300, 22963],
          unit: "usd_month",
          provenance: "benchmark",
          note: "Before debt service, owner compensation, depreciation and taxes.",
        },
        { label: "10. Less debt service", value: 15660, unit: "usd_month", provenance: "derived" },
        {
          label: "11. Cash after debt, before owner draw",
          value: [-6360, 7303],
          unit: "usd_month",
          provenance: "derived",
          note: "The operator has not been paid out of this yet.",
          lockId: "cash-ladder.cash-after-debt",
        },
        {
          label: "12. Debt-service coverage ratio",
          value: [0.59, 1.47],
          unit: "ratio",
          provenance: "derived",
          note: "Lenders typically want 1.25 or better: $1.25 of operating profit for every $1.00 of loan payment.",
        },
        {
          label: "13. Years to recover the build-out",
          value: [4.2, 10.4],
          unit: "years",
          provenance: "derived",
          note: "Recovery of the build-out only. It does not include the operator's own time.",
        },
      ],
    },

    {
      id: "financing",
      title: "How you pay for it",
      anchor: "Financing",
      blurb: "The loan this unit would need, and whether the unit can carry it.",
      figures: [
        { label: "Loan amount", value: 1160550, unit: "usd", provenance: "derived" },
        { label: "Rate", value: 10.5, unit: "pct", provenance: "benchmark" },
        { label: "Term", value: 10, unit: "years", provenance: "benchmark" },
        { label: "Monthly payment", value: 15660, unit: "usd_month", provenance: "derived" },
        { label: "Cash you put in", value: 0, unit: "usd", provenance: "derived" },
        { label: "Cash after debt", value: [-6360, 7303], unit: "usd_month", provenance: "derived" },
        { label: "Return on your cash", value: null, unit: "pct", provenance: "derived" },
        { label: "Debt-service coverage ratio", value: [0.59, 1.47], unit: "ratio", provenance: "derived" },
        { label: "What this unit could support", value: 1361426, unit: "usd", provenance: "derived" },
      ],
    },

    {
      id: "ongoing-fees",
      title: "Ongoing fees and hidden costs",
      anchor: "Fees",
      blurb: "Fourteen separate charges in the agreement. Most buyers find four.",
      figures: [
        { label: "Royalty", value: 8, unit: "pct", provenance: "disclosed", citation: { item: 6 } },
        { label: "Brand fund", value: 2, unit: "pct", provenance: "disclosed", citation: { item: 6 } },
        { label: "Local advertising", value: 0, unit: "pct", provenance: "disclosed", citation: { item: 6 } },
        { label: "Technology fee", value: 650, unit: "usd_month", provenance: "disclosed", citation: { item: 6 } },
        { label: "Bookkeeping software", value: 70, unit: "usd_month", provenance: "disclosed", citation: { item: 6 } },
        { label: "Transaction processing", value: [2.4, 4], unit: "pct", provenance: "disclosed", citation: { item: 6 } },
        { label: "Co-op advertising", value: [1, 2], unit: "pct", provenance: "disclosed", citation: { item: 6 } },
        { label: "Billing and inspection", value: [5, 15], unit: "pct", provenance: "disclosed", citation: { item: 6 } },
        { label: "Transfer fee", value: 10000, unit: "usd", provenance: "disclosed", citation: { item: 6 } },
        { label: "Successor fee", value: 2500, unit: "usd", provenance: "disclosed", citation: { item: 6 } },
        { label: "Relocation fee", value: 2500, unit: "usd", provenance: "disclosed", citation: { item: 6 } },
        { label: "Gift card administration", value: [5, 15], unit: "pct", provenance: "disclosed", citation: { item: 6 } },
        { label: "Training, per person", value: 4000, unit: "usd", provenance: "disclosed", citation: { item: 6 } },
        { label: "Supplier evaluation", value: 2000, unit: "usd", provenance: "disclosed", citation: { item: 6 } },
        { label: "Operating balance covenant", value: 30000, unit: "usd", provenance: "disclosed", citation: { item: 6 } },
      ],
    },

    {
      id: "item-19",
      title: "What units actually make",
      anchor: "Item 19",
      blurb: "The franchisor's own numbers, and how wide the spread really is.",
      figures: [
        { label: "Franchised average", value: 94930, unit: "usd_month", provenance: "disclosed", citation: { item: 19, page: "70" } },
        { label: "Median", value: 91089, unit: "usd_month", provenance: "disclosed", citation: { item: 19, page: "70" } },
        { label: "High", value: 285147, unit: "usd_month", provenance: "disclosed", citation: { item: 19, page: "70" } },
        { label: "Low", value: 30427, unit: "usd_month", provenance: "disclosed", citation: { item: 19, page: "70" } },
        { label: "Spread, high to low", value: 9.4, unit: "multiple", provenance: "derived" },
        { label: "Units that met or beat the average", value: 45, unit: "pct", provenance: "derived" },
      ],
    },

    {
      id: "document-check",
      title: "What we found in the document",
      anchor: "Document",
      blurb: "Thirteen Items located and parsed. Every figure above cites one of them.",
      freeChips: [
        "Item 1", "Item 2", "Item 3", "Item 5", "Item 6", "Item 7",
        "Item 8", "Item 11", "Item 12", "Item 17", "Item 19", "Item 20", "Item 21",
      ],
      figures: [],
    },

    {
      id: "to-verify",
      title: "Before you commit",
      anchor: "To verify",
      blurb: "Three things this document cannot settle, and how to settle them.",
      freeChips: ["The fee stack", "Operational tripwires", "Franchisor financial condition"],
      figures: [],
      maskedRows: 3,
    },

    {
      id: "financial-condition",
      title: "Franchisor financial condition",
      blurb: "Six findings from the audited statements. Four of them are downside.",
      severityCounts: { high: 1 },
      figures: [],
      maskedRows: 6,
    },

    {
      id: "tripwires",
      title: "Operational tripwires",
      blurb: "Eight clauses that change what you signed up for. Two are rated high.",
      severityCounts: { high: 2, medium: 5, low: 1 },
      figures: [],
      maskedRows: 8,
    },

    {
      id: "system-scale",
      title: "System scale and turnover",
      anchor: "System at a glance",
      blurb: "Item 20, year-end.",
      figures: [
        { label: "Total units", value: 1101, unit: "count", provenance: "disclosed", citation: { item: 20 } },
        { label: "Opened", value: 52, unit: "count", provenance: "disclosed", citation: { item: 20 } },
        { label: "Closed", value: 9, unit: "count", provenance: "disclosed", citation: { item: 20 } },
        { label: "Changed hands", value: 82, unit: "count", provenance: "disclosed", citation: { item: 20 } },
        { label: "Owner turnover", value: 8.6, unit: "pct", provenance: "derived" },
      ],
    },

    {
      id: "who-to-call",
      title: "Who to call, and what to ask",
      blurb:
        "Fourteen questions, grouped for current operators, operators who left, and whoever answers.",
      freeChips: [
        "What do you actually run for cost of goods, as a percent of sales?",
      ],
      figures: [],
      maskedRows: 13,
    },

    {
      id: "leadership",
      title: "Who runs it",
      blurb: "Five executives, with tenure and prior operating history.",
      freeChips: [
        "Founder & CEO",
        "Founder & CBO",
        "Chief Technology Officer",
        "Chief Product Officer",
        "Chief Legal Officer",
      ],
      figures: [],
      maskedRows: 5,
    },
  ],
};
