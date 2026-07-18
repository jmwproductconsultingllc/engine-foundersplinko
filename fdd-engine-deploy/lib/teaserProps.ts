// lib/teaserProps.ts — SERVER-SIDE teaser transform (P0 front-end, 2026-07-18).
//
// THE GATING GUARANTEE lives here, not in CSS: BrandDetail is a client component,
// so every prop it receives ships to the browser. This transform builds a
// TeaserCard that simply DOES NOT CONTAIN the locked values:
//   - no franchisor net-worth / deficit / total-asset figures
//   - no Item 19 cohort spread (high / median / low)
//   - no tripwire descriptions (category labels only)
// Acceptance: view-source + network tab on /franchise/crumbl contains no
// instance of the deficit figures or cohort spread values.
//
// Call this in the SERVER component (app/franchise/[slug]/page.tsx) and pass the
// result to <BrandDetail teaser={...}/>. Do NOT pass the full card/brand there.

export interface TeaserTripwire {
  /** category label ONLY — e.g. "Supplier restriction". Never the description. */
  label: string;
}

export interface TeaserCard {
  slug: string;
  brandName: string;
  category: string;
  vertical: string;
  parseQuality?: string;

  /** Item 19 headline — VISIBLE by design (middle path). Correctly labeled. */
  mo: number | null;            // networkAverageMonthly (e.g. 94930 for Crumbl)
  moLabel: "average" | "median";
  moKind: "revenue" | "profit";
  mn: number | null;            // reporting units (776)
  cohortCount: number;          // count only — the spread values stay server-side

  /** Item 7 — visible (credibility) */
  lo: number | null;
  hi: number | null;

  /** fees — visible */
  royaltyPct: number | null;
  brandFundPct: number | null;

  /** system scale — visible */
  units: number | null;
  openedLastYear: number | null;
  closedLastYear: number | null;

  /** verdict — level visible; the WHY is locked */
  risk: string | null;          // "High" | "Medium" | "Low" | null
  /** true → render the locked financial-condition tease. No figures ship. */
  hasFinancialConditionFlag: boolean;
  /** existence-only tripwire teases (max 3) */
  tripwires: TeaserTripwire[];
}

// ── category mapping: descriptions NEVER leave the server ─────────────────────
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/supplier|vendor|purchase|inventory|designated/i, "Supplier restriction"],
  [/arbitrat|dispute|venue|litigat|jurisdict|governing law/i, "Dispute-venue clause"],
  [/development|multi-unit|minimum.*(unit|bakery|store|location)|area agreement/i, "Development obligation"],
  [/insurance|total cost of risk/i, "Insurance program requirement"],
  [/lease|landlord|rent|real estate/i, "Real-estate / lease control"],
  [/territory|exclusiv/i, "Territory limitation"],
  [/transfer|resale|right of first refusal/i, "Transfer / resale restriction"],
  [/non-?compete|post-term/i, "Post-term restriction"],
  [/fee|royalt|fund/i, "Additional recurring fee"],
];

function categorize(text: string): string {
  for (const [re, label] of CATEGORY_RULES) if (re.test(text)) return label;
  return "Operational restriction";
}

/**
 * Build teaser props from the stored brand record (data/brands/<slug>.json shape:
 * { slug, brandName, category, vertical, result: { extracted, scoring,
 *   financialCondition, ... } }).
 */
export function toTeaserCard(brand: any): TeaserCard {
  const ex = brand?.result?.extracted ?? {};
  const scoring = brand?.result?.scoring ?? {};
  const finAssessed = brand?.result?.financialCondition ?? null;
  const finRaw = ex?.financialCondition ?? null;

  const i19 = ex?.item19 ?? {};
  const cohorts: any[] = Array.isArray(i19?.cohorts) ? i19.cohorts : [];

  // Headline number: networkAverageMonthly, correctly labeled "average".
  // (Bugfix: the page previously showed the MEDIAN labeled "average".)
  let mo: number | null = i19?.networkAverageMonthly ?? null;
  let moLabel: "average" | "median" = "average";
  if (mo == null && cohorts.length) {
    const avg = cohorts.find((c) => /average/i.test(c?.label ?? c?.name ?? ""));
    const med = cohorts.find((c) => /median/i.test(c?.label ?? c?.name ?? ""));
    if (avg?.avgMonthlyRevenue != null) { mo = avg.avgMonthlyRevenue; moLabel = "average"; }
    else if (med?.avgMonthlyRevenue != null) { mo = med.avgMonthlyRevenue; moLabel = "median"; }
  }

  const inv = ex?.investment ?? {};
  const i17 = ex?.item17 ?? {};
  const fees = ex?.ongoingFees ?? {};
  const scale = ex?.systemScale ?? {};

  // Locked-flag existence: assessed severity if present, else the raw marker.
  const sev = String(finAssessed?.severity ?? "").toUpperCase();
  const hasFinancialConditionFlag =
    sev === "HIGH" || sev === "MEDIUM" || finRaw?.specialRiskPresent === true ||
    (typeof finRaw?.years?.[0]?.netWorth === "number" && finRaw.years[0].netWorth < 0);

  // Tripwires → categories only (max 3). Sources: extracted.operationalRisks /
  // hiddenCosts / any tripwire list your card model already aggregates.
  const rawFlags: string[] = [
    ...(Array.isArray(ex?.operationalRisks) ? ex.operationalRisks : []),
    ...(Array.isArray(ex?.hiddenCosts) ? ex.hiddenCosts : []),
  ]
    .map((t: any) => (typeof t === "string" ? t : t?.description ?? t?.title ?? ""))
    .filter(Boolean);
  const seen = new Set<string>();
  const tripwires: TeaserTripwire[] = [];
  for (const f of rawFlags) {
    const label = categorize(f);
    if (!seen.has(label)) { seen.add(label); tripwires.push({ label }); }
    if (tripwires.length >= 3) break;
  }

  return {
    slug: brand?.slug ?? "",
    brandName: brand?.brandName ?? ex?.brandName ?? "",
    category: brand?.category ?? "",
    vertical: brand?.vertical ?? "",
    parseQuality: brand?.parseQuality,
    mo,
    moLabel,
    moKind: "revenue",
    mn: i19?.unitsReported ?? null,
    cohortCount: cohorts.length,
    lo: inv?.lowTotal ?? i17?.initialInvestmentLow ?? null,
    hi: inv?.highTotal ?? i17?.initialInvestmentHigh ?? null,
    royaltyPct: fees?.royaltyPct ?? null,
    brandFundPct: fees?.brandFundPct ?? null,
    units: scale?.totalUnits ?? null,
    openedLastYear: scale?.openedLastYear ?? null,
    closedLastYear: scale?.closedLastYear ?? null,
    risk: scoring?.riskLevel ?? null,
    hasFinancialConditionFlag,
    tripwires,
  };
}
