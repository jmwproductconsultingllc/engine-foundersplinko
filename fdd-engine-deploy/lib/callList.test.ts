import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCallList, type CallListInput } from "./callList";
import { RANGE_SEP } from "./range";

// PATHS RESOLVE FROM THE REPO, NEVER FROM A MACHINE. These once read the
// authoring sandbox's absolute data dir literally — a path that exists on one
// machine on earth. Every assertion passed there and the whole FILE aborted in
// CI with EACCES before a single test in it ran, so the job printed
// "251 passed · 0 failed" next to a red X. A test that cannot run is not a
// passing test, and a green count beside a red job is worse than a red count.
// Held by THE PORTABILITY LINT in lib/portability.test.ts.
const BRANDS_DIR = join(process.cwd(), "data", "brands");

/**
 * THE VALIDATION LINT.
 *
 * "Validate with existing franchisees" is the one piece of advice every
 * diligence checklist ends on and nobody makes executable. This module is the
 * executable version, and it is built entirely from figures already persisted on
 * every record — so the thing most likely to go wrong is not arithmetic, it is
 * making a claim about a named human being that the FDD does not support.
 *
 * These tests exist to hold three lines:
 *   1. no zero-count cohort — where nothing moved, that is a sentence, not a "0"
 *   2. no performance claim ever attaches to a person or a false denominator
 *   3. no cohort ranks company-owned or net-income figures as franchisee sales
 */

// ── real records, as extracted, on disk ─────────────────────────────────────
const brand = (slug: string): CallListInput => {
  const e = JSON.parse(
    readFileSync(BRANDS_DIR + `/${slug}.json`, "utf8"),
  )?.result?.extracted;
  return {
    totalUnits: e?.systemScale?.totalUnits,
    closedLastYear: e?.systemScale?.closedLastYear,
    transfersLastYear: e?.systemScale?.transfersLastYear,
    item20Page: e?.systemScale?.sourcePage,
    cohorts: e?.item19?.cohorts,
    item19Page: e?.item19?.sourcePage,
  };
};

const cohort = (input: CallListInput, key: string) =>
  buildCallList(input).cohorts.find((c) => c.key === key);

describe("the cohorts a record can actually support", () => {
  it("builds all three from Tint World, which carries every input", () => {
    const cl = buildCallList(brand("tint-world"));
    expect(cl.available).toBe(true);
    expect(cl.cohorts.map((c) => c.key)).toEqual(["current", "departed", "tiers"]);
    expect(cl.unavailable).toBeNull();
  });

  it("drops the departed cohort rather than inventing one — Dunkin' has no counts", () => {
    const cl = buildCallList(brand("dunkin"));
    // 8,780 outlets and 281 openings on file; closures and transfers are null.
    expect(cl.cohorts.map((c) => c.key)).toEqual(["current", "tiers"]);
    expect(cl.available).toBe(true);
  });

  it("answers with words, not an empty section, when nothing supports a list", () => {
    for (const v of [null, undefined, {}, { totalUnits: 0 }]) {
      const cl = buildCallList(v as CallListInput);
      expect(cl.available).toBe(false);
      expect(cl.cohorts).toHaveLength(0);
      expect(cl.unavailable!.length).toBeGreaterThan(60);
      expect(cl.unavailable).toMatch(/Item 20/);
    }
  });
});

describe("a cohort with no data is absent, never empty", () => {
  it("never prints a zero count", () => {
    for (const f of readdirSync(BRANDS_DIR).filter((x) => x.endsWith(".json"))) {
      const cl = buildCallList(brand(f.replace(".json", "")));
      for (const c of cl.cohorts) {
        expect(c.count === null || c.count > 0, `${f} ${c.key} count=${c.count}`).toBe(true);
      }
    }
  });

  it("a clean year is a finding stated in words, not an empty card", () => {
    const c = cohort({ totalUnits: 300, closedLastYear: 0, transfersLastYear: 0 }, "departed")!;
    expect(c.count).toBeNull();
    expect(c.who).toMatch(/No outlet closed and none changed hands/);
    // and it does not let one clean year stand in for a clean record
    expect(c.who).toMatch(/two years ago/);
  });

  it("names the transfer-without-closure shape without characterising it", () => {
    const c = cohort(brand("stretch-zone"), "departed")!;
    expect(c.count).toBe(67);
    expect(c.who).toMatch(/No outlet closed, but 67 changed owners/);
    expect(c.who).toMatch(/cashed out or got out/);
  });

  it("counts departures as closures plus transfers", () => {
    expect(cohort(brand("crumbl"), "departed")!.count).toBe(91); // 9 + 82
    expect(cohort(brand("tint-world"), "departed")!.count).toBe(31); // 7 + 24
  });
});

describe("the exit reason is the first question, not a label we apply", () => {
  it("opens the departed call by asking how the exit happened", () => {
    const c = cohort(brand("crumbl"), "departed")!;
    expect(c.questions[0]).toMatch(/How did your exit actually happen/);
  });

  it("never asserts why anyone left, on any record in the corpus", () => {
    const banned = [
      /\bfailed\b/i, /\bwent under\b/i, /\bwas terminated\b/i,
      /\bstruggling\b/i, /\bunderperform/i, /\bunsuccessful\b/i,
    ];
    for (const f of readdirSync(BRANDS_DIR).filter((x) => x.endsWith(".json"))) {
      const cl = buildCallList(brand(f.replace(".json", "")));
      const who = cl.cohorts.map((c) => c.who).join(" ");
      for (const re of banned) {
        expect(who, `${f}: ${re}`).not.toMatch(re);
      }
    }
  });
});

describe("scale changes the instruction, not the cohort", () => {
  it("a short roster is read end to end", () => {
    const c = cohort({ totalUnits: 22 }, "current")!;
    expect(c.count).toBe(22);
    expect(c.who).toMatch(/short enough to read end to end/);
  });

  it("a long roster gets a filter, because 'call the list' is not advice at 8,780", () => {
    const c = cohort(brand("dunkin"), "current")!;
    expect(c.who).toMatch(/8,780/);
    expect(c.who).toMatch(/Do not work it in order/);
    expect(c.who).toMatch(/filter to your state/);
  });

  it("a mid-size system is filtered by market and recency", () => {
    const c = cohort(brand("tint-world"), "current")!;
    expect(c.who).toMatch(/149/);
    expect(c.who).toMatch(/markets like yours/);
  });

  it("points the buyer at their own copy of Item 20, with the page when we have it", () => {
    expect(cohort(brand("tint-world"), "current")!.where).toMatch(/Item 20, pp\. 55-60/);
    expect(cohort({ totalUnits: 50 }, "current")!.where).toMatch(/Item 20/);
  });
});

/**
 * THE COMPARABILITY LINT.
 *
 * Item 19 puts sales bands, EBITDA bands and company-owned figures in one array.
 * Ranking across those categories manufactures a spread out of a change in unit
 * of measure. Tint World is the live case and is pinned below.
 */
describe("only like is ranked against like", () => {
  it("never ranks an EBITDA band against a sales band — Tint World", () => {
    const c = cohort(brand("tint-world"), "tiers")!;
    // Its EBITDA bands run $94k–$265k annual, its sales bands $312k–$1.93M.
    // Mixing them would print a ~20x spread that is two units of measure.
    expect(c.who).toMatch(/\$160,456 a month/); // 1,925,471 / 12
    expect(c.who).toMatch(/\$26,044/); // 312,524 / 12
    expect(c.who).toMatch(/6\.2× spread/);
    expect(c.who).not.toMatch(/EBITDA/);
  });

  it("never presents company- or affiliate-owned outlets as franchisee earnings", () => {
    const rows = [
      { label: "Company cafés", ownership: "company" as const, avgMonthlyRevenue: 300_000 },
      { label: "Affiliate cafés", ownership: "affiliate" as const, avgMonthlyRevenue: 280_000 },
      { label: "Franchised — top", ownership: "franchised" as const, avgMonthlyRevenue: 90_000 },
      { label: "Franchised — bottom", ownership: "franchised" as const, avgMonthlyRevenue: 40_000 },
    ];
    const c = cohort({ totalUnits: 200, cohorts: rows }, "tiers")!;
    expect(c.who).toMatch(/\$90,000/);
    expect(c.who).not.toMatch(/300,000|280,000|Company|Affiliate/);
  });

  it("refuses to build a spread from a single comparable band", () => {
    expect(cohort({ totalUnits: 50, cohorts: [
      { label: "Average", ownership: "franchised", avgMonthlyRevenue: 50_000 },
      { label: "EBITDA", ownership: "franchised", revenueType: "net_or_ebitda", avgMonthlyRevenue: 9_000 },
    ] }, "tiers")).toBeUndefined();
  });

  it("refuses a spread of one — identical bands are not a range", () => {
    expect(cohort({ totalUnits: 50, cohorts: [
      { label: "A", avgMonthlyRevenue: 50_000 },
      { label: "B", avgMonthlyRevenue: 50_000 },
    ] }, "tiers")).toBeUndefined();
  });
});

describe("provenance is not assumed", () => {
  it("a disclosed monthly figure stays DISCLOSED — Crumbl", () => {
    const c = cohort(brand("crumbl"), "tiers")!;
    expect(c.basis).toBe("disclosed");
    expect(c.who).toMatch(/\$285,147/);
    expect(c.who).toMatch(/9\.4× spread/);
  });

  it("a monthly figure we divided out of an annual one drops to DERIVED — Dunkin'", () => {
    const c = cohort(brand("dunkin"), "tiers")!;
    expect(c.basis).toBe("derived");
    expect(c.who).toMatch(/\$179,528/); // 2,154,341 / 12
    expect(c.who).toMatch(/3\.0× spread/); // never bare "3×"
  });

  it("the roster cohorts are DISCLOSED — they are counts off Item 20", () => {
    expect(cohort(brand("crumbl"), "current")!.basis).toBe("disclosed");
    expect(cohort(brand("crumbl"), "departed")!.basis).toBe("disclosed");
  });

  it("recovers the tier cohort on records that disclose annual volume only", () => {
    // Requiring a disclosed MONTHLY figure would silently delete this section
    // from the two largest systems in the corpus. Both must have it.
    for (const slug of ["tint-world", "dunkin"]) {
      expect(cohort(brand(slug), "tiers"), slug).toBeDefined();
    }
  });
});

describe("no performance claim attaches to a person or a false denominator", () => {
  it("never prints a sample size beside a band figure", () => {
    // Tint World's "Highest" row describes ONE centre and carries sampleSize 105.
    const c = cohort(brand("tint-world"), "tiers")!;
    expect(c.who).not.toMatch(/105 outlets/);
    for (const f of readdirSync(BRANDS_DIR).filter((x) => x.endsWith(".json"))) {
      const t = cohort(brand(f.replace(".json", "")), "tiers");
      if (t) expect(t.who, f).not.toMatch(/\d+ outlets\)/);
    }
  });

  it("hands over a band and a question, never a top-performer label", () => {
    const c = cohort(brand("crumbl"), "tiers")!;
    expect(c.title).not.toMatch(/top performer/i);
    expect(c.questions[0]).toMatch(/What did this unit do in net sales/);
  });

  it("states the whole-block caveat once, under the block", () => {
    const cl = buildCallList(brand("tint-world"));
    expect(cl.note).toMatch(/does not say why any individual left/);
    expect(cl.note).toMatch(/Nothing on this page is a claim about a specific franchisee/);
    // and never repeats it inside a cohort
    for (const c of cl.cohorts) expect(c.why).not.toMatch(/does not say why any individual left/);
  });
});

describe("copy law", () => {
  const slugs = readdirSync(BRANDS_DIR).filter((x) => x.endsWith(".json"));

  it("describes the deal, never our analysis, and never names a cutoff", () => {
    for (const f of slugs) {
      const cl = buildCallList(brand(f.replace(".json", "")));
      const text = [
        cl.intro, cl.note, cl.unavailable ?? "",
        ...cl.cohorts.flatMap((c) => [c.title, c.who, c.where ?? "", c.why, ...c.questions]),
      ].join(" ").toLowerCase();
      for (const banned of ["our audit", "inflated", "thoroughness", "we flag", "our threshold", "our cutoff"]) {
        expect(text, `"${banned}" in ${f}`).not.toContain(banned);
      }
    }
  });

  it("every cohort hands the reader questions to ask, not a conclusion", () => {
    for (const f of slugs) {
      for (const c of buildCallList(brand(f.replace(".json", ""))).cohorts) {
        expect(c.questions.length, `${f} ${c.key}`).toBeGreaterThanOrEqual(4);
        for (const q of c.questions) expect(q.trim().endsWith("?") || q.includes("?")).toBe(true);
      }
    }
  });

  it("joins its one money range in lib/range.ts, so it cannot break across lines", () => {
    // The whole reason range.ts exists: on a 390px phone an ordinary space is a
    // line-break opportunity, and a range that breaks is three lines saying one
    // figure. This question is the only money range this module prints.
    let checked = 0;
    for (const f of slugs) {
      const t = cohort(brand(f.replace(".json", "")), "tiers");
      if (!t) continue;
      checked++;
      expect(t.questions[0], f).toContain(RANGE_SEP);
      expect(t.questions[0], f).not.toMatch(/\$[\d,]+ [\u2013-] \$/);
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("builds a call list for every record in the corpus", () => {
    const missing = slugs.filter((f) => !buildCallList(brand(f.replace(".json", ""))).available);
    expect(missing, `no call list for: ${missing.join(", ")}`).toHaveLength(0);
  });
});

/**
 * THE SHELF LINT.
 *
 * This module shipped complete, tested and rendering — and invisible. It went in
 * behind the paywall only: nothing on the free snapshot, nothing in the feature
 * matrix, nothing in the nurture email said the report contained it. A feature a
 * buyer cannot find out about before paying does not raise conversion, it raises
 * cost. The paid render was built and the reason to pay for it was not.
 *
 * That is not a copy oversight, it is a defect class. `tsc` cannot see it,
 * vitest could not see it, and the paid report looked perfect the whole time —
 * the only symptom is a number that does not move.
 *
 * So the shelf is now a lint: every surface where a buyer decides whether to pay
 * must name this section. Same shape as PRICE_SURFACES in lib/refund.test.ts,
 * which holds the same kind of line for the guarantee.
 *
 * Deliberately loose on wording and strict on presence. Copy gets rewritten and
 * should not break a build; SILENCE should. If a rewrite drops the promise
 * entirely, that is the thing worth failing on.
 */
describe("THE SHELF LINT — the unlock is named where the buyer decides to pay", () => {
  /** Every surface a buyer reads before the $199 decision. */
  const UNLOCK_SURFACES = [
    "components/InfographicTeaser.tsx", // the free snapshot, straight after a parse
    "components/FeatureMatrix.tsx", // the marketing "what you get" table
    "components/BrandDetail.tsx", // the ask card on a free brand page
    "components/BrandCTA.tsx", // the $199 block on brand / report / compare pages
    "app/sample/page.tsx", // "now run it on yours", under the sample report
    "components/PlaybookLanding.tsx", // the dreamer-track landing page
    "lib/leadEmail.ts", // nurture email #1 — the shopper track
  ];

  /** Any of these counts as naming it. */
  const NAMED =
    /who to call|who to ask|franchisees to call|owner groups worth an afternoon|calls worth an afternoon|calls actually worth an afternoon/i;

  for (const rel of UNLOCK_SURFACES) {
    it(`${rel} tells the buyer the call list is in there`, () => {
      // Comments stripped: a promise written in a code comment is a promise made
      // to us, not to the buyer.
      const src = readFileSync(join(process.cwd(), rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(
        NAMED.test(src),
        `${rel} never mentions the call list. It is the section that most changes ` +
          `what a buyer DOES with the report, and this is a surface where they ` +
          `decide whether to pay for it. Name it, or take it out of UNLOCK_SURFACES ` +
          `and say why here.`,
      ).toBe(true);
    });
  }

  it("never promises contact data FROM US on a pre-purchase surface", () => {
    // The privacy line: Item 20's exhibits are personal contact details for named
    // individuals, and they are in the buyer's own document by law. We sell the
    // cohorts and the questions. Copy that reads as "we will give you the phone
    // numbers" is both a promise we do not keep and a promise we should not make.
    const CLAIMS_OURS =
      /\b(we|our)\b[^.]{0,60}\b(phone numbers|contact (?:info|information)|franchisee list|roster)\b/i;
    for (const rel of UNLOCK_SURFACES) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(CLAIMS_OURS.test(src), `${rel} sounds like WE supply the contact data`).toBe(false);
    }
  });
});
