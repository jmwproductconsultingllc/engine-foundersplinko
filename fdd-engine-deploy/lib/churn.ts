/**
 * lib/churn.ts — who left, and how many.
 *
 * The report has always rendered System Scale as four bare counts: total units,
 * opened, closed, transfers. Four numbers with no denominator. "9 closed" means
 * something completely different on a 1,100-unit system than on a 40-unit one,
 * and the page was asking the reader to do that division in their head — which
 * is exactly the arithmetic this product exists to do for them.
 *
 * Three rules this module enforces.
 *
 *  1. RATES ARE COMPUTED ON OUTLETS AT THE START OF THE YEAR. Item 20's headline
 *     count is outlets at year END. Dividing last year's closures by this year's
 *     ending count understates churn on every growing system — the systems most
 *     likely to be sold to a first-time buyer. The start base is reconstructed
 *     explicitly (end − opened + closed) and the reconstruction is stated, not
 *     hidden. Transfers do not move the count, so they do not appear in it.
 *
 *  2. A TRANSFER IS NOT A CLOSURE AND IT IS NOT A SUCCESS EITHER. The FDD gives
 *     transfer counts with no reason attached. A transfer can be a franchisee
 *     cashing out at a profit or a franchisor moving a failing unit to a new
 *     owner before it goes dark. Item 20 does not say which, so neither do we:
 *     the shape gets named and the reader gets the question to ask.
 *
 *  3. A FIGURE THAT DOES NOT EXIST GETS WORDS. No zeros standing in for missing
 *     disclosures, no em-dashes. If the counts are not there, this module says
 *     what is missing and where to look for it.
 *
 * AI extracts; code decides. Everything below is deterministic arithmetic over
 * figures already persisted on every record, so it applies retroactively to
 * every report already sold, with no re-extraction and no re-minting.
 */

import type { Basis } from "./ladder";

/** systemScale, structurally — kept local so this module has no schema coupling. */
export interface SystemScaleCounts {
  totalUnits?: number | null;
  openedLastYear?: number | null;
  closedLastYear?: number | null;
  transfersLastYear?: number | null;
  sourcePage?: string | null;
}

export interface ChurnFigure {
  count: number;
  /** percent of outlets open at the start of the year, one decimal */
  pct: number;
}

export type ChurnTier = "Low" | "Medium" | "High";

export interface ChurnAnalysis {
  /** true when at least one rate could be computed */
  computable: boolean;
  /** when not computable — the sentence that replaces the figure. Never a dash. */
  unavailable: string | null;

  /** outlets open at the start of the year: the denominator */
  base: number | null;
  /** how the denominator was arrived at, in plain language */
  baseNote: string | null;
  /** true when opened AND closed were both disclosed, so the base is exact */
  baseExact: boolean;

  opened: number | null;
  closed: ChurnFigure | null;
  transfers: ChurnFigure | null;
  /** closures + transfers: every unit that went dark or changed hands */
  ownerTurnover: ChurnFigure | null;
  /** opened − closed */
  netChange: number | null;

  /** tier on owner turnover; null when the system is too small for a rate to mean anything */
  tier: ChurnTier | null;
  /** the one-sentence readout. Describes the system, never our analysis. */
  headline: string;
  /** the shape worth naming, when there is one */
  tell: string | null;
  /** what the buyer does with this. Always present. */
  question: string;

  basis: Basis;
  sourcePage: string | null;
  /** a system small enough that one unit swings the rate */
  smallSystem: boolean;
}

/** Below this, a single closure moves the rate by four points or more. */
const SMALL_SYSTEM = 25;

/** Tier boundaries on owner turnover. Named here, never named on the page. */
const TIER_MEDIUM = 8;
const TIER_HIGH = 15;

function pct(n: number, base: number): number {
  return Math.round((n / base) * 1000) / 10;
}

function figure(n: number | null | undefined, base: number): ChurnFigure | null {
  return n == null ? null : { count: n, pct: pct(n, base) };
}

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function tierFor(turnoverPct: number): ChurnTier {
  if (turnoverPct >= TIER_HIGH) return "High";
  if (turnoverPct >= TIER_MEDIUM) return "Medium";
  return "Low";
}

const NOT_COMPUTABLE = (why: string): ChurnAnalysis => ({
  computable: false,
  unavailable: why,
  base: null,
  baseNote: null,
  baseExact: false,
  opened: null,
  closed: null,
  transfers: null,
  ownerTurnover: null,
  netChange: null,
  tier: null,
  headline: why,
  tell: null,
  question:
    "Item 20 is required to show outlet counts for the last three fiscal years, broken out by state and by reason. Read it in the document itself, and ask the franchisor for the same table if it is incomplete.",
  basis: "derived",
  sourcePage: null,
  smallSystem: false,
});

/**
 * Turn Item 20's outlet counts into rates a buyer can act on.
 *
 * The failure mode this guards against is the confident wrong number: a system
 * whose disclosed closures exceed the units it could have closed is a bad
 * extraction, not a catastrophic brand, and publishing 340% turnover would
 * destroy the credibility of every correct figure on the page. A figure that
 * cannot be true is not a disclosure — those cases return words.
 */
export function analyzeChurn(s: SystemScaleCounts | null | undefined): ChurnAnalysis {
  const sourcePage = s?.sourcePage?.trim() || null;

  const total = isCount(s?.totalUnits) ? (s!.totalUnits as number) : null;
  const opened = isCount(s?.openedLastYear) ? (s!.openedLastYear as number) : null;
  const closed = isCount(s?.closedLastYear) ? (s!.closedLastYear as number) : null;
  const transfers = isCount(s?.transfersLastYear) ? (s!.transfersLastYear as number) : null;

  if (total == null || total <= 0) {
    return NOT_COMPUTABLE(
      "This record does not carry a systemwide outlet count, so closures and transfers cannot be stated as a share of the system.",
    );
  }
  if (closed == null && transfers == null) {
    const a = NOT_COMPUTABLE(
      "This record carries the system's size but not its closures or transfers, so turnover cannot be computed.",
    );
    return { ...a, base: total, sourcePage };
  }

  // Rule 1. Item 20's headline is outlets at year END. Reconstruct the start.
  const baseExact = opened != null && closed != null;
  const base = total - (opened ?? 0) + (closed ?? 0);

  if (base <= 0) {
    return NOT_COMPUTABLE(
      "The outlet counts in this record do not reconcile — the openings and closures disclosed are larger than the system itself. Read Item 20 directly before relying on any turnover figure.",
    );
  }
  // Rule: a figure that cannot be true is not a disclosure — and the gate
  // catches the IMPOSSIBLE, never the merely bad. Note that `closed` feeds the
  // base, so "closed > base" is unreachable: a mis-read closure count silently
  // inflates its own denominator. The check therefore runs against the disclosed
  // year-end count, at a ceiling generous enough that a system which HALVED in
  // one year passes it unflagged. What it catches is a table read wrong.
  const ceiling = (n: number) => Math.max(2 * n, n + 25);
  if (closed != null && closed > ceiling(total)) {
    return NOT_COMPUTABLE(
      "The closure count in this record is larger than the system could plausibly have lost in one year, which means the figure was mis-read from the table. Read Item 20 directly before relying on any turnover figure.",
    );
  }
  if (transfers != null && transfers > ceiling(base)) {
    return NOT_COMPUTABLE(
      "The transfer count in this record is larger than the number of outlets available to change hands, which means the figure was mis-read from the table. Read Item 20 directly before relying on any turnover figure.",
    );
  }

  const closedFig = figure(closed, base);
  const transferFig = figure(transfers, base);
  const turnoverCount = (closed ?? 0) + (transfers ?? 0);
  const ownerTurnover: ChurnFigure | null =
    closed == null && transfers == null ? null : { count: turnoverCount, pct: pct(turnoverCount, base) };

  const smallSystem = base < SMALL_SYSTEM;
  const tier = ownerTurnover && !smallSystem ? tierFor(ownerTurnover.pct) : null;

  const baseNote = baseExact
    ? `${base.toLocaleString()} outlets were open at the start of the year: ${total.toLocaleString()} at year end, less ${opened!.toLocaleString()} opened, plus ${closed!.toLocaleString()} closed. Every rate below is a share of that starting count, not of today's.`
    : `${base.toLocaleString()} outlets is the closest starting count this record supports; the year's openings are not both disclosed, so the rates below may run slightly low on a growing system.`;

  return {
    computable: true,
    unavailable: null,
    base,
    baseNote,
    baseExact,
    opened,
    closed: closedFig,
    transfers: transferFig,
    ownerTurnover,
    netChange: opened != null && closed != null ? opened - closed : null,
    tier,
    headline: headlineFor(ownerTurnover, closedFig, transferFig, base, smallSystem),
    tell: tellFor(closedFig, transferFig, opened, base, smallSystem),
    question: questionFor(closedFig, transferFig),
    basis: "derived",
    sourcePage,
    smallSystem,
  };
}

/**
 * Name the output, never the cutoff. The reader is told what share of the
 * system changed hands; they are never told what number we would have flagged.
 */
function headlineFor(
  turnover: ChurnFigure | null,
  closed: ChurnFigure | null,
  transfers: ChurnFigure | null,
  base: number,
  smallSystem: boolean,
): string {
  if (!turnover) return "Turnover could not be computed for this system.";

  if (turnover.count === 0) {
    return `No outlet closed or changed hands last year across ${base.toLocaleString()} units.`;
  }

  const parts: string[] = [];
  if (closed) parts.push(closed.count === 0 ? "None closed" : `${closed.count.toLocaleString()} closed`);
  if (transfers) parts.push(transfers.count === 0 ? "none changed hands" : `${transfers.count.toLocaleString()} changed hands`);
  const detail = parts.join(" and ");

  const share = `${turnover.pct}% of the ${base.toLocaleString()} outlets open at the start of the year`;

  if (smallSystem) {
    const oneUnit = Math.round((100 / base) * 10) / 10;
    return `${detail} — ${share}. On a system this size one outlet is ${oneUnit} points, so read the counts before the rate.`;
  }
  return `${detail} — ${share}.`;
}

/** "1 closure", "7 closures" — the page ships to buyers, not to a log file. */
function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** The shape worth naming. At most one; a reader who meets three tells reads none. */
function tellFor(
  closed: ChurnFigure | null,
  transfers: ChurnFigure | null,
  opened: number | null,
  base: number,
  smallSystem: boolean,
): string | null {
  if (transfers && transfers.count > 0 && closed && closed.count === 0) {
    return `Nothing closed, and ${transfers.count.toLocaleString()} outlets changed owners. Item 20 discloses transfers without a reason, so this shape reads two ways: owners exiting at a price they were happy with, or units handed to a new operator before they went dark. The number does not tell you which and the franchisor's answer is not the only one available — the previous owners are listed in Item 20 with contact information.`;
  }
  if (closed && opened != null && closed.count > opened) {
    return `More outlets closed than opened last year: ${closed.count.toLocaleString()} against ${opened.toLocaleString()}. A shrinking system is not automatically a bad one — franchisors do prune — but ask which markets closed and whether any of them look like yours.`;
  }
  if (transfers && closed && closed.count > 0 && transfers.count >= closed.count * 3 && transfers.count >= 5) {
    return `Transfers ran roughly ${Math.round(transfers.count / closed.count)}× closures. Ask what a typical transfer sold for: a system where owners exit at a gain and a system where they exit at any price both show up here as the same number.`;
  }
  // Rate-driven, so it is suppressed on a system too small for a rate to mean
  // anything: "1 closure against 2 outlets" is a fact, not a finding.
  if (!smallSystem && closed && closed.count > 0 && closed.pct >= 5) {
    return `${plural(closed.count, "closure", "closures")} against ${base.toLocaleString()} outlets open at the start of the year. Item 20 breaks closures out by state and by reason — terminations, non-renewals, reacquisitions, and ceased operations are four different stories, and the table separates them.`;
  }
  return null;
}

function questionFor(closed: ChurnFigure | null, transfers: ChurnFigure | null): string {
  const moved = (closed?.count ?? 0) + (transfers?.count ?? 0);
  if (moved === 0) {
    return "Item 20 lists every current franchisee with a phone number. Call three in markets like yours and ask what their first twelve months actually cost.";
  }
  return "Item 20 lists every franchisee who left the system in the last fiscal year, with last known contact information. They are the only people who can tell you why. Call three of them, and three current operators, before you sign.";
}
