/**
 * rankTest.fixture.ts — two brands, transcribed and generalised.
 *
 * REFERENCE_BRAND is the live catalogue report used as the seam anchor. Its
 * figures are transcribed from the rendered report, not invented. If any of them
 * change, the seam test in rankTest.test.ts fails and that is the point.
 *
 * EMERGING_BRAND is generalised from an operator interview: a small disclosed
 * set with a top unit around $430k, a second unit around $290k, and a system
 * far larger than the described set. No brand is named and no deal is described.
 */

import type { RawFee } from "./feeLoad";
import type { Band, Item19Distribution } from "./rankTest";

export const QSR_BAND_V1: Band = {
  low: 0.685,
  mid: 0.715,
  high: 0.745,
  sourced: "category",
  version: "bands.v1",
};

export const ENTERTAINMENT_BAND_V1: Band = {
  low: 0.575,
  mid: 0.62,
  high: 0.665,
  sourced: "category",
  version: "bands.v1",
};

/** Item 6 as disclosed on the reference report, including the co-op line. */
export const REFERENCE_FEES: RawFee[] = [
  { label: "Royalty", ratePctLow: 0.08, ratePctHigh: 0.08, citation: "Item 6" },
  { label: "Brand fund", ratePctLow: 0.02, ratePctHigh: 0.02, citation: "Item 6" },
  { label: "Advertising co-op", ratePctLow: 0.01, ratePctHigh: 0.02, citation: "Item 6" },
  { label: "Technology fee", flatAmount: 650, flatPeriod: "month", citation: "Item 6" },
  { label: "Bookkeeping software", flatAmount: 70, flatPeriod: "month", citation: "Item 6" },
  // Percentage of sales, but already inside the operating band. Must NOT load.
  { label: "Transaction processing", ratePctLow: 0.024, ratePctHigh: 0.04, citation: "Item 6" },
  { label: "Transfer fee", flatAmount: 10000, oneTime: true, citation: "Item 6" },
  { label: "Training fee", flatAmount: 4000, oneTime: true, citation: "Item 6" },
];

/** The same table as it was being read before the correction. */
export const REFERENCE_FEES_UNCORRECTED: RawFee[] = REFERENCE_FEES.filter(
  (f) => !/co-op/i.test(f.label),
);

export const REFERENCE_ITEM19: Item19Distribution = {
  lowAnnual: 30427 * 12,
  medianAnnual: 91089 * 12,
  averageAnnual: 94930 * 12,
  highAnnual: 285147 * 12,
  unitsDescribed: 776,
  systemUnits: 1048,
  basis: "gross sales",
  multiYearSameUnit: false,
};

export const REFERENCE_LOAN = {
  capitalGap: 1160550,
  annualRatePct: 10.5,
  termYears: 10,
};

export const EMERGING_FEES: RawFee[] = [
  { label: "Royalty", ratePctLow: 0.06, ratePctHigh: 0.06, citation: "Item 6" },
  { label: "National marketing fund", ratePctLow: 0.02, ratePctHigh: 0.02, citation: "Item 6" },
  { label: "Technology fee", flatAmount: 500, flatPeriod: "month", citation: "Item 6" },
];

export const EMERGING_ITEM19: Item19Distribution = {
  lowAnnual: 290000,
  medianAnnual: 380000,
  averageAnnual: 366667,
  highAnnual: 430000,
  unitsDescribed: 3,
  systemUnits: 120,
  basis: "gross revenue",
  multiYearSameUnit: true,
};

export const EMERGING_LOAN = {
  capitalGap: 750000,
  annualRatePct: 10.5,
  termYears: 10,
};

/** Item 19 present in the record but empty of figures — the ULC-class case. */
export const NO_PERFORMANCE_ITEM19: Item19Distribution = {
  lowAnnual: null,
  medianAnnual: null,
  averageAnnual: null,
  highAnnual: null,
  unitsDescribed: null,
  systemUnits: 14,
  basis: null,
  multiYearSameUnit: null,
};
