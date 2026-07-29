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
 * THE PLAUSIBILITY GATE — the most rent a real location can pay.
 *
 * Motivating bug (Row House, live paid report 13d8381d): rung 4 rendered
 * "− Rent & occupancy $300,000" against a disclosed top line of $27,129/mo.
 * Rent at 1,106% of revenue. Every rung below it inherited the impossibility —
 * operating EBITDA −$292,042, DSCR −247, "never, at the modeled costs" — and
 * the report was, to a buyer, unreadable.
 *
 * The resolver's tier-1 and tier-2 paths trusted a single extracted number
 * with no check against the revenue it was about to be subtracted from. That
 * is the whole defect. It is not specific to Row House and it is not fixable
 * in an extraction prompt: any model, on any FDD, can put an Item 7 total or a
 * mis-united per-sqft rate in a rent field. Code has to be the one that
 * refuses.
 *
 * THE RULE: a figure that cannot be true is not a disclosure.
 *
 * The ceiling is deliberately loose — 3× the top of the category occupancy
 * band, never below 50% of revenue. A boutique fitness studio at 20% band gets
 * a 60% ceiling. That is far above any deal a buyer should sign, and that is
 * the point: this gate exists to catch the IMPOSSIBLE, never the merely BAD.
 * A genuinely brutal 45%-rent deal still renders as disclosed, still craters
 * the DSCR, and still tells the buyer the truth. Laundering a bad deal into a
 * good one would be a worse bug than the one being fixed here.
 */
export function rentCeilingMonthly(
  fdd: ExtractedFDD | null | undefined,
  headlineMonthly: number | null,
): number | null {
  if (headlineMonthly == null || !(headlineMonthly > 0)) return null;
  const band = occupancyBandFor(fdd?.conceptType ?? "other");
  const pct = Math.max(3 * (band?.[1] ?? 20), 50);
  return (headlineMonthly * pct) / 100;
}

/**
 * Resolve monthly rent for a brand. `headlineMonthly` is the SAME monthly
 * revenue figure the pro forma is built on (mid-cohort / network average) —
 * required for the tier-5 occupancy benchmark AND for the plausibility gate;
 * pass null if unavailable and both simply won't fire.
 */
export function resolveMonthlyRent(
  fdd: ExtractedFDD | null | undefined,
  headlineMonthly: number | null,
): RentResolution | null {
  if (!fdd) return null;
  const rd = (fdd as any)?.rentDetail ?? null;

  // ── 1 & 2 · the single disclosed number, whatever shape it arrived in ─────
  // Computed but NOT returned yet — the gate below decides whether it is a
  // disclosure or an extraction defect wearing one.
  let disclosedMonthly: number | null = null;
  const disclosedSource: string = rd?.source ?? "FDD rent disclosure";

  const avg = (fdd as any)?.averageRentMonthly;
  if (typeof avg === "number" && avg > 0) {
    // 1 · single disclosed monthly number
    disclosedMonthly = avg;
  } else if (typeof rd?.rawValue === "number" && rd.rawValue > 0 && rd.unit && rd.unit !== "unknown") {
    // 2 · rentDetail raw value + unit, normalized
    const sqft = typeof rd.squareFootage === "number" && rd.squareFootage > 0 ? rd.squareFootage : null;
    let monthly: number | null = null;
    if (rd.unit === "per_month") monthly = rd.rawValue;
    else if (rd.unit === "per_year") monthly = rd.rawValue / 12;
    else if (rd.unit === "per_sqft_per_year" && sqft) monthly = (rd.rawValue * sqft) / 12;
    else if (rd.unit === "per_sqft_per_month" && sqft) monthly = rd.rawValue * sqft;
    if (monthly != null && monthly > 0) disclosedMonthly = monthly;
  }

  const ceiling = rentCeilingMonthly(fdd, headlineMonthly);
  const rejected: number | null =
    disclosedMonthly != null && ceiling != null && disclosedMonthly > ceiling ? disclosedMonthly : null;

  if (disclosedMonthly != null && rejected == null) {
    return mk(disclosedMonthly, disclosedMonthly, "disclosed", disclosedSource);
  }

  /**
   * NAME WHAT WE THREW OUT, AND WHY.
   *
   * A silently substituted benchmark is how a buyer gets surprised at the
   * lease signing. If we refuse the FDD's own figure we say so on the rung,
   * in dollars and as a share of revenue, and we point at Item 7 — because the
   * buyer, not us, is the one who can call the landlord.
   */
  const rejectionNote =
    rejected != null && headlineMonthly
      ? ` — the rent figure read from this FDD ($${Math.round(rejected).toLocaleString("en-US")}/mo) is ` +
        `${Math.round((rejected / headlineMonthly) * 100).toLocaleString("en-US")}% of this location's modeled ` +
        `revenue, which no operating location sustains, so it is not used here. Confirm the lease rate in Item 7.`
      : "";

  const decorate = (r: RentResolution | null): RentResolution | null =>
    r == null || rejectionNote === "" ? r : { ...r, source: r.source + rejectionNote, reviewFlag: true };

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
    if (bench.lo >= envelope.lo - 1 && bench.hi <= envelope.hi + 1) return decorate(bench);
    // partial overlap → intersect, keep benchmark basis.
    const iLo = Math.max(bench.lo, envelope.lo);
    const iHi = Math.min(bench.hi, envelope.hi);
    if (iLo <= iHi)
      return decorate(mk(iLo, iHi, "benchmark", `${bench.source}, bounded by ${envelope.source}`));
    // disjoint → trust the disclosure, flag for review.
    return decorate({ ...envelope, reviewFlag: true });
  }
  return decorate(envelope ?? bench ?? null);
}
