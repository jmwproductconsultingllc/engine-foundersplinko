import type { ExitTerms } from "./schema";

/**
 * THE "LEAVING" SECTION — Item 17, counted.
 *
 * Item 17 is the one table in an FDD that is entirely about the end of the
 * relationship, and it is the place Keith Gerson (Aug 5) named as "where I've
 * seen the most regret after the fact" — candidates almost never work through
 * it emotionally before they are already invested in saying yes.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: we count, we never characterize.
 * Nothing in here decides whether a term is standard, unusual, harsh,
 * favorable, enforceable or unenforceable. Those are judgments for the buyer
 * and for a lawyer who represents them. Every string below is either a number
 * with a unit, a phrase the franchisor wrote, or arithmetic over the two.
 *
 * TWO LABEL LAWS, both enforced here and both tested:
 *   1. A field the Item 17 table does not state renders "Not stated in this
 *      table" — NEVER "None". Item 17 is a summary; absence from it is not
 *      absence from the franchise agreement.
 *   2. A stated zero and a missing value must never render identically.
 *      postTermNonCompeteMiles: 0 is "0 miles". null is NOT_STATED.
 */

export const NOT_STATED = "Not stated in this table";

export type LeavingRow = {
  label: string;
  value: string;
  /** true when the value is NOT_STATED — the renderer greys it */
  unstated?: boolean;
  sub?: string;
};

export type LeavingCallout = {
  tone: "amber" | "sky";
  title: string;
  body: string;
};

export type LeavingBlock = {
  n: string;
  title: string;
  rows: LeavingRow[];
  callouts: LeavingCallout[];
  questions: string[];
};

export type Leaving = {
  available: boolean;
  sourcePage: string;
  blocks: LeavingBlock[];
  /** derived in code, never by the model */
  longestHoldYears: number | null;
  exitColumn: {
    franchisorGrounds: number;
    franchiseeGrounds: number;
    /** true when row (h) ended in "and others" — the count is a floor */
    openEnded: boolean;
  } | null;
  disclaimer: string;
};

const isStated = (v: string) => v !== NOT_STATED;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const yearsOf = (n: number | null | undefined) =>
  n == null ? NOT_STATED : plural(n, "year", "years");
const daysOf = (n: number | null | undefined) =>
  n == null ? NOT_STATED : plural(n, "day", "days");
const milesOf = (n: number | null | undefined) =>
  n == null ? NOT_STATED : plural(n, "mile", "miles");
const countOf = (n: number | null | undefined, one: string, many: string) =>
  n == null ? NOT_STATED : plural(n, one, many);
const textOf = (s: string | null | undefined) =>
  s == null || s.trim() === "" ? NOT_STATED : s.trim();
const yesNo = (b: boolean | null | undefined) =>
  b == null ? NOT_STATED : b ? "Yes" : "No";

const row = (label: string, value: string, sub?: string): LeavingRow => ({
  label,
  value,
  unstated: !isStated(value),
  sub,
});

/**
 * A record can carry an exitTerms object that is empty in every field — a
 * scanned filing where Item 17 did not read. A section that is nothing but
 * twenty-two rows of "Not stated in this table" is worse than no section, so
 * the module reports unavailable below this floor and the report omits both the
 * card and its nav entry. The floor is deliberately low: three real facts is a
 * table worth reading.
 */
const MIN_STATED_ROWS = 3;

export function buildLeaving(x: ExitTerms | null | undefined): Leaving {
  const empty: Leaving = {
    available: false,
    sourcePage: "",
    blocks: [],
    longestHoldYears: null,
    exitColumn: null,
    disclaimer: "",
  };
  if (!x) return empty;

  const curable = Array.isArray(x.curableDefaults) ? x.curableDefaults : [];

  // ---- derivations. Code does this arithmetic; the model never does. ----
  const longestHoldYears =
    x.initialTermYears != null && x.successorTermCount != null && x.successorTermYears != null
      ? x.initialTermYears + x.successorTermCount * x.successorTermYears
      : null;

  const exitColumn =
    x.nonCurableDefaultCount != null && x.franchiseeTerminationGrounds != null
      ? {
          franchisorGrounds: x.nonCurableDefaultCount + curable.length,
          franchiseeGrounds: x.franchiseeTerminationGrounds,
          openEnded: x.nonCurableOpenEnded === true,
        }
      : null;

  const cureSummary = curable.length
    ? curable
        .map((d) => `${d.category}${d.cureDays == null ? "" : ` — ${daysOf(d.cureDays)}`}`)
        .join(" · ")
    : NOT_STATED;

  // ---- block 01 — how long you are in ----
  const b1: LeavingBlock = {
    n: "01",
    title: "How long you are in",
    rows: [
      row("Initial term", yearsOf(x.initialTermYears)),
      row(
        "Renewal",
        x.successorTermCount == null
          ? NOT_STATED
          : `${countOf(x.successorTermCount, "successor term", "successor terms")}${
              x.successorTermYears == null ? "" : `, ${yearsOf(x.successorTermYears)} each`
            }`,
      ),
      row(
        "Longest possible hold",
        longestHoldYears == null ? NOT_STATED : yearsOf(longestHoldYears),
        longestHoldYears == null
          ? undefined
          : "Initial term plus every successor term the table allows.",
      ),
      row("Cost to renew", textOf(x.successorFeeBasis)),
      row(
        "Renewal is on the then-current agreement",
        yesNo(x.renewalRequiresCurrentAgreement),
        x.renewalRequiresCurrentAgreement === true
          ? "The terms you renew under are the ones in force on that day, not the ones you are reading now."
          : undefined,
      ),
    ],
    callouts: [],
    questions: [
      "What did the then-current initial franchise fee do over the last five years?",
      "Which terms changed in the agreement between your last two document versions?",
      "Has any franchisee been declined a successor term, and on what ground?",
    ],
  };
  if (isStated(textOf(x.renewalConditions))) {
    b1.callouts.push({
      tone: "sky",
      title: "What renewal requires",
      body: textOf(x.renewalConditions),
    });
  }

  // ---- block 02 — how it ends ----
  const b2: LeavingBlock = {
    n: "02",
    title: "How it ends",
    rows: [
      row("Franchisor may terminate without cause", yesNo(x.franchisorTerminationWithoutCause)),
      row(
        "Defaults you can cure",
        curable.length ? countOf(curable.length, "category", "categories") : NOT_STATED,
        isStated(cureSummary) ? cureSummary : undefined,
      ),
      row(
        "Defaults you cannot cure",
        x.nonCurableDefaultCount == null
          ? NOT_STATED
          : countOf(x.nonCurableDefaultCount, "ground", "grounds"),
        x.nonCurableOpenEnded === true
          ? `The table names ${x.nonCurableDefaultCount} and then says "and others" — the count is the floor, not the total.`
          : undefined,
      ),
      row(
        "Grounds the table gives you to terminate",
        x.franchiseeTerminationGrounds == null
          ? NOT_STATED
          : countOf(x.franchiseeTerminationGrounds, "ground", "grounds"),
      ),
    ],
    callouts: [
      {
        tone: "amber",
        title: "Absent from Item 17 is not absent from the agreement",
        body:
          "Item 17 is a summary table. A term it does not mention — liquidated damages, " +
          "post-termination fees, personal guarantees — can still be in the agreement it " +
          "summarizes. Read the sections the table cites, not only the table.",
      },
    ],
    questions: [
      "How many franchise agreements were terminated by the franchisor in the last three years, and on which ground?",
      "What does the agreement say I owe on the day after a termination?",
      "Has a franchisee ever terminated under the ground in row (d)?",
    ],
  };

  // ---- block 03 — how you sell it ----
  const b3: LeavingBlock = {
    n: "03",
    title: "How you sell it",
    rows: [
      row("Franchisor approval required to transfer", yesNo(x.transferApprovalRequired)),
      row(
        "Conditions for approval",
        x.transferConditionCount == null
          ? NOT_STATED
          : countOf(x.transferConditionCount, "condition", "conditions"),
      ),
      row(
        "Right of first refusal",
        x.rightOfFirstRefusal == null
          ? NOT_STATED
          : x.rightOfFirstRefusal
            ? x.rightOfFirstRefusalDays == null
              ? "Yes"
              : `Yes — ${daysOf(x.rightOfFirstRefusalDays)} to match`
            : "No",
      ),
      row(
        "On death or disability",
        x.deathTransferDays == null
          ? NOT_STATED
          : `Transfer within ${daysOf(x.deathTransferDays)}`,
        x.estateApplicationDays == null
          ? undefined
          : `The estate must apply within ${daysOf(x.estateApplicationDays)}.`,
      ),
    ],
    callouts: [],
    questions: [
      "How many units changed hands last year, and how many were listed but did not sell?",
      "What is the shortest and longest a transfer approval has taken?",
      "Which of the conditions in row (m) most often holds a sale up?",
    ],
  };

  // ---- block 04 — what happens after ----
  const b4: LeavingBlock = {
    n: "04",
    title: "What happens after",
    rows: [
      row("Non-compete after you leave", yearsOf(x.postTermNonCompeteYears)),
      // LABEL LAW 2 lives on this row: 0 renders "0 miles", null renders NOT_STATED.
      row("Radius", milesOf(x.postTermNonCompeteMiles), textOf(x.postTermNonCompeteScope) === NOT_STATED ? undefined : textOf(x.postTermNonCompeteScope)),
      row("Non-compete while you are in", textOf(x.inTermNonCompete)),
      row("How disputes are resolved", textOf(x.disputeResolution)),
      row("Where", textOf(x.forum)),
      row("Under which state's law", textOf(x.governingLaw)),
    ],
    callouts: [],
    questions: [
      "How far is the forum from my territory, and who pays to get there?",
      "How many disputes went to arbitration in the last three years?",
      "What exactly must come down, and who pays for the de-identification?",
    ],
  };

  const blocks = [b1, b2, b3, b4];
  const statedRows = blocks.reduce(
    (acc, b) => acc + b.rows.filter((r) => !r.unstated).length,
    0,
  );
  if (statedRows < MIN_STATED_ROWS) return empty;

  return {
    available: true,
    sourcePage: x.sourcePage || "",
    blocks,
    longestHoldYears,
    exitColumn,
    disclaimer:
      "Nothing above tells you whether a term is good, bad, standard or enforceable. " +
      "Those are judgments for you and for a lawyer who represents you. We read the " +
      "Item 17 table and the sections it names, and we counted what is in them.",
  };
}
