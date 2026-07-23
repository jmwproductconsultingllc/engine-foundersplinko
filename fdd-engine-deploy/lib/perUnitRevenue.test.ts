// lib/perUnitRevenue.test.ts — golden pins for the per-unit → per-franchise
// revenue derivation (RPM class). CI runs this on every push.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { derivePerFranchiseRevenue } from "./perUnitRevenue";
import type { Item19Cohort } from "./schema";

async function cohortsOf(slug: string): Promise<Item19Cohort[]> {
  const p = path.join(process.cwd(), "data", "brands", `${slug}.json`);
  const b = JSON.parse(await fs.readFile(p, "utf8"));
  return b.result.extracted.item19?.cohorts ?? [];
}

describe("derivePerFranchiseRevenue", () => {
  it("RPM: median×median headline $43,624/mo, range up to average×average $98,627/mo", async () => {
    // FDD Item 19 (2026 FDD, Overall cohort): median rev/unit $4,256 × median
    // 123 units = $43,624/mo headline; avg $4,552 × avg 260 units = $98,627/mo top.
    // Each endpoint keeps its statistic — never average-rev × median-units.
    const d = derivePerFranchiseRevenue(await cohortsOf("real-property-management"));
    expect(d).not.toBeNull();
    expect(d!.monthly).toBe(43624);
    expect(d!.perUnitAnnualMedian).toBe(4256);
    expect(d!.perUnitAnnualAvg).toBe(4552);
    expect(d!.medianUnits).toBe(123); // the aggregate 'Overall' cohort, not an age tier
    expect(d!.meanUnits).toBe(260);
    expect(d!.lo).toBe(43624);
    expect(d!.hi).toBe(98627);
    expect(d!.caveat).toMatch(/derived/i);
    expect(d!.caveat).toMatch(/not\s+disclosed/i);
  });

  it("returns null when there is no per-unit revenue basis (normal brands)", async () => {
    const d = derivePerFranchiseRevenue(await cohortsOf("crumbl"));
    expect(d).toBeNull();
  });

  it("returns null when units-managed (with a median) is absent", () => {
    const cohorts = [
      { label: "Revenue per Unit", basis: "Average annual revenue per managed unit", revenueType: "gross_sales", annualRevenue: 4552, avgMonthlyRevenue: null, sampleSize: 421 },
    ] as unknown as Item19Cohort[];
    expect(derivePerFranchiseRevenue(cohorts)).toBeNull();
  });
});
