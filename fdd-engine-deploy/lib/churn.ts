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
 *     likely to be sold to a first-time buyer. Transfers do not move the count,
 *     so they do not appear in it.
 *
 *     The start count is READ from Item 20 Table 1 where the record carries it,
 *     and only reconstructed (end − opened + closed) where it does not — and a
 *     reconstruction now says out loud that it is one. See RULE 4.
 *
 *  4. A RECONSTRUCTION IS NOT A READING, AND A RECONCILIATION MUST ACTUALLY
 *     RECONCILE.
 *
 *     seniors-helping-seniors shipped this sentence to a live brand page:
 *
 *       "179 outlets were open at the start of the year: 224 at year end, less
 *        54 opened, plus 9 closed."
 *
 *     Item 20 Table 1 discloses 180 at the start of 2025. Every number in that
 *     sentence except the 224 was wrong, and the sentence was phrased as though
 *     we had read them out of the table. Two separate failures:
 *
 *       - The 54 came out of an Item 19 NOTE — units excluded from the revenue
 *         dataset, which is not a count of openings. The 9 was Table 3's
 *         terminations column alone, dropping non-renewals, reacquisitions and
 *         "ceased operations — other." Both are extractor problems, and the
 *         extractor rule is now: no outlet count may be sourced from Item 19.
 *
 *       - The arithmetic could not catch either one, because `base` was DEFINED
 *         as end − opened + closed. A quantity defined by an equation always
 *         satisfies that equation. The sentence read like a check and was
 *         incapable of failing.
 *
 *     So: where the disclosed start exists, it is the base AND the check —
 *     start + opened − closed must equal the disclosed end. Where it doesn't
 *     close, the reconciliation sentence does not render at all and the reader
 *     gets the finding instead. An outlet table that does not add up is worth
 *     more to a buyer than a turnover rate computed off it.
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
  /**
   * Outlets open at the START of the fiscal year, as Item 20 Table 1 discloses
   * it directly. Optional because 83 of 83 records predate the field.
   *
   * When present it does two jobs at once: it becomes the denominator (a read
   * beats a reconstruction), and it makes the reconstruction FALSIFIABLE for
   * the first time — see RULE 4 in the header.
   */
  unitsStartOfYear?: number | null;
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
  /** true when the base is a disclosed figure or an exact reconstruction */
  baseExact: boolean;
  /** true when the base was READ from Item 20 Table 1 rather than reconstructed */
  baseDisclosed: boolean;

  /**
   * Did the franchisor's own outlet table close?
   *
   * null when there was nothing to check — no disclosed start count, or no
   * openings/closures to check it against. Never null-as-in-fine: a null here
   * means unverified, and the copy says so.
   */
  reconciles: boolean | null;
  /** present only when reconciles === false. The finding, in the buyer's words. */
  unreconciled: string | null;

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

/**
 * Split a rounded total into rounded parts that add back up to it exactly.
 *
 * Rounding each share independently does not guarantee the column adds. Crumbl's
 * 9 closures are 0.851% of its starting base and its 82 transfers are 7.750%;
 * rounded on their own those print 0.9 and 7.8, which a reader sums to 8.7 while
 * the correctly-rounded total beside them reads 8.6. Every individual figure is
 * right and the page is still wrong — and in a product whose entire claim is that
 * it shows its work, a reader who checks our arithmetic and finds it off by a
 * tenth does not conclude "rounding."
 *
 * So the total is rounded honestly and the parts are apportioned to it by largest
 * remainder: floor each part to a tenth of a point, then hand the leftover tenths
 * to whichever parts lost the most in the flooring. Every part still lands within
 * a tenth of its true value, and the column always adds. Because the parts share
 * a denominator with the total, the floors can never overshoot it, so this only
 * ever distributes upward.
 */
function apportion(counts: number[], base: number, totalPct: number): number[] {
  const totalTenths = Math.round(totalPct * 10);
  const raw = counts.map((c) => (c / base) * 1000);
  const out = raw.map((r) => Math.floor(r));
  let leftover = totalTenths - out.reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; leftover > 0 && k < byRemainder.length * 2; k++) {
    out[byRemainder[k % byRemainder.length].i] += 1;
    leftover--;
  }
  return out.map((t) => t / 10);
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
  baseDisclosed: false,
  reconciles: null,
  unreconciled: null,
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
  const startDisclosed = isCount(s?.unitsStartOfYear) ? (s!.unitsStartOfYear as number) : null;
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

  /* Rule 1. Item 20's headline is outlets at year END.
     Read the start where Table 1 gives it; reconstruct it only where it does
     not. A read beats a reconstruction even when the two agree, because only
     the read can DISagree — see RULE 4 in the header. */
  const reconstructed = total - (opened ?? 0) + (closed ?? 0);
  const base = startDisclosed ?? reconstructed;
  const baseDisclosed = startDisclosed != null;
  const baseExact = baseDisclosed || (opened != null && closed != null);

  /* RULE 4. The check that was impossible until the start count was disclosed.
     Note it runs against the DISCLOSED end count, not against `base`. */
  const reconciles =
    startDisclosed != null && opened != null && closed != null
      ? startDisclosed + opened - closed === total
      : null;

  if (base <= 0) {
    return NOT_COMPUTABLE(
      "The outlet counts in this record do not reconcile — the openings and closures disclosed are larger than the system itself. Read Item 20 directly before relying on any turnover figure.",
    );
  }
  // Rule: a figure that cannot be true is not a disclosure — and the gate
  // catches the IMPOSSIBLE, never the merely bad. On a RECONSTRUCTED base,
  // "closed > base" is unreachable — `closed` feeds that base, so a mis-read
  // closure count silently inflates its own denominator. The check therefore
  // runs against the disclosed year-end count, at a ceiling generous enough
  // that a system which HALVED in one year passes it unflagged. What it catches
  // is a table read wrong.
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

  /* The whole is rounded first; the parts are then fitted to it. See apportion().
   *
   * BOTH components required, which is a change. This used to fire when EITHER
   * was disclosed, coalescing the missing one to 0 — so a record carrying
   * transfers but no closure count printed "changed hands + 0 closed" as an
   * owner-turnover RATE, which is a confident claim that nothing closed. It is
   * the same defect as the reconciliation above in a smaller frame: an absent
   * disclosure treated as a disclosed zero.
   *
   * The single figure that IS disclosed still renders its own rate below; what
   * is withheld is only the combined one, which is the one that would be wrong.
   * 79 of 83 catalog records carry both and are unaffected. */
  const turnoverCount = (closed ?? 0) + (transfers ?? 0);
  const ownerTurnover: ChurnFigure | null =
    closed == null || transfers == null ? null : { count: turnoverCount, pct: pct(turnoverCount, base) };

  /* apportion() fits parts to a printed whole. With no whole printed there is
     nothing to fit to, and passing 0 as the total would floor both parts to
     zero — so the lone disclosed figure gets its own honest rounding instead. */
  const [closedPct, transferPct] = ownerTurnover
    ? apportion([closed ?? 0, transfers ?? 0], base, ownerTurnover.pct)
    : [closed == null ? 0 : pct(closed, base), transfers == null ? 0 : pct(transfers, base)];
  const closedFig: ChurnFigure | null = closed == null ? null : { count: closed, pct: closedPct };
  const transferFig: ChurnFigure | null =
    transfers == null ? null : { count: transfers, pct: transferPct };

  const smallSystem = base < SMALL_SYSTEM;
  const tier = ownerTurnover && !smallSystem ? tierFor(ownerTurnover.pct) : null;

  const share = "Every rate below is a share of that starting count, not of today's.";

  /* RULE 5. THESE STRINGS ARE FREE TEXT, AND FREE TEXT MAY NOT CARRY A PAID
     FIGURE.

     The first version of this copy read:

       "179 outlets were open at the start of the year: 224 at year end, less
        54 opened, plus 9 closed."

     Every number after the colon — the year-end total, the openings, the
     closures — is a MASKED figure a few lines above the note on the same glass
     card. The sentence printed them in plain prose, for free, on 67 of 82 live
     brand pages. It shipped for the same reason the arithmetic defect shipped:
     nobody had read the rendered page as a stranger.

     baseNote and unreconciled therefore name the METHOD and never the
     components. The base itself stays — it is the denominator of a rate the
     reader is being asked to trust, it is not one of the four disclosed counts,
     and knowing it recovers none of them. Everything else goes.

     The paid report renders all four counts as their own lines a few inches up,
     so the paid reader loses nothing by their absence here. There is
     deliberately ONE string rather than a free one and a paid one: two copies
     of a sentence drift, and the drift stays invisible until a stranger prints
     the page. lib/reportShell.ts now enforces this at the seam rather than
     trusting this comment.

     The reconciliation CLAIM still renders in exactly one case: the start count
     was disclosed AND the year's movements close against the disclosed end.

     ONE FURTHER CARVE-OUT, found by the seam and not by reading. The base is
     safe to print in the two branches below where it is either DISCLOSED (a
     figure of its own, not one of the four masked counts) or RECONSTRUCTED
     (total − opened + closed, which is one equation in three unknowns and
     recovers none of them). It is NOT safe in the inexact branch: there at
     least one movement is absent and coalesced to nothing, so in the common
     case where both are absent `base` collapses to `total` EXACTLY and the note
     prints the masked total-unit count in words beside its own mask. Two live
     brands were doing this. The inexact branch therefore prints no number at
     all — and it loses nothing, because a starting count the record cannot
     pin down was never the point of that sentence. The caveat is. */
  const baseNote = baseDisclosed
    ? reconciles === true
      ? `${base.toLocaleString()} outlets were open at the start of the year, as Item 20 Table 1 discloses, and the year's openings and closures reconcile to the year-end count stated in the same table. ${share}`
      : `${base.toLocaleString()} outlets were open at the start of the year, as Item 20 Table 1 discloses. ${share}`
    : baseExact
      ? `${base.toLocaleString()} outlets is this record's reconstruction of the starting count, worked back from the year-end total and the year's openings and closures rather than read from Item 20 Table 1. ${share} Check the reconstruction against Table 1 in your own copy.`
      : `This record does not disclose the starting outlet count, and does not carry both of the year's movements to work it back from, so the rates below are taken against the closest starting count it supports and may run slightly low on a growing system.`;

  /* The finding. Deliberately does NOT say which of the four figures is wrong,
     because the disclosure does not say either — and naming a culprit we cannot
     identify is the failure this whole module is a reaction to.

     Also deliberately carries no counts. See RULE 5: this is the free surface,
     and a finding that needs the numbers printed to land was never about the
     numbers. "Their own table does not add up" lands without them, and the
     buyer who wants the four figures is exactly the buyer we want unlocking. */
  const unreconciled =
    reconciles === false
      ? `Item 20's own outlet table does not close: the outlets the franchisor states were open at the start of the year, plus the year's openings, less the year's closures, do not come to the year-end count in the same table. One of those four figures is wrong, or Table 3 breaks closures out in a column this reading missed. Ask the franchisor to walk you from Table 1 to Table 3 before you rely on any turnover figure — the one on this page or the one in the document.`
      : null;

  return {
    computable: true,
    unavailable: null,
    base,
    baseNote,
    baseExact,
    baseDisclosed,
    reconciles,
    unreconciled,
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
  /* PARTIAL DISCLOSURE. One of the two figures is on the record and the other
     is not, so there is no combined turnover rate to state — but there is still
     a disclosed figure, and suppressing it to protect a rate we were never
     entitled to compute would be the strictly worse trade. Says which half is
     missing, because "3 closed" with no transfer count is a different read from
     "3 closed, 0 transferred" and the reader cannot tell them apart. */
  if (!turnover) {
    const one = closed ?? transfers;
    if (!one) return "Turnover could not be computed for this system.";
    const missing = closed ? "transfer count" : "closure count";
    const what = closed
      ? plural(one.count, "outlet closed", "outlets closed")
      : `${one.count.toLocaleString()} ${one.count === 1 ? "outlet" : "outlets"} changed hands`;
    return `${what} — ${one.pct}% of the ${base.toLocaleString()} outlets open at the start of the year. This record carries no ${missing}, so total owner turnover is not stated; it is at least this figure and Item 20 has the rest.`;
  }

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
