// lib/publicHook.test.ts — THE PUBLIC-FIGURE LINT.
//
// The glass hero prints figures. That sentence is alarming on a page whose
// entire thesis is "the words are free, the numbers are paid," so this file
// exists to make it precisely bounded rather than a judgement call someone
// makes again on every PR.
//
// It enforces three things, and the third is the one that matters in a year:
//
//   1. IDENTITY. Every figure on the hook is byte-identical to what the
//      /brands tile already renders for the same brand. Not "the same
//      rounding" — the same characters, produced by the same function. A buyer
//      who reads "$115k/mo" on a tile and "$115,340/mo" one navigation later
//      has been shown a number nobody decided to give away.
//
//   2. SHAPE. No value on the hook parses as a bare number, and no value is a
//      number. A number on the shell is a number in the RSC payload, which is
//      the page source, at full precision, no matter how the markup rounds it.
//
//   3. CONSENT. Object.keys(hook) must deep-equal PUBLIC_HOOK_KEYS. Adding a
//      field to PublicHook and populating it in buildPublicHook() fails the
//      build until a human edits that array — and editing that array is the
//      moment someone has to say out loud which paid figure just became free.
//      That is the whole enforcement mechanism for "no new public figures
//      without a decision," and it is deliberately annoying.
//
// WHAT THIS TEST CANNOT DO, so nobody mistakes it for cover: it proves the
// hook equals the tile. It does not prove the tile was right to be public.
// That decision lives in lib/brandFacts.ts, where the four public field groups
// are annotated as such, and it predates glass mode by months.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

import { toCard, type BrandRecord } from "./brands";
import { buildPublicHook } from "./publicFigures";
import {
  compactUsd,
  compactMonthly,
  compactRange,
  PUBLIC_HOOK_KEYS,
} from "./publicFormat";
import { ogUsd } from "./ogCopy";

async function loadAll(): Promise<BrandRecord[]> {
  const dir = path.join(process.cwd(), "data", "brands");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const out: BrandRecord[] = [];
  for (const f of files) {
    out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
  }
  return out;
}

describe("THE PUBLIC-FIGURE LINT", () => {
  it("has a catalog to measure", async () => {
    // The failure mode every lint in this repo carries a floor against:
    // measuring an empty collection and reporting green.
    const brands = await loadAll();
    expect(brands.length, "no catalog records — this lint scanned nothing").toBeGreaterThan(50);
  });

  it("the hook's key set is exactly the allowlist — no field arrives unannounced", async () => {
    const brands = await loadAll();
    const want = [...PUBLIC_HOOK_KEYS].sort();
    for (const b of brands) {
      const keys = Object.keys(buildPublicHook(b)).sort();
      expect(
        keys,
        `${b.slug ?? "?"}: the hook's shape has drifted from PUBLIC_HOOK_KEYS. ` +
          `If a field was ADDED, say out loud which paid figure just became free ` +
          `and add it to the array in lib/publicFormat.ts. If one was REMOVED, ` +
          `the hero has a hole in it.`,
      ).toEqual(want);
    }
  });

  it("every hook figure is byte-identical to the library tile", async () => {
    const brands = await loadAll();
    for (const b of brands) {
      // "revenue" on both sides — the same preference app/franchise/[slug]/
      // page.tsx passes for the live gate. Passing a different one here would
      // make this test agree with itself and disagree with production.
      const card = toCard(b, "revenue");
      const hook = buildPublicHook(b);
      const at = `${b.slug ?? "?"}`;

      // components/BrandCard.tsx:48 — the tile's monthly headline.
      expect(hook.monthly, `${at}: monthly`).toBe(
        card.mo != null ? compactMonthly(card.mo) : null,
      );
      // components/BrandCard.tsx:60 — "from $364k–$1.1M to open".
      expect(hook.cost, `${at}: cost`).toBe(compactRange(card.lo, card.hi));

      // The words that qualify the figure travel with it, or the figure is
      // being quoted out of context: kind (revenue vs profit) is the one that
      // would be actively misleading, and basis is the one lib/brandFacts.ts
      // names outright — surfaces must NEVER claim a derived headline was
      // franchisor-disclosed.
      expect(hook.monthlyKind, `${at}: monthlyKind`).toBe(card.mo != null ? card.moKind : null);
      expect(hook.monthlyLabel, `${at}: monthlyLabel`).toBe(card.mo != null ? card.moLabel : null);
      expect(hook.monthlyBasis, `${at}: monthlyBasis`).toBe(card.mo != null ? card.moBasis : null);
      expect(hook.monthlyCaveat, `${at}: monthlyCaveat`).toBe(card.mo != null ? card.moCaveat : null);
      expect(hook.hasItem19, `${at}: hasItem19`).toBe(card.i19);

      // Counted fields: the count is the tile's, the noun is ours.
      if (card.mo != null && card.mn != null) {
        expect(hook.monthlySample, `${at}: monthlySample`).toBe(
          `${card.mn.toLocaleString("en-US")} ${card.mn === 1 ? "unit" : "units"} reporting`,
        );
      } else {
        expect(hook.monthlySample, `${at}: monthlySample`).toBeNull();
      }
      if (card.units != null) {
        expect(hook.units, `${at}: units`).toBe(
          `${card.units.toLocaleString("en-US")} ${card.units === 1 ? "open unit" : "open units"}`,
        );
      } else {
        expect(hook.units, `${at}: units`).toBeNull();
      }
    }
  });

  it("no hook value is a number, and none parses as one", async () => {
    /* THE PAYLOAD RULE, enforced at the source instead of at the render.
     *
     * components/ReportGlass.test.tsx walks the shell for numeric leaves >= 1000
     * and fails on any it finds — including numeric STRINGS, because stashing a
     * figure as text is not a loophole. That check is downstream and it is a
     * sample; this one is upstream and covers the whole catalog.
     *
     * It is also why every counted field carries its noun. "2,193" would trip
     * the payload check as if it were a leaked dollar figure; "2,193 open units"
     * is a phrase. The same reasoning renamed fddYear -> fddEdition: a bare
     * "2026" is >= 1000 and parses clean.
     */
    const brands = await loadAll();
    const NUMERIC = /^-?\d[\d,]*(\.\d+)?$/;
    for (const b of brands) {
      const hook = buildPublicHook(b) as Record<string, unknown>;
      for (const [k, v] of Object.entries(hook)) {
        if (v === null) continue;
        expect(typeof v, `${b.slug ?? "?"}: hook.${k} is a ${typeof v}`).not.toBe("number");
        if (typeof v === "string") {
          expect(
            NUMERIC.test(v),
            `${b.slug ?? "?"}: hook.${k} = "${v}" parses as a bare number. Give it ` +
              `its noun — a bare figure on the shell is a figure in the RSC payload.`,
          ).toBe(false);
        }
      }
    }
  });

  it("the OG image and the tile share ONE formatter — not two that agree today", () => {
    /* ogUsd was the third hand-typed copy of this function. It is now an alias,
       and this asserts the alias rather than the agreement: two independent
       implementations that happen to return the same string are the two-palette
       defect waiting for its fourth appearance. */
    expect(ogUsd, "ogUsd is no longer the same function as compactUsd").toBe(compactUsd);
    for (const n of [1000, 9499, 9500, 364_000, 999_999, 1_000_000, 1_250_000, 12_400_000]) {
      expect(ogUsd(n)).toBe(compactUsd(n));
    }
  });

  it("the identity check is real — a plausible re-typing of the formatter fails it", () => {
    /* A mutation test, inline. Every assertion above compares the hook to the
       tile; none of them proves the comparison could ever come out unequal. If
       both sides silently resolved to the same null, or if the comparator were
       loose, this file would be green on the day the hero started printing a
       different number than the tile.
       This is the copy someone writes from memory when they add a fifth
       surface. It agrees on small figures and diverges exactly where it hurts. */
    const retyped = (n: number) =>
      n >= 1_000_000 ? `$${Math.round(n / 1_000_000)}M` : `$${Math.round(n / 1000)}k`;

    expect(retyped(364_000)).toBe(compactUsd(364_000)); // agrees on the low end
    expect(retyped(999_000)).toBe(compactUsd(999_000)); // and right up to the seam
    // ...and diverges above $1M, where a $1.3M build-out prints as "$1M" — a
    // 30% understatement of the number the buyer is deciding on.
    expect(compactUsd(1_250_000)).toBe("$1.3M");
    expect(retyped(1_250_000)).toBe("$1M");
    expect(retyped(1_250_000)).not.toBe(compactUsd(1_250_000));

    // And the monthly form is NOT compactUsd: a monthly headline never reaches
    // $1M, so it has no M branch at all, and if a record ever produced one the
    // absurd figure stays legible as a data error instead of reading as a boast.
    // This is also the only place a thousands separator can appear in a public
    // figure — the one the rendered leak test has to know about.
    expect(compactMonthly(1_200_000)).toBe("$1,200k");
    expect(compactUsd(1_200_000)).toBe("$1.2M");
  });
});
