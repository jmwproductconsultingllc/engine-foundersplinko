/**
 * THE AGREEMENT TEST — the cash ladder and the risk score must charge the same
 * fees for the same brand.
 *
 * This assertion existed nowhere in the suite, and its absence is what let the
 * whole FE-142 / FE-144 defect class live. Two modules computed the fee load
 * independently: lib/ladderInput.ts for the ladder the buyer reads, and
 * lib/scoring.ts for the verdict on the brand card. They agreed for years
 * because they were wrong in exactly the same way — both summed every
 * percentage in Item 6 and every flat fee, so a discretionary ceiling and a
 * minimum-that-bounds-a-percentage were charged twice over on both sides.
 *
 * Fixing one side first made them disagree, which is a worse failure than the
 * original: a buyer who notices that rung 2 and the risk verdict describe
 * different fee loads has no way to know which half to trust. This file makes
 * that state unreachable. It does not assert any particular number is right —
 * feeObligation.e2e.test.ts does that. It asserts the two paths cannot drift.
 */
import { describe, it, expect } from "vitest";
import { buildLadderInput } from "./ladderInput";
import { buildCashLadder } from "./ladder";
import { getSampleResult } from "./sampleReport";
import { applyRentCorrection } from "./rentCorrection";
import { scoreFdd } from "./scoring";
import type { DiligenceResult } from "./types";
import type { ExtractedFDD } from "./schema";

/**
 * A brand scored through the REAL path: scoreFdd on the extracted filing, then
 * applyRentCorrection, exactly as the pipeline and every stored report do.
 * Deliberately not the shortcut of patching a cohort onto a sample result —
 * the point is to exercise scoring.ts's own arithmetic.
 */
function scored(
  percentageFees: Array<{ label: string; pct: number; source?: string }>,
  flatMonthlyFees: Array<{ name: string; monthlyAmount: number; source?: string }>,
  annualRevenue: number,
): DiligenceResult {
  const s = getSampleResult();
  const extracted = {
    ...s.extracted,
    ongoingFees: {
      royaltyPct: null,
      brandFundPct: null,
      localAdPct: null,
      percentageFees,
      flatMonthlyFees,
    },
    item19: {
      ...s.extracted.item19,
      cohorts: [],
      networkAverageMonthly: annualRevenue / 12,
    },
  } as unknown as ExtractedFDD;
  const scoring = scoreFdd(extracted);
  return applyRentCorrection({ ...s, extracted, scoring } as unknown as DiligenceResult);
}

const BRANDS: Array<[string, () => DiligenceResult]> = [
  [
    "Budget Blinds — a discretionary CEILING that must not charge on either side",
    () =>
      scored(
        [
          { label: "Royalty", pct: 3.5, source: "Item 6" },
          { label: "Local Area Marketing Maximum", pct: 8, source: "Item 6" },
        ],
        [],
        774_915,
      ),
  ],
  [
    "PremierGarage — time tiers and territory tiers, none of them summable",
    () =>
      scored(
        [
          { label: "Royalty", pct: 5, source: "Item 6" },
          { label: "National Advertising Fund", pct: 1, source: "Item 6" },
        ],
        [
          { name: "Minimum Royalty Fee (First Year)", monthlyAmount: 500, source: "Item 6" },
          { name: "Minimum Royalty Fee (Thereafter)", monthlyAmount: 1000, source: "Item 6" },
          { name: "Minimum National Advertising Fund Payment", monthlyAmount: 250, source: "Item 6" },
          { name: "Technology Fee (First Territory)", monthlyAmount: 250, source: "Item 6" },
          { name: "Technology Fee (Subsequent Territories)", monthlyAmount: 125, source: "Item 6" },
        ],
        311_520,
      ),
  ],
  [
    "Kitchen Tune-Up — a FLOOR that binds, moving charge from rung 2 to rung 3",
    () =>
      scored(
        [
          { label: "Royalty", pct: 6, source: "Item 6" },
          { label: "National Advertising Fund", pct: 1, source: "Item 6" },
        ],
        [
          { name: "Minimum Royalty Fee", monthlyAmount: 500, source: "Item 6" },
          { name: "Technology Fee", monthlyAmount: 500, source: "Item 6" },
          { name: "Minimum National Advertising Fund Payment", monthlyAmount: 500, source: "Item 6" },
        ],
        521_520,
      ),
  ],
  [
    "CONTROL — Two Maids, audited correct, nothing exotic in the fee stack",
    () =>
      scored(
        [
          { label: "Royalty", pct: 6, source: "Item 6" },
          { label: "National Advertising Fund Payment", pct: 2, source: "Item 6" },
        ],
        [
          { name: "Technology Fee", monthlyAmount: 650, source: "Item 6" },
          { name: "Local Advertising Services Program Fee", monthlyAmount: 2500, source: "Item 6" },
        ],
        594_532,
      ),
  ],
  [
    "LEGACY SHAPE — three named slots, no percentageFees list at all",
    () => {
      const s = getSampleResult();
      const extracted = {
        ...s.extracted,
        ongoingFees: {
          royaltyPct: 6,
          brandFundPct: 2,
          localAdPct: 1,
          flatMonthlyFees: [{ name: "Technology Fee", monthlyAmount: 650, source: "Item 6" }],
        },
        item19: { ...s.extracted.item19, cohorts: [], networkAverageMonthly: 594_532 / 12 },
      } as unknown as ExtractedFDD;
      return applyRentCorrection({
        ...s,
        extracted,
        scoring: scoreFdd(extracted),
      } as unknown as DiligenceResult);
    },
  ],
];

describe("THE AGREEMENT TEST — the ladder and the score charge the same fees", () => {
  for (const [name, build] of BRANDS) {
    it(`${name}: rung 2 equals the score's monthly variable`, () => {
      const r = build();
      const L = buildCashLadder(buildLadderInput(r));
      const rung2 = L.get("franchiseFees")!.monthly!.lo;
      expect(rung2).toBeCloseTo(r.scoring.midCohort!.monthlyVariable, 0);
    });

    it(`${name}: rung 3 equals the score's fixed fees`, () => {
      const r = build();
      const L = buildCashLadder(buildLadderInput(r));
      const rung3 = L.get("fixedFees")!.monthly!.lo;
      const scoreFlat = (r.scoring as { fixedFeesMonthly?: number }).fixedFeesMonthly;
      expect(scoreFlat).toBeDefined();
      expect(rung3).toBeCloseTo(scoreFlat!, 0);
    });
  }

  it("the two paths run on the same top line — otherwise the comparison is meaningless", () => {
    const r = BRANDS[0][1]();
    const L = buildCashLadder(buildLadderInput(r));
    expect(L.get("revenue")!.monthly!.lo).toBeCloseTo(r.scoring.midCohort!.monthlyRevenue, 0);
  });

  it("a bound floor moves the SAME dollar on both sides, not just on one", () => {
    // Kitchen Tune-Up: ad fund 1% of $43,460 is $434.60, under the $500 floor.
    // The floor binds, so the percentage stops charging in rung 2 AND in
    // monthlyVariable, and $500 charges in rung 3 AND in fixedFeesMonthly.
    const r = BRANDS[2][1]();
    const L = buildCashLadder(buildLadderInput(r));
    const rev = L.get("revenue")!.monthly!.lo;
    expect(L.get("franchiseFees")!.monthly!.lo).toBeCloseTo((rev * 6) / 100, 0);
    expect(r.scoring.midCohort!.monthlyVariable).toBeCloseTo((rev * 6) / 100, 0);
    expect(L.get("fixedFees")!.monthly!.lo).toBe(1000);
    expect((r.scoring as { fixedFeesMonthly?: number }).fixedFeesMonthly).toBe(1000);
  });
});
