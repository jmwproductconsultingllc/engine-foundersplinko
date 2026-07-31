/**
 * lib/publicFigures.ts — THE PUBLIC SURFACE. SERVER ONLY.
 *
 * Builds the small set of already-free figures that the glass hero needs in
 * order to make sense to someone who arrived from an ad.
 *
 * WHY THIS FILE EXISTS
 *
 * lib/brandFacts.ts already classifies which fields are public. Read it: the
 * Item 19 monthly headline is marked "(PUBLIC by middle-path design)", Item 7
 * low/high is "(PUBLIC)", system scale is "(PUBLIC)". Those figures render on
 * the /brands library tile and in the SERP snippet today, on pages with no
 * paywall in front of them.
 *
 * Glass mode lost every one of them, and not by decision. buildReportShell()
 * builds from lib/reportSource.ts — the arithmetic graph — and never consults
 * the public-facts resolver at all, so a visitor who clicks a tile reading
 * "$115k/mo revenue · from $364k to open" lands on a page whose first concrete
 * statement is "Below the disclosed minimum" with nothing above it to say below
 * WHAT. The number was on the tile, it is not in the ad, and the landing page
 * had stopped saying it. That is not a moat, it is an orphaned page.
 *
 * So this is not a widening of the free tier. It is glass applying a policy it
 * dropped by accident.
 *
 * THE RULE THIS FILE IS BOUND BY
 *
 * A figure may appear here only if it is ALREADY rendered on a public,
 * unpaywalled surface, and it must be formatted by the SAME function that
 * public surface uses. Not "the same rounding" — the same function. That
 * function lives in lib/publicFormat.ts, which has no imports, because the
 * client-side tile has to be able to reach it and must never be able to reach
 * this file. See the header there.
 *
 * WHAT THIS FILE MAY NOT DO
 *
 * It may not compute. Every value here is a projection of resolveBrandFacts(),
 * which is itself a single resolver over the committed record. Nothing here may
 * derive, average, sum, or infer — the moment it does, it is the arithmetic
 * graph wearing a public label, and "the numbers are paid" becomes a thing we
 * say rather than a thing that is true.
 *
 * Guarded by lib/publicHook.test.ts (THE PUBLIC-FIGURE LINT), which asserts per
 * catalog brand that every value on the hook is byte-identical to what the
 * library tile renders, and that the hook's key set is exactly the allowlist in
 * publicFormat.ts. Adding a key without touching that test fails the build.
 */

import type { BrandRecord } from "./brands";
import { resolveBrandFacts } from "./brandFacts";
import {
  compactMonthly,
  compactRange,
  type PublicHook,
} from "./publicFormat";

export type { PublicHook } from "./publicFormat";

/**
 * Build the hook from a committed brand record.
 *
 * SERVER ONLY by dependency: resolveBrandFacts pulls lib/brandFacts.ts, which
 * pulls rent.ts, fees.ts, perUnitRevenue.ts and verify.ts behind it. This file
 * is on the SERVER_ONLY list in lib/glassSeam.test.ts, so a client module that
 * imports it fails the build rather than quietly shipping that graph. The hook
 * reaches the client the way the rest of the shell does: attached in
 * lib/glassGate.ts, already the one server-side place that decides what a glass
 * visitor receives.
 */
export function buildPublicHook(brand: BrandRecord): PublicHook {
  // "revenue" — the same preference app/franchise/[slug]/page.tsx passes to
  // toCard() for the live gate, so the hero and the tile resolve the same
  // cohort. Passing "profit" here would headline a different number than the
  // tile the visitor just clicked, on the same brand, one navigation apart.
  const f = resolveBrandFacts(brand, "revenue");

  return {
    monthly: f.mo != null ? compactMonthly(f.mo) : null,
    monthlyKind: f.mo != null ? f.moKind : null,
    monthlyLabel: f.mo != null ? f.moLabel : null,
    monthlyBasis: f.mo != null ? f.moBasis : null,
    monthlyCaveat: f.mo != null ? f.moCaveat : null,
    monthlySample:
      f.mo != null && f.moUnits != null
        ? `${f.moUnits.toLocaleString("en-US")} ${f.moUnits === 1 ? "unit" : "units"} reporting`
        : null,
    cost: compactRange(f.lo, f.hi),
    units:
      f.units != null
        ? `${f.units.toLocaleString("en-US")} ${f.units === 1 ? "open unit" : "open units"}`
        : null,
    fddEdition: brand.sourceFddYear != null ? `${brand.sourceFddYear} FDD` : null,
    hasItem19: f.i19,
  };
}
