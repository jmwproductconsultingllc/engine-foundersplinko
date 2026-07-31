// components/captureCopy.test.ts — THE PROMISE LINT.
//
// Every capture headline in the product must describe something this codebase
// can actually cause to arrive in an inbox.
//
// The line this lint exists to keep buried is "Get the locked findings — free,
// by email." It shipped on the teaser for weeks. sendFindingsEmail() is gated
// by spec to category and severity language and never sends a dollar figure,
// so that headline promised the paid product and delivered a summary. On the
// teaser it read as fishy and converted at approximately nothing. On glass —
// where every figure on the page is an empty <span> and the ask sits inches
// from a $199 button — it would have read as giving the product away.
//
// What the email demonstrably DOES carry is TWELVE_QUESTIONS verbatim plus the
// who-to-ask tease; lib/leadEmail.ts's own preheader is "The 12 questions to
// ask before you sign — and who to ask." So the copy sells the questions.
//
// This is a lint rather than a code review note because copy regresses by
// well-meaning edit, months later, by someone optimizing conversion who has
// never read leadEmail.ts. The banned phrasing is cheap to re-type and there is
// no compiler anywhere that objects.
//
// SCOPE: the COPY map in components/EmailCapture.tsx, plus any capture surface
// that hardcodes its own headline. Adding a new capture surface means adding it
// to SURFACE_FILES below.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { stripComments } from "@/lib/stripComments";
const SURFACE_FILES = [
  "components/EmailCapture.tsx",
  "components/CaptureSheet.tsx",
  "components/ReportGlass.tsx",
  "components/BrandDetail.tsx",
];

/**
 * Phrases that promise the paid figures in exchange for an email.
 *
 * Deliberately narrow. "findings" alone is NOT banned — lib/leadEmail.ts's
 * subject line uses it correctly ("Your {Brand} findings"), the nurture track
 * is named brand_findings, and a lint that fires on the word would be red
 * across files it has no business touching. What is banned is the pairing of
 * the LOCKED/paid framing with the free ask. That pairing is the lie.
 */
const BANNED: Array<{ re: RegExp; why: string }> = [
  {
    re: /locked findings/i,
    why: '"locked findings" promises the paid figures; the email sends category language only',
  },
  {
    re: /unlock[^.!?]{0,40}\bfree\b/i,
    why: '"unlock ... free" trades the paid product for an email address',
  },
  {
    re: /\bfree\b[^.!?]{0,30}\b(?:report|full report)\b/i,
    why: 'offering the "report" free — the report is the $199 product',
  },
];

// THE COMMENT-BLIND LINT, already learned once in lib/glassSeam.test.ts. Every
// file in SURFACE_FILES documents WHY the banned phrasing was retired, and those
// explanations quote it. A lint that reads its own documentation as a violation
// punishes the files that took the trouble to explain themselves, and the fix a
// hurried reader reaches for is deleting the explanation. The walk lives in
// lib/stripComments.ts; strings are skipped, not blanked, because the copy being
// measured IS the string literals.

describe("THE PROMISE LINT", () => {
  const sources = SURFACE_FILES.map((f) => ({
    file: f,
    raw: readFileSync(join(process.cwd(), f), "utf8"),
  }));

  it("the files it guards exist and have content", () => {
    // THE ALWAYS-PASSING VERIFIER. A renamed file would make every assertion
    // below vacuously true, and this lint would pass loudest at the moment it
    // stopped guarding anything.
    expect(sources.length).toBe(SURFACE_FILES.length);
    for (const { file, raw } of sources) {
      expect(raw.length, `${file} is empty`).toBeGreaterThan(500);
    }
  });

  it("stripComments keeps copy and drops prose", () => {
    /* Both directions. Under-strip and the retirement notes in these files
       report themselves as violations. Over-strip and every string vanishes,
       nothing matches, and the lint reports green forever — the silent
       failure, so it gets the explicit control. */
    const sample = [
      'const h = "Get the locked findings — free, by email.";',
      '// we retired "locked findings" because it overpromised',
      '/* the old line was "locked findings" */',
      'const ok = "Email me the questions";',
    ].join("\n");
    const stripped = stripComments(sample);
    expect((stripped.match(/locked findings/g) ?? []).length).toBe(1); // under-strip guard
    expect(stripped).toContain("Email me the questions"); // over-strip guard
  });

  it("no capture surface promises the paid figures in exchange for an email", () => {
    const offenders: string[] = [];
    for (const { file, raw } of sources) {
      const code = stripComments(raw);
      for (const { re, why } of BANNED) {
        for (const m of code.matchAll(new RegExp(re.source, re.flags + "g"))) {
          const line = code.slice(0, m.index).split("\n").length;
          offenders.push(`${file}:${line} — "${m[0].trim()}" → ${why}`);
        }
      }
    }
    expect(
      offenders,
      "A capture surface is offering the paid product for an email address. " +
        "lib/leadEmail.ts sends category and severity language and never a " +
        "dollar figure, so this headline cannot be kept — and on the glass " +
        "page it sits inches from the $199 CTA. Sell the 12 questions: that " +
        "is what the email actually contains.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the ban is real — it fires on the line that was retired", () => {
    // A mutation test, inline. Without this, a typo in BANNED leaves the whole
    // lint green and nobody finds out.
    const relapse = 'h: "Get the locked findings — free, by email.",';
    const hits = BANNED.filter((b) => b.re.test(relapse));
    expect(hits.length, "BANNED no longer matches the retired headline").toBeGreaterThan(0);
  });
});
