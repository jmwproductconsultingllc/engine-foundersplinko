/**
 * FE-143 · Rent charged to a business the filing says has no premises.
 *
 * Bark & Mane is a mobile pet-grooming franchise. Its FDD says so directly:
 * the franchisee runs the business from home and no site approval is required.
 * The only occupancy-shaped cost disclosed anywhere in Item 7 is van storage,
 * $0–$1,500 for the first van.
 *
 * The report charged rung 4 at 9% of revenue — $2,358/month, $28,296/year —
 * as "Rent & occupancy". That cost does not exist. It is roughly nineteen
 * times the top of the disclosed figure, and it arrived because the concept
 * classifier fell through to "uncategorized" and the uncategorized bucket
 * draws a 6–12% occupancy band.
 *
 * The rule under test is the FE-140 rule applied to occupancy: a category band
 * is a guess about businesses of this shape, an explicit statement in the
 * filing is a fact about THIS business, and the guess may never overrule the
 * fact.
 */
import { describe, it, expect } from "vitest";
import { premisesModel, resolveMonthlyRent } from "./rent";
import { buildLadderInput } from "./ladderInput";
import { buildCashLadder } from "./ladder";
import { getSampleResult } from "./sampleReport";
import { applyRentCorrection } from "./rentCorrection";
import type { DiligenceResult } from "./types";
import type { ExtractedFDD } from "./schema";

const REVENUE = 314_387 / 12; // $26,199/mo — Bark & Mane average gross sales

function fdd(over: Partial<ExtractedFDD> = {}): ExtractedFDD {
  return {
    conceptType: "other",
    ongoingFees: { royaltyPct: 6, brandFundPct: 2, localAdPct: null, flatMonthlyFees: [] },
    item17: { initialInvestmentLow: 150_000, initialInvestmentHigh: 225_976, lineItems: [], sourcePage: "p.21" },
    hiddenCosts: [],
    ...over,
  } as unknown as ExtractedFDD;
}

/** The filing's own sentence, as it reaches us through an Item 7 note. */
const homeBasedFdd = () =>
  fdd({
    item17: {
      initialInvestmentLow: 150_000,
      initialInvestmentHigh: 225_976,
      lineItems: [
        {
          category: "Van Storage",
          low: 0,
          high: 1500,
          recurring: false,
          notes:
            "Since the business is mobile, we expect that you will run your Franchised Business from your home and no site approval is required.",
        },
      ],
      sourcePage: "p.21",
    },
  } as unknown as Partial<ExtractedFDD>);

function ladderFor(x: ExtractedFDD) {
  const s = getSampleResult();
  // rentResolution is dropped deliberately. The sample carries a PERSISTED
  // resolution, and applyRentCorrection trusts a persisted figure that clears
  // the plausibility gate — so leaving it in would test the sample's rent, not
  // this filing's.
  const { rentResolution: _drop, ...scoring } = s.scoring as Record<string, unknown>;
  const r = applyRentCorrection({
    ...s,
    extracted: x,
    scoring: { ...scoring, midCohort: { ...s.scoring.midCohort!, monthlyRevenue: REVENUE } },
  } as unknown as DiligenceResult);
  return buildCashLadder(buildLadderInput(r));
}

describe("FE-143 — occupancy is disclosure-led, not category-led", () => {
  it("detects the filing's own statement that the business runs from home", () => {
    const p = premisesModel(homeBasedFdd());
    expect(p.homeBased).toBe(true);
    expect(p.evidence).toMatch(/from your home/i);
  });

  it("an explicit extracted flag beats text sniffing in both directions", () => {
    const forced = { ...fdd(), premises: { homeBased: true, evidence: "Item 11" } } as unknown as ExtractedFDD;
    expect(premisesModel(forced).homeBased).toBe(true);
    const denied = {
      ...homeBasedFdd(),
      premises: { homeBased: false, evidence: "Item 7 requires an approved site" },
    } as unknown as ExtractedFDD;
    expect(premisesModel(denied).homeBased).toBe(false);
  });

  it("THE DEFECT — no category occupancy benchmark is invented for a home-based brand", () => {
    // 9% of $26,199 is $2,358/mo. That is the number that must not appear.
    const r = resolveMonthlyRent(homeBasedFdd(), REVENUE);
    expect(r?.basis).not.toBe("benchmark");
  });

  it("a conventional brand still draws its benchmark — this must not over-correct", () => {
    const r = resolveMonthlyRent(fdd({ conceptType: "food_beverage" } as Partial<ExtractedFDD>), REVENUE);
    expect(r?.basis).toBe("benchmark");
    expect(r!.mid).toBeGreaterThan(0);
  });

  it("rung 4 charges the disclosed storage line, not a modeled lease", () => {
    const L = ladderFor(homeBasedFdd());
    const rung4 = L.get("occupancy")!;
    // $0–$1,500 for the first van, read as a disclosed range — never 9% of revenue.
    expect(rung4.monthly!.hi).toBeLessThanOrEqual(1500);
    expect(rung4.monthly!.hi).toBeLessThan((REVENUE * 9) / 100);
  });

  it("when nothing occupancy-shaped is disclosed, rung 4 is a DISCLOSED zero and says why", () => {
    const bare = fdd({
      hiddenCosts: [
        { name: "Home office", description: "The business is home-based; no retail location is required.", estimatedAnnualAmount: null, source: "Item 1" },
      ],
    } as unknown as Partial<ExtractedFDD>);
    const L = ladderFor(bare);
    const rung4 = L.get("occupancy")!;
    expect(rung4.monthly!.lo).toBe(0);
    expect(rung4.basis).toBe("disclosed");
    expect(rung4.source).toMatch(/no premises rent is charged/i);
    expect(rung4.source).not.toMatch(/could not|no category range/i);
  });

  it("the ladder still has all 13 rungs and the margin lines stay live", () => {
    const L = ladderFor(homeBasedFdd());
    expect(L.rungs).toHaveLength(13);
    expect(L.operatingEbitda).not.toBeNull();
    expect(L.marginAfterFeesAndRent).not.toBeNull();
  });
});
