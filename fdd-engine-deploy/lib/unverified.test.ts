/**
 * THE REFUSAL IS PART OF THE PRODUCT.
 *
 * Three brands now produce no pro forma: their Item 19 reports outlets together
 * rather than one at a time, and this report will not estimate a per-outlet
 * figure it cannot read. That decision is right. What it rendered was not —
 * thirteen blank rows, every one stamped DERIVED, which asserts "our
 * calculation from disclosed figures" about a row where no calculation
 * happened. A false provenance claim on an empty cell, in a product whose
 * guidepost is cited accuracy.
 *
 * And the source line read "No revenue figure disclosed in Item 19", which for
 * Gorilla and Bar-B-Clean is simply untrue. Both filings disclose revenue at
 * length. We read it and declined to build on it. Those are different
 * sentences and a buyer deserves the accurate one.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { scoreFdd } from "./scoring";
import { buildLadderInput } from "./ladderInput";
import { buildCashLadder } from "./ladder";
import { BASIS_STYLE } from "./basis";
import type { DiligenceResult } from "./types";
import type { ExtractedFDD } from "./schema";

const record = (slug: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "brands", `${slug}.json`), "utf8"))
    .result as DiligenceResult;

function refusedLadder(slug: string) {
  const rec = record(slug);
  const scoring = scoreFdd(rec.extracted as ExtractedFDD);
  return {
    scoring,
    L: buildCashLadder(buildLadderInput({ ...rec, scoring } as unknown as DiligenceResult)),
  };
}

describe("a refused filing renders a designed state, not a broken one", () => {
  for (const slug of ["gorilla-property-services", "bar-b-clean"]) {
    it(`${slug}: no rung claims a provenance it does not have`, () => {
      const { L } = refusedLadder(slug);
      expect(L.rungs).toHaveLength(13);
      for (const r of L.rungs) {
        expect(r.monthly).toBeNull();
        // DERIVED means "our calculation from disclosed figures". Nothing was
        // calculated here, so nothing may say so.
        expect(r.basis).not.toBe("derived");
        expect(r.basis).toBe("unverified");
      }
      expect(L.costBasis).toBe("unverified");
    });

    it(`${slug}: the reason is true of THIS filing, not a generic absence`, () => {
      const { L } = refusedLadder(slug);
      const rung1 = L.get("revenue")!;
      // These filings disclose revenue at length. Saying otherwise is false.
      expect(rung1.source).not.toMatch(/no revenue figure disclosed/i);
      expect(rung1.source).toMatch(/reports outlets together/i);
    });

    it(`${slug}: the buyer is told what to ask instead`, () => {
      const { L } = refusedLadder(slug);
      const rung1 = L.get("revenue")!;
      expect(rung1.note).toBeTruthy();
      expect(rung1.note).toMatch(/Item 20|per franchised outlet/i);
    });

    it(`${slug}: unverified is never scored as low risk`, () => {
      const { scoring } = refusedLadder(slug);
      expect(scoring.midCohort).toBeNull();
      expect(scoring.riskLevel).not.toBe("Low");
    });
  }

  it("a filing with genuinely no FPR gets the OTHER sentence", () => {
    const bare = {
      conceptType: "other",
      ongoingFees: { royaltyPct: 6, brandFundPct: null, localAdPct: null, flatMonthlyFees: [] },
      item17: { initialInvestmentLow: 100_000, initialInvestmentHigh: 200_000, lineItems: [], sourcePage: "p.21" },
      item19: { hasItem19: false, cohorts: [], notes: "", networkAverageMonthly: null, unitsReported: null, sourcePage: "" },
      hiddenCosts: [],
    } as unknown as ExtractedFDD;
    const s = scoreFdd(bare);
    expect(s.item19Unusable?.reason).toMatch(/no franchisee revenue figure/i);
    expect(s.item19Unusable?.reason).not.toMatch(/reports outlets together/i);
  });

  it("UNVERIFIED is a defined, legible chip — not an unstyled fallback", () => {
    const style = BASIS_STYLE.unverified;
    expect(style.label).toBe("UNVERIFIED");
    expect(style.definition).toMatch(/rather than a wrong one/i);
    expect(style.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    // It must not be mistaken for a disclosure at a glance.
    expect(style.color).not.toBe(BASIS_STYLE.disclosed.color);
  });

  it("a healthy brand is untouched — refusal must not leak", () => {
    const rec = record("code-ninjas");
    const scoring = scoreFdd(rec.extracted as ExtractedFDD);
    const L = buildCashLadder(buildLadderInput({ ...rec, scoring } as unknown as DiligenceResult));
    expect(scoring.item19Unusable).toBeUndefined();
    expect(L.get("revenue")!.monthly).not.toBeNull();
    expect(L.rungs.every((r) => r.basis !== "unverified")).toBe(true);
  });
});
