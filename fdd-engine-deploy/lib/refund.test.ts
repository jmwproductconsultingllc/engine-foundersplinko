// lib/refund.test.ts — the GUARANTEE LINT.
//
// Two failure modes, both of which have already happened to us once in another
// form (the brand count said "80+" in three places and "70+" in a fourth), and
// both of which are worse here because money is attached:
//
//  1. A PRICE SURFACE SHIPS WITHOUT THE GUARANTEE. Someone adds a fifth place to
//     buy, or refactors one of the four, and the note quietly falls off. The
//     page still converts, nothing throws, and the only signal is a conversion
//     rate slightly worse than it should be — which is invisible at our volume.
//     So the four known price surfaces are asserted by name. Adding a fifth is
//     a deliberate act: you add it to this list.
//
//  2. A SECOND WINDOW APPEARS. Copy that says "30-day money-back" anywhere —
//     a meta description, an email template, a Stripe product blurb pasted into
//     a component — is not a typo, it is an offer. In a chargeback the buyer
//     screenshots whichever window is longer and the card network reads that as
//     the terms. So: the number lives in lib/refund.ts and NOWHERE else, and
//     this lint fails the build if a competing one shows up in source.
//
// Comments are stripped before scanning. The rationale in lib/refund.ts and the
// warning comment on the /refunds meta description both quote "30 days" to
// explain why it must not be hardcoded, and a lint that can't tell prose from
// shipped copy is a lint people delete.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  REFUND_DAYS,
  REFUND_EMAIL,
  REFUND_HEADLINE,
  REFUND_HREF,
  REFUND_POLICY,
  REFUND_SENTENCE,
  REFUND_SHORT,
} from "./refund";

const ROOT = process.cwd();

/** Every surface that shows a price and therefore owes the buyer the terms. */
const PRICE_SURFACES = [
  "components/BrandDetail.tsx", // the ask card on a brand page
  "components/BrandCTA.tsx", // the $199 block on brand / report / compare pages
  "components/InfographicTeaser.tsx", // the free-tier unlock CTA
  "app/sample/page.tsx", // the sample report's "run it on yours" block
];

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with block and line comments removed. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** All first-party .ts/.tsx under app/, components/ and lib/. */
function sourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    const walk = (d: string) => {
      for (const entry of readdirSync(path.join(ROOT, d))) {
        const rel = path.join(d, entry);
        const abs = path.join(ROOT, rel);
        if (statSync(abs).isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry)) out.push(rel);
      }
    };
    walk(dir);
  }
  return out;
}

describe("refund terms are single-sourced", () => {
  it("derives every string from REFUND_DAYS", () => {
    expect(REFUND_HEADLINE).toContain(String(REFUND_DAYS));
    expect(REFUND_SHORT).toContain(String(REFUND_DAYS));
    expect(REFUND_SENTENCE).toContain(String(REFUND_DAYS));
  });

  it("states the promise the way Jason approved it: no questions, no form", () => {
    // The load-bearing half. A guarantee with a process attached reads as one
    // you intend to make hard to claim.
    expect(REFUND_SENTENCE.toLowerCase()).toContain("no questions");
    expect(REFUND_SENTENCE.toLowerCase()).toContain("no form");
    expect(REFUND_SHORT.toLowerCase()).toContain("no questions");
  });

  it("keeps a real, non-placeholder contact address in the policy", () => {
    expect(REFUND_EMAIL).toMatch(/^[^@\s]+@foundersplinko\.com$/);
    expect(REFUND_POLICY[0].body).toContain(REFUND_EMAIL);
  });

  it("carries the sections a buyer and a card network both need", () => {
    const headings = REFUND_POLICY.map((s) => s.heading.toLowerCase());
    expect(REFUND_POLICY.length).toBeGreaterThanOrEqual(4);
    expect(headings.some((h) => h.includes("guarantee"))).toBe(true);
    // "What this doesn't cover" is the section that keeps the promise honest —
    // a refund policy is not a warranty on the franchisor's own numbers.
    expect(headings.some((h) => h.includes("cover"))).toBe(true);
  });
});

describe("the policy page exists at the href the note points to", () => {
  it("REFUND_HREF resolves to a real route", () => {
    // A guarantee whose "Full terms" link 404s is worse than no guarantee.
    const route = REFUND_HREF.replace(/^\//, "");
    expect(existsSync(path.join(ROOT, "app", route, "page.tsx"))).toBe(true);
  });

  it("renders the policy from the module rather than retyping it", () => {
    const src = read(`app${REFUND_HREF}/page.tsx`);
    expect(src).toContain("REFUND_POLICY");
    expect(src).toMatch(/from ["']@\/lib\/refund["']/);
  });

  it("is in the sitemap", () => {
    expect(read("app/sitemap.ts")).toContain(`/refunds`);
  });
});

describe("every price surface ships the guarantee", () => {
  for (const rel of PRICE_SURFACES) {
    it(`${rel} imports and renders RefundNote`, () => {
      const src = stripComments(read(rel));
      expect(src).toMatch(/import RefundNote from ["']@\/components\/RefundNote["']/);
      expect(src).toMatch(/<RefundNote\b/);
    });
  }
});

describe("no competing refund window anywhere in source", () => {
  // A day count only matters if it is next to refund language — "the 90-day
  // checklist" and "at least 14 days before you sign" are real copy elsewhere on
  // the site and must not trip this.
  const REFUND_WORDS = "refund|money[- ]back|guarantee|chargeback";
  const WINDOW = String.raw`\d+\s*[- ]?\s*days?`;
  const PATTERNS = [
    new RegExp(`(${REFUND_WORDS})[^.\\n]{0,60}?${WINDOW}`, "i"),
    new RegExp(`${WINDOW}[^.\\n]{0,60}?(${REFUND_WORDS})`, "i"),
  ];

  const files = sourceFiles().filter(
    (f) => f !== path.join("lib", "refund.ts") && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
  );

  it("scans a plausible number of files", () => {
    // Guard against the walk silently returning nothing and the lint passing
    // vacuously forever.
    expect(files.length).toBeGreaterThan(20);
  });

  it("finds no hardcoded window outside lib/refund.ts", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const src = stripComments(read(rel));
      for (const line of src.split("\n")) {
        if (PATTERNS.some((p) => p.test(line))) offenders.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
