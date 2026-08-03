/**
 * lib/citation.ts — THE CITATION NORMALIZER.
 *
 * WHAT WENT WRONG, so nobody re-introduces it.
 *
 * `Citation.page` is documented as "printed page or range as it appears in the
 * document, e.g. 28-30" — a BARE page reference. The glass renderer reads that
 * contract literally and prints `Item {item}` then `, p. {page}`.
 *
 * The extractor's `sourcePage` field does not hold a bare page. It holds a
 * COMPLETE citation: "Item 7, pp. 9-10". Across the catalog that is true of
 * 224 of 224 distinct values — not one is a bare page number. `cite()` passed
 * it through raw, so every cited line on every glass page rendered
 *
 *     Franchise Fee   DISCLOSED   Item 7, p. Item 7, pp. 9-10
 *
 * 1,877 lines across 82 glass-qualified brands. 100% of cited lines carrying a
 * page. On a page whose promise is "every figure is cited to an FDD Item and
 * page", that is the worst-placed defect in the product.
 *
 * THE SECOND DEFECT, which is the serious one.
 *
 * `sourcePage` is a free-text field an extraction model fills in, and models
 * volunteer their work. Two records in the catalog carry a parenthetical tail,
 * and one of them is this:
 *
 *   "Item 20, p.48 (Table No. 1 and Table No. 3; as of December 31, 2025;
 *    672 franchised + 3 company-owned = 675 total; 4 terminations + 1 ceased
 *    other reasons = 5 closed)"
 *
 * lawn-doctor's System Scale section masks totalUnits (675) and closedLastYear
 * (5) — and then printed both, in plain text, in the citation on the same line
 * as the mask. The mask and the answer, side by side.
 *
 * So this module is FAIL-CLOSED on the page field. `page` is populated only
 * from a leading run that matches PAGE_REF completely; the first character
 * that does not fit the grammar ends the page and everything after it is
 * DROPPED, not passed through. Prose cannot survive normalization, which means
 * a future extractor cannot leak through this channel no matter what it writes.
 *
 * Normalizing at READ, not by repairing the catalog: the producer is outside
 * this repo. Rewriting 224 strings fixes today's records and nothing about the
 * next batch.
 */

import type { Citation } from "./reportShell";

/**
 * A page reference and nothing else.
 *
 *   9            9-10          9–10        20, 21
 *   A-21         A-21 to A-24  134         140-145
 *
 * Anchored at the start. Deliberately NOT anchored at the end: we match the
 * leading page run and discard the remainder, which is what makes a
 * parenthetical figure dump unable to reach the client.
 */
const PAGE_REF =
  /^(?:[A-Za-z]-)?\d+(?:\s*(?:[-–—,]|\bto\b)\s*(?:[A-Za-z]-)?\d+)*/;

/** "Item 7," / "Item 20:" / "Item 19" at the head of a citation string. */
const ITEM_PREFIX = /^\s*Item\s+(\d+)\s*[,:]?\s*/i;

/** "p." "pp." "printed pp." — the page-number token, however it was written. */
const PAGE_TOKEN = /^(?:printed\s+)?pp?\.?\s*/i;

/**
 * Turn whatever the extractor wrote into the `{ item, page }` shape the shell
 * contract declares.
 *
 * `page` is omitted rather than sent empty — the renderer prints the separator
 * off a truthy check, and an empty string reads as a bug on the page.
 *
 * Fail-closed cases, all of which yield `{ item }` with no page:
 *   - the string names a DIFFERENT Item than the caller (we cannot tell which
 *     item the page belongs to, so we assert neither)
 *   - there is no page reference at all ("Item 20 (year-end 2025)")
 *   - the remainder does not begin with something PAGE_REF recognizes
 */
export function normalizeCitation(item: number, sourcePage?: string | null): Citation {
  const raw = sourcePage?.trim();
  if (!raw) return { item };

  let rest = raw;

  const named = ITEM_PREFIX.exec(rest);
  if (named) {
    // A citation that names an item other than the one being cited is not a
    // page we can attach. Drop it; the Item number alone is still a true
    // pointer, and a wrong page is worse than a missing one.
    if (Number(named[1]) !== item) return { item };
    rest = rest.slice(named[0].length);
  }

  rest = rest.replace(PAGE_TOKEN, "");

  const page = PAGE_REF.exec(rest)?.[0]?.trim();
  return page ? { item, page } : { item };
}

/**
 * `p.` for a single page, `pp.` for a range or a list.
 *
 * Derived from the page string rather than stored, so plurality costs the RSC
 * payload nothing. The separator must be preceded by a DIGIT: "A-21" is one
 * exhibit page whose label contains a hyphen, not a range.
 */
const IS_RANGE = /\d\s*(?:[-–—,]|\bto\b)\s*(?:[A-Za-z]-)?\d/;

/** The one place a citation becomes display text. */
export function formatCitation(c: Citation): string {
  if (!c.page) return `Item ${c.item}`;
  return `Item ${c.item}, ${IS_RANGE.test(c.page) ? "pp." : "p."} ${c.page}`;
}
