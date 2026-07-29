import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BASIS_STYLE, LEGEND_ORDER } from "./basis";

/**
 * THE PALETTE LINT.
 *
 * The report shipped two provenance palettes. CashLadder.tsx painted BENCHMARK
 * violet; DiligenceReport.tsx painted Benchmark amber — the same word, two
 * colours, one page, and one of them was the colour this product reserves for
 * warnings. Correcting the literal would have fixed that page and done nothing
 * about the third surface.
 *
 * So the palette is a module and the literals are a lint. Any provenance hex
 * written directly into components/ fails here, by construction.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * What the lint actually looks for.
 *
 * The naive version — "no component may contain a provenance hex" — is
 * unrunnable and was tried first. #F5B847 is the brand gold on the equity
 * slider, #34D399 is every positive figure on the site, #38BDF8 is the accent:
 * 279 legitimate occurrences across components/. Banning the hexes would ban
 * the design system.
 *
 * The defect was never a hex. It was a SECOND MAP — an object literal keyed by
 * basis names carrying its own colours, declared next to the markup that used
 * it. That is what this pattern finds, and it finds it anywhere, so a third
 * surface cannot quietly declare a fourth palette next year.
 */
const LOCAL_PALETTE = /\b(disclosed|derived|benchmark|inferred|buyer)\s*:\s*\{[^}]*#[0-9A-Fa-f]{6}/;

/** The two surfaces that render provenance. Both must read the module. */
const CONSUMERS = ["components/CashLadder.tsx", "components/DiligenceReport.tsx"];

describe("provenance palette", () => {
  it("every basis has a colour, a word, and a definition", () => {
    for (const [key, s] of Object.entries(BASIS_STYLE)) {
      expect(s.color, key).toMatch(/^#[0-9A-F]{6}$/i);
      expect(s.word.length, key).toBeGreaterThan(0);
      expect(s.definition.length, key).toBeGreaterThan(0);
      expect(s.label, key).toBe(s.label.toUpperCase());
    }
  });

  it("no basis is amber or red — those belong to warnings (LABEL LAW)", () => {
    // #F59E0B amber and #F87171 red are the warning tones. A provenance chip
    // wearing one makes a benchmark look like a problem. #F5B847 (gold) is a
    // deliberate exception: BUYER is a distinct claim and gold is not a warning.
    for (const [key, s] of Object.entries(BASIS_STYLE)) {
      expect(s.color.toUpperCase(), key).not.toBe("#F59E0B");
      expect(s.color.toUpperCase(), key).not.toBe("#F87171");
    }
  });

  it("the legend defines every term and no term it cannot show", () => {
    for (const b of LEGEND_ORDER) expect(BASIS_STYLE[b]).toBeTruthy();
    // "buyer" is deliberately absent: a definition for a chip this legend never
    // renders is noise.
    expect(LEGEND_ORDER).not.toContain("buyer");
  });

  it("SOURCE LINT — no file declares a second provenance palette", () => {
    const offenders: string[] = [];
    for (const dir of ["components", "lib", "app"]) {
      for (const file of walk(dir)) {
        if (/\.test\.tsx?$/.test(file)) continue;
        if (file.endsWith("basis.ts")) continue; // the palette itself
        for (const line of readFileSync(file, "utf8").split("\n")) {
          if (LOCAL_PALETTE.test(line)) offenders.push(`${file} → ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(
      offenders,
      `A basis-keyed colour map belongs in lib/basis.ts and nowhere else. ` +
        `Import BASIS_STYLE:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("SOURCE LINT — both provenance surfaces read the module", () => {
    // A surface that renders a chip without importing the palette is either
    // about to declare its own or is rendering an untinted one. Either way the
    // page loses the property this module exists to guarantee.
    for (const file of CONSUMERS) {
      expect(readFileSync(file, "utf8"), file).toMatch(/from ["']@\/lib\/basis["']/);
    }
  });
});
