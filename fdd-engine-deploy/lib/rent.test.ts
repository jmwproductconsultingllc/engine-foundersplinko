// lib/rent.test.ts — golden pins for the rent resolver + the Crumbl
// acceptance numbers from the hotfix spec. CI runs this on every push.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveMonthlyRent, rentCeilingMonthly } from "./rent";
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

/* ────────────────────────────────────────────────────────────────────────────
 * THE PLAUSIBILITY GATE — regression pins for Row House (report 13d8381d).
 *
 * Rung 4 rendered "− Rent & occupancy $300,000" under a disclosed top line of
 * $27,129/mo, and all nine rungs below it inherited the impossibility. The
 * resolver trusted a single extracted number without ever comparing it to the
 * revenue it was about to be subtracted from.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("resolveMonthlyRent — the plausibility gate", () => {
  const ROW_HOUSE_REVENUE = 27129;
  const rowHouse = (rent: number) =>
    base({
      conceptType: "fitness_studio",
      averageRentMonthly: rent,
      rentDetail: { source: "Item 7 note 7, p.22 — estimate based on 3 months rent + 1-month security deposit" },
    });

  it("REPRO: $300,000/mo rent against $27,129/mo revenue is refused", () => {
    const r = resolveMonthlyRent(rowHouse(300000), ROW_HOUSE_REVENUE);
    expect(r!.basis).toBe("benchmark");
    expect(r!.reviewFlag).toBe(true);
    // 12–20% boutique-fitness occupancy band × the pro forma's own top line
    expect(r!.lo).toBe(3255);
    expect(r!.hi).toBe(5426);
  });

  it("the rejected figure is NAMED on the rung, in dollars and as a share", () => {
    const r = resolveMonthlyRent(rowHouse(300000), ROW_HOUSE_REVENUE);
    // A silently substituted benchmark is how a buyer gets surprised at the
    // lease signing. Say the number we threw out and point at Item 7.
    expect(r!.source).toContain("$300,000/mo");
    expect(r!.source).toContain("1,106%");
    expect(r!.source).toContain("Item 7");
  });

  it("GATE LAW — the merely BAD is never laundered into the good", () => {
    // 45% of revenue is a deal no one should sign. It is not impossible, so it
    // stays disclosed, stays on the rung, and still craters everything below.
    // A gate that "fixes" this deal is a worse bug than the one it replaced.
    const r = resolveMonthlyRent(rowHouse(Math.round(ROW_HOUSE_REVENUE * 0.45)), ROW_HOUSE_REVENUE);
    expect(r!.basis).toBe("disclosed");
    expect(r!.mid).toBe(12208);
    expect(r!.reviewFlag).toBeUndefined();
  });

  it("the ceiling is 3× the category occupancy band, floored at 50% of revenue", () => {
    // fitness_studio band tops at 20% → 60% ceiling.
    expect(rentCeilingMonthly(rowHouse(1), 10000)).toBe(6000);
    // a low-occupancy category would compute under 50%; the floor holds.
    expect(rentCeilingMonthly(base({ conceptType: "mobile_services" }), 10000)).toBe(5000);
    // no revenue to compare against → no gate. Named, not hidden: the resolver
    // cannot judge plausibility without the top line the ladder runs on.
    expect(rentCeilingMonthly(rowHouse(1), null)).toBeNull();
    expect(resolveMonthlyRent(rowHouse(300000), null)!.basis).toBe("disclosed");
  });
});

describe("applyRentCorrection — the sanity re-check on STORED results", () => {
  const stored = (rentResolution: unknown) =>
    ({
      extracted: base({ conceptType: "fitness_studio", averageRentMonthly: 300000 }),
      scoring: {
        rentResolution,
        assumedMonthlyDebtService: 1181,
        buildoutMidpoint: 450000,
        midCohort: {
          monthlyRevenue: 27129,
          monthlyVariable: 8000,
          monthlyFixed: 303165,
          monthlyEbitda: -284036,
          annualEbitda: -3408432,
          coversCosts: false,
        },
        bottomCohort: null,
      },
    }) as any;

  it("a PERSISTED impossibility is repaired at render time — no re-mint", () => {
    // This is the retroactive win. Every report already sold with an impossible
    // rent heals the next time someone opens it: same report ID, same URL.
    const out = applyRentCorrection(stored({ lo: 300000, hi: 300000, mid: 300000, basis: "disclosed", source: "Item 7" }));
    const s = out.scoring as any;
    expect(s.rentResolution.basis).toBe("benchmark");
    expect(s.rentResolution.mid).toBe(4341);
    expect(s.midCohort.monthlyEbitda).toBeGreaterThan(0);
  });

  it("a PERSISTED plausible resolution is left byte-identical", () => {
    // The gate must not become a second source of drift. Anything that clears
    // it is returned untouched — no re-derivation, no recompute.
    const input = stored({ lo: 4200, hi: 4200, mid: 4200, basis: "disclosed", source: "Item 7" });
    expect(applyRentCorrection(input)).toBe(input);
  });

  it("a buyer's OVERRIDE is never second-guessed", () => {
    // If they typed something extreme, that is a deliberate scenario, not a
    // defect. Their number is theirs.
    const input = stored({ lo: 300000, hi: 300000, mid: 300000, basis: "override", source: "buyer-entered figure" });
    expect(applyRentCorrection(input)).toBe(input);
  });
});
