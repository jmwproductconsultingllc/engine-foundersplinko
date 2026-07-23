// lib/teaserProps.ts — SERVER-SIDE teaser projection (single-resolver spec,
// 2026-07-20; supersedes the interpreting version and the P0 point-patch).
//
// THE GATING GUARANTEE lives in lib/brandFacts.ts now: BrandDetail is a client
// component, so every prop it receives ships to the browser. BrandFacts simply
// DOES NOT CONTAIN the locked values:
//   - no franchisor net-worth / deficit / total-asset figures
//   - no Item 19 cohort spread (high / median / low)
//   - no tripwire descriptions (category labels only)
// This file is a THIN PROJECTION of BrandFacts — it interprets nothing, so the
// detail page can never disagree with the index card.
// Acceptance: view-source + network tab on /franchise/crumbl contains no
// instance of the deficit figures or cohort spread values.
//
// Call this in the SERVER component (app/franchise/[slug]/page.tsx) and pass
// the result to <BrandDetail teaser={...}/>. Do NOT pass the full card/brand.

import type { BrandRecord } from "./brands";
import { resolveBrandFacts } from "./brandFacts";

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
  mo: number | null;
  moLabel: "average" | "median";
  moKind: "revenue" | "profit";
  /** "disclosed" vs "derived" — the hero must not claim a derived figure was disclosed */
  moBasis: "disclosed" | "derived";
  /** honesty note for a derived/degraded headline (e.g. RPM per-unit derivation) */
  moCaveat: string | null;
  mn: number | null; // unitsReported → hero cohort sampleSize → null
  cohortCount: number; // count only — the spread values stay server-side

  /** Item 7 — visible (credibility) */
  lo: number | null;
  hi: number | null;

  /** fees — visible */
  royaltyPct: number | null;
  /** flat-fee royalty note (e.g. "$1,000–$1,750/mo flat") — render instead of "—" */
  flatRoyaltyNote: string | null;
  brandFundPct: number | null;

  /** system scale — visible */
  units: number | null;
  openedLastYear: number | null;
  closedLastYear: number | null;

  /** verdict — level visible; the WHY is locked */
  risk: string | null;
  /** true → render the locked financial-condition tease. No figures ship. */
  hasFinancialConditionFlag: boolean;
  /** existence-only tripwire teases (max 3) */
  tripwires: TeaserTripwire[];

  /** Risk Reframe — "N things to verify" (real count, floored 1) + top labels.
   *  The shared <DiligenceToVerify> owns the thing/things pluralization + color. */
  verifyCount: number;
  verifyItems: string[];
}

/** Thin projection: BrandFacts → TeaserCard. No interpretation happens here. */
export function toTeaserCard(brand: BrandRecord): TeaserCard {
  const f = resolveBrandFacts(brand, "revenue");
  return {
    slug: f.slug,
    brandName: f.brandName,
    category: f.category,
    vertical: f.vertical,
    parseQuality: f.parseQuality,
    mo: f.mo,
    moLabel: f.moLabel,
    moKind: f.moKind,
    moBasis: f.moBasis,
    moCaveat: f.moCaveat,
    mn: f.moUnits,
    cohortCount: f.cohortCount,
    lo: f.lo,
    hi: f.hi,
    royaltyPct: f.royaltyPct,
    flatRoyaltyNote: f.flatRoyaltyNote,
    brandFundPct: f.brandFundPct,
    units: f.units,
    openedLastYear: f.openedLastYear,
    closedLastYear: f.closedLastYear,
    risk: f.risk,
    hasFinancialConditionFlag: f.hasFinancialConditionFlag,
    tripwires: f.tripwireLabels.map((label) => ({ label })),
    verifyCount: f.verifyCount,
    verifyItems: f.verifyItems,
  };
}
