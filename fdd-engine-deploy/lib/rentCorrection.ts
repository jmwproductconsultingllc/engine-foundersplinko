// lib/rentCorrection.ts — render-time honesty for STORED results.
//
// Stored brand records / minted reports carry scoring computed before the
// rent-resolver hotfix (rent silently $0 when averageRentMonthly was null).
// New pipeline runs are correct natively (scoring.ts uses the resolver);
// this patches everything already stored, WITHOUT re-running the risk rubric —
// riskLevel/riskReasons stay as scored, so the paid report never disagrees
// with the brand card's public verdict. Recomputed: cohort economics, dscr,
// rentPctOfRevenue, paybackYears, underwriting (assessment + net cash flow),
// insights (no rent double-count). Kept separate from lib/rent.ts so the
// resolver stays a leaf module (scoring.ts imports it) with no import cycle.

import type { DiligenceResult } from "./types";
import type { ScoringResult } from "./scoring";
import { underwrite } from "./underwriting";
import { buildInsights } from "./insights";
import { resolveMonthlyRent, type RentResolution } from "./rent";

export function applyRentCorrection(result: DiligenceResult): DiligenceResult {
  const s = result?.scoring as (ScoringResult & { rentResolution?: RentResolution | null }) | undefined;
  const fdd = result?.extracted;
  if (!s || !fdd) return result;

  // Already resolver-aware (new pipeline output) → nothing to correct.
  if (s.rentResolution !== undefined) return result;

  const midRev = s.midCohort?.monthlyRevenue ?? null;
  const rent = resolveMonthlyRent(fdd, midRev);
  const flatFees = (fdd.ongoingFees?.flatMonthlyFees ?? []).reduce(
    (acc, x) => acc + (x.monthlyAmount ?? 0),
    0,
  );
  const rentMid = rent?.mid ?? 0;
  const fixedMonthly = flatFees + rentMid;

  const patchCohort = (c: ScoringResult["midCohort"]): ScoringResult["midCohort"] => {
    if (!c) return c;
    const monthlyEbitda = c.monthlyRevenue - c.monthlyVariable - fixedMonthly;
    return {
      ...c,
      monthlyFixed: fixedMonthly,
      monthlyEbitda,
      annualEbitda: monthlyEbitda * 12,
      coversCosts: monthlyEbitda >= 0,
    };
  };

  const midCohort = patchCohort(s.midCohort);
  const bottomCohort = patchCohort(s.bottomCohort);

  const dscr =
    midCohort && s.assumedMonthlyDebtService && s.assumedMonthlyDebtService > 0
      ? midCohort.annualEbitda / (s.assumedMonthlyDebtService * 12)
      : s.dscr;
  const rentPctOfRevenue =
    midCohort && midCohort.monthlyRevenue > 0 && rent ? rent.mid / midCohort.monthlyRevenue : s.rentPctOfRevenue;
  const paybackYears =
    midCohort && s.buildoutMidpoint != null && midCohort.annualEbitda > 0
      ? s.buildoutMidpoint / midCohort.annualEbitda
      : midCohort != null && midCohort.annualEbitda <= 0
        ? null
        : s.paybackYears;

  const scoring: ScoringResult & {
    rentResolution: RentResolution | null;
    fixedFeesMonthly: number;
  } = {
    ...s,
    midCohort,
    bottomCohort,
    dscr,
    rentPctOfRevenue,
    paybackYears,
    fixedMonthly,
    rentResolution: rent,
    fixedFeesMonthly: flatFees,
  };

  // Re-run the pure downstream layers off the corrected economics. Risk level
  // and reasons are NOT re-scored (see header note).
  const underwriting = result.buyer ? underwrite(fdd, scoring, result.buyer) : result.underwriting;
  const insights = result.insights ? buildInsights(fdd, scoring) : result.insights;

  return { ...result, scoring, underwriting, insights };
}
