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
import type { ScoringResult } from "./scoring";
import { CONSULT_CTA_URL } from "./features";

export interface ConceptBenchmark {
  /** human-readable concept name */
  label: string;
  /** cost of goods as a % of revenue (low, high) */
  cogsPct: [number, number];
  /** labor as a % of revenue (low, high) */
  laborPct: [number, number];
  /** occupancy/rent as a % of revenue (low, high) — used ONLY when the FDD
   *  discloses no rent, so the modeled EBITDA isn't overstated by a missing line */
  occupancyPct: [number, number];
  /** typical MATURE operating-EBITDA margin band, % (low, high) — used for the cross-check */
  operatingEbitdaPct: [number, number];
  /** the cost or metric that actually decides the deal in this category */
  dominantRisk: string;
  /** time-to-maturity reality (Item 19 averages are mature-unit numbers) */
  rampNote: string;
  /** what to budget for and verify — the "critical considerations given industry" */
  considerations: string[];
}

export interface BuildupRow {
  label: string;
  kind: "base" | "subtract" | "result";
  pctRange?: [number, number];
  dollarRange?: [number, number];
  note?: string;
  /** provenance of this line's number, for color-coding against the legend.
   *  disclosed = from the FDD; benchmark = our category range; derived =
   *  computed (every "result" line is derived — it's our arithmetic). */
  basis?: "disclosed" | "derived" | "benchmark";
}

/** One line in the assumptions legend — what each Insights number rests on.
 *  basis: disclosed = straight from the FDD; derived = computed from a disclosed
 *  figure; benchmark = our category range because the FDD doesn't disclose it;
 *  inferred = the model's classification (concept, staffing). */
export interface AssumptionRow {
  field: string;
  basis: "disclosed" | "derived" | "benchmark" | "inferred";
  detail: string;
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
  /** TRUE operating EBITDA on that revenue, $/mo (low, high) — disclosed or built bottom-up */
  benchmarkOperatingEbitdaMonthly: [number, number] | null;
  /** whether true EBITDA came from a disclosed margin or was modeled bottom-up */
  trueEbitdaBasis: "disclosed" | "modeled" | "none";

  /** operating model detected from the FDD — drives the labor adjustment */
  staffingModel: "staffed" | "lightly_staffed" | "automated";
  staffingLabel: string;
  /** caveat shown when the model is not conventionally staffed */
  staffingNote: string | null;
  /** staffing-adjusted labor band actually used, % of revenue */
  laborPctEffective: [number, number];

  /** the transparent build-up to true operating EBITDA — the "show the math" */
  buildup: BuildupRow[];

  /** every place a number rests on an assumption rather than a disclosure —
   *  the data behind the assumptions legend */
  assumptions: AssumptionRow[];

  /** contact hook → territory consulting (the report→consulting seam) */
  consultCtaUrl: string | null;
  consultCtaLabel: string;
  consultCtaPitch: string;

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
    occupancyPct: [6, 10],
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
    occupancyPct: [6, 10],
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
    occupancyPct: [10, 18],
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
    occupancyPct: [10, 16],
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
    occupancyPct: [12, 20],
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
    occupancyPct: [8, 14],
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
    occupancyPct: [8, 12],
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
    occupancyPct: [2, 6],
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
    occupancyPct: [8, 15],
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
    occupancyPct: [10, 18],
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
    occupancyPct: [6, 12],
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
  // Reduce a cohort label to its GROUP identity (e.g. "company centers") by
  // stripping metric/aggregation words, so a group's gross-sales table and its
  // EBITDA table pair even when the franchisor labels them unevenly — e.g.
  // "Company Centers Average Gross Sales" vs "Company Centers EBITDA" must both
  // reduce to "company centers". Group-distinguishing words (select, company,
  // franchised, included, top, bottom) are deliberately kept.
  return label
    .replace(/adjusted\s+ebitda/gi, "")
    .replace(/\bebitda\b/gi, "")
    .replace(/operating\s+income/gi, "")
    .replace(/net\s+income/gi, "")
    .replace(/gross\s+(sales|revenue)/gi, "")
    .replace(/\b(average|avg|median|mean|annual|monthly)\b/gi, "")
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

const WAGE_LOADED = 20; // $/hr fully loaded — a stated, visible assumption
const HOURS_FTE = 2080; // annual hours per full-time-equivalent
const OTHER_OPEX_PCT: [number, number] = [6, 10]; // utilities, insurance, R&M catch-all

const STAFFING_LABEL: Record<InsightsResult["staffingModel"], string> = {
  staffed: "conventionally staffed",
  lightly_staffed: "lightly staffed",
  automated: "automated / minimal-staff",
};

/** Adjust the concept's staffed-baseline labor band for the detected operating model. */
function laborBandFor(
  model: InsightsResult["staffingModel"],
  base: [number, number],
): [number, number] {
  if (model === "automated") return [5, 12];
  if (model === "lightly_staffed")
    return [Math.round(base[0] * 0.5), Math.round(base[1] * 0.6)];
  return base;
}

/** Occupancy band for a concept — the rent resolver's tier-5 source (lib/rent.ts). */
export function occupancyBandFor(conceptType: ConceptType | string | null | undefined): [number, number] | null {
  const b = BENCHMARKS[(conceptType as ConceptType) ?? "other"] ?? BENCHMARKS.other;
  return b?.occupancyPct ?? null;
}

export function buildInsights(
  fdd: ExtractedFDD,
  scoring: ScoringResult,
): InsightsResult {
  const conceptType: ConceptType = fdd.conceptType ?? "other";
  const benchmark = BENCHMARKS[conceptType] ?? BENCHMARKS.other;

  const staffingModel = (fdd.staffingModel ?? "staffed") as InsightsResult["staffingModel"];
  const staffingLabel = STAFFING_LABEL[staffingModel];
  const laborPctEffective = laborBandFor(staffingModel, benchmark.laborPct);
  const staffingNote =
    staffingModel === "staffed"
      ? null
      : `Flagged as an ${staffingLabel} model from the FDD, so labor is adjusted down to ${laborPctEffective[0]}–${laborPctEffective[1]}% — the ${benchmark.laborPct[0]}–${benchmark.laborPct[1]}% category band assumes a staffed venue. Confirm actual staffing with Item 20 franchisees.`;

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

  const range = (lo: number, hi: number): [number, number] => [
    Math.round((rev! * lo) / 100),
    Math.round((rev! * hi) / 100),
  ];

  let benchmarkOperatingEbitdaMonthly: [number, number] | null = null;
  let trueEbitdaBasis: InsightsResult["trueEbitdaBasis"] = "none";
  let buildup: BuildupRow[] = [];

  // The assumptions legend: make visible what each number rests on. Concept and
  // operating model are the model's classification; everything below is either
  // taken from the FDD or supplied from our benchmark table where the FDD is silent.
  const assumptions: AssumptionRow[] = [
    {
      field: "Concept type",
      basis: "inferred",
      detail: `Classified as “${benchmark.label}” from the FDD (Item 1 / brand description).`,
    },
  ];
  if (staffingModel !== "staffed") {
    assumptions.push({
      field: "Operating model",
      basis: "inferred",
      detail: `Read as ${staffingLabel} from the FDD, which lowers the labor band applied below.`,
    });
  }

  if (rev != null && rev > 0) {
    const labor$ = range(laborPctEffective[0], laborPctEffective[1]);
    const fteLo = Math.round(((labor$[0] * 12) / (WAGE_LOADED * HOURS_FTE)) * 10) / 10;
    const fteHi = Math.round(((labor$[1] * 12) / (WAGE_LOADED * HOURS_FTE)) * 10) / 10;
    const laborNote = `${staffingLabel} · ≈ ${fteLo}–${fteHi} FTE at ~$${WAGE_LOADED}/hr fully loaded`;

    if (disclosedOperatingMarginPct != null) {
      // Franchisor disclosed a real margin — that's ground truth; use it.
      const eb = Math.round((rev * disclosedOperatingMarginPct) / 100);
      benchmarkOperatingEbitdaMonthly = [eb, eb];
      trueEbitdaBasis = "disclosed";
      buildup = [
        { label: "Franchised gross sales (modeled)", kind: "base", dollarRange: [rev, rev], basis: "disclosed" },
        {
          label: `× franchisor's disclosed operating margin (${disclosedOperatingMarginPct}%)`,
          kind: "result",
          dollarRange: [eb, eb],
          note: disclosedMarginSource ?? undefined,
          basis: "derived",
        },
      ];
      assumptions.push(
        {
          field: "Operating margin",
          basis: "disclosed",
          detail: `Taken straight from the franchisor's Item 19 disclosure (${disclosedMarginSource ?? "Item 19"}); no benchmark applied.`,
        },
        {
          field: "True operating EBITDA",
          basis: "derived",
          detail: "Our calculation — the disclosed margin applied to the modeled franchised gross. The margin is from the FDD; this dollar figure is computed, not disclosed.",
        },
      );
    } else if (marginAfterFeesMonthly != null) {
      // No disclosure — build down from the modeled margin-after-fees by subtracting
      // the missing lines as RANGES (each category's low–high), and carry the swing
      // through to the result. We deliberately do NOT collapse to a midpoint: the
      // spread IS the finding. A single number reads as a disclosed fact; the range
      // shows the buyer how completely the outcome hinges on their real cost
      // structure — the exact thing to verify against Item 20 P&Ls — instead of
      // false precision. (labor$ low–high and laborNote were computed just above.)
      const cogs$ = range(benchmark.cogsPct[0], benchmark.cogsPct[1]);
      const opex$ = range(OTHER_OPEX_PCT[0], OTHER_OPEX_PCT[1]);

      // Rent guard (rent-resolver hotfix): the base margin includes rent whenever
      // scoring resolved one (disclosed number, disclosed range, or benchmark) —
      // in every such case subtracting occupancy again would DOUBLE-COUNT. Only
      // when rent is truly unresolved does the benchmark occupancy line apply,
      // so the build-down isn't overstated. One subtraction, one place.
      const rentRes = (scoring as { rentResolution?: { basis: string; lo: number; hi: number; mid: number; source: string } | null }).rentResolution ?? null;
      const rentDisclosed = fdd.averageRentMonthly != null && fdd.averageRentMonthly > 0;
      const rentIncluded = rentRes != null || rentDisclosed;
      const occ$: [number, number] = rentIncluded
        ? [0, 0]
        : range(benchmark.occupancyPct[0], benchmark.occupancyPct[1]);

      // Best case subtracts the LOW end of every cost; worst case the HIGH end.
      const ebitdaHigh = Math.round(
        marginAfterFeesMonthly - occ$[0] - cogs$[0] - labor$[0] - opex$[0],
      );
      const ebitdaLow = Math.round(
        marginAfterFeesMonthly - occ$[1] - cogs$[1] - labor$[1] - opex$[1],
      );
      benchmarkOperatingEbitdaMonthly = [ebitdaLow, ebitdaHigh];
      trueEbitdaBasis = "modeled";
      const loPctMargin = Math.round((ebitdaLow / rev) * 100);
      const hiPctMargin = Math.round((ebitdaHigh / rev) * 100);

      const rows: BuildupRow[] = [
        { label: "Margin after fees & rent (modeled)", kind: "base", dollarRange: [marginAfterFeesMonthly, marginAfterFeesMonthly], basis: "derived" },
      ];
      if (!rentIncluded) {
        rows.push({
          label: "− Occupancy / rent (not disclosed)",
          kind: "subtract",
          pctRange: benchmark.occupancyPct,
          dollarRange: occ$,
          note: "Item 7 disclosed no rent figure — benchmark occupancy applied so the line above isn't overstated",
          basis: "benchmark",
        });
      }
      rows.push(
        { label: "− Cost of goods", kind: "subtract", pctRange: benchmark.cogsPct, dollarRange: cogs$, basis: "benchmark" },
        { label: "− Labor", kind: "subtract", pctRange: laborPctEffective, dollarRange: labor$, note: laborNote, basis: "benchmark" },
        { label: "− Other operating costs", kind: "subtract", pctRange: OTHER_OPEX_PCT, dollarRange: opex$, note: "utilities, insurance, repairs & maintenance (category estimate)", basis: "benchmark" },
        { label: "= True operating EBITDA", kind: "result", dollarRange: [ebitdaLow, ebitdaHigh], note: `≈ ${loPctMargin}% to ${hiPctMargin}% operating margin, before debt`, basis: "derived" },
      );
      buildup = rows;

      if (rentDisclosed) {
        assumptions.push({
          field: "Rent",
          basis: "disclosed",
          detail: `Taken from the FDD (~$${Math.round(fdd.averageRentMonthly!).toLocaleString()}/mo); already netted in margin after fees & rent.`,
        });
      } else if (rentRes) {
        assumptions.push({
          field: "Rent",
          basis: rentRes.basis === "benchmark" ? "benchmark" : "disclosed",
          detail: `${rentRes.basis === "benchmark" ? "Estimated" : "Disclosed range"}: ~$${Math.round(rentRes.lo).toLocaleString()}–$${Math.round(rentRes.hi).toLocaleString()}/mo (${rentRes.source}); already netted in the margin line — no separate occupancy subtraction applied.`,
        });
      } else {
        assumptions.push({
          field: "Occupancy / rent",
          basis: "benchmark",
          detail: `Item 7 disclosed no rent — occupancy estimated at the ${benchmark.occupancyPct[0]}–${benchmark.occupancyPct[1]}% category band.`,
        });
      }
      assumptions.push(
        { field: "Cost of goods", basis: "benchmark", detail: `Estimated at the ${benchmark.cogsPct[0]}–${benchmark.cogsPct[1]}% category band — COGS is never disclosed in an FDD.` },
        { field: "Labor", basis: "benchmark", detail: `Estimated at the ${laborPctEffective[0]}–${laborPctEffective[1]}% ${staffingLabel} band — labor is never disclosed in an FDD.` },
        { field: "Other operating costs", basis: "benchmark", detail: `Utilities, insurance, and R&M estimated at ${OTHER_OPEX_PCT[0]}–${OTHER_OPEX_PCT[1]}% (category catch-all).` },
        { field: "True operating EBITDA", basis: "derived", detail: "Our calculation — the disclosed top line minus the benchmarked costs above. Not a figure stated in the FDD." },
      );
    }
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
    trueEbitdaBasis,
    staffingModel,
    staffingLabel,
    staffingNote,
    laborPctEffective,
    buildup,
    assumptions,
    consultCtaUrl: CONSULT_CTA_URL || null,
    consultCtaLabel: "Book a territory review",
    consultCtaPitch:
      "These are category benchmarks applied to the disclosed top line — your unit's real costs will differ, and that difference is the conversation. Want them pressure-tested against actual franchisee P&Ls for your territory?",
    asOf: "2026 — general industry benchmarks, refine against real franchisee P&Ls",
    disclaimer:
      "Industry benchmark ranges for your own budgeting and Item 20 questions — NOT a projection of this franchise's results, and not investment advice.",
  };
}
