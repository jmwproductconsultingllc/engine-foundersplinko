// lib/perUnitRevenue.ts — derive a per-FRANCHISE revenue headline when Item 19
// discloses revenue PER MANAGED UNIT plus units-managed-per-franchise, but never
// the per-franchise figure directly (Real Property Management: $4,552/yr per
// managed unit × ~123 median units = ~$46,658/mo per franchise — the record
// shipped a $379/mo headline by reading the per-unit fee as the whole business).
//
// Pure + deterministic + golden-tested (lib/perUnitRevenue.test.ts). The output
// is explicitly DERIVED, not disclosed — the caller tags it moBasis:"derived" so
// no surface ever claims the franchisor disclosed it. Both inputs ARE disclosed;
// the multiplication is the code's judgment, labeled as such (the provenance
// discipline: disclosed / derived / benchmark / inferred).
//
// Median units is the headline (buyer-honest, skew-resistant — the same
// median-over-mean rule the hero picker uses); the mean-units figure is the
// upside end of the disclosed range.

import type { Item19Cohort } from "./schema";

export interface PerUnitDerivation {
  /** headline monthly, rounded — MEDIAN rev/unit × MEDIAN units ÷ 12.
   *  Both ends stay statistically consistent: the headline never mixes an
   *  average numerator with a median denominator (the two-reader bug). */
  monthly: number;
  /** low (= monthly, median×median) and high (average×average) ends */
  lo: number;
  hi: number;
  /** median annual revenue per unit — the headline numerator */
  perUnitAnnualMedian: number;
  /** average annual revenue per unit — the range-top numerator */
  perUnitAnnualAvg: number;
  medianUnits: number;
  meanUnits: number | null;
  /** sample behind the per-unit revenue figure (franchise count) */
  sample: number | null;
  /** human caveat for the derived headline */
  caveat: string;
}

const PERUNIT_REV_RE = /revenue\s+per\s+(unit|door|property)|per\s+property\s+unit|per\s+managed\s+unit|per\s+unit\s+managed/i;
const UNITS_MANAGED_RE = /units?\s+managed|managed\s+units?/i;
const MEDIAN_RE = /median\s+([\d,]+)\s*(?:units?)?/i;
const MEAN_RE = /average\s+([\d,]+)\s+units?\s+managed|([\d,]+)\s+units?\s+managed\s+per\s+franchise/i;
const OVERALL_RE = /\ball\b|overall|all\s+reporting/i;
// age-tiered cohorts ("1–3 Years Old", "Over 3 Years") are sub-slices — the
// aggregate (non-tiered) cohort is the headline denominator/numerator.
const AGE_TIER_RE = /\d\s*[-–]\s*\d\s*year|over\s+\d+\s*year|years?\s+old|first\s+(?:full\s+)?year|1[-–]3/i;

const toNum = (s: string) => Number(s.replace(/,/g, ""));

function annualOf(c: Item19Cohort): number | null {
  if (typeof c.annualRevenue === "number" && c.annualRevenue > 0) return c.annualRevenue;
  if (typeof c.avgMonthlyRevenue === "number" && c.avgMonthlyRevenue > 0) return c.avgMonthlyRevenue * 12;
  return null;
}

/**
 * Derive per-franchise monthly revenue from per-managed-unit revenue × units
 * managed. Returns null unless BOTH are disclosed. Prefers the "All/Overall"
 * cohorts; falls back to the largest-sample per-unit cohort.
 */
export function derivePerFranchiseRevenue(
  cohorts: Item19Cohort[] | null | undefined,
): PerUnitDerivation | null {
  const list = cohorts ?? [];

  // per-unit revenue cohorts (gross_sales, disclosed per managed unit)
  const perUnit = list.filter(
    (c) =>
      c.revenueType === "gross_sales" &&
      annualOf(c) != null &&
      PERUNIT_REV_RE.test(`${c.label ?? ""} ${c.basis ?? ""}`),
  );
  if (!perUnit.length) return null;
  // prefer the aggregate (non-age-tiered) cohort, else overall, else largest sample
  const notAge = (c: Item19Cohort) => !AGE_TIER_RE.test(`${c.label ?? ""} ${c.basis ?? ""}`);
  const revCohort =
    perUnit.find(notAge) ??
    perUnit.find((c) => OVERALL_RE.test(`${c.label ?? ""} ${c.basis ?? ""}`)) ??
    [...perUnit].sort((a, b) => (b.sampleSize ?? 0) - (a.sampleSize ?? 0))[0];
  const perUnitAnnualAvg = annualOf(revCohort)!;
  // median rev/unit if the FDD discloses it alongside the average; else fall
  // back to the average (a same-statistic pairing is impossible, so degrade to
  // the only figure we have rather than invent a median).
  const perUnitAnnualMedian =
    typeof revCohort.medianAnnualRevenue === "number" && revCohort.medianAnnualRevenue > 0
      ? revCohort.medianAnnualRevenue
      : perUnitAnnualAvg;

  // units-managed cohorts: match the units-managed signal AND actually carry a
  // "median NNN units" figure — this excludes the per-unit REVENUE cohorts,
  // whose basis ("...per property unit managed...") also trips the units regex
  // but has no median (they'd otherwise be mis-picked as the units source).
  const unitCohorts = list.filter((c) => {
    const t = `${c.label ?? ""} ${c.basis ?? ""}`;
    return c.revenueType !== "gross_sales" && UNITS_MANAGED_RE.test(t) && MEDIAN_RE.test(t);
  });
  if (!unitCohorts.length) return null;
  const unitCohort =
    unitCohorts.find(notAge) ??
    unitCohorts.find((c) => OVERALL_RE.test(`${c.label ?? ""} ${c.basis ?? ""}`)) ??
    unitCohorts[0];
  const basis = `${unitCohort.label ?? ""} ${unitCohort.basis ?? ""}`;

  const medMatch = MEDIAN_RE.exec(basis);
  if (!medMatch) return null; // need a median to headline honestly
  const medianUnits = toNum(medMatch[1]);
  if (!(medianUnits > 0)) return null;

  const meanMatch = MEAN_RE.exec(basis);
  const meanUnits = meanMatch ? toNum(meanMatch[1] ?? meanMatch[2]) : null;

  // headline = median × median (the typical franchise, skew-resistant on BOTH
  // dimensions); range top = average × average (dragged up by large operators).
  // Each endpoint is internally consistent — never average-rev × median-units.
  const monthly = Math.round((perUnitAnnualMedian * medianUnits) / 12);
  const avgMonthly =
    meanUnits && perUnitAnnualAvg
      ? Math.round((perUnitAnnualAvg * meanUnits) / 12)
      : monthly;
  const lo = Math.min(monthly, avgMonthly);
  const hi = Math.max(monthly, avgMonthly);

  const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const revNote =
    perUnitAnnualMedian !== perUnitAnnualAvg
      ? `a median ${usd0(perUnitAnnualMedian)}/yr revenue per managed unit`
      : `${usd0(perUnitAnnualMedian)}/yr revenue per managed unit`;
  const caveat =
    `Derived — the FDD discloses ${revNote} and a median of ` +
    `${medianUnits.toLocaleString()} units managed per franchise; per-franchise revenue is not ` +
    `disclosed directly. Range ${usd0(lo)}–${usd0(hi)}/mo (median units at median rev/unit, ` +
    `up to average units at average rev/unit).`;

  return {
    monthly,
    lo,
    hi,
    perUnitAnnualMedian,
    perUnitAnnualAvg,
    medianUnits,
    meanUnits,
    sample: revCohort.sampleSize ?? null,
    caveat,
  };
}
