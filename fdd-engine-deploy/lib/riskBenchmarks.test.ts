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

  it("per-vertical counts match the doc's spot-checks (F&B 3/5/1, Fitness 7/2/2)", async () => {
    const b = computeRiskBenchmarks(await loadAll());
    const fb = b.byVertical["Food & Beverage"];
    expect([fb.high, fb.medium, fb.low]).toEqual([3, 5, 1]);
    const fit = b.byVertical["Fitness & Wellness"];
    expect([fit.high, fit.medium, fit.low]).toEqual([7, 2, 2]);
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
