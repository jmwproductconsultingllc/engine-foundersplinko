// lib/brandName.test.ts — the article laws, asserted against the REAL corpus.
//
// Why a test and not a code review: this is a class of bug that ships silently.
// "a Anytime Fitness franchisee" is grammatically wrong on a page asking for
// $199, but it never throws, never fails a build, and reads fine in a diff —
// you only catch it by rendering one of the 19 affected brands. So the corpus
// sweep below is the guard: add a brand starting with a vowel and this test
// tells you whether the article resolver handled it, before it hits a page.
//
// TWO SEPARATE LAWS, easy to confuse:
//   bareName()   — for copy that supplies a DEFINITE article ("the full X report")
//   withArticle()— for copy that supplies an INDEFINITE one ("ask a/an X franchisee")

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { bareName, indefiniteArticle, withArticle } from "./brandName";

const BRAND_DIR = path.join(process.cwd(), "data", "brands");

function corpusNames(): string[] {
  return readdirSync(BRAND_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(path.join(BRAND_DIR, f), "utf8")).brandName as string;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

describe("bareName", () => {
  it("strips a leading article, case-insensitively", () => {
    expect(bareName("The UPS Store")).toBe("UPS Store");
    expect(bareName("the Little Gym")).toBe("Little Gym");
    expect(bareName("An Example Brand")).toBe("Example Brand");
  });

  it("leaves names that merely START with those letters alone", () => {
    // "Theo", "Anytime" and "Alloy" are not articles. A regex without the \s+
    // would maul all three.
    expect(bareName("Anytime Fitness")).toBe("Anytime Fitness");
    expect(bareName("Alloy Personal Training")).toBe("Alloy Personal Training");
    expect(bareName("Theo's Pizza")).toBe("Theo's Pizza");
  });
});

describe("indefiniteArticle — sound, not spelling", () => {
  it("handles the plain cases", () => {
    expect(indefiniteArticle("Crumbl")).toBe("a");
    expect(indefiniteArticle("Anytime Fitness")).toBe("an");
    expect(indefiniteArticle("Ellie Mental Health")).toBe("an");
    expect(indefiniteArticle("Ultimate Longevity Center")).toBe("an");
  });

  it("strips the article before deciding", () => {
    // The decision must be made on "Exercise", not on "The".
    expect(indefiniteArticle("The Exercise Coach")).toBe("an");
    expect(indefiniteArticle("The Original Rainbow Cone")).toBe("an");
    expect(indefiniteArticle("The Goddard School")).toBe("a");
  });

  it("gets the three real corpus pronunciation traps right", () => {
    // U read as "yoo" in an initialism.
    expect(indefiniteArticle("The UPS Store")).toBe("a");
    // O read as "wun".
    expect(indefiniteArticle("Once Upon A Child")).toBe("a");
    // ...but a plain vowel U still takes "an". This is the pair that makes a
    // blanket "U always takes a" rule wrong.
    expect(indefiniteArticle("Urban Air Adventure Park")).toBe("an");
  });

  it("distinguishes initialisms from pronounceable all-caps words", () => {
    expect(indefiniteArticle("SPENGA")).toBe("a"); // said "spen-ga"
    expect(indefiniteArticle("IMAGE Studios")).toBe("an"); // said "image"
    expect(indefiniteArticle("JAN-PRO")).toBe("a");
    expect(indefiniteArticle("DDH")).toBe("a"); // "dee-dee-aitch"
    expect(indefiniteArticle("MRI Clinics")).toBe("an"); // "em-ar-eye"
    expect(indefiniteArticle("FBS")).toBe("an"); // "ef-bee-es"
  });

  it("handles the silent-h and euro- classes", () => {
    expect(indefiniteArticle("Hour Glass Cleaning")).toBe("an");
    expect(indefiniteArticle("Honest Plumbers")).toBe("an");
    expect(indefiniteArticle("Hallmark Homecare")).toBe("a");
    expect(indefiniteArticle("European Wax")).toBe("a");
    expect(indefiniteArticle("United Franchise")).toBe("a");
    expect(indefiniteArticle("Unique Fitness")).toBe("a");
  });

  it("never returns anything but a or an, for any brand in the corpus", () => {
    const names = corpusNames();
    expect(names.length).toBeGreaterThan(50); // sanity: the corpus actually loaded
    for (const n of names) {
      expect(["a", "an"]).toContain(indefiniteArticle(n));
    }
  });
});

describe("withArticle", () => {
  it("emits the whole phrase with the article stripped from the name", () => {
    expect(withArticle("The UPS Store")).toBe("a UPS Store");
    expect(withArticle("Anytime Fitness")).toBe("an Anytime Fitness");
    expect(withArticle("Crumbl")).toBe("a Crumbl");
  });

  it("never doubles an article for any brand in the corpus", () => {
    // The failure this catches: "a The UPS Store franchisee".
    for (const n of corpusNames()) {
      expect(withArticle(n)).not.toMatch(/^an? (the|a|an)\s/i);
    }
  });
});

describe("EmailCapture copy contract", () => {
  // The bug lived in a template literal, so the earlier JSX sweep for
  // `{brandName}` never saw it. This asserts on the source text directly.
  const raw = readFileSync(path.join(process.cwd(), "components", "EmailCapture.tsx"), "utf8");
  // Strip comments first — the warning comment above the copy table quotes the
  // very pattern this test bans, and would otherwise fail it.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("never writes a bare article in front of the {Brand} token", () => {
    // Matches "a {Brand}" / "an {Brand}" / "the {Brand}" in the copy table.
    const offenders = src.match(/\b(a|an|the)\s+\{Brand\}/gi) ?? [];
    expect(offenders).toEqual([]);
  });

  it("uses {AnBrand} where an indefinite article is needed", () => {
    expect(src).toContain("{AnBrand} franchisee");
  });
});
