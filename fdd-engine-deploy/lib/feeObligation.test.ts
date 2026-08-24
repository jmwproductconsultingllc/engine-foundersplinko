/**
 * FE-142 · A contingent maximum is not a disclosed obligation.
 *
 * RED BY DESIGN. These assertions encode the audit of the Home Franchise
 * Concepts portfolio against the source filings, August 21, 2026. They fail
 * against 09dd571 and that failure IS the bug report.
 *
 * The HFC franchise agreement says the franchisor "may require that Franchisee
 * invest the amount specified in the Manual on local marketing and promotion,
 * not to exceed 8% of Gross Revenue." Eight percent is a ceiling on a
 * discretionary requirement. resolvePercentageFees sums it as a rate.
 */
import { describe, it, expect } from 'vitest';
import { resolvePercentageFees } from './ladderInput';
import type { PercentageFeeResolution, ResolvedPercentageFee } from './ladderInput';
import type { ExtractedFDD } from './schema';

/** What the resolution must grow to carry. Typed loosely so `tsc --noEmit`
 *  stays a usable signal while these tests are red. */
type WithObligation = PercentageFeeResolution & {
  ceilings?: ResolvedPercentageFee[];
  fees: Array<ResolvedPercentageFee & { obligation?: string }>;
};

function fdd(
  percentageFees: Array<{ label: string; pct: number; source?: string }>,
): ExtractedFDD {
  return { ongoingFees: { percentageFees }, hiddenCosts: [] } as unknown as ExtractedFDD;
}

const resolve = (x: ExtractedFDD) => resolvePercentageFees(x) as WithObligation;

describe('FE-142 — a ceiling is not a rate', () => {
  it('Budget Blinds: rung 2 is 3.5%, not 11.5%', () => {
    const r = resolve(
      fdd([
        { label: 'Royalty', pct: 3.5 },
        { label: 'Local Area Marketing Maximum', pct: 8 },
      ]),
    );
    expect(r.totalPct).toBe(3.5);
  });

  it('The Tailored Closet: rung 2 is 6.0%, not 14.0%', () => {
    const r = resolve(
      fdd([
        { label: 'Royalty', pct: 6 },
        { label: 'Local Area Marketing (not to exceed)', pct: 8 },
      ]),
    );
    expect(r.totalPct).toBe(6);
  });

  it('the ceiling is surfaced, never silently dropped', () => {
    const r = resolve(
      fdd([
        { label: 'Royalty', pct: 3.5 },
        { label: 'Local Area Marketing Maximum', pct: 8 },
      ]),
    );
    expect(r.ceilings?.map((c) => c.pct)).toEqual([8]);
  });

  it('trigger words are load-bearing', () => {
    for (const label of [
      'Local Area Marketing Maximum',
      'Local advertising, not to exceed',
      'Marketing spend up to',
      'Brand fund — may require',
      'Technology fee at our discretion',
    ]) {
      const r = resolve(fdd([{ label: 'Royalty', pct: 5 }, { label, pct: 8 }]));
      expect({ label, total: r.totalPct }).toEqual({ label, total: 5 });
    }
  });

  it('a plain fee with no trigger word still counts — do not over-correct', () => {
    const r = resolve(
      fdd([
        { label: 'Royalty', pct: 6 },
        { label: 'National Advertising Fund', pct: 2 },
        { label: 'Technology Fee', pct: 1 },
      ]),
    );
    expect(r.totalPct).toBe(9);
    expect(r.ceilings ?? []).toHaveLength(0);
  });

  it('CONTROL — Two Maids was correct and must not move', () => {
    const r = resolve(
      fdd([
        { label: 'Royalty', pct: 6 },
        { label: 'National Advertising Fund Payment', pct: 2 },
      ]),
    );
    expect(r.totalPct).toBe(8);
  });
});
