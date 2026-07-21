// lib/rent.ts — THE rent resolver (rent-resolver hotfix spec, 2026-07-21).
//
// THE INVARIANT (permanent): a line labeled as containing rent must contain a
// rent value — disclosed, or a tagged estimate. $0-by-null is never rendered
// inside a labeled line. If rent is truly unresolvable, the pro-forma line
// SPLITS and says "not disclosed" out loud.
//
// Motivating bug (Crumbl, live paid report): "Fixed costs (fees + rent) −$720"
// was flat fees only — rent silently $0 because averageRentMonthly was null
// (Crumbl discloses rent as a RANGE, $50K–$250K/yr). Every downstream figure
// (margin, net cash flow, DSCR, coversCosts, payback, underwriting assessment)
// inherited the understatement. scoring.notes knew; the UI didn't.
//
// Pure, deterministic, golden-tested (lib/rent.test.ts) — the fees.ts pattern.
//
// Strict priority:
//   1. averageRentMonthly (single disclosed number)        → basis "disclosed"
//   2. rentDetail.rawValue + unit, normalized to monthly    → basis "disclosed"
//   3. disclosed annual lease RANGE parsed from rent text   → basis "disclosed_range"
//   4. Item 7 rent line item ÷ its month horizon            → basis "disclosed_range"
//   5. category occupancy band × the SAME headline monthly
//      revenue the pro forma uses                           → basis "benchmark"
//   6. null → the UI split-line rule applies.
// When both a disclosed range (3/4) and a benchmark (5) exist: benchmark inside
// the disclosed range wins (tighter, category-calibrated); disjoint → disclosed
// range wins and the resolution is flagged for review in the audit table.
// UI shows the RANGE; math uses mid.

import type { ExtractedFDD } from "./schema";
import { occupancyBandFor } from "./insights";

export interface RentResolution {
  lo: number; // monthly $
  hi: number; // monthly $
  mid: number; // simple midpoint — what the math uses
  /** "override" is never emitted by the resolver — only by applyRentOverride
   *  (lib/rentCorrection.ts) when the buyer enters their own figure. */
  basis: "disclosed" | "disclosed_range" | "benchmark" | "override";
  source: string;
  /** benchmark and disclosed range were DISJOINT — surfaced in the audit table */
  reviewFlag?: boolean;
}

const round0 = (n: number) => Math.round(n);

function mk(
  lo: number,
  hi: number,
  basis: RentResolution["basis"],
  source: string,
  reviewFlag?: boolean,
): RentResolution {
  const l = round0(Math.min(lo, hi));
  const h = round0(Math.max(lo, hi));
  return { lo: l, hi: h, mid: round0((l + h) / 2), basis, source, ...(reviewFlag ? { reviewFlag } : {}) };
}

/** Tier 3 regex: "$50,000 - $250,000 per year" / "$50,000–$250,000/yr" etc. */
const ANNUAL_RANGE_RE =
  /\$?\s*([\d,]{4,})\s*(?:-|–|—|to)\s*\$?\s*([\d,]{4,})\s*(?:\/|per\s*)?(?:yr|year|annum)/i;

const num = (s: string) => Number(s.replace(/,/g, ""));

/**
 * Resolve monthly rent for a brand. `headlineMonthly` is the SAME monthly
 * revenue figure the pro forma is built on (mid-cohort / network average) —
 * required for the tier-5 occupancy benchmark; pass null if unavailable and
 * tier 5 simply won't fire.
 */
export function resolveMonthlyRent(
  fdd: ExtractedFDD | null | undefined,
  headlineMonthly: number | null,
): RentResolution | null {
  if (!fdd) return null;
  const rd = (fdd as any)?.rentDetail ?? null;

  // ── 1 · single disclosed monthly number ──────────────────────────────────
  const avg = (fdd as any)?.averageRentMonthly;
  if (typeof avg === "number" && avg > 0) {
    return mk(avg, avg, "disclosed", rd?.source ?? "FDD rent disclosure");
  }

  // ── 2 · rentDetail raw value + unit, normalized ──────────────────────────
  if (typeof rd?.rawValue === "number" && rd.rawValue > 0 && rd.unit && rd.unit !== "unknown") {
    const sqft = typeof rd.squareFootage === "number" && rd.squareFootage > 0 ? rd.squareFootage : null;
    let monthly: number | null = null;
    if (rd.unit === "per_month") monthly = rd.rawValue;
    else if (rd.unit === "per_year") monthly = rd.rawValue / 12;
    else if (rd.unit === "per_sqft_per_year" && sqft) monthly = (rd.rawValue * sqft) / 12;
    else if (rd.unit === "per_sqft_per_month" && sqft) monthly = rd.rawValue * sqft;
    if (monthly != null && monthly > 0) {
      return mk(monthly, monthly, "disclosed", rd?.source ?? "FDD rent disclosure");
    }
  }

  // ── 3 · disclosed annual lease range parsed from rent text ───────────────
  // Deposit / improvement / design lines are NEVER rent (a "Lease Deposit"
  // is a one-time outlay — the schema warns about exactly this confusion).
  const NOT_RENT_RE = /deposit|improvement|architect|design|construction|build[- ]?out/i;
  let envelope: RentResolution | null = null;
  const texts: Array<[string, string]> = [];
  if (typeof rd?.source === "string") texts.push([rd.source, rd.source]);
  for (const li of fdd.item17?.lineItems ?? []) {
    const t = `${li.category ?? ""} ${li.notes ?? ""}`;
    if (/rent|lease|occupanc/i.test(t) && !NOT_RENT_RE.test(t)) texts.push([t, li.category ?? "Item 7"]);
  }
  for (const [t, src] of texts) {
    const m = ANNUAL_RANGE_RE.exec(t);
    if (m) {
      const lo = num(m[1]) / 12;
      const hi = num(m[2]) / 12;
      if (lo > 0 && hi >= lo) {
        envelope = mk(lo, hi, "disclosed_range", `disclosed annual lease range (${src.slice(0, 60)})`);
        break;
      }
    }
  }

  // ── 4 · Item 7 rent-PAYMENT lines ÷ their disclosed month horizon ────────
  // Aggregated across matching lines: multi-format brands (free-standing /
  // in-line / express) disclose one rent line per format — the honest envelope
  // spans all of them, and the tier-5 benchmark then narrows it.
  if (!envelope) {
    let aggLo: number | null = null;
    let aggHi: number | null = null;
    let months0: number | null = null;
    let src0 = "";
    for (const li of fdd.item17?.lineItems ?? []) {
      const t = `${li.category ?? ""} ${li.notes ?? ""}`;
      if (!/rent|rental|lease/i.test(t) || NOT_RENT_RE.test(t)) continue;
      const hm = /(?:first\s*)?(\d+)\s*[- ]?\s*month/i.exec(t);
      if (!hm) continue;
      const months = Number(hm[1]);
      if (months < 1 || months > 12) continue;
      if (li.low != null && li.high != null && li.low > 0 && li.high >= li.low) {
        const lo = li.low / months;
        const hi = li.high / months;
        aggLo = aggLo == null ? lo : Math.min(aggLo, lo);
        aggHi = aggHi == null ? hi : Math.max(aggHi, hi);
        if (!months0) {
          months0 = months;
          src0 = (li.category ?? "rent").slice(0, 50);
        }
      }
    }
    if (aggLo != null && aggHi != null) {
      envelope = mk(aggLo, aggHi, "disclosed_range", `Item 7 rent lines ÷ ${months0} months (e.g. "${src0}")`);
    }
  }

  // ── 5 · category occupancy benchmark × the pro forma's own top line ──────
  let bench: RentResolution | null = null;
  if (headlineMonthly != null && headlineMonthly > 0) {
    const band = occupancyBandFor(fdd.conceptType ?? "other");
    if (band) {
      bench = mk(
        (headlineMonthly * band[0]) / 100,
        (headlineMonthly * band[1]) / 100,
        "benchmark",
        `${band[0]}–${band[1]}% category occupancy × modeled revenue`,
      );
    }
  }

  // ── combine ──────────────────────────────────────────────────────────────
  if (envelope && bench) {
    // benchmark inside the disclosed envelope → keep benchmark (tighter).
    if (bench.lo >= envelope.lo - 1 && bench.hi <= envelope.hi + 1) return bench;
    // partial overlap → intersect, keep benchmark basis.
    const iLo = Math.max(bench.lo, envelope.lo);
    const iHi = Math.min(bench.hi, envelope.hi);
    if (iLo <= iHi) return mk(iLo, iHi, "benchmark", `${bench.source}, bounded by ${envelope.source}`);
    // disjoint → trust the disclosure, flag for review.
    return { ...envelope, reviewFlag: true };
  }
  return envelope ?? bench ?? null;
}
