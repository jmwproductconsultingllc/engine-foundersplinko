/**
 * lib/coverage.ts — the completeness badge, derived rather than asserted.
 *
 * FE-140 criterion 7 and FE-143 criterion 1 are the same defect on the same
 * surface, so they are one module.
 *
 * What shipped: the document section printed "N Items located and parsed. Every
 * figure above cites one of them." while `documentCheck.appearsComplete` and
 * `documentCheck.warnings` — both extracted, both sitting in the record — were
 * read by nothing. Two Maids' report announced completeness over four disclosed
 * cost columns that went unread across twelve charts. Bark & Mane's announced it
 * while the concept classifier had fallen through to "uncategorized" and drawn
 * generic cost bands, a fact disclosed only in a footnote beneath the ladder.
 *
 * A completeness claim is a claim, and this product's guidepost says claims get
 * checked. So the badge is computed from what the read actually produced, and
 * it cannot say "complete" while a material gap is open.
 *
 * SEVERITY, and why "note" exists. A gap only degrades the badge when its
 * absence says something about THIS FILING. That we have not captured Item 19
 * cost columns on any brand is a fact about our pipeline version, not about the
 * document in front of the reader — degrading every report for it would tell a
 * buyer nothing they can act on and would flatten the signal that matters. It
 * is recorded as a note until extraction can capture those columns, at which
 * point their absence becomes meaningful and the severity should rise.
 */

import type { DiligenceResult } from "./types";
import type { ExtractedFDD } from "./schema";
import type { ScoringResult } from "./scoring";

export type CoverageLevel = "complete" | "partial" | "unverified";
export type GapSeverity = "blocking" | "material" | "note";

export interface CoverageGap {
  id: string;
  severity: GapSeverity;
  /** what is missing, in the buyer's terms */
  what: string;
  /** why it matters to the number they are about to rely on */
  consequence: string;
}

export interface CoverageVerdict {
  level: CoverageLevel;
  /** what the extractor claimed, kept separate from what we concluded */
  claimedComplete: boolean;
  conceptKnown: boolean;
  gaps: CoverageGap[];
  itemsFound: string[];
  warnings: string[];
  /** the badge line itself */
  headline: string;
}

const UNKNOWN_CONCEPTS = new Set(["", "other", "unknown", "uncategorized", "general"]);

export function conceptIsKnown(fdd: ExtractedFDD | null | undefined): boolean {
  const c = fdd?.conceptType;
  return typeof c === "string" && !UNKNOWN_CONCEPTS.has(c.trim().toLowerCase());
}

export function assessCoverage(result: DiligenceResult | null | undefined): CoverageVerdict {
  const fdd = result?.extracted as ExtractedFDD | undefined;
  const scoring = result?.scoring as (ScoringResult & { rentResolution?: unknown }) | undefined;
  const dc = fdd?.documentCheck;
  const gaps: CoverageGap[] = [];

  const claimedComplete = dc?.appearsComplete !== false;
  const conceptKnown = conceptIsKnown(fdd);

  // ── blocking ──────────────────────────────────────────────────────────────
  if (scoring?.item19Unusable) {
    gaps.push({
      id: "top-line",
      severity: "blocking",
      what: "No franchisee revenue figure could be resolved from Item 19.",
      consequence:
        "Every rung of the cash ladder runs on the top line. Without one there is no pro forma, and nothing below it is shown rather than estimated.",
    });
  }
  if (dc?.appearsComplete === false) {
    gaps.push({
      id: "document-incomplete",
      severity: "blocking",
      what: "The filing itself did not read as a complete FDD.",
      consequence:
        "Items may be missing from the document supplied. Confirm you have the full current disclosure document before relying on anything here.",
    });
  }
  if (dc?.appearsScanned) {
    gaps.push({
      id: "scanned",
      severity: "blocking",
      what: "This document is a scan rather than digital text.",
      consequence:
        "Figures were read from images. Check every number that matters against the page it cites.",
    });
  }

  // ── material ──────────────────────────────────────────────────────────────
  if (!conceptKnown) {
    gaps.push({
      id: "concept-type",
      severity: "material",
      what: "The business type could not be classified from the filing.",
      consequence:
        "Cost of goods, labor and occupancy fall back to a general franchise band rather than one fitted to this kind of business. Treat those three rungs as placeholders and validate them against the Item 20 roster.",
    });
  }
  for (const w of (dc?.warnings ?? []).slice(0, 4)) {
    if (typeof w === "string" && w.trim()) {
      gaps.push({
        id: `warning:${w.slice(0, 24)}`,
        severity: "material",
        what: w.trim(),
        consequence: "Raised by the read of this document itself.",
      });
    }
  }
  if (scoring != null && scoring.rentResolution == null && !scoring.item19Unusable) {
    gaps.push({
      id: "rent",
      severity: "material",
      what: "No rent or occupancy figure could be resolved.",
      consequence: "Occupancy is excluded from the margin rather than estimated. Add your own lease quote before comparing this to another brand.",
    });
  }

  // ── note ──────────────────────────────────────────────────────────────────
  const cohorts = fdd?.item19?.cohorts ?? [];
  if (cohorts.length > 0 && !cohorts.some((c) => c?.disclosedCosts)) {
    gaps.push({
      id: "item19-costs",
      severity: "note",
      what: "No Item 19 cost columns were captured for this filing.",
      consequence:
        "Some franchisors publish labor, materials or gross margin beside the revenue column. If this one does, those figures are not yet reflected here — read the Item 19 charts directly.",
    });
  }

  const blocking = gaps.some((g) => g.severity === "blocking");
  const material = gaps.some((g) => g.severity === "material");
  const level: CoverageLevel = blocking ? "unverified" : material ? "partial" : "complete";

  const itemsFound = dc?.itemsFound ?? [];
  const headline =
    level === "complete"
      ? `${itemsFound.length} Items located and parsed. Every figure above cites one of them.`
      : level === "partial"
        ? `${itemsFound.length} Items located and parsed, with ${gaps.filter((g) => g.severity !== "note").length} gap${gaps.filter((g) => g.severity !== "note").length === 1 ? "" : "s"} named below. Read those before relying on the figures above.`
        : "This document could not be read completely enough to model. What follows names exactly what is missing and what to ask for.";

  return { level, claimedComplete, conceptKnown, gaps, itemsFound, warnings: dc?.warnings ?? [], headline };
}
