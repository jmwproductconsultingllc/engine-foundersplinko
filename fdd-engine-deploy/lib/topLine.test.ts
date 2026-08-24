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
import { scoreFdd, isRevenueCohort } from "./scoring";
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
    const fdd = load("gorilla-property-services");
    const s = scoreFdd(fdd);
    expect(s.midCohort).not.toBeNull();
    expect(s.midCohort!.label).not.toMatch(/profit and loss/i);
    // $11,431/mo was the shipped number against $835,748/mo of disclosed gross.
    expect(s.midCohort!.monthlyRevenue).toBeGreaterThan(100_000);
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
