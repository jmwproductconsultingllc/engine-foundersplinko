import { describe, it, expect } from "vitest";
import { buildLeaving, NOT_STATED, type Leaving } from "./exitTerms";
import type { ExitTerms } from "./schema";

/**
 * THE ITEM 17 LABEL LINT.
 *
 * This module exists to enforce three rules that are easy to state and easy to
 * lose in a refactor:
 *
 *   1. ABSENCE IS ABSENCE. Every report persisted before exitTerms existed —
 *      including the ones already sold — has no exitTerms. Those records must
 *      render no Leaving section and no nav entry, not an empty one.
 *   2. "Not stated in this table", NEVER "None". Item 17 is a summary; a term
 *      missing from it is not missing from the franchise agreement.
 *   3. A STATED ZERO AND A MISSING VALUE MUST NEVER RENDER IDENTICALLY.
 *      A non-compete of 0 miles is a fact. A silent table is not.
 *
 * And one that is the reason the whole section was built: WE COUNT, WE NEVER
 * CHARACTERIZE. The banned-vocabulary scan at the bottom is the live version of
 * that rule — it reads every string this module can emit.
 */

// Hounds Town USA, LLC — 2026 FDD, issuance date April 30, 2026. Item 17 rows
// (a)-(w) as read off the document, not as remembered.
const HOUNDS_TOWN: ExitTerms = {
  initialTermYears: 10,
  successorTermCount: 2,
  successorTermYears: 10,
  renewalRequiresCurrentAgreement: true,
  renewalConditions:
    "Notice; good standing; sign the then-current franchise agreement; general release; Successor Franchise Fee; then-current requirements.",
  successorFeeBasis: "50% of then-current initial franchise fee, plus training costs",
  franchisorTerminationWithoutCause: false,
  curableDefaults: [
    { category: "Failure to pay money", cureDays: 10 },
    { category: "Health, safety or sanitation law", cureDays: 3 },
    { category: "Any other default not listed as non-curable", cureDays: 30 },
  ],
  nonCurableDefaultCount: 15,
  nonCurableOpenEnded: true,
  // TWO, not one. Row (d) states two: "any ground permitted by law", and
  // franchisor material breach uncured 30 days after written notice. An earlier
  // note in this project recorded it as one. The table is the source.
  franchiseeTerminationGrounds: 2,
  transferApprovalRequired: true,
  transferConditionCount: 15,
  rightOfFirstRefusal: true,
  rightOfFirstRefusalDays: 30,
  deathTransferDays: 180,
  estateApplicationDays: 120,
  inTermNonCompete: "You, your owners and immediate family members, anywhere",
  postTermNonCompeteYears: 2,
  postTermNonCompeteMiles: 25,
  postTermNonCompeteScope:
    "Measured from your business and from every other Hounds Town USA business operating or under construction.",
  disputeResolution: "Mediation, then arbitration",
  forum: "Denver, Colorado, or Orlando, Florida at the franchisor's election",
  governingLaw: "Florida",
  sourcePage: "Item 17, pp. 47-52",
};

const allText = (lv: Leaving) =>
  [
    lv.disclaimer,
    ...lv.blocks.flatMap((b) => [
      b.title,
      ...b.rows.flatMap((r) => [r.label, r.value, r.sub ?? ""]),
      ...b.callouts.flatMap((c) => [c.title, c.body]),
      ...b.questions,
    ]),
  ].join("\n");

describe("RULE 1 — absence is absence", () => {
  it("returns unavailable for a legacy record with no exitTerms", () => {
    expect(buildLeaving(undefined).available).toBe(false);
    expect(buildLeaving(null).available).toBe(false);
    expect(buildLeaving(undefined).blocks).toHaveLength(0);
  });

  it("returns unavailable for an exitTerms object whose Item 17 did not read", () => {
    const blank = Object.fromEntries(
      Object.keys(HOUNDS_TOWN).map((k) => [k, null]),
    ) as unknown as ExitTerms;
    blank.curableDefaults = [];
    blank.sourcePage = "Item 17, p. 40";
    expect(buildLeaving(blank).available).toBe(false);
  });

  it("survives a malformed curableDefaults that is not an array", () => {
    const bad = { ...HOUNDS_TOWN, curableDefaults: undefined as never };
    expect(() => buildLeaving(bad)).not.toThrow();
    expect(buildLeaving(bad).available).toBe(true);
  });
});

describe("RULE 2 — not stated, never none", () => {
  it('renders a missing field as "Not stated in this table"', () => {
    const lv = buildLeaving({ ...HOUNDS_TOWN, governingLaw: null, disputeResolution: null });
    const after = lv.blocks.find((b) => b.n === "04")!;
    expect(after.rows.find((r) => r.label === "Under which state's law")!.value).toBe(NOT_STATED);
    expect(after.rows.find((r) => r.label === "Under which state's law")!.unstated).toBe(true);
  });

  it("never emits the word None as a value anywhere", () => {
    const sparse: ExitTerms = {
      ...HOUNDS_TOWN,
      inTermNonCompete: null,
      postTermNonCompeteYears: null,
      postTermNonCompeteMiles: null,
      postTermNonCompeteScope: null,
      rightOfFirstRefusal: null,
      rightOfFirstRefusalDays: null,
      successorFeeBasis: null,
    };
    const lv = buildLeaving(sparse);
    for (const b of lv.blocks) {
      for (const r of b.rows) {
        expect(r.value).not.toMatch(/^none$/i);
      }
    }
  });
});

describe("RULE 3 — a stated zero is not a missing value", () => {
  it("renders 0 miles and a silent table differently", () => {
    const zero = buildLeaving({ ...HOUNDS_TOWN, postTermNonCompeteMiles: 0 });
    const missing = buildLeaving({ ...HOUNDS_TOWN, postTermNonCompeteMiles: null });
    const radius = (lv: Leaving) =>
      lv.blocks.find((b) => b.n === "04")!.rows.find((r) => r.label === "Radius")!;

    expect(radius(zero).value).toBe("0 miles");
    expect(radius(zero).unstated).toBe(false);
    expect(radius(missing).value).toBe(NOT_STATED);
    expect(radius(missing).unstated).toBe(true);
    expect(radius(zero).value).not.toBe(radius(missing).value);
  });

  it("keeps zero grounds distinct from unstated grounds", () => {
    const zero = buildLeaving({ ...HOUNDS_TOWN, franchiseeTerminationGrounds: 0 });
    const missing = buildLeaving({ ...HOUNDS_TOWN, franchiseeTerminationGrounds: null });
    const g = (lv: Leaving) =>
      lv.blocks
        .find((b) => b.n === "02")!
        .rows.find((r) => r.label === "Grounds the table gives you to terminate")!.value;
    expect(g(zero)).toBe("0 grounds");
    expect(g(missing)).toBe(NOT_STATED);
    // and with no franchisee figure there is no ratio to draw
    expect(missing.exitColumn).toBeNull();
  });
});

describe("derivations happen in code, not in the model", () => {
  const lv = buildLeaving(HOUNDS_TOWN);

  it("computes the longest possible hold from the term rows", () => {
    expect(lv.longestHoldYears).toBe(30); // 10 + 2 x 10
    expect(lv.blocks[0].rows.find((r) => r.label === "Longest possible hold")!.value).toBe(
      "30 years",
    );
  });

  it("computes the exit column as non-curable plus curable categories", () => {
    // 15 non-curable grounds (row h, ending "and others") + 3 curable categories
    // (row g) = 18, against the 2 grounds row (d) gives the franchisee.
    expect(lv.exitColumn).toEqual({ franchisorGrounds: 18, franchiseeGrounds: 2, openEnded: true });
  });

  it("does not compute a hold when any term row is missing", () => {
    expect(buildLeaving({ ...HOUNDS_TOWN, successorTermYears: null }).longestHoldYears).toBeNull();
  });

  it("singularizes units", () => {
    const one = buildLeaving({ ...HOUNDS_TOWN, initialTermYears: 1, rightOfFirstRefusalDays: 1 });
    expect(one.blocks[0].rows[0].value).toBe("1 year");
    expect(
      one.blocks[2].rows.find((r) => r.label === "Right of first refusal")!.value,
    ).toBe("Yes — 1 day to match");
  });
});

describe("WE COUNT, WE NEVER CHARACTERIZE", () => {
  // The one allowed use of a judgment word is the disclaimer, which exists to
  // say we are NOT making the judgment. It is scanned separately.
  const BANNED =
    /\b(standard|unusual|harsh|onerous|favou?rable|aggressive|reasonable|fair|typical|enforceable|unenforceable|red flag|dangerous|risky|severe)\b/i;

  // Scanned: the strings WE author — block titles, row labels, questions,
  // callouts, the disclaimer. NOT scanned: row values and the subs built from
  // them, which carry the franchisor's own wording through verbatim ("fair
  // market value", "reasonable notice"). Banning a franchisor's vocabulary
  // would be editing the document, which is the opposite of the point.
  it("emits no judgment vocabulary in anything we author", () => {
    for (const source of [HOUNDS_TOWN, { ...HOUNDS_TOWN, nonCurableOpenEnded: false }]) {
      const lv = buildLeaving(source);
      for (const b of lv.blocks) {
        const authored = [
          b.title,
          ...b.rows.map((r) => r.label),
          ...b.callouts.flatMap((c) => [c.title, c.body]),
          ...b.questions,
        ].join("\n");
        expect(authored).not.toMatch(BANNED);
      }
    }
  });

  it("keeps the disclaimer in the disclaiming form", () => {
    const lv = buildLeaving(HOUNDS_TOWN);
    expect(lv.disclaimer).toMatch(/judgments for you and for a lawyer who represents you/);
    expect(lv.disclaimer).toMatch(/Nothing above tells you whether/);
  });

  it("never tells the buyer what to do", () => {
    const text = allText(buildLeaving(HOUNDS_TOWN));
    expect(text).not.toMatch(/\b(you should|we recommend|walk away|do not sign|buy this)\b/i);
  });
});
