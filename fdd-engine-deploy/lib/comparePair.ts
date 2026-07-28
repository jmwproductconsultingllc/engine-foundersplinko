// lib/comparePair.ts — the one parser for a /compare/<a>-vs-<b> slug.
//
// This lived inside app/compare/[pair]/page.tsx until the preview card needed
// it too. Two copies of a URL parser is a specific, nasty class of bug: the
// page and the card disagree on which brand is on the left, or one of them
// accepts a pair the other rejects, and the unfurl in someone's inbox describes
// a comparison that isn't the one behind the link. There is no test that
// catches that, because both halves pass their own.
//
// Note the split is on the FIRST "-vs-", not the last and not a regex split.
// Brand slugs can and do contain "vs" as a substring; splitting on the first
// occurrence keeps the canonical (alphabetically sorted) pair unambiguous.

export const PAIR_SEP = "-vs-";

/**
 * Returns the two slugs in the order they appear in the URL, or null if the
 * string isn't a well-formed pair. A pair of one brand with itself is not a
 * comparison, so it's null too.
 */
export function parsePair(pair: string): [string, string] | null {
  const i = pair.indexOf(PAIR_SEP);
  if (i <= 0) return null;
  const a = pair.slice(0, i);
  const b = pair.slice(i + PAIR_SEP.length);
  return a && b && a !== b ? [a, b] : null;
}

/** The canonical URL segment for a pair: slugs sorted alphabetically. */
export function pairSlug(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `${x}${PAIR_SEP}${y}`;
}
