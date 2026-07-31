/**
 * lib/publicFormat.ts — how a public figure is written down. ZERO DEPENDENCIES.
 *
 * WHY THIS IS ITS OWN FILE, AND NOT THE BOTTOM OF publicFigures.ts
 *
 * The formatter has to be reachable from a "use client" component — the /brands
 * tile is one, and the whole point of this exercise is that the tile and the
 * glass hero cannot print the same figure differently. The RESOLVER must not be
 * reachable from one: resolveBrandFacts() pulls rent.ts, fees.ts,
 * perUnitRevenue.ts and verify.ts behind it, and shipping that graph to the
 * browser is exactly the thing THE SEAM LINT exists to stop.
 *
 * Those two requirements are in direct conflict inside one module. So they are
 * two modules, and the conflict is resolved by the import graph instead of by
 * everyone remembering. lib/publicFigures.ts is on the server-only list in
 * lib/glassSeam.test.ts; this file has no imports at all and never will.
 *
 * If you are about to add an import to this file, that is the signal that the
 * thing you are adding belongs in publicFigures.ts.
 */

/* ------------------------------------------------------------------ *
 * Formatting — one declaration, imported by every surface that shows
 * a public figure.
 * ------------------------------------------------------------------ */

/**
 * "$364k" / "$1.1M". The library tile's format, moved here rather than copied.
 *
 * The compaction is not cosmetic and it is not a rounding preference: it is the
 * reason a public figure can sit on the glass page at all. "$115k" states the
 * order of magnitude the buyer already saw on the tile and withholds the last
 * three digits, which are the report's. A page that printed $115,340 would be
 * giving away a figure no free surface has ever shown.
 *
 * Three hand-typed copies of this function existed before this file: the local
 * usd() in components/BrandCard.tsx, ogUsd() in lib/ogCopy.ts, and the one the
 * glass hero was about to grow. Two copies of a declaration always drift — this
 * repo has now paid for that defect four times (basis colours, the CaptureSheet
 * headline, ogUsd, and this). THE PUBLIC-FIGURE LINT pins the survivors to it.
 */
export function compactUsd(n: number): string {
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : `$${Math.round(n / 1000).toLocaleString("en-US")}k`;
}

/** "$364k–$1.1M", or null when Item 7 discloses no range. En dash, not hyphen. */
export function compactRange(lo: number | null, hi: number | null): string | null {
  return lo != null && hi != null ? `${compactUsd(lo)}–${compactUsd(hi)}` : null;
}

/**
 * "$115k" from a monthly figure. Deliberately NOT compactUsd: a monthly
 * headline never reaches $1M, and if a record ever produced one, "$1.2M/mo"
 * would be a data error rendered as a boast. This form makes the error legible.
 */
export function compactMonthly(mo: number): string {
  return `$${Math.round(mo / 1000).toLocaleString("en-US")}k`;
}

/* ------------------------------------------------------------------ *
 * The hook — shape only. Construction lives in lib/publicFigures.ts.
 * ------------------------------------------------------------------ */

/**
 * The figures on a brand that are ALREADY free, in one place.
 *
 * DISPLAY STRINGS ONLY. Never raw numbers. Two independent reasons, and both
 * matter.
 *
 * 1. A raw number on the shell is a raw number in the RSC payload, and the
 *    payload is the page source. `mo: 115340` would sit in view-source at full
 *    precision no matter how the markup rounds it — which is the exact defect
 *    THE RSC PAYLOAD CHECK exists to catch, arrived at by a different door.
 *
 * 2. A string cannot be re-derived. A component handed `mo` can multiply it by
 *    12; a component handed "$115k" can only print it. The type system is doing
 *    policy work here, on purpose.
 *
 * Counted fields carry their noun ("1,046 units reporting", not "1,046") so
 * that no field on this object parses as a bare number — payloadFigures() in
 * components/ReportGlass.test.tsx walks numeric strings too, and a hook that
 * needed an exemption from the leak test would be a hook worth refusing.
 */
export interface PublicHook {
  /** "$115k" — the Item 19 monthly headline, exactly as the tile renders it. */
  monthly: string | null;
  /** What the figure IS. Never render one as the other. */
  monthlyKind: "revenue" | "profit" | null;
  /** "average" | "median" — the tile's moLabel, said out loud. */
  monthlyLabel: "average" | "median" | null;
  /**
   * "disclosed" = the franchisor stated it. "derived" = we computed it from
   * disclosed figures. lib/brandFacts.ts: "Surfaces must NEVER claim a derived
   * headline was franchisor-disclosed." The hero reads this field and says
   * which one it is, in words, above the fold.
   */
  monthlyBasis: "disclosed" | "derived" | null;
  /** Applicability note, verbatim from the resolver. Honesty, not a lock. */
  monthlyCaveat: string | null;
  /** "1,046 units reporting" — the sample behind the headline, or null. */
  monthlySample: string | null;
  /** "$364k–$1.1M" — Item 7. The one pair already crossing to the free side. */
  cost: string | null;
  /** "2,193 open units" — system scale, or null. */
  units: string | null;
  /**
   * "2026 FDD" — the edition this was read out of. Null on records predating
   * the sourceFddYear column.
   *
   * Carries the noun for the same reason the counted fields do, and here it is
   * load-bearing rather than stylistic: a bare "2026" matches
   * payloadFigures()' numeric-string pattern in components/ReportGlass.test.tsx
   * and is >= 1000, so a year alone would trip THE RSC PAYLOAD CHECK as if it
   * were a leaked dollar figure. It also reads better.
   */
  fddEdition: string | null;
  /** Whether Item 19 exists at all, independent of whether a headline resolved. */
  hasItem19: boolean;
}

/**
 * The exact key set of PublicHook, as data.
 *
 * THE PUBLIC-FIGURE LINT asserts Object.keys(hook) deep-equals this. That is
 * the whole enforcement mechanism for "no new public figures without a
 * decision": a field added to the interface and populated in buildPublicHook()
 * fails the build until someone edits this array, and editing this array is the
 * moment a human has to say out loud which paid figure just became free.
 *
 * If anyone ever asks to "just also pass the royalty rate," this is the answer.
 */
export const PUBLIC_HOOK_KEYS = [
  "monthly",
  "monthlyKind",
  "monthlyLabel",
  "monthlyBasis",
  "monthlyCaveat",
  "monthlySample",
  "cost",
  "units",
  "fddEdition",
  "hasItem19",
] as const;
