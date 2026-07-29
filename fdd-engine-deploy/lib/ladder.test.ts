import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildCashLadder,
  amortize,
  paymentFactor,
  maxSupportableLoan,
  type LadderInput,
} from "./ladder";
import { NOODLES_LADDER_INPUT } from "./fixtures/noodles";

describe("amortization", () => {
  it("matches the standard payment factor at 10.5% / 10yr", () => {
    // f = r / (1 - (1+r)^-n). This constant is quoted in the report UI and in
    // every reconciliation we have done by hand; pin it.
    expect(paymentFactor(10.5, 10)).toBeCloseTo(0.013493, 6);
  });

  it("payment = loan x factor", () => {
    expect(amortize(1_209_500, 10.5, 10)).toBeCloseTo(1_209_500 * paymentFactor(10.5, 10), 6);
  });

  it("handles a zero rate without dividing by zero", () => {
    expect(amortize(120_000, 0, 10)).toBeCloseTo(1000, 6);
  });

  it("returns 0 rather than NaN for degenerate input", () => {
    expect(amortize(0, 10.5, 10)).toBe(0);
    expect(amortize(-5, 10.5, 10)).toBe(0);
    expect(amortize(100, 10.5, 0)).toBe(0);
  });

  it("maxSupportableLoan inverts amortize at the target ratio", () => {
    const loan = maxSupportableLoan(20_000, 1.25, 10.5, 10);
    const payment = amortize(loan, 10.5, 10);
    expect(20_000 / payment).toBeCloseTo(1.25, 6);
  });
});

describe("cash ladder — structure", () => {
  const l = buildCashLadder(NOODLES_LADDER_INPUT);

  it("has exactly 13 rungs in order", () => {
    expect(l.rungs).toHaveLength(13);
    l.rungs.forEach((r, i) => expect(r.n).toBe(i + 1));
  });

  it("only rung 9 is allowed to say EBITDA", () => {
    const offenders = l.rungs.filter(
      (r) => /ebitda/i.test(r.label) && r.id !== "operatingEbitda",
    );
    expect(offenders.map((r) => r.label)).toEqual([]);
  });

  it("rung 5 is explicitly labelled as not-profit", () => {
    const r5 = l.get("marginAfterFeesAndRent")!;
    expect(r5.label).not.toMatch(/ebitda/i);
    expect(r5.note).toMatch(/not profit/i);
  });

  it("every rung carries a provenance basis and a source", () => {
    for (const r of l.rungs) {
      expect(["disclosed", "derived", "benchmark", "inferred"]).toContain(r.basis);
      expect(r.source.length).toBeGreaterThan(0);
    }
  });
});

describe("cash ladder — arithmetic ties out", () => {
  const l = buildCashLadder(NOODLES_LADDER_INPUT);
  const g = (id: Parameters<typeof l.get>[0]) => l.get(id)!;

  it("rung 5 = rung 1 − 2 − 3 − 4", () => {
    const expected =
      g("revenue").monthly!.hi -
      g("franchiseFees").monthly!.hi -
      g("fixedFees").monthly!.hi -
      g("occupancy").monthly!.hi;
    expect(g("marginAfterFeesAndRent").monthly!.hi).toBeCloseTo(expected, 0);
  });

  it("rung 9 = rung 5 − 6 − 7 − 8", () => {
    const expected =
      g("marginAfterFeesAndRent").monthly!.hi -
      g("cogs").monthly!.lo -
      g("labor").monthly!.lo -
      g("otherOpex").monthly!.lo;
    expect(g("operatingEbitda").monthly!.hi).toBeCloseTo(expected, 0);
  });

  it("rung 11 = rung 9 − rung 10", () => {
    // Each rung is rounded independently for display, so allow $1 of drift.
    const expected = g("operatingEbitda").monthly!.lo - g("debtService").monthly!.hi;
    expect(Math.abs(g("cashAfterDebt").monthly!.lo - expected)).toBeLessThanOrEqual(1);
  });

  it("rung 12 = rung 9 ÷ rung 10", () => {
    const expected = g("operatingEbitda").monthly!.lo / g("debtService").monthly!.hi;
    expect(g("dscr").monthly!.lo).toBeCloseTo(expected, 4);
  });

  it("rung 9 is materially below rung 5 — the defect this module fixes", () => {
    // The old code stored rung 5 in a field named monthlyEbitda. If these two
    // ever converge, someone has re-wired a consumer back onto the wrong line.
    expect(g("operatingEbitda").monthly!.hi).toBeLessThan(
      g("marginAfterFeesAndRent").monthly!.hi * 0.5,
    );
  });

  it("DSCR is computed off rung 9, not rung 5", () => {
    const wrong =
      g("marginAfterFeesAndRent").monthly!.hi / g("debtService").monthly!.hi;
    expect(g("dscr").monthly!.hi).toBeLessThan(wrong / 2);
  });
});

describe("cash ladder — Noodles & Company, all figures disclosed", () => {
  const l = buildCashLadder(NOODLES_LADDER_INPUT);
  const g = (id: Parameters<typeof l.get>[0]) => l.get(id)!;

  it("gross revenue is the blended network average from Item 19", () => {
    expect(g("revenue").monthly!.hi).toBe(112_695);
    // 1,352,345 / 12 rounds to a whole dollar before being re-annualized.
    expect(Math.abs(g("revenue").annual!.hi - 1_352_345)).toBeLessThanOrEqual(12);
  });

  it("franchise fees total 9.00% — royalty 5 + BDF 1.75 + FMF 1.0 + MAF 1.25", () => {
    expect(g("franchiseFees").pctOfRevenue!.hi).toBeCloseTo(9.0, 6);
    expect(g("franchiseFees").monthly!.hi).toBe(10_143);
  });

  it("occupancy is disclosed at 9.3% of net sales, not a benchmark", () => {
    expect(g("occupancy").basis).toBe("disclosed");
    expect(g("occupancy").monthly!.hi).toBe(10_481);
  });

  it("the operating cost block is DISCLOSED for this brand, not benchmarked", () => {
    expect(g("cogs").basis).toBe("disclosed");
    expect(g("labor").basis).toBe("disclosed");
    expect(g("otherOpex").basis).toBe("disclosed");
    expect(l.usesBenchmark).toBe(false);
  });

  it("true operating EBITDA is roughly $2.3k/mo — not the ~$91k rung 5", () => {
    const e = g("operatingEbitda").monthly!;
    expect(e.hi).toBeGreaterThan(2_000);
    expect(e.hi).toBeLessThan(2_600);
    expect(g("marginAfterFeesAndRent").monthly!.hi).toBeGreaterThan(90_000);
  });

  it("EBITDA margin reconciles to Item 19's 11.8% less the 9% franchisee fee load", () => {
    // Item 19 p.78 states Restaurant EBITDA 11.8% of net sales for COMPANY units,
    // which pay no royalty and no marketing fees. A franchisee pays 9.00% of
    // sales plus $1,000/mo RTS. 11.8 - 9.0 = 2.8%, less RTS.
    const pct = g("operatingEbitda").pctOfRevenue!.hi;
    expect(pct).toBeGreaterThan(1.5);
    expect(pct).toBeLessThan(2.5);
  });

  it("at the disclosed $1.2095M loan the unit does not cover its debt", () => {
    expect(g("dscr").monthly!.hi).toBeLessThan(0.2);
    expect(g("cashAfterDebt").monthly!.hi).toBeLessThan(0);
  });

  it("max supportable debt at the 1.25 lender convention is small", () => {
    const e = g("operatingEbitda").monthly!.hi;
    const loan = maxSupportableLoan(e, 1.25, 10.5, 10);
    expect(loan).toBeGreaterThan(100_000);
    expect(loan).toBeLessThan(160_000);
  });
});

describe("cash ladder — degenerate input", () => {
  it("emits all 13 rungs with null figures when revenue is missing", () => {
    const l = buildCashLadder({ ...NOODLES_LADDER_INPUT, monthlyRevenue: null });
    expect(l.rungs).toHaveLength(13);
    expect(l.rungs.every((r) => r.monthly === null)).toBe(true);
    expect(l.operatingEbitda).toBeNull();
    expect(l.dscr).toBeNull();
  });

  it("falls back to the occupancy benchmark when no rent resolves, and says so", () => {
    const l = buildCashLadder({ ...NOODLES_LADDER_INPUT, rentMonthly: null });
    const occ = l.get("occupancy")!;
    expect(occ.basis).toBe("benchmark");
    expect(occ.monthly!.lo).toBeLessThan(occ.monthly!.hi);
    expect(l.usesBenchmark).toBe(true);
  });

  it("reports the best-end payback and flags 'never' at the low end when EBITDA straddles zero", () => {
    // The old contract nulled the whole rung here, which threw away a real
    // figure the buyer needs: it recovers at the good end and never at the bad
    // one. Both halves are now carried, and paybackNeverAtLowEnd is what the
    // renderer reads so "never" is never printed as a number.
    const input: LadderInput = {
      ...NOODLES_LADDER_INPUT,
      costs: { ...NOODLES_LADDER_INPUT.costs, laborPct: [31.8, 60] },
    };
    const l = buildCashLadder(input);
    const p = l.get("payback")!;
    expect(p.monthly).not.toBeNull();
    expect(Number.isFinite(p.monthly!.lo)).toBe(true);
    expect(p.monthly!.hi).toBe(Number.POSITIVE_INFINITY);
    expect(l.paybackNeverAtLowEnd).toBe(true);
    expect(p.note).toMatch(/never recovered/i);
  });

  it("nulls the payback rung only when nothing in the range recovers", () => {
    const input: LadderInput = {
      ...NOODLES_LADDER_INPUT,
      costs: { ...NOODLES_LADDER_INPUT.costs, laborPct: [60, 80] },
    };
    const l = buildCashLadder(input);
    expect(l.get("payback")!.monthly).toBeNull();
    expect(l.get("payback")!.note).toMatch(/never recovered/i);
    // WORDS, not a dash: the null rung still carries an explanation.
    expect(l.get("payback")!.source).not.toMatch(/rung 13/i);
  });

  it("a healthy range reports a finite payback at both ends", () => {
    const l = buildCashLadder(NOODLES_LADDER_INPUT);
    const p = l.get("payback")!;
    if (p.monthly) {
      expect(l.paybackNeverAtLowEnd).toBe(Number.isFinite(p.monthly.hi) === false);
    }
  });

  it("omits debt rungs cleanly when no financing is entered", () => {
    const l = buildCashLadder({ ...NOODLES_LADDER_INPUT, financing: null });
    expect(l.get("debtService")!.monthly).toBeNull();
    expect(l.get("dscr")!.monthly).toBeNull();
    expect(l.get("payback")!.monthly).not.toBeNull(); // payback needs no financing
  });

  it("all cash: rung 11 is rung 9, not an absent figure", () => {
    // The rungs that genuinely do not exist without a lender are 10 and 12.
    // Rung 11 does exist — subtracting nothing is a real subtraction — and the
    // all-cash buyer reads it as their number. Nulling it printed "not
    // disclosed" over a figure computed one rung above.
    const l = buildCashLadder({ ...NOODLES_LADDER_INPUT, financing: null });
    const nine = l.get("operatingEbitda")!.monthly!;
    const eleven = l.get("cashAfterDebt")!.monthly;
    expect(eleven).not.toBeNull();
    expect(eleven!.lo).toBe(nine.lo);
    expect(eleven!.hi).toBe(nine.hi);
    expect(l.get("cashAfterDebt")!.source).toMatch(/no debt service/i);
  });
});

describe("copy law", () => {
  const l = buildCashLadder(NOODLES_LADDER_INPUT);

  it("attributes 1.25 to lenders, never to us", () => {
    const note = l.get("dscr")!.note ?? "";
    expect(note).toMatch(/lenders typically want/i);
    expect(note).not.toMatch(/\bwe flag\b|\bour (bar|threshold|cutoff|rubric)\b/i);
  });

  it("never publishes an internal rubric threshold in a rung's copy", () => {
    const text = l.rungs.map((r) => `${r.label} ${r.source} ${r.note ?? ""}`).join(" ") + " " + l.blockNote;
    // 1.25 is permitted (lender convention). Our own rubric numbers are not.
    expect(text).not.toMatch(/below (our|the) (threshold|cutoff|bar)/i);
    expect(text).not.toMatch(/we (flag|score|penali[sz]e)/i);
  });

  it("uses no banned nouns about our own analysis", () => {
    const text = (l.rungs.map((r) => `${r.label} ${r.note ?? ""}`).join(" ") + " " + l.blockNote).toLowerCase();
    for (const banned of ["thoroughness", "our audit", "inflated"]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("SOURCE LINT — the ladder math lives in exactly one file", () => {
  /**
   * RATCHET. These two allowlists are the remaining FE-101 work, written down
   * so it cannot be forgotten. Each entry is a module that still does the
   * ladder's arithmetic itself instead of reading lib/ladder.ts.
   *
   * The lists may only ever SHRINK. Adding a name to either one is the thing
   * this test exists to prevent; removing the last name is the definition of
   * FE-101 being done. Deleting a name without migrating the module will fail
   * the test, which is the point.
   */
  const MIGRATION_PENDING_SUBTRACTION = ["scoring.ts"];
  const MIGRATION_PENDING_AMORTIZE = ["scoring.ts"];

  /**
   * The scan used to walk lib/ ONLY — which left components/, the one directory
   * most likely to reconstruct a rung inline for display, as the place the lint
   * could not see. A ratchet with a blind spot ratchets nothing. It walks both
   * now; hits are reported as bare file names so the allowlists above keep
   * reading as module names.
   */
  const roots = ["lib", "components"];
  const files: string[] = [];
  for (const root of roots) {
    const dir = path.join(process.cwd(), root);
    for (const f of fs.readdirSync(dir)) {
      if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
      files.push(path.join(root, f));
    }
  }

  const scan = (re: RegExp) => {
    const hits: string[] = [];
    for (const f of files) {
      if (f === path.join("lib", "ladder.ts")) continue;
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      if (re.test(src)) hits.push(path.basename(f));
    }
    return hits.sort();
  };

  it("no NEW module recomputes revenue − variable − fixed", () => {
    expect(scan(/monthlyRevenue\s*-\s*\w*[Vv]ariable\s*-\s*\w*[Ff]ixed/)).toEqual(
      [...MIGRATION_PENDING_SUBTRACTION].sort(),
    );
  });

  it("no NEW module defines its own amortize()", () => {
    expect(scan(/function\s+amortize\s*\(/)).toEqual(
      [...MIGRATION_PENDING_AMORTIZE].sort(),
    );
  });

  it("the allowlists are shrinking, not growing", () => {
    // Pinned at the FE-100 baseline. When FE-101 lands these go to 0 and this
    // assertion is updated down, never up.
    expect(MIGRATION_PENDING_SUBTRACTION.length).toBeLessThanOrEqual(1);
    expect(MIGRATION_PENDING_AMORTIZE.length).toBeLessThanOrEqual(1);
  });
});

describe("mobile density — a caveat is stated once", () => {
  /**
   * On a 390px screen the identical three-line warning printed on rungs 6, 7 AND
   * 8, and again in the section footer: four copies of one sentence, roughly a
   * third of the visible screen, inside a table the buyer is trying to read as
   * arithmetic. A reader who meets the same footnote three times stops reading
   * footnotes, which is exactly the outcome a caveat exists to prevent.
   */
  const l = buildCashLadder(NOODLES_LADDER_INPUT);
  const COST_RUNGS = ["cogs", "labor", "otherOpex"] as const;

  it("rungs 6-8 carry no footnote of their own", () => {
    for (const id of COST_RUNGS) expect(l.get(id)!.note, id).toBeUndefined();
  });

  it("the block's provenance and caveat survive, once, on the ladder", () => {
    expect(l.blockNote).toContain(NOODLES_LADDER_INPUT.costs.source);
    expect(l.blockNote).toContain(NOODLES_LADDER_INPUT.costs.note!.replace(/\.$/, ""));
    // Once. Not once per rung.
    const first = l.blockNote.slice(0, 40);
    expect(l.blockNote.split(first).length - 1).toBe(1);
  });

  it("each cost rung's source is its OWN band, so the three rows differ", () => {
    const sources = COST_RUNGS.map((id) => l.get(id)!.source);
    expect(new Set(sources).size).toBe(3);
    for (const src of sources) expect(src).toMatch(/^[\d.]+(–[\d.]+)?% of revenue$/);
  });

  it("the band reaches a phone, where the % column is hidden", () => {
    // Noodles discloses 26.4 / 31.8 / 20.6 as point estimates.
    expect(l.get("cogs")!.source).toBe("26.4% of revenue");
    expect(l.get("labor")!.source).toBe("31.8% of revenue");
    expect(l.get("otherOpex")!.source).toBe("20.6% of revenue");
  });

  it("no rung's source or value contains a breakable range", () => {
    // An ordinary space either side of an en-dash is where "$16,018 – $25,629"
    // splits into three lines on an iPhone. lib/range.ts owns that join.
    for (const r of l.rungs) {
      expect(r.source, r.id).not.toMatch(/\s–\s/);
      expect(r.note ?? "", r.id).not.toMatch(/\s–\s/);
    }
  });
});
