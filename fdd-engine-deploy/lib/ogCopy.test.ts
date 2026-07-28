// lib/ogCopy.test.ts — the gate on what a preview card is allowed to say.
//
// These aren't cosmetic assertions. An OG image is fetched by an unauthenticated
// third party and cached on their servers indefinitely; there is no way to
// un-publish one. So the rules that keep locked text off a card have to fail in
// CI, not in someone's Slack.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  brandOgSpec,
  retractedOgSpec,
  reportOgSpec,
  compareOgSpec,
  homeOgSpec,
  libraryOgSpec,
  sampleOgSpec,
  playbookOgSpec,
  refundsOgSpec,
  fallbackOgSpec,
  ogUsd,
  clamp,
  ogTitleSize,
  OG_CAVEAT_MAX,
  OG_SIZE,
  type OgCardSpec,
  type OgBrandFacts,
} from "./ogCopy";
import { toCard, retractionOf, type BrandRecord } from "./brands";
import { verifyPhrase } from "./verify";
import { REFUND_HEADLINE } from "./refund";
import { RETRACTION_HEADLINE } from "./retraction";

const BRAND_DIR = path.join(process.cwd(), "data", "brands");

async function loadAll(): Promise<BrandRecord[]> {
  const files = (await fs.readdir(BRAND_DIR)).filter((f) => f.endsWith(".json"));
  const out: BrandRecord[] = [];
  for (const f of files) {
    out.push(JSON.parse(await fs.readFile(path.join(BRAND_DIR, f), "utf8")) as BrandRecord);
  }
  return out;
}

/** Every riskReasons string anywhere in a record, at any nesting depth. */
function collectReasons(node: unknown, sink: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const v of node) collectReasons(v, sink);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "riskReasons" && Array.isArray(v)) sink.push(...v.map(String));
      else collectReasons(v, sink);
    }
  }
  return sink;
}

/** Everything a card would render, as one string. */
function specText(s: OgCardSpec): string {
  return [
    s.eyebrow,
    s.title,
    s.blurb,
    s.footer,
    ...s.stats.flatMap((t) => [t.value, t.label, t.sub ?? ""]),
  ].join(" | ");
}

const STATIC_SPECS: Array<[string, OgCardSpec]> = [
  ["home", homeOgSpec(83)],
  ["library", libraryOgSpec(83, 11)],
  ["sample", sampleOgSpec()],
  ["playbook", playbookOgSpec()],
  ["refunds", refundsOgSpec()],
  ["report", reportOgSpec()],
  ["fallback", fallbackOgSpec()],
  ["compare", compareOgSpec("Anytime Fitness", "Planet Fitness")],
  ["retracted", retractedOgSpec("Speedy Freight")],
];

// ---------------------------------------------------------------------------
// The two structural guarantees
// ---------------------------------------------------------------------------

describe("structural gating", () => {
  it("reportOgSpec takes zero arguments — a per-buyer card cannot leak what it cannot receive", () => {
    // If someone adds a params-carrying argument, this fails before the image
    // ever renders. The arity IS the guarantee; do not relax this test.
    expect(reportOgSpec.length).toBe(0);
  });

  it("the report card names no brand and carries no stats", () => {
    const s = reportOgSpec();
    expect(s.stats).toEqual([]);
    expect(specText(s)).not.toMatch(/\$/);
  });

  it("brandOgSpec throws for every retracted brand in the real store", async () => {
    const brands = await loadAll();
    const pulled = brands.filter((b) => retractionOf(b) !== null);
    // The corpus may legitimately have zero retractions on any given day, so
    // this also runs against a synthetic one — the rule must hold either way.
    for (const b of pulled) {
      expect(() => brandOgSpec(toCard(b))).toThrow(/retracted/i);
    }
    const fake: OgBrandFacts = {
      brandName: "Pulled Brand",
      vertical: "Fitness",
      lo: 100_000,
      hi: 300_000,
      buildoutMid: null,
      mo: 42_000,
      moLabel: "average",
      moKind: "revenue",
      moBasis: "disclosed",
      moCaveat: null,
      mn: 40,
      verifyCount: 3,
      retracted: true,
    };
    expect(() => brandOgSpec(fake)).toThrow(/retractedOgSpec/);
  });

  it("retractedOgSpec cannot print a figure — it only receives a name", () => {
    const s = retractedOgSpec("Speedy Freight");
    expect(s.title).toBe(RETRACTION_HEADLINE);
    expect(s.stats).toEqual([]);
    expect(specText(s)).not.toMatch(/\$|\d+%/);
  });
});

// ---------------------------------------------------------------------------
// Corpus-wide leak check
// ---------------------------------------------------------------------------

describe("no locked text reaches a card", () => {
  it("no riskReasons fragment appears in any live brand's spec", async () => {
    const brands = await loadAll();
    const leaks: string[] = [];
    let checked = 0;
    for (const b of brands) {
      const card = toCard(b);
      if (!card.live || retractionOf(b)) continue;
      checked++;
      const text = specText(brandOgSpec(card)).toLowerCase();
      for (const reason of collectReasons(b)) {
        // Substrings long enough to be distinctive; a 12-char window catches
        // "above-market" and "net worth of" without flagging "the fee".
        for (let i = 0; i + 12 <= reason.length; i += 6) {
          const frag = reason.slice(i, i + 12).toLowerCase().trim();
          if (frag.length >= 12 && text.includes(frag)) {
            leaks.push(`${b.slug}: "${frag}"`);
            break;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(leaks).toEqual([]);
  });

  it("every live brand's spec builds and names a noun for every figure", async () => {
    const brands = await loadAll();
    for (const b of brands) {
      const card = toCard(b);
      if (!card.live || retractionOf(b)) continue;
      const s = brandOgSpec(card);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.stats.length).toBeGreaterThan(0);
      for (const stat of s.stats) {
        // LABEL LAW: never a naked number.
        expect(stat.label.trim().length).toBeGreaterThan(0);
        expect(stat.value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("no static card carries a figure it has no page to qualify", () => {
    for (const [name, s] of STATIC_SPECS) {
      if (name === "home" || name === "library") continue; // brand/vertical counts only
      expect(specText(s), name).not.toMatch(/\$\d/);
    }
  });
});

// ---------------------------------------------------------------------------
// LABEL LAW on the verify stat
// ---------------------------------------------------------------------------

describe("the verify stat is verifyPhrase(), split — not re-pluralized", () => {
  it("recomposes to exactly verifyPhrase(n) for every live brand", async () => {
    const brands = await loadAll();
    for (const b of brands) {
      const card = toCard(b);
      if (!card.live || retractionOf(b)) continue;
      const stat = brandOgSpec(card).stats.find((s) => /to verify$/.test(s.label));
      expect(stat, b.slug).toBeTruthy();
      expect(`${stat!.value} ${stat!.label}`).toBe(verifyPhrase(card.verifyCount));
    }
  });

  it("says 'thing' at one and 'things' above it", () => {
    const base: OgBrandFacts = {
      brandName: "Test Brand",
      vertical: "Fitness",
      lo: null,
      hi: null,
      buildoutMid: null,
      mo: null,
      moLabel: "average",
      moKind: null,
      moBasis: "disclosed",
      moCaveat: null,
      mn: null,
      verifyCount: 1,
      retracted: false,
    };
    expect(brandOgSpec(base).stats[0].label).toBe("thing to verify");
    expect(brandOgSpec({ ...base, verifyCount: 4 }).stats[0].label).toBe("things to verify");
  });
});

// ---------------------------------------------------------------------------
// The caveat drop rule
// ---------------------------------------------------------------------------

describe("an honesty caveat is never truncated", () => {
  const withCaveat = (moCaveat: string | null): OgBrandFacts => ({
    brandName: "Test Brand",
    vertical: "Fitness",
    lo: 100_000,
    hi: 300_000,
    buildoutMid: null,
    mo: 41_000,
    moLabel: "average",
    moKind: "revenue",
    moBasis: "disclosed",
    moCaveat,
    mn: 40,
    verifyCount: 3,
    retracted: false,
  });

  it("keeps the hero when the caveat fits", () => {
    const s = brandOgSpec(withCaveat("top quartile only"));
    expect(s.stats.some((t) => t.value.endsWith("/mo"))).toBe(true);
    expect(s.stats.find((t) => t.value.endsWith("/mo"))!.sub).toBe("top quartile only");
  });

  it("drops the whole hero rather than clip a long caveat", () => {
    const long = "x".repeat(OG_CAVEAT_MAX + 1);
    const s = brandOgSpec(withCaveat(long));
    expect(s.stats.some((t) => t.value.endsWith("/mo"))).toBe(false);
    expect(specText(s)).not.toContain("…");
  });

  it("never renders a hero figure with no kind", () => {
    const f = { ...withCaveat(null), moKind: null as OgBrandFacts["moKind"] };
    expect(brandOgSpec(f).stats.some((t) => t.value.endsWith("/mo"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("formatting", () => {
  it("ogUsd matches the compact form the brand page uses", () => {
    expect(ogUsd(94_930)).toBe("$95k");
    expect(ogUsd(1_250_000)).toBe("$1.3M");
    expect(ogUsd(1_000_000)).toBe("$1.0M");
    expect(ogUsd(0)).toBe("$0k");
  });

  it("clamp cuts on a word boundary when there is a sensible one", () => {
    expect(clamp("Anytime Fitness", 40)).toBe("Anytime Fitness");
    expect(clamp("Anytime Fitness Express Holdings", 20)).toBe("Anytime Fitness…");
    // Boundary too early to be worth honoring (past it we'd lose 40% of the
    // room): hard cut instead, because "The Original…" tells a reader less than
    // "The Original Soupma…" does.
    expect(clamp("The Original Soupman Franchise Group", 20)).toBe("The Original Soupma…");
    // No space at all: hard cut rather than lose the string.
    expect(clamp("Supercalifragilisticexpialidocious", 12)).toBe("Supercalifr…");
    expect(clamp("abc", 3)).toBe("abc");
  });

  it("clamp never returns more characters than it was given room for", () => {
    for (const s of ["a".repeat(80), "word ".repeat(20), "Sharkey's Cuts for Kids"]) {
      for (const max of [10, 26, 40, 44]) {
        expect(clamp(s, max).length).toBeLessThanOrEqual(max);
      }
    }
  });

  it("title size shrinks instead of wrapping to three lines", () => {
    expect(ogTitleSize("Crumbl")).toBe(70);
    expect(ogTitleSize("a".repeat(30))).toBe(58);
    expect(ogTitleSize("a".repeat(44))).toBe(48);
  });

  it("is the one size every scraper renders", () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
  });
});

// ---------------------------------------------------------------------------
// Copy that must move with its source
// ---------------------------------------------------------------------------

describe("cards are built from the single-source modules, not retyped", () => {
  it("the refunds card quotes lib/refund.ts", () => {
    expect(refundsOgSpec().title).toBe(REFUND_HEADLINE);
    // A window number hardcoded here would survive a policy change and become
    // an offer we have to honor from someone's cached screenshot.
    expect(refundsOgSpec().title).toMatch(/\d+-day/);
  });

  it("the retraction card quotes lib/retraction.ts", () => {
    expect(retractedOgSpec("Whatever").title).toBe(RETRACTION_HEADLINE);
  });

  it("no static card says 'audit' or 'inflated' (banned phrases)", () => {
    for (const [name, s] of STATIC_SPECS) {
      expect(specText(s).toLowerCase(), name).not.toContain("our audit");
      expect(specText(s).toLowerCase(), name).not.toContain("inflated");
    }
  });

  it("every spec has a footer and a non-empty title", () => {
    for (const [name, s] of STATIC_SPECS) {
      expect(s.footer.length, name).toBeGreaterThan(0);
      expect(s.title.length, name).toBeGreaterThan(0);
      expect(s.blurb.length, name).toBeGreaterThan(0);
    }
  });
});
