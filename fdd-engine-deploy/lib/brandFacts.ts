// lib/brandFacts.ts — THE single resolver (facts-resolver spec, 2026-07-20).
//
// THE INVARIANT: every PUBLIC fact shown anywhere (index card, detail hero,
// at-a-glance tiles, metadata, compare rows, nurture-email teases) is resolved
// in EXACTLY ONE place — this file. toCard (lib/brands.ts) and toTeaserCard
// (lib/teaserProps.ts) are thin projections of BrandFacts; neither interprets
// raw brand JSON, so the card and the teaser cannot disagree.
//
// GATING: locked values (deficit figures, cohort spread values, tripwire
// descriptions, risk reasons) are NEVER on BrandFacts. They stay in the
// server-only paths (report mint / paid report). One omission boundary
// instead of two — the guarantee got STRONGER.
//
// Resolution rules fold in the accumulated knowledge of both prior
// interpreters (every non-obvious rule exists because a real brand file
// violated the naive version):
//   · hero honesty rule — franchised-only, largest-sample, revenue-first; the
//     least cherry-pickable figure always wins; company-owned never headlines;
//     quartile slices only as degraded fallback (median > mean; top-quartile
//     never uncaveated); annualRevenue/12 derivation; NEVER label a median
//     "average" (v1 bug); NEVER emit "Not disclosed" when usable Item 19
//     cohorts exist (v2.0 bug)
//   · lo/hi — investment.lowTotal/highTotal → item17 declared → item17 summed
//     (with the >10% mismatch flag and the low-only-line-item guard)
//   · fees — fraction→percent normalization shared with the report
//     (normalizeRoyaltyPct); a flat-fee royalty renders as a note, never a
//     "—" that implies no royalty (Sharkey's)
//   · units — moUnits: item19.unitsReported → hero cohort sampleSize → null;
//     system size: systemScale.totalUnits. These are DIFFERENT numbers, both
//     real; every surface uses the same chain.
//
// Build-time guardrail: auditBrandFacts() runs inside generateStaticParams —
// any assertion failure fails the build, so a card/teaser mismatch can no
// longer ship (there is nothing left to mismatch).

import type { Item19Cohort } from "./schema";
import { resolveMonthlyRent } from "./rent";
import { normalizeRoyaltyPct } from "./fees";
import { derivePerFranchiseRevenue } from "./perUnitRevenue";
import { computeVerify } from "./verify";
import type { BrandRecord, CohortPreference } from "./brands";

// ---------------------------------------------------------------------------
// The resolved-facts object — the ONLY vocabulary public surfaces speak.
// ---------------------------------------------------------------------------

export interface BrandFacts {
  slug: string;
  brandName: string;
  category: string;
  vertical: string;
  parseQuality: string;
  grade: "READY" | "THIN";
  /** clickable + sellable (READY, graded or manual-verified, renderable cost) */
  live: boolean;
  /** Item 19 exists in the FDD (independent of whether a hero resolved) */
  i19: boolean;

  // Item 19 headline (PUBLIC by middle-path design)
  mo: number | null; // monthly figure, rounded
  moLabel: "average" | "median";
  moKind: "revenue" | "profit";
  /** sample behind mo: item19.unitsReported → hero cohort sampleSize → null */
  moUnits: number | null;
  /** label-derived applicability note (EBITDA basis, quartile slice, …) — honesty, not lock */
  moCaveat: string | null;
  /** hero fell past the integrity tiers (quartile / non-franchised survivor) */
  moDegraded: boolean;
  /** "disclosed" (or median/avg of disclosed cohorts) vs "derived" (computed —
   *  e.g. per-unit revenue × units-managed, RPM). Surfaces must NEVER claim a
   *  derived headline was "franchisor-disclosed". */
  moBasis: "disclosed" | "derived";
  cohortCount: number;

  // Item 7 (PUBLIC)
  lo: number | null;
  hi: number | null;
  costSource: "declared" | "summed" | null;
  costMismatch: boolean; // line-item sum diverges >10% from declared
  buildoutMid: number | null; // engine mid-point, last-resort cost display

  // fees (PUBLIC, normalized to PERCENT numbers)
  royaltyPct: number | null; // null when royalty is flat (see flatRoyaltyNote)
  flatRoyaltyNote: string | null; // e.g. "$1,000–$1,750/mo flat" (Sharkey's)
  brandFundPct: number | null;

  // system scale (PUBLIC)
  units: number | null;
  openedLastYear: number | null;
  closedLastYear: number | null;

  // verdict (level PUBLIC; reasons LOCKED — they are not here)
  risk: string | null;
  hasFinancialConditionFlag: boolean;
  /** category labels only (max 3) — existence is public, text is locked */
  tripwireLabels: string[];

  // ── Risk Reframe (Jul 23) — the "N things to verify" readout ───────────────
  // The count is the REAL item count from scoring.riskReasons (not a fixed per-
  // tier number). Floored at 1: a live brand always warrants a baseline look, so
  // a clean brand reads "1 thing to verify" (emerald reassurance), never "0".
  // verifyItems are gating-SAFE category labels (same discipline as tripwires —
  // the raw reason text, which can carry locked figures, never ships). Powers
  // the ONE shared <DiligenceToVerify> component across all four surfaces.
  verifyCount: number;
  /** top ≤3 buyer-facing labels for "here's what to resolve" — labels only */
  verifyItems: string[];
}

// ---------------------------------------------------------------------------
// Hero cohort picker (moved verbatim-in-spirit from lib/brands.ts — the
// corpus-hardened integrity tiers). Exported for tests and legacy imports.
// ---------------------------------------------------------------------------

export interface HeroPick {
  monthly: number; // rounded $/mo
  kind: "revenue" | "profit"; // ALWAYS from revenueType, never from preference
  sampleSize: number | null;
  label: string;
  caveat: string | null; // label-derived applicability note — never hand-written
  degraded: boolean; // fell past the integrity tiers (quartile / non-franchised)
}

const QUARTILE_RE = /top\s+quartile|bottom\s+quartile|quartile|percentile|top\s+\d+|decile/i;
const REPRESENTATIVE_RE = /\ball\b|average|overall|system[-\s]?wide|total|network|mature|median/i;

// A "representative" hero also needs a representative sample (KidStrong n=4).
const SAMPLE_FLOOR = 10;

// Median > mean where both exist — skew-resistant and buyer-honest.
function quartileRank(label: string): number {
  if (/second|third|median|mid/i.test(label)) return 3;
  if (/bottom/i.test(label)) return 2;
  if (/top/i.test(label)) return 1;
  return 0;
}

function isFranchised(c: Item19Cohort): boolean {
  if (c.ownership === "franchised") return true;
  if (c.ownership === "company" || c.ownership === "affiliate" || c.ownership === "mixed") return false;
  return /franchis/i.test(c.label ?? "");
}

function deriveCaveat(c: Item19Cohort, degraded: boolean): string | null {
  const label = c.label ?? "";
  const notes: string[] = [];
  if (/before other expenses/i.test(label)) notes.push("before some owner expenses");
  else if (/ebitdar/i.test(label)) notes.push("before rent (EBITDAR)");
  else if (/gross profit/i.test(label)) notes.push("gross profit — before operating costs");
  else if (/ebitda/i.test(label)) notes.push("EBITDA — before debt and owner pay");
  if (c.ownership === "company" || c.ownership === "affiliate")
    notes.push("company-owned outlets, not franchisees");
  if (degraded && QUARTILE_RE.test(label)) {
    notes.push(
      /bottom/i.test(label)
        ? "bottom-quartile cohort"
        : /second|third|mid/i.test(label)
          ? "mid-quartile cohort"
          : "top-performer cohort, not the system average",
    );
  }
  return notes.length ? notes.join(" · ") : null;
}

/** Monthly figure for a cohort — explicit monthly, else annual/12 (batch2+). */
function monthlyOf(c: Item19Cohort): number | null {
  if (typeof c.avgMonthlyRevenue === "number" && c.avgMonthlyRevenue > 0) return c.avgMonthlyRevenue;
  if (typeof c.annualRevenue === "number" && c.annualRevenue > 0) return c.annualRevenue / 12;
  return null;
}

// A revenue figure disclosed PER MANAGED SUB-UNIT (per door / per property unit
// managed) is NOT the franchise's headline revenue — a property-mgmt franchise
// manages ~260 units, so "$4,552/yr per unit" is a per-door fee, not the
// business's revenue (Real Property Management shipped a $379/mo headline from
// exactly this). Generic "per unit" = per outlet is fine; the sub-unit signal
// requires a managed-denominator qualifier. The correct per-franchise figure
// (per-unit × units-managed) is a derivation — a follow-up ticket, not a guess here.
const SUBUNIT_RE =
  /per\s+property\s+unit|per\s+door\b|per\s+managed|per\s+unit\s+managed|unit\s+managed|revenue\s+per\s+(door|property|managed)/i;
function isSubUnitBasis(c: Item19Cohort): boolean {
  return SUBUNIT_RE.test(`${c.label ?? ""} ${c.basis ?? ""}`);
}

// Part-time franchisee cohorts are a side-gig tier — never the headline over a
// full-time cohort (Schooley Mitchell shipped a $1,229/mo part-time headline
// while its full-time franchisees do $18,629/mo). De-prioritized, not excluded:
// a brand that ONLY discloses part-time still gets its best part-time figure.
const PARTTIME_RE = /part[-\s]?time/i;
function isPartTime(c: Item19Cohort): boolean {
  return PARTTIME_RE.test(`${c.label ?? ""} ${c.basis ?? ""}`);
}

export function pickHeroCohort(
  cohorts: Item19Cohort[] | null | undefined,
  preference: CohortPreference = "revenue",
): HeroPick | null {
  const all = (cohorts ?? []).filter(
    (c) =>
      monthlyOf(c) != null &&
      // pre-sale-only revenue and 'other' are never hero material
      c.revenueType !== "pre_sale_only" &&
      c.revenueType !== "other" &&
      // per-managed-sub-unit revenue is not the franchise headline (RPM)
      !isSubUnitBasis(c),
  );
  if (!all.length) return null;

  const typeOrder: Array<{ t: Item19Cohort["revenueType"]; kind: "revenue" | "profit" }> =
    preference === "profit"
      ? [
          { t: "net_or_ebitda", kind: "profit" },
          { t: "gross_sales", kind: "revenue" },
        ]
      : [
          { t: "gross_sales", kind: "revenue" },
          { t: "net_or_ebitda", kind: "profit" },
        ];

  for (const { t, kind } of typeOrder) {
    const ofType = all.filter((c) => c.revenueType === t);
    if (!ofType.length) continue;

    const goodSample = (c: Item19Cohort) => c.sampleSize == null || c.sampleSize >= SAMPLE_FLOOR;

    const tiers: Array<{ pool: Item19Cohort[]; degraded: boolean }> = [
      {
        pool: ofType.filter((c) => isFranchised(c) && !QUARTILE_RE.test(c.label ?? "") && goodSample(c)),
        degraded: false,
      },
      { pool: ofType.filter((c) => isFranchised(c)), degraded: true },
      { pool: ofType.filter((c) => !QUARTILE_RE.test(c.label ?? "") && goodSample(c)), degraded: true },
      { pool: ofType, degraded: true },
    ];

    for (const { pool, degraded } of tiers) {
      if (!pool.length) continue;
      const sorted = [...pool].sort((a, b) => {
        // full-time before part-time (side-gig tier never headlines over full-time)
        const pa = isPartTime(a) ? 1 : 0;
        const pb = isPartTime(b) ? 1 : 0;
        if (pa !== pb) return pa - pb;
        const ra = REPRESENTATIVE_RE.test(a.label ?? "") ? 1 : 0;
        const rb = REPRESENTATIVE_RE.test(b.label ?? "") ? 1 : 0;
        if (ra !== rb) return rb - ra;
        const qa = quartileRank(a.label ?? "");
        const qb = quartileRank(b.label ?? "");
        if (qa !== qb) return qb - qa;
        return (b.sampleSize ?? 0) - (a.sampleSize ?? 0);
      });
      const c = sorted[0];
      return {
        monthly: Math.round(monthlyOf(c) as number),
        kind, // from revenueType — a profit number is never labeled "revenue"
        sampleSize: c.sampleSize ?? null,
        label: c.label ?? "",
        caveat: deriveCaveat(c, degraded),
        degraded,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cost range (moved from lib/brands.ts). Declared beats summed; >10%
// divergence flags the Item 7 repair queue; a low-only line item never
// yields a half-range (learning-express guard).
// ---------------------------------------------------------------------------

type Item17Like = {
  lineItems?: Array<{ low?: number | null; high?: number | null }> | null;
  initialInvestmentLow?: number | null;
  initialInvestmentHigh?: number | null;
} | null | undefined;

export function costRange(item17: Item17Like): {
  lo: number | null;
  hi: number | null;
  source: "declared" | "summed" | null;
  mismatch: boolean;
} {
  const items = item17?.lineItems ?? [];
  const sumLo = items.reduce((a, x) => a + (x.low ?? 0), 0);
  const sumHi = items.reduce((a, x) => a + (x.high ?? 0), 0);
  const decLo = item17?.initialInvestmentLow ?? null;
  const decHi = item17?.initialInvestmentHigh ?? null;

  const lo = decLo ?? (sumLo > 0 ? sumLo : null);
  const hi = decHi ?? (sumHi > 0 ? sumHi : null);
  const source: "declared" | "summed" | null =
    decLo != null && decHi != null ? "declared" : lo != null && hi != null ? "summed" : null;
  const mismatch = decHi != null && sumHi > 0 && Math.abs(sumHi - decHi) / decHi > 0.1;

  if (lo != null && hi != null && hi >= lo) return { lo, hi, source, mismatch };
  return { lo: null, hi: null, source: null, mismatch };
}

// ---------------------------------------------------------------------------
// Tripwire categorization — descriptions NEVER leave the server; only these
// category labels do.
// ---------------------------------------------------------------------------

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


// ---------------------------------------------------------------------------
// THE RESOLVER — the one interpreter of raw brand JSON.
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function resolveBrandFacts(
  brand: BrandRecord,
  preference: CohortPreference = "revenue",
): BrandFacts {
  // Records span three schema generations; access defensively — the resolver
  // must never throw on a real store file (the audit asserts this).
  const result = (brand as any)?.result ?? {};
  const ex = result?.extracted ?? {};
  const scoring = result?.scoring ?? {};
  const finAssessed = result?.financialCondition ?? null;
  const finRaw = ex?.financialCondition ?? null;

  const i19obj = ex?.item19 ?? {};
  const cohorts: Item19Cohort[] = Array.isArray(i19obj?.cohorts) ? i19obj.cohorts : [];

  // ── Item 19 hero ──────────────────────────────────────────────────────────
  // 1. networkAverageMonthly (batch-3+: pre-resolved system-wide average).
  // 2. The tiered cohort pick (honesty rule): franchised-only, revenue-first,
  //    representative label, median promoted, largest sample; quartile and
  //    non-franchised survivors only as degraded fallback, caveated.
  let mo: number | null = null;
  let moLabel: "average" | "median" = "average";
  let moKind: "revenue" | "profit" = "revenue";
  let moCaveat: string | null = null;
  let moDegraded = false;
  let heroSample: number | null = null;

  let moBasis: "disclosed" | "derived" = "disclosed";
  const nam = i19obj?.networkAverageMonthly;
  if (typeof nam === "number" && nam > 0) {
    mo = Math.round(nam);
  } else {
    const hero = pickHeroCohort(cohorts, preference);
    if (hero) {
      mo = hero.monthly;
      moKind = hero.kind;
      // NEVER label a median "average" (v1 bug): the chosen cohort's own label decides.
      moLabel = /median/i.test(hero.label) ? "median" : "average";
      moCaveat = hero.caveat;
      moDegraded = hero.degraded;
      heroSample = hero.sampleSize;
    } else {
      // No direct franchise revenue (e.g. Item 19 discloses revenue PER MANAGED
      // UNIT only, RPM). Derive per-franchise revenue from per-unit × units-managed,
      // tagged DERIVED so no surface claims it was disclosed.
      const d = derivePerFranchiseRevenue(cohorts);
      if (d) {
        mo = d.monthly;
        moKind = "revenue";
        moLabel = "median"; // headline uses median units
        moCaveat = d.caveat;
        moDegraded = true;
        moBasis = "derived";
        heroSample = d.sample;
      }
    }
  }

  // moUnits chain: unitsReported → hero cohort sampleSize → null.
  const ur = i19obj?.unitsReported;
  const moUnits: number | null = typeof ur === "number" && ur > 0 ? ur : heroSample;

  // ── Item 7 ────────────────────────────────────────────────────────────────
  // investment.lowTotal/highTotal (batch-3) → item17 declared → item17 summed.
  const inv = ex?.investment ?? null;
  let lo: number | null = null;
  let hi: number | null = null;
  let costSource: "declared" | "summed" | null = null;
  let costMismatch = false;
  if (
    typeof inv?.lowTotal === "number" &&
    typeof inv?.highTotal === "number" &&
    inv.highTotal >= inv.lowTotal
  ) {
    lo = inv.lowTotal;
    hi = inv.highTotal;
    costSource = "declared";
  } else {
    const cr = costRange(ex?.item17);
    lo = cr.lo;
    hi = cr.hi;
    costSource = cr.source;
    costMismatch = cr.mismatch;
  }
  const buildoutMid: number | null = scoring?.buildoutMidpoint ?? null;

  // ── Fees ──────────────────────────────────────────────────────────────────
  // Convention detection is RECORD-level, not per-value: a record storing
  // {royaltyPct: 4, localAdPct: 2, brandFundPct: 0.5} is whole-percent
  // convention, and 0.5 means 0.5% — the per-value fraction heuristic turned
  // Jan-Pro's 0.5% brand fund into "50%" on the live page (the bug class this
  // resolver exists to kill). Only when EVERY disclosed fee is < 1 is the
  // record fraction-convention (0.06 → 6%).
  const fees = ex?.ongoingFees ?? {};
  const feeVals = [fees?.royaltyPct, fees?.brandFundPct, fees?.localAdPct].filter(
    (v: unknown): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const wholePercentRecord = feeVals.some((v) => v >= 1);
  const pct = (v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    const n = wholePercentRecord ? v : v < 1 ? v * 100 : v;
    return Math.round(n * 100) / 100;
  };
  const royaltyPct = pct(fees?.royaltyPct);
  const brandFundPct = pct(fees?.brandFundPct);

  // Flat-fee royalty (Sharkey's): a null royaltyPct with royalty-NAMED flat
  // fees is a real fee model, not a missing fee — never render "—" for it.
  let flatRoyaltyNote: string | null = null;
  if (royaltyPct == null) {
    const flat: Array<{ name?: string; monthlyAmount?: number | null }> = Array.isArray(
      fees?.flatMonthlyFees,
    )
      ? fees.flatMonthlyFees
      : [];
    const royaltyFlat = flat.filter((f) => /royalt/i.test(f?.name ?? ""));
    if (royaltyFlat.length) {
      const amounts = royaltyFlat
        .map((f) => f?.monthlyAmount)
        .filter((n): n is number => typeof n === "number" && n > 0);
      if (amounts.length) {
        const lo$ = Math.min(...amounts);
        const hi$ = Math.max(...amounts);
        const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;
        flatRoyaltyNote =
          lo$ === hi$ ? `${fmt(lo$)}/mo flat` : `${fmt(lo$)}–${fmt(hi$)}/mo flat`;
      } else {
        flatRoyaltyNote = "flat monthly royalty — see Item 6";
      }
    }
  }

  // ── System scale ──────────────────────────────────────────────────────────
  const scale = ex?.systemScale ?? {};

  // ── Verdict + locked-flag existence ───────────────────────────────────────
  const sev = String(finAssessed?.severity ?? "").toUpperCase();
  const hasFinancialConditionFlag =
    sev === "HIGH" ||
    sev === "MEDIUM" ||
    finRaw?.specialRiskPresent === true ||
    (typeof finRaw?.years?.[0]?.netWorth === "number" && finRaw.years[0].netWorth < 0);

  // ── Tripwire category labels (max 3) ──────────────────────────────────────
  // operationalRisks first (severity-ordered — the card's prior behavior),
  // then hiddenCosts; handles string and {description|title|name} shapes.
  const opRisks: any[] = Array.isArray(ex?.operationalRisks) ? ex.operationalRisks.slice() : [];
  opRisks.sort(
    (a, b) =>
      (SEVERITY_ORDER[a?.severity ?? "low"] ?? 2) - (SEVERITY_ORDER[b?.severity ?? "low"] ?? 2),
  );
  const rawFlags: string[] = [...opRisks, ...(Array.isArray(ex?.hiddenCosts) ? ex.hiddenCosts : [])]
    .map((t: any) => (typeof t === "string" ? t : t?.description ?? t?.title ?? t?.name ?? ""))
    .filter(Boolean);
  const seenLabels = new Set<string>();
  const tripwireLabels: string[] = [];
  for (const f of rawFlags) {
    const label = categorize(f);
    if (!seenLabels.has(label)) {
      seenLabels.add(label);
      tripwireLabels.push(label);
    }
    if (tripwireLabels.length >= 3) break;
  }

  // ── Risk Reframe: "N things to verify" — single source in lib/verify.ts, so
  // the teaser surfaces and the paid report can't diverge (drift audit enforces).
  const { verifyCount, verifyItems } = computeVerify(scoring?.riskReasons);

  // ── live gate ─────────────────────────────────────────────────────────────
  const risk: string | null = scoring?.riskLevel ?? null;
  const parseQuality: string = (brand as any)?.parseQuality ?? "clean";
  const gradedOrVerified = risk != null || parseQuality === "manual-verified";
  const live =
    (brand as any)?.grade === "READY" &&
    gradedOrVerified &&
    ((lo != null && hi != null) || buildoutMid != null);

  return {
    slug: (brand as any)?.slug ?? "",
    brandName: (brand as any)?.brandName ?? ex?.brandName ?? "",
    category: (brand as any)?.category ?? "",
    vertical: (brand as any)?.vertical ?? "Kids & Family",
    parseQuality,
    grade: (brand as any)?.grade === "THIN" ? "THIN" : "READY",
    live,
    i19: Boolean(i19obj?.hasItem19),
    mo,
    moLabel,
    moKind,
    moUnits,
    moCaveat,
    moDegraded,
    moBasis,
    cohortCount: cohorts.length,
    lo,
    hi,
    costSource,
    costMismatch,
    buildoutMid,
    royaltyPct,
    flatRoyaltyNote,
    brandFundPct,
    units: scale?.totalUnits ?? null,
    openedLastYear: scale?.openedLastYear ?? null,
    closedLastYear: scale?.closedLastYear ?? null,
    risk,
    hasFinancialConditionFlag,
    tripwireLabels,
    verifyCount,
    verifyItems,
  };
}

// ---------------------------------------------------------------------------
// Build-time consistency audit. Runs inside generateStaticParams (and in CI
// via lib/brandFacts.test.ts): ANY assertion failure fails the build, so a
// mismatch or un-normalized value can no longer ship.
// ---------------------------------------------------------------------------

export function auditBrandFacts(brands: BrandRecord[]): string {
  const errors: string[] = [];
  let rentNullAvg = 0;
  const rentBasis: Record<string, number> = {};
  const rows: string[] = [
    "slug                              | mo        | label   | n     | lo–hi                     | royalty | risk | rent (basis)",
  ];

  for (const b of brands) {
    let f: BrandFacts;
    try {
      f = resolveBrandFacts(b);
    } catch (err) {
      errors.push(`${(b as any)?.slug ?? "?"}: resolveBrandFacts threw: ${String(err)}`);
      continue;
    }

    const ex = (b as any)?.result?.extracted ?? {};
    const i19obj = ex?.item19 ?? {};
    const cohorts: Item19Cohort[] = Array.isArray(i19obj?.cohorts) ? i19obj.cohorts : [];
    const usable =
      (typeof i19obj?.networkAverageMonthly === "number" && i19obj.networkAverageMonthly > 0) ||
      cohorts.some(
        (c) =>
          monthlyOf(c) != null &&
          c.revenueType !== "pre_sale_only" &&
          c.revenueType !== "other" &&
          // per-managed-sub-unit cohorts are correctly NOT headline material — a
          // null mo when only those exist is right, not the v2.0 bug (RPM).
          !isSubUnitBasis(c),
      );
    if (i19obj?.hasItem19 && usable && f.mo == null) {
      errors.push(`${f.slug}: hasItem19 with usable cohorts but mo resolved null (v2.0-bug class)`);
    }
    // Margin-based B2B models (Express Employment 40%-of-gross-margin, freight
    // 30%) legitimately exceed sales-royalty norms — bound royalty at 60.
    // Brand funds cap at 20: Maui Wowi's 15% purchase-basis ad fee is real;
    // Jan-Pro's 0.5%-read-as-50% is the bug class this catches.
    if (f.royaltyPct != null && (f.royaltyPct < 0 || f.royaltyPct > 60)) {
      errors.push(`${f.slug}: royaltyPct ${f.royaltyPct} outside 0–60 (un-normalized?)`);
    }
    if (f.brandFundPct != null && (f.brandFundPct < 0 || f.brandFundPct > 20)) {
      errors.push(`${f.slug}: brandFundPct ${f.brandFundPct} outside 0–20 (un-normalized?)`);
    }
    if (f.lo != null && f.hi != null && f.lo > f.hi) {
      errors.push(`${f.slug}: lo ${f.lo} > hi ${f.hi}`);
    }
    // Implausibly-low headline (RPM $379 / Schooley $1,229 class): a live brand's
    // Item 19 REVENUE headline under ~$2k/mo is almost always a mis-basis read —
    // a per-unit/per-door fee or a part-time tier — not the franchise's revenue.
    // Only fires on LIVE brands (what a buyer actually sees); THIN/excluded skip.
    if (f.live && f.mo != null && f.moKind === "revenue" && f.mo < 2000) {
      errors.push(
        `${f.slug}: live Item 19 revenue headline $${f.mo}/mo is implausibly low (<$2k) — likely a per-unit/part-time mis-basis read; verify against the FDD`,
      );
    }

    // ── per-unit derivation guard (RPM class) ──────────────────────────────
    // When an Item 19 discloses revenue PER MANAGED UNIT (per door / per
    // property), the per-FRANCHISE headline is only honest as that figure ×
    // units-managed-per-franchise. Two mirror-image catastrophes both die here:
    //   (a) UNDERSTATE — a raw per-unit number headlines un-multiplied (the
    //       $4,552/12=$379 bug: a $47k/mo business shown as $379/mo)
    //   (b) SYNTHETIC — moBasis says "derived" but the disclosed inputs aren't
    //       actually in the store, so the number can't be reproduced/traced
    // The law: if the store discloses per-unit revenue, the headline is EITHER
    // moBasis "derived" with reproducible inputs, OR mo is null (no units count
    // to multiply → no honest headline exists). A raw per-unit number may never
    // become a headline. This is what lets the derivation generalize safely to
    // the next per-unit brand without a human catching it against the PDF.
    // The raw per-unit monthly figures (per-unit annual ÷ 12) — these are the
    // numbers that must NEVER surface as a per-FRANCHISE headline. Checked by
    // VALUE, not by re-running the resolver's own basis logic: if the rendered
    // mo equals one of these, the units-managed multiplier was dropped no matter
    // what the resolver believed it was doing (this is the $4,552÷12=$379 bug).
    const rawPerUnitMonthly = cohorts
      .filter((c) => c.revenueType === "gross_sales" && isSubUnitBasis(c))
      .map((c) => monthlyOf(c))
      .filter((m): m is number => m != null);
    if (rawPerUnitMonthly.length) {
      const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.02);
      if (f.mo != null && rawPerUnitMonthly.some((m) => near(m, f.mo!))) {
        errors.push(
          `${f.slug}: headline $${f.mo}/mo equals a RAW per-unit figure ÷12 — the units-managed multiplier was dropped (RPM $379 class); a per-unit disclosure must derive per-franchise (× units) or stay null`,
        );
      }
      // A non-null headline off a per-unit-only disclosure is only honest if it's
      // the derivation (moBasis "derived") AND that derivation reproduces from the
      // store. Anything else means a per-unit number leaked as a headline.
      if (f.mo != null && f.moBasis !== "derived") {
        errors.push(
          `${f.slug}: per-unit Item 19 headlined as $${f.mo}/mo with moBasis "${f.moBasis}" — must be moBasis "derived" (× units-managed) or null, never a raw per-unit headline`,
        );
      }
      if (f.moBasis === "derived" && !derivePerFranchiseRevenue(cohorts)) {
        errors.push(
          `${f.slug}: moBasis "derived" but the per-unit derivation is not reproducible from the store — its disclosed inputs (per-unit revenue + units-managed) are missing`,
        );
      }
    }

    // ── rent resolution (rent-resolver hotfix): must never throw; sanity-check
    // estimated bases against revenue to catch unit errors (annual-as-monthly,
    // sqft-rate confusion). Disclosed single numbers are exempt from the % band
    // (tiny-office service brands at <2% and sublease models >25% are real).
    let rentCell = "—";
    try {
      const midRev: number | null =
        (b as any)?.result?.scoring?.midCohort?.monthlyRevenue ?? f.mo ?? null;
      if (ex?.averageRentMonthly == null) rentNullAvg++;
      const r = resolveMonthlyRent(ex, midRev);
      rentBasis[r?.basis ?? "null"] = (rentBasis[r?.basis ?? "null"] ?? 0) + 1;
      if (r) {
        rentCell = `$${r.lo.toLocaleString("en-US")}–$${r.hi.toLocaleString("en-US")} (${r.basis}${r.reviewFlag ? " ⚠REVIEW" : ""})`;
        if (r.basis !== "disclosed" && midRev != null && midRev > 1000) {
          const pct = r.mid / midRev;
          if (pct < 0.02 || pct > 0.25) {
            errors.push(
              `${f.slug}: estimated rent $${r.mid} is ${(pct * 100).toFixed(1)}% of revenue — outside 2–25% (unit error?)`,
            );
          }
        }
      } else {
        rentCell = "not disclosed";
      }
    } catch (err) {
      errors.push(`${f.slug}: resolveMonthlyRent threw: ${String(err)}`);
    }

    const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
    rows.push(
      `${f.slug.padEnd(33)} | ${money(f.mo).padEnd(9)} | ${f.moLabel.padEnd(7)} | ${String(f.moUnits ?? "—").padEnd(5)} | ${`${money(f.lo)}–${money(f.hi)}`.padEnd(25)} | ${(f.royaltyPct != null ? `${f.royaltyPct}%` : f.flatRoyaltyNote ? "flat" : "—").padEnd(7)} | ${(f.risk ?? "—").padEnd(6)} | ${rentCell}`,
    );
  }

  const table = rows.join("\n");
  // Human-scannable snapshot in every build log.
  console.log(`[brand-facts audit] ${brands.length} brands\n${table}`);
  console.log(
    `[brand-facts audit] rent blast radius: averageRentMonthly null on ${rentNullAvg}/${brands.length} (each was silently $0 pre-hotfix) · resolution basis: ${JSON.stringify(rentBasis)}`,
  );
  if (errors.length) {
    throw new Error(`[brand-facts audit] ${errors.length} violation(s):\n${errors.join("\n")}`);
  }
  return table;
}
