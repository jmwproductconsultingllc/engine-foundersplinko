// lib/riskBenchmarks.ts — corpus-level risk distribution for the Risk Reframe
// context banner + inline benchmark ("35% of brands have more to verify",
// "Typical for Food & Beverage: 8 of 9 have items to check").
//
// This is a CORPUS fact, not a per-brand one — it can't live in resolveBrandFacts
// (which sees one brand). Compute it ONCE server-side from every live brand, pass
// the result as a prop to the shared <DiligenceToVerify>. Pure + deterministic +
// golden-tested (lib/riskBenchmarks.test.ts) so the numbers can't silently drift.
//
// "More to verify" = High tier, "a moderate few" = Medium, "run clean" = Low —
// the reframe's own vocabulary (never "high/medium/low RISK"). Only LIVE brands
// count: the distribution must match what a buyer actually sees in the library.

import type { BrandRecord } from "./brands";
import { resolveBrandFacts } from "./brandFacts";

export type Tier = "High" | "Medium" | "Low";

export interface TierCounts {
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface RiskBenchmarks {
  overall: TierCounts;
  /** vertical name → counts (only verticals with ≥1 live brand) */
  byVertical: Record<string, TierCounts>;
}

const EMPTY = (): TierCounts => ({ high: 0, medium: 0, low: 0, total: 0 });

function tally(counts: TierCounts, tier: Tier): void {
  if (tier === "High") counts.high++;
  else if (tier === "Medium") counts.medium++;
  else counts.low++;
  counts.total++;
}

/** Compute the live-brand risk distribution, overall and per vertical. */
export function computeRiskBenchmarks(brands: BrandRecord[]): RiskBenchmarks {
  const overall = EMPTY();
  const byVertical: Record<string, TierCounts> = {};
  for (const b of brands) {
    const f = resolveBrandFacts(b);
    if (!f.live || (f.risk !== "High" && f.risk !== "Medium" && f.risk !== "Low")) continue;
    const tier = f.risk as Tier;
    tally(overall, tier);
    (byVertical[f.vertical] ??= EMPTY());
    tally(byVertical[f.vertical], tier);
  }
  return { overall, byVertical };
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

/** Whole-corpus spread percentages for the context banner / spread strip. */
export function overallSpread(b: RiskBenchmarks): { high: number; medium: number; low: number } {
  const { high, medium, low, total } = b.overall;
  return { high: pct(high, total), medium: pct(medium, total), low: pct(low, total) };
}

export interface BenchmarkCopy {
  /** one-liner: where THIS brand's count sits vs. the whole corpus */
  overall: string;
  /** one-liner: how common "has items to verify" is in this brand's vertical */
  category: string | null;
  /** spread percentages for the inline strip */
  spread: { high: number; medium: number; low: number };
}

/**
 * Phrase the benchmark for one brand's tier + vertical against the corpus.
 * Reframe vocabulary only — never "high/medium/low risk". Pure string-building;
 * the component decides layout. Returns null category when the vertical is too
 * thin (<3 live) to make an honest "X of Y" statement.
 */
export function benchmarkFor(
  tier: Tier,
  vertical: string,
  b: RiskBenchmarks,
): BenchmarkCopy {
  const spread = overallSpread(b);
  const o = b.overall;

  // Overall: frame this brand's tier as position in the pack, never a verdict.
  let overall: string;
  if (tier === "High") {
    overall = `A few more than most — about ${spread.high}% of the brands we've analyzed have this many to check.`;
  } else if (tier === "Medium") {
    overall = `Right in the middle — like the ${spread.medium}% of brands with a moderate few to verify.`;
  } else {
    overall = `Cleaner than most — among the ${spread.low}% that run clean, with just a baseline look.`;
  }

  // Category: "X of Y in <vertical> have items to check" (High + Medium = has-items).
  const v = b.byVertical[vertical];
  let category: string | null = null;
  if (v && v.total >= 3) {
    const hasItems = v.high + v.medium;
    category = `Typical for ${vertical}: ${hasItems} of ${v.total} have items worth checking.`;
  }

  return { overall, category, spread };
}
