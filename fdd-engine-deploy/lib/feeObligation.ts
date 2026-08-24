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
import type { FeeObligation } from "./ladderInput";

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
const CEILING_TRIGGER = /\b(?:maximum|not to exceed|no more than|up to)\b/i;

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function classifyFlat(label: string): FeeObligation {
  if (FLOOR_TRIGGER.test(label)) return "FLOOR";
  if (CEILING_TRIGGER.test(label)) return "CEILING";
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
