// fdd-engine-deploy/lib/sections.ts
//
// THE SECTION REGISTRY.
//
// One entry per section of the report. This file is the single place that
// knows what sections EXIST. It does not know how to render any of them —
// components/DiligenceReport.tsx and components/ReportGlass.tsx keep their own
// separate render code, which is deliberate and stays that way.
//
// WHY THIS FILE EXISTS. Before it, "does this report have a Leaving section?"
// was answered independently in two places: the paid renderer's nav array and
// lib/reportSource.ts. Adding Item 17 to one and not the other produced a
// teaser and a report that disagreed about what the product contains, and
// nothing failed. That is the class of bug this registry closes, and the parity
// test in lib/sections.test.ts is what closes it.
//
// WHAT MAY GO IN HERE: an id, the copy that names the section, and the
// predicate that says whether a record can produce it. That is the whole
// contract. Nothing about layout, ordering hacks, colour, column counts or
// which surface it renders on. The day this file starts carrying render hints
// it has become the framework this codebase was built to avoid — the two
// renderers exist precisely so each surface can make its own visual decisions
// without asking permission from a shared abstraction.
//
// ORDER IS SEMANTIC, NOT COSMETIC. The array order below is the reading order
// of the document and it encodes arguments: `leaving` sits after `system-scale`
// because its counts are read against Item 20, and before `who-to-call`
// because its output is questions and the call list continues them. Reordering
// this array reorders both surfaces. Do that on purpose or not at all.

import type { DiligenceResult } from "./types";
import { buildLeaving } from "./exitTerms";
import { buildCallList } from "./callList";
import { normalizeSeverity } from "./severity";

/**
 * HOW A SECTION BEHAVES WHEN THE RECORD CANNOT PRODUCE IT.
 *
 * This is the distinction the first draft of this design got wrong, and it is
 * the one that matters most commercially. There are two completely different
 * reasons a section can fail to render, and treating them the same way is
 * either a lie or a refund:
 *
 *   "always" — the section cannot be absent. Every record produces it.
 *
 *   "structural" — WE DO NOT HAVE THE DATA YET. The section is real, it is
 *     part of the product, and the only thing missing is extraction for this
 *     particular brand. The card renders in its STRUCTURAL form: title, what it
 *     covers, and the block names — and NO figures, NO masks, NO counts. It
 *     tells a reader truthfully what the report contains without making a
 *     single claim about this brand that we cannot back.
 *
 *   "suppressed" — THE SECTION IS DELIBERATELY OMITTED AND MUST STAY OMITTED.
 *     Not missing: decided. `financial-condition` is the live example — the
 *     paid report suppresses it entirely at LOW severity, because there is
 *     nothing concerning in the audited statements. Rendering a structural
 *     "Franchisor financial condition" card over that would advertise findings
 *     the paid report will never show, about a NAMED FRANCHISOR. That is not a
 *     thin section, it is a defamation-shaped one, and it is a refund.
 *
 * If you are adding a section and you are unsure which to use: ask whether the
 * absence is about OUR pipeline or about THIS BRAND'S facts. Ours → structural.
 * Theirs → suppressed.
 */
export type Absence = "always" | "structural" | "suppressed";

/**
 * THE FOURTH STATE: THE FRANCHISOR DISCLOSED NOTHING, AND THAT IS THE FINDING.
 *
 * `Absence` above answers "what do we do when the record cannot produce this
 * section". This type answers a different question, and conflating the two was
 * the taxonomy error that made this necessary: a section can be perfectly
 * READABLE and still be empty, because the franchisor exercised a legal right
 * not to say anything. Item 19 is the live case — roughly half of all US
 * franchisors make no financial performance representation at all.
 *
 * Rendered as a structural frame, that fact reads "we haven't got to this yet",
 * which is false and which costs us the sale. Rendered as an absent section, it
 * reads as nothing at all, and the buyer never learns the single most
 * decision-relevant thing in the filing. Rendered as a masked line it would be
 * a lock over a value that does not exist anywhere in the world.
 *
 * THE HARD RULE, AND THE ONLY ONE THAT MATTERS HERE: `when` must read a field
 * where the extractor POSITIVELY RECORDED the franchisor's silence. Never infer
 * it from an empty array. `cohorts.length === 0` is indistinguishable from "the
 * parse failed", and shipping "this franchisor discloses no earnings" over a
 * failed parse is a false statement about a named company in a document a buyer
 * paid for. `item19.hasItem19 === false` is a positive assertion and is
 * required by the response schema; that is why item-19 is the only section
 * carrying this state today. Adding a second one means adding its own
 * statedNone-shaped flag to lib/schema.ts and the prompt first, then reparsing.
 * There is no shortcut and the shortcut is the bug.
 *
 * The copy is held to the same brand-agnostic rule as `covers`: it must be true
 * for every brand that trips `when`, with no record loaded, and it carries no
 * digits other than "Item N".
 */
export type UndisclosedSpec = {
  /** Reads the extractor's POSITIVE record of silence. Never `!x.length`. */
  when: (r: DiligenceResult) => boolean;
  /** Names the finding. This is a headline, not an apology. */
  heading: string;
  /** Why the silence is itself informative. No numbers, no brand names. */
  body: string;
  /** Where the reader goes instead. Must be a real, lawful route. */
  nextStep: string;
};

export type SectionSpec = {
  id: string;
  /** Nav entry. Short — it sits in a rail. */
  label: string;
  /** Card heading. May be overridden per-record by a renderer that has a more
   *  specific one to offer (cash-ladder appends its revenue label). */
  title: string;
  /**
   * What the section covers, written at the PRODUCT level.
   *
   * THIS STRING IS THE STRUCTURAL BLURB, so it is held to a hard rule: it must
   * be true for every brand in the library, forever, with no record loaded. No
   * counts. No numbers. No "N terms", no "N questions" — those are per-record
   * claims and they belong in the locked blurb the section function builds.
   * If you cannot write this sentence without a number in it, the section is
   * not ready to have a structural state.
   */
  covers: string;
  /**
   * The topic names inside the section. Structure is free on both surfaces —
   * telling a reader the four things the Leaving section covers is the argument
   * for buying it, not a giveaway. Same rule as `covers`: fixed strings, never
   * derived from a record.
   */
  chips: string[];
  absence: Absence;
  /**
   * Can THIS record produce the locked, data-backed version of the section?
   *
   * CALL THE REAL PRODUCER. Every predicate below either reads a field directly
   * or calls the same builder the renderers call. None of them reimplement an
   * availability rule. An audit that reimplements the predicate drifts away
   * from what actually renders and then lies to you with a green checkmark,
   * which is worse than having no audit at all.
   */
  available: (r: DiligenceResult) => boolean;
  /**
   * Present only on sections where the extractor can positively record that the
   * franchisor disclosed nothing. See UndisclosedSpec. Orthogonal to `absence`:
   * item-19 is absence:"always" AND carries this, because the section always
   * renders — what changes is whether it renders numbers or renders the finding
   * that there are none.
   */
  undisclosed?: UndisclosedSpec;
};

const has = (n: unknown) => Array.isArray(n) && n.length > 0;

export const SECTIONS: SectionSpec[] = [
  {
    id: "what-it-costs",
    label: "What it costs",
    title: "What it costs to open",
    covers:
      "The Item 7 investment table, line by line, separated into what you spend " +
      "before you open and what you must still be holding on opening day.",
    chips: ["Initial investment", "Build-out", "Opening capital"],
    absence: "always",
    available: () => true,
  },
  {
    id: "buyer-fit",
    label: "Buyer fit",
    title: "Buyer-fit underwriting",
    covers:
      "Whether this deal clears the bar a lender would hold it to, read against " +
      "your own cash rather than against an average buyer's.",
    chips: ["Net worth", "Liquidity", "Coverage"],
    absence: "always",
    available: () => true,
  },
  {
    id: "cash-ladder",
    label: "Cash ladder",
    title: "The cash ladder",
    covers:
      "Every dollar from signing to the month the unit carries itself, in order, " +
      "including the months nobody puts in the pitch deck.",
    chips: ["Pre-opening carry", "Debt service", "Break-even"],
    absence: "always",
    available: () => true,
  },
  {
    id: "financing",
    label: "Financing",
    title: "How you pay for it",
    covers:
      "The loan the deal actually supports, the equity it requires from you, and " +
      "the gap between the two.",
    chips: ["Loan", "Equity", "Coverage ratio"],
    absence: "always",
    available: () => true,
  },
  {
    id: "ongoing-fees",
    label: "Fees",
    title: "Ongoing fees and hidden costs",
    covers:
      "Every recurring obligation in the agreement, converted to one number so " +
      "they can be compared against each other and against the brand next door.",
    chips: ["Royalty", "Marketing", "Technology", "Other recurring"],
    absence: "always",
    available: () => true,
  },
  {
    id: "item-19",
    label: "Item 19",
    title: "What units actually make",
    covers:
      "The financial performance representation as the franchisor made it, with " +
      "the cohort it was drawn from stated rather than implied.",
    chips: ["Cohorts", "Basis", "What is excluded"],
    absence: "always",
    available: () => true,
    // THE ONLY SECTION CARRYING THE FOURTH STATE TODAY, and it is not an
    // editorial preference — `hasItem19` is the only field in lib/schema.ts
    // where the extractor is REQUIRED to assert the franchisor's silence rather
    // than leave a container empty. `leadership` and `hiddenCosts` also come
    // back empty on real filings, and they do NOT get this state, because for
    // them "empty" and "unread" are the same bytes on disk.
    undisclosed: {
      when: (r) => r.extracted.item19?.hasItem19 === false,
      heading: "This franchisor makes no earnings claim",
      body:
        "Item 19 is optional, and this franchisor chose to leave it out. That " +
        "silence is itself a disclosure, and it binds them: under the FTC " +
        "Franchise Rule a franchisor that publishes no financial performance " +
        "representation may not give you sales, revenue or profit figures " +
        "anywhere else either — not on a call, not at discovery day, not " +
        "through a broker. Every other number in this report still holds. This " +
        "one has no source, so we have not invented one.",
      nextStep:
        "Item 20 lists the franchisees in the system and the ones who left, " +
        "with contact details. Those owners may tell you what their units " +
        "make. The franchisor may not — and a seller who offers you a figure " +
        "anyway has just handed you your first finding.",
    },
  },
  {
    id: "document-check",
    label: "Document",
    title: "What we found in the document",
    covers:
      "What the filing itself tells you before a single number is read — its " +
      "vintage, its completeness, and what did not scan.",
    chips: ["Vintage", "Completeness", "Warnings"],
    absence: "always",
    available: () => true,
  },
  {
    id: "to-verify",
    label: "To verify",
    title: "Before you commit",
    covers:
      "The specific things to confirm with a source other than the franchisor, " +
      "and who holds each answer.",
    chips: ["Open questions", "Where to check"],
    absence: "always",
    available: () => true,
  },
  {
    id: "financial-condition",
    label: "Financial condition",
    title: "Franchisor financial condition",
    covers:
      "Findings from the franchisor's audited financial statements.",
    chips: ["Audited statements"],
    // SUPPRESSED, NOT STRUCTURAL. See the Absence doc above. When this section
    // is missing it is because there is nothing concerning to report about a
    // named company, and saying so in card form would be the opposite of the
    // favour it appears to be.
    absence: "suppressed",
    available: (r) => {
      const fc = r.financialCondition;
      if (!fc) return false;
      const sev = normalizeSeverity(fc.severity);
      return sev !== "LOW" && sev !== "INSUFFICIENT_DATA";
    },
  },
  {
    id: "tripwires",
    label: "Tripwires",
    title: "Operational tripwires",
    covers:
      "Clauses that change what you signed up for after you have signed, pulled " +
      "from the sections most buyers stop reading.",
    chips: ["Operational risk", "Severity"],
    absence: "always",
    available: () => true,
  },
  {
    id: "system-scale",
    label: "System at a glance",
    title: "System scale and turnover",
    covers:
      "The Item 20 unit counts — openings, closures, transfers and terminations — " +
      "reconciled against each other rather than quoted one at a time.",
    chips: ["Openings", "Closures", "Transfers", "Terminations"],
    absence: "always",
    available: () => true,
  },
  {
    id: "leaving",
    label: "Leaving",
    title: "Leaving — renewal, exit and transfer",
    // No counts in this string, deliberately. The locked blurb says "17 terms
    // the table states"; this one cannot, because it renders for brands where
    // we have not read the table yet and a count there would be invented.
    covers:
      "Item 17 — how long you are in, what ends the agreement, what it takes to " +
      "sell the business, and what you are still bound by after you leave.",
    chips: [
      "How long you are in",
      "How it ends",
      "How you sell it",
      "What happens after",
    ],
    absence: "structural",
    available: (r) => buildLeaving(r.extracted.exitTerms).available,
  },
  {
    id: "who-to-call",
    label: "Who to call",
    title: "Who to call, and what to ask",
    covers:
      "Which franchisees to reach, chosen by what their cohort can tell you, and " +
      "the questions that get a real answer out of each one.",
    chips: ["Cohorts", "Questions"],
    absence: "structural",
    available: (r) => {
      const x = r.extracted;
      const cl = buildCallList({
        totalUnits: x.systemScale?.totalUnits,
        closedLastYear: x.systemScale?.closedLastYear,
        transfersLastYear: x.systemScale?.transfersLastYear,
        item20Page: x.systemScale?.sourcePage,
        cohorts: x.item19?.cohorts,
        item19Page: x.item19?.sourcePage,
      });
      return cl.available && cl.cohorts.some((c) => c.questions.length > 0);
    },
  },
  {
    id: "leadership",
    label: "Who runs it",
    title: "Who runs it",
    covers:
      "The people running the franchisor, how long they have been there, and what " +
      "they operated before this.",
    chips: ["Tenure", "Prior operating history"],
    absence: "structural",
    available: (r) => has(r.extracted.leadership),
  },
];

const BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

export function sectionSpec(id: string): SectionSpec | undefined {
  return BY_ID.get(id);
}

/**
 * The sections that get an entry in the quick-nav rail, and the label each one
 * uses there.
 *
 * Not every section is in the nav and that is a deliberate editorial call, not
 * an oversight: `tripwires`, `financial-condition`, `who-to-call` and
 * `leadership` are read in flow rather than jumped to, and a rail with fourteen
 * entries is a rail nobody uses. The map is here rather than inferred from
 * `label` because a structural card MUST make exactly the same nav decision the
 * data-backed card makes — a frame that adds a nav entry the real section never
 * had would change the shape of the document depending on how much we happen to
 * have extracted, which is the drift this whole registry exists to stop.
 */
const NAV_ANCHORS: Record<string, string> = {
  "what-it-costs": "What it costs",
  "buyer-fit": "Buyer fit",
  "cash-ladder": "Cash ladder",
  financing: "Financing",
  "ongoing-fees": "Fees",
  "item-19": "Item 19",
  "document-check": "Document",
  "to-verify": "To verify",
  "system-scale": "System at a glance",
  leaving: "Leaving",
};

export function navAnchor(id: string): string | undefined {
  return NAV_ANCHORS[id];
}

/**
 * The section ids a record should render, in reading order — the answer BOTH
 * surfaces must agree on, and the thing lib/sections.test.ts asserts.
 *
 * A "structural" section is included here even with no data, because it renders
 * (in structural form). A "suppressed" one is not, because it must not.
 */
export function sectionIdsFor(r: DiligenceResult): string[] {
  return SECTIONS.filter((s) => {
    if (s.available(r)) return true;
    return s.absence === "structural";
  }).map((s) => s.id);
}

/**
 * True when the section renders WITHOUT data behind it. The shell reads this to
 * decide to emit a card carrying no mask tokens, no lockIds and no row count,
 * and glassDecision() reads it to leave the section out of the qualification
 * floors entirely.
 *
 * THAT EXCLUSION IS LOAD-BEARING. If structural sections counted toward
 * minFiguresForGlass, an empty record would qualify for glass on the strength
 * of cards with nothing behind them, and we would start buying traffic to
 * reports that cannot be unlocked into anything. lib/sections.test.ts asserts
 * an empty record fails qualification for exactly this reason. Do not "fix"
 * that test by lowering the floor.
 */
export function isStructural(r: DiligenceResult, id: string): boolean {
  const s = BY_ID.get(id);
  if (!s) return false;
  return s.absence === "structural" && !s.available(r);
}

/**
 * True when THIS record's franchisor positively disclosed nothing for this
 * section. Deliberately does NOT consult `available` — the two states answer
 * different questions and a section can be available and undisclosed at once
 * (item-19 always "produces", and on these brands what it produces is the
 * finding that there is nothing to produce).
 *
 * Both surfaces route through this rather than reading `hasItem19` themselves.
 * The teaser and the report reading the same predicate is the entire point of
 * this file; a renderer that reimplements the test is how the two pages started
 * disagreeing about what the product contains in the first place.
 */
export function isUndisclosed(r: DiligenceResult, id: string): boolean {
  const s = BY_ID.get(id);
  if (!s?.undisclosed) return false;
  return s.undisclosed.when(r) === true;
}

/** The copy for the undisclosed block, or undefined if the section has none. */
export function undisclosedSpec(id: string): UndisclosedSpec | undefined {
  return BY_ID.get(id)?.undisclosed;
}
