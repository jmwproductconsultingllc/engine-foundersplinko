import { describe, it, expect } from "vitest";
import { analyzeChurn } from "./churn";

/**
 * THE DENOMINATOR LINT.
 *
 * The whole value of this module is one decision — rates are computed on
 * outlets open at the START of the year, not the year-end headline count. Every
 * growing system understates its churn under the other choice, and a growing
 * system is exactly what gets sold to a first-time buyer. So the base is pinned
 * against three real records, not asserted in a comment.
 */

// Item 20, pp. 55-60 — as extracted, on disk.
const TINT_WORLD = { totalUnits: 149, openedLastYear: 11, closedLastYear: 7, transfersLastYear: 24, sourcePage: "Item 20, pp. 55-60" };
// Item 20, p. 70, 79 — the transfer-without-closure shape.
const STRETCH_ZONE = { totalUnits: 413, openedLastYear: 36, closedLastYear: 0, transfersLastYear: 67, sourcePage: "Item 20, p. 70, 79" };
// Item 20 (year-end 2025) — a large, low-churn system.
const CRUMBL = { totalUnits: 1101, openedLastYear: 52, closedLastYear: 9, transfersLastYear: 82, sourcePage: "Item 20 (year-end 2025)" };

describe("the denominator", () => {
  it("reconstructs outlets at the start of the year, not the year-end count", () => {
    const c = analyzeChurn(TINT_WORLD);
    // 149 at year end − 11 opened + 7 closed = 145 open on day one.
    expect(c.base).toBe(145);
    expect(c.baseExact).toBe(true);
    // The wrong base (149) would print 4.7% / 16.1% / 20.8% — flattering, and wrong.
    expect(c.closed!.pct).toBe(4.8);
    expect(c.transfers!.pct).toBe(16.6);
    expect(c.ownerTurnover!.pct).toBe(21.4);
    expect(c.ownerTurnover!.count).toBe(31);
    expect(c.netChange).toBe(4);
    expect(c.tier).toBe("High");
  });

  it("says how it got the denominator, in the copy", () => {
    const c = analyzeChurn(TINT_WORLD);
    expect(c.baseNote).toContain("145");
    expect(c.baseNote).toContain("149");
    expect(c.baseNote).toContain("start of the year");
  });

  it("flags an inexact base rather than pretending", () => {
    const c = analyzeChurn({ totalUnits: 200, closedLastYear: 10, transfersLastYear: 5 });
    expect(c.computable).toBe(true);
    expect(c.baseExact).toBe(false);
    expect(c.baseNote).toMatch(/run slightly low/i);
  });
});

describe("the transfer-without-closure shape", () => {
  it("names it, and does not characterise it", () => {
    const c = analyzeChurn(STRETCH_ZONE);
    expect(c.base).toBe(377);
    expect(c.closed!.count).toBe(0);
    expect(c.transfers!.pct).toBe(17.8);
    expect(c.ownerTurnover!.pct).toBe(17.8);
    expect(c.tier).toBe("High");
    expect(c.tell).toMatch(/Nothing closed/);
    // Item 20 gives no reason for a transfer, so neither do we.
    expect(c.tell).toMatch(/reads two ways/);
  });

  it("zero closures is a disclosure, not a missing figure", () => {
    const c = analyzeChurn(STRETCH_ZONE);
    expect(c.closed).not.toBeNull();
    expect(c.closed!.pct).toBe(0);
    expect(c.unavailable).toBeNull();
  });
});

describe("tiers", () => {
  it("a big system with ordinary churn does not read as alarming", () => {
    const c = analyzeChurn(CRUMBL);
    expect(c.base).toBe(1058);
    expect(c.closed!.pct).toBe(0.9);
    expect(c.ownerTurnover!.pct).toBe(8.6);
    expect(c.tier).toBe("Medium");
  });

  it("suppresses the tier on a system too small for a rate to mean anything", () => {
    const c = analyzeChurn({ totalUnits: 12, openedLastYear: 3, closedLastYear: 2, transfersLastYear: 1 });
    // base 11, turnover 3/11 = 27.3% — arithmetically true, informationally noise.
    expect(c.base).toBe(11);
    expect(c.smallSystem).toBe(true);
    expect(c.tier).toBeNull();
    expect(c.headline).toMatch(/read the counts before the rate/);
  });

  it("a clean year says so plainly", () => {
    const c = analyzeChurn({ totalUnits: 300, openedLastYear: 20, closedLastYear: 0, transfersLastYear: 0 });
    expect(c.ownerTurnover!.count).toBe(0);
    expect(c.tier).toBe("Low");
    expect(c.headline).toMatch(/No outlet closed or changed hands/);
  });
});

describe("a figure that cannot be true is not a disclosure", () => {
  it("refuses closures larger than the system could have lost", () => {
    const c = analyzeChurn({ totalUnits: 40, openedLastYear: 2, closedLastYear: 300, transfersLastYear: 1 });
    expect(c.computable).toBe(false);
    expect(c.unavailable).toMatch(/mis-read/);
  });

  it("but a system that HALVED in one year still gets its number", () => {
    // 100 open on day one, 60 closed, 40 left. Catastrophic and entirely possible.
    // The gate catches the impossible, never the merely bad.
    const c = analyzeChurn({ totalUnits: 40, openedLastYear: 0, closedLastYear: 60, transfersLastYear: 3 });
    expect(c.computable).toBe(true);
    expect(c.base).toBe(100);
    expect(c.closed!.pct).toBe(60);
    expect(c.tier).toBe("High");
  });

  it("refuses a system that does not reconcile", () => {
    const c = analyzeChurn({ totalUnits: 10, openedLastYear: 400, closedLastYear: 0 });
    expect(c.computable).toBe(false);
    expect(c.unavailable).toMatch(/do not reconcile/);
  });

  it("ignores negative and non-finite counts rather than trusting them", () => {
    const c = analyzeChurn({ totalUnits: 100, openedLastYear: -5, closedLastYear: 4, transfersLastYear: Number.NaN });
    expect(c.computable).toBe(true);
    expect(c.base).toBe(104);
    expect(c.transfers).toBeNull();
  });
});

describe("a figure that does not exist gets WORDS", () => {
  it("no outlet count", () => {
    const c = analyzeChurn({ sourcePage: "Item 20, p. 3" });
    expect(c.computable).toBe(false);
    expect(c.unavailable).toMatch(/does not carry a systemwide outlet count/);
    expect(c.headline).not.toMatch(/^[—-]$/);
  });

  it("counts but no churn figures", () => {
    const c = analyzeChurn({ totalUnits: 8780, openedLastYear: 281, sourcePage: "Item 20, p. 91" });
    expect(c.computable).toBe(false);
    expect(c.base).toBe(8780);
    expect(c.unavailable).toMatch(/not its closures or transfers/);
  });

  it("null and undefined are handled, and still answer with words", () => {
    for (const v of [null, undefined]) {
      const c = analyzeChurn(v);
      expect(c.computable).toBe(false);
      expect(c.unavailable && c.unavailable.length).toBeGreaterThan(20);
      expect(c.question.length).toBeGreaterThan(20);
    }
  });
});

/**
 * THE ADDING-UP LINT.
 *
 * A buyer who checks our arithmetic and finds the column does not add does not
 * conclude "rounding" — they conclude the engine is sloppy, and that conclusion
 * is contagious to every other figure on the page. The parts must sum to the
 * whole for every system in the corpus, not only the ones we happened to pin.
 */
describe("the printed figures add up", () => {
  it("reconciles the shipped Crumbl card: 0.9 + 7.7 = 8.6", () => {
    const c = analyzeChurn(CRUMBL);
    // Raw: 9/1058 = 0.851%, 82/1058 = 7.750%, 91/1058 = 8.601%.
    // Rounded independently those print 0.9 + 7.8 beside a total of 8.6.
    expect(c.closed!.pct).toBe(0.9);
    expect(c.transfers!.pct).toBe(7.7);
    expect(c.ownerTurnover!.pct).toBe(8.6);
    expect(c.closed!.pct + c.transfers!.pct).toBeCloseTo(c.ownerTurnover!.pct, 10);
  });

  it("leaves a pair that already reconciled exactly where it was", () => {
    // Tint World's shares happen to round cleanly. Apportionment must not move
    // a figure that was never broken.
    const c = analyzeChurn(TINT_WORLD);
    expect(c.closed!.pct).toBe(4.8);
    expect(c.transfers!.pct).toBe(16.6);
    expect(c.ownerTurnover!.pct).toBe(21.4);
  });

  it("holds across every outlet shape in the corpus", () => {
    for (let total = 3; total <= 1200; total += 7) {
      for (const [opened, closed, transfers] of [
        [0, 1, 0], [5, 0, 9], [12, 7, 24], [1, 1, 1], [40, 39, 61], [0, 0, 3], [3, 0, 0],
      ]) {
        const c = analyzeChurn({
          totalUnits: total, openedLastYear: opened, closedLastYear: closed, transfersLastYear: transfers,
        });
        if (!c.computable || !c.ownerTurnover) continue;
        const parts = (c.closed?.pct ?? 0) + (c.transfers?.pct ?? 0);
        expect(parts, `total=${total} closed=${closed} xfer=${transfers}`).toBeCloseTo(c.ownerTurnover.pct, 10);
      }
    }
  });

  it("keeps every apportioned part within a tenth of its true share", () => {
    for (let total = 5; total <= 900; total += 13) {
      const c = analyzeChurn({ totalUnits: total, openedLastYear: 4, closedLastYear: 3, transfersLastYear: 11 });
      if (!c.computable || !c.base) continue;
      expect(Math.abs(c.closed!.pct - (3 / c.base) * 100)).toBeLessThanOrEqual(0.1000001);
      expect(Math.abs(c.transfers!.pct - (11 / c.base) * 100)).toBeLessThanOrEqual(0.1000001);
    }
  });
});

describe("copy law", () => {
  const all = [TINT_WORLD, STRETCH_ZONE, CRUMBL, {}, { totalUnits: 12, openedLastYear: 3, closedLastYear: 2, transfersLastYear: 1 }];

  it("describes the system, never our analysis, and never names a cutoff", () => {
    for (const s of all) {
      const c = analyzeChurn(s);
      const text = `${c.headline} ${c.tell ?? ""} ${c.question} ${c.baseNote ?? ""} ${c.unavailable ?? ""}`.toLowerCase();
      for (const banned of ["our audit", "inflated", "thoroughness", "we flag", "our threshold", "our cutoff"]) {
        expect(text, `"${banned}" in churn copy`).not.toContain(banned);
      }
    }
  });

  it("always hands the reader a next action", () => {
    for (const s of all) {
      expect(analyzeChurn(s).question).toMatch(/Item 20/);
    }
  });

  it("carries DERIVED provenance and never claims the rate was disclosed", () => {
    for (const s of all) expect(analyzeChurn(s).basis).toBe("derived");
  });
});
