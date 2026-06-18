/**
 * lib/insights.ts — "Franchise Edge · Insights"
 *
 * The judgment layer the FDD itself can't give you. An FDD discloses fees,
 * investment ranges, litigation, and sometimes Item 19 sales — it never
 * discloses the franchisee's operating cost structure (COGS, labor, utilities),
 * because those are the operator's reality, not a required disclosure. This
 * module supplies those as INDUSTRY BENCHMARK RANGES by concept type, plus a
 * cross-check against any margin the franchisor did disclose.
 *
 * Architecture (same as the rest of the engine): the AI only CLASSIFIES the
 * concept (fdd.conceptType). All numbers here are curated, code-side, and
 * deterministic — the model never invents a cost ratio.
 *
 * These are general planning benchmarks, NOT a projection of any specific
 * franchise's results. Calibrate against real franchisee P&Ls (Item 20).
 */

import { ExtractedFDD, ConceptType } from "./schema";
import { ScoringResult } from "./scoring";

export interface ConceptBenchmark {
  /** human-readable concept name */
  label: string;
  /** cost of goods as a % of revenue (low, high) */
  cogsPct: [number, number];
  /** labor as a % of revenue (low, high) */
  laborPct: [number, number];
  /** typical MATURE operating-EBITDA margin band, % (low, high) — used for the cross-check */
  operatingEbitdaPct: [number, number];
  /** the cost or metric that actually decides the deal in this category */
  dominantRisk: string;
  /** time-to-maturity reality (Item 19 averages are mature-unit numbers) */
  rampNote: string;
  /** what to budget for and verify — the "critical considerations given industry" */
  considerations: string[];
}

export interface InsightsResult {
  conceptType: ConceptType;
  conceptLabel: string;
  conceptRationale: string | null;
  benchmark: ConceptBenchmark;

  /** operating-EBITDA margin the franchisor actually disclosed in Item 19, if any */
  disclosedOperatingMarginPct: number | null;
  disclosedMarginSource: string | null;

  /** does the disclosed margin square with industry norms for this concept? */
  crossCheck: {
    status: "consistent" | "optimistic" | "conservative" | "no_disclosure";
    message: string;
  };

  /** the pro-forma cohort revenue we're contextualizing */
  proFormaRevenueMonthly: number | null;
  /** what the (relabeled) pro forma currently shows as margin after fees & rent */
  marginAfterFeesMonthly: number | null;
  /** benchmark-implied TRUE operating EBITDA on that revenue, $/mo (low, high) */
  benchmarkOperatingEbitdaMonthly: [number, number] | null;

  asOf: string;
  disclaimer: string;
}

/* ------------------------------------------------------------------ */
/* Curated benchmark library — ranges to calibrate, never point facts. */
/* Seed/refine these against real franchisee P&Ls (Back Nine actuals).  */
/* ------------------------------------------------------------------ */

const BENCHMARKS: Record<ConceptType, ConceptBenchmark> = {
  food_beverage_full_service: {
    label: "Full-service / bar-forward food & beverage",
    cogsPct: [28, 35],
    laborPct: [28, 35],
    operatingEbitdaPct: [8, 15],
    dominantRisk:
      "Prime cost (COGS + labor). The operator rule of thumb is prime cost under ~65% of sales; north of 70% the unit bleeds. This single number decides the deal.",
    rampNote: "3–9 months to a stable sales run-rate; the Item 19 average is a mature-unit number.",
    considerations: [
      "Budget COGS at 28–35% of sales and labor at 28–35% — combined prime cost should stay under ~65%. Neither line appears anywhere in an FDD.",
      "Ask Item 20 franchisees for actual food/beverage cost % and labor % at units open 18+ months.",
      "Confirm whether the Item 19 figure is gross sales (most common) or already nets some costs — it changes everything downstream.",
    ],
  },
  food_beverage_qsr: {
    label: "QSR / fast-casual",
    cogsPct: [28, 33],
    laborPct: [22, 28],
    operatingEbitdaPct: [10, 18],
    dominantRisk:
      "Prime cost and throughput per labor hour. Smaller footprint helps fixed costs, but COGS + labor still set the ceiling.",
    rampNote: "3–6 months to run-rate once open.",
    considerations: [
      "Budget COGS ~28–33% and labor ~22–28%; target prime cost under ~60%.",
      "Verify average ticket and daily transaction counts with Item 20 operators, not the franchisor.",
      "Watch for required remodels and equipment refresh cycles buried in Item 6/Item 11.",
    ],
  },
  experiential_entertainment: {
    label: "Experiential / entertainment venue",
    cogsPct: [8, 18],
    laborPct: [22, 30],
    operatingEbitdaPct: [12, 22],
    dominantRisk:
      "Fixed-cost coverage and utilization — big-box rent and equipment R&M against variable foot traffic. Slow weeks hurt more than COGS.",
    rampNote: "6–18 months to a mature traffic/booking base; year-one runs well under the Item 19 average.",
    considerations: [
      "COGS is modest; the real costs are labor (~22–30%), big-footprint rent, and equipment maintenance.",
      "Ask about utilization/occupancy rates and seasonality at Item 20 units — the model lives or dies on weekday/off-peak traffic.",
      "Confirm equipment R&M and replacement reserves; experiential gear wears and isn't in the pro forma.",
    ],
  },
  experiential_with_fb: {
    label: "Experiential entertainment with F&B attach (e.g. indoor golf + bar)",
    cogsPct: [15, 28],
    laborPct: [22, 30],
    operatingEbitdaPct: [15, 26],
    dominantRisk:
      "Blended margin. The bar/kitchen attach rate swings COGS up; the large footprint plus simulator/equipment R&M swing fixed costs. Owner-operator vs. absentee is a full GM salary either way.",
    rampNote: "6–18 months to a mature membership/booking base; the Item 19 average is NOT a year-one number.",
    considerations: [
      "Budget blended COGS ~15–28% (sim time and memberships carry little; the bar and kitchen drive it) and labor ~22–30%.",
      "Decide owner-operator vs. absentee before modeling — absentee adds a GM salary (~$60–90K/yr) the pro forma omits.",
      "Confirm the F&B attach rate and per-bay equipment costs (e.g. simulator licenses, R&M) at mature franchised units via Item 20.",
      "Assume a 6–18 month ramp; discount the Item 19 mature average for year one.",
    ],
  },
  fitness_studio: {
    label: "Boutique fitness / studio",
    cogsPct: [3, 10],
    laborPct: [20, 30],
    operatingEbitdaPct: [15, 28],
    dominantRisk:
      "Member retention/churn and fixed-cost coverage — NOT cost of goods. The deal is decided by recurring membership against rent and equipment lease.",
    rampNote: "9–18 months to a mature, retained member base.",
    considerations: [
      "COGS is trivial; the risks are member churn and covering fixed rent + equipment lease.",
      "Ask Item 20 operators for monthly retention, average membership lifetime, and break-even member count.",
      "Model CAC and free-trial conversion — member acquisition cost is the hidden operating line.",
    ],
  },
  health_wellness: {
    label: "Health & wellness (med-spa, IV, longevity, recovery)",
    cogsPct: [15, 25],
    laborPct: [25, 35],
    operatingEbitdaPct: [12, 25],
    dominantRisk:
      "Licensed clinical labor plus regulatory/insurance load and equipment depreciation. These concepts frequently disclose NO Item 19, so benchmarks matter most precisely where extraction gives you the least.",
    rampNote: "6–18 months to mature treatment-room utilization.",
    considerations: [
      "Product/consumables run ~15–25%; clinical/licensed labor is expensive at ~25–35%.",
      "Factor heavy equipment depreciation, malpractice/liability insurance, and regulatory compliance — none of it is in the FDD.",
      "With little or no Item 19, validate revenue per treatment room and ramp directly with Item 20 franchisees.",
    ],
  },
  retail_product: {
    label: "Retail / product",
    cogsPct: [45, 65],
    laborPct: [10, 18],
    operatingEbitdaPct: [5, 12],
    dominantRisk:
      "Gross margin on product (high COGS) and inventory turns. Thin margins amplify any sales miss.",
    rampNote: "3–12 months to run-rate depending on category.",
    considerations: [
      "Budget COGS at 45–65% of sales — product margin is the whole game here.",
      "Verify inventory turns and markdown/shrink rates with Item 20 operators.",
      "Confirm minimum inventory and required reorder commitments in Item 8/Item 11.",
    ],
  },
  home_trade_services: {
    label: "Home & trade services (mobile / low-overhead)",
    cogsPct: [25, 40],
    laborPct: [20, 35],
    operatingEbitdaPct: [10, 25],
    dominantRisk:
      "Crew utilization, callback/warranty cost, and customer-acquisition cost. Low fixed overhead, but CAC and scheduling efficiency decide profitability.",
    rampNote: "3–9 months to a steady job pipeline.",
    considerations: [
      "Budget materials/subcontractor COGS ~25–40% and field labor ~20–35%.",
      "CAC (lead cost per booked job) is the dominant hidden line — ask Item 20 operators what they actually spend per job.",
      "Confirm territory size, lead-generation expectations, and any required call-center/marketing fees.",
    ],
  },
  beauty_personal_care: {
    label: "Beauty / personal care",
    cogsPct: [8, 18],
    laborPct: [35, 50],
    operatingEbitdaPct: [8, 18],
    dominantRisk:
      "Commission/booth-rent labor and chair utilization. Labor structure dominates economics.",
    rampNote: "6–12 months to mature chair utilization.",
    considerations: [
      "Labor (commission or booth-rent) is the big line at ~35–50%; COGS on product is modest.",
      "Verify chair/room utilization and stylist retention with Item 20 operators.",
      "Confirm whether labor runs on commission, hourly, or booth rent — it changes the model entirely.",
    ],
  },
  education_childcare: {
    label: "Education / childcare",
    cogsPct: [5, 12],
    laborPct: [40, 55],
    operatingEbitdaPct: [10, 20],
    dominantRisk:
      "Regulated staff ratios and enrollment/utilization. Labor dominates and ratios cap how lean you can run.",
    rampNote: "12–24 months to mature enrollment.",
    considerations: [
      "Labor is the dominant line at ~40–55% and is floored by regulated student/staff ratios.",
      "Validate enrollment ramp and capacity-utilization curves with Item 20 operators.",
      "Confirm licensing, facility, and compliance costs specific to your state — not in the FDD.",
    ],
  },
  other: {
    label: "General franchise (uncategorized)",
    cogsPct: [15, 35],
    laborPct: [20, 35],
    operatingEbitdaPct: [8, 20],
    dominantRisk:
      "Cost of goods and labor are not disclosed in any FDD — model them explicitly before trusting any margin figure.",
    rampNote: "Assume 6–18 months to a mature run-rate.",
    considerations: [
      "Budget COGS and labor explicitly — neither is in the FDD, and together they usually run 45–65% of sales.",
      "Use the Item 20 franchisee list to validate real operating costs and ramp before committing capital.",
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Disclosed-margin anchor: derive an operating-EBITDA margin from any   */
/* Item 19 cohort pairing of gross sales + (adjusted) EBITDA.            */
/* ------------------------------------------------------------------ */

/** strip the metric words so "Company Centers Gross Sales" and
 *  "Company Centers Adjusted EBITDA" collapse to the same base key. */
function baseKey(label: string): string {
  return label
    .replace(/adjusted\s+ebitda/gi, "")
    .replace(/\bebitda\b/gi, "")
    .replace(/gross\s+sales/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const OWNERSHIP_RANK: Record<string, number> = {
  franchised: 0,
  company: 1,
  mixed: 2,
  affiliate: 3,
  unknown: 4,
};

interface MarginCandidate {
  pct: number;
  source: string;
  ownership: string;
  adjusted: boolean;
  subset: boolean;
}

function deriveDisclosedMargin(
  fdd: ExtractedFDD,
): { pct: number; source: string } | null {
  const cohorts = (fdd.item19?.cohorts ?? []).filter(
    (c) => c.avgMonthlyRevenue != null,
  );
  if (cohorts.length < 2) return null;

  // group cohorts by their base label (e.g. "company centers")
  const groups = new Map<string, typeof cohorts>();
  for (const c of cohorts) {
    const k = baseKey(c.label);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }

  const candidates: MarginCandidate[] = [];
  for (const [key, group] of groups) {
    const gross = group.find(
      (c) => c.revenueType === "gross_sales" || /gross\s+sales/i.test(c.label),
    );
    const ebitdas = group.filter(
      (c) => c.revenueType === "net_or_ebitda" || /ebitda/i.test(c.label),
    );
    if (!gross || !ebitdas.length || !(gross.avgMonthlyRevenue! > 0)) continue;

    const adj = ebitdas.find((c) => /adjusted/i.test(c.label));
    const eb = adj ?? ebitdas[0];
    candidates.push({
      pct: (eb.avgMonthlyRevenue! / gross.avgMonthlyRevenue!) * 100,
      source: `${eb.label} ÷ ${gross.label}`,
      ownership: (gross.ownership ?? "unknown") as string,
      adjusted: !!adj,
      subset: /select|top|included|highest|best/i.test(key),
    });
  }
  if (!candidates.length) return null;

  // prefer franchised > company; the full set over a curated subset; adjusted EBITDA
  const rankOf = (c: MarginCandidate) =>
    (OWNERSHIP_RANK[c.ownership] ?? 4) +
    (c.subset ? 0.5 : 0) -
    (c.adjusted ? 0.1 : 0);
  candidates.sort((a, b) => rankOf(a) - rankOf(b));

  const best = candidates[0];
  return { pct: Math.round(best.pct * 10) / 10, source: best.source };
}

/* ------------------------------------------------------------------ */
/* Public entry point.                                                  */
/* ------------------------------------------------------------------ */

const TOLERANCE_PTS = 4; // how far outside the band before we flag it

export function buildInsights(
  fdd: ExtractedFDD,
  scoring: ScoringResult,
): InsightsResult {
  const conceptType: ConceptType = fdd.conceptType ?? "other";
  const benchmark = BENCHMARKS[conceptType] ?? BENCHMARKS.other;

  const disclosed = deriveDisclosedMargin(fdd);
  const disclosedOperatingMarginPct = disclosed?.pct ?? null;
  const disclosedMarginSource = disclosed?.source ?? null;

  const [loPct, hiPct] = benchmark.operatingEbitdaPct;

  // cross-check the franchisor's disclosed margin against the concept band
  let crossCheck: InsightsResult["crossCheck"];
  if (disclosedOperatingMarginPct == null) {
    crossCheck = {
      status: "no_disclosure",
      message: `No operating-EBITDA margin is disclosed in Item 19. The ${loPct}–${hiPct}% band below is an industry estimate for this concept — validate it against real franchisee P&Ls (Item 20) before relying on any margin.`,
    };
  } else if (disclosedOperatingMarginPct > hiPct + TOLERANCE_PTS) {
    crossCheck = {
      status: "optimistic",
      message: `The franchisor's disclosed margin (${disclosedOperatingMarginPct}%) sits ABOVE the typical ${loPct}–${hiPct}% band for this concept. Treat the headline economics as optimistic and confirm how that figure is calculated (company-owned vs. franchised, what's added back).`,
    };
  } else if (disclosedOperatingMarginPct < loPct - TOLERANCE_PTS) {
    crossCheck = {
      status: "conservative",
      message: `The franchisor's disclosed margin (${disclosedOperatingMarginPct}%) is BELOW the typical ${loPct}–${hiPct}% band. Economics look conservative — confirm what's dragging it (early-stage units, heavy build-out, an immature cohort).`,
    };
  } else {
    crossCheck = {
      status: "consistent",
      message: `The franchisor's disclosed margin (${disclosedOperatingMarginPct}%) is consistent with the typical ${loPct}–${hiPct}% band for this concept — a positive signal on the reported economics. Still verify against real franchisee P&Ls (Item 20).`,
    };
  }

  // contextualize the pro-forma cohort revenue
  const rev = scoring.midCohort?.monthlyRevenue ?? null;
  const marginAfterFeesMonthly = scoring.midCohort?.monthlyEbitda ?? null;
  let benchmarkOperatingEbitdaMonthly: [number, number] | null = null;
  if (rev != null && rev > 0) {
    // if a margin was disclosed, center the band on it; otherwise use the concept band
    const lo = disclosedOperatingMarginPct ?? loPct;
    const hi = disclosedOperatingMarginPct ?? hiPct;
    benchmarkOperatingEbitdaMonthly = [
      Math.round((rev * Math.min(lo, hi)) / 100),
      Math.round((rev * Math.max(lo, hi)) / 100),
    ];
  }

  return {
    conceptType,
    conceptLabel: benchmark.label,
    conceptRationale: fdd.conceptRationale ?? null,
    benchmark,
    disclosedOperatingMarginPct,
    disclosedMarginSource,
    crossCheck,
    proFormaRevenueMonthly: rev,
    marginAfterFeesMonthly,
    benchmarkOperatingEbitdaMonthly,
    asOf: "2026 — general industry benchmarks, refine against real franchisee P&Ls",
    disclaimer:
      "Industry benchmark ranges for your own budgeting and Item 20 questions — NOT a projection of this franchise's results, and not investment advice.",
  };
}
