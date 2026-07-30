/**
 * reportShell.ts — "glass mode"
 *
 * Builds the *shape* of a diligence report without any of its derived figures.
 *
 * The rule this file enforces, mechanically:
 *
 *     THE WORDS ARE FREE. THE NUMBERS ARE PAID.
 *
 * Section titles, line labels, explanatory prose, provenance labels, counts,
 * and Item/page citations are free. Every derived figure is replaced by a
 * MaskToken — a width bucket and a unit, nothing else.
 *
 * This runs SERVER-SIDE ONLY. The output of buildReportShell() is the entire
 * payload the client is allowed to receive for a locked report. It is built by
 * *omission*: no code path in this file can copy a figure into the shell,
 * because ShellLine has no field that can hold one.
 *
 * DO NOT add a `value`, `raw`, `hint`, `approx`, or `debug` field to ShellLine.
 * DO NOT render the real report and hide it with CSS. `filter: blur()`,
 * `opacity: 0`, `color: transparent`, `-webkit-text-security`, an overlay div,
 * and render-then-remove-in-an-effect all ship the figure to view-source.
 *
 * Guarded by reportShell.test.ts. If that test fails, the moat is open.
 *
 * The adapter that turns a computed brand record into a ReportSource is NOT in
 * this file. It lives in lib/reportSource.ts. See the note at the bottom.
 */

import { BASIS_STYLE } from "./basis";

/* ------------------------------------------------------------------ *
 * Config — the four open decisions, as flags rather than blockers.
 * Flip these in one place; the renderer reads them off the shell.
 * ------------------------------------------------------------------ */

export interface GlassConfig {
  /**
   * "real"  — mask width tracks the digit count of the hidden figure.
   *           More convincing. Leaks order of magnitude.
   * "fixed" — every mask is the same width. Leaks nothing. Reads flatter.
   */
  maskWidth: "real" | "fixed";

  /**
   * Show that a figure is negative (amber, per LABEL LAW) without showing it.
   * This is the single strongest free signal on the page.
   */
  revealSign: boolean;

  /**
   * Show severity words on the header badges and tripwires
   * ("Franchisor financials: high concern", "2 high / 5 medium / 1 low")
   * while the underlying titles and reasons stay masked.
   */
  revealSeverity: boolean;

  /** Keep the free capital slider verdict (below / inside / above Item 7 range). */
  freeCapitalVerdict: boolean;

  /** How many of the diligence call questions render free. Rest are masked. */
  freeQuestionCount: number;

  /**
   * Minimum masked figures for a brand to be allowed into glass mode.
   * Below this the page reads as an empty promise; serve the old teaser.
   * Calibrate from scripts/auditShells.ts before shipping — do not guess.
   *
   * MEASURED, 83-brand catalog, 2026-07-30:
   *   min 41 · p10 74 · p50 91 · p90 110 · max 137
   * The distribution has a real gap at the bottom: two brands at 41 and 47,
   * then nothing until 61. Both of the low two are also missing what-it-costs
   * and tripwires, so the figure count and the section coverage agree about
   * which brands are thin. 55 sits in the gap with headroom on both sides, so
   * a new brand landing at 58 is not excluded by a hair.
   *
   * The old value was 40 and it was a guess. It qualified 83 of 83 — a gate
   * that admits everything is not a gate.
   */
  minFiguresForGlass: number;

  /**
   * Sections that must carry at least one figure or the brand is not eligible,
   * whatever its total.
   *
   * A figure count alone cannot see this: a brand can clear 55 on ladder and
   * fee rows while disclosing no Item 7 range at all, and Item 7 is the ONE
   * figure that crosses to the free side. No what-it-costs means no
   * shell.capitalRange, which means no capital slider — the page's only free
   * interaction — and no anchor for "the numbers are what you are buying."
   */
  requiredSections: readonly string[];
}

export const DEFAULT_GLASS_CONFIG: GlassConfig = {
  maskWidth: "real",
  revealSign: true,
  revealSeverity: true,
  freeCapitalVerdict: true,
  freeQuestionCount: 1,
  minFiguresForGlass: 55,
  requiredSections: ["what-it-costs", "cash-ladder", "ongoing-fees"],
};

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

export type Provenance = "disclosed" | "derived" | "benchmark" | "inferred";

/**
 * The words and the definitions are READ from lib/basis.ts, not retyped here.
 *
 * The bundle arrived with its own hand-typed copy of both maps. They happened
 * to agree on the four words and disagree on three of the four definitions,
 * and the CSS module that came with them had disclosed and derived inverted
 * outright. That is the two-palette defect a second time, in a second file
 * type, and it survived because a hand-typed copy always drifts eventually.
 *
 * "buyer" is deliberately absent from Provenance: the glass page has no buyer
 * figures, because the buyer has not entered anything yet.
 *
 * `basis.ts` imports `Basis` from `ladder.ts` as a TYPE ONLY, so this stays
 * safe for the client bundle — no ladder arithmetic follows it across.
 */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  disclosed: BASIS_STYLE.disclosed.word,
  derived: BASIS_STYLE.derived.word,
  benchmark: BASIS_STYLE.benchmark.word,
  inferred: BASIS_STYLE.inferred.word,
};

/** Free, and the strongest trust asset on the page. Verbatim from the report. */
export const PROVENANCE_LEGEND: Record<Provenance, string> = {
  disclosed: BASIS_STYLE.disclosed.definition,
  derived: BASIS_STYLE.derived.definition,
  benchmark: BASIS_STYLE.benchmark.definition,
  inferred: BASIS_STYLE.inferred.definition,
};

export type Unit =
  | "usd"
  | "usd_month"
  | "usd_year"
  | "pct"
  | "count"
  | "years"
  | "ratio"
  | "multiple"
  | "text";

export type Severity = "high" | "medium" | "low";

export interface Citation {
  /** FDD Item number, e.g. 7. Free — it is a pointer, not a finding. */
  item: number;
  /** Printed page or range as it appears in the document, e.g. "28-30". */
  page?: string;
}

/* ------------------------------------------------------------------ *
 * Source — what the build thread maps the computed brand record into.
 *
 * This is the ONLY seam. Everything below it is figure-free by construction.
 * ------------------------------------------------------------------ */

/** A single figure or range as it exists in the computed record. */
export type SourceValue = number | [number, number] | null;

export interface SourceFigure {
  /** Free. Rendered as-is. */
  label: string;
  /** PAID. Never leaves this module. */
  value: SourceValue;
  unit: Unit;
  provenance: Provenance;
  /** Free. The honesty notes do more selling than the numbers would. */
  note?: string;
  citation?: Citation;
  /**
   * Stable label for telemetry (`locked_value_engaged.lock_id`).
   * Auto-derived from section + label if omitted. NEVER derived from value.
   */
  lockId?: string;
  /**
   * Set true for figures whose *magnitude* is itself the product — the
   * benchmark bands (28-33% COGS, 22-28% labor, 6-10% opex, 6-10% occupancy).
   * These always render fixed-width regardless of config, because a real-width
   * mask on "28-33%" is close to readable.
   */
  isMethodBand?: boolean;
}

export interface SourceSection {
  id: string;
  title: string;
  /** Free. One line of context under the title. */
  blurb?: string;
  /** Quick-nav anchor label, if this section is in the nav rail. */
  anchor?: string;
  figures: SourceFigure[];
  /**
   * Free text chips — Item numbers found, leadership names, a sample question.
   * MUST NOT contain a derived figure. Validated by the leak test.
   */
  freeChips?: string[];
  /** Free severity counts; the titles they belong to stay masked. */
  severityCounts?: Partial<Record<Severity, number>>;
  /** Number of masked list rows this section contains beyond `figures`. */
  maskedRows?: number;
}

export interface SourceBadge {
  label: string;
  severity?: Severity;
}

export interface ReportSource {
  brandSlug: string;
  brandName: string;
  /** Header alert badges: "1 document warning", "3 things to verify", ... */
  badges: SourceBadge[];
  sections: SourceSection[];
  /** Item 7 disclosed range, used by the free capital verdict only. */
  capitalRange?: [number, number];
  /** Count of cash-ladder rungs, for the unlock-bar copy. */
  ladderRungs?: number;
}

/* ------------------------------------------------------------------ *
 * Shell — what the client receives. No field here can hold a figure.
 * ------------------------------------------------------------------ */

export type MaskWidth = 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface MaskToken {
  readonly kind: "mask";
  /** Character-width bucket. With maskWidth:"fixed" this is always 5. */
  width: MaskWidth;
  /** 2 when the hidden figure is a range: two masks joined by RANGE_SEP. */
  parts: 1 | 2;
  unit: Unit;
  /** "negative" is the hook. "unknown" when revealSign is off. */
  sign: "positive" | "negative" | "unknown";
  /** Telemetry label. A name, never a number. */
  lockId: string;
}

export interface ShellLine {
  label: string;
  provenance: Provenance;
  value: MaskToken;
  note?: string;
  citation?: Citation;
}

export interface ShellSection {
  id: string;
  title: string;
  blurb?: string;
  anchor?: string;
  lines: ShellLine[];
  freeChips?: string[];
  severityCounts?: Partial<Record<Severity, number>>;
  maskedRows?: number;
  /** Masked figures in this section. Drives the "N figures" chip. */
  figureCount: number;
}

export interface ShellBadge {
  label: string;
  severity?: Severity;
}

export interface ShellCounts {
  sections: number;
  figures: number;
  citations: number;
  /** Distinct FDD Items cited anywhere in the report. */
  itemsCited: number;
  tripwires: number;
  questions: number;
}

export interface ReportShell {
  brandSlug: string;
  brandName: string;
  badges: ShellBadge[];
  sections: ShellSection[];
  counts: ShellCounts;
  /** Item 7 range for the free capital verdict — see note below. */
  capitalRange: [number, number] | null;
  ladderRungs: number;
  config: GlassConfig;
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

const FIXED_WIDTH: MaskWidth = 5;

function clampWidth(n: number): MaskWidth {
  if (n <= 2) return 2;
  if (n >= 8) return 8;
  return n as MaskWidth;
}

/**
 * Display length of a figure, WITHOUT ever returning the figure.
 * Only the character count escapes this function.
 */
function displayLength(v: number, unit: Unit): number {
  const abs = Math.abs(v);
  switch (unit) {
    case "pct":
      // "8%" / "28%" / "9.4%"
      return (Number.isInteger(abs) ? String(abs) : abs.toFixed(1)).length + 1;
    case "ratio":
      // "1.25"
      return abs.toFixed(2).length;
    case "multiple":
      // "9.4x"
      return abs.toFixed(1).length + 1;
    case "years":
      // "4.2 yrs"
      return abs.toFixed(1).length + 4;
    case "count":
      return Math.round(abs).toLocaleString("en-US").length;
    case "text":
      return FIXED_WIDTH;
    default: {
      // "$848,566" / "$650/mo"
      const body = Math.round(abs).toLocaleString("en-US").length + 1;
      if (unit === "usd_month") return body + 3;
      if (unit === "usd_year") return body + 3;
      return body;
    }
  }
}

function slugifyLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function buildMask(
  fig: SourceFigure,
  sectionId: string,
  config: GlassConfig,
): MaskToken {
  const isRange = Array.isArray(fig.value);
  const lockId = fig.lockId ?? `${sectionId}.${slugifyLabel(fig.label)}`;

  let width: MaskWidth = FIXED_WIDTH;
  if (config.maskWidth === "real" && !fig.isMethodBand && fig.value !== null) {
    const probe = Array.isArray(fig.value) ? fig.value[1] : fig.value;
    width = clampWidth(displayLength(probe, fig.unit));
  }

  let sign: MaskToken["sign"] = "unknown";
  if (config.revealSign && fig.value !== null) {
    const low = Array.isArray(fig.value) ? fig.value[0] : fig.value;
    sign = low < 0 ? "negative" : "positive";
  }

  return {
    kind: "mask",
    width,
    parts: isRange ? 2 : 1,
    unit: fig.unit,
    sign,
    lockId,
  };
}

export function buildReportShell(
  source: ReportSource,
  config: GlassConfig = DEFAULT_GLASS_CONFIG,
): ReportShell {
  const sections: ShellSection[] = source.sections.map((s) => {
    const lines: ShellLine[] = s.figures.map((f) => {
      const line: ShellLine = {
        label: f.label,
        provenance: f.provenance,
        value: buildMask(f, s.id, config),
      };
      if (f.note) line.note = f.note;
      if (f.citation) line.citation = f.citation;
      return line;
    });

    const section: ShellSection = {
      id: s.id,
      title: s.title,
      lines,
      figureCount: lines.length + (s.maskedRows ?? 0),
    };
    if (s.blurb) section.blurb = s.blurb;
    if (s.anchor) section.anchor = s.anchor;
    if (s.freeChips) section.freeChips = s.freeChips;
    if (s.maskedRows) section.maskedRows = s.maskedRows;
    if (s.severityCounts && config.revealSeverity) {
      section.severityCounts = s.severityCounts;
    }
    return section;
  });

  const allFigures = source.sections.flatMap((s) => s.figures);
  const items = new Set<number>();
  for (const f of allFigures) if (f.citation) items.add(f.citation.item);

  const tripwires = source.sections
    .filter((s) => s.id === "tripwires")
    .reduce((n, s) => n + s.figures.length + (s.maskedRows ?? 0), 0);

  const questions = source.sections
    .filter((s) => s.id === "who-to-call")
    .reduce((n, s) => n + (s.freeChips?.length ?? 0) + (s.maskedRows ?? 0), 0);

  const badges: ShellBadge[] = source.badges.map((b) =>
    config.revealSeverity ? { ...b } : { label: b.label },
  );

  return {
    brandSlug: source.brandSlug,
    brandName: source.brandName,
    badges,
    sections,
    counts: {
      sections: sections.length,
      figures: sections.reduce((n, s) => n + s.figureCount, 0),
      citations: allFigures.filter((f) => f.citation).length,
      itemsCited: items.size,
      tripwires,
      questions,
    },
    // The capital range is the ONE disclosed figure pair that crosses the
    // gate, and only because the free capital verdict needs it client-side.
    // It is Item 7, stated verbatim in the FDD — disclosed, not derived, and
    // therefore not moat. If freeCapitalVerdict is off it does not ship.
    capitalRange: config.freeCapitalVerdict ? (source.capitalRange ?? null) : null,
    ladderRungs: source.ladderRungs ?? 0,
    config,
  };
}

/**
 * A brand too thin to carry the glass layout should not get it.
 *
 * Two independent gates, both of which must pass. The count catches brands
 * that are thin everywhere; requiredSections catches the brand that is fat on
 * ladder rows and silent on Item 7 — a shape a total cannot see.
 *
 * READY IS EARNED, NEVER INHERITED: every early return here is false.
 */
export function qualifiesForGlass(
  shell: ReportShell,
  config: GlassConfig = DEFAULT_GLASS_CONFIG,
): boolean {
  if (shell.counts.figures < config.minFiguresForGlass) return false;

  const withFigures = new Set(
    shell.sections.filter((s) => s.figureCount > 0).map((s) => s.id),
  );
  for (const id of config.requiredSections) {
    if (!withFigures.has(id)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Unlock-bar copy — intent-driven, from the ?intent= param.
 * ------------------------------------------------------------------ */

export type Intent = "cost" | "profit" | "invest" | null;

export function unlockCopy(
  shell: ReportShell,
  intent: Intent,
): { headline: string; sub: string } {
  const c = shell.counts;
  const sub = `${c.sections} sections · ${c.figures} cited figures · instant access`;
  switch (intent) {
    case "cost":
      return { headline: "Unlock the full cost-to-open breakdown", sub };
    case "profit":
      return {
        headline: `Unlock all ${shell.ladderRungs} rungs of the cash ladder`,
        sub: "Down to cash after debt · DSCR · payback years",
      };
    case "invest":
      return {
        headline: `Unlock ${c.figures} cited figures and ${c.tripwires} tripwires`,
        sub: `${c.sections} sections · every figure cited to Item + page`,
      };
    default:
      return { headline: "Unlock the full diligence report", sub };
  }
}

/* ------------------------------------------------------------------ *
 * ADAPTER SEAM — deliberately NOT in this file.
 *
 * The handoff put reportSourceFromComputed() here. It cannot stay here.
 *
 * ReportGlass.tsx is a client component and it imports this module — for the
 * types, for PROVENANCE_LABEL, for unlockCopy. An adapter living here would
 * import ladder.ts, ladderInput.ts, callList.ts, churn.ts, verify.ts and
 * rentCorrection.ts, and every one of those would follow this module into the
 * client bundle. Nothing would leak on day one. But the whole design of this
 * file is that the client is never handed a module that CAN produce a figure,
 * and shipping buildCashLadder to the browser hands it exactly that. The
 * defence stops being structural and becomes a promise that nobody edits the
 * wrong file.
 *
 * So the adapter is lib/reportSource.ts, server-only, importing FROM here and
 * never the reverse. This module still has no dependency that computes
 * anything. Callers:
 *
 *   import { reportSourceFromComputed } from "@/lib/reportSource";
 *   import { buildReportShell } from "@/lib/reportShell";
 * ------------------------------------------------------------------ */
