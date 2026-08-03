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

  it("says how it got the denominator, in the copy — and says it is a reconstruction", () => {
    const c = analyzeChurn(TINT_WORLD);
    expect(c.baseNote).toContain("145");
    /* This record carries no unitsStartOfYear, so 145 is arithmetic we did, not
       a figure Item 20 Table 1 states. The copy used to say "were open at the
       start of the year" here, in the same words it uses for a disclosed count.
       That is the sentence that shipped 179 to seniors-helping-seniors. */
    expect(c.baseDisclosed).toBe(false);
    expect(c.baseNote).toMatch(/reconstruction/i);
    expect(c.baseNote).toMatch(/rather than read from Item 20 Table 1/);
    expect(c.baseNote, "a reconstruction must not be phrased as a reconciliation").not.toMatch(
      /reconcile/i,
    );
    /* RULE 5. This assertion used to read toContain("149") — the copy printed
       the year-end total, the openings and the closures to SHOW its work, and
       all three are masked on the same glass card a few lines above the note.
       145 stays because it is one equation in three unknowns and recovers none
       of them; 149, 11 and 7 go. See THE FREE-TEXT SEAM in lib/reportShell.ts. */
    for (const masked of ["149", "11", "7"]) {
      expect(c.baseNote, `note spells out the masked figure ${masked}`).not.toContain(masked);
    }
  });

  it("flags an inexact base rather than pretending", () => {
    const c = analyzeChurn({ totalUnits: 200, closedLastYear: 10, transfersLastYear: 5 });
    expect(c.computable).toBe(true);
    expect(c.baseExact).toBe(false);
    expect(c.baseNote).toMatch(/run slightly low/i);
  });

  it("prints no number at all when the base is inexact", () => {
    /* The reconstruction is safe to print because total − opened + closed is one
       equation in three unknowns. The INEXACT base is not: at least one movement
       is missing, and where both are, `base` collapses to `total` exactly — so
       the note would print the masked total-unit count in words, on the same
       card, directly under its own mask. Two live brands were doing this
       (learning-express-toys-gifts 79, the-original-rainbow-cone 27) and neither
       leak instrument could see it. Found by the seam, not by reading. */
    const both = analyzeChurn({ totalUnits: 79, transfersLastYear: 4 });
    expect(both.baseExact).toBe(false);
    expect(both.base, "base collapses to total when both movements are absent").toBe(79);
    expect(both.baseNote, "the note IS the mask's own value").not.toContain("79");
    expect(both.baseNote).toMatch(/does not disclose the starting outlet count/);
    expect(both.baseNote).toMatch(/run slightly low/i);

    // One movement present is the same rule: still inexact, still no number.
    const one = analyzeChurn({ totalUnits: 200, closedLastYear: 10, transfersLastYear: 5 });
    expect(one.base).toBe(210);
    for (const masked of ["210", "200", "10"]) {
      expect(one.baseNote, `inexact note spells out ${masked}`).not.toContain(masked);
    }
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

/**
 * THE FALSIFIABILITY LINT.
 *
 * The defect this block exists for shipped to a live brand page:
 *
 *   "179 outlets were open at the start of the year: 224 at year end, less 54
 *    opened, plus 9 closed."
 *
 * Item 20 Table 1 discloses 180. The sentence read like a check on the
 * franchisor's table and was structurally incapable of failing, because `base`
 * was DEFINED as end − opened + closed. A quantity defined by an equation always
 * satisfies that equation.
 *
 * So the property under test is not "the arithmetic is right" — it was always
 * right. It is: a printed reconciliation must be computed from an INDEPENDENTLY
 * OBTAINED quantity, and where that quantity disagrees, the sentence must not
 * render at all.
 *
 * MUTATION-PROVEN: restore `const base = reconstructed;` and the disclosed-start
 * cases go red; restore the old single-branch baseNote and the suppression cases
 * go red.
 */
describe("THE FALSIFIABILITY LINT — a reconciliation that can fail", () => {
  /* The real record, with the real Table 1 start count, and the two Table 3
     figures exactly as they were mis-extracted (54 from an Item 19 note, 9 from
     the terminations column alone). 180 + 54 − 9 = 225, not 224. */
  const SENIORS_AS_EXTRACTED = {
    totalUnits: 224,
    unitsStartOfYear: 180,
    openedLastYear: 54,
    closedLastYear: 9,
    transfersLastYear: 2,
    sourcePage: "Item 20, p. 46",
  };
  /* The same system with a Table 3 read that closes: 180 + 53 − 9 = 224. */
  const SENIORS_RECONCILED = { ...SENIORS_AS_EXTRACTED, openedLastYear: 53 };

  it("prefers the disclosed start count over its own reconstruction", () => {
    const c = analyzeChurn(SENIORS_AS_EXTRACTED);
    // The reconstruction is 224 − 54 + 9 = 179. That is the number that shipped.
    expect(c.base, "reconstruction won over the disclosed figure").toBe(180);
    expect(c.baseDisclosed).toBe(true);
    expect(c.baseExact).toBe(true);
  });

  it("catches a table that does not close, and refuses to print the sentence", () => {
    const c = analyzeChurn(SENIORS_AS_EXTRACTED);
    expect(c.reconciles).toBe(false);
    // The claim of a reconciliation is the thing being withheld.
    expect(c.baseNote).not.toMatch(/reconcile/i);
    expect(c.baseNote).toContain("as Item 20 Table 1 discloses");
    expect(c.baseNote).toContain("180");
  });

  it("hands the buyer the finding instead", () => {
    const c = analyzeChurn(SENIORS_AS_EXTRACTED);
    expect(c.unreconciled).toBeTruthy();
    expect(c.unreconciled!).toMatch(/does not close/);
    expect(c.unreconciled!).toMatch(/Ask the franchisor/);
    /* It must not name a culprit. The disclosure does not say which of the four
       figures is wrong and neither do we — that guess is the failure mode this
       whole module is a reaction to. */
    expect(c.unreconciled!).toMatch(/One of those four figures is wrong/);
    /* RULE 5, and this is the version of it that costs something. The finding
       used to print 225 (what Table 3 implies) beside 224 (what Table 1 states),
       because the contradiction is more vivid with the two numbers in it. But
       224 is the masked total-unit count, and 225 hands back the openings and
       closures to anyone who subtracts. A finding that needs the numbers printed
       to land was never about the numbers: "their own table does not add up"
       lands without them, and the reader who wants the four figures is exactly
       the reader we want unlocking. */
    for (const masked of ["225", "224", "180", "54"]) {
      expect(c.unreconciled!, `finding spells out the masked figure ${masked}`).not.toContain(
        masked,
      );
    }
  });

  it("prints the reconciliation only when it actually reconciled", () => {
    const c = analyzeChurn(SENIORS_RECONCILED);
    expect(c.reconciles).toBe(true);
    expect(c.unreconciled).toBeNull();
    expect(c.baseNote).toMatch(/reconcile to the year-end count stated in the same table/);
    expect(c.baseNote).toContain("as Item 20 Table 1 discloses");
    // The claim is made; the year-end count it was checked against is not printed.
    expect(c.baseNote).not.toContain("224");
  });

  it("does not claim a check it could not run", () => {
    // Start disclosed, movements not. Nothing to check it against.
    const c = analyzeChurn({ totalUnits: 224, unitsStartOfYear: 180, transfersLastYear: 2 });
    expect(c.base).toBe(180);
    expect(c.baseDisclosed).toBe(true);
    expect(c.reconciles).toBeNull();
    expect(c.unreconciled).toBeNull();
    expect(c.baseNote).not.toMatch(/reconcile/i);
  });

  it("leaves every record that predates the field exactly where it was", () => {
    // 83 of 83 on-disk records carry no unitsStartOfYear. They must not move.
    for (const s of [TINT_WORLD, STRETCH_ZONE, CRUMBL]) {
      const c = analyzeChurn(s);
      expect(c.baseDisclosed).toBe(false);
      expect(c.reconciles).toBeNull();
      expect(c.unreconciled).toBeNull();
    }
    expect(analyzeChurn(TINT_WORLD).base).toBe(145);
    expect(analyzeChurn(CRUMBL).base).toBe(1058);
  });
});

/**
 * THE ABSENT-DISCLOSURE LINT.
 *
 * Same defect as above, one frame smaller. ownerTurnover used to fire when
 * EITHER component was disclosed, coalescing the missing one to 0 — so a record
 * carrying transfers and no closure count printed a combined turnover RATE that
 * silently asserted nothing closed. An absent disclosure is not a disclosed zero.
 *
 * 79 of 83 catalog records carry both and are unaffected; STRETCH_ZONE above
 * pins the case where 0 really IS the disclosure.
 */
describe("THE ABSENT-DISCLOSURE LINT — a missing count is never a zero", () => {
  it("withholds the combined rate when only transfers are disclosed", () => {
    const c = analyzeChurn({ totalUnits: 300, openedLastYear: 10, transfersLastYear: 21 });
    expect(c.computable).toBe(true);
    expect(c.ownerTurnover, "printed a turnover rate that asserts zero closures").toBeNull();
    expect(c.tier, "tiered a system on a rate it does not have").toBeNull();
    // The one figure that IS disclosed still gets its own honest rate.
    expect(c.transfers!.count).toBe(21);
    expect(c.transfers!.pct).toBe(7.2); // 21/290
    expect(c.closed).toBeNull();
    expect(c.headline).toMatch(/21 outlets changed hands/);
    expect(c.headline).toMatch(/no closure count/);
    expect(c.headline).toMatch(/at least this figure/);
  });

  it("withholds it the other way round too, and names the half that is missing", () => {
    const c = analyzeChurn({ totalUnits: 300, openedLastYear: 10, closedLastYear: 4 });
    expect(c.ownerTurnover).toBeNull();
    expect(c.transfers).toBeNull();
    expect(c.closed!.count).toBe(4);
    expect(c.closed!.pct).toBe(1.4); // 4/294
    expect(c.headline).toMatch(/4 outlets closed/);
    expect(c.headline).toMatch(/no transfer count/);
  });

  it("a disclosed zero is still a disclosure and still prints", () => {
    // The guard must fire on ABSENCE, never on the value 0.
    const c = analyzeChurn(STRETCH_ZONE);
    expect(c.closed!.count).toBe(0);
    expect(c.ownerTurnover).not.toBeNull();
    expect(c.ownerTurnover!.pct).toBe(17.8);
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
