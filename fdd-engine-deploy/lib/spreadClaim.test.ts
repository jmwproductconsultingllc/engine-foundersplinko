/**
 * FE-140 criterion 8 — a portfolio is not a unit.
 *
 * Two Maids' Item 19 runs to twelve charts. Chart 12 reports 24 owners
 * operating 65 locations. Ranked against a single-territory cohort it produced
 * the sentence "that is a 6.2x spread inside one system, and it is the
 * yardstick for every call you make."
 *
 * The true single-territory spread is 4.7x — Q1 average $90,468/mo against Q5
 * average $19,158/mo. The buyer is deciding whether to operate ONE territory.
 * A yardstick built partly out of somebody's twelve is not the yardstick for
 * that decision, and it is quoted to them as the standard for every call.
 */
import { describe, it, expect } from "vitest";
import { buildCallList, type CohortRow } from "./callList";

const row = (label: string, avgMonthlyRevenue: number, over: Partial<CohortRow> = {}): CohortRow => ({
  label,
  ownership: "franchised",
  revenueType: "gross_sales",
  avgMonthlyRevenue,
  ...over,
});

const TWO_MAIDS: CohortRow[] = [
  row("1st Quintile (Top 19 Territories by Gross Revenues)", 90_468),
  row("2nd Quintile (Next 19 Territories by Gross Revenues)", 49_544),
  row("5th Quintile (Bottom 19 Territories by Gross Revenues)", 19_158),
];

const CHART_12 = row("Chart 12 — 24 Multi-Unit Owners Operating 65 Locations", 118_780, {
  sampleSize: 24,
  figureScope: "combined",
  combinedAcross: 65,
});

const tiers = (cohorts: CohortRow[]) =>
  buildCallList({ cohorts, item19Page: "p. 50-62", totalUnits: 184, item20Page: "p. 64-68" })
    .cohorts.find((c) => c.key === "tiers");

describe("the spread a buyer is handed is a single-territory spread", () => {
  it("THE DEFECT — a portfolio chart must not set the top of the range", () => {
    const withChart12 = tiers([...TWO_MAIDS, CHART_12])!;
    expect(withChart12.who).toMatch(/4\.7×/);
    expect(withChart12.who).not.toMatch(/6\.2×/);
    expect(withChart12.who).not.toMatch(/Chart 12/);
  });

  it("the number is identical with and without the portfolio row", () => {
    // The strongest form of the assertion: including Chart 12 changes nothing.
    expect(tiers([...TWO_MAIDS, CHART_12])!.who).toBe(tiers(TWO_MAIDS)!.who);
  });

  it("figureScope is the signal, and it beats the label", () => {
    const unlabeled = row("Chart 12", 118_780, { figureScope: "combined", combinedAcross: 65 });
    expect(tiers([...TWO_MAIDS, unlabeled])!.who).toMatch(/4\.7×/);
  });

  it("the label fallback carries records that predate the field", () => {
    const legacy = row("Multi-Unit Owners — Combined Figures", 118_780);
    expect(tiers([...TWO_MAIDS, legacy])!.who).toMatch(/4\.7×/);
  });

  it("a single-outlet row is never excluded — this must not over-correct", () => {
    const single = row("Top Performing Territory", 140_000, { figureScope: "per_outlet" });
    expect(tiers([...TWO_MAIDS, single])!.who).toMatch(/7\.3×/);
  });

  it("a brand whose only rows are portfolios makes no spread claim at all", () => {
    expect(tiers([CHART_12, row("Multi-Unit Owners B", 40_000, { figureScope: "combined", combinedAcross: 8 })])).toBeUndefined();
  });
});
