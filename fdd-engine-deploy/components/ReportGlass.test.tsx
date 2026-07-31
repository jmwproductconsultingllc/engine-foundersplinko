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

import ReportGlass, { HeroHook } from "@/components/ReportGlass";
import { buildReportShell, DEFAULT_GLASS_CONFIG } from "@/lib/reportShell";
import { reportSourceFromComputed } from "@/lib/reportSource";
import { qualifiesForGlass } from "@/lib/reportShell";
import { buildPublicHook } from "@/lib/publicFigures";
import type { PublicHook } from "@/lib/publicFormat";
import type { BrandRecord as CatalogRecord } from "@/lib/brands";
import type { DiligenceResult } from "@/lib/types";

type BrandRecord = { slug?: string; brandName?: string; result: DiligenceResult };

/**
 * Build the shell the way PRODUCTION builds it.
 *
 * buildReportShell() returns hook: null and always will — its guarantee is that
 * the shell is built by OMISSION, and populating the hook inside it would turn
 * that proof into a claim about which branch happened to run. lib/glassGate.ts
 * is the one layer that attaches it, because it is the only layer holding the
 * BrandRecord. This mirrors that line exactly.
 *
 * Rendering with hook: null would be the worse kind of green: every assertion
 * below would pass while the entire hero — the block that prints figures — went
 * unrendered and therefore unscanned.
 */
function productionShell(rec: BrandRecord) {
  const shell = buildReportShell(reportSourceFromComputed(rec), DEFAULT_GLASS_CONFIG);
  return { ...shell, hook: buildPublicHook(rec as unknown as CatalogRecord) };
}

/**
 * The hook's own separated numbers, enumerated — NOT a loosening of SEPARATED.
 *
 * "1,046 units reporting" and "2,193 open units" carry thousands separators, so
 * the leak scan sees them and is right to. The exception is allowed because of
 * what backs it, and the chain is short enough to check: PUBLIC_HOOK_KEYS pins
 * the hook's key set, and lib/publicHook.test.ts (THE PUBLIC-FIGURE LINT)
 * asserts per catalog brand that every one of those values is byte-identical to
 * what the unpaywalled /brands tile already renders. So this allows exactly the
 * strings a visitor could read on a public page one click earlier, and nothing
 * else — it reads them off the shell rather than trusting a list someone typed.
 *
 * What it must never become: a regex relaxation, or an exemption for a subtree.
 * Widen SEPARATED and the test stops seeing leaks everywhere at once; this
 * pathway can only ever admit values that survived the identity lint.
 *
 * THE WIDEST PART OF THIS EXCEPTION, named so nobody discovers it later:
 * monthlyCaveat is free text from the resolver, and on a derived brand it spells
 * the derivation out in full — real-property-management's reads "median $4,256/yr
 * revenue per managed unit … Range $43,624–$98,627/mo". Those are uncompacted
 * figures and this allows all three. They are allowed because they are already
 * printed verbatim on the public tile (components/BrandCard.tsx:55) and because
 * suppressing the caveat while keeping the headline it qualifies is the one
 * outcome worse than showing both. If the caveat ever stops being rendered on
 * the tile, this exception must be narrowed to the counted fields the same day.
 */
function hookAllowed(hook: PublicHook | null): string[] {
  if (!hook) return [];
  return Object.values(hook)
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.match(/\d{1,3}(?:,\d{3})+/g) ?? []);
}

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

/**
 * Every numeric leaf on the shell big enough to be a figure.
 *
 * NOT a regex over JSON.stringify(shell), which is where this started and
 * where it was wrong. The separator heuristic the markup check uses is exactly
 * backwards here: the payload carries RAW numbers, and JSON's own array
 * delimiter reads as a thousands separator — `capitalRange: [272357, 534417]`
 * serializes to `[272357,534417]`, out of which `\d{1,3}(,\d{3})+` happily
 * cuts "357,534". That fired on all 12 sampled brands, and a lint that is red
 * on 100% of the catalog is a lint someone disables.
 *
 * So this walks the object and judges magnitude, which is what a leak in the
 * payload actually looks like. Numeric strings are walked too — stashing a
 * figure as text is not a loophole. Nothing free on the shell reaches 1,000:
 * counts, severity counts, Item numbers, page cites and mask widths are all
 * small, so the floor needs no allow-list beyond the Item 7 pair.
 */
function payloadFigures(shell: unknown): string[] {
  const range = (shell as { capitalRange?: number[] })?.capitalRange ?? [];
  const allowed = new Set<number>(range);
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, `${path}[]`));
    if (typeof v === "object") {
      for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${k}`);
      return;
    }
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && /^-?\d[\d,]*(\.\d+)?$/.test(v)
          ? Number(v.replace(/,/g, ""))
          : NaN;
    if (!Number.isFinite(n) || Math.abs(n) < 1000 || allowed.has(n)) return;
    out.push(`${path} = ${String(v)}`);
  };
  walk(shell, "shell");
  return out;
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
      const shell = productionShell(rec);
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
      const allowed = new Set([
        ...(shell.capitalRange ?? []).map((n) => n.toLocaleString("en-US")),
        ...hookAllowed(shell.hook),
      ]);
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

      /* THE RSC PAYLOAD CHECK — ship-gate item 4, and the reason view-source
         is not sufficient on the App Router.

         A server component streams two things to the browser: the rendered
         HTML (asserted above) and the flight payload, which carries the
         serialized props of every client component in the tree so React can
         hydrate. A figure can be absent from the markup and present in the
         payload — it is sitting in the page source either way, and "we don't
         paint it" is not the guarantee we sell.

         On the glass path this is exactly checkable, because
         app/franchise/[slug]/page.tsx returns NOTHING but <ReportGlass>. The
         client subtree is this one component, so its props ARE the payload.
         Widen the props and this assertion silently stops covering the page —
         which is the other reason the header says do not widen them. */
      const inPayload = payloadFigures(shell);
      expect(
        inPayload,
        `${slug} serialized ${inPayload.length} figure(s) into the RSC payload ` +
          `that never appear in the markup: ${inPayload.join(", ")}. The buyer ` +
          `can read these in view-source. Nothing but the shell crosses the ` +
          `boundary, so a number here was put ON the shell, not hidden by it.`,
      ).toEqual([]);

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

  /**
   * THE HOOK RENDER TEST — the second guard pointing back at absence.
   *
   * Everything else in this file asserts that something is NOT on the page, and
   * a component can satisfy every one of those by rendering less and less. The
   * hero is the block most exposed to that: it is the only place on a glass page
   * that prints a figure, so the safest-looking edit anyone can make to this
   * component is to delete it — and the leak scan would go GREENER, not red.
   *
   * The failure this stops is the one we already shipped once: a paid ad drops a
   * visitor here, the first concrete statement is "Below the disclosed minimum,"
   * and nothing above it says below WHAT.
   */
  it("HOOK RENDER — the public figures reach the markup, above the capital check", () => {
    const withHook = sample
      .map(({ rec }) => productionShell(rec))
      .find(
        (s) =>
          qualifiesForGlass(s, DEFAULT_GLASS_CONFIG) &&
          s.hook?.monthly != null &&
          s.hook?.cost != null,
      );
    expect(
      withHook,
      "no sampled brand has both an Item 19 headline and an Item 7 range — " +
        "either the catalog changed or buildPublicHook stopped resolving",
    ).toBeTruthy();

    const html = renderToStaticMarkup(
      React.createElement(ReportGlass, {
        shell: withHook!,
        refTag: null,
        unlockHref: "/api/mint-brand-report?slug=probe",
      }),
    );

    // The figures themselves, exactly as the tile prints them.
    expect(html, "the Item 19 monthly headline is missing from the hero").toContain(
      withHook!.hook!.monthly!,
    );
    // Rendered through JSX, so the en dash in the range survives but "&" and
    // friends would not — compare on the two ends rather than the joined string.
    for (const half of withHook!.hook!.cost!.split("–")) {
      expect(html, `the Item 7 range is missing "${half}"`).toContain(half);
    }

    // ABOVE the capital slider. This is the whole point of the block: the
    // capital verdict is a comparison, and a comparison rendered before its
    // reference point is what sent a buyer looking for the back button.
    const hookAt = html.indexOf(withHook!.hook!.monthly!);
    const capitalAt = html.indexOf("_capValue");
    expect(capitalAt, "capital block not found").toBeGreaterThan(-1);
    expect(
      hookAt,
      "the hook renders BELOW the capital check — the ad visitor meets " +
        "'Below the disclosed minimum' before anything tells them below what",
    ).toBeLessThan(capitalAt);

    // The positioning and the FDD definition, which is the other half of the
    // context problem: a buyer who does not know what an FDD is cannot judge a
    // page whose credibility rests entirely on our having read one.
    expect(html).toContain("Franchise Edge");
    expect(html).toContain("Franchise Disclosure Document");
    expect(html, "the 14-day delivery rule is the one checkable fact here").toMatch(
      /at least 14 days before/,
    );
    expect(html, "no contact route on a page asking for $199").toContain(
      "mailto:jason@foundersplinko.com",
    );

    /* NOT A SUPERLATIVE. "The leading provider of…" is unsubstantiated on its
       face, which is an FTC problem on a commercial page and — more expensively
       — reads as marketing to the exact skeptical buyer about to spend $200k+.
       Every claim in this hero is checkable against the document. */
    expect(html.toLowerCase()).not.toMatch(/\b(?:the leading|#1|number one|best-in-class)\b/);
  });

  /*
   * THE PROSE PROVENANCE LINT.
   *
   * The defect this exists for was live and green: the hero's closing note read
   * "Both figures are the franchisor's own, straight out of the disclosure
   * document" as a fixed string, under a chip reading DERIVED, on a brand whose
   * own caveat one line above said per-franchise revenue "is not disclosed
   * directly." Three provenance mechanisms were working — the moBasis field, the
   * chip, the verb — and the sentence next to them made the exact claim
   * lib/brandFacts.ts bans, because no guard reads sentences.
   *
   * That is the general shape of it: provenance is enforced on values and then
   * lost in the copy that frames them. So this scans the WHOLE catalog rather
   * than the sample — the derived brands are a minority, and a sample that
   * happens to miss them is a lint that reports green on the only case it was
   * written for.
   *
   * Rendering the hook in isolation, not the page: this is a copy assertion, and
   * 80 full report renders to check one paragraph is how a test gets deleted.
   */
  it("PROSE PROVENANCE — no derived headline is described as franchisor-disclosed", () => {
    const hooks = all
      .map(({ slug, rec }) => ({ slug, hook: buildPublicHook(rec as unknown as CatalogRecord) }))
      .filter((h) => h.hook.monthly != null);

    const derived = hooks.filter((h) => h.hook.monthlyBasis === "derived");
    expect(
      derived.length,
      "no derived-basis brand in the catalog — this lint scanned nothing. If " +
        "every headline is now franchisor-disclosed, delete the lint on purpose " +
        "rather than leaving it passing vacuously.",
    ).toBeGreaterThan(0);
    expect(
      hooks.filter((h) => h.hook.monthlyBasis === "disclosed").length,
      "no disclosed-basis brand either — the resolver is not resolving",
    ).toBeGreaterThan(0);

    // The sentence that must never appear over a derived figure, and the one
    // that must. Matched loosely on purpose: a rewrite that keeps the meaning
    // should keep passing, a rewrite that flattens back to one fixed sentence
    // for both bases should not.
    const CLAIMS_DISCLOSED = /the franchisor’s own, straight out of the disclosure document\.\s*What is masked/;

    for (const { slug, hook } of derived) {
      const html = renderToStaticMarkup(
        React.createElement(HeroHook, { hook, brandName: "Probe" }),
      );
      expect(
        html,
        `${slug}: the hero's note calls a DERIVED headline the franchisor's own. ` +
          `lib/brandFacts.ts: surfaces must NEVER claim a derived headline was ` +
          `franchisor-disclosed.`,
      ).not.toMatch(CLAIMS_DISCLOSED);
      expect(
        html,
        `${slug}: the note does not say the monthly figure is ours`,
      ).toMatch(/our arithmetic/);
      // The verb, the other half of the same rule.
      expect(html, `${slug}: "reports" claims disclosure`).toContain("works out to");
    }

    // ...and the mutation proof that the matcher can fire at all: the disclosed
    // brands DO carry the sentence, so the regex is not a typo matching nothing.
    const oneDisclosed = hooks.find(
      (h) => h.hook.monthlyBasis === "disclosed" && h.hook.cost != null,
    )!;
    const okHtml = renderToStaticMarkup(
      React.createElement(HeroHook, { hook: oneDisclosed.hook, brandName: "Probe" }),
    );
    expect(
      okHtml,
      "CLAIMS_DISCLOSED matches nothing even on a disclosed brand — the guard " +
        "above is vacuous and the copy has drifted out from under it",
    ).toMatch(CLAIMS_DISCLOSED);
    expect(okHtml).toContain("Both figures are the franchisor");
  });

  it("the unlock CTAs are anchors to the mint endpoint", () => {
    /* Not cosmetic. BrandDetail navigates by anchor so a double-click cannot
       mint twice (replay 019f873e), so cmd-click keeps working, and so PostHog
       gets a tick to flush before the navigation commits. A button plus
       router.push loses all three, and it loses them silently. */
    const withShell = sample
      .map(({ rec }) => productionShell(rec))
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

  /**
   * THE CAPTURE MOUNT TEST.
   *
   * Glass mode reached prod on 2026-07-30 with ZERO lead capture. Not degraded
   * — absent. BrandDetail mounts CaptureProvider, three EmailCapture surfaces
   * and CaptureSheet; app/layout.tsx mounts none of that globally; and the
   * glass branch of app/franchise/[slug]/page.tsx returns nothing but
   * <ReportGlass>. The page could take $199 and could not take an email, and
   * nothing anywhere went red about it.
   *
   * That is a nasty failure mode precisely because it is an ABSENCE. Every
   * other guard around glass asserts something is NOT on the page — a whole
   * family of lints pointed one direction — and a component can satisfy all of
   * them by rendering less and less. This is the guard pointing back.
   *
   * It asserts the INPUT, not the wrapper: a <CaptureProvider> rendering no
   * form is exactly as useless as no provider, and asserting on the provider
   * would sail straight through that regression.
   */
  it("CAPTURE MOUNT — glass renders an email capture, below the offer", () => {
    const withShell = sample
      .map(({ rec }) => productionShell(rec))
      .find((s) => qualifiesForGlass(s, DEFAULT_GLASS_CONFIG));
    expect(withShell, "no qualifying brand in the sample").toBeTruthy();

    const html = renderToStaticMarkup(
      React.createElement(ReportGlass, {
        shell: withShell!,
        refTag: null,
        unlockHref: "/api/mint-brand-report?slug=probe",
      }),
    );

    // The field itself, and the submit that goes with it.
    expect(html, "no email input on the glass page — capture is gone").toMatch(
      /<input[^>]*type="email"[^>]*aria-label="Your email address"/,
    );
    expect(html).toContain("Email me the questions");

    /* ORDER. The free ask must sit BELOW the paid one. Above it, it becomes
       the first offer the reader meets and competes with the product for the
       visitor who was closest to buying. This is the one property of the
       placement a later refactor can silently invert. */
    const offerAt = html.indexOf("Unlock the full report");
    const captureAt = html.indexOf("Email me the questions");
    expect(offerAt, "offer block not found").toBeGreaterThan(-1);
    expect(
      captureAt,
      "the free email ask renders ABOVE the $199 CTA — it now competes with " +
        "the product instead of catching the reader who already declined it",
    ).toBeGreaterThan(offerAt);

    /* No S2 sheet on glass, on purpose, for two independent reasons: it renders
       fixed to bottom-0 and would cover the traveling unlock bar on mobile
       (83% of spend), and CaptureSheet.eligible() gates on fe_teaser_viewed,
       which only BrandDetail sets — so mounting it here would be a silent
       no-op that looks shipped. "Not now" is the sheet's dismiss control. */
    expect(html).not.toContain("Not now");
  });
});
