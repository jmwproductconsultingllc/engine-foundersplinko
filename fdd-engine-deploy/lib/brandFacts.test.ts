// lib/brandFacts.test.ts — golden pins + full-corpus audit for the single
// resolver (facts-resolver spec, 2026-07-20). CI runs this on every push, so
// a resolution regression is a red X before a user sees it.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveBrandFacts, auditBrandFacts } from "./brandFacts";
import type { BrandRecord } from "./brands";

async function loadAll(): Promise<BrandRecord[]> {
  const dir = path.join(process.cwd(), "data", "brands");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const out: BrandRecord[] = [];
  for (const f of files) {
    out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as BrandRecord);
  }
  return out;
}

async function load(slug: string): Promise<BrandRecord> {
  const p = path.join(process.cwd(), "data", "brands", `${slug}.json`);
  return JSON.parse(await fs.readFile(p, "utf8")) as BrandRecord;
}

describe("brand-facts corpus audit", () => {
  it("resolves every store file with zero violations", async () => {
    const brands = await loadAll();
    expect(brands.length).toBeGreaterThan(50);
    expect(() => auditBrandFacts(brands)).not.toThrow();
  });
});

describe("resolver golden pins (spec acceptance matrix)", () => {
  it("crumbl (batch-3): networkAverageMonthly headline, 776 units, 8% royalty", async () => {
    const f = resolveBrandFacts(await load("crumbl"));
    expect(f.mo).toBe(94930);
    expect(f.moLabel).toBe("average");
    expect(f.moKind).toBe("revenue");
    expect(f.moUnits).toBe(776);
    expect(f.royaltyPct).toBe(8);
    expect(f.flatRoyaltyNote).toBeNull();
  });

  it("sharkey's: flat royalty renders as a note, never a bare dash", async () => {
    const f = resolveBrandFacts(await load("sharkey-s-cuts-for-kids"));
    expect(f.royaltyPct).toBeNull();
    expect(f.flatRoyaltyNote).toMatch(/^\$1,000–\$1,750\/mo flat$/);
  });

  it("sky-zone (older schema): fraction royalty normalized, unitsReported chain", async () => {
    const f = resolveBrandFacts(await load("sky-zone"));
    expect(f.royaltyPct).toBe(6); // 0.06 stored — never "0.06%"
    expect(f.moUnits).toBe(106);
    expect(f.mo).not.toBeNull(); // real Item 19 data must never render "Not disclosed"
  });

  it("jan-pro: whole-percent record keeps its 0.5% brand fund (never 50%)", async () => {
    const f = resolveBrandFacts(await load("jan-pro-franchise-development"));
    expect(f.royaltyPct).toBe(4);
    expect(f.brandFundPct).toBe(0.5);
  });

  it("express-employment: fraction record normalizes to the real 40%-of-margin royalty", async () => {
    const f = resolveBrandFacts(await load("express-employment-professionals"));
    expect(f.royaltyPct).toBe(40);
    expect(f.brandFundPct).toBe(0.6);
  });

  it("golftrk: investment.lowTotal/highTotal fallback (no item17 range)", async () => {
    const f = resolveBrandFacts(await load("golftrk"));
    expect(f.lo).not.toBeNull();
    expect(f.hi).not.toBeNull();
    expect(f.costSource).toBe("declared");
  });

  it("gating: no locked vocabulary on the facts object", async () => {
    const f = resolveBrandFacts(await load("crumbl"));
    const keys = Object.keys(f).join(",");
    expect(keys).not.toMatch(/riskReason|description|netWorth|deficit|cohorts/i);
    // tripwires are labels only
    for (const label of f.tripwireLabels) expect(typeof label).toBe("string");
  });
});
