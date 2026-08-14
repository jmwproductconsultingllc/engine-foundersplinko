/**
 * THE SIGN GATE.
 *
 * Eight catalog records carried a paragraph asserting the franchisor "commonly
 * runs losses and carries a deficit" — in the same sentence that reported
 * positive net worth, on records reporting positive net income. One of them
 * reports $151.66M of net income.
 *
 * The failure was not the numbers, and it was not the headline. A copy branch
 * that asserts a DIRECTION was selected without ever reading the quantity it
 * characterises. These tests pin the direction, not the wording — rephrasing
 * the paragraph must not make them pass.
 */
import { describe, it, expect } from 'vitest';
import {
  assessFinancialCondition,
  type FinancialConditionExtraction,
} from './financialCondition';
import { resolveFinancialContext } from './severity';

const LOSS_WORDS =
  /run losses|running losses|carry a deficit|carries a deficit|spending ahead of revenue|net loss/i;

/** Shape of the filing that surfaced the defect: profitable, clean audit,
 *  growing revenue, positive equity, self-flagged on the Special Risks page,
 *  and deferred revenue far in excess of net worth. */
function solventGrowing(
  over: Partial<FinancialConditionExtraction> = {}
): FinancialConditionExtraction {
  return {
    specialRiskPresent: true,
    auditorName: 'Independent Auditor',
    auditOpinion: 'unmodified',
    goingConcernRaised: false,
    priorPeriodRestatement: false,
    parentName: null,
    parentGuaranteeOfPerformance: false,
    years: [
      {
        fiscalYearEnd: '2025-12-31',
        revenue: 25_929_793,
        netIncome: 8_564_031,
        totalAssets: 41_159_235,
        totalLiabilities: 35_877_847,
        cash: 5_500_000,
        currentAssets: 9_000_000,
        currentLiabilities: 3_516_138,
        relatedPartyDebt: null,
        deferredRevenue: 33_873_896,
        netWorth: 5_281_388,
      },
      {
        fiscalYearEnd: '2024-12-31',
        revenue: 11_601_866,
        netIncome: 2_390_758,
        totalAssets: 38_812_972,
        totalLiabilities: 38_045_150,
        cash: 3_000_000,
        currentAssets: 6_000_000,
        currentLiabilities: 2_087_887,
        relatedPartyDebt: null,
        deferredRevenue: 37_113_399,
        netWorth: 767_822,
      },
      {
        fiscalYearEnd: '2023-12-31',
        revenue: 841_090,
        netIncome: -1_550_729,
        totalAssets: 5_000_000,
        totalLiabilities: 6_787_436,
        cash: 500_000,
        currentAssets: 1_000_000,
        currentLiabilities: 1_200_000,
        relatedPartyDebt: null,
        deferredRevenue: 24_424_522,
        netWorth: -1_787_436,
      },
    ],
    ...over,
  };
}

/** Same shape, genuinely loss-making with a deficit. */
function lossMaking(): FinancialConditionExtraction {
  const x = solventGrowing();
  x.years = x.years.map((y, i) => ({
    ...y,
    netIncome: i === 0 ? -1_100_000 : i === 1 ? -1_600_000 : -1_400_000,
    netWorth: i === 0 ? -2_400_000 : i === 1 ? -1_300_000 : -700_000,
  }));
  return x;
}

/** Revenue read; income statement and balance sheet not. */
function figuresUnread(): FinancialConditionExtraction {
  const x = solventGrowing();
  x.years = x.years.map((y) => ({
    ...y,
    netIncome: null,
    netWorth: null,
    totalAssets: null,
    totalLiabilities: null,
  }));
  return x;
}

describe('producer — buildContext reads the signs', () => {
  it('THE DEFECT — a profitable franchisor is never described as running losses', () => {
    const out = assessFinancialCondition(solventGrowing());
    expect(out).not.toBeNull();
    const prose = [out!.headline, out!.context ?? '', ...out!.body].join(' ');
    expect(prose).not.toMatch(LOSS_WORDS);
  });

  it('a positive net worth is never described as a deficit', () => {
    const out = assessFinancialCondition(solventGrowing());
    expect(out!.metrics.netWorthSign).toBe('positive');
    expect(out!.context ?? '').not.toMatch(/deficit/i);
  });

  it('names the balance-sheet driver when deferred revenue exceeds net worth', () => {
    const out = assessFinancialCondition(solventGrowing());
    expect(out!.context ?? '').toMatch(/deferred revenue/i);
  });

  it('does not repeat a mitigant it has already stated with a figure', () => {
    const ctx = assessFinancialCondition(solventGrowing())!.context ?? '';
    expect(ctx.match(/net worth is positive|positive net worth/gi)?.length ?? 0).toBe(1);
  });

  it('A NULL IS NOT A NO — unread figures assert no direction', () => {
    const ctx = assessFinancialCondition(figuresUnread())!.context ?? '';
    expect(ctx).not.toMatch(LOSS_WORDS);
    expect(ctx).toMatch(/could not read usable income-statement or balance-sheet figures/i);
  });

  it('FLOOR — the growth-stage framing still fires on a real loss and deficit', () => {
    expect(assessFinancialCondition(lossMaking())!.context ?? '').toMatch(LOSS_WORDS);
  });

  it('FLOOR — a going-concern doubt is never softened, whatever the signs', () => {
    expect(
      assessFinancialCondition(solventGrowing({ goingConcernRaised: true }))!.context
    ).toBeNull();
  });

  it('FLOOR — a qualified opinion is never softened', () => {
    expect(
      assessFinancialCondition(solventGrowing({ auditOpinion: 'qualified' }))!.context
    ).toBeNull();
  });
});

describe('renderer — resolveFinancialContext refuses a contradiction', () => {
  const LOSS_COPY =
    'Worth perspective: positive net worth. Early-stage franchisors commonly run losses and carry a deficit while investing to scale.';

  it('suppresses loss copy on a profitable, positive-equity record', () => {
    expect(
      resolveFinancialContext(LOSS_COPY, { netIncome: 8_564_031, netWorthSign: 'positive' })
    ).toBeNull();
  });

  it('keeps loss copy when there is an actual loss', () => {
    expect(
      resolveFinancialContext(LOSS_COPY, { netIncome: -1_100_000, netWorthSign: 'positive' })
    ).toBe(LOSS_COPY);
  });

  it('keeps loss copy when there is an actual deficit', () => {
    expect(
      resolveFinancialContext(LOSS_COPY, { netIncome: 5, netWorthSign: 'negative' })
    ).toBe(LOSS_COPY);
  });

  it('passes through copy that asserts no direction', () => {
    const neutral = 'Worth perspective: the auditor issued a clean opinion.';
    expect(resolveFinancialContext(neutral, { netIncome: 1, netWorthSign: 'positive' })).toBe(
      neutral
    );
  });

  it('suppresses when metrics are missing rather than trusting the copy', () => {
    expect(resolveFinancialContext(LOSS_COPY, null)).toBeNull();
    expect(resolveFinancialContext(LOSS_COPY, {})).toBeNull();
  });

  it('handles a null/empty context', () => {
    expect(resolveFinancialContext(null, { netIncome: 1, netWorthSign: 'positive' })).toBeNull();
    expect(resolveFinancialContext('   ', { netIncome: 1, netWorthSign: 'positive' })).toBeNull();
  });
});

describe('catalog — no shipped record can render a contradiction', () => {
  const load = async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(process.cwd(), 'data', 'brands');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    return files.map((f) => ({
      f,
      rec: JSON.parse(readFileSync(path.join(dir, f), 'utf8')),
    }));
  };

  it('every PERSISTED context survives the resolver without contradicting its own metrics', async () => {
    const all = await load();
    expect(all.length).toBeGreaterThan(50);
    for (const { f, rec } of all) {
      const fc = rec?.result?.financialCondition;
      if (!fc) continue;
      const shown = resolveFinancialContext(fc.context, fc.metrics);
      if (shown === null) continue;
      const ni = fc.metrics?.netIncome;
      const solvent =
        typeof ni === 'number' && ni > 0 && fc.metrics?.netWorthSign === 'positive';
      if (solvent) {
        expect(shown, `${f} would render loss copy on a profitable record`).not.toMatch(
          LOSS_WORDS
        );
      }
    }
  });

  it('re-running the producer over every stored extraction contradicts nothing', async () => {
    const all = await load();
    for (const { f, rec } of all) {
      const ex = rec?.result?.extracted;
      const raw = ex?.financialCondition;
      if (!raw) continue;
      const out = assessFinancialCondition(raw, ex?.systemScale ?? null);
      if (!out?.context) continue;
      const ni = out.metrics.netIncome;
      const solvent =
        typeof ni === 'number' && ni > 0 && out.metrics.netWorthSign === 'positive';
      if (solvent) {
        expect(out.context, `${f} producer asserts losses on a profitable record`).not.toMatch(
          LOSS_WORDS
        );
      }
    }
  });
});
