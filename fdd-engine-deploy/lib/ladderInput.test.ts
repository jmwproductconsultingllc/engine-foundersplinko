import { describe, it, expect } from "vitest";
import type { ExtractedFDD } from "./schema";
import { resolvePercentageFees, buildLadderInput } from "./ladderInput";
import { buildCashLadder } from "./ladder";
import { getSampleResult } from "./sampleReport";
import { applyRentCorrection } from "./rentCorrection";
import type { DiligenceResult } from "./types";

/** Minimal FDD shell — only the fee fields matter to resolvePercentageFees. */
const fddWith = (ongoingFees: Partial<ExtractedFDD["ongoingFees"]>): ExtractedFDD =>
  ({
    ongoingFees: {
      royaltyPct: null,
      brandFundPct: null,
      localAdPct: null,
      flatMonthlyFees: [],
      ...ongoingFees,
    },
    hiddenCosts: [],
  }) as unknown as ExtractedFDD;

describe("resolvePercentageFees — the three-slot ceiling", () => {
  it("falls back to the three named slots when no complete list exists", () => {
    const r = resolvePercentageFees(
      fddWith({ royaltyPct: 5, brandFundPct: 1.75, localAdPct: 1.0 }),
    );
    expect(r.complete).toBe(false);
    expect(r.totalPct).toBe(7.75);
    expect(r.fees.map((f) => f.label)).toEqual(["Royalty", "Brand fund", "Local advertising"]);
  });

  it("FALLBACK PARITY — the fallback total equals what scoring.ts already charges", () => {
    // scoring.ts: variableRate = (royalty + brand + localAd) / 100.
    // Any drift between these two numbers is a stored report changing its
    // answer the day this module ships. It must be exactly zero.
    const cases: [number | null, number | null, number | null][] = [
      [5, 1.75, 1.0],
      [8, null, null],
      [6.5, 2, null],
      [null, null, null],
      [4, 0, 1],
    ];
    for (const [royaltyPct, brandFundPct, localAdPct] of cases) {
      const legacy = ((royaltyPct ?? 0) + (brandFundPct ?? 0) + (localAdPct ?? 0)) / 100;
      const resolved = resolvePercentageFees(fddWith({ royaltyPct, brandFundPct, localAdPct }));
      expect(resolved.totalPct / 100).toBeCloseTo(legacy, 10);
    }
  });

  it("says out loud that a legacy record may be understating the fee load", () => {
    const r = resolvePercentageFees(fddWith({ royaltyPct: 5 }));
    expect(r.note).toBeTruthy();
    expect(r.note).toMatch(/Item 6/);
    // WORDS, not a dash and not a zero.
    expect(r.note).not.toMatch(/—\s*$/);
  });

  it("NOODLES — a fourth percentage fee finally has somewhere to live", () => {
    const r = resolvePercentageFees(
      fddWith({
        royaltyPct: 5,
        brandFundPct: 1.75,
        localAdPct: 1.0,
        percentageFees: [
          { label: "Royalty", pct: 5, source: "Item 6, p.41" },
          { label: "National marketing fund", pct: 1.75, source: "Item 6, p.41" },
          { label: "Local advertising", pct: 1.0, source: "Item 6, p.41" },
          { label: "Technology fee", pct: 1.25, source: "Item 6, p.42" },
        ],
      }),
    );
    expect(r.complete).toBe(true);
    expect(r.fees).toHaveLength(4);
    expect(r.totalPct).toBe(9.0);
    expect(r.note).toBeNull();
  });

  it("does not double-charge a royalty disclosed in both the list and the slot", () => {
    const r = resolvePercentageFees(
      fddWith({
        royaltyPct: 5,
        percentageFees: [
          { label: "Royalty fee", pct: 5, source: "Item 6" },
          { label: "Technology fee", pct: 1.25, source: "Item 6" },
        ],
      }),
    );
    expect(r.totalPct).toBe(6.25);
    expect(r.fees).toHaveLength(2);
  });

  it("appends rather than drops a named slot the list somehow missed", () => {
    // Leaning toward overstating: a silently dropped fee is the bug we are fixing.
    const r = resolvePercentageFees(
      fddWith({
        localAdPct: 2,
        percentageFees: [{ label: "Royalty", pct: 6, source: "Item 6" }],
      }),
    );
    expect(r.totalPct).toBe(8);
    expect(r.fees.map((f) => f.label)).toContain("Local advertising");
  });

  it("normalizes the fraction convention (0.06 means 6%)", () => {
    const r = resolvePercentageFees(
      fddWith({ percentageFees: [{ label: "Royalty", pct: 0.06, source: "Item 6" }] }),
    );
    expect(r.totalPct).toBe(6);
  });
});

describe("buildLadderInput", () => {
  const sample = applyRentCorrection(getSampleResult());

  it("carries the resolved top line, fees, and build-out through to the ladder", () => {
    const input = buildLadderInput(sample);
    const L = buildCashLadder(input);
    expect(L.rungs).toHaveLength(13);
    expect(L.get("revenue")!.monthly!.lo).toBe(sample.scoring.midCohort!.monthlyRevenue);
    expect(input.buildoutMidpoint).toBe(sample.scoring.buildoutMidpoint);
  });

  it("rung 2 charges exactly the resolved percentage-fee total", () => {
    const input = buildLadderInput(sample);
    const total = input.feePcts.reduce((a, f) => a + f.pct, 0);
    const L = buildCashLadder(input);
    const rev = L.get("revenue")!.monthly!.lo;
    expect(L.get("franchiseFees")!.monthly!.lo).toBeCloseTo((rev * total) / 100, 0);
  });

  it("FE-116 — explicit null financing means no lender, not a $0 loan", () => {
    const L = buildCashLadder(buildLadderInput(sample, { financing: null }));
    expect(L.monthlyDebtService).toBeNull();
    expect(L.get("debtService")!.monthly).toBeNull();
    expect(L.dscr).toBeNull();
    // Rung 13 is a live figure on a cash denominator — it must NOT go dark.
    expect(L.paybackYears).not.toBeNull();
  });

  it("FE-116 — a zero recommended loan resolves to no lender", () => {
    const allCash: DiligenceResult = {
      ...sample,
      underwriting: { ...sample.underwriting, recommendedLoan: 0, capitalGap: 0 },
    };
    const L = buildCashLadder(buildLadderInput(allCash));
    expect(L.monthlyDebtService).toBeNull();
    expect(L.dscr).toBeNull();
  });

  it("a buyer's rent override is tagged buyer — never relabeled as disclosed", () => {
    const withOverride: DiligenceResult = {
      ...sample,
      scoring: {
        ...sample.scoring,
        rentResolution: { lo: 9000, hi: 9000, mid: 9000, basis: "override", source: "Your input" },
      },
    } as DiligenceResult;
    const input = buildLadderInput(withOverride);
    expect(input.rentBasis).toBe("buyer");
    expect(input.rentMonthly).toBe(9000);
  });

  it("ONE LADDER PER RENDER — the same input yields identical figures every time", () => {
    const input = buildLadderInput(sample);
    const a = buildCashLadder(input);
    const b = buildCashLadder(input);
    expect(a.rungs.map((r) => [r.id, r.monthly, r.annual])).toEqual(
      b.rungs.map((r) => [r.id, r.monthly, r.annual]),
    );
  });
});
