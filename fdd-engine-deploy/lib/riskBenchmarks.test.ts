// lib/riskBenchmarks.test.ts — golden pins for the corpus risk distribution +
// the reframe-vocabulary benchmark copy. CI runs on every push.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { computeRiskBenchmarks, benchmarkFor, overallSpread } from "./riskBenchmarks";
import type { BrandRecord } from "./brands";

async function loadAll(): Promise<BrandRecord[]> {
  const dir = path.join(process.cwd(), "data", "brands");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const out: BrandRecord[] = [];
  for (const f of files) out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
  return out;
}

describe("computeRiskBenchmarks", () => {
  it("overall spread is a real distribution that sums to ~100% over live brands", async () => {
    const b = computeRiskBenchmarks(await loadAll());
    expect(b.overall.total).toBeGreaterThan(50);
    expect(b.overall.high + b.overall.medium + b.overall.low).toBe(b.overall.total);
    const s = overallSpread(b);
    expect(s.high + s.medium + s.low).toBeGreaterThanOrEqual(99);
    expect(s.high + s.medium + s.low).toBeLessThanOrEqual(101);
    // sanity: Medium is the plurality (the doc's "82% Medium+" shape)
    expect(s.medium).toBeGreaterThan(s.low);
  });

  it("per-vertical counts match the doc's spot-checks (F&B 3/6/1, Fitness 6/3/3)", async () => {
    /* RE-PINNED 2026-09-11, to MEASURED values with the cause named for each —
       not to whatever makes the build pass.
         · F&B Medium 5 -> 6: Cascadia Pizza was minted into the vertical when
           the library went 83 -> 99.
         · Fitness & Wellness 7/2/2 -> 6/3/3: the corpus re-score moved risk
           levels there — hydrogen-fitness and SPENGA now refuse to state a
           per-outlet figure, and a refusal is not the same risk as a confident
           wrong number.
       KONA ICE DOES NOT APPEAR IN THIS COUNT, and the reason is worth keeping.
       It moved from Kids & Family to Food & Beverage the same day (its Kids
       category was off-taxonomy, so the grid silently excluded it — the BL-04
       "81 live, 79 rendered" gap). It still does not count here because
       computeRiskBenchmarks skips anything that is not `live`, and Kona Ice is
       graded THIN. That grade was written at mint time in July and the
       re-score does not touch it: `grade` sits at the top level of the record,
       outside `result`. Under today's gradeOf it would read READY. Whether a
       brand with no Item 19 at all should be sellable is a product decision,
       not a test fix.
       If these move again, find the reason before changing the numbers. */
    const b = computeRiskBenchmarks(await loadAll());
    const fb = b.byVertical["Food & Beverage"];
    expect([fb.high, fb.medium, fb.low]).toEqual([3, 6, 1]);
    const fit = b.byVertical["Fitness & Wellness"];
    expect([fit.high, fit.medium, fit.low]).toEqual([6, 3, 3]);
  });
});

describe("benchmarkFor — reframe vocabulary only", () => {
  it("never emits a banned noun or a verdict word", async () => {
    const b = computeRiskBenchmarks(await loadAll());
    for (const tier of ["High", "Medium", "Low"] as const) {
      const copy = benchmarkFor(tier, "Food & Beverage", b);
      const blob = `${copy.overall} ${copy.category ?? ""}`.toLowerCase();
      // LABEL LAW: no "depth/level/analysis/thoroughness/detail", no "risk" verdict
      expect(blob).not.toMatch(/\bdepth\b|\blevel\b|\banalysis\b|thoroughness|\bdetail\b/);
      expect(blob).not.toMatch(/\brisk\b/);
    }
  });

  it("thin verticals (<3 live) get no fabricated 'X of Y' category line", async () => {
    const b = computeRiskBenchmarks(await loadAll());
    const copy = benchmarkFor("High", "No Such Vertical", b);
    expect(copy.category).toBeNull();
  });
});
