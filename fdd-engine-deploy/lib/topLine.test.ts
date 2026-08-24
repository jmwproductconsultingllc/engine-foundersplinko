/**
 * THE TOP LINE MUST BE GROSS SALES — and two shipped brands prove it wasn't.
 *
 * This one was not found by reading code. It was found by reading the stored
 * corpus after the brand-facts audit printed a $3–$5 monthly rent benchmark for
 * Ellie Mental Health and the number looked impossible.
 *
 * It was impossible. Rent was not the defect. Ellie's pro forma was built on
 * the Item 19 cohort "Franchised Clinics New Patients", whose disclosed annual
 * figure is 400 — four hundred NEW PATIENTS. The engine read it as $400 of
 * revenue, made the top line $33/month, and every rung below inherited it. The
 * $3–$5 rent was 10–15% category occupancy applied to $33.
 *
 * Gorilla Property Services failed through the other door. "Canadian
 * Franchisees Profit and Loss Table 4 Median" matched the keyword "median" and
 * became the top line at $11,431/month. It is a profit table. The same filing
 * discloses $835,748/month of gross revenue in a cohort sitting beside it.
 *
 * In BOTH cases the extractor did its job — it tagged those cohorts "other" and
 * "net_or_ebitda". The selection logic never read the tag. That is the defect:
 * label matching with no type check, plus a fallback that excluded
 * net_or_ebitda and pre_sale_only while quietly allowing "other", the bucket
 * that by definition means "this is not gross sales".
 *
 * These fixtures load the REAL stored records. If a future extraction changes
 * their shape, this test should be updated against the new shape rather than
 * loosened — the assertion is the point.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  scoreFdd,
  isRevenueCohort,
  suspectedSystemTotals,
  resolveItem19Currency,
  perOutletAnnualRevenue,
} from "./scoring";
import type { ExtractedFDD, Item19Cohort } from "./schema";

const load = (slug: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "brands", `${slug}.json`), "utf8"))
    .result.extracted as ExtractedFDD;

describe("the Item 19 top line is gross sales or it is nothing", () => {
  it("ELLIE — a patient count is not revenue", () => {
    const fdd = load("ellie-mental-health");
    // The record still carries the trap: the count cohort is first in the list.
    const counts = (fdd.item19?.cohorts ?? []).filter((c) => c.revenueType === "other");
    expect(counts.length).toBeGreaterThan(0);

    const s = scoreFdd(fdd);
    expect(s.midCohort).not.toBeNull();
    // $33/mo was the shipped number. Anything in that neighborhood is the bug.
    expect(s.midCohort!.monthlyRevenue).toBeGreaterThan(10_000);
    expect(s.midCohort!.label).not.toMatch(/new patients/i);
    expect(s.midCohort!.label).toMatch(/revenue/i);
  });

  it("GORILLA — a profit-and-loss table headed 'Median' is not revenue", () => {
    // This assertion was written BEFORE the source FDD was read, and it
    // originally required the gross-revenue cohort to win at $835,748/mo. The
    // filing disproved it: that cohort is a 32-franchisee system total, so the
    // right outcome is not "pick the other one" but "refuse the filing". Kept
    // here, rewritten, because the thing worth pinning is that the P&L table
    // never becomes the top line — see the system-total block below for why
    // nothing else does either.
    const fdd = load("gorilla-property-services");
    const s = scoreFdd(fdd);
    expect(s.midCohort?.label ?? "").not.toMatch(/profit and loss/i);
    const pl = (fdd.item19?.cohorts ?? []).filter((c) => c.revenueType === "net_or_ebitda");
    expect(pl.length).toBeGreaterThan(0); // the trap is still in the record
    expect(pl.every((c) => !isRevenueCohort(c))).toBe(true);
  });

  it("the rent that started this is now sane, and it was never a rent bug", () => {
    const s = scoreFdd(load("ellie-mental-health"));
    const r = s.rentResolution;
    if (r) {
      // 10–15% of a real top line, not of $33.
      expect(r.hi).toBeGreaterThan(100);
    }
  });

  it("the filing is told about the tables that were set aside", () => {
    const s = scoreFdd(load("ellie-mental-health"));
    expect(s.notes.join(" ")).toMatch(/not gross sales/i);
  });

  it("an explicit non-revenue tag disqualifies; a missing tag does not", () => {
    const c = (over: Partial<Item19Cohort>) => ({ label: "x", avgMonthlyRevenue: 1, ...over }) as Item19Cohort;
    expect(isRevenueCohort(c({ revenueType: "gross_sales" }))).toBe(true);
    expect(isRevenueCohort(c({}))).toBe(true); // legacy record, no tag — permissive
    expect(isRevenueCohort(c({ revenueType: "other" }))).toBe(false);
    expect(isRevenueCohort(c({ revenueType: "net_or_ebitda" }))).toBe(false);
    expect(isRevenueCohort(c({ revenueType: "pre_sale_only" }))).toBe(false);
    expect(isRevenueCohort(null)).toBe(false);
  });

  it("CORPUS SWEEP — no brand runs its pro forma on a non-revenue cohort", () => {
    const dir = path.join(process.cwd(), "data", "brands");
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const fdd = rec?.result?.extracted as ExtractedFDD | undefined;
      if (!fdd?.item19) continue;
      const s = scoreFdd(fdd);
      const label = s.midCohort?.label;
      if (!label) continue;
      const picked = (fdd.item19.cohorts ?? []).find((c) => c.label === label);
      if (picked && !isRevenueCohort(picked)) offenders.push(`${rec.slug}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The SECOND Gorilla defect, confirmed against the source FDD on August 24, 2026.
 *
 * Item 19 Table 1 prints "Total gross revenue $10,028,981.01" for 32 Canadian
 * franchisees and, directly beneath it, "Average gross revenue per franchisee
 * $313,405.66". The extraction took the total. The pro forma was built on
 * $835,748 a month of revenue for one gutter-cleaning franchise, in a filing
 * whose best single franchisee did $1.31M for the entire YEAR.
 *
 * Table 2 has the same shape and was extracted the same way — $407,430.76 of
 * combined revenue for 2 multi-unit franchisees stored as though one unit
 * earned it. That is why the guard refuses the whole filing instead of dividing
 * the cohort it caught: quietly dividing would have produced a confident number
 * off by 2x in place of one off by 32x, and confident is the dangerous part.
 */
describe("a system total is not a unit", () => {
  it("GORILLA — the filing is refused rather than guessed at", () => {
    const s = scoreFdd(load("gorilla-property-services"));
    expect(s.midCohort).toBeNull();
    expect(s.riskReasons.join(" ")).toMatch(/SYSTEM TOTALS/i);
    // The "couldn't assess" floor must hold: unverified is never Low.
    expect(s.riskLevel).not.toBe("Low");
  });

  it("the CAD disclosure the extractor captured is finally read", () => {
    const s = scoreFdd(load("gorilla-property-services"));
    expect(resolveItem19Currency(load("gorilla-property-services"))).toBe("CAD");
    expect(s.notes.join(" ")).toMatch(/CAD/);
    expect(s.notes.join(" ")).toMatch(/no conversion/i);
  });

  it("the detector needs the arithmetic signature, not just a big number", () => {
    const c = (annualRevenue: number, sampleSize: number): Item19Cohort =>
      ({ label: "x", revenueType: "gross_sales", annualRevenue, sampleSize, avgMonthlyRevenue: annualRevenue / 12 }) as Item19Cohort;
    // Gorilla's real shape: 10,028,981 over 32 against a 407,430 sibling.
    expect(suspectedSystemTotals([c(10_028_981, 32), c(407_430, 2)])).toBe(true);
    // Honest quintiles: a top cohort a few times its siblings, dividing makes it absurd.
    expect(suspectedSystemTotals([c(1_085_616, 19), c(229_896, 19)])).toBe(false);
    // A single cohort can never be judged against siblings it does not have.
    expect(suspectedSystemTotals([c(10_028_981, 32)])).toBe(false);
  });

  it("ELLIE is untouched by the total guard — it has a different disease", () => {
    expect(suspectedSystemTotals(load("ellie-mental-health").item19!.cohorts)).toBe(false);
    expect(scoreFdd(load("ellie-mental-health")).midCohort).not.toBeNull();
  });
});

/**
 * BAR-B-CLEAN — the third distinct way an Item 19 top line goes wrong, and the
 * only one where the filing publishes no correct figure at all.
 *
 * Confirmed against the source FDD on August 24, 2026. Item 19 Table 1a reports
 * by "Location" — a MARKET — and prints a "Number of Bar-B-Clean Businesses"
 * column beside each one:
 *
 *     Central Texas   11 businesses   $1,512,928
 *     Ventura          2 businesses     $251,944
 *     San Diego        8 businesses     $577,330
 *     ...
 *
 * Eight full-time franchised Locations, 38 businesses, $4,122,303 combined.
 * The per-business average is $108,482 a year — $9,040 a month. The shipped
 * top line was $399,122 a MONTH. Forty-four times too high, in the optimistic
 * direction, on a report that tells someone whether to spend six figures.
 *
 * Ellie read a count column as revenue. Gorilla took a printed system-total row
 * when the per-franchisee average was printed directly beneath it. Bar-B-Clean
 * is neither: this filing prints NO per-outlet figure anywhere. The only route
 * to one is division, and the divisor is sitting in the next column.
 */
describe("a combined row is not an outlet", () => {
  const cohort = (over: Partial<Item19Cohort>): Item19Cohort =>
    ({ label: "Central Texas", revenueType: "gross_sales", ownership: "franchised", ...over }) as Item19Cohort;

  it("divides by the outlet count the filing prints", () => {
    const c = cohort({ annualRevenue: 1_512_928, figureScope: "combined", combinedAcross: 11, avgMonthlyRevenue: 126_077 });
    expect(perOutletAnnualRevenue(c)).toBeCloseTo(137_538.9, 0);
  });

  it("a genuine single-outlet row is untouched", () => {
    const c = cohort({ annualRevenue: 381_674, figureScope: "per_outlet", avgMonthlyRevenue: 31_806 });
    expect(perOutletAnnualRevenue(c)).toBe(381_674);
  });

  it("a legacy record with no scope keeps the old contract", () => {
    const c = cohort({ annualRevenue: 500_000, avgMonthlyRevenue: 41_667 });
    expect(perOutletAnnualRevenue(c)).toBe(500_000);
  });

  it("THE REAL RUN'S TRAP — a cohort average is per_outlet, whatever its size", () => {
    // Two Maids Quintile Two: 19 territories, average $594,532 EACH. The first
    // version of this field asked "how many outlets does this figure cover" and
    // got 19 back on every quintile — identical to sampleSize on every row.
    // Dividing would have turned a correct $49,544/mo top line into $2,608.
    const q2 = cohort({ annualRevenue: 594_532, sampleSize: 19, figureScope: "per_outlet" });
    expect(perOutletAnnualRevenue(q2)).toBe(594_532);
  });

  it("a nonsense count is refused rather than applied", () => {
    expect(perOutletAnnualRevenue(cohort({ annualRevenue: 500_000, figureScope: "combined", combinedAcross: 0 }))).toBeNull();
    expect(perOutletAnnualRevenue(cohort({ annualRevenue: 500_000, figureScope: "combined", combinedAcross: null }))).toBeNull();
  });

  it("the top line divides, and the report says out loud that it did", () => {
    const base = load("code-ninjas");
    const fdd = {
      ...base,
      item19: {
        ...base.item19,
        networkAverageMonthly: null,
        cohorts: [
          {
            label: "Central Texas",
            ownership: "franchised",
            revenueType: "gross_sales",
            basis: "Item 19 Table 1a",
            annualRevenue: 1_512_928,
            avgMonthlyRevenue: 126_077,
            figureScope: "combined",
            combinedAcross: 11,
            sampleSize: 11,
          },
        ],
      },
    } as unknown as ExtractedFDD;
    const s = scoreFdd(fdd);
    expect(s.midCohort!.monthlyRevenue).toBeCloseTo(137_538.9 / 12, 0);
    expect(s.notes.join(" ")).toMatch(/reports 11 outlets together/i);
    expect(s.notes.join(" ")).toMatch(/revenue of ONE outlet/i);
  });

  it("BAR-B-CLEAN's stored record is still refused — it predates the count field", () => {
    // The record carries the combined figure with no outletsCovered, so nothing
    // can divide it. Refusal is the correct outcome until it is re-extracted.
    const s = scoreFdd(load("bar-b-clean"));
    expect(s.midCohort).toBeNull();
    expect(s.riskReasons.join(" ")).toMatch(/SYSTEM TOTALS/i);
    expect(s.riskLevel).not.toBe("Low");
  });
});
