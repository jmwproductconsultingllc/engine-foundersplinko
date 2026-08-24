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
import { premisesModel, type RentResolution } from "./rent";
import { currencyDisclosure, resolveCurrency } from "./currency";
import { costBandsFor } from "./insights";
import { normalizeRoyaltyPct } from "./fees";
import { resolveFlatFees, obligationOf, resolvePercentageFees } from "./feeObligation";
import type { Basis, CostStructure, Financing, LadderInput } from "./ladder";

/* ─────────────────────────── percentage fees ─────────────────────────── */
// FE-142 / FE-144 · The percentage-fee resolver and the obligation model now
// live in lib/feeObligation.ts — see the cycle note there. Re-exported from
// this path because existing callers and tests import them from here.
export type { FeeObligation, ResolvedPercentageFee, PercentageFeeResolution } from "./feeObligation";
export { classifyFeeObligation, obligationOf, resolvePercentageFees } from "./feeObligation";

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

  // FE-144 · rung 3 is resolved AGAINST rung 2 and the modeled revenue, because
  // "Minimum Royalty Fee $500/mo" is a floor under the royalty already charged
  // above it — not a second fee. Summing this array was the defect.
  const flat = resolveFlatFees(
    fdd?.ongoingFees?.flatMonthlyFees,
    pctFees.fees,
    cohort?.monthlyRevenue ?? null,
  );
  const fixedFees = flat.fees.map((x) => ({ label: x.label, monthly: x.monthly }));

  const rentRes = s?.rentResolution ?? null;
  const rentMonthly =
    rentRes != null
      ? rentRes.mid
      : fdd?.averageRentMonthly != null && fdd.averageRentMonthly > 0
        ? fdd.averageRentMonthly
        : null;

  // FE-143 · disclosed beats benchmark on occupancy too. When the filing says
  // the business runs from home, the category occupancy band is withheld so
  // rung 4 cannot fall back to it — see lib/rent.ts premisesModel().
  const premises = premisesModel(fdd);

  const bands = costBandsFor(fdd?.conceptType, fdd?.staffingModel);

  // FE-140 · DISCLOSED BEATS BENCHMARK.
  //
  // Two Maids' Item 19 discloses Gross Revenues, Direct Labor, Cleaning
  // Materials, Total Cost of Sales and Gross Margin for every cohort across
  // twelve charts. The engine read the revenue line and nothing else, filled
  // rungs 6 and 7 with category bands, and then printed "no such figures were
  // read from this one" — a hardcoded sentence that was false for this filing.
  // Cost of goods came out 7-10x overstated and labor understated; the two
  // errors roughly offset at the optimistic end, which is why nothing looked
  // wrong, and the pessimistic end — the one that set the headline — was
  // fabricated.
  //
  // COHORT ALIGNMENT: the disclosed figures are matched to the cohort the
  // ladder is actually running on, by label. If the ladder runs on Q2 revenue
  // it uses Q2 labor, never Q1's and never a system-wide average.
  const disclosedCosts = (() => {
    const monthlyRev = cohort?.monthlyRevenue ?? null;
    if (!monthlyRev || monthlyRev <= 0 || !cohort?.label) return undefined;
    const raw = (fdd?.item19?.cohorts ?? []).find((c) => c?.label === cohort.label)?.disclosedCosts;
    if (!raw) return undefined;
    const page = raw.sourcePage ? `Item 19, ${raw.sourcePage}` : "Item 19";
    const out: NonNullable<CostStructure["disclosed"]> = {};
    const put = (key: "cogs" | "labor" | "otherOpex", annual: number | null | undefined, what: string) => {
      if (annual == null || !Number.isFinite(annual) || annual < 0) return;
      const monthly = annual / 12;
      out[key] = {
        monthly,
        pctOfRevenue: Math.round((monthly / monthlyRev) * 1000) / 10,
        source: `${page} — ${what} disclosed for ${cohort.label}`,
      };
    };
    put("labor", raw.laborAnnual, "direct labor");
    put("cogs", raw.cogsAnnual, "cost of goods");
    put("otherOpex", raw.otherOpexAnnual, "other operating costs");
    return Object.keys(out).length ? out : undefined;
  })();

  const allDisclosed =
    !!disclosedCosts && (["cogs", "labor", "otherOpex"] as const).every((k) => disclosedCosts[k]);

  const costs: CostStructure = {
    cogsPct: bands.cogsPct,
    laborPct: bands.laborPct,
    otherOpexPct: bands.otherOpexPct,
    occupancyPct: premises.homeBased ? undefined : bands.occupancyPct,
    disclosed: disclosedCosts,
    basis: allDisclosed ? "disclosed" : "benchmark",
    // Block-level provenance. It is stated ONCE, under the table (ladder.blockNote),
    // because it is identical for rungs 6, 7 and 8 — the part that differs between
    // them is the band, and the band is now each rung's own source line.
    source: disclosedCosts
      ? `Rungs 6, 7 and 8: disclosed figures from Item 19 where this filing publishes them, ${bands.label} category bands elsewhere`
      : `Rungs 6, 7 and 8 are ${bands.label} category bands`,
    // C0. The previous wording said these costs "are never disclosed in an FDD"
    // and sent the reader to Item 20 for "real franchisee numbers". Both halves
    // were wrong. Item 19 is voluntary but roughly half of the brands on file
    // publish a profitability cohort, and a quarter of them break out cost of
    // goods, labor or occupancy inside it — so "never" is false, and the founder
    // reading his own product caught it, which means a buyer would too. Item 20
    // meanwhile carries no cost figures at all: by 16 CFR 436.5(t) it is outlet
    // counts and the franchisee roster. What makes it the right pointer is the
    // roster — the people who have the numbers, with their phone numbers.
    // FE-140 · this sentence used to print unconditionally, which is how a
    // filing that discloses four cost columns across twelve charts got told it
    // disclosed none. An absence claim has to be checked against the sweep that
    // supposedly found nothing.
    note: allDisclosed
      ? "These rungs are this brand's own disclosed figures, read from the Item 19 chart for the cohort above. They describe what these units actually ran — not a category average. Item 20 carries every current franchisee, by name and phone; calling three in markets like yours is still the best check on any number in this report."
      : disclosedCosts
        ? "Some of these rungs are this brand's own Item 19 figures and some are category bands — each rung says which on its own line. An FDD is not required to disclose cost of goods, labor, or operating costs, and this one discloses some of them. Item 20 does not carry cost figures; what it carries is every current franchisee, by name and phone. Call three in markets like yours and ask what they run for the lines still modeled above."
        : "These three rungs are category bands, not this brand's figures — an FDD is not required to disclose cost of goods, labor, or operating costs, and no such figures were read from this one. Item 20 does not carry cost figures either; what it carries is every current franchisee, by name and phone. Call three in markets like yours and ask what they actually run for food cost, labor and rent before you sign.",
  };

  const financing = resolveFinancing(result, opts);

  return {
    monthlyRevenue: cohort?.monthlyRevenue ?? null,
    revenueLabel: cohort?.label ?? "Item 19 top line",
    // A CAD figure wearing a US dollar sign is the defect this closes. The
    // disclosure rides on rung 1, because rung 1 is where the number enters.
    revenueSource: [revenueSourceText(cohort), currencyDisclosure(fdd)].filter(Boolean).join(" — "),
    currencyCode: resolveCurrency(fdd) ?? undefined,
    revenueOwnership: cohort?.source?.ownership ?? undefined,
    revenueUnavailable: s?.item19Unusable,
    // FE-142 + FE-144 · rung 2 charges only what is actually owed. Not the
    // ceilings — those are lifted into the fees panel with a question attached —
    // and not a percentage that a binding minimum has already replaced.
    // NOTE: buildCashLadder sums feePcts, NOT PercentageFeeResolution.totalPct.
    // Filtering here is what makes the resolver's verdict reach the report.
    feePcts: pctFees.fees
      .filter((x) => obligationOf(x) === "FIXED")
      .filter((x) => !flat.supersededPctLabels.includes(x.label))
      .map((x) => ({ label: x.label, pct: x.pct })),
    fixedFees,
    rentMonthly,
    noPremises: premises.homeBased && rentMonthly == null,
    rentBasis:
      premises.homeBased && rentMonthly == null ? "disclosed" : rentBasisFor(rentRes),
    rentSource:
      premises.homeBased && rentMonthly == null
        ? `This filing states the business is operated from the franchisee's home and requires no site approval, so no premises rent is charged${
            premises.evidence ? ` ("${premises.evidence}")` : ""
          }. Any vehicle storage or parking cost disclosed in Item 7 is charged above; confirm what you will actually pay to store equipment.`
        : rentRes?.source ?? (rentMonthly != null ? "FDD rent disclosure" : "Not disclosed"),
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
