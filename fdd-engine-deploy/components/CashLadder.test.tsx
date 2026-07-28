import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * THE ONE-LADDER TEST.
 *
 * The defect this whole commit exists to kill: the paid report derived
 * operating EBITDA in three places, with three different definitions, and
 * disagreed with itself on the same screen. The fix is a rule — one CashLadder
 * object per render, every figure read off it — and a rule that lives only in a
 * comment gets broken by the next person building against it.
 *
 * So the rule is a lint. buildCashLadder is wrapped with a counter; rendering
 * the section must call it exactly once. Add a second call site (a "quick"
 * local recompute of DSCR, a second ladder for the all-cash comparison) and
 * this test fails immediately, by construction.
 */
const spy = vi.hoisted(() => ({ builds: 0, inputs: [] as unknown[] }));

vi.mock("@/lib/ladder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ladder")>();
  return {
    ...actual,
    buildCashLadder: (input: Parameters<typeof actual.buildCashLadder>[0]) => {
      spy.builds++;
      spy.inputs.push(input);
      return actual.buildCashLadder(input);
    },
  };
});

const { CashLadderSection } = await import("@/components/CashLadder");
const { getSampleResult } = await import("@/lib/sampleReport");
const { applyRentCorrection } = await import("@/lib/rentCorrection");
const { buildLadderInput } = await import("@/lib/ladderInput");
const { buildCashLadder } = await import("@/lib/ladder");

const sample = applyRentCorrection(getSampleResult());

function render(result = sample) {
  spy.builds = 0;
  spy.inputs = [];
  return renderToStaticMarkup(<CashLadderSection result={result} />);
}

describe("CashLadderSection", () => {
  it("ONE LADDER PER RENDER — buildCashLadder is called exactly once", () => {
    render();
    expect(spy.builds).toBe(1);
  });

  it("renders all thirteen rungs", () => {
    const html = render();
    const L = buildCashLadder(buildLadderInput(sample));
    for (const r of L.rungs) expect(html).toContain(r.label.replace(/&/g, "&amp;"));
  });

  it("the hero is never red — a shortfall is amber", () => {
    const html = render();
    // #F87171 is the report's red. It must not appear anywhere in this section:
    // the number is already the bad news and does not need an accusation on top.
    expect(html).not.toContain("F87171");
  });

  it("an absent figure gets WORDS, never a bare dash or a zero", () => {
    const allCash = {
      ...sample,
      underwriting: { ...sample.underwriting, recommendedLoan: 0, capitalGap: 0 },
    };
    const html = render(allCash as typeof sample);
    // FE-116: no lender means rungs 10 and 12 say so in English.
    expect(html).toContain("none");
    expect(html).toContain("not applicable");
    // and the DSCR panel explains the covenant rather than printing a dash
    expect(html).toMatch(/1\.25 or better/);
    // But rung 11 is NOT absent. All cash still has a cash-after-debt line —
    // it is rung 9 unchanged — and printing "not disclosed" over a figure the
    // ladder computed one rung above is the bug this asserts against.
    expect(html).toMatch(/no debt service/i);
    const eleven = html.slice(html.indexOf("Cash after debt"));
    expect(eleven.slice(0, 400)).not.toMatch(/not disclosed/i);
  });

  it("names the lender convention, never our own cutoff", () => {
    const html = render();
    // Standing copy rule: name the output, never the cutoff. 1.25 is a LENDER
    // convention, so attributing it to lenders is allowed; claiming it as our
    // flag threshold is not.
    expect(html).toMatch(/Lenders typically want/);
    expect(html).not.toMatch(/we flag/i);
    expect(html).not.toMatch(/anything below/i);
  });

  it("opens on the plan the buyer's own numbers imply, not a house assumption", () => {
    // R3 — DEFAULT_PLAN is finance-the-gap. The opening loan must equal the
    // recommended loan, never a fraction of the build-out picked by us.
    render();
    const input = spy.inputs[0] as ReturnType<typeof buildLadderInput>;
    expect(input.financing?.loan).toBe(Math.round(sample.underwriting.recommendedLoan ?? 0));
  });
});
