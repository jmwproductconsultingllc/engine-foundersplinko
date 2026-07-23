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

  it("P2(a) RPM: per-unit revenue derived to per-franchise, tagged 'derived' (not $379)", async () => {
    const f = resolveBrandFacts(await load("real-property-management"));
    expect(f.mo).toBe(43624); // median $4,256/yr per unit × 123 median units ÷ 12
    expect(f.moBasis).toBe("derived"); // never claimed as franchisor-disclosed
    expect(f.moDegraded).toBe(true);
    expect(f.moCaveat).toMatch(/derived/i);
    expect(f.live).toBe(true);
  });

  it("P2(a') Schooley: full-time franchisee headline beats the part-time tier", async () => {
    const f = resolveBrandFacts(await load("schooley-mitchell"));
    expect(f.mo).toBe(18629); // full-time ($18,629/mo), not part-time ($1,229/mo)
  });

  it("P2(c) no live brand ships an Item 19 revenue headline under $2k/mo", async () => {
    const brands = await loadAll();
    for (const b of brands) {
      const f = resolveBrandFacts(b);
      if (f.live && f.mo != null && f.moKind === "revenue") {
        expect(f.mo).toBeGreaterThanOrEqual(2000);
      }
    }
  });

  it("per-unit guard: a headline equal to a raw per-unit figure ÷12 fails the audit", () => {
    // The RPM $379 class, generalized: any per-unit disclosure whose rendered
    // headline equals the raw per-unit monthly (multiplier dropped) must throw —
    // caught by VALUE, so a false moBasis "derived" (e.g. a 1-unit degenerate
    // derivation) can't smuggle it through.
    const leak = {
      slug: "one-unit-leak",
      brandName: "X",
      category: "x",
      vertical: "x",
      status: "live",
      result: {
        extracted: {
          item19: {
            hasItem19: true,
            cohorts: [
              { label: "All — Annual Revenue per Unit", ownership: "franchised", revenueType: "gross_sales", sampleSize: 400, avgMonthlyRevenue: null, annualRevenue: 4552, basis: "per property unit managed" },
              { label: "All — Units Managed", ownership: "franchised", revenueType: "other", sampleSize: 400, avgMonthlyRevenue: null, annualRevenue: null, basis: "Average 1 units managed per franchise overall; median 1 units." },
            ],
          },
        },
      },
    } as unknown as BrandRecord;
    expect(() => auditBrandFacts([leak])).toThrow(/RAW per-unit figure/);
  });

  it("per-unit guard: real RPM (median×median derivation) passes the guard", async () => {
    // The honest derivation ($43,624/mo, 123 units) is NOT a raw per-unit ÷12,
    // so the same guard lets it through — proving the guard discriminates the
    // bug from the fix, not just "any per-unit brand".
    const rpm = await load("real-property-management");
    expect(() => auditBrandFacts([rpm])).not.toThrow();
  });

  it("Risk Reframe: crumbl → 3 things to verify, labeled (fee stack / tripwires / financial condition)", async () => {
    const f = resolveBrandFacts(await load("crumbl"));
    expect(f.verifyCount).toBe(3); // real riskReasons length, not a per-tier constant
    expect(f.verifyItems).toContain("The fee stack");
    expect(f.verifyItems).toContain("Operational tripwires");
    expect(f.verifyItems).toContain("Franchisor financial condition");
  });

  it("Risk Reframe: a clean/Low brand floors at 1 (reassurance, never 0)", async () => {
    const f = resolveBrandFacts(await load("the-ups-store"));
    expect(f.risk).toBe("Low");
    expect(f.verifyCount).toBe(1); // "1 thing to verify" — emerald reassurance
    expect(f.verifyItems.length).toBeGreaterThanOrEqual(1);
  });

  it("Risk Reframe: verifyItems come ONLY from the closed label set (no raw reason text leaks)", async () => {
    // The guarantee: raw reason text ("Above-market royalty at 8%", which carries
    // a locked figure) can NEVER reach a surface — only these curated labels ship.
    const ALLOWED = new Set([
      "Franchisor financial condition",
      "The fee stack",
      "Operational tripwires",
      "Item 19 earnings basis",
      "Startup cost",
      "Unit stability",
      "Territory rights",
      "Disclosures to review",
    ]);
    const brands = await loadAll();
    for (const b of brands) {
      const f = resolveBrandFacts(b);
      for (const item of f.verifyItems) expect(ALLOWED.has(item)).toBe(true);
      expect(f.verifyCount).toBeGreaterThanOrEqual(1);
      expect(f.verifyItems.length).toBeLessThanOrEqual(3);
    }
  });

  it("gating: no locked vocabulary on the facts object", async () => {
    const f = resolveBrandFacts(await load("crumbl"));
    const keys = Object.keys(f).join(",");
    expect(keys).not.toMatch(/riskReason|description|netWorth|deficit|cohorts/i);
    // tripwires are labels only
    for (const label of f.tripwireLabels) expect(typeof label).toBe("string");
  });
});
