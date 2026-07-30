/**
 * reportShell.test.ts — the leak test.
 *
 * This is the gate on glass mode. If it fails, a paid figure is reachable from
 * the client and the moat is open. It is not a style check; do not skip it.
 *
 * Two independent guards, deliberately redundant:
 *
 *   STRUCTURAL — every masked slot in the shell is a MaskToken with a closed
 *   key set. Catches someone widening ShellLine with a `raw`/`hint`/`debug`
 *   field, which is how this class of leak actually happens.
 *
 *   TEXTUAL — the serialized shell is scanned for every plausible rendering of
 *   every figure in the source. Catches a value that reaches the shell through
 *   a field nobody thought of, including inside a label or a free chip.
 *
 * Residual gap, stated so nobody assumes it away: bare integers under 1,000
 * with no unit marker are not scanned, because FDD Item numbers and rung
 * numbers collide with them. A leak of a small unitless figure rendered with
 * no symbol would pass. The structural guard is what covers that case.
 */

import { describe, it, expect } from "vitest";

import {
  buildReportShell,
  qualifiesForGlass,
  unlockCopy,
  DEFAULT_GLASS_CONFIG,
  type GlassConfig,
  type ReportSource,
  type Unit,
} from "./reportShell";

import { CRUMBL_SOURCE } from "./reportShell.fixture";

/* ---------------------------------------------------------------- *
 * Forbidden-string generation
 * ---------------------------------------------------------------- */

function renderings(v: number, unit: Unit): string[] {
  const out: string[] = [];
  const a = Math.abs(v);
  const int = Math.round(a);

  if (a >= 1000) {
    out.push(String(int), int.toLocaleString("en-US"), `$${int.toLocaleString("en-US")}`);
  }
  if (unit === "pct") out.push(`${a}%`, `${a.toFixed(1)}%`);
  if (unit === "ratio") out.push(a.toFixed(2));
  if (unit === "years") out.push(a.toFixed(1), `${a.toFixed(1)} yrs`);
  if (unit === "multiple") out.push(`${a.toFixed(1)}x`, `${a.toFixed(1)}×`);
  if (unit.startsWith("usd") && a > 0 && a < 1000) out.push(`$${int}`);

  // Keep anything long enough to be unambiguous, or anything carrying a
  // unit marker. Drops bare 1-2 digit integers, which collide with Item
  // numbers and cash-ladder rung numbers.
  return out.filter((s) => s.length >= 3 || /[^0-9]/.test(s));
}

function forbiddenStrings(source: ReportSource): string[] {
  const set = new Set<string>();
  for (const section of source.sections) {
    for (const fig of section.figures) {
      if (fig.value === null) continue;
      const vals = Array.isArray(fig.value) ? fig.value : [fig.value];
      for (const v of vals) for (const r of renderings(v, fig.unit)) set.add(r);
    }
  }
  return [...set];
}

/* ---------------------------------------------------------------- *
 * Structural walk
 * ---------------------------------------------------------------- */

const MASK_KEYS = new Set(["kind", "width", "parts", "unit", "sign", "lockId"]);
const LINE_KEYS = new Set(["label", "provenance", "value", "note", "citation"]);

describe("reportShell — structural guard", () => {
  const shell = buildReportShell(CRUMBL_SOURCE);

  it("every line value is a MaskToken and nothing else", () => {
    for (const section of shell.sections) {
      for (const line of section.lines) {
        expect(line.value.kind).toBe("mask");
        expect(Object.keys(line.value).sort()).toEqual([...MASK_KEYS].sort());
      }
    }
  });

  it("ShellLine exposes no field that could hold a figure", () => {
    for (const section of shell.sections) {
      for (const line of section.lines) {
        for (const key of Object.keys(line)) {
          expect(LINE_KEYS.has(key)).toBe(true);
        }
      }
    }
  });

  it("lock ids are labels, never values", () => {
    for (const section of shell.sections) {
      for (const line of section.lines) {
        // A lock id may carry a rung number (cash-ladder.1-gross-revenue).
        // It may not carry a thousands-grouped or currency-marked figure.
        expect(line.value.lockId).not.toMatch(/[\d],[\d]{3}/);
        expect(line.value.lockId).not.toMatch(/\$/);
        expect(line.value.lockId).not.toMatch(/\d{4,}/);
      }
    }
  });
});

/* ---------------------------------------------------------------- *
 * Textual scan — the real leak test
 * ---------------------------------------------------------------- */

describe("reportShell — leak test", () => {
  const configs: Array<[string, GlassConfig]> = [
    ["default", DEFAULT_GLASS_CONFIG],
    ["fixed masks", { ...DEFAULT_GLASS_CONFIG, maskWidth: "fixed" }],
    ["sign hidden", { ...DEFAULT_GLASS_CONFIG, revealSign: false }],
    ["severity hidden", { ...DEFAULT_GLASS_CONFIG, revealSeverity: false }],
    ["no capital verdict", { ...DEFAULT_GLASS_CONFIG, freeCapitalVerdict: false }],
  ];

  for (const [name, config] of configs) {
    it(`no source figure survives into the shell — ${name}`, () => {
      const shell = buildReportShell(CRUMBL_SOURCE, config);
      // capitalRange is Item 7 verbatim and ships deliberately when the free
      // capital verdict is on. Exclude it from the scan, assert it separately.
      const { capitalRange, ...rest } = shell;
      const serialized = JSON.stringify(rest);

      const hits = forbiddenStrings(CRUMBL_SOURCE).filter((s) =>
        serialized.includes(s),
      );
      expect(hits).toEqual([]);
    });
  }

  it("the capital range is the one disclosed pair that crosses the gate", () => {
    const on = buildReportShell(CRUMBL_SOURCE, DEFAULT_GLASS_CONFIG);
    expect(on.capitalRange).toEqual(CRUMBL_SOURCE.capitalRange);

    const off = buildReportShell(CRUMBL_SOURCE, {
      ...DEFAULT_GLASS_CONFIG,
      freeCapitalVerdict: false,
    });
    expect(off.capitalRange).toBeNull();
    expect(JSON.stringify(off)).not.toContain("848566");
    expect(JSON.stringify(off)).not.toContain("1472533");
  });
});

/* ---------------------------------------------------------------- *
 * Behaviour
 * ---------------------------------------------------------------- */

describe("reportShell — masks", () => {
  it("method bands stay fixed width even in real-width mode", () => {
    const shell = buildReportShell(CRUMBL_SOURCE, DEFAULT_GLASS_CONFIG);
    const ladder = shell.sections.find((s) => s.id === "cash-ladder")!;
    const cogs = ladder.lines.find((l) => l.label.startsWith("6."))!;
    const labor = ladder.lines.find((l) => l.label.startsWith("7."))!;
    const opex = ladder.lines.find((l) => l.label.startsWith("8."))!;
    const rent = ladder.lines.find((l) => l.label.startsWith("4."))!;
    for (const line of [cogs, labor, opex, rent]) {
      expect(line.value.width).toBe(5);
    }
  });

  it("fixed mode flattens every width", () => {
    const shell = buildReportShell(CRUMBL_SOURCE, {
      ...DEFAULT_GLASS_CONFIG,
      maskWidth: "fixed",
    });
    for (const s of shell.sections) {
      for (const l of s.lines) expect(l.value.width).toBe(5);
    }
  });

  it("ranges render as two parts", () => {
    const shell = buildReportShell(CRUMBL_SOURCE);
    const ladder = shell.sections.find((s) => s.id === "cash-ladder")!;
    const dscr = ladder.lines.find((l) => l.label.startsWith("12."))!;
    expect(dscr.value.parts).toBe(2);
  });

  it("the negative rung is flagged negative — this is the hook", () => {
    const shell = buildReportShell(CRUMBL_SOURCE);
    const ladder = shell.sections.find((s) => s.id === "cash-ladder")!;
    const cash = ladder.lines.find((l) => l.value.lockId === "cash-ladder.cash-after-debt")!;
    expect(cash.value.sign).toBe("negative");
  });

  it("sign is withheld when revealSign is off", () => {
    const shell = buildReportShell(CRUMBL_SOURCE, {
      ...DEFAULT_GLASS_CONFIG,
      revealSign: false,
    });
    for (const s of shell.sections) {
      for (const l of s.lines) expect(l.value.sign).toBe("unknown");
    }
  });
});

describe("reportShell — free content", () => {
  const shell = buildReportShell(CRUMBL_SOURCE);

  it("keeps the honesty notes, which do the selling", () => {
    const ladder = shell.sections.find((s) => s.id === "cash-ladder")!;
    const notes = ladder.lines.map((l) => l.note).filter(Boolean);
    expect(notes.length).toBe(5);
    expect(notes.join(" ")).toContain("The operator has not been paid out of this yet.");
  });

  it("keeps citations — they are pointers, not findings", () => {
    const costs = shell.sections.find((s) => s.id === "what-it-costs")!;
    expect(costs.lines[0].citation).toEqual({ item: 7, page: "28-30" });
    expect(shell.counts.itemsCited).toBeGreaterThan(4);
  });

  it("keeps severity counts when configured, drops them when not", () => {
    const trip = shell.sections.find((s) => s.id === "tripwires")!;
    expect(trip.severityCounts).toEqual({ high: 2, medium: 5, low: 1 });

    const quiet = buildReportShell(CRUMBL_SOURCE, {
      ...DEFAULT_GLASS_CONFIG,
      revealSeverity: false,
    });
    expect(quiet.sections.find((s) => s.id === "tripwires")!.severityCounts).toBeUndefined();
    expect(quiet.badges.every((b) => b.severity === undefined)).toBe(true);
  });
});

describe("reportShell — counts and gating", () => {
  const shell = buildReportShell(CRUMBL_SOURCE);

  it("counts what the hero claims", () => {
    expect(shell.counts.sections).toBe(CRUMBL_SOURCE.sections.length);
    expect(shell.counts.tripwires).toBe(8);
    expect(shell.counts.questions).toBe(14);
    expect(shell.counts.figures).toBeGreaterThan(60);
  });

  it("a thin brand does not get glass mode", () => {
    const thin: ReportSource = {
      ...CRUMBL_SOURCE,
      sections: CRUMBL_SOURCE.sections.slice(0, 1),
    };
    expect(qualifiesForGlass(buildReportShell(thin))).toBe(false);
    expect(qualifiesForGlass(shell)).toBe(true);
  });

  it("unlock copy names the real rung count", () => {
    expect(unlockCopy(shell, "profit").headline).toBe(
      "Unlock all 13 rungs of the cash ladder",
    );
    expect(unlockCopy(shell, null).sub).toContain("cited figures");
  });
});
