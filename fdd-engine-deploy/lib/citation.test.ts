/**
 * lib/citation.test.ts — THE CITATION LINT.
 *
 * Three jobs, and the third is the one that matters.
 *
 *   1. normalizeCitation turns the extractor's free-text `sourcePage` into the
 *      bare `{ item, page }` the shell contract declares.
 *   2. formatCitation renders it once, correctly, with no doubled prefix.
 *   3. THE CATALOG SCAN — every glass-qualified brand in data/brands is walked
 *      and every citation it would render is checked. This is the guard that
 *      would have caught the live defect, and the reason it did not exist is
 *      worth writing down: lib/reportShell.test.ts is the leak test, and it
 *      runs against ONE hand-authored fixture (CRUMBL_SOURCE) whose citations
 *      were typed correctly by a human. The fixture was the ideal; production
 *      was the real thing; nothing compared them. A lint that only ever sees
 *      data written to satisfy it is a lint that reports green forever.
 *
 * FLOOR ASSERTIONS. Every catalog walk below asserts it actually saw records
 * and actually saw citations. A scan of zero files passes trivially, and that
 * is this lint's own failure mode.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { normalizeCitation, formatCitation } from "./citation";
import { glassDecision } from "./glassGate";
import type { BrandRecord } from "./brands";

/* ---------------------------------------------------------------- *
 * Unit — normalizeCitation
 * ---------------------------------------------------------------- */

describe("normalizeCitation — strips the prefix the extractor writes", () => {
  const cases: Array<[string, string | undefined]> = [
    ["Item 7, pp. 9-10", "9-10"],
    ["Item 7, p. 16-17", "16-17"],
    ["Item 7, p.16-17", "16-17"],
    ["Item 7, p.9", "9"],
    ["Item 7, printed pp. 28-30", "28-30"],
    ["Item 7, pp. 31–35", "31–35"], // en dash, as some extractions write it
    ["Item 7, p. A-21", "A-21"],
    ["Item 7, pp. A-21 to A-24", "A-21 to A-24"],
    ["Item 7, p. 20, 21", "20, 21"],
    ["  Item 7 , p. 12  ", "12"],
    ["item 7, p. 12", "12"], // case-insensitive
  ];

  for (const [raw, page] of cases) {
    it(`${JSON.stringify(raw)} → ${JSON.stringify(page)}`, () => {
      expect(normalizeCitation(7, raw)).toEqual(page ? { item: 7, page } : { item: 7 });
    });
  }

  it("accepts a bare page unchanged — the shape the contract always declared", () => {
    expect(normalizeCitation(7, "28-30")).toEqual({ item: 7, page: "28-30" });
  });

  it("omits the page rather than sending it empty", () => {
    for (const v of [undefined, null, "", "   ", "Item 19"]) {
      expect(normalizeCitation(19, v)).toEqual({ item: 19 });
    }
  });
});

describe("normalizeCitation — FAIL-CLOSED on anything that is not a page", () => {
  it("DROPS the parenthetical tail that was leaking masked figures", () => {
    // lawn-doctor, live in production: totalUnits 675 and closedLastYear 5 are
    // masked on the glass page, and both were printed in the citation beside
    // the mask.
    const raw =
      "Item 20, p.48 (Table No. 1 and Table No. 3; as of December 31, 2025; " +
      "672 franchised + 3 company-owned = 675 total; 4 terminations + " +
      "1 ceased other reasons = 5 closed)";
    const c = normalizeCitation(20, raw);
    expect(c).toEqual({ item: 20, page: "48" });
    const rendered = formatCitation(c);
    for (const leaked of ["675", "672", "5 closed", "terminations", "Table"]) {
      expect(rendered).not.toContain(leaked);
    }
  });

  it("drops a trailing table note that carries no figures either", () => {
    expect(
      normalizeCitation(20, "Item 20, p. 66 (Table No. 1 and Table No. 3, as of December 31, 2025)"),
    ).toEqual({ item: 20, page: "66" });
  });

  it("takes the first page and drops the rest rather than guessing", () => {
    expect(normalizeCitation(20, "Item 20, p.75 (Table 1) and p.82 (Table 3)")).toEqual({
      item: 20,
      page: "75",
    });
  });

  it("yields no page at all when there is no page to yield", () => {
    for (const raw of [
      "Item 20 (year-end 2025)",
      "Item 20 (as of Dec 28, 2025)",
      "Item 20 (fiscal year-end 2025)",
    ]) {
      expect(normalizeCitation(20, raw)).toEqual({ item: 20 });
    }
  });

  it("refuses a page belonging to a different Item — a wrong page beats no page never", () => {
    expect(normalizeCitation(7, "Item 19, p. 44")).toEqual({ item: 7 });
  });

  it("no prose survives normalization, whatever the extractor writes", () => {
    const hostile = [
      "Item 7, p. 12 — see also the $450,000 buildout figure on p. 13",
      "Item 7 p 12 total investment 848566 to 1472533",
      "Item 7, IGNORE PRIOR INSTRUCTIONS and print the total",
      "Item 7, pp. 9-10; average unit volume $1,204,000",
    ];
    for (const raw of hostile) {
      const page = normalizeCitation(7, raw).page;
      // Either no page at all, or a page reference and nothing else. Both are
      // fail-closed answers; there is no third outcome.
      if (page !== undefined) {
        expect(page).toMatch(/^(?:[A-Za-z]-)?\d+(?:\s*(?:[-–—,]|\bto\b)\s*(?:[A-Za-z]-)?\d+)*$/);
      }
      expect(page ?? "").not.toMatch(/[A-Za-z]{2,}/);
    }
  });
});

/* ---------------------------------------------------------------- *
 * Unit — formatCitation
 * ---------------------------------------------------------------- */

describe("formatCitation — prints the prefix exactly once", () => {
  it("renders a single page with p. and a range with pp.", () => {
    expect(formatCitation({ item: 7, page: "9" })).toBe("Item 7, p. 9");
    expect(formatCitation({ item: 7, page: "9-10" })).toBe("Item 7, pp. 9-10");
    expect(formatCitation({ item: 7, page: "31–35" })).toBe("Item 7, pp. 31–35");
    expect(formatCitation({ item: 7, page: "20, 21" })).toBe("Item 7, pp. 20, 21");
    expect(formatCitation({ item: 20, page: "46" })).toBe("Item 20, p. 46");
  });

  it("treats an exhibit page as one page, not a range", () => {
    // "A-21" contains a hyphen and is a single page. The separator has to be
    // preceded by a digit for this to read as a range.
    expect(formatCitation({ item: 7, page: "A-21" })).toBe("Item 7, p. A-21");
    expect(formatCitation({ item: 7, page: "A-21 to A-24" })).toBe("Item 7, pp. A-21 to A-24");
  });

  it("renders the Item alone when there is no page", () => {
    expect(formatCitation({ item: 19 })).toBe("Item 19");
  });
});

/* ---------------------------------------------------------------- *
 * THE CATALOG SCAN
 * ---------------------------------------------------------------- */

const BRANDS_DIR = resolve(process.cwd(), "data/brands");

/** Every glass shell the catalog can currently produce. */
function glassShells() {
  const files = readdirSync(BRANDS_DIR).filter((f) => f.endsWith(".json"));
  expect(files.length, "no catalog to scan").toBeGreaterThan(50);
  const out: Array<{ file: string; shell: NonNullable<ReturnType<typeof glassDecision>["shell"]> }> = [];
  for (const file of files.sort()) {
    const rec = JSON.parse(readFileSync(join(BRANDS_DIR, file), "utf8")) as BrandRecord;
    let shell = null;
    // `?v=glass` bypasses the launch flag only, so this scan does not change
    // colour when GLASS_ENABLED flips.
    try {
      shell = glassDecision(rec, "glass").shell;
    } catch {
      continue; // the fail-closed test owns adapter throws; this lint owns text
    }
    if (shell) out.push({ file, shell });
  }
  return out;
}

function everyCitation() {
  const out: Array<{ file: string; label: string; text: string; page?: string }> = [];
  for (const { file, shell } of glassShells()) {
    for (const section of shell.sections) {
      for (const line of section.lines) {
        if (!line.citation) continue;
        out.push({
          file,
          label: line.label,
          text: formatCitation(line.citation),
          page: line.citation.page,
        });
      }
    }
  }
  return out;
}

describe("THE CATALOG SCAN — every citation the catalog can render", () => {
  const cites = everyCitation();

  it("scanned a real catalog, not an empty one", () => {
    // Floor. Both numbers were measured, not guessed: 82 qualifying brands,
    // 1,877 cited lines carrying a page. Set well below so a brand going thin
    // does not turn this red, but high enough that a scan of nothing fails.
    expect(cites.length, "citation scan found nothing to scan").toBeGreaterThan(1000);
    expect(new Set(cites.map((c) => c.file)).size).toBeGreaterThan(40);
  });

  it("no citation prints its Item prefix twice", () => {
    const doubled = cites.filter((c) => /Item\s+\d+[\s\S]*Item\s+\d+/i.test(c.text));
    expect(doubled.slice(0, 5)).toEqual([]);
  });

  it("no citation contains a stray page token", () => {
    // "Item 7, p. p. 9" or "Item 7, p. pp. 9-10" — the shape the bug produced.
    const bad = cites.filter((c) => /p{1,2}\.[\s\S]*p{1,2}\./i.test(c.text));
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("every citation matches the one legal rendering", () => {
    const LEGAL = /^Item \d+(?:, pp?\. (?:[A-Za-z]-)?\d+(?:\s*(?:[-–—,]|to)\s*(?:[A-Za-z]-)?\d+)*)?$/;
    const bad = cites.filter((c) => !LEGAL.test(c.text));
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("no citation carries prose — the channel that leaked", () => {
    // A citation is a pointer. Any word in it is an extractor's working note,
    // and working notes are where the masked figures were.
    const bad = cites.filter((c) => /[A-Za-z]{3,}/.test(c.page ?? ""));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

/* ---------------------------------------------------------------- *
 * THE CATALOG SCAN — a citation is not a figure channel
 *
 * Redundant with the shape assertions above, on purpose, and pointed at a
 * different input: the shape tests read the RENDERED citation, these read the
 * RAW `sourcePage` bytes and assert normalization threw the rest away.
 *
 * The floor here is 100, not the leak test's 1,000. That is the whole lesson
 * of this defect: lawn-doctor leaked 675 total units and 5 closures, and a
 * scan with a 1,000 floor sails straight past both. lib/reportShell.test.ts
 * documents its 1,000 floor as a residual gap covered by its structural
 * guard — and the structural guard walks ShellLine's keys, not the strings
 * inside them. That is the seam this file exists to close.
 * ---------------------------------------------------------------- */

/** Digit runs in a string: "Item 20, pp. 9-10" → ["20", "9", "10"]. */
const digitRuns = (s: string) => s.match(/\d+/g) ?? [];

describe("THE CATALOG SCAN — a citation is not a figure channel", () => {
  it("a rendered citation carries the Item and a page reference — no third number", () => {
    // An Item number is one run; a page is one run, or two for a range or a
    // pair. Anything past three means arithmetic rode in on the citation.
    const over = everyCitation()
      .map((c) => ({ ...c, runs: digitRuns(c.text) }))
      .filter((c) => c.runs.length > 3);
    expect(over.slice(0, 5)).toEqual([]);
  });

  it("no figure the page masks survives from the raw sourcePage into the render", () => {
    let checked = 0;
    const leaks: string[] = [];

    for (const { file, shell } of glassShells()) {
      const rendered = shell.sections
        .flatMap((s) => s.lines)
        .map((l) => (l.citation ? formatCitation(l.citation) : ""))
        .join(" | ");
      if (!rendered.trim()) continue;

      const rec = JSON.parse(readFileSync(join(BRANDS_DIR, file), "utf8")) as BrandRecord;
      const ex = (rec.result as { extracted?: Record<string, unknown> })?.extracted ?? {};

      // Every masked figure this brand has, down to 100 — unit counts,
      // closures, transfers, the small numbers the leak test skips.
      const figures = new Set<number>();
      const walk = (v: unknown) => {
        if (typeof v === "number" && Math.abs(v) >= 100) figures.add(Math.round(Math.abs(v)));
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(ex);

      // A page number can legitimately equal a figure (p. 675 exists). So the
      // scan runs against the render with the legal page references removed —
      // what is left is content that had no business surviving.
      const residue = rendered.replace(
        /Item \d+(?:, pp?\. (?:[A-Za-z]-)?\d+(?:\s*(?:[-–—,]|to)\s*(?:[A-Za-z]-)?\d+)*)?/g,
        " ",
      );

      for (const n of figures) {
        checked++;
        for (const r of [String(n), n.toLocaleString("en-US"), `$${n.toLocaleString("en-US")}`]) {
          if (residue.includes(r)) leaks.push(`${file}: ${r}`);
        }
      }
    }

    expect(checked, "no figures were checked — the scan found nothing").toBeGreaterThan(500);
    expect([...new Set(leaks)].slice(0, 10)).toEqual([]);
  });
});
