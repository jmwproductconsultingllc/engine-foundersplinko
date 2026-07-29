/**
 * lib/ladderInput.ts
 * The single place a real report becomes a cash ladder.
 *
 * lib/ladder.ts is pure arithmetic over a LadderInput. This module is the only
 * thing that knows how to build that input from a stored DiligenceResult —
 * which cohort is the top line, which rent figure won, which category bands
 * apply, and whether there is a lender in the deal at all. Every surface that
 * wants ladder numbers calls buildLadderInput() and then buildCashLadder(); no
 * surface reconstructs a rung on its own.
 *
 * Two rules this module exists to enforce:
 *
 *  1. NEVER RECOMPUTE A RUNG YOU CAN READ. The report used to derive operating
 *     EBITDA in three places with three different definitions. Now there is one
 *     ladder object per render and every figure is read off it.
 *
 *  2. FOUR FEES DO NOT FIT IN THREE SLOTS. ongoingFees carried royalty /
 *     brandFund / localAd and nothing else, so Noodles & Co.'s 1.25% technology
 *     fee had nowhere to live and rung 2 understated the deal by 1.25 points of
 *     revenue. resolvePercentageFees() reads the new complete percentageFees
 *     list when a record has one and falls back to the three named slots when it
 *     does not — so nothing already minted changes, and new extractions are right.
 */

import type { ExtractedFDD } from "./schema";
import type { ScoringResult } from "./scoring";
import { RUBRIC } from "./scoring";
import type { DiligenceResult } from "./types";
import type { RentResolution } from "./rent";
import { costBandsFor } from "./insights";
import { normalizeRoyaltyPct } from "./fees";
import type { Basis, CostStructure, Financing, LadderInput } from "./ladder";

/* ─────────────────────────── percentage fees ─────────────────────────── */

export interface ResolvedPercentageFee {
  label: string;
  /** whole-number percent of gross sales: 5 means 5% */
  pct: number;
  source: string;
}

export interface PercentageFeeResolution {
  fees: ResolvedPercentageFee[];
  /** sum of fees[].pct — the number rung 2 runs on */
  totalPct: number;
  /** true when the record carries the complete Item 6 percentage list */
  complete: boolean;
  /** plain-language caveat when we are working from the three named slots only */
  note: string | null;
}

/** Does an entry in the complete list already cover one of the named slots? */
function coversSlot(fees: ResolvedPercentageFee[], keyword: RegExp, pct: number): boolean {
  for (const f of fees) {
    if (keyword.test(f.label.toLowerCase())) return true;
    if (Math.abs(f.pct - pct) < 0.005) return true;
  }
  return false;
}

/**
 * The canonical list of continuing percentage-of-sales fees for a brand.
 *
 * When ongoingFees.percentageFees is present it is authoritative — the three
 * named slots are deduped against it rather than added on top, so a royalty
 * disclosed in both places is charged once. A named slot that the list somehow
 * misses is appended rather than dropped: understating the fee load is the exact
 * defect this function exists to fix, so the failure mode leans the other way.
 */
export function resolvePercentageFees(fdd: ExtractedFDD | null | undefined): PercentageFeeResolution {
  const f = fdd?.ongoingFees;
  const royalty = normalizeRoyaltyPct(f?.royaltyPct);
  const brand = normalizeRoyaltyPct(f?.brandFundPct);
  const localAd = normalizeRoyaltyPct(f?.localAdPct);

  const listed = (f?.percentageFees ?? [])
    .map((p) => ({
      label: (p?.label ?? "").trim(),
      pct: normalizeRoyaltyPct(p?.pct),
      source: p?.source ?? "Item 6",
    }))
    .filter((p): p is ResolvedPercentageFee => !!p.label && p.pct != null && p.pct > 0);

  if (listed.length > 0) {
    const fees = [...listed];
    if (royalty != null && royalty > 0 && !coversSlot(fees, /royalt/, royalty)) {
      fees.push({ label: "Royalty", pct: royalty, source: "Item 6" });
    }
    if (brand != null && brand > 0 && !coversSlot(fees, /brand|national|marketing fund|ad fund/, brand)) {
      fees.push({ label: "Brand fund", pct: brand, source: "Item 6" });
    }
    if (localAd != null && localAd > 0 && !coversSlot(fees, /local/, localAd)) {
      fees.push({ label: "Local advertising", pct: localAd, source: "Item 6" });
    }
    return {
      fees,
      totalPct: round2(fees.reduce((a, x) => a + x.pct, 0)),
      complete: true,
      note: null,
    };
  }

  // Fallback: the three named slots. Identical arithmetic to what every already
  // minted report ran on, so nothing stored moves when this module ships.
  const fees: ResolvedPercentageFee[] = [];
  if (royalty != null && royalty > 0) fees.push({ label: "Royalty", pct: royalty, source: "Item 6" });
  if (brand != null && brand > 0) fees.push({ label: "Brand fund", pct: brand, source: "Item 6" });
  if (localAd != null && localAd > 0) fees.push({ label: "Local advertising", pct: localAd, source: "Item 6" });

  return {
    fees,
    totalPct: round2(fees.reduce((a, x) => a + x.pct, 0)),
    complete: false,
    note:
      fees.length > 0
        ? "This brand's record predates the full Item 6 fee capture, so the percentage fees shown are the royalty, brand fund, and local advertising lines only. If Item 6 also charges a technology or software fee as a percentage of sales, the fee load below is understated — read Item 6 and add it."
        : "No percentage-of-sales fee is recorded for this brand. Read Item 6 before treating the margin below as the fee load: some brands take a markup on required purchases instead of a sales royalty, and that cost lands in cost of goods rather than here.",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ───────────────────────────── the input ───────────────────────────── */

export interface BuildLadderInputOptions {
  /**
   * Explicit financing for this render.
   *   undefined → derive from underwriting (the recommended loan)
   *   null      → all cash, no lender (FE-116)
   *   Financing → the buyer's own loan / rate / term from the report controls
   */
  financing?: Financing | null;
}

type ScoringWithRent = ScoringResult & {
  rentResolution?: RentResolution | null;
  fixedFeesMonthly?: number;
};

/** RentResolution provenance → ladder provenance. An override is a BUYER figure;
 *  it is never relabeled as a disclosure. */
function rentBasisFor(r: RentResolution | null): Basis {
  if (!r) return "benchmark";
  if (r.basis === "override") return "buyer";
  if (r.basis === "benchmark") return "benchmark";
  return "disclosed";
}

function revenueSourceText(c: ScoringResult["midCohort"]): string {
  if (!c) return "No Item 19 figure resolved";
  const s = c.source;
  if (!s) return c.label;
  return s.math ? `${s.label} — ${s.math}` : s.label;
}

/**
 * Turn a stored, rent-corrected DiligenceResult into the ladder's input.
 * Callers should pass a result that has already been through
 * applyRentCorrection / applyRentOverride, exactly as the report does.
 */
export function buildLadderInput(
  result: DiligenceResult,
  opts: BuildLadderInputOptions = {},
): LadderInput {
  const fdd = result.extracted;
  const s = result.scoring as ScoringWithRent;
  const cohort = s?.midCohort ?? null;

  const pctFees = resolvePercentageFees(fdd);

  const fixedFees = (fdd?.ongoingFees?.flatMonthlyFees ?? [])
    .filter((x) => (x?.monthlyAmount ?? 0) > 0)
    .map((x) => ({ label: x.name, monthly: x.monthlyAmount as number }));

  const rentRes = s?.rentResolution ?? null;
  const rentMonthly =
    rentRes != null
      ? rentRes.mid
      : fdd?.averageRentMonthly != null && fdd.averageRentMonthly > 0
        ? fdd.averageRentMonthly
        : null;

  const bands = costBandsFor(fdd?.conceptType, fdd?.staffingModel);
  const costs: CostStructure = {
    cogsPct: bands.cogsPct,
    laborPct: bands.laborPct,
    otherOpexPct: bands.otherOpexPct,
    occupancyPct: bands.occupancyPct,
    basis: "benchmark",
    // Block-level provenance. It is stated ONCE, under the table (ladder.blockNote),
    // because it is identical for rungs 6, 7 and 8 — the part that differs between
    // them is the band, and the band is now each rung's own source line.
    source: `Rungs 6, 7 and 8 are ${bands.label} category bands`,
    // C0. The previous wording said these costs "are never disclosed in an FDD"
    // and sent the reader to Item 20 for "real franchisee numbers". Both halves
    // were wrong. Item 19 is voluntary but roughly half of the brands on file
    // publish a profitability cohort, and a quarter of them break out cost of
    // goods, labor or occupancy inside it — so "never" is false, and the founder
    // reading his own product caught it, which means a buyer would too. Item 20
    // meanwhile carries no cost figures at all: by 16 CFR 436.5(t) it is outlet
    // counts and the franchisee roster. What makes it the right pointer is the
    // roster — the people who have the numbers, with their phone numbers.
    note:
      "These three rungs are category bands, not this brand's figures — an FDD is not required to disclose cost of goods, labor, or operating costs, and no such figures were read from this one. Item 20 does not carry cost figures either; what it carries is every current franchisee, by name and phone. Call three in markets like yours and ask what they actually run for food cost, labor and rent before you sign.",
  };

  const financing = resolveFinancing(result, opts);

  return {
    monthlyRevenue: cohort?.monthlyRevenue ?? null,
    revenueLabel: cohort?.label ?? "Item 19 top line",
    revenueSource: revenueSourceText(cohort),
    revenueOwnership: cohort?.source?.ownership ?? undefined,
    feePcts: pctFees.fees.map((x) => ({ label: x.label, pct: x.pct })),
    fixedFees,
    rentMonthly,
    rentBasis: rentBasisFor(rentRes),
    rentSource: rentRes?.source ?? (rentMonthly != null ? "FDD rent disclosure" : "Not disclosed"),
    costs,
    buildoutMidpoint: s?.buildoutMidpoint ?? null,
    financing,
  };
}

/**
 * FE-116 lives here. A buyer whose liquid capital covers the build-out has a
 * recommended loan of zero, and zero is not a small loan — it is no lender.
 * Returning null (rather than a $0 loan) is what makes the ladder say "none"
 * and "not applicable" on rungs 10 and 12 instead of rendering dead $0 rows.
 */
function resolveFinancing(
  result: DiligenceResult,
  opts: BuildLadderInputOptions,
): Financing | null {
  if (opts.financing !== undefined) {
    const f = opts.financing;
    if (!f || !(f.loan > 0)) return null;
    return f;
  }
  const loan = result.underwriting?.recommendedLoan ?? null;
  if (loan == null || !(loan > 0)) return null;
  return {
    loan,
    ratePct: RUBRIC.defaultSbaRate,
    termYears: RUBRIC.defaultSbaTermYears,
  };
}
