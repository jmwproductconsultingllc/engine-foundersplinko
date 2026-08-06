/**
 * sections.test.ts — the two tripwires that make the section registry worth
 * having.
 *
 * WHAT WENT WRONG BEFORE THIS FILE. lib/exitTerms.ts and the Leaving card in
 * components/DiligenceReport.tsx shipped on 2026-08-05. Both were correct.
 * Zero of the 83 stored records carried `exitTerms`, so `leaving.available`
 * was false on every one of them, so the card and its nav entry silently did
 * not render — on the paid report AND on the teaser. The module was live for a
 * day, was invisible to every buyer, and nothing in the build, the test suite
 * or the deploy said a word. That is the failure this file exists to make
 * loud.
 *
 * The fix was not "backfill 83 records". It was to stop letting per-brand
 * extraction decide whether a SECTION of the product exists. A structural
 * section renders either way — as its table when we read one, as a frame when
 * we did not. The registry in ./sections.ts is the list of what exists; these
 * two tests are what keep the surfaces honest about it.
 *
 * WHY THESE TWO AND NOT MORE. Both are O(1) in brand count. Neither loads a
 * stored record, so neither gets slower or flakier as the corpus goes from 83
 * to 1,000, and neither can be "fixed" by editing data. A test that iterated
 * every brand would be a coverage report wearing a test's clothes — useful,
 * but it belongs in scripts/auditShells.ts, not in the gate that blocks a
 * deploy.
 */

import { describe, it, expect } from "vitest";

import {
  SECTIONS,
  sectionSpec,
  navAnchor,
  isUndisclosed,
  undisclosedSpec,
} from "./sections";
import { reportSourceFromComputed } from "./reportSource";
import { buildReportShell, qualifiesForGlass } from "./reportShell";
import { getSampleResult } from "./sampleReport";
import type { DiligenceResult } from "./types";

/* ------------------------------------------------------------------ *
 * A record with nothing read.
 *
 * NOT `{} as DiligenceResult`. The pipeline's job here is to survive an
 * extraction that produced nothing, and an object missing `extracted`
 * entirely is not that case — it is a corrupt record, which is a different
 * bug with a different fix. This keeps the shape and empties the contents,
 * which is exactly what a failed or partial parse leaves behind.
 * ------------------------------------------------------------------ */
function emptyRecord(): DiligenceResult {
  const s = getSampleResult();
  return {
    ...s,
    extracted: {
      ...s.extracted,
      brandName: "Nothing Read Co.",
      item17: undefined,
      item19: undefined,
      exitTerms: undefined,
      leadership: [],
      systemScale: undefined,
    },
    financialCondition: null,
  } as unknown as DiligenceResult;
}

/* ------------------------------------------------------------------ *
 * 1. STRUCTURAL PARITY
 * ------------------------------------------------------------------ */

describe("section registry — structural parity", () => {
  it("every id in the registry is unique", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sectionSpec() resolves every registered id", () => {
    for (const s of SECTIONS) expect(sectionSpec(s.id)).toBe(s);
  });

  it("no `covers` line contains a digit", () => {
    // `covers` is rendered on a frame — a card for a brand whose table we did
    // NOT read. A number in that copy would be a figure asserted about a
    // named franchisor on the strength of nothing. The rule is mechanical so
    // it cannot be argued with: the string must be true with no record
    // loaded, and a digit is never true with no record loaded. Item numbers
    // are spelled ("Item 17" is fine — that is the FDD's own section name),
    // which is why this allows digits ONLY in that form.
    for (const s of SECTIONS) {
      const stripped = s.covers.replace(/\bItem \d{1,2}\b/g, "");
      expect(stripped, `${s.id}.covers`).not.toMatch(/\d/);
    }
  });

  it("every structural section actually renders as a frame when its data is absent", () => {
    // THE TEST. Not "the code path exists" — the section is present in the
    // built source, flagged structural, for a record that has nothing.
    const source = reportSourceFromComputed({ result: emptyRecord() });
    const byId = new Map(source.sections.map((s) => [s.id, s]));

    for (const spec of SECTIONS.filter((s) => s.absence === "structural")) {
      const got = byId.get(spec.id);
      expect(got, `structural section "${spec.id}" is missing from the source`).toBeDefined();
      expect(got!.structural, `"${spec.id}" rendered but was not flagged structural`).toBe(true);
    }
  });

  it("a suppressed section stays absent — it does not get a frame", () => {
    // financial-condition is the one deliberate silence. A frame there would
    // advertise findings about a named franchisor's audited statements that
    // do not exist. Absence is the product decision, not a gap.
    const source = reportSourceFromComputed({ result: emptyRecord() });
    const ids = new Set(source.sections.map((s) => s.id));
    for (const spec of SECTIONS.filter((s) => s.absence === "suppressed")) {
      expect(ids.has(spec.id), `suppressed section "${spec.id}" rendered anyway`).toBe(false);
    }
  });

  it("a section with a nav anchor is a section that always renders", () => {
    // The nav is the promise; the card is the delivery. A nav entry pointing
    // at a section that can vanish is a dead anchor, and a suppressed section
    // with a nav entry is worse — it advertises the silence.
    for (const s of SECTIONS) {
      if (navAnchor(s.id) === undefined) continue;
      expect(s.absence, `"${s.id}" has a nav anchor`).not.toBe("suppressed");
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. THE EMPTY RECORD
 * ------------------------------------------------------------------ */

describe("a frame promises nothing", () => {
  const shell = buildReportShell(reportSourceFromComputed({ result: emptyRecord() }));
  const frames = shell.sections.filter((s) => s.structural);

  it("the fixture actually produces frames", () => {
    // Guard on the guard. If the sample record ever grows an exitTerms block
    // this suite would keep passing while testing nothing, which is the worst
    // possible failure mode for a tripwire.
    expect(frames.length).toBeGreaterThan(0);
  });

  it("no frame carries a mask token, a lockId or a masked row", () => {
    // A mask is a PROMISE that a figure sits behind it and unlocks on
    // payment. Behind a frame there is nothing, so one mask here is a
    // promise the buyer pays to discover was empty — the single worst bug
    // this architecture can produce.
    //
    // Serialized rather than walked, deliberately: a mask that reaches the
    // shell through a field nobody has thought of yet is still caught. Same
    // reasoning as the textual guard in reportShell.test.ts.
    for (const f of frames) {
      const json = JSON.stringify(f);
      expect(json, `${f.id}`).not.toContain('"kind":"mask"');
      expect(json, `${f.id}`).not.toContain("lockId");
      expect(json, `${f.id}`).not.toContain("maskedRows");
      expect(f.lines.length, `${f.id}.lines`).toBe(0);
      expect(f.figureCount, `${f.id}.figureCount`).toBe(0);
    }
  });

  it("no frame is counted in the numbers the pitch quotes", () => {
    // counts.sections is COPY — it becomes "N sections" in the unlock bar —
    // so counting frames in it inflates the pitch by exactly the sections
    // with nothing behind them. counts.questions has the same problem in a
    // nastier form: a structural who-to-call carries topic chips in
    // `freeChips`, the same field a real one uses for its single free
    // question, so before the fix a brand with no call list advertised two
    // questions that did not exist.
    expect(shell.counts.sections).toBe(shell.sections.length - frames.length);
    if (frames.some((f) => f.id === "who-to-call")) {
      expect(shell.counts.questions).toBe(0);
    }
    // shell.sections stays the full render list. Only the quotable numbers
    // shrink.
    expect(shell.sections.length).toBeGreaterThan(shell.counts.sections);
  });

  it("a page made only of frames FAILS the glass gate", () => {
    // The commercial point of the whole exercise, stated as an assertion.
    // Making frames render for every brand must NOT make a brand we have not
    // read eligible for a paid teaser. Built as a literal source rather than
    // by stripping a fixture, because this has to hold for the limiting case
    // — every section a frame — and no stored record is that empty.
    //
    // There is no special case in qualifiesForGlass() for this and there must
    // not be one: frames carry figureCount 0, so they add nothing to
    // counts.figures and cannot satisfy requiredSections. If this ever goes
    // green, someone has taught a frame to count.
    const allFrames = buildReportShell({
      brandSlug: "frames-only",
      brandName: "Frames Only",
      badges: [],
      sections: SECTIONS.filter((s) => s.absence !== "suppressed").map((s) => ({
        id: s.id,
        title: s.title,
        blurb: s.covers,
        freeChips: [...s.chips],
        figures: [],
        structural: true as const,
      })),
      ladderRungs: 0,
    });

    expect(allFrames.sections.length).toBe(
      SECTIONS.filter((s) => s.absence !== "suppressed").length,
    );
    expect(allFrames.counts.figures).toBe(0);
    expect(allFrames.counts.sections).toBe(0);
    expect(JSON.stringify(allFrames)).not.toContain('"kind":"mask"');
    expect(qualifiesForGlass(allFrames)).toBe(false);
  });

  it("a structural section carrying data is a build error, not a silent one", () => {
    // The enforcement behind every claim above. Without this, the invariant
    // is a convention — and a convention is what "the two surfaces agree
    // about what sections exist" was before this file.
    expect(() =>
      buildReportShell({
        brandSlug: "bad",
        brandName: "Bad",
        badges: [],
        sections: [
          {
            id: "leaving",
            title: "Leaving",
            figures: [{ label: "Longest hold", value: 20, unit: "years", provenance: "disclosed" }],
            structural: true,
          },
        ],
        ladderRungs: 0,
      } as never),
    ).toThrow(/structural/i);
  });
});

/* ------------------------------------------------------------------ *
 * 3. THE FOURTH STATE — the franchisor disclosed nothing
 *
 * The taxonomy before this had three states and needed four. "We have not read
 * it" and "we read it and the franchisor exercised a legal right to say
 * nothing" are opposite facts, and they rendered identically — as a frame, or
 * as one stranded amber sentence. Roughly half of US franchisors publish no
 * Item 19, so on the teaser this was the single most decision-relevant thing in
 * the filing being presented as our own shortcoming.
 *
 * The whole state rests on ONE property: that it is driven by a positive
 * assertion in the record, never inferred from an empty container. Every test
 * below is ultimately protecting that.
 * ------------------------------------------------------------------ */

/** A filing that states, in the extractor's own required field, that there is
 *  no financial performance representation. */
function noFprRecord(): DiligenceResult {
  const s = getSampleResult();
  return {
    ...s,
    extracted: {
      ...s.extracted,
      brandName: "No FPR Co.",
      item19: { hasItem19: false, cohorts: [], notes: "", sourcePage: "Item 19, p.41" },
    },
  } as unknown as DiligenceResult;
}

describe("undisclosed — the filing says no, and that is the finding", () => {
  const shell = buildReportShell(reportSourceFromComputed({ result: noFprRecord() }));
  const block = shell.sections.find((s) => s.id === "item-19");

  it("the fixture actually produces an undisclosed block", () => {
    // Guard on the guard, same reasoning as the frames fixture above.
    expect(block, "item-19 vanished entirely").toBeDefined();
    expect(block!.undisclosed, "item-19 rendered but was not flagged undisclosed").toBeTruthy();
  });

  it("is driven by the franchisor's positive statement, NOT by an empty cohort list", () => {
    // THE LOAD-BEARING TEST IN THIS FILE.
    //
    // `cohorts: []` is what a FAILED PARSE leaves behind, and it is byte-for-byte
    // what a genuine no-FPR filing leaves behind. If the predicate ever starts
    // reading the array instead of the flag, every brand whose Item 19 pass
    // failed will ship a paid report stating that a NAMED FRANCHISOR discloses
    // no earnings. That is a false factual claim about a real company, on a
    // document someone paid for, and it would be invisible — the report would
    // look complete.
    //
    // So: same empty cohorts, flag flipped, opposite outcome. If someone
    // "simplifies" the predicate to `!cohorts.length`, this goes red.
    const s = getSampleResult();
    const unread = {
      ...s,
      extracted: {
        ...s.extracted,
        item19: { hasItem19: true, cohorts: [], notes: "", sourcePage: "Item 19, p.41" },
      },
    } as unknown as DiligenceResult;

    expect(isUndisclosed(noFprRecord(), "item-19")).toBe(true);
    expect(isUndisclosed(unread, "item-19")).toBe(false);

    // And a record with no item19 object at all is UNKNOWN, not undisclosed.
    // Absent ≠ denied. This is the emptyRecord() fixture from above.
    expect(isUndisclosed(emptyRecord(), "item-19")).toBe(false);
  });

  it("only sections whose extractor records silence may carry this state", () => {
    // leadership and hiddenCosts come back empty on real filings too, and they
    // deliberately do NOT get an undisclosed spec, because for them "empty" and
    // "unread" are the same bytes. This asserts the discipline rather than the
    // current list: any section that adds the state must be able to point at a
    // predicate that reads a boolean the schema REQUIRES.
    for (const s of SECTIONS) {
      if (!s.undisclosed) continue;
      expect(
        s.undisclosed.when(emptyRecord()),
        `"${s.id}" claims the franchisor disclosed nothing for a record where ` +
          `nothing was read at all — the predicate is inferring from emptiness`,
      ).toBe(false);
    }
  });

  it("undisclosed copy carries no digits either", () => {
    // Same rule as `covers`, same reason: these strings render for every brand
    // that trips the predicate, so a number in one is a figure asserted about a
    // named franchisor on the strength of nothing. Item numbers are the FDD's
    // own section names and are allowed in that form only.
    for (const s of SECTIONS) {
      const u = s.undisclosed;
      if (!u) continue;
      for (const [field, text] of [
        ["heading", u.heading],
        ["body", u.body],
        ["nextStep", u.nextStep],
      ] as const) {
        const stripped = text.replace(/\bItem \d{1,2}\b/g, "");
        expect(stripped, `${s.id}.undisclosed.${field}`).not.toMatch(/\d/);
      }
    }
  });

  it("does not tell the buyer to ask the franchisor for the numbers", () => {
    // NOT STYLE. Under the FTC Franchise Rule a franchisor that publishes no
    // financial performance representation may not supply sales or earnings
    // figures outside the document at all. "Confirm with the brand" therefore
    // solicits a violation and, worse, walks our own buyer into being sold on a
    // figure with no source — the exact failure the product exists to prevent.
    // The lawful route is the Item 20 franchisee list.
    for (const s of SECTIONS) {
      const u = s.undisclosed;
      if (!u) continue;
      expect(u.nextStep, `${s.id}.undisclosed.nextStep`).toMatch(/Item 20|franchisee/i);
      expect(
        `${u.body} ${u.nextStep}`,
        `${s.id} points the buyer back at the franchisor for figures`,
      ).not.toMatch(/ask the (brand|franchisor)|confirm (directly )?with the (brand|franchisor)/i);
    }
  });

  it("carries no mask token, no lockId and no masked row", () => {
    // There is no value behind this card — not behind the paywall, not
    // anywhere. A mask here is a promise about a number that does not exist in
    // the world, which is a strictly worse version of the frame bug.
    const json = JSON.stringify(block);
    expect(json).not.toContain('"kind":"mask"');
    expect(json).not.toContain("lockId");
    expect(json).not.toContain("maskedRows");
    expect(block!.lines.length).toBe(0);
    expect(block!.figureCount).toBe(0);
  });

  it("ships all three strings free, at every glass config", () => {
    // The trade, made on purpose: a reader who never pays still learns this.
    // It is the strongest evidence on the teaser that we read the document, and
    // there is nothing behind it to sell, so withholding any of it would be a
    // lock over an empty box.
    const u = undisclosedSpec("item-19")!;
    expect(block!.undisclosed).toEqual({
      heading: u.heading,
      body: u.body,
      nextStep: u.nextStep,
    });
  });

  it("is not counted in the numbers the pitch quotes", () => {
    // counts.sections becomes "N sections" in the unlock bar. An undisclosed
    // block has nothing to unlock, so counting it sells a section that is
    // already fully visible.
    const inert = shell.sections.filter((s) => s.structural || s.undisclosed);
    expect(shell.counts.sections).toBe(shell.sections.length - inert.length);
  });

  it("cannot make a brand glass-eligible", () => {
    // Same floor the frames test pins, for the same reason: a page of findings
    // about what is NOT in a filing is not a paid teaser, and we must not buy
    // traffic to one.
    const allBlocks = buildReportShell({
      brandSlug: "undisclosed-only",
      brandName: "Undisclosed Only",
      badges: [],
      sections: SECTIONS.filter((s) => s.undisclosed).map((s) => ({
        id: s.id,
        title: s.title,
        figures: [],
        undisclosed: {
          heading: s.undisclosed!.heading,
          body: s.undisclosed!.body,
          nextStep: s.undisclosed!.nextStep,
        },
      })),
      ladderRungs: 0,
    });
    expect(allBlocks.counts.figures).toBe(0);
    expect(allBlocks.counts.sections).toBe(0);
    expect(qualifiesForGlass(allBlocks)).toBe(false);
  });

  it("an undisclosed section carrying data is a build error", () => {
    expect(() =>
      buildReportShell({
        brandSlug: "bad",
        brandName: "Bad",
        badges: [],
        sections: [
          {
            id: "item-19",
            title: "What units actually make",
            figures: [
              { label: "Network average", value: 41000, unit: "usd_month", provenance: "disclosed" },
            ],
            undisclosed: { heading: "h", body: "b", nextStep: "n" },
          },
        ],
        ladderRungs: 0,
      } as never),
    ).toThrow(/undisclosed/i);
  });

  it("a section flagged BOTH structural and undisclosed is a build error", () => {
    // "We have not read this" and "we read it and it says nothing" cannot both
    // be true. Left unchecked, whichever branch the renderer tests first wins,
    // and the difference between an apology and a finding becomes a coin flip.
    expect(() =>
      buildReportShell({
        brandSlug: "bad",
        brandName: "Bad",
        badges: [],
        sections: [
          {
            id: "item-19",
            title: "What units actually make",
            figures: [],
            structural: true,
            undisclosed: { heading: "h", body: "b", nextStep: "n" },
          },
        ],
        ladderRungs: 0,
      } as never),
    ).toThrow(/BOTH/i);
  });
});
