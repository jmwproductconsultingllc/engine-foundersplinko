// lib/registry.test.ts — THE REGISTRY LINT.
//
// REGISTRY in scripts/jsonl-to-brands.ts is the identity source: stem → slug +
// category + vertical + sourceFddYear. It mints permanent public URLs, and
// almost every way it can be wrong is SILENT:
//
//   • two stems claiming one slug        → the second batch row overwrites the first
//   • a vertical not in VERTICAL_ORDER   → the brand never renders a row on /brands
//   • a Kids category off CATEGORY_ORDER → the tile never renders
//   • a slug with a capital or a space   → a URL that 404s
//
// None of those throw. None are visible to tsc. They present as "the brand just
// didn't show up," which reads as an extraction problem and gets debugged in the
// wrong file. So they get a lint.
//
// This file also pins something structural: importing the converter must have NO
// SIDE EFFECTS. scripts/jsonl-to-brands.ts used to call main() unguarded at
// module scope, so the moment scripts/registerBrand.ts imported REGISTRY the
// import itself would run the converter and process.exit(1) on missing argv —
// killing the caller with a usage message about a file it never meant to
// convert. If that guard is ever removed, this file dies at import and says so.

import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY } from "../scripts/jsonl-to-brands";
import { slugify } from "../scripts/registerBrand";
import { CATEGORY_ORDER, KIDS_VERTICAL, VERTICAL_ORDER } from "./brands";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Categories deliberately outside the Kids closed list. "kona ice" predates the
// multi-vertical taxonomy: it is logged by the converter but never rendered, and
// it is pinned here so a future cleanup notices it on purpose rather than by
// tripping a test.
const OFF_TAXONOMY_STEMS = new Set(["kona ice"]);

describe("THE REGISTRY LINT", () => {
  const entries = Object.entries(REGISTRY);

  it("imports the converter without executing it", () => {
    // If the direct-execution guard regresses, this file never gets here — the
    // import calls main() and exits the vitest worker. The floor also catches
    // the lint's own failure mode: an empty registry passing every other test.
    expect(entries.length).toBeGreaterThan(30);
  });

  it("every stem is lowercase (the converter lowercases the batch filename before lookup)", () => {
    for (const [stem] of entries) expect(stem).toBe(stem.toLowerCase());
  });

  it("every slug is a legal URL slug", () => {
    for (const [stem, e] of entries) {
      expect(SLUG_RE.test(e.slug), `${stem} → "${e.slug}"`).toBe(true);
    }
  });

  it("no two stems claim the same slug", () => {
    const bySlug = new Map<string, string[]>();
    for (const [stem, e] of entries) {
      bySlug.set(e.slug, [...(bySlug.get(e.slug) ?? []), stem]);
    }
    const dupes = [...bySlug.entries()].filter(([, stems]) => stems.length > 1);
    expect(dupes.map(([slug, stems]) => `${slug} ← ${stems.join(", ")}`)).toEqual([]);
  });

  it("every vertical is one VERTICAL_ORDER renders", () => {
    for (const [stem, e] of entries) {
      const v = e.vertical ?? KIDS_VERTICAL; // absent means Kids by design
      expect(VERTICAL_ORDER.includes(v), `${stem} → "${v}"`).toBe(true);
    }
  });

  it("every Kids & Family category is on the closed subcategory list", () => {
    for (const [stem, e] of entries) {
      if (OFF_TAXONOMY_STEMS.has(stem)) continue;
      const v = e.vertical ?? KIDS_VERTICAL;
      if (v !== KIDS_VERTICAL) continue;
      expect(CATEGORY_ORDER.includes(e.category), `${stem} → "${e.category}"`).toBe(true);
    }
  });

  it("no category is empty", () => {
    for (const [stem, e] of entries) expect(e.category.trim().length, stem).toBeGreaterThan(0);
  });

  it("sourceFddYear is a plausible FDD year or null — never a guess", () => {
    for (const [stem, e] of entries) {
      if (e.sourceFddYear == null) continue;
      expect(Number.isInteger(e.sourceFddYear), stem).toBe(true);
      expect(e.sourceFddYear, stem).toBeGreaterThanOrEqual(1990);
      expect(e.sourceFddYear, stem).toBeLessThanOrEqual(new Date().getFullYear() + 1);
    }
  });

  it("every registered slug that has a catalog file matches it exactly", () => {
    // Case or hyphenation drift between the registry and the files on disk is
    // how a batch run mints a SECOND file for a brand that already has one.
    const onDisk = new Set(
      readdirSync(join(process.cwd(), "data", "brands"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "")),
    );
    expect(onDisk.size).toBeGreaterThan(50);
    for (const [stem, e] of entries) {
      if (!onDisk.has(e.slug)) continue; // not yet extracted — a ghost, not an error
      expect(e.slug, stem).toBe(e.slug.toLowerCase());
    }
  });
});

describe("slugify reproduces the conventions already live in the catalog", () => {
  // These are the two that a "sensible" slugifier gets wrong. Both are LIVE
  // URLs, so a rule change here orphans them.
  it("splits on an apostrophe rather than deleting it", () => {
    expect(slugify("Sharkey's Cuts For Kids")).toBe("sharkey-s-cuts-for-kids");
  });

  it("collapses ' & ' to a single hyphen", () => {
    expect(slugify("Pigtails & Crewcuts")).toBe("pigtails-crewcuts");
    expect(slugify("Learning Express Toys & Gifts")).toBe("learning-express-toys-gifts");
  });

  it("round-trips the plain cases", () => {
    expect(slugify("Soccer Shots")).toBe("soccer-shots");
    expect(slugify("i9 Sports")).toBe("i9-sports");
    expect(slugify("The Goddard School")).toBe("the-goddard-school");
    expect(slugify("  Kona Ice  ")).toBe("kona-ice");
  });

  it("never emits a slug the URL rules reject", () => {
    for (const s of ["Sharkey's Cuts For Kids", "Pigtails & Crewcuts", "360° Painting", "Aire Serv®"]) {
      expect(SLUG_RE.test(slugify(s)), s).toBe(true);
    }
  });
});
