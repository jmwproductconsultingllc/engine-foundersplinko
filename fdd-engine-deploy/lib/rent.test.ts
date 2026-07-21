// lib/rent.test.ts — golden pins for the rent resolver + the Crumbl
// acceptance numbers from the hotfix spec. CI runs this on every push.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveMonthlyRent } from "./rent";
import { applyRentCorrection, applyRentOverride } from "./rentCorrection";
import type { ExtractedFDD } from "./schema";

async function loadBrand(slug: string) {
  const p = path.join(process.cwd(), "data", "brands", `${slug}.json`);
  return JSON.parse(await fs.readFile(p, "utf8"));
}

const base = (over: Record<string, unknown> = {}): ExtractedFDD =>
  ({ item17: { lineItems: [] }, ongoingFees: { flatMonthlyFees: [] }, conceptType: "other", ...over }) as unknown as ExtractedFDD;

describe("resolveMonthlyRent — tier priority", () => {
  it("tier 1: disclosed single number wins outright", () => {
    const r = resolveMonthlyRent(base({ averageRentMonthly: 4200 }), 50000);
    expect(r).toMatchObject({ lo: 4200, hi: 4200, mid: 4200, basis: "disclosed" });
  });

  it("tier 2: rentDetail per_year normalizes to monthly", () => {
    const r = resolveMonthlyRent(
      base({ rentDetail: { rawValue: 60000, unit: "per_year", source: "Item 7, p.30" } }),
      null,
    );
    expect(r).toMatchObject({ mid: 5000, basis: "disclosed" });
  });

  it("tier 2: per_sqft_per_year × sqft ÷ 12", () => {
    const r = resolveMonthlyRent(
      base({ rentDetail: { rawValue: 30, unit: "per_sqft_per_year", squareFootage: 2000, source: "Item 7" } }),
      null,
    );
    expect(r).toMatchObject({ mid: 5000, basis: "disclosed" });
  });

  it("tier 3: disclosed annual range in rent text → /12", () => {
    const r = resolveMonthlyRent(
      base({ rentDetail: { rawValue: null, unit: "unknown", source: "Rent $50,000 - $250,000 per year for 1,600-2,000 sq ft" } }),
      null,
    );
    expect(r).toMatchObject({ lo: 4167, hi: 20833, basis: "disclosed_range" });
  });

  it("tier 4: Item 7 rent-payment line ÷ month horizon", () => {
    const r = resolveMonthlyRent(
      base({ item17: { lineItems: [{ category: "Lease Rental Payments - First 3 Months", low: 15000, high: 60000, recurring: false, notes: "" }] } }),
      null,
    );
    expect(r).toMatchObject({ lo: 5000, hi: 20000, basis: "disclosed_range" });
  });

  it("tier 4 guard: deposit lines are never treated as rent (schema warning)", () => {
    const r = resolveMonthlyRent(
      base({ item17: { lineItems: [{ category: "Lease Deposit and Rent - 3 Months", low: 15000, high: 60000, recurring: false, notes: "" }] } }),
      null,
    );
    expect(r).toBeNull();
  });

  it("tier 5: occupancy benchmark × headline; benchmark inside disclosed range wins", () => {
    const r = resolveMonthlyRent(
      base({
        conceptType: "food_beverage_qsr",
        rentDetail: { rawValue: null, unit: "unknown", source: "annual rent $50,000 - $250,000 per year" },
      }),
      91089,
    );
    expect(r?.basis).toBe("benchmark");
  });

  it("unresolvable → null (the UI split-line rule applies)", () => {
    expect(resolveMonthlyRent(base(), null)).toBeNull();
  });
});

describe("Crumbl acceptance (hotfix spec reference numbers)", () => {
  it("rent resolves to the 6–10% benchmark inside the disclosed range", async () => {
    const crumbl = await loadBrand("crumbl");
    const midRev = crumbl.result.scoring.midCohort.monthlyRevenue;
    expect(Math.round(midRev)).toBe(91089);
    const r = resolveMonthlyRent(crumbl.result.extracted, midRev);
    expect(r).toMatchObject({ lo: 5465, hi: 9109, mid: 7287, basis: "benchmark" });
  });

  it("corrected pro forma: margin ≈ $73,973 mid, DSCR ≈ 5.9, rent never $0", async () => {
    const crumbl = await loadBrand("crumbl");
    const corrected = applyRentCorrection(crumbl.result);
    const s = corrected.scoring!;
    expect(Math.round(s.midCohort!.monthlyEbitda)).toBe(73973);
    expect(s.dscr!).toBeGreaterThan(5.8);
    expect(s.dscr!).toBeLessThan(6.0);
    // the invariant: fixed no longer silently equals flat fees alone
    expect(s.fixedMonthly).toBeGreaterThan(720);
    expect((s as any).fixedFeesMonthly).toBe(720);
    // margin range endpoints from the spec: ≈ $72,151 – $75,795
    const rent = (s as any).rentResolution;
    expect(Math.round(s.midCohort!.monthlyEbitda - (rent.hi - rent.mid))).toBe(72151);
    expect(Math.round(s.midCohort!.monthlyEbitda + (rent.mid - rent.lo))).toBe(75795);
  });

  it("insights no longer double-counts occupancy once rent is in the margin", async () => {
    const crumbl = await loadBrand("crumbl");
    const corrected = applyRentCorrection(crumbl.result);
    const rows = corrected.insights?.buildup ?? [];
    const occRow = rows.find((r: any) => /occupanc/i.test(r.label ?? ""));
    expect(occRow).toBeUndefined(); // one subtraction, one place
  });

  it("disclosed-rent brands are numerically unchanged by the correction", async () => {
    const backnine = await loadBrand("the-back-nine");
    const before = backnine.result.scoring.midCohort?.monthlyEbitda ?? null;
    const corrected = applyRentCorrection(backnine.result);
    if (before != null) {
      expect(Math.round(corrected.scoring!.midCohort!.monthlyEbitda)).toBe(Math.round(before));
    }
  });
});

describe("rent override — the third basis (applyRentOverride)", () => {
  it("crumbl: $12,000 override flows through margin/DSCR/payback; basis is 'override'", async () => {
    const crumbl = await loadBrand("crumbl");
    const o = applyRentOverride(crumbl.result, 12000);
    const s = o.scoring! as any;
    expect(Math.round(s.midCohort.monthlyEbitda)).toBe(69260);
    expect(s.dscr).toBeGreaterThan(5.4);
    expect(s.dscr).toBeLessThan(5.7);
    expect(s.rentResolution.basis).toBe("override");
    expect(s.rentResolution.mid).toBe(12000);
    // honesty: the override is never labeled disclosed anywhere downstream
    const rentAssumption = (o.insights?.assumptions ?? []).find((a: any) => a.field === "Rent");
    if (rentAssumption) expect(rentAssumption.basis).not.toBe("disclosed");
    // no occupancy double-count with an override either
    const occRow = (o.insights?.buildup ?? []).find((r: any) => /occupanc/i.test(r.label ?? ""));
    expect(occRow).toBeUndefined();
  });

  it("disclosed-rent brand (Back Nine class): override recomputes off the disclosed baseline", async () => {
    const { scoreFdd } = await import("./scoring");
    const { underwrite } = await import("./underwriting");
    // Minimal replica of the golden fixture's economics: mid $19,393, 8% royalty,
    // $600 flat fees, disclosed rent $6,361 → margin $10,881 (the golden pin).
    const fdd = {
      documentCheck: { appearsComplete: true, appearsScanned: false, itemsFound: [], warnings: [] },
      brandName: "Back Nine Replica",
      item19: {
        hasItem19: true,
        unitsReported: null,
        cohorts: [
          { label: "Middle 60% Average", avgMonthlyRevenue: 19393, basis: "x", revenueType: "gross_sales", ownership: "franchised" },
          { label: "Bottom 30% Average", avgMonthlyRevenue: 10885, basis: "x", revenueType: "gross_sales", ownership: "franchised" },
        ],
        networkAverageMonthly: null,
      },
      ongoingFees: { royaltyPct: 8, brandFundPct: 0, localAdPct: null, flatMonthlyFees: [{ name: "Tech", monthlyAmount: 600, source: "Item 6" }] },
      averageRentMonthly: 6361,
      item17: { initialInvestmentLow: 400000, initialInvestmentHigh: 595550, lineItems: [] },
      operationalRisks: [],
      hiddenCosts: [],
    } as any;
    const scoring = scoreFdd(fdd, { liquidCapital: 250000 });
    expect(Math.round(scoring.midCohort!.monthlyEbitda)).toBe(10881); // baseline matches golden
    expect((scoring as any).rentResolution.basis).toBe("disclosed");
    expect((scoring as any).rentResolution.mid).toBe(6361);
    const buyer = { liquidCapital: 250000, netWorth: 250000 };
    const result = { extracted: fdd, scoring, underwriting: underwrite(fdd, scoring, buyer), buyer } as any;
    const o = applyRentOverride(result, 10000);
    const s = o.scoring! as any;
    expect(Math.round(s.midCohort.monthlyEbitda)).toBe(7242); // 10,881 − (10,000 − 6,361)
    expect(s.rentResolution.basis).toBe("override");
    // soft-warn threshold: 10,000 < 3 × 6,361 — must NOT warn
    expect(10000 <= 6361 * 3).toBe(true);
  });
});
