// lib/brands.ts
// Brand store + taxonomy + directory model for /brands and /franchise/[slug].
//
// SINGLE-RESOLVER (2026-07-20): all fact interpretation moved to
// lib/brandFacts.ts::resolveBrandFacts(). toCard() below is a THIN PROJECTION
// of BrandFacts — it interprets nothing, so the index card can never disagree
// with the detail teaser. Locked values (risk reasons, tripwire descriptions,
// deficit figures, cohort spreads) are NOT on BrandCard: /brands passes cards
// into a client component, so anything here serializes into the public payload.

import fs from "node:fs/promises";
import path from "node:path";
import type { DiligenceResult } from "./types";
import { normalizeRoyaltyPct } from "./fees";
import { resolveBrandFacts, pickHeroCohort, costRange, type HeroPick } from "./brandFacts";

export { normalizeRoyaltyPct }; // one import site for page code
export { resolveBrandFacts, pickHeroCohort, costRange }; // legacy import sites
export type { HeroPick };

// ---------------------------------------------------------------------------
// Store shape (matches scripts/jsonl-to-brands.ts output)
// ---------------------------------------------------------------------------

export interface BrandRecord {
  slug: string;
  brandName: string;
  category: string;
  /** Top-level vertical (batch2+). Absent on the original kids records —
   *  verticalOf() defaults those to "Kids & Family" (zero migration). */
  vertical?: string;
  /** Internal extraction-quality marker (batch2+). "degraded-fallback" =
   *  parsed from a 100-page-trimmed doc; NEVER surfaced to users — rendered
   *  only as a data attribute so we know which pages silently upgrade after
   *  the clean re-parse. */
  parseQuality?: string; // known: clean | degraded-fallback | full | manual-verified
  grade: "READY" | "THIN";
  sourceFddYear: number | null;
  generatedAt: string;
  sourceStem?: string;
  result: DiligenceResult;
}

export type CohortPreference = "revenue" | "profit";

export interface BrandCard {
  brandName: string;
  slug: string;
  category: string;
  grade: "READY" | "THIN";
  live: boolean; // clickable card vs ghost
  risk: string | null;
  i19: boolean;
  mo: number | null;
  moLabel: "average" | "median";
  moKind: "revenue" | "profit" | null;
  moCaveat: string | null;
  mn: number | null; // unitsReported → hero cohort sampleSize → null
  lo: number | null;
  hi: number | null;
  costSource: "declared" | "summed" | null;
  costMismatch: boolean; // sum diverges >10% from declared — queue Item 7 repair
  /** last-resort investment figure when Item 7 low/high are absent */
  buildoutMid: number | null;
  vertical: string;
  parseQuality: string;
  royaltyPct: number | null; // normalized (R2)
  /** flat-fee royalty note (e.g. "$1,000–$1,750/mo flat") — render instead of "—" */
  flatRoyaltyNote: string | null;
  brandFundPct: number | null;
  units: number | null;
  openedLastYear: number | null;
  closedLastYear: number | null;
  /** locked-flag existence only — no figures, no reasons */
  hasFinancialConditionFlag: boolean;
  /** category labels ONLY (max 3) — descriptions never reach this object;
   *  /brands serializes cards into a client component payload. */
  tripwires: { label: string }[];
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
// Verticals (multi-vertical launch). /brands rows = VERTICAL_ORDER. Kids keeps
// its sub-category sections (CATEGORY_ORDER above becomes its SUBCATEGORIES);
// other verticals render flat until they earn sub-sections (>8 brands).
// ---------------------------------------------------------------------------

export const KIDS_VERTICAL = "Kids & Family";

export const VERTICAL_ORDER: readonly string[] = [
  KIDS_VERTICAL,
  "Home & Property Services",
  "Fitness & Wellness",
  "Food & Beverage",
  "B2B & Business Services",
  "Beauty & Personal Care",
  "Sports & Entertainment",
  "Senior Care",
  "Real Estate",
  "Pets",
  "Auto & Transport",
];

export const SUBCATEGORIES: Record<string, readonly string[]> = {
  [KIDS_VERTICAL]: CATEGORY_ORDER,
};

/** Vertical for a record — absent field defaults to Kids & Family so the
 *  original 18 kids records need zero migration. */
export function verticalOf(b: BrandRecord): string {
  return b.vertical ?? KIDS_VERTICAL;
}

/** Best-effort vertical for a live in-session DiligenceResult (upload flow
 *  post-parse chip). Prefers an explicit vertical if the engine ever emits
 *  one; falls back to conceptType. Returns null when unclassifiable — render
 *  no chip rather than a wrong one. */
export function verticalForResult(result: DiligenceResult): string | null {
  const explicit = (result as unknown as { vertical?: string }).vertical;
  if (explicit && VERTICAL_ORDER.includes(explicit)) return explicit;
  const map: Record<string, string> = {
    education_childcare: KIDS_VERTICAL,
    food_beverage_qsr: "Food & Beverage",
    fitness_gym: "Fitness & Wellness",
    home_services: "Home & Property Services",
    senior_care: "Senior Care",
    real_estate: "Real Estate",
    pet_services: "Pets",
    automotive: "Auto & Transport",
    beauty_personal_care: "Beauty & Personal Care",
    b2b_services: "B2B & Business Services",
  };
  const ct = result.extracted?.conceptType;
  return (ct && map[ct]) || null;
}

// ---------------------------------------------------------------------------
// Card model
// ---------------------------------------------------------------------------

export function toCard(brand: BrandRecord, preference: CohortPreference = "revenue"): BrandCard {
  // THIN PROJECTION of BrandFacts — no interpretation here (single-resolver).
  const f = resolveBrandFacts(brand, preference);
  return {
    brandName: f.brandName,
    slug: f.slug,
    category: f.category,
    grade: f.grade,
    live: f.live,
    risk: f.risk,
    i19: f.i19,
    mo: f.mo,
    moLabel: f.moLabel,
    moKind: f.mo != null ? f.moKind : null,
    moCaveat: f.moCaveat,
    mn: f.moUnits,
    lo: f.lo,
    hi: f.hi,
    costSource: f.costSource,
    costMismatch: f.costMismatch,
    buildoutMid: f.buildoutMid,
    vertical: f.vertical,
    parseQuality: f.parseQuality,
    royaltyPct: f.royaltyPct,
    flatRoyaltyNote: f.flatRoyaltyNote,
    brandFundPct: f.brandFundPct,
    units: f.units,
    openedLastYear: f.openedLastYear,
    closedLastYear: f.closedLastYear,
    hasFinancialConditionFlag: f.hasFinancialConditionFlag,
    tripwires: f.tripwireLabels.map((label) => ({ label })),
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
  ghostNames: string[];
  liveCount: number;
  totalCount: number;
}

export interface VerticalRow {
  vertical: string;
  /** present only for verticals with SUBCATEGORIES (Kids & Family today) */
  subsections: CategoryRow[] | null;
  /** flat card list for verticals without subsections */
  cards: BrandCard[];
  liveCount: number;
  totalCount: number;
}

function buildCategoryRows(
  cards: BrandCard[],
  subcats: readonly string[],
  withGhosts: boolean,
): CategoryRow[] {
  return subcats
    .map((category) => {
      const inCat = cards.filter((c) => c.category === category);
      const live = inCat.filter((c) => c.live).sort((a, b) => (b.mo ?? 0) - (a.mo ?? 0));
      const thin = inCat.filter((c) => !c.live);
      const inStore = new Set(inCat.map((c) => c.brandName.toLowerCase()));
      const ghostNames = withGhosts
        ? (GHOST_UNIVERSE[category] ?? []).filter((n) => !inStore.has(n.toLowerCase()))
        : [];
      return {
        category,
        cards: [...live, ...thin],
        ghostNames,
        liveCount: live.length,
        totalCount: inCat.length + ghostNames.length,
      };
    })
    .filter((row) => row.totalCount > 0);
}

/** Multi-vertical directory: rows = VERTICAL_ORDER. Kids & Family keeps its
 *  sub-category sections and ghost universe (unchanged vs. the kids-only
 *  launch — Kona Ice's off-taxonomy exclusion behaves identically because a
 *  Kids-defaulted record whose category isn't a Kids subcategory still
 *  renders nowhere, with a warn). Other verticals render flat, live cards
 *  sorted by monthly hero desc. */
export async function listVerticalDirectory(
  preference: CohortPreference = "revenue",
): Promise<VerticalRow[]> {
  const brands = await listBrands();
  const knownVerticals = new Set(VERTICAL_ORDER);

  const rows: VerticalRow[] = [];
  for (const vertical of VERTICAL_ORDER) {
    const inVert = brands.filter((b) => verticalOf(b) === vertical);
    const cards = inVert.map((b) => toCard(b, preference));
    const subcats = SUBCATEGORIES[vertical];

    if (subcats) {
      const subsections = buildCategoryRows(cards, subcats, true);
      const placed = new Set(subsections.flatMap((s) => s.cards.map((c) => c.slug)));
      for (const c of cards) {
        if (!placed.has(c.slug)) {
          console.warn(
            `[brands] "${c.slug}" (${vertical}) has off-taxonomy category "${c.category}" — excluded. Fix the registry.`,
          );
        }
      }
      const liveCount = subsections.reduce((a, s) => a + s.liveCount, 0);
      const totalCount = subsections.reduce((a, s) => a + s.totalCount, 0);
      if (totalCount > 0) rows.push({ vertical, subsections, cards: [], liveCount, totalCount });
    } else {
      const live = cards.filter((c) => c.live).sort((a, b) => (b.mo ?? 0) - (a.mo ?? 0));
      const thin = cards.filter((c) => !c.live);
      if (cards.length > 0)
        rows.push({
          vertical,
          subsections: null,
          cards: [...live, ...thin],
          liveCount: live.length,
          totalCount: cards.length,
        });
    }
  }

  for (const b of brands) {
    if (!knownVerticals.has(verticalOf(b))) {
      console.warn(
        `[brands] "${b.slug}" has unknown vertical "${b.vertical}" — excluded from /brands. Fix the record.`,
      );
    }
  }
  return rows;
}

/** Legacy kids-only view (original launch shape). Prefer listVerticalDirectory. */
export async function listDirectory(preference: CohortPreference = "revenue"): Promise<CategoryRow[]> {
  const brands = await listBrands();
  const kids = brands.filter((b) => verticalOf(b) === KIDS_VERTICAL).map((b) => toCard(b, preference));
  return buildCategoryRows(kids, CATEGORY_ORDER, true);
}
