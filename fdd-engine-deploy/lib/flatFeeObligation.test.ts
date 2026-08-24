/**
 * FE-144 · A floor is not a fee. Mutually exclusive tiers are not a sum.
 *
 * RED BY DESIGN — resolveFlatFees does not exist yet. These encode the
 * August 21, 2026 audit of PremierGarage and Kitchen Tune-Up against their
 * source filings.
 *
 * PremierGarage Item 6: "Royalty: the GREATER OF (a) 5.0% of Gross Revenue,
 * or (b) $500/month per territory for the first year and $1,000/month
 * thereafter." One obligation. The report charged it as three line items.
 */
import { describe, it, expect } from 'vitest';
import { resolveFlatFees } from './feeObligation';

const PG_REVENUE = 311_520 / 12;   // $25,960/mo — single-territory median
const KTU_REVENUE = 521_520 / 12;  // $43,460/mo — single-territory average

const PG_FLAT = [
  { name: 'Minimum Royalty Fee (First Year)', monthlyAmount: 500, source: 'Item 6' },
  { name: 'Minimum Royalty Fee (Thereafter)', monthlyAmount: 1000, source: 'Item 6' },
  { name: 'Minimum National Advertising Fund Payment', monthlyAmount: 250, source: 'Item 6' },
  { name: 'Technology Fee (First Territory)', monthlyAmount: 250, source: 'Item 6' },
  { name: 'Technology Fee (Subsequent Territories)', monthlyAmount: 125, source: 'Item 6' },
];
const PG_PCT = [
  { label: 'Royalty', pct: 5, source: 'Item 6' },
  { label: 'National Advertising Fund', pct: 1, source: 'Item 6' },
];

const KTU_FLAT = [
  { name: 'Minimum Royalty Fee', monthlyAmount: 500, source: 'Item 6' },
  { name: 'Technology Fee', monthlyAmount: 500, source: 'Item 6' },
  { name: 'Minimum National Advertising Fund Payment', monthlyAmount: 500, source: 'Item 6' },
];
const KTU_PCT = [
  { label: 'Royalty', pct: 6, source: 'Item 6' },
  { label: 'National Advertising Fund', pct: 1, source: 'Item 6' },
];

describe('FE-144 — floors resolve, tiers do not sum', () => {
  it('PremierGarage rung 3 is $250, not $2,125', () => {
    const r = resolveFlatFees(PG_FLAT, PG_PCT, PG_REVENUE);
    expect(r.totalMonthly).toBe(250);
  });

  it('PremierGarage — neither royalty floor binds at 5% of $25,960', () => {
    const r = resolveFlatFees(PG_FLAT, PG_PCT, PG_REVENUE);
    expect(r.supersededPctLabels).toEqual([]);
    expect(r.fees.map((f) => f.label)).toEqual(['Technology Fee (First Territory)']);
  });

  it('a single-territory model never charges the subsequent-territory rate', () => {
    const r = resolveFlatFees(PG_FLAT, PG_PCT, PG_REVENUE);
    expect(r.excluded.map((f) => f.label)).toContain('Technology Fee (Subsequent Territories)');
  });

  it('KITCHEN TUNE-UP — the ad-fund floor BINDS and replaces the 1%', () => {
    // 1% of $43,460 = $434.60, which is below the $500 floor.
    const r = resolveFlatFees(KTU_FLAT, KTU_PCT, KTU_REVENUE);
    expect(r.supersededPctLabels).toEqual(['National Advertising Fund']);
    expect(r.totalMonthly).toBe(1000); // technology $500 + bound ad floor $500
  });

  it('Kitchen Tune-Up — the royalty floor does NOT bind at 6%', () => {
    // 6% of $43,460 = $2,607.60, comfortably above the $500 floor.
    const r = resolveFlatFees(KTU_FLAT, KTU_PCT, KTU_REVENUE);
    expect(r.excluded.map((f) => f.label)).toContain('Minimum Royalty Fee');
  });

  it('CONTROL — an ordinary flat fee with no floor language still charges', () => {
    const r = resolveFlatFees(
      [{ name: 'Technology Fee', monthlyAmount: 650, source: 'Item 6' },
       { name: 'Local Advertising Services Program Fee', monthlyAmount: 2500, source: 'Item 6' }],
      [{ label: 'Royalty', pct: 6, source: 'Item 6' }],
      594_532 / 12,
    );
    expect(r.totalMonthly).toBe(3150); // Two Maids rung 3, audited correct
    expect(r.supersededPctLabels).toEqual([]);
  });
});
