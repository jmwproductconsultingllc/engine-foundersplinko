// lib/brands.ts
// Brand store: read canonical brand files + derive the card/hero model for
// /brands and /franchise/[slug]. Field mapping per deploy-brief-brand-pages.md
// v3, hardened against the real 18-brand corpus (2026-07-09 batch). Every
// non-obvious rule below exists because a real brand file violated the naive
// version of it.

import fs from "node:fs/promises";
import path from "node:path";
import type { DiligenceResult } from "./types";
import type { ExtractedFDD, Item19Cohort } from "./schema";
import { normalizeRoyaltyPct } from "./fees";

export { normalizeRoyaltyPct }; // one import site for page code

// ---------------------------------------------------------------------------
// Store shape (matches scripts/jsonl-to-brands.ts output)
// ---------------------------------------------------------------------------

export interface BrandRecord {
  slug: string;
  brandName: string;
  category: string;
  grade: "READY" | "THIN";
  sourceFddYear: number | null;
  generatedAt: string;
  sourceStem?: string;
  result: DiligenceResult;
}

export type CohortPreference = "revenue" | "profit";

export interface HeroPick {
  monthly: number; // rounded $/mo
  kind: "revenue" | "profit"; // ALWAYS from revenueType, never from preference
  sampleSize: number | null;
  label: string;
  caveat: string | null; // label-derived applicability note — never hand-written
  degraded: boolean; // fell past the integrity tiers (quartile / non-franchised)
}

export interface BrandCard {
  brandName: string;
  slug: string;
  category: string;
  grade: "READY" | "THIN";
  live: boolean; // clickable card vs ghost
  risk: string | null;
  riskReasons: string[];
  i19: boolean;
  mo: number | null;
  moKind: "revenue" | "profit" | null;
  moCaveat: string | null;
  mn: number | null; // sampleSize behind the hero figure
  lo: number | null;
  hi: number | null;
  costSource: "declared" | "summed" | null;
  costMismatch: boolean; // sum diverges >10% from declared — queue Item 7 repair
  royaltyPct: number | null; // normalized (R2)
  units: number | null;
  openedLastYear: number | null;
  closedLastYear: number | null;
}

// ---------------------------------------------------------------------------
// Taxonomy — /brands renders exactly these rows, in this order. A brand whose
// category isn't listed is EXCLUDED and warned, never rendered as a junk row.
// (Corpus: kona-ice arrived tagged "Kids" — a registry bug, not a row.)
// ---------------------------------------------------------------------------

export const CATEGORY_ORDER: readonly string[] = [
  "Education & STEM",
  "Swim",
  "Sports & Athletics",
  "Play & Entertainment",
  "Fitness & Gym",
  "Childcare & Preschool",
  "Arts & Music",
  "Hair & Personal Care",
  "Kids Retail",
];

// ---------------------------------------------------------------------------
// Cost range. The v1 brief said Σ lineItems, but the corpus proved the declared
// Item 7 totals are the safer source: code-ninjas line items sum 30% below the
// declared high, urban-air 21% below (the known Item 7 reconciliation bug, live
// in the store). Rule: prefer declared low/high, fall back to sums, and flag
// >10% divergence so those brands get queued for the focused Item 7 repair.
// ---------------------------------------------------------------------------

export function costRange(item17: ExtractedFDD["item17"] | null | undefined): {
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

  // Guard the learning-express failure mode: a single low-only line item yields
  // lo=40000 / hi=0. A range needs both ends to be renderable.
  if (lo != null && hi != null && hi >= lo) return { lo, hi, source, mismatch };
  return { lo: null, hi: null, source: null, mismatch };
}

// ---------------------------------------------------------------------------
// Hero cohort picker — the brief's rep_month, parameterized (reconciliation #1)
// and hardened with integrity tiers the corpus demanded:
//
//   BUG 1 (urban-air / kidstrong): the naive sort crowned a TOP-quartile
//     cohort ($390k/mo) and a BOTTOM-quartile cohort as heroes. Quartile
//     cohorts are ineligible unless nothing else survives — and then the
//     derived caveat renders and the conservative rank applies.
//   BUG 2 (school-of-rock): profit preference picked Company-Owned NOI —
//     affiliate economics as owner income (provenance ≠ applicability, the
//     Five Iron trap documented on Item19Cohort.ownership). Franchised is a
//     hard tier, not a sort hint.
//   BUG 3 (goldfish / primrose / once-upon-a-child): "Profit Before Other
//     Expenses", EBITDAR, and Gross Profit are all revenueType=net_or_ebitda
//     but are NOT take-home — the caveat derives from the cohort's own label
//     (reconciliation #4), never hardcoded per brand.
//
// Tiering (first non-empty tier wins):
//   T1 franchised + representative (non-quartile, sample ≥ floor)
//   T2 franchised (quartile allowed → degraded)
//   T3 any ownership, representative (→ degraded)
//   T4 anything with a monthly number (→ degraded)
// Within a tier: representative-label keywords, then conservative quartile
// rank, then sampleSize desc. Preference falls back across revenueType and
// RELABELS — never blank (labels are always driven by revenueType).
// ---------------------------------------------------------------------------

const QUARTILE_RE = /top\s+quartile|bottom\s+quartile|quartile|percentile|top\s+\d+|decile/i;
const REPRESENTATIVE_RE = /\ball\b|average|overall|system[-\s]?wide|total|network|mature|median/i;

// A "representative" hero also needs a representative sample. KidStrong's only
// non-quartile cohort is n=4 — crowning it hides that the disclosure is really
// quartile-sliced. Below this floor we fall to the degraded tiers instead.
const SAMPLE_FLOOR = 10;

// When only quartile slices exist (Primrose, Urban Air disclose nothing else),
// never lead with the best case: middle quartiles are closest to typical,
// bottom understates (acceptable for a buyer-aligned product), top overstates
// (never acceptable, even caveated). Also promotes MEDIAN over mean where both
// exist — skew-resistant and buyer-honest (Jason's call; reverse by removing
// 'median' from this regex and REPRESENTATIVE_RE).
function quartileRank(label: string): number {
  if (/second|third|median|mid/i.test(label)) return 3;
  if (/bottom/i.test(label)) return 2;
  if (/top/i.test(label)) return 1;
  return 0;
}

function isFranchised(c: Item19Cohort): boolean {
  // Ownership is a HARD filter (v3 §2): company/affiliate/mixed never render as
  // owner economics unless sole survivor (degraded tier + caveat). When the
  // enum is missing/unknown, fall back to the label text.
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

export function pickHeroCohort(
  cohorts: Item19Cohort[] | null | undefined,
  preference: CohortPreference = "revenue",
): HeroPick | null {
  const all = (cohorts ?? []).filter(
    (c) =>
      typeof c.avgMonthlyRevenue === "number" &&
      (c.avgMonthlyRevenue as number) > 0 &&
      // pre-sale-only revenue (memberships sold before opening) and 'other' are
      // never hero material — not ongoing operating economics (v3 §1).
      c.revenueType !== "pre_sale_only" &&
      c.revenueType !== "other",
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
        monthly: Math.round(c.avgMonthlyRevenue as number),
        kind, // from revenueType — a profit number is never labeled "revenue" or vice-versa
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
// Card model
// ---------------------------------------------------------------------------

export function toCard(brand: BrandRecord, preference: CohortPreference = "revenue"): BrandCard {
  const e = brand.result.extracted;
  const { lo, hi, source: costSource, mismatch } = costRange(e.item17);
  const hero = pickHeroCohort(e.item19?.cohorts, preference);
  const risk = brand.result.scoring?.riskLevel ?? null;

  // live = clickable card linking to /franchise/[slug]. THIN grades and
  // structurally unrenderable brands stay ghosts (clickable-for-demand-signal
  // per reconciliation #2, but not linked to a detail page). Grade is the
  // converter's call and the gate; don't second-guess it per-field here.
  const live = brand.grade === "READY" && risk != null && lo != null && hi != null;

  return {
    brandName: brand.brandName,
    slug: brand.slug,
    category: brand.category,
    grade: brand.grade,
    live,
    risk,
    riskReasons: brand.result.scoring?.riskReasons ?? [],
    i19: Boolean(e.item19?.hasItem19),
    mo: hero?.monthly ?? null,
    moKind: hero?.kind ?? null,
    moCaveat: hero?.caveat ?? null,
    mn: hero?.sampleSize ?? null,
    lo,
    hi,
    costSource,
    costMismatch: mismatch,
    royaltyPct: normalizeRoyaltyPct(e.ongoingFees?.royaltyPct),
    units: e.systemScale?.totalUnits ?? null,
    openedLastYear: e.systemScale?.openedLastYear ?? null,
    closedLastYear: e.systemScale?.closedLastYear ?? null,
  };
}

// ---------------------------------------------------------------------------
// Store access. BRANDS_SOURCE=fs (default: committed data/brands/*.json — SSG
// friendly, zero extra infra) or blob (Vercel Blob under brands/, for
// no-deploy content updates). Same BrandRecord[] either way.
// ---------------------------------------------------------------------------

const FS_DIR = path.join(process.cwd(), "data", "brands");

async function listFromFs(): Promise<BrandRecord[]> {
  let files: string[];
  try {
    files = (await fs.readdir(FS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: BrandRecord[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(FS_DIR, f), "utf8")) as BrandRecord);
    } catch (err) {
      console.error(`[brands] skipping unparseable ${f}:`, err);
    }
  }
  return out;
}

async function listFromBlob(): Promise<BrandRecord[]> {
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: "brands/" });
  const out: BrandRecord[] = [];
  for (const b of blobs.filter((x) => x.pathname.endsWith(".json"))) {
    try {
      const res = await fetch(b.url, { next: { revalidate: 3600 } });
      out.push((await res.json()) as BrandRecord);
    } catch (err) {
      console.error(`[brands] skipping unfetchable ${b.pathname}:`, err);
    }
  }
  return out;
}

export async function listBrands(): Promise<BrandRecord[]> {
  return process.env.BRANDS_SOURCE === "blob" ? listFromBlob() : listFromFs();
}

export async function getBrand(slug: string): Promise<BrandRecord | null> {
  // Slug identity comes from the registry (scripts/jsonl-to-brands.ts), never
  // re-derived from extracted brandName — re-derivation is how SEO URLs
  // silently 404 when a re-extraction changes the cover-page name.
  const all = await listBrands();
  return all.find((b) => b.slug === slug) ?? null;
}

// ---------------------------------------------------------------------------
// Ghost universe — broad-by-design (brief §categories): every KNOWN kids brand
// per category renders, un-parsed ones as "FDD pending" ghost cards whose
// clicks are demand signals. Names mirror gen_brands.py UNIVERSE (the brands
// WITHOUT a corpus stem). A brand flips ghost → live automatically the moment
// its converted file lands in the store — no code change.
// ---------------------------------------------------------------------------

export const GHOST_UNIVERSE: Record<string, string[]> = {
  "Education & STEM": [
    "Sylvan Learning", "Huntington Learning", "Tutor Doctor", "Club Z! Tutoring",
    "theCoderSchool", "Snapology", "Bricks 4 Kidz", "Best in Class Education",
    "Engineering For Kids",
  ],
  Swim: ["SafeSplash", "Big Blue Swim School", "Emler Swim School", "Saf-T-Swim"],
  "Sports & Athletics": [
    "Skyhawks Sports", "TGA Premier Sports", "Challenger Sports", "D1 Training", "Amazing Athletes",
  ],
  "Play & Entertainment": [
    "Altitude Trampoline Park", "Pump It Up", "Rockin' Jump", "We Rock the Spectrum",
  ],
  "Fitness & Gym": ["The Little Gym", "My Gym", "Romp n' Roll", "Gymboree Play & Music"],
  "Childcare & Preschool": [
    "Kids 'R' Kids", "The Learning Experience", "Kiddie Academy", "Lightbridge Academy", "Celebree School",
  ],
  "Arts & Music": ["Bach to Rock", "Young Rembrandts", "Abrakadoodle", "Drama Kids", "Kidcreate Studio"],
  "Hair & Personal Care": ["Pigtails & Crewcuts", "Cookie Cutters Haircuts", "Snip-its"],
  "Kids Retail": ["Kid to Kid", "Other Mothers"],
};

export interface CategoryRow {
  category: string;
  cards: BrandCard[]; // live first (sorted by mo desc), then store-ghosts (THIN)
  ghostNames: string[]; // never-parsed universe brands → GhostBrandCard
  liveCount: number;
  totalCount: number; // live + THIN + universe ghosts (the "N tracked" tally)
}

export async function listDirectory(preference: CohortPreference = "revenue"): Promise<CategoryRow[]> {
  const brands = await listBrands();
  const known = new Set(CATEGORY_ORDER);

  for (const b of brands) {
    if (!known.has(b.category)) {
      console.warn(
        `[brands] "${b.slug}" has off-taxonomy category "${b.category}" — excluded from /brands. Fix the registry.`,
      );
    }
  }

  return CATEGORY_ORDER.map((category) => {
    const cards = brands.filter((b) => b.category === category).map((b) => toCard(b, preference));
    const live = cards.filter((c) => c.live).sort((a, b) => (b.mo ?? 0) - (a.mo ?? 0));
    const thin = cards.filter((c) => !c.live);
    // Universe ghosts, minus anything already in the store under any grade.
    const inStore = new Set(cards.map((c) => c.brandName.toLowerCase()));
    const ghostNames = (GHOST_UNIVERSE[category] ?? []).filter((n) => !inStore.has(n.toLowerCase()));
    return {
      category,
      cards: [...live, ...thin],
      ghostNames,
      liveCount: live.length,
      totalCount: cards.length + ghostNames.length,
    };
  }).filter((row) => row.totalCount > 0);
}
