// components/ReportGlass.test.tsx — THE RENDERED LEAK TEST.
//
// lib/reportShell.test.ts (THE LEAK TEST) proves the SHELL carries no figures.
// lib/glassSeam.test.ts (THE SEAM LINT) proves no module that CAN compute one
// reaches the client bundle. Neither of them renders anything, and the gap
// between them is the whole component: a shell can be spotless and the JSX can
// still put a number on screen — a hardcoded example, a count formatted with a
// separator, an aria-label built from a figure, a title attribute.
//
// The ship gate for glass mode is "view-source a rendered brand page: no
// figure, no thousands separator that is not the Item 7 range." That is a
// human doing a one-time check on one brand, on the day of the deploy, which
// means it is true on that day and unenforced forever after. This is the same
// check, run over real catalog records, on every commit.
//
// A preview script that hand-writes the same markup is NOT this, and was the
// first thing built here before it got thrown away. A mirror of the component
// only ever proves things about the mirror — it stays clean on exactly the
// commit where the component stops being. This renders the actual default
// export, so there is nothing to keep in sync.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import React from "react";

import ReportGlass from "@/components/ReportGlass";
import { buildReportShell, DEFAULT_GLASS_CONFIG } from "@/lib/reportShell";
import { reportSourceFromComputed } from "@/lib/reportSource";
import { qualifiesForGlass } from "@/lib/reportShell";
import type { DiligenceResult } from "@/lib/types";

type BrandRecord = { slug?: string; brandName?: string; result: DiligenceResult };

const BRANDS_DIR = resolve(process.cwd(), "data/brands");

/** Every group of digits carrying a thousands separator: 1,234 / 12,345,678. */
const SEPARATED = /\d{1,3}(?:,\d{3})+/g;

/** The two places the capital slider echoes the visitor's own number back. */
const CAP_VALUE = /(<span class="[^"]*_capValue[^"]*">)[^<]*(<\/span>)/g;
const CAP_INPUT = /<input[^>]*_slider[^>]*>/g;

/**
 * Blank the capital slider's own readout, and NOTHING else.
 *
 * The slider is the page's one free interaction. The number it shows is the
 * visitor's, not ours: CapitalVerdict seeds it at round(low * 0.6) off the
 * Item 7 disclosed minimum and then it is whatever they drag it to. It is not
 * a figure they have not paid for, and the first run of this test flagged it
 * on all 12 sampled brands.
 *
 * The obvious fix — skip the whole capital block — is the wrong one. That
 * block's own copy says "what it means for your loan, your coverage ratio and
 * your payback is locked," which makes it the single most likely place for
 * someone to later drop a real derived number as a taste. Excluding the
 * subtree would put the most tempting square inch of the page outside the
 * lint. So only the readout and the input's value attribute are blanked; the
 * verdict text, the note and everything around them stay under guard.
 */
function scannable(html: string): string {
  return html
    .replace(CAP_VALUE, "$1$2")
    .replace(CAP_INPUT, (tag) => tag.replace(/\b(?:value|max|min)="\d+"/g, ""));
}

function load(): Array<{ slug: string; rec: BrandRecord }> {
  return readdirSync(BRANDS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      slug: f.replace(/\.json$/, ""),
      rec: JSON.parse(readFileSync(join(BRANDS_DIR, f), "utf8")) as BrandRecord,
    }));
}

describe("THE RENDERED LEAK TEST", () => {
  const all = load();

  it("has catalog records to render", () => {
    // The failure mode every lint in this repo carries a floor against:
    // measuring an empty collection and reporting green.
    expect(all.length).toBeGreaterThan(50);
  });

  /* A sample, not the catalog. Rendering 83 full reports through
     renderToStaticMarkup on every commit buys almost nothing over rendering a
     spread of them — but "almost nothing" is not nothing, so the sample is
     deterministic (sorted, strided) rather than random. A flaky lint that
     fails on one commit in nine gets disabled, not fixed. */
  const sample = all
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .filter((_, i) => i % 7 === 0);

  it("renders a real spread of brands", () => {
    expect(sample.length).toBeGreaterThan(8);
  });

  for (const { slug, rec } of sample) {
    it(`${slug} renders no figure but the Item 7 range`, () => {
      const shell = buildReportShell(
        reportSourceFromComputed(rec),
        DEFAULT_GLASS_CONFIG,
      );
      if (!qualifiesForGlass(shell, DEFAULT_GLASS_CONFIG)) return; // teaser brand

      const html = renderToStaticMarkup(
        React.createElement(ReportGlass, {
          shell,
          refTag: null,
          unlockHref: `/api/mint-brand-report?slug=${slug}`,
        }),
      );

      // Floor. A component that threw, or returned null, or rendered an empty
      // wrapper would pass every assertion below by having nothing in it.
      expect(html.length, "rendered almost nothing").toBeGreaterThan(4000);
      /* The mask as it actually ships: an EMPTY span, aria-hidden, carrying a
         width class and nothing else. Matching the closing tag immediately
         after the attributes is the point of this regex, not incidental to it
         — `<span …>$41,200</span>` would fail to match, and that is precisely
         the render this test exists to catch. */
      const masks = (
        html.match(/<span class="[^"]*_mask[^"]*"[^>]*><\/span>/g) ?? []
      ).length;
      expect(masks, "no masks rendered — is this the glass component?").toBeGreaterThan(30);

      /* THE ACTUAL ASSERTION. Item 7 is the one figure that crosses to the
         free side — it is disclosed, not derived, and it is already on the
         teaser this page replaces. Everything else with a thousands separator
         in it is a figure that should be behind a mask.

         Counts, Item numbers and page cites are all free and all under 1,000,
         so they carry no separator and never reach this check. That is why the
         test keys on the separator rather than on digits: it stays sharp
         without a growing allow-list of "legitimate" numbers, and an allow-list
         is how a leak test dies. */
      const allowed = new Set(
        (shell.capitalRange ?? []).map((n) => n.toLocaleString("en-US")),
      );
      /* Over-strip guard. If scannable() ever blanks more than the slider
         readout, this test goes quiet about everything it stopped scanning and
         reports green — the always-passing verifier, arrived at by accident.
         Under-stripping is safe (the test just gets stricter and fails loudly),
         so only this direction needs an assertion. */
      const scanned = scannable(html);
      expect(
        html.length - scanned.length,
        "scannable() removed far more than the capital readout",
      ).toBeLessThan(200);

      const found = [...new Set(scanned.match(SEPARATED) ?? [])];
      const leaked = found.filter((n) => !allowed.has(n));

      expect(
        leaked,
        `${slug} rendered ${leaked.length} figure(s) the buyer has not paid ` +
          `for: ${leaked.join(", ")}. The mask is an empty <span> and there is ` +
          `nothing behind it — if a number reached the markup, it was passed ` +
          `to the component, not hidden by it.`,
      ).toEqual([]);
    });
  }

  it("the unlock CTAs are anchors to the mint endpoint", () => {
    /* Not cosmetic. BrandDetail navigates by anchor so a double-click cannot
       mint twice (replay 019f873e), so cmd-click keeps working, and so PostHog
       gets a tick to flush before the navigation commits. A button plus
       router.push loses all three, and it loses them silently. */
    const withShell = sample
      .map(({ rec }) =>
        buildReportShell(reportSourceFromComputed(rec), DEFAULT_GLASS_CONFIG),
      )
      .find((s) => qualifiesForGlass(s, DEFAULT_GLASS_CONFIG));
    expect(withShell, "no qualifying brand in the sample").toBeTruthy();

    const href = "/api/mint-brand-report?slug=probe&ref=xyz";
    const html = renderToStaticMarkup(
      React.createElement(ReportGlass, { shell: withShell!, refTag: "xyz", unlockHref: href }),
    );

    // Both CTAs: the in-flow offer block and the traveling sticky bar. The
    // href is HTML-escaped in the attribute — `&ref=` renders as `&amp;ref=` —
    // and the real page always passes a ref when one is present, so the
    // ampersand case is the common one, not an edge.
    const escaped = href.replace(/&/g, "&amp;");
    const anchors = html.split(`href="${escaped}"`).length - 1;
    expect(anchors, "expected both unlock CTAs to point at the mint endpoint").toBe(2);

    // And no <button> left behind on either CTA — a button is the regression
    // (loses cmd-click, loses the PostHog flush tick, loses nothing visibly).
    expect(html).not.toMatch(/<button[^>]*_(?:bar)?[cC]ta_/);
  });
});
