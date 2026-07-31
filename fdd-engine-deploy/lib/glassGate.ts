/**
 * lib/glassGate.ts — the one place that decides whether a brand gets glass.
 *
 * SERVER ONLY. Imports the adapter, which reaches the whole arithmetic graph
 * (ladder, churn, callList, verify, rentCorrection). Nothing in components/
 * may import this file — see the ADAPTER SEAM note in lib/reportShell.ts.
 *
 * Three independent gates, and a brand needs all three:
 *
 *   1. GLASS_ENABLED           — the launch switch, defaults OFF (lib/features.ts)
 *   2. the shell builds at all — an adapter throw serves the teaser, never a 500
 *   3. qualifiesForGlass()     — measured thinness floor + required sections
 *
 * Every failure path returns null, and null means "serve the teaser we have
 * today." There is no path through this function that renders a half-built
 * glass page. READY IS EARNED, NEVER INHERITED.
 */

/* No `import "server-only"` here: that package is not a dependency of this
   repo and it only errors when a "use client" module imports it directly — it
   cannot see a transitive path. THE SEAM LINT (lib/glassSeam.test.ts) asserts
   the whole boundary instead, and it runs in preflight. */

import {
  buildReportShell,
  qualifiesForGlass,
  DEFAULT_GLASS_CONFIG,
  type ReportShell,
} from "./reportShell";
import { reportSourceFromComputed } from "./reportSource";
import { buildPublicHook } from "./publicFigures";
import { GLASS_ENABLED } from "./features";
import type { BrandRecord } from "./brands";

/**
 * Which page type a visitor asked for, if they asked.
 *
 * `?v=glass` and `?v=teaser` exist so prod can be checked on a real phone
 * before the flag flips, and so a support conversation can be pointed at the
 * other variant without a deploy. `?v=glass` still cannot force a page for a
 * brand that fails the thinness gate — an override that can conjure a page out
 * of a record with no Item 7 range is not a QA tool, it is a way to show a
 * customer an empty promise.
 */
export type GlassOverride = "glass" | "teaser" | null;

export function parseGlassOverride(v: string | undefined): GlassOverride {
  return v === "glass" || v === "teaser" ? v : null;
}

export interface GlassDecision {
  /** Non-null only when the page should render ReportGlass. */
  shell: ReportShell | null;
  /**
   * Why, for the build log and for answering "why is this brand still on the
   * teaser" without re-deriving it by hand. Never rendered to a visitor.
   */
  reason:
    | "ok"
    | "flag-off"
    | "forced-teaser"
    | "too-thin"
    | "adapter-threw";
}

export function glassDecision(
  brand: BrandRecord,
  override: GlassOverride = null,
): GlassDecision {
  if (override === "teaser") return { shell: null, reason: "forced-teaser" };

  // The override can bypass the launch switch — that is its job, checking prod
  // before the flip. It cannot bypass the thinness gate below.
  if (!GLASS_ENABLED && override !== "glass") {
    return { shell: null, reason: "flag-off" };
  }

  let shell: ReportShell;
  try {
    shell = buildReportShell(
      reportSourceFromComputed(brand),
      DEFAULT_GLASS_CONFIG,
    );
  } catch (e) {
    // A brand record shaped in a way the adapter did not anticipate must cost
    // us the glass page, not the page. The teaser below is a working product.
    console.error(
      `[glass] adapter threw for ${brand.slug}, serving teaser:`,
      e instanceof Error ? e.message : e,
    );
    return { shell: null, reason: "adapter-threw" };
  }

  if (!qualifiesForGlass(shell, DEFAULT_GLASS_CONFIG)) {
    return { shell: null, reason: "too-thin" };
  }

  // The already-public figures, attached HERE rather than inside
  // buildReportShell(). Two reasons, and the second is the load-bearing one:
  //
  //  1. This is the only layer holding the BrandRecord, which is what the
  //     public-facts resolver reads. The shell builder sees only the arithmetic
  //     source and could not build the hook if it wanted to.
  //
  //  2. buildReportShell()'s guarantee is that it never puts a figure ON a
  //     shell. Keeping that literally true — rather than true-except-for-one-
  //     field — is what lets lib/reportShell.test.ts stay a proof.
  //
  // A throw here would be a resolver bug on a record that already renders a
  // tile, so it is not caught: it should fail the build, loudly, in
  // generateStaticParams, next to auditBrandFacts().
  return { shell: { ...shell, hook: buildPublicHook(brand) }, reason: "ok" };
}
