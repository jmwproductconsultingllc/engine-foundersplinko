/**
 * FE-140 · DISCLOSED ALWAYS BEATS BENCHMARK.
 *
 * Two Maids' Item 19 is unusually transparent: charts 1-12, printed pp. 51-62,
 * each disclose Gross Revenues, Direct Labor, Cleaning Materials, Total Cost of
 * Sales and Gross Margin per cohort. Printed page 50 says so in prose before
 * the charts begin.
 *
 * The engine read the revenue line and nothing else. It filled rungs 6 and 7
 * with "Home & trade services (mobile / low-overhead)" category bands and then
 * printed, as a hardcoded sentence, "an FDD is not required to disclose cost of
 * goods, labor, or operating costs, and no such figures were read from this
 * one." The first clause is true. The second was false for this filing, and it
 * printed regardless. The header read DOCUMENT READS COMPLETE.
 *
 * Cost of goods came out 7-10x overstated (25-40% band against a disclosed
 * 3.8%) and labor understated (20-35% against a disclosed 42.9%). The two
 * errors roughly offset at the optimistic end, which is why the low end looked
 * plausible and nothing appeared wrong — and the pessimistic end, which set the
 * headline, was fabricated.
 */
import { describe, it, expect } from "vitest";
import { buildLadderInput } from "./ladderInput";
import { buildCashLadder } from "./ladder";
import { getSampleResult } from "./sampleReport";
import type { DiligenceResult } from "./types";
import type { ExtractedFDD } from "./schema";

const Q2 = "2nd Quintile (Next 19 Territories by Gross Revenues)";
const Q1 = "1st Quintile (Top 19 Territories by Gross Revenues)";
const ANNUAL = 594_532;
const MONTHLY = ANNUAL / 12; // $49,544

/** The disclosed cost columns, as the charts print them — annual dollars. */
const Q2_COSTS = {
  laborAnnual: 254_990,
  cogsAnnual: 22_471,
  sourcePage: "p.52",
};

function result(cohorts: unknown[], label = Q2): DiligenceResult {
  const s = getSampleResult();
  return {
    ...s,
    extracted: {
      ...s.extracted,
      item19: { ...s.extracted.item19, cohorts },
    } as unknown as ExtractedFDD,
    scoring: {
      ...s.scoring,
      midCohort: { ...s.scoring.midCohort!, label, monthlyRevenue: MONTHLY },
    },
  } as unknown as DiligenceResult;
}

const withCosts = () =>
  result([
    { label: Q2, ownership: "franchised", revenueType: "gross_sales", avgMonthlyRevenue: MONTHLY, basis: "Item 19", disclosedCosts: Q2_COSTS },
  ]);

const topLineOnly = () =>
  result([
    { label: Q2, ownership: "franchised", revenueType: "gross_sales", avgMonthlyRevenue: MONTHLY, basis: "Item 19" },
  ]);

const ladder = (r: DiligenceResult) => buildCashLadder(buildLadderInput(r));

describe("FE-140 — a disclosed cost figure outranks a category band", () => {
  it("rung 7 charges the disclosed direct labor, at the disclosed share", () => {
    const rung = ladder(withCosts()).get("labor")!;
    expect(rung.basis).toBe("disclosed");
    expect(rung.monthly!.lo).toBe(21_249);
    expect(rung.monthly!.lo).toBe(rung.monthly!.hi); // a disclosure is a number, not a band
    expect(rung.pctOfRevenue!.lo).toBeCloseTo(42.9, 1);
    expect(rung.source).toMatch(/Item 19, p\.52/);
    expect(rung.source).toMatch(new RegExp(Q2.slice(0, 12)));
  });

  it("rung 6 charges the disclosed materials — the 7-10x overstatement is gone", () => {
    const rung = ladder(withCosts()).get("cogs")!;
    expect(rung.basis).toBe("disclosed");
    expect(rung.monthly!.lo).toBe(1_873);
    expect(rung.pctOfRevenue!.lo).toBeCloseTo(3.8, 1);
    // The band that used to render here started at 25% of revenue.
    expect(rung.monthly!.lo).toBeLessThan((MONTHLY * 25) / 100);
  });

  it("rung 8 stays a benchmark — utilities and insurance genuinely are not disclosed", () => {
    const rung = ladder(withCosts()).get("otherOpex")!;
    expect(rung.basis).toBe("benchmark");
    expect(rung.monthly!.lo).toBeLessThan(rung.monthly!.hi);
  });

  it("THE HARDCODED SENTENCE — an absence claim may not print over a disclosure", () => {
    const note = buildLadderInput(withCosts()).costs.note ?? "";
    expect(note).not.toMatch(/no such figures were read/i);
    expect(note).toMatch(/Item 19/);
  });

  it("NEGATIVE CASE — a top-line-only filing keeps its bands and its absence copy", () => {
    const L = ladder(topLineOnly());
    expect(L.get("cogs")!.basis).toBe("benchmark");
    expect(L.get("labor")!.basis).toBe("benchmark");
    expect(buildLadderInput(topLineOnly()).costs.note).toMatch(/no such figures were read/i);
  });

  it("COHORT ALIGNMENT — Q1's costs never land on a Q2 ladder", () => {
    const r = result([
      { label: Q1, ownership: "franchised", revenueType: "gross_sales", avgMonthlyRevenue: 90_468, basis: "Item 19", disclosedCosts: { laborAnnual: 900_000, sourcePage: "p.51" } },
      { label: Q2, ownership: "franchised", revenueType: "gross_sales", avgMonthlyRevenue: MONTHLY, basis: "Item 19" },
    ]);
    const rung = ladder(r).get("labor")!;
    expect(rung.basis).toBe("benchmark");
    expect(rung.monthly!.lo).not.toBe(75_000);
  });

  it("a partial disclosure is reported as partial, not as complete", () => {
    const r = result([
      { label: Q2, ownership: "franchised", revenueType: "gross_sales", avgMonthlyRevenue: MONTHLY, basis: "Item 19", disclosedCosts: { laborAnnual: 254_990, sourcePage: "p.52" } },
    ]);
    const input = buildLadderInput(r);
    expect(input.costs.basis).toBe("benchmark"); // the block is not fully disclosed
    expect(ladder(r).get("labor")!.basis).toBe("disclosed"); // but this rung is
    expect(input.costs.note).toMatch(/Some of these rungs/i);
  });

  it("the ladder keeps all 13 rungs and operating EBITDA stays live", () => {
    const L = ladder(withCosts());
    expect(L.rungs).toHaveLength(13);
    expect(L.operatingEbitda).not.toBeNull();
  });
});
