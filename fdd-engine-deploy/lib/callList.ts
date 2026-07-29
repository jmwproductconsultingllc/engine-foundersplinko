/**
 * lib/callList.ts — the four calls, and what to ask on each one.
 *
 * Every diligence checklist in the industry ends with "validate with existing
 * franchisees." Nobody tells the buyer WHICH franchisees, HOW MANY, or WHAT TO
 * ASK — so it stays advice people nod at rather than work people do. The churn
 * card already tells a reader to call three operators and three who left; this
 * module is what makes that instruction executable.
 *
 * Four rules this module enforces.
 *
 *  1. WE DO NOT NEED THE NAMES TO DELIVER THE CALL LIST. The buyer already holds
 *     the FDD — the franchisor is required to give it to them. Item 20's exhibits
 *     print every current franchisee and everyone who left last year, with phone
 *     numbers. What the buyer is missing is not contact data; it is which groups
 *     are worth calling and what question unlocks each one. That is derivable
 *     from figures already on every record, so this ships with no re-extraction,
 *     no re-minting, and no roster of named individuals in our database.
 *
 *  2. A COHORT WITH NO DATA IS ABSENT, NEVER EMPTY. No zero-count cards, no
 *     "0 franchisees left." Where the FDD discloses no departures, that sentence
 *     is itself the finding and gets said in words.
 *
 *  3. THE EXIT REASON IS THE FIRST QUESTION, NOT A LABEL WE APPLY. Item 20 gives
 *     departures as one combined list with no reason attached per person. We
 *     never characterize how any individual left, because the FDD does not say
 *     and neither can we. The buyer asks; the person answers.
 *
 *  4. NO PERFORMANCE CLAIM IS EVER ATTACHED TO A NAME. The tier cohort hands over
 *     a boundary and a question — "this band averaged $X; ask what they did in
 *     net sales" — never an assertion that a particular franchisee is a top
 *     performer. The FDD does not say that, so we do not.
 *
 * AI extracts; code decides. Everything below is deterministic over persisted
 * figures, so it applies retroactively to every report already sold.
 */

import type { Basis } from "./ladder";
import { range } from "./range";

/** item19.cohorts[], structurally — kept local so this module has no schema coupling. */
export interface CohortRow {
  label?: string | null;
  ownership?: "franchised" | "company" | "affiliate" | "mixed" | "unknown" | null;
  sampleSize?: number | null;
  revenueType?: "gross_sales" | "net_or_ebitda" | "pre_sale_only" | "other" | null;
  avgMonthlyRevenue?: number | null;
  annualRevenue?: number | null;
}

export interface CallListInput {
  totalUnits?: number | null;
  closedLastYear?: number | null;
  transfersLastYear?: number | null;
  /** Item 20's page citation, reused as the pointer to its exhibits */
  item20Page?: string | null;
  cohorts?: CohortRow[] | null;
  item19Page?: string | null;
}

export type CohortKey = "current" | "departed" | "tiers";

export interface CallCohort {
  key: CohortKey;
  title: string;
  /** who these people are and roughly how many, in plain language */
  who: string;
  /** where in the buyer's own copy of the FDD the names sit */
  where: string | null;
  /** why this call is worth the buyer's afternoon */
  why: string;
  /** ordered — the first question is the one that unlocks the rest */
  questions: string[];
  count: number | null;
  basis: Basis;
}

export interface CallList {
  available: boolean;
  cohorts: CallCohort[];
  intro: string;
  /** the caveat that applies to the whole block, stated once, under it */
  note: string;
  /** words, when there is nothing to build a list from */
  unavailable: string | null;
}

/** At or below this, the roster is short enough to read end to end. */
const WHOLE_ROSTER = 40;
/** Above this, "call the list" is not advice, it is a filter instruction. */
const LARGE_SYSTEM = 400;

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

const money = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** A cohort resolved to one monthly figure, and whether the FDD stated it. */
interface Band {
  row: CohortRow;
  monthly: number;
  monthlyDisclosed: boolean;
}

/**
 * A cohort's monthly figure — stated where the FDD states one, divided where it
 * does not.
 *
 * Item 19 discloses ANNUAL unit volume far more often than a monthly figure.
 * Tint World prints sixteen bands and carries a monthly number on none of them;
 * Dunkin' prints twelve and the same. Requiring a disclosed monthly figure would
 * have silently deleted the tier call from the two largest systems in the corpus
 * over a unit convention, which is the kind of quiet coverage hole that never
 * shows up as a bug — the section simply is not there.
 *
 * Dividing by twelve is arithmetic on a disclosed figure, so the cohort's
 * provenance drops to DERIVED when any figure behind it came out that way. It
 * does not silently keep claiming DISCLOSED.
 */
function monthlyOf(c: CohortRow): { value: number; disclosed: boolean } | null {
  if (isCount(c.avgMonthlyRevenue) && c.avgMonthlyRevenue > 0) {
    return { value: c.avgMonthlyRevenue, disclosed: true };
  }
  if (isCount(c.annualRevenue) && c.annualRevenue > 0) {
    return { value: c.annualRevenue / 12, disclosed: false };
  }
  return null;
}

/**
 * Cohorts safe to compare against each other as a performance spread.
 *
 * Two exclusions carry real weight. Company- and affiliate-owned outlets
 * routinely gross about twice what franchised ones do and must never be shown to
 * a buyer as franchisee earnings. And a cohort reporting net income, pre-sale
 * revenue or an unstated measure is not measuring the same thing as one
 * reporting gross sales, so ranking them against each other manufactures a
 * spread that does not exist. Tint World is the live case: its EBITDA bands sit
 * in the same Item 19 array as its sales bands, and reading the low EBITDA band
 * against the high sales band would print a 20× spread that is really just two
 * different units of measure.
 */
function comparable(rows: CohortRow[]): Band[] {
  const out: Band[] = [];
  for (const c of rows ?? []) {
    if (!c?.label?.trim()) continue;
    if (c.ownership === "company" || c.ownership === "affiliate") continue;
    if (
      c.revenueType === "net_or_ebitda" ||
      c.revenueType === "pre_sale_only" ||
      c.revenueType === "other"
    ) continue;
    const m = monthlyOf(c);
    if (!m) continue;
    out.push({ row: c, monthly: m.value, monthlyDisclosed: m.disclosed });
  }
  return out;
}

/**
 * Build the cohorts worth calling from what the record already carries.
 */
export function buildCallList(input: CallListInput | null | undefined): CallList {
  const total = isCount(input?.totalUnits) ? (input!.totalUnits as number) : null;
  const closed = isCount(input?.closedLastYear) ? (input!.closedLastYear as number) : null;
  const transfers = isCount(input?.transfersLastYear) ? (input!.transfersLastYear as number) : null;
  const item20 = input?.item20Page?.trim() || null;
  const item19 = input?.item19Page?.trim() || null;

  const cohorts: CallCohort[] = [];

  const current = currentOperators(total, item20);
  if (current) cohorts.push(current);

  const departed = departedOperators(closed, transfers, item20);
  if (departed) cohorts.push(departed);

  const tiers = tierBoundary(input?.cohorts ?? [], item19);
  if (tiers) cohorts.push(tiers);

  if (cohorts.length === 0) {
    return {
      available: false,
      cohorts: [],
      intro: "",
      note: "",
      unavailable:
        "This record does not carry the outlet counts or earnings cohorts needed to build a call list. Item 20 of the document itself lists every current franchisee and everyone who left in the last fiscal year, with contact information — read it directly and call from there.",
    };
  }

  return {
    available: true,
    cohorts,
    intro:
      "Every figure in this report came out of the franchisor's own document. These are the people who can tell you whether it holds up in practice — and the franchisor is required to print their contact information in the FDD you were given.",
    note: "The FDD does not say why any individual left, and neither do we — that is question one on the call, not a label anyone can apply from the outside. Nothing on this page is a claim about a specific franchisee's results.",
    unavailable: null,
  };
}

/* ─────────────────────────── cohort 1 ─────────────────────────── */

function currentOperators(total: number | null, item20: string | null): CallCohort | null {
  if (total == null || total <= 0) return null;

  // The roster covers franchisees; the systemwide count may also include
  // company-owned outlets. Say "outlets" for the count we have and "franchisees"
  // for the list, rather than implying the two numbers are the same one.
  const scale =
    total <= WHOLE_ROSTER
      ? `The system ran ${total.toLocaleString()} outlets at year end, so the franchisee list is short enough to read end to end. On a system this size the operators know each other, and the third call is usually the one that gets candid.`
      : total >= LARGE_SYSTEM
        ? `The system ran ${total.toLocaleString()} outlets at year end, so the list is long. Do not work it in order — filter to your state first, then to units that opened in the last two years, because those owners still remember what the ramp actually cost.`
        : `The system ran ${total.toLocaleString()} outlets at year end. Filter the list to markets like yours, then to the most recent openings — owners two years in remember the ramp; owners ten years in have forgotten it.`;

  return {
    key: "current",
    title: "Operators running a unit today",
    who: scale,
    where: item20
      ? `Listed by name, address and phone in the exhibit Item 20 points to (${item20}).`
      : "Listed by name, address and phone in the exhibit Item 20 points to.",
    why: "Three rungs of the cash ladder in this report run on category benchmarks rather than this brand's figures, because an FDD is not required to disclose what a unit costs to operate. These four answers replace those benchmarks with real numbers from real units.",
    questions: [
      "What do you actually run for cost of goods, as a percent of sales?",
      "What do you run for labor, as a percent of sales — and does that include you?",
      "What is your rent, and what percent of sales does it work out to?",
      "How many months until the unit covered its own costs, and how much cash did you burn getting there?",
      "Knowing what you know now, would you buy this one again?",
    ],
    count: total,
    basis: "disclosed",
  };
}

/* ─────────────────────────── cohort 2 ─────────────────────────── */

function departedOperators(
  closed: number | null,
  transfers: number | null,
  item20: string | null,
): CallCohort | null {
  if (closed == null && transfers == null) return null;

  const c = closed ?? 0;
  const t = transfers ?? 0;

  // Rule 2: no zero-count card. Where nothing moved, that is the finding.
  let who: string;
  if (c === 0 && t === 0) {
    who =
      "No outlet closed and none changed hands last year. A system where nobody left is a real signal — confirm it by asking the franchisor for the same list from two years ago, because one clean year and a clean track record are different things.";
  } else if (c === 0) {
    who = `No outlet closed, but ${t.toLocaleString()} changed owners. The sellers are the call: the FDD gives transfer counts with no reason attached, and the previous owner is the only person who can tell you whether they cashed out or got out.`;
  } else if (t === 0) {
    who = `${c.toLocaleString()} ${c === 1 ? "outlet" : "outlets"} closed last year. The FDD prints last known contact information for franchisees who left in the most recent fiscal year — a short list, and the highest-signal calls available to you.`;
  } else {
    who = `${c.toLocaleString()} closed and ${t.toLocaleString()} changed owners. Both groups left the system, and both are reachable: the FDD prints last known contact information for franchisees who departed in the most recent fiscal year.`;
  }

  return {
    key: "departed",
    title: "Operators who left last year",
    who,
    where: item20
      ? `Contact details for departed franchisees sit in the exhibit Item 20 points to (${item20}).`
      : "Contact details for departed franchisees sit in the exhibit Item 20 points to.",
    why: "This is the least-made call in franchise diligence and the one that changes minds. Current operators have a working relationship with the franchisor and an asset to resell. People who already left have neither, and they answer differently.",
    questions: [
      "How did your exit actually happen — did you sell it, hand it back, or were you terminated?",
      "What did your numbers look like against the Item 19 figures you were shown before you signed?",
      "What did you find out in year one that you wish you had known on day one?",
      "Was there anything the franchisor could have done that would have changed the outcome?",
      "Would you tell someone in my position to do this deal?",
    ],
    count: c + t > 0 ? c + t : null,
    basis: "disclosed",
  };
}

/* ─────────────────────────── cohort 3 ─────────────────────────── */

/**
 * Item 20 names no high performers — nothing in an FDD does. But Item 19
 * frequently discloses performance BANDS, and a band plus a question is enough
 * to place whoever picks up the phone. That join happens on the call, not here.
 */
function tierBoundary(rows: CohortRow[], item19: string | null): CallCohort | null {
  const usable = comparable(rows ?? []);
  if (usable.length < 2) return null;

  const sorted = [...usable].sort((a, b) => b.monthly - a.monthly);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const hi = top.monthly;
  const lo = bottom.monthly;
  if (!(hi > lo)) return null;

  // One decimal, always. Math.round alone prints Dunkin's 3.0× as "3×", which
  // reads as a rounded-off guess sitting beside two exact dollar figures.
  const spread = (hi / lo).toFixed(1);

  // Deliberately no sample-size annotation. Item 19 rows carry sampleSize
  // inconsistently: Tint World's "Highest" row describes ONE centre and carries
  // sampleSize 105, the size of the population it was drawn from. Printing
  // "105 outlets" beside a single outlet's figure would be a false denominator,
  // and a figure that cannot be true is not a disclosure. The sample question is
  // asked on the call instead, where the answer is reliable.
  return {
    key: "tiers",
    title: "Placing whoever answers the phone",
    who: `This brand's Item 19 prints its outlets in bands. The highest it discloses — "${top.row.label}" — works out to ${money(hi)} a month; the lowest — "${bottom.row.label}" — ${money(lo)}. That is a ${spread}× spread inside one system, and it is the yardstick for every call you make.`,
    where: item19
      ? `Item 19 (${item19}) carries the bands and what each one reported.`
      : "Item 19 carries the bands and what each one reported.",
    why: "An operator telling you they do fine is not information. An operator telling you a number you can place inside the franchisor's own bands is. Ask the number first, then decide how much weight the rest of the call carries.",
    questions: [
      `What did this unit do in net sales last year? (${range(money(lo), money(hi))} a month is the band this brand discloses.)`,
      "How many units sit behind the band you were shown, and how many of them beat it?",
      "What separates the units at the top of this system from the ones at the bottom — site, market, or operator?",
      "Was your unit's performance what the franchisor projected when you signed?",
    ],
    // There is no roster behind a band, so there is nothing to count. A number
    // here would read as "call this many people."
    count: null,
    basis: top.monthlyDisclosed && bottom.monthlyDisclosed ? "disclosed" : "derived",
  };
}
