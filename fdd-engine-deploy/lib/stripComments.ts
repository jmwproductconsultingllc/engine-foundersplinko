// lib/stripComments.ts — THE COMMENT-BLIND HELPER, one declaration.
//
// WHY THIS IS ITS OWN MODULE
//
// Several lints in this repo scan first-party source for a forbidden pattern:
// a banned phrase, a hand-typed colour, a bare JSON.stringify. Every one of
// them has the same false-positive problem — the pattern also appears in the
// COMMENT that explains why it is banned, so the lint fails on its own
// documentation and the next person "fixes" it by deleting the explanation.
//
// Three copies of this walk existed (lib/riskReframeDrift.test.ts,
// lib/refund.test.ts, components/captureCopy.test.ts) and they had ALREADY
// DRIFTED: two were this character walk, one was a pair of regexes that cannot
// tell a comment from the characters "//" inside a string literal. A fourth
// caller (lib/brandJson.test.ts) is what moved it here. See THE TWO-PALETTE
// DEFECT — two hand-maintained copies of one declaration always drift, and the
// copy that drifts is always the one nobody is looking at.
//
// WHY A CHARACTER WALK AND NOT A REGEX
//
// `src.replace(/^\s*\/\/.*$/gm, "")` deletes the tail of any line whose first
// non-space characters are a slash pair — including a line inside a template
// literal. Regexes cannot track whether they are inside a string, and the
// strings in this repo are full of URLs and windows paths.
//
// STRINGS ARE SKIPPED, NOT BLANKED — ON PURPOSE
//
// The walk steps OVER a string literal without altering it, so the caller still
// sees string contents. That is what makes it usable for "this banned phrase
// must not appear in shipped copy": the copy lives in the strings. A version
// that blanked strings would report green on every real violation.

/**
 * Replace every comment in `src` with spaces, preserving newlines so that line
 * and column numbers in the output still match the input.
 *
 * String and template literals are traversed but left intact.
 */
export function stripComments(src: string): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) out[k] = src[k] === "\n" ? "\n" : " ";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) break;
        if (c !== "`" && src[j] === "\n") break; // unterminated; bail at EOL
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}
