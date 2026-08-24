/**
 * lib/feeObligation.ts — FE-144
 *
 * A fee is ONE obligation, resolved ONCE.
 *
 * PremierGarage Item 6 reads: "Royalty: you must pay us the GREATER OF (a) 5.0%
 * of Gross Revenue, or (b) $500 per month per territory for the first year and
 * $1,000 per month thereafter." That is a single obligation with a rate and a
 * floor, and two time states of the same floor. The report charged it as three
 * separate ladder lines — the 5% in rung 2, and BOTH minimums in rung 3, added
 * on top of the percentage they exist to bound. Rung 3 came to $2,125 where the
 * filing supports $250.
 *
 * Two distinct errors, and this module refuses both:
 *   1. A FLOOR is not an additional fee. It is max(rate x revenue, floor), and
 *      at most one side of that is ever charged.
 *   2. Mutually exclusive tiers do not sum. "First year" and "thereafter" are
 *      two states of one schedule; "first territory" and "subsequent
 *      territories" follow the modeled unit count.
 *
 * When a floor BINDS it replaces the percentage rather than joining it — see
 * Kitchen Tune-Up, where 1% of $43,460 is $434.60 against a $500 floor. Getting
 * that direction right is the point. A rule that only ever subtracts has not
 * modeled the obligation, it has special-cased the bug.
 */
import type { ExtractedFDD } from "./schema";
import { normalizeRoyaltyPct } from "./fees";

/* ─────────────── percentage fees (moved from ladderInput.ts) ─────────────── */
// Moved here so scoring.ts can import the resolver. ladderInput.ts imports
// RUBRIC — a VALUE — from scoring.ts, so scoring importing back from
// ladderInput would be a genuine runtime cycle. This module is a leaf.

/**
 * FE-142 · What KIND of obligation a fee is, not merely how large it is.
 *
 * FIXED      — a stated rate owed every period.
 * CEILING    — "not to exceed 8%", "maximum", "may require ... up to". The real
 *              amount is set outside the FDD, usually in the Manual, so the
 *              honest output is an unknown and a question, never a charge.
 * FLOOR      — "the greater of 5% or $500/month". Resolution belongs to FE-144;
 *              the member exists here so both tickets share one vocabulary.
 * CONTINGENT — triggered by an event: late reporting, audit, transfer.
 */
export type FeeObligation = "FIXED" | "CEILING" | "FLOOR" | "CONTINGENT";

/**
 * Trigger words are load-bearing. If the extracted label prints "Maximum," the
 * arithmetic may not then treat the figure as a rate — the label and the number
 * are the same fact and are not allowed to disagree. That disagreement is the
 * whole of FE-142: the Budget Blinds report rendered "Local Area Marketing
 * Maximum 8%" into rung 2 and billed it as certain, and that single line is
 * what manufactured "this unit does not turn an operating profit" on the
 * flagship brand of an eight-brand portfolio.
 */
const PCT_CEILING_TRIGGER =
  /\b(?:maximum|not to exceed|no more than|up to|at (?:our|its)(?: sole)? discretion|may require|as specified in the manual)\b/i;

export function classifyFeeObligation(label: string | null | undefined): FeeObligation {
  return PCT_CEILING_TRIGGER.test(label ?? "") ? "CEILING" : "FIXED";
}

/** Absent obligation means FIXED — every already-minted record predates the field. */
export function obligationOf(f: { obligation?: FeeObligation }): FeeObligation {
  return f.obligation ?? "FIXED";
}

export interface ResolvedPercentageFee {
  label: string;
  /** whole-number percent of gross sales: 5 means 5% */
  pct: number;
  source: string;
  /** absent on pre-FE-142 records; read it through obligationOf() */
  obligation?: FeeObligation;
}

export interface PercentageFeeResolution {
  fees: ResolvedPercentageFee[];
  /** Ceilings lifted OUT of the ladder and surfaced in the fees panel with a
   *  question attached. A ceiling that silently disappears is the mirror defect
   *  of a ceiling that gets billed, and it is the one this fix could introduce. */
  ceilings: ResolvedPercentageFee[];
  /** sum of the FIXED fees only — the number rung 2 runs on */
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
    // The annotation is load-bearing: without it TS infers `obligation` as
    // REQUIRED here, which makes ResolvedPercentageFee (where it is optional)
    // unassignable and silently breaks the type predicate on the next line.
    .map((p): { label: string; pct: number | null; source: string; obligation?: FeeObligation } => ({
      label: (p?.label ?? "").trim(),
      pct: normalizeRoyaltyPct(p?.pct),
      source: p?.source ?? "Item 6",
      obligation: classifyFeeObligation(p?.label),
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
    const ceilings = fees.filter((x) => obligationOf(x) === "CEILING");
    const chargeable = fees.filter((x) => obligationOf(x) === "FIXED");
    return {
      fees,
      ceilings,
      totalPct: round2(chargeable.reduce((a, x) => a + x.pct, 0)),
      complete: true,
      note: ceilings.length
        ? `Item 6 caps ${ceilings.length === 1 ? "one fee" : `${ceilings.length} fees`} rather than setting a rate: ${ceilings
            .map((c) => `${c.label} (up to ${c.pct}%)`)
            .join("; ")}. What is actually required is set outside the disclosure document, so it is not charged above. Ask the franchisor what the Manual currently requires and what revenue caps apply — for most buyers this is the single highest-value question in the filing.`
        : null,
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
    ceilings: [],
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


export interface FlatFeeInput {
  name?: string | null;
  monthlyAmount?: number | null;
  source?: string | null;
}

export interface PctFeeInput {
  label: string;
  pct: number;
  source?: string;
}

export interface ResolvedFlatFee {
  label: string;
  monthly: number;
  source: string;
  obligation: FeeObligation;
  /** set when the fee was NOT charged — always say why, never drop silently */
  excludedReason?: string;
  /** for a FLOOR: the percentage fee it bounds */
  boundsPctLabel?: string;
}

export interface FlatFeeResolution {
  /** what actually charges into rung 3 */
  fees: ResolvedFlatFee[];
  totalMonthly: number;
  /** everything that did not charge, each with a reason */
  excluded: ResolvedFlatFee[];
  /** percentage fees REPLACED by a binding floor — rung 2 must not charge these */
  supersededPctLabels: string[];
  notes: string[];
}

const FLOOR_TRIGGER = /\b(?:minimum|min\.|greater of|at least|no less than)\b/i;
const FLAT_CEILING_TRIGGER = /\b(?:maximum|not to exceed|no more than|up to)\b/i;

/** Tier suffixes, stripped to find the sibling lines of one schedule. */
const TIER_SUFFIX =
  /\s*[({]\s*(?:for the )?(?:first year|thereafter|first territory|subsequent territor(?:y|ies))\s*[)}]\s*$/i;

/** Order matters — "Local Advertising" must not be swallowed by the ad-fund pattern. */
const FEE_KINDS: Array<{ kind: string; re: RegExp }> = [
  { kind: "royalty", re: /royalt/i },
  { kind: "localad", re: /local\s+(?:area\s+)?(?:advertis|marketing)/i },
  { kind: "adfund", re: /advertis|ad\s*fund|marketing\s*fund|brand\s*fund/i },
  { kind: "tech", re: /technolog|software/i },
];

function kindOf(label: string): string | null {
  for (const k of FEE_KINDS) if (k.re.test(label)) return k.kind;
  return null;
}

function classifyFlat(label: string): FeeObligation {
  if (FLOOR_TRIGGER.test(label)) return "FLOOR";
  if (FLAT_CEILING_TRIGGER.test(label)) return "CEILING";
  return "FIXED";
}

/**
 * Resolve the flat monthly dollar fees for one modeled unit.
 *
 * @param flat            ongoingFees.flatMonthlyFees, as extracted
 * @param pctFees         the FIXED percentage fees rung 2 is charging
 * @param monthlyRevenue  the SAME modeled revenue the ladder is built on
 * @param opts.territories how many territories the buyer is modeling (default 1)
 */
export function resolveFlatFees(
  flat: FlatFeeInput[] | null | undefined,
  pctFees: PctFeeInput[] | null | undefined,
  monthlyRevenue: number | null,
  opts: { territories?: number } = {},
): FlatFeeResolution {
  const territories = opts.territories ?? 1;
  const pct = pctFees ?? [];

  const rows = (flat ?? [])
    .filter((x) => (x?.monthlyAmount ?? 0) > 0)
    .map((x) => {
      const label = (x.name ?? "").trim();
      return {
        label,
        base: label.replace(TIER_SUFFIX, "").trim(),
        monthly: x.monthlyAmount as number,
        source: x.source ?? "Item 6",
        obligation: classifyFlat(label),
        timeTier: /thereafter/i.test(label)
          ? "thereafter"
          : /first year/i.test(label)
            ? "first-year"
            : null,
        terrTier: /subsequent territor/i.test(label)
          ? "subsequent"
          : /first territory/i.test(label)
            ? "first"
            : null,
      };
    });

  const fees: ResolvedFlatFee[] = [];
  const excluded: ResolvedFlatFee[] = [];
  const supersededPctLabels: string[] = [];
  const notes: string[] = [];

  for (const r of rows) {
    const out: ResolvedFlatFee = {
      label: r.label,
      monthly: r.monthly,
      source: r.source,
      obligation: r.obligation,
    };

    // ── mutually exclusive tiers ──────────────────────────────────────────
    if (r.terrTier === "subsequent" && territories <= 1) {
      excluded.push({
        ...out,
        excludedReason: `Applies only to territories beyond the first; this model is ${territories} territory.`,
      });
      continue;
    }
    if (
      r.timeTier === "first-year" &&
      rows.some((o) => o.base === r.base && o.timeTier === "thereafter")
    ) {
      excluded.push({
        ...out,
        excludedReason:
          "First-year rate of a two-state schedule. The ladder models the steady state; the introductory amount is a variance, not a second fee.",
      });
      notes.push(
        `${r.base} is $${r.monthly.toLocaleString()}/mo in year one before stepping to the ongoing rate.`,
      );
      continue;
    }

    // ── a ceiling in dollars behaves exactly as it does in percent ────────
    if (r.obligation === "CEILING") {
      excluded.push({
        ...out,
        excludedReason:
          "A stated maximum, not a required amount. Ask what is currently required before treating it as a cost.",
      });
      continue;
    }

    // ── a floor bounds a percentage; it never joins it ────────────────────
    if (r.obligation === "FLOOR") {
      const kind = kindOf(r.label);
      const bounded = kind ? pct.find((p) => kindOf(p.label) === kind) : undefined;

      if (!bounded || monthlyRevenue == null || !(monthlyRevenue > 0)) {
        // Nothing to bound it against — charge it, because an unbounded
        // minimum IS the fee. Understating is the worse failure here.
        fees.push(out);
        continue;
      }

      const pctAmount = (bounded.pct / 100) * monthlyRevenue;
      if (r.monthly > pctAmount) {
        fees.push({ ...out, boundsPctLabel: bounded.label });
        supersededPctLabels.push(bounded.label);
        notes.push(
          `At the modeled revenue the ${bounded.label} minimum applies: you pay $${r.monthly.toLocaleString()} rather than ${bounded.pct}% ($${Math.round(pctAmount).toLocaleString()}).`,
        );
      } else {
        excluded.push({
          ...out,
          boundsPctLabel: bounded.label,
          excludedReason: `A floor under ${bounded.label}, which at the modeled revenue is $${Math.round(pctAmount).toLocaleString()} — above the minimum, so the percentage governs and the floor costs nothing.`,
        });
      }
      continue;
    }

    fees.push(out);
  }

  return {
    fees,
    totalMonthly: round2(fees.reduce((a, x) => a + x.monthly, 0)),
    excluded,
    supersededPctLabels,
    notes,
  };
}
