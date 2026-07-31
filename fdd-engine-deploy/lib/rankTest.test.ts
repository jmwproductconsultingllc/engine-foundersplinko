/**
 * rankTest.test.ts
 *
 * Four independent guards. Do not delete one and keep the others.
 *
 *  1. SEAM     — with the fee load forced back to royalty + brand fund and the
 *                band at the QSR midpoint, breakeven must reproduce the figure
 *                the headroom work already verified against the live cash
 *                ladder: $1,062,479. If this drifts, the rank test and the
 *                ladder have diverged and one of them is lying to a customer.
 *  2. LEAK     — `freeCopy` must contain no digits, no currency symbol and no
 *                spelled percentage. It ships unlocked.
 *  3. DOUBLE   — transaction processing must never enter the load, because the
 *                operating band already contains it.
 *  4. REFUSAL  — a missing Item 19 or an unclassifiable fee must produce
 *                `unavailable` with a reason, never a computed figure.
 */

import { describe, it, expect } from "vitest";
import { computeFeeLoad, classifyFee } from "./feeLoad";
import { computeRankTest, annuityFactor, SMALL_SET_THRESHOLD } from "./rankTest";
import {
  QSR_BAND_V1,
  ENTERTAINMENT_BAND_V1,
  REFERENCE_FEES,
  REFERENCE_FEES_UNCORRECTED,
  REFERENCE_ITEM19,
  REFERENCE_LOAN,
  EMERGING_FEES,
  EMERGING_ITEM19,
  EMERGING_LOAN,
  NO_PERFORMANCE_ITEM19,
} from "./rankTest.fixture";

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

describe("1. seam — must reconcile with the verified headroom figure", () => {
  it("reproduces the ladder-verified breakeven at the pre-correction load", () => {
    const load = { low: 0.1, mid: 0.1, high: 0.1, complete: true };
    const flatBand = { ...QSR_BAND_V1, low: 0.715, mid: 0.715, high: 0.715 };
    const r = computeRankTest({
      ...REFERENCE_LOAN,
      fixedFeesAnnual: 8640,
      feeLoad: load,
      band: flatBand,
      item19: REFERENCE_ITEM19,
    });
    expect(r.status).toBe("computed");
    expect(near(r.figures!.breakevenMid, 1062479)).toBe(true);
  });

  it("annuity factor matches the headroom constant", () => {
    expect(near(annuityFactor(10.5, 10), 0.161922, 1e-6)).toBe(true);
  });

  it("debt service matches the disclosed monthly payment on the live report", () => {
    const ds = REFERENCE_LOAN.capitalGap * annuityFactor(10.5, 10);
    expect(near(ds / 12, 15660, 1)).toBe(true);
  });
});

describe("2. leak — free copy carries a conclusion, never a figure", () => {
  const cases = [
    {
      name: "reference",
      input: {
        ...REFERENCE_LOAN,
        fixedFeesAnnual: computeFeeLoad(REFERENCE_FEES).fixedAnnual,
        feeLoad: computeFeeLoad(REFERENCE_FEES),
        band: QSR_BAND_V1,
        item19: REFERENCE_ITEM19,
      },
    },
    {
      name: "emerging",
      input: {
        ...EMERGING_LOAN,
        fixedFeesAnnual: computeFeeLoad(EMERGING_FEES).fixedAnnual,
        feeLoad: computeFeeLoad(EMERGING_FEES),
        band: ENTERTAINMENT_BAND_V1,
        item19: EMERGING_ITEM19,
      },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: headline and note contain no digits or currency`, () => {
      const r = computeRankTest(c.input);
      const text = `${r.freeCopy!.headline} ${r.freeCopy!.note}`;
      expect(/\d/.test(text)).toBe(false);
      expect(/[$€£%]/.test(text)).toBe(false);
    });

    it(`${c.name}: honesty prose contains no digits or currency`, () => {
      const r = computeRankTest(c.input);
      const text = r.honesty.join(" ");
      expect(/\d/.test(text)).toBe(false);
      expect(/[$€£%]/.test(text)).toBe(false);
    });

    it(`${c.name}: coverage copy contains only the two disclosed counts`, () => {
      const r = computeRankTest(c.input);
      const nums = (r.coverageCopy ?? "").match(/\d+/g)?.map(Number) ?? [];
      const allowed = new Set([
        r.coverage!.described,
        r.coverage!.total,
        r.coverage!.notDescribed,
      ]);
      for (const n of nums) expect(allowed.has(n)).toBe(true);
      expect(/[$%]/.test(r.coverageCopy ?? "")).toBe(false);
    });
  }
});

describe("3. double-count — the operating band already holds these", () => {
  it("transaction processing is classified as operating, not load", () => {
    expect(classifyFee({ label: "Transaction processing", ratePctLow: 0.024 })).toBe(
      "operating",
    );
    expect(classifyFee({ label: "Credit card fees", ratePctLow: 0.03 })).toBe("operating");
    expect(classifyFee({ label: "Percentage rent", ratePctLow: 0.06 })).toBe("operating");
  });

  it("the reference load excludes processing and includes the co-op", () => {
    const fl = computeFeeLoad(REFERENCE_FEES);
    expect(fl.complete).toBe(true);
    expect(near(fl.low, 0.11, 1e-9)).toBe(true); // 8 + 2 + 1
    expect(near(fl.high, 0.12, 1e-9)).toBe(true); // 8 + 2 + 2
    expect(near(fl.fixedAnnual, 8640, 1e-9)).toBe(true); // (650 + 70) * 12
  });

  it("one-time fees never reach the load or the fixed total", () => {
    const fl = computeFeeLoad(REFERENCE_FEES);
    const transfer = fl.components.find((c) => /transfer/i.test(c.label))!;
    expect(transfer.bucket).toBe("event");
    expect(transfer.low).toBe(0);
  });

  it("an unrecognised percentage fee is refused, not silently dropped", () => {
    const fl = computeFeeLoad([{ label: "Programme participation", ratePctLow: 0.015 }]);
    expect(fl.complete).toBe(false);
    expect(fl.unclassified).toContain("Programme participation");
  });

  it("a flat fee with no period is refused", () => {
    const fl = computeFeeLoad([{ label: "Support fee", flatAmount: 300 }]);
    expect(fl.complete).toBe(false);
  });
});

describe("4. refusal — never manufacture a performance representation", () => {
  it("no disclosed figures produces unavailable with a reason", () => {
    const fl = computeFeeLoad(EMERGING_FEES);
    const r = computeRankTest({
      ...EMERGING_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: ENTERTAINMENT_BAND_V1,
      item19: NO_PERFORMANCE_ITEM19,
    });
    expect(r.status).toBe("unavailable");
    expect(r.figures).toBe(null);
    expect(r.severity).toBe(null);
    expect(r.reason).toMatch(/disclosed/i);
  });

  it("an incomplete fee load blocks the figure", () => {
    const fl = computeFeeLoad([
      ...EMERGING_FEES,
      { label: "Programme participation", ratePctLow: 0.015 },
    ]);
    const r = computeRankTest({
      ...EMERGING_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: ENTERTAINMENT_BAND_V1,
      item19: EMERGING_ITEM19,
    });
    expect(r.status).toBe("unavailable");
    expect(r.figures).toBe(null);
  });

  it("fees plus band leaving no margin is reported, not divided by zero", () => {
    const r = computeRankTest({
      ...EMERGING_LOAN,
      fixedFeesAnnual: 6000,
      feeLoad: { low: 0.3, mid: 0.32, high: 0.35, complete: true },
      band: { low: 0.7, mid: 0.72, high: 0.75, sourced: "category", version: "bands.v1" },
      item19: EMERGING_ITEM19,
    });
    expect(r.status).toBe("unavailable");
    expect(Number.isFinite(r.figures?.breakevenMid ?? NaN)).toBe(false);
  });
});

describe("severity — triggered from the favourable case", () => {
  it("emerging brand: the lender bar exceeds the best disclosed unit", () => {
    const fl = computeFeeLoad(EMERGING_FEES);
    const r = computeRankTest({
      ...EMERGING_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: ENTERTAINMENT_BAND_V1,
      item19: EMERGING_ITEM19,
    });
    expect(r.severity).toBe("high");
    expect(r.figures!.atBarLow).toBeGreaterThan(EMERGING_ITEM19.highAnnual!);
    expect(near(r.figures!.atBarMid, 526006, 2)).toBe(true);
    expect(r.freeCopy!.headline).toMatch(/best unit/);
  });

  it("reference brand: corrected load lands it above the typical unit, not the best", () => {
    const fl = computeFeeLoad(REFERENCE_FEES);
    const r = computeRankTest({
      ...REFERENCE_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: QSR_BAND_V1,
      item19: REFERENCE_ITEM19,
    });
    expect(r.severity).toBe("medium");
    expect(near(r.figures!.atBarLow, 1187991, 2)).toBe(true);
  });

  it("the correction makes the reference brand strictly worse, never better", () => {
    const corrected = computeFeeLoad(REFERENCE_FEES);
    const before = computeFeeLoad(REFERENCE_FEES_UNCORRECTED);
    expect(corrected.low).toBeGreaterThan(before.low);
    const mk = (fl: ReturnType<typeof computeFeeLoad>) =>
      computeRankTest({
        ...REFERENCE_LOAN,
        fixedFeesAnnual: fl.fixedAnnual,
        feeLoad: fl,
        band: QSR_BAND_V1,
        item19: REFERENCE_ITEM19,
      });
    expect(mk(corrected).figures!.atBarLow).toBeGreaterThan(mk(before).figures!.atBarLow);
  });

  it("severity never uses the midpoint, which would overstate it", () => {
    const fl = computeFeeLoad(REFERENCE_FEES);
    const r = computeRankTest({
      ...REFERENCE_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: QSR_BAND_V1,
      item19: REFERENCE_ITEM19,
    });
    expect(r.figures!.atBarLow).toBeLessThan(r.figures!.atBarMid);
  });
});

describe("coverage and honesty prose", () => {
  it("computes coverage from the two disclosed counts", () => {
    const fl = computeFeeLoad(EMERGING_FEES);
    const r = computeRankTest({
      ...EMERGING_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: ENTERTAINMENT_BAND_V1,
      item19: EMERGING_ITEM19,
    });
    expect(r.coverage).toEqual({ described: 3, total: 120, notDescribed: 117, pct: 0.025 });
  });

  it("fires the small-set warning below the threshold and not above it", () => {
    const fl = computeFeeLoad(EMERGING_FEES);
    const small = computeRankTest({
      ...EMERGING_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: ENTERTAINMENT_BAND_V1,
      item19: EMERGING_ITEM19,
    });
    const large = computeRankTest({
      ...REFERENCE_LOAN,
      fixedFeesAnnual: computeFeeLoad(REFERENCE_FEES).fixedAnnual,
      feeLoad: computeFeeLoad(REFERENCE_FEES),
      band: QSR_BAND_V1,
      item19: REFERENCE_ITEM19,
    });
    expect(EMERGING_ITEM19.unitsDescribed!).toBeLessThan(SMALL_SET_THRESHOLD);
    expect(small.honesty.some((h) => /not a stable signal/.test(h))).toBe(true);
    expect(large.honesty.some((h) => /not a stable signal/.test(h))).toBe(false);
  });

  it("flags multi-year same-unit disclosure as the quality marker it is", () => {
    const fl = computeFeeLoad(EMERGING_FEES);
    const r = computeRankTest({
      ...EMERGING_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: ENTERTAINMENT_BAND_V1,
      item19: EMERGING_ITEM19,
    });
    expect(r.honesty.some((h) => /more than one year/.test(h))).toBe(true);
  });

  it("carries the band table version onto every result, including refusals", () => {
    const fl = computeFeeLoad(EMERGING_FEES);
    const ok = computeRankTest({
      ...EMERGING_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: ENTERTAINMENT_BAND_V1,
      item19: EMERGING_ITEM19,
    });
    const refused = computeRankTest({
      ...EMERGING_LOAN,
      fixedFeesAnnual: fl.fixedAnnual,
      feeLoad: fl,
      band: ENTERTAINMENT_BAND_V1,
      item19: NO_PERFORMANCE_ITEM19,
    });
    expect(ok.bandVersion).toBe("bands.v1");
    expect(refused.bandVersion).toBe("bands.v1");
  });
});
