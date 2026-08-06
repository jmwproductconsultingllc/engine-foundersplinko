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
// Type-only, and from publicFormat (zero imports) rather than publicFigures
// (which reaches resolveBrandFacts). This file is imported BY the client
// component; a value import of the builder here would invert the seam in one
// line. THE SEAM LINT asserts it stays this way.
import type { PublicHook } from "./publicFormat";

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
  /**
   * A contradiction this section found in the FRANCHISOR'S OWN document, stated
   * free, in full, on the teaser.
   *
   * Distinct from `blurb` (context) and from `freeChips` (things the FDD states)
   * because it is neither: it is a thing the FDD FAILS to state consistently,
   * and it is the single most persuasive item on the card. An outlet table that
   * does not close is worth the unlock price by itself, and a buyer who has to
   * pay to find out that it does not close will never pay.
   *
   * SUBJECT TO THE FREE-TEXT SEAM like every other free string, and that is the
   * whole discipline here: a finding may name the contradiction and may not
   * print the figures that contradict. See RULE 5 in lib/churn.ts.
   */
  finding?: string;
  /** Free severity counts; the titles they belong to stay masked. */
  severityCounts?: Partial<Record<Severity, number>>;
  /** Number of masked list rows this section contains beyond `figures`. */
  maskedRows?: number;
  /**
   * STRUCTURAL — this section is a FRAME, not data.
   *
   * The section exists in the product and we have not extracted it for THIS
   * brand yet. The card renders its title, its blurb and its topic chips, and
   * nothing else: no lines, no masks, no row count, no severity counts.
   *
   * The distinction it encodes is the whole reason it exists. A masked line is
   * a PROMISE that a specific value sits behind it and that $199 reveals it. A
   * structural card makes no such promise — it says only "the full report has
   * this section," which is true of every brand in the library. Before this
   * flag the only way to say the second thing was to say the first, so a
   * section with no data had to be dropped entirely, and every new module
   * therefore blocked on extracting a new field across the whole corpus. That
   * was the tax.
   *
   * SET THIS ONLY FOR ABSENCE THAT IS OURS. See lib/sections.ts — a section the
   * paid report deliberately SUPPRESSES (financial-condition at LOW severity)
   * must stay absent, not become structural. Advertising findings the report
   * will never show, about a named franchisor, is a refund at best.
   *
   * ENFORCED, NOT TRUSTED: buildReportShell() throws if a structural section
   * arrives carrying figures, masked rows or severity counts. The one failure
   * that would matter here is a structural card rendering "14 locked" over
   * nothing, and it is not left to a caller to remember.
   */
  structural?: true;
  /**
   * UNDISCLOSED — the franchisor stated there is nothing here, and that
   * statement is the section's content.
   *
   * Inert in exactly the way `structural` is: no figures, no masks, no row
   * count, no contribution to the glass floors. Everything else about it is the
   * opposite. A structural card says "we have not read this"; an undisclosed
   * one says "we read it, and the filing says no". Shipping the second as the
   * first understates the work and buries the finding; shipping the first as
   * the second is a false claim about a named franchisor. They are separate
   * flags for that reason and a section may not carry both — see
   * assertInertSectionsAreEmpty().
   *
   * All three strings are FREE, at every glass config. There is no hidden value
   * behind this card, so masking any part of it would sell a lock over an empty
   * box — the one thing this surface exists to never do.
   */
  undisclosed?: { heading: string; body: string; nextStep: string };
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
  /** See SourceSection.finding. Free, full text, figure-free. */
  finding?: string;
  severityCounts?: Partial<Record<Severity, number>>;
  maskedRows?: number;
  /** Masked figures in this section. Drives the "N figures" chip. */
  figureCount: number;
  /**
   * See SourceSection.structural. When true this section carries no lines and
   * figureCount is 0, so it contributes nothing to counts.figures and cannot
   * satisfy config.requiredSections — qualifiesForGlass() therefore ignores it
   * without needing a special case. That is not an accident of the arithmetic;
   * it is the property the empty-record test in lib/sections.test.ts pins.
   */
  structural?: true;
  /** See SourceSection.undisclosed. Inert like `structural`, and wholly free. */
  undisclosed?: { heading: string; body: string; nextStep: string };
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
  /**
   * Figures that are ALREADY public on /brands and in the SERP snippet, so the
   * hero can tell an ad visitor what they are looking at. NOT built here — see
   * the note at the bottom of buildReportShell(). Null on every path through
   * this file; attached by lib/glassGate.ts.
   *
   * The import is type-only and lib/publicFormat.ts has no imports of its own,
   * so this does not put the resolver anywhere near the client bundle.
   */
  hook: PublicHook | null;
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

/* ------------------------------------------------------------------ *
 * THE FREE-TEXT SEAM.
 *
 * Build-by-omission guarantees that no figure is ever ASSIGNED to a shell
 * field. It never guaranteed that no figure is SPELLED OUT in one, and those
 * are different claims — the second one is the one a visitor can read.
 *
 * What was live when this was written, on 67 of 82 glass brands:
 *
 *   Total units   ▉▉▉▉      (masked)
 *   Opened        ▉▉        (masked)
 *   Closed        ▉         (masked)
 *   Owner turnover ▉▉▉      (masked)
 *     "145 outlets were open at the start of the year: 149 at year end, less
 *      11 opened, plus 7 closed."          <- free note, same card
 *
 * The note is free by design and should be: the honesty copy does more selling
 * than the numbers would. But it was written by someone holding the numbers,
 * and prose is where a figure hides from a build-by-omission proof.
 *
 * Neither existing leak test could see it. The rendered scan keys on a
 * thousands separator, and an outlet count under 1,000 has none. The payload
 * scan walks numeric leaves with a >= 1,000 floor, and a note is a prose
 * string, so it was never a candidate at all. Both floors are load-bearing
 * where they are (see their headers); the hole is that neither instrument
 * pointed at prose.
 *
 * So this one does, and it does it HERE rather than in a test, because a test
 * proves the corpus on disk today and this seam holds for the FDD uploaded
 * tomorrow. A leak throws; lib/glassGate.ts catches every throw and serves the
 * teaser. Fail-open on infrastructure, fail-closed on findings — a brand page
 * that would leak simply does not become glass.
 * ------------------------------------------------------------------ */

/**
 * Structural references, removed before a string is read for figures.
 *
 * A leading "4. " is a list marker — every cash-ladder rung carries one, and a
 * rung whose ordinal happens to equal some figure's value is a coincidence, not
 * a disclosure. "Item 20" and "Items 5–6" are citations; they are the single
 * most common two-digit token in this product's copy and they point at the FDD
 * rather than stating anything from it.
 *
 * These are NOT an allow-list of leaks. An allow-list names values to forgive,
 * which is how a leak test dies. These name two SYNTAXES that are not figures
 * in any report, present or future, and they are removed from the text before
 * any comparison happens — so a value that also appears somewhere else in the
 * same string is still caught.
 */
const LIST_MARKER = /^\s*\d+\.\s+/;
const ITEM_POINTER = /\bItems?\s+\d+(?:\s*[–—-]\s*\d+)?/g;

/**
 * Every number spelled out in a string, however it was formatted.
 *
 * "2,295" and "2295" and "2295.0" are the same leak. Percentages are included:
 * a derived rate is a paid figure and printing "21.4%" in a note gives it away
 * exactly as completely as printing it in the field would.
 */
function spelledOut(text: string): number[] {
  return (text.replace(LIST_MARKER, "").replace(ITEM_POINTER, "Item").match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((m) => Number(m.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n))
    .map(Math.abs);
}

/**
 * Prose, as opposed to a field that happens to be typed `string`.
 *
 * A field holding nothing but a number is not free text — it is a mask width,
 * an Item number or a page cite, and the masks are the other tests' territory.
 * Requiring four consecutive letters is what makes this a PROSE check rather
 * than a second, worse copy of the payload scan.
 */
const isProse = (v: string) => /[A-Za-z]{4}/.test(v);

const figureValues = (f: SourceFigure): number[] =>
  (Array.isArray(f.value) ? f.value : [f.value])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .map(Math.abs);

/* ------------------------------------------------------------------ *
 * PROPERTY ONE — A FIGURE MAY NOT LABEL ITSELF.
 *
 * The strongest form of the leak, and the one no magnitude floor can reach: a
 * label transcribed verbatim from an FDD table heading that states the very
 * number the row is hiding.
 *
 *   Mandatory $20,000/Month Marketing Spend by Month 3     value 20000
 *   Pre-Sale Membership Requirement (150 memberships)      value 150
 *
 * The reader does not have to attribute anything — the label and the mask are
 * the same row. This holds at ANY magnitude, because "(6% of Gross Revenue)"
 * beside a masked 6 is exactly as complete a disclosure as the two above, and
 * a percentage never clears a floor. Attribution is what makes the leak, not
 * size, so this check keys on attribution and has no floor at all.
 *
 * Measured on the 83-brand catalog, 2026-08-03: 0 false positives once the two
 * structural syntaxes above are stripped. Before stripping, the cash ladder's
 * own rung ordinals accounted for every single flag.
 * ------------------------------------------------------------------ */
function assertNoSelfLabelledFigures(source: ReportSource): void {
  const found: string[] = [];
  for (const s of source.sections) {
    for (const f of s.figures) {
      const own = new Set(figureValues(f));
      if (own.size === 0) continue;
      for (const [field, text] of [
        ["label", f.label],
        ["note", f.note],
      ] as const) {
        if (!text || !isProse(text)) continue;
        for (const n of spelledOut(text)) {
          if (own.has(n)) found.push(`${s.id}/${f.label} ${field}: states its own value ${n}`);
        }
      }
    }
  }
  if (found.length > 0) {
    throw new Error(
      `${found.length} figure(s) spell out their own masked value in their own label or note. ` +
        `Rename the row after what it IS, never after what it costs — see THE FREE-TEXT SEAM ` +
        `in lib/reportShell.ts.\n  ${found.join("\n  ")}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * PROPERTY TWO — FREE PROSE MAY NOT SPELL OUT A MASKED FIGURE.
 *
 * The cross-figure case: a note, blurb or chip that names a number belonging to
 * some OTHER row on the report. Unlike property one there is no attribution to
 * key on, so this one does need a floor, and the floor is where attribution
 * stops being possible for the reader either.
 *
 * FREE_TEXT_FLOOR is 100, compared strictly, and the justification is
 * structural rather than fitted: nothing this product counts exceeds 100. The
 * FDD has 23 numbered Items. The cash ladder has 13 rungs. Month markers run to
 * 60 ("Months 37+", "first 24 months"). Percentiles and percentages stop at
 * 100 by definition, which is why the comparison is strict and 100 itself is
 * out. The largest row count in the catalog is 28 ("28 separate charges in the
 * agreement"). So a prose number at or under 100 that matches a masked value is
 * a collision the reader cannot attribute to anything, and above 100 it is a
 * figure.
 *
 * The headroom is deliberate. Fitting the floor to the highest observed
 * collision — 37, at the time of writing — would have taken the next brand
 * with a "Months 60+" row out of glass mode silently.
 *
 * THE RESIDUAL GAP, STATED RATHER THAN PAPERED OVER: an outlet or closure count
 * under 100 spelled out in a note about a DIFFERENT row is not caught here. The
 * counts that started all of this — 224, 179, 54, 9 — are only half covered by
 * this floor. The other half is covered by RULE 5 in lib/churn.ts, which is
 * copy discipline rather than a machine check, and copy discipline is exactly
 * what failed the first time. If a second module ever starts writing prose
 * around Item 20 counts, this floor will not save it.
 *
 * Walks the finished SHELL rather than an enumerated list of fields — note,
 * blurb, title, anchor, freeChips, badge labels and anything added later. An
 * enumerated guard only guards what someone remembered to enumerate, and the
 * next free string added to ShellSection would be exactly the one nobody
 * remembered.
 * ------------------------------------------------------------------ */
const FREE_TEXT_FLOOR = 100;

/** Every distinct number above the floor that a figure on this report is hiding. */
function paidValues(source: ReportSource): Set<number> {
  const out = new Set<number>();
  for (const s of source.sections) {
    for (const f of s.figures) {
      for (const v of figureValues(f)) if (v > FREE_TEXT_FLOOR) out.add(v);
    }
  }
  /* Item 7 crosses the gate by design — it is disclosed, it is already on the
     teaser this page replaces, and the free capital verdict needs it
     client-side. It is the ONE exemption and it is enumerated, not inferred. */
  for (const v of source.capitalRange ?? []) out.delete(Math.abs(v));
  return out;
}

function assertNoSpelledOutFigures(source: ReportSource, shell: unknown): void {
  const paid = paidValues(source);
  if (paid.size === 0) return;

  const found: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (typeof v === "object") {
      for (const k of Object.keys(v as object)) {
        walk((v as Record<string, unknown>)[k], `${path}.${k}`);
      }
      return;
    }
    if (typeof v !== "string" || !isProse(v)) return;
    for (const n of spelledOut(v)) {
      if (paid.has(n)) found.push(`${path}: "${n}" in ${JSON.stringify(v.slice(0, 120))}`);
    }
  };
  walk(shell, "shell");

  if (found.length > 0) {
    throw new Error(
      `Free text on the shell spells out ${found.length} masked figure(s). ` +
        `Free copy names the method, never the components — see THE FREE-TEXT SEAM ` +
        `in lib/reportShell.ts and RULE 5 in lib/churn.ts.\n  ${found.join("\n  ")}`,
    );
  }
}

/**
 * THE INERT SEAM.
 *
 * Two kinds of card render with nothing behind them, for opposite reasons: a
 * STRUCTURAL frame ("the full report has a Leaving section" — a claim about the
 * PRODUCT) and an UNDISCLOSED block ("the filing states there is no Item 19" — a
 * claim about the FILING). Neither is a claim about the RECORD, and neither may
 * ever carry "there are 14 values behind this card". The moment one does, it has
 * become a lock over nothing, which is the single defect on this surface a buyer
 * discovers only after paying.
 *
 * So it is a throw, not a filter. Silently dropping the offending figures would
 * make the bug invisible in exactly the case where it matters: a section
 * function that starts returning data one day and gets left flagged inert.
 * Build fails, someone reads the section function, the flag comes off.
 *
 * A section carrying BOTH flags is also a throw. "We have not read this" and
 * "we read it and it says nothing" cannot both be true, and a card that claims
 * both will be rendered by whichever branch the renderer happens to test first
 * — which is a coin flip between an apology and a finding.
 */
function assertInertSectionsAreEmpty(source: ReportSource): void {
  const bad: string[] = [];
  for (const s of source.sections) {
    if (s.structural && s.undisclosed) {
      bad.push(
        `${s.id}: flagged BOTH structural and undisclosed — "not read yet" and ` +
          `"read, and the filing discloses nothing" are different facts`,
      );
      continue;
    }
    if (!s.structural && !s.undisclosed) continue;
    const kind = s.structural ? "structural" : "undisclosed";
    const carried: string[] = [];
    if (s.figures.length > 0) carried.push(`${s.figures.length} figure(s)`);
    if (s.maskedRows) carried.push(`maskedRows=${s.maskedRows}`);
    if (s.severityCounts) carried.push("severityCounts");
    if (s.finding) carried.push("finding");
    if (carried.length > 0) bad.push(`${s.id} (${kind}): ${carried.join(", ")}`);
  }
  if (bad.length > 0) {
    throw new Error(
      `Inert section(s) carrying data: a structural or undisclosed card must ` +
        `promise nothing, because nothing is behind it. Either drop the data ` +
        `or drop the flag — see SourceSection.structural and ` +
        `SourceSection.undisclosed in lib/reportShell.ts.\n  ${bad.join("\n  ")}`,
    );
  }
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
  /* Runs FIRST, before a single mask is built. The other two seams below check
     what was produced; this one checks what was asked for, and it has to fail
     ahead of the loop or a structural section carrying figures would mint real
     mask tokens on the way to the error. */
  assertInertSectionsAreEmpty(source);

  const sections: ShellSection[] = source.sections.map((s) => {
    /* An undisclosed section short-circuits the mask path for the same reason a
       structural one does, and it is checked FIRST because its card is the more
       specific claim: a section that somehow arrived flagged both would be
       caught by the assertion above, but if that assertion is ever relaxed the
       finding must win over the apology. Its three strings ship verbatim — free
       at every config, because there is nothing behind this card to sell. */
    if (s.undisclosed) {
      const block: ShellSection = {
        id: s.id,
        title: s.title,
        lines: [],
        figureCount: 0,
        undisclosed: { ...s.undisclosed },
      };
      if (s.anchor) block.anchor = s.anchor;
      return block;
    }

    /* A structural section short-circuits the entire mask path. Not "builds
       masks and discards them" — never enters it. Same build-by-omission
       guarantee the rest of this file makes: the code that could leak a figure
       is not reachable, rather than reachable and careful. */
    if (s.structural) {
      const frame: ShellSection = {
        id: s.id,
        title: s.title,
        lines: [],
        figureCount: 0,
        structural: true,
      };
      if (s.blurb) frame.blurb = s.blurb;
      if (s.anchor) frame.anchor = s.anchor;
      if (s.freeChips) frame.freeChips = s.freeChips;
      return frame;
    }

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
    /* Copied through unconditionally, NOT gated on a config flag. A finding is
       free at every glass config there is: it is the reason to unlock, not a
       thing being withheld until you do. */
    if (s.finding) section.finding = s.finding;
    if (s.maskedRows) section.maskedRows = s.maskedRows;
    if (s.severityCounts && config.revealSeverity) {
      section.severityCounts = s.severityCounts;
    }
    return section;
  });

  const allFigures = source.sections.flatMap((s) => s.figures);
  const items = new Set<number>();
  for (const f of allFigures) if (f.citation) items.add(f.citation.item);

  /* Both reducers skip structural sections, and the questions one is the reason
     the rule is worth stating out loud. A structural who-to-call carries its
     topic chips ("Cohorts", "Questions") in freeChips — the same field a real
     one uses to carry the single free QUESTION. Counted naively, a brand with
     no call list would report two questions it does not have, and that number
     is not decorative: it prints in the unlock bar as a thing being bought.
     Structure is free to show and must never be counted as content. */
  const tripwires = source.sections
    .filter((s) => s.id === "tripwires" && !s.structural && !s.undisclosed)
    .reduce((n, s) => n + s.figures.length + (s.maskedRows ?? 0), 0);

  const questions = source.sections
    .filter((s) => s.id === "who-to-call" && !s.structural && !s.undisclosed)
    .reduce((n, s) => n + (s.freeChips?.length ?? 0) + (s.maskedRows ?? 0), 0);

  const badges: ShellBadge[] = source.badges.map((b) =>
    config.revealSeverity ? { ...b } : { label: b.label },
  );

  const shell: ReportShell = {
    brandSlug: source.brandSlug,
    brandName: source.brandName,
    badges,
    sections,
    counts: {
      /* DATA-BACKED sections only. counts.sections is used as a claim about how
         much report there is — "16 sections" — so counting frames in it would
         inflate the pitch by exactly the sections that have nothing behind
         them. shell.sections.length is still the render list; this is the
         number that may be quoted. */
      sections: sections.filter((s) => !s.structural && !s.undisclosed).length,
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
    // ALWAYS null here, and that is the point. This builder's guarantee is that
    // the shell is built by OMISSION: it walks the arithmetic graph and drops
    // every figure on the floor, so there is no code path in this file capable
    // of leaking one. Populating the hook here would mean this function had
    // started ADDING figures back, and lib/reportShell.test.ts's proof would
    // quietly become a claim about which branch happened to run.
    //
    // The hook is attached one layer out, in lib/glassGate.ts, which is the
    // only place holding the BrandRecord anyway. See lib/publicFigures.ts.
    hook: null,
    config,
  };

  /* THE FREE-TEXT SEAM, both properties. The second runs against the FINISHED
     object rather than the pieces — so a field added to the return above is
     covered the day it is added, not the day someone remembers to add it here
     too. See the header blocks above each. */
  assertNoSelfLabelledFigures(source);
  assertNoSpelledOutFigures(source, shell);
  return shell;
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
