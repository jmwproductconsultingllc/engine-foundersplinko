/**
 * FE-142 + FE-144 · END TO END, through the rendered ladder.
 *
 * Why this file exists, in one sentence: FE-142's unit test went green while
 * the ladder still charged 11.5%, because resolvePercentageFees.totalPct had
 * no reader — buildCashLadder sums feePcts. A green resolver proves the
 * function is right. It does not prove the report changed. This does.
 *
 * Every assertion here reads a rung out of a built CashLadder, which is the
 * same object the JSX renders.
 */
import { describe, it, expect } from "vitest";
import { buildLadderInput } from "./ladderInput";
import { buildCashLadder } from "./ladder";
import { getSampleResult } from "./sampleReport";
import { applyRentCorrection } from "./rentCorrection";
import type { DiligenceResult } from "./types";

function brand(
  percentageFees: Array<{ label: string; pct: number; source?: string }>,
  flatMonthlyFees: Array<{ name: string; monthlyAmount: number; source?: string }>,
  annualRevenue: number,
): DiligenceResult {
  const s = applyRentCorrection(getSampleResult());
  return {
    ...s,
    extracted: {
      ...s.extracted,
      ongoingFees: {
        royaltyPct: null,
        brandFundPct: null,
        localAdPct: null,
        percentageFees,
        flatMonthlyFees,
      },
    },
    scoring: {
      ...s.scoring,
      midCohort: { ...s.scoring.midCohort!, monthlyRevenue: annualRevenue / 12 },
    },
  } as unknown as DiligenceResult;
}

/** Budget Blinds — single-territory gross sales $774,915/yr, 282 units. */
const budgetBlinds = () =>
  brand(
    [
      { label: "Royalty", pct: 3.5, source: "Item 6" },
      { label: "Local Area Marketing Maximum", pct: 8, source: "Item 6" },
    ],
    [],
    774_915,
  );

/** PremierGarage — single-territory median $311,520/yr. */
const premierGarage = () =>
  brand(
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
  );

/** Kitchen Tune-Up — single-territory average $521,520/yr. The floor BINDS here. */
const kitchenTuneUp = () =>
  brand(
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
  );

const ladderFor = (r: DiligenceResult) => buildCashLadder(buildLadderInput(r));

describe("FE-142 end to end — the ceiling never reaches rung 2", () => {
  it("Budget Blinds rung 2 charges 3.5%, not 11.5%", () => {
    const L = ladderFor(budgetBlinds());
    const rev = L.get("revenue")!.monthly!.lo;
    expect(L.get("franchiseFees")!.monthly!.lo).toBeCloseTo((rev * 3.5) / 100, 0);
  });

  it("the source line stops printing a ceiling as though it were a rate", () => {
    // Line 326 builds this string from the same array rung 2 sums. If the
    // filter works, the sentence the buyer reads agrees with the arithmetic.
    const src = L142().get("franchiseFees")!.source;
    expect(src).toMatch(/Royalty 3\.5%/);
    expect(src).not.toMatch(/Maximum/);
  });
  const L142 = () => ladderFor(budgetBlinds());
});

describe("FE-144 end to end — floors and tiers resolve in the rendered ladder", () => {
  it("PremierGarage rung 3 renders $250, not $2,125", () => {
    expect(ladderFor(premierGarage()).get("fixedFees")!.monthly!.lo).toBe(250);
  });

  it("PremierGarage rung 2 is untouched at 6% — neither floor binds", () => {
    const L = ladderFor(premierGarage());
    const rev = L.get("revenue")!.monthly!.lo;
    expect(L.get("franchiseFees")!.monthly!.lo).toBeCloseTo((rev * 6) / 100, 0);
  });

  it("no subsequent-territory rate on a single-territory model", () => {
    expect(ladderFor(premierGarage()).get("fixedFees")!.source).not.toMatch(/Subsequent/);
  });

  it("KITCHEN TUNE-UP — a binding floor moves the charge from rung 2 to rung 3", () => {
    // Ad fund 1% of $43,460 = $434.60, below the $500 floor. The floor wins,
    // so rung 2 drops to royalty alone and rung 3 carries $500 + $500 tech.
    const L = ladderFor(kitchenTuneUp());
    const rev = L.get("revenue")!.monthly!.lo;
    expect(L.get("franchiseFees")!.monthly!.lo).toBeCloseTo((rev * 6) / 100, 0);
    expect(L.get("fixedFees")!.monthly!.lo).toBe(1000);
  });

  it("the ladder still has all 13 rungs and none went dark", () => {
    const L = ladderFor(premierGarage());
    expect(L.rungs).toHaveLength(13);
    expect(L.operatingEbitda).not.toBeNull();
  });
});
