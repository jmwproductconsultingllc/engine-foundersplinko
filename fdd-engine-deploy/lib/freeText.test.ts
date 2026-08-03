// lib/freeText.test.ts — THE FREE-TEXT LINT.
//
// Build-by-omission guarantees no figure is ever ASSIGNED to a shell field. It
// never guaranteed no figure is SPELLED OUT in one, and the second claim is the
// one a visitor can read. What was live on 67 of 82 glass brands when this file
// was written:
//
//   Total units    ▉▉▉▉      (masked)
//   Opened         ▉▉        (masked)
//   Closed         ▉         (masked)
//   Owner turnover ▉▉▉       (masked)
//     "145 outlets were open at the start of the year: 149 at year end, less
//      11 opened, plus 7 closed."          <- free note, same card
//
// Neither existing leak instrument could see it, and the reason is worth
// keeping: THE RENDERED LEAK TEST keys on a thousands separator and every
// outlet count in the corpus is under 1,000, so none carry one. The payload
// scan walks NUMERIC LEAVES with a >= 1,000 floor, so a prose string was never
// a candidate at all. A leak test's floor is its blind spot, and both floors
// are load-bearing where they are. The hole was that neither pointed at prose.
//
// So lib/reportShell.ts grew a seam that does, and this file is what makes that
// seam real. Two properties, tested separately because they fail separately:
//
//   ONE  a figure may not state its own value in its own label or note.
//        No floor. Attribution is what makes the leak, not magnitude.
//   TWO  free prose may not spell out ANY masked value above 100.
//        Floor justified structurally in the seam's own header block.
//
// MUTATION PROOF (re-run these by hand if you touch the seam):
//   * delete the assertNoSelfLabelledFigures call    -> 4 red
//   * FREE_TEXT_FLOOR 100 -> 100000                  -> 3 red
//   * drop the LIST_MARKER strip                     -> 1 red (catalog)
//   * drop the ITEM_POINTER strip                    -> 1 red (catalog)
//   * `>` -> `>=` on the floor comparison            -> 1 red
//   * isProse `{4}` -> `{1}`                         -> 1 red (catalog)

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildReportShell, DEFAULT_GLASS_CONFIG } from "./reportShell";
import type { ReportSource, SourceFigure } from "./reportShell";
import { reportSourceFromComputed } from "./reportSource";

const BRANDS_DIR = resolve(process.cwd(), "data/brands");

/**
 * A lint's own failure mode is scanning zero files and reporting green. Every
 * lint in this repo carries a floor; this is ours. 83 brands on disk the day it
 * was written, so 60 leaves room to prune the corpus without disarming it.
 */
const MIN_BRANDS = 60;

function catalog(): Array<{ slug: string; source: ReportSource }> {
  const out: Array<{ slug: string; source: ReportSource }> = [];
  for (const f of readdirSync(BRANDS_DIR).filter((x) => x.endsWith(".json")).sort()) {
    const rec = JSON.parse(readFileSync(join(BRANDS_DIR, f), "utf8"));
    try {
      out.push({ slug: f.replace(/\.json$/, ""), source: reportSourceFromComputed(rec) });
    } catch {
      /* A record that cannot even become a source is another test's problem. */
    }
  }
  return out;
}

const fig = (label: string, value: SourceFigure["value"], extra: Partial<SourceFigure> = {}): SourceFigure => ({
  label,
  value,
  unit: "usd",
  provenance: "disclosed",
  ...extra,
});

/** A minimal source that clears nothing but this seam — the rest is another test's. */
function sourceWith(figures: SourceFigure[], section: Partial<ReportSource["sections"][number]> = {}): ReportSource {
  return {
    brandSlug: "lint-fixture",
    brandName: "Lint Fixture",
    badges: [],
    sections: [{ id: "what-it-costs", title: "What it costs", figures, ...section }],
  };
}

const build = (s: ReportSource) => buildReportShell(s, DEFAULT_GLASS_CONFIG);

describe("THE FREE-TEXT LINT — the catalog", () => {
  const brands = catalog();

  it("scanned a real corpus", () => {
    expect(brands.length, "the lint scanned nothing and reported green").toBeGreaterThanOrEqual(
      MIN_BRANDS,
    );
  });

  it("every brand on disk builds a shell with no figure spelled out in prose", () => {
    const broke: string[] = [];
    for (const { slug, source } of brands) {
      try {
        build(source);
      } catch (e) {
        broke.push(`${slug}: ${(e as Error).message.split("\n").slice(0, 3).join(" | ")}`);
      }
    }
    /* This is a corpus assertion, and corpus assertions rot into allow-lists if
       you let them. There is no allow-list: a brand that trips the seam is
       either a real leak to fix in the data or a real defect to fix in the
       copy. Three tripped it the day it was written — five-star-bath-solutions,
       image-studios and spenga, all FDD table headings transcribed with their
       own value in them — and all three were fixed in the records rather than
       forgiven here. */
    expect(broke, `${broke.length} brand(s) leak a figure into free text`).toEqual([]);
  });
});

describe("PROPERTY ONE — a figure may not label itself", () => {
  it("refuses a label that states its own value", () => {
    expect(() =>
      build(sourceWith([fig("Pre-Sale Membership Requirement (150 memberships)", 150)])),
    ).toThrow(/states its own value 150/);
  });

  it("has no floor, because a percentage never clears one", () => {
    /* The whole reason this property exists separately from property two. A
       royalty label reading "(6% of Gross Revenue)" beside a masked 6 is as
       complete a disclosure as "$20,000/Month" beside a masked 20000, and no
       magnitude floor worth having would ever catch it. */
    expect(() =>
      build(sourceWith([fig("Royalty Fee (6% of Gross Revenue)", 6, { unit: "pct" })])),
    ).toThrow(/states its own value 6/);
  });

  it("catches it in the note as well as the label", () => {
    expect(() =>
      build(sourceWith([fig("Royalty Fee", 6, { unit: "pct", note: "Charged at 6% of gross." })])),
    ).toThrow(/note: states its own value 6/);
  });

  it("allows a label that states a DIFFERENT figure's small value", () => {
    /* 6 belongs to the royalty row, not to the ad-fund row whose label mentions
       a 6-month grace period. The reader cannot attribute it, so it is a
       collision and not a disclosure. Policing it is how a lint becomes noise
       and noise is how a lint gets disabled. */
    expect(() =>
      build(
        sourceWith([
          fig("Royalty Fee", 6, { unit: "pct" }),
          fig("Ad Fund (waived first 6 months)", 2, { unit: "pct" }),
        ]),
      ),
    ).not.toThrow();
  });

  it("does not mistake a cash-ladder rung ordinal for a figure", () => {
    // "4. − Rent & occupancy" on a rung whose value happens to be 4.
    expect(() => build(sourceWith([fig("4. − Rent & occupancy", 4)]))).not.toThrow();
    // But a 4 anywhere ELSE in the same string is still caught.
    expect(() => build(sourceWith([fig("4. − Rent, 4 months prepaid", 4)]))).toThrow(
      /states its own value 4/,
    );
  });

  it("does not mistake an FDD Item pointer for a figure", () => {
    expect(() =>
      build(sourceWith([fig("Owner turnover", 20, { unit: "pct", note: "From Item 20 Table 1." })])),
    ).not.toThrow();
    expect(() =>
      build(sourceWith([fig("Transfers", 6, { unit: "count", note: "See Items 5–6 as well." })])),
    ).not.toThrow();
  });
});

describe("PROPERTY TWO — free prose may not spell out a masked figure", () => {
  const leaky = (blurb: string, value: SourceFigure["value"] = 2295) =>
    sourceWith([fig("Average monthly revenue", value)], { blurb });

  it("refuses a blurb naming another row's masked value above the floor", () => {
    expect(() => build(leaky("The average unit reports 2,295 a month."))).toThrow(
      /spells out 1 masked figure/,
    );
  });

  it("reads a number however it was formatted", () => {
    for (const form of ["2295", "2,295", "2295.0"]) {
      expect(() => build(leaky(`Roughly ${form} a month.`)), form).toThrow(/spells out/);
    }
  });

  it("holds the floor at 100, strictly", () => {
    /* 100 is the top of the percentage scale, so it is out by construction —
       "100% of respondents" must not take a brand out of glass mode. 101 is the
       first integer that cannot be a percentage, a rung, a month marker or an
       FDD Item, and is therefore the first that can only be a figure. */
    expect(() => build(leaky("Reported by 100 of the respondents.", 100))).not.toThrow();
    expect(() => build(leaky("Reported by 101 of the respondents.", 101))).toThrow(/spells out/);
  });

  it("leaves the deliberate residual gap where the seam says it is", () => {
    /* Stated rather than papered over, here and in the seam's header: a masked
       count UNDER the floor spelled out in prose about a different row is NOT
       caught. The Item 20 counts that started all of this — 54 opened, 9 closed
       — sit in that gap, and RULE 5 in lib/churn.ts is the only thing covering
       them. If this assertion ever starts failing, the floor moved and this
       comment is the thing to re-read. */
    expect(() => build(leaky("9 outlets closed last year.", 9))).not.toThrow();
  });

  it("keeps the Item 7 exemption and does not widen it", () => {
    const s = sourceWith([fig("Total investment", [64500, 138000])]);
    s.capitalRange = [64500, 138000];
    s.sections[0].blurb = "Item 7 discloses 64,500 to 138,000 all in.";
    expect(() => build(s)).not.toThrow();

    // The exemption is the Item 7 range and nothing else that happens to be near it.
    const t = sourceWith([fig("Total investment", [64500, 138000]), fig("Franchise fee", 49500)]);
    t.capitalRange = [64500, 138000];
    t.sections[0].blurb = "The franchise fee alone is 49,500.";
    expect(() => build(t)).toThrow(/spells out/);
  });

  it("guards fields nobody enumerated", () => {
    /* An enumerated guard only guards what someone remembered to enumerate. The
       seam walks the FINISHED shell, so a free string reached through a field
       this test does not name is covered anyway. freeChips and the section
       anchor stand in here for "whatever gets added next". */
    const chips = sourceWith([fig("Average monthly revenue", 2295)], {
      freeChips: ["Reported around 2,295 a month"],
    });
    expect(() => build(chips)).toThrow(/spells out/);

    const anchor = sourceWith([fig("Average monthly revenue", 2295)], { anchor: "The 2,295 line" });
    expect(() => build(anchor)).toThrow(/spells out/);
  });

  it("ignores strings that are not prose", () => {
    /* A field holding nothing but a number is a mask width, an Item number or a
       page cite — the masks are the other tests' territory, and scanning them
       here would make this a second, worse copy of the payload scan. */
    const s = sourceWith([fig("Average monthly revenue", 2295, { citation: { item: 19, page: "2295" } })]);
    expect(() => build(s)).not.toThrow();

    /* And the threshold is FOUR CONSECUTIVE LETTERS, not one. A page cite reads
       "p. 2295" and a mask width reads "12ch"; both carry letters and neither is
       something a human reads as a sentence. Relaxing to one letter turns every
       cite and every width into a candidate, which is how this lint would come
       to fire on structure and then get switched off. */
    const cite = sourceWith([
      fig("Average monthly revenue", 2295, { citation: { item: 19, page: "p. 2295" } }),
    ]);
    expect(() => build(cite)).not.toThrow();
  });
});
