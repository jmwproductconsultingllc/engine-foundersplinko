// lib/retraction.test.ts — the RETRACTION CONTRACT.
//
// A retraction is a rare path, which is exactly why it needs tests. It will be
// exercised for the first time on a live brand, under time pressure, by someone
// who has just discovered a wrong number and wants it down in the next five
// minutes. Every one of these assertions is a thing that would fail silently in
// that moment and only be noticed later, by a stranger, on the internet:
//
//   · the resolver forgets to force live=false → the pulled brand stays in the
//     library, the sitemap and the count, and the retraction is decorative
//   · the grid drops the card but the ghost universe re-adds the NAME → the
//     brand reappears as an "FDD pending" tile we invite clicks on
//   · generateStaticParams filters on live → the URL 404s and the whole
//     "visible, named" decision is undone by one filter
//   · the notice leaks a figure → we republish the number we just retracted
//
// The corpus assertions run against the real store, so they also serve as a
// canary: if a retraction is ever committed by accident, the count moves.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  isRetracted,
  retractionOf,
  retractionCopy,
  formatRetractionDate,
  RETRACTION_HEADLINE,
  type Retraction,
} from "./retraction";
import { resolveBrandFacts } from "./brandFacts";
import { toCard, type BrandRecord } from "./brands";

const ROOT = process.cwd();
const BRAND_DIR = path.join(ROOT, "data", "brands");

function loadAll(): BrandRecord[] {
  return readdirSync(BRAND_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(BRAND_DIR, f), "utf8")) as BrandRecord);
}

/** A real record from the store, pulled in memory. Never written to disk. */
function retract(b: BrandRecord, r: Partial<Retraction> = {}): BrandRecord {
  return {
    ...b,
    retraction: { retractedAt: "2026-07-28", figure: "the disclosed royalty rate", ...r },
  };
}

const RETRACTION: Retraction = {
  retractedAt: "2026-07-28",
  figure: "the disclosed royalty rate",
  detail: "Item 6 was read from the transfer-fee column",
  internal: "extractor column drift — see batch 4 log",
};

describe("retractionOf — a half-written retraction must not half-pull a brand", () => {
  it("reads a complete retraction", () => {
    expect(retractionOf({ retraction: RETRACTION })?.figure).toBe("the disclosed royalty rate");
    expect(isRetracted({ retraction: RETRACTION })).toBe(true);
  });

  it("ignores absent, null, and empty", () => {
    expect(isRetracted(undefined)).toBe(false);
    expect(isRetracted(null)).toBe(false);
    expect(isRetracted({})).toBe(false);
    expect(isRetracted({ retraction: null })).toBe(false);
  });

  it("ignores a retraction missing the fields the notice needs", () => {
    // Rather than render "We pulled this record · undefined".
    expect(isRetracted({ retraction: { retractedAt: "2026-07-28" } as Retraction })).toBe(false);
    expect(isRetracted({ retraction: { figure: "the royalty" } as Retraction })).toBe(false);
    expect(isRetracted({ retraction: { retractedAt: "", figure: "" } })).toBe(false);
  });
});

describe("formatRetractionDate", () => {
  it("does not shift the day across timezones", () => {
    // new Date("2026-07-28") is UTC midnight; rendered in any US timezone with
    // toLocaleDateString it reads July 27. Hence the manual parse.
    expect(formatRetractionDate("2026-07-28")).toBe("July 28, 2026");
    expect(formatRetractionDate("2026-01-01")).toBe("January 1, 2026");
  });

  it("passes through anything it can't parse rather than printing Invalid Date", () => {
    expect(formatRetractionDate("soon")).toBe("soon");
  });
});

describe("retractionCopy", () => {
  const copy = retractionCopy("Speedy Freight", RETRACTION);

  it("names it a retraction, in the first person, unhedged", () => {
    expect(copy.headline).toBe(RETRACTION_HEADLINE);
    expect(copy.headline.toLowerCase()).toContain("pulled");
    // The explicitly rejected alternative. "Under review" is the weasel version.
    expect(JSON.stringify(copy).toLowerCase()).not.toContain("under review");
  });

  it("says which figure and when", () => {
    expect(copy.dateLine).toContain("Speedy Freight");
    expect(copy.dateLine).toContain("July 28, 2026");
    expect(copy.paragraphs[0]).toContain("the disclosed royalty rate");
    expect(copy.paragraphs[0]).toContain("Item 6 was read from the transfer-fee column");
  });

  it("puts the failure on us, not on the franchisor", () => {
    const all = copy.paragraphs.join(" ");
    expect(all).toContain("our error");
    expect(all.toLowerCase()).toContain("not the franchisor");
  });

  it("never renders the internal note", () => {
    expect(JSON.stringify(copy)).not.toContain("batch 4 log");
    expect(JSON.stringify(copy)).not.toContain("column drift");
  });

  it("tells a buyer who already paid what happens", () => {
    expect(copy.paragraphs.join(" ").toLowerCase()).toContain("refund");
  });
});

describe("the live gate — one flip, every surface", () => {
  const brands = loadAll();
  const subject = brands.find((b) => toCard(b).live);

  it("the corpus has a live brand to test against", () => {
    expect(subject).toBeTruthy();
  });

  it("forces live=false at the single resolver", () => {
    const f = resolveBrandFacts(subject!);
    expect(f.live).toBe(true);
    expect(f.retracted).toBe(false);

    const g = resolveBrandFacts(retract(subject!));
    expect(g.live).toBe(false);
    expect(g.retracted).toBe(true);
  });

  it("projects onto the card so the grid can suppress it", () => {
    expect(toCard(retract(subject!)).retracted).toBe(true);
    expect(toCard(retract(subject!)).live).toBe(false);
  });

  it("drops out of anything that counts live brands", () => {
    // liveBrandCount(), the sitemap, compare pairs, the capital-fit email and
    // the risk-benchmark denominator all gate on exactly this boolean.
    const before = brands.map((b) => toCard(b)).filter((c) => c.live).length;
    const after = brands
      .map((b) => (b.slug === subject!.slug ? retract(b) : b))
      .map((b) => toCard(b))
      .filter((c) => c.live).length;
    expect(after).toBe(before - 1);
  });
});

describe("the store is clean", () => {
  it("has no retracted records committed right now", () => {
    // Not a rule — a canary. If this fails, someone retracted a brand; check the
    // diff and confirm it was on purpose before shipping.
    const pulled = loadAll().filter((b) => isRetracted(b)).map((b) => b.slug);
    expect(pulled).toEqual([]);
  });
});

describe("page wiring — the parts a unit test can't render", () => {
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("generateStaticParams re-admits retracted slugs", () => {
    // Without this the URL 404s and the whole design is defeated by one filter.
    const src = read("app/franchise/[slug]/page.tsx");
    expect(src).toMatch(/\.live \|\| retractionOf\(b\) !== null/);
  });

  it("the retraction check precedes the live gate on the brand page", () => {
    const src = read("app/franchise/[slug]/page.tsx");
    const check = src.indexOf("const pulled = retractionOf(brand)");
    const gate = src.indexOf("if (!card.live) notFound()");
    expect(check).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(check).toBeLessThan(gate);
  });

  it("the notice is noindex", () => {
    expect(read("app/franchise/[slug]/page.tsx")).toMatch(/robots:\s*\{\s*index:\s*false/);
  });

  it("the notice component can only receive a name and a retraction", () => {
    // Structural gating: props that can't carry a figure beat a rule saying
    // don't render one. If this test fails, someone widened the props — check
    // that whatever was added can't be a number off the pulled record.
    const src = read("components/RetractionNotice.tsx");
    const props = /\}: \{([\s\S]*?)\}\) \{/.exec(src)?.[1] ?? "";
    expect(props).toContain("brandName: string");
    expect(props).toContain("retraction: Retraction");
    expect(props.split(";").filter((s) => s.trim()).length).toBe(2);
  });

  it("the grid computes inStore before dropping retracted cards", () => {
    // Ordering bug: drop first and a pulled brand returns as a ghost tile.
    const src = read("lib/brands.ts");
    const inStore = src.indexOf("const inStore = new Set(inCat");
    const visible = src.indexOf("const visible = inCat.filter((c) => !c.retracted)");
    expect(inStore).toBeGreaterThan(-1);
    expect(visible).toBeGreaterThan(-1);
    expect(inStore).toBeLessThan(visible);
  });

  it("a regeneration cannot silently un-retract a brand", () => {
    const src = read("scripts/jsonl-to-brands.ts");
    expect(src).toContain("carriedRetraction");
    expect(src).toMatch(/retraction: carriedRetraction/);
  });

  it("compare pages redirect to the notice instead of 404ing", () => {
    const src = read("app/compare/[pair]/page.tsx");
    expect(src).toMatch(/if \(isRetracted\(A\)\) redirect\(`\/franchise\/\$\{A\.slug\}`\)/);
    // Must NOT be permanentRedirect — the comparison comes back.
    expect(src).not.toMatch(/isRetracted\(A\)\) permanentRedirect/);
  });
});
