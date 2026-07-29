// lib/range.ts — THE RANGE RULE.
//
// Motivating bug (mobile, live paid reports — Jul 29 2026). On a 390px iPhone
// the cash ladder rendered rung 6 as
//
//     $16,018
//     –
//     $25,629
//
// Three lines for one figure, on every rung that carries a range, which is most
// of them. Rung 12 broke as "4.50 –" / "18.59". The majority of this product's
// traffic reads the report on that screen, and on that screen the ladder was a
// column of orphaned dashes.
//
// The cause was ten independent copies of `${lo} – ${hi}`, each joining with an
// ordinary space — and an ordinary space is a line-break opportunity. A range
// is ONE figure. It breaks as one figure or it does not break.
//
// The same ten copies carried a second defect: only one of them collapsed an
// equal pair. The Item 7 table published "Initial Franchise Fee $59,500 –
// $59,500", a range with no range in it, asking the reader to compare two
// identical numbers and spending a whole line to say nothing. Five rows of that
// table were the same shape.
//
// THE RULE: a low/high pair is joined here or it is not joined at all.
// Enforced by lib/range.test.ts, which fails on a spaced en-dash written
// anywhere else under lib/, components/ or app/.

/** No-break space. The separator is bracketed by these so the whole pair is a
 *  single unbreakable run as far as the line-breaker is concerned. */
const NB = "\u00A0";

/** low, dash, high — one token. */
export const RANGE_SEP = `${NB}–${NB}`;

/**
 * Join a formatted low and high into a single figure.
 *
 * Equality is tested on the FORMATTED strings, never the raw numbers, and that
 * is deliberate: $59,500.00 and $59,500.40 both print as $59,500, so on the
 * page they ARE one figure, and printing them as a range would claim a
 * precision the rendering does not have.
 */
export function range(lo: string, hi: string): string {
  return lo === hi ? lo : `${lo}${RANGE_SEP}${hi}`;
}

/**
 * A percentage BAND — "28–34%", "26.4%". Not a money range: it is tight enough
 * that it never needed spaces, so it was never the bug. It lives here anyway so
 * that "how do I print a low/high pair" has exactly one answer.
 */
export function band(lo: number, hi: number, digits = 0): string {
  const l = lo.toFixed(digits);
  const h = hi.toFixed(digits);
  return l === h ? `${l}%` : `${l}–${h}%`;
}
