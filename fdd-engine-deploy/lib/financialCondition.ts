// lib/financialCondition.ts
//
// Franchise Edge · Insights — Financial Condition deep-dive.
//
// ARCHITECTURAL CONTRACT (do not break):
//   Gemini extracts RAW figures + audit facts ONLY.
//   ALL arithmetic, ratios, trend logic, severity grading, and narrative
//   copy are computed HERE in deterministic code.
//   => Every rendered claim is reproducible and traceable to an input number.
//
// Entry point: assessFinancialCondition(extraction) -> FinancialConditionInsight
// Extraction prompt: FINANCIAL_CONDITION_EXTRACTION_PROMPT (merge into gemini.ts)

/* ========================================================================
 * 1. TYPES
 * ====================================================================== */

export type AuditOpinion =
  | 'unmodified' // clean
  | 'qualified'
  | 'adverse'
  | 'disclaimer'
  | 'unknown';

export type Trend = 'improving' | 'worsening' | 'flat' | 'unknown';

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';

export type DataQuality = 'audited' | 'partial' | 'missing';

/**
 * One fiscal year of raw figures from Item 21 / Exhibit F.
 * USD. Net loss is a NEGATIVE number. A members'/stockholders' DEFICIT is a
 * NEGATIVE netWorth. null = not disclosed (never guess).
 */
export interface FinancialYear {
  fiscalYearEnd: string | null; // e.g. "2025-12-31" or "FY2025"
  revenue: number | null;
  netIncome: number | null; // net loss = negative
  totalAssets: number | null;
  totalLiabilities: number | null;
  cash: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  relatedPartyDebt: number | null; // "due to related parties", insider loans
  deferredRevenue: number | null; // prepaid franchise fees not yet earned
  netWorth: number | null; // members'/stockholders' equity; deficit = negative
}

/** EXACTLY what the model returns. No computed fields. */
export interface FinancialConditionExtraction {
  specialRiskPresent: boolean; // page-iv "Financial Condition" risk factor present?
  auditorName: string | null;
  auditOpinion: AuditOpinion;
  goingConcernRaised: boolean; // AUDITOR expressed substantial doubt (NOT boilerplate)
  priorPeriodRestatement: boolean;
  parentName: string | null;
  parentGuaranteeOfPerformance: boolean; // does the FDD include a parent guarantee?
  years: FinancialYear[]; // most-recent first, up to 3
}

export interface ComputedMetrics {
  fiscalYearEnd: string | null;
  netWorth: number | null;
  netWorthSign: 'positive' | 'negative' | 'unknown';
  netWorthTrend: Trend;
  netIncome: number | null;
  netIncomeTrend: Trend;
  revenue: number | null;
  revenueTrend: Trend;
  currentRatio: number | null;
  workingCapital: number | null;
  liabilitiesToAssets: number | null;
  adjLiabilitiesToAssets: number | null; // liabilities net of deferred revenue
  relatedPartyDebtPct: number | null;
  deferredRevenuePct: number | null;
  expenseToRevenue: number | null;
  cash: number | null;
  nearTermObligations: number | null; // current liabilities
}

/** What CODE computes and the UI renders. */
export interface FinancialConditionInsight {
  severity: Severity;
  headline: string; // always-visible hook (one sentence)
  /** always-visible growth-stage framing — set ONLY when losses/deficit are NOT
   *  paired with an auditor going-concern doubt. Keeps a young-but-scaling
   *  franchisor from reading as a failing one. null when it doesn't apply. */
  context: string | null;
  body: string[]; // "tell me more" paragraphs, plain English
  aggravators: string[]; // factors that worsen the read
  mitigants: string[]; // factors that soften it
  metrics: ComputedMetrics;
  evidenceNote: string;
  dataQuality: DataQuality;
}

/* ========================================================================
 * 2. EXTRACTION PROMPT (merge into the Item-21 pass in gemini.ts)
 * ====================================================================== */

export const FINANCIAL_CONDITION_EXTRACTION_PROMPT = `
FINANCIAL CONDITION EXTRACTION
Read three sources in the FDD: (a) the "Special Risks to Consider About This
Franchise" page in the front matter, (b) Item 21 / Exhibit F audited financial
statements, and (c) Item 1 (parents/affiliates) plus any guarantee of performance.

Return RAW values ONLY. Do NOT compute ratios, trends, percentages, or any grade.
Do NOT round. Use null for anything not disclosed — never estimate or infer.
Net loss must be a NEGATIVE number. A members'/stockholders' DEFICIT is a NEGATIVE
netWorth value.

GOING CONCERN — read carefully:
Every modern audit report contains a standard sentence under "Responsibilities of
Management" stating that management must evaluate going concern. That boilerplate
does NOT count. Set "goingConcernRaised": true ONLY if the AUDITOR's opinion, or a
separate "Emphasis of Matter" / "Going Concern" / "Substantial Doubt" paragraph,
expresses substantial doubt about the company's ability to continue. Otherwise false.

AUDIT OPINION: classify as "unmodified" (clean), "qualified", "adverse",
"disclaimer", or "unknown".

Add this object to your JSON output under the key "financialCondition":
{
  "specialRiskPresent": boolean,
  "auditorName": string | null,
  "auditOpinion": "unmodified" | "qualified" | "adverse" | "disclaimer" | "unknown",
  "goingConcernRaised": boolean,
  "priorPeriodRestatement": boolean,
  "parentName": string | null,
  "parentGuaranteeOfPerformance": boolean,
  "years": [
    {
      "fiscalYearEnd": string | null,
      "revenue": number | null,
      "netIncome": number | null,
      "totalAssets": number | null,
      "totalLiabilities": number | null,
      "cash": number | null,
      "currentAssets": number | null,
      "currentLiabilities": number | null,
      "relatedPartyDebt": number | null,
      "deferredRevenue": number | null,
      "netWorth": number | null
    }
  ]
}
"years" holds up to 3 fiscal years, MOST RECENT FIRST. Output strict JSON only —
no markdown fences, no commentary.
`.trim();

/* ========================================================================
 * 3. NUMERIC / FORMAT HELPERS (pure)
 * ====================================================================== */

const n = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function safeRatio(num: number | null, den: number | null): number | null {
  if (!n(num) || !n(den) || den === 0) return null;
  return num / den;
}

/** Direction trend. Higher is "improving" for net worth, net income, revenue. */
function trend(recent: number | null, prior: number | null): Trend {
  if (!n(recent) || !n(prior)) return 'unknown';
  const delta = recent - prior;
  const scale = Math.max(Math.abs(recent), Math.abs(prior), 1);
  if (Math.abs(delta) / scale < 0.05) return 'flat';
  return delta > 0 ? 'improving' : 'worsening';
}

/** Compact USD magnitude. Caller supplies sign words. null -> "not disclosed". */
function fmtM(v: number | null): string {
  if (!n(v)) return 'not disclosed';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${Math.round(a / 1e3)}K`;
  return `$${Math.round(a)}`;
}

function fmtX(r: number | null): string {
  return n(r) ? `${r.toFixed(1)}x` : '';
}

function fmtPct(p: number | null): string {
  return n(p) ? `${Math.round(p * 100)}%` : '';
}

/* ========================================================================
 * 4. METRIC COMPUTATION (all arithmetic lives here)
 * ====================================================================== */

export function computeMetrics(x: FinancialConditionExtraction): ComputedMetrics {
  const years = x.years ?? [];
  const y0 = years[0] ?? null; // most recent
  const y1 = years[1] ?? null;

  const netWorth = y0?.netWorth ?? null;
  const netWorthSign = !n(netWorth)
    ? 'unknown'
    : netWorth < 0
    ? 'negative'
    : 'positive';

  const totalLiabilities = y0?.totalLiabilities ?? null;
  const deferredRevenue = y0?.deferredRevenue ?? null;
  const adjLiabilities =
    n(totalLiabilities) && n(deferredRevenue)
      ? totalLiabilities - deferredRevenue
      : totalLiabilities;

  const revenue = y0?.revenue ?? null;
  const netIncome = y0?.netIncome ?? null;
  const totalExpenses =
    n(revenue) && n(netIncome) ? revenue - netIncome : null;

  return {
    fiscalYearEnd: y0?.fiscalYearEnd ?? null,
    netWorth,
    netWorthSign,
    netWorthTrend: trend(netWorth, y1?.netWorth ?? null),
    netIncome,
    netIncomeTrend: trend(netIncome, y1?.netIncome ?? null),
    revenue,
    revenueTrend: trend(revenue, y1?.revenue ?? null),
    currentRatio: safeRatio(y0?.currentAssets ?? null, y0?.currentLiabilities ?? null),
    workingCapital:
      n(y0?.currentAssets) && n(y0?.currentLiabilities)
        ? (y0!.currentAssets as number) - (y0!.currentLiabilities as number)
        : null,
    liabilitiesToAssets: safeRatio(totalLiabilities, y0?.totalAssets ?? null),
    adjLiabilitiesToAssets: safeRatio(adjLiabilities, y0?.totalAssets ?? null),
    relatedPartyDebtPct: safeRatio(y0?.relatedPartyDebt ?? null, totalLiabilities),
    deferredRevenuePct: safeRatio(deferredRevenue, totalLiabilities),
    expenseToRevenue: safeRatio(totalExpenses, revenue),
    cash: y0?.cash ?? null,
    nearTermObligations: y0?.currentLiabilities ?? null,
  };
}

function gradeDataQuality(
  x: FinancialConditionExtraction,
  m: ComputedMetrics
): DataQuality {
  const core = [m.revenue, m.netIncome, m.netWorth, m.nearTermObligations];
  const present = core.filter(n).length;
  if (present === 0) return 'missing';
  if (present < core.length || x.auditOpinion === 'unknown') return 'partial';
  return 'audited';
}

/* ========================================================================
 * 5. SEVERITY + AGGRAVATORS / MITIGANTS (deterministic rules)
 * ====================================================================== */

interface Grade {
  severity: Severity;
  aggravators: string[];
  mitigants: string[];
  primaryDriver: string; // keys the headline template
}

export function gradeSeverity(
  x: FinancialConditionExtraction,
  m: ComputedMetrics,
  dq: DataQuality
): Grade {
  const aggravators: string[] = [];
  const mitigants: string[] = [];

  // ---- collect aggravators ----
  if (x.goingConcernRaised)
    aggravators.push(
      "the auditor raised substantial doubt about the company's ability to continue as a going concern"
    );
  if (m.netWorthSign === 'negative' && m.netWorthTrend === 'worsening')
    aggravators.push('negative net worth that is deepening year over year');
  else if (m.netWorthSign === 'negative')
    aggravators.push('negative net worth — it owes more than it owns');
  if (n(m.netIncome) && m.netIncome < 0 && m.netIncomeTrend === 'worsening')
    aggravators.push('operating losses that are widening');
  else if (n(m.netIncome) && m.netIncome < 0)
    aggravators.push('operating losses');
  if (n(m.currentRatio) && m.currentRatio < 1)
    aggravators.push('more due within a year than current assets to cover it');
  if (n(m.liabilitiesToAssets) && m.liabilitiesToAssets >= 3)
    aggravators.push('liabilities far exceed assets');
  if (n(m.relatedPartyDebtPct) && m.relatedPartyDebtPct >= 0.4)
    aggravators.push('heavy dependence on related-party loans to stay funded');
  if (x.parentName && !x.parentGuaranteeOfPerformance)
    aggravators.push(
      "no parent guarantee backing the franchisor's obligations to you"
    );
  if (x.priorPeriodRestatement)
    aggravators.push('prior-year financials were restated');
  if (x.auditOpinion === 'qualified')
    aggravators.push('the auditor issued a qualified opinion');
  if (x.auditOpinion === 'adverse')
    aggravators.push('the auditor issued an adverse opinion');
  if (x.auditOpinion === 'disclaimer')
    aggravators.push('the auditor disclaimed an opinion');

  // ---- collect mitigants ----
  if (x.auditOpinion === 'unmodified' && !x.goingConcernRaised)
    mitigants.push(
      'the auditor issued a clean (unmodified) opinion and did not raise going-concern doubt'
    );
  if (m.revenueTrend === 'improving') mitigants.push('revenue is growing');
  if (m.netWorthSign === 'positive') mitigants.push('positive net worth');
  if (n(m.netIncome) && m.netIncome >= 0) mitigants.push('the business is profitable');
  if (x.parentGuaranteeOfPerformance)
    mitigants.push("the parent guarantees the franchisor's performance");

  // ---- severity decision ----
  if (dq === 'missing') {
    return {
      severity: 'INSUFFICIENT_DATA',
      aggravators,
      mitigants,
      primaryDriver: 'insufficient',
    };
  }

  const high =
    x.goingConcernRaised ||
    (m.netWorthSign === 'negative' && m.netWorthTrend === 'worsening') ||
    (n(m.liabilitiesToAssets) &&
      m.liabilitiesToAssets >= 3 &&
      n(m.currentRatio) &&
      m.currentRatio < 1) ||
    x.auditOpinion === 'adverse' ||
    x.auditOpinion === 'disclaimer';

  const medium =
    m.netWorthSign === 'negative' ||
    (n(m.netIncome) && m.netIncome < 0) ||
    (n(m.currentRatio) && m.currentRatio < 1) ||
    x.auditOpinion === 'qualified' ||
    x.priorPeriodRestatement ||
    (n(m.relatedPartyDebtPct) && m.relatedPartyDebtPct >= 0.4);

  let severity: Severity = high ? 'HIGH' : medium ? 'MEDIUM' : 'LOW';

  // Franchisor self-flagged the risk but figures look stable -> don't undercut
  // the disclosure; floor at MEDIUM and say so honestly.
  if (severity === 'LOW' && x.specialRiskPresent) {
    severity = 'MEDIUM';
    return {
      severity,
      aggravators,
      mitigants,
      primaryDriver: 'selfFlaggedButStable',
    };
  }

  // Choose the headline driver by priority.
  let primaryDriver = 'low';
  if (x.goingConcernRaised) primaryDriver = 'goingConcern';
  else if (m.netWorthSign === 'negative' && m.netWorthTrend === 'worsening')
    primaryDriver = 'negativeWorseningNetWorth';
  else if (
    n(m.liabilitiesToAssets) &&
    m.liabilitiesToAssets >= 3 &&
    n(m.currentRatio) &&
    m.currentRatio < 1
  )
    primaryDriver = 'underwaterBalanceSheet';
  else if (m.netWorthSign === 'negative') primaryDriver = 'negativeNotWorsening';
  else if (n(m.netIncome) && m.netIncome < 0) primaryDriver = 'lossesButSolvent';

  return { severity, aggravators, mitigants, primaryDriver };
}

/* ========================================================================
 * 6. COPY / RENDER (deterministic templates, computed numbers only)
 * ====================================================================== */

function buildHeadline(driver: string, m: ComputedMetrics): string {
  const nw = fmtM(m.netWorth);
  const loss = fmtM(m.netIncome);

  switch (driver) {
    case 'goingConcern':
      return "The franchisor's own auditor has raised substantial doubt about whether it can stay in business — a serious signal for a company you'd depend on for years of support.";
    case 'negativeWorseningNetWorth':
      return `This franchisor owes far more than it owns and the gap is widening fast — its net worth is roughly ${nw} in the red and deteriorating, and it stays afloat on related-party loans rather than its own operations.`;
    case 'underwaterBalanceSheet':
      return "This franchisor's liabilities dwarf its assets and it has less cash on hand than it owes within the year — a thin cushion behind the support you'd be paying for.";
    case 'negativeNotWorsening':
      return `This franchisor has negative net worth (about ${nw} in the red) — it owes more than it owns — though the trend isn't worsening. Understand what's funding the gap before you commit.`;
    case 'lossesButSolvent':
      return `This franchisor is losing money as it grows (a net loss of ${loss} in the most recent year), though it still has positive net worth. Worth understanding how long its runway lasts.`;
    case 'selfFlaggedButStable':
      return 'The franchisor flagged its own financial condition as a risk. The figures we extracted look comparatively stable, so confirm directly against the most recent statements.';
    case 'insufficient':
      return "We couldn't extract enough of this franchisor's financial statements to assess its condition. Request the audited Item 21 financials and have them reviewed before committing.";
    default:
      return "The franchisor's statements don't show the distress signals we screen for — positive net worth and a clean audit. Still worth a quick confirmation against current figures.";
  }
}

function buildBody(
  x: FinancialConditionExtraction,
  m: ComputedMetrics,
  g: Grade
): string[] {
  const body: string[] = [];

  // --- What we found ---
  const found: string[] = [];
  const fy = m.fiscalYearEnd ? ` (${m.fiscalYearEnd}` : ' (most recent year';
  const auditor = x.auditorName ? `, audited by ${x.auditorName})` : ')';

  if (n(m.netIncome) && n(m.revenue)) {
    const ratio = fmtX(m.expenseToRevenue);
    found.push(
      `${m.netIncome < 0 ? 'Net loss' : 'Net income'} of ${fmtM(m.netIncome)} on ${fmtM(
        m.revenue
      )} of revenue${ratio ? ` — roughly ${ratio} spent per $1 earned` : ''}.` +
        (m.netIncomeTrend === 'worsening' ? ' Losses are widening, not shrinking.' : '')
    );
  }
  if (m.netWorthSign === 'negative') {
    found.push(
      `Negative net worth (a members'/stockholders' deficit) of ${fmtM(m.netWorth)}` +
        (m.netWorthTrend === 'worsening' ? ', and deepening year over year.' : '.') +
        (n(m.liabilitiesToAssets)
          ? ` Total liabilities are about ${fmtX(m.liabilitiesToAssets)} total assets.`
          : '')
    );
  } else if (m.netWorthSign === 'positive') {
    found.push(`Positive net worth of ${fmtM(m.netWorth)}.`);
  }
  if (n(m.relatedPartyDebtPct) && m.relatedPartyDebtPct >= 0.3) {
    found.push(
      `About ${fmtPct(m.relatedPartyDebtPct)} of liabilities is money owed to related parties — the entity is kept alive largely by insider loans, not profit.`
    );
  }
  if (n(m.cash) && n(m.nearTermObligations)) {
    found.push(
      `Cash of ${fmtM(m.cash)} against ${fmtM(m.nearTermObligations)} of obligations due within a year` +
        (n(m.currentRatio) ? ` (a current ratio of ${m.currentRatio.toFixed(2)}).` : '.')
    );
  }
  if (n(m.deferredRevenuePct) && m.deferredRevenuePct >= 0.1) {
    found.push(
      `Note: about ${fmtPct(
        m.deferredRevenuePct
      )} of those liabilities is deferred revenue — prepaid franchise fees the company owes as future services, not borrowed money. Netting it out, liabilities are still about ${fmtX(
        m.adjLiabilitiesToAssets
      )} assets.`
    );
  }
  if (found.length)
    body.push(`What we found${fy}${auditor}: ` + found.join(' '));

  // NOTE: the growth-stage "what this does not mean" framing moved OUT of the
  // collapsed body into the always-visible `context` field (see buildContext),
  // so a young-but-scaling franchisor isn't pre-judged as a failing one.

  // --- Why it matters to you ---
  const guarantee =
    x.parentName && !x.parentGuaranteeOfPerformance
      ? ` There is no parent guarantee of performance in this FDD, so ${x.parentName} is not contractually obligated to keep funding the franchisor or backing its commitments to you.`
      : x.parentGuaranteeOfPerformance && x.parentName
      ? ` ${x.parentName} guarantees the franchisor's performance, which partly backstops this.`
      : '';
  body.push(
    'Why it matters to you: field support, training, technology, and marketing come out of the franchisor\'s budget. If outside funding slows, those are the first things to get cut.' +
      guarantee
  );

  // --- Verify before you commit ---
  body.push(
    'Verify before you commit: ask for the most recent interim (unaudited) financials and the current-year funding plan; ask whether the parent will sign a guarantee of performance; and cross-check Item 20 — unit closures, transfers, and terminations are the operational tell that corroborates financial stress.'
  );

  return body;
}

/** Growth-stage framing for the always-visible card. Returned ONLY when the
 *  distress signals are the kind a young, scaling franchisor typically shows
 *  (losses / deficit with offsetting positives) AND the auditor did NOT raise
 *  going-concern doubt. If the auditor flagged survival risk, we never soften it. */
function buildContext(x: FinancialConditionExtraction, g: Grade): string | null {
  if (g.severity === 'LOW' || g.severity === 'INSUFFICIENT_DATA') return null;
  if (x.goingConcernRaised) return null; // auditor flagged survival — do not soften
  if (!g.mitigants.length) return null;
  return `Worth perspective: ${g.mitigants.join(
    '; '
  )}. Early-stage franchisors commonly run losses and carry a deficit while investing to scale — this reads more like spending ahead of revenue than a failing business. The real question is runway: how the gap is funded, and for how long.`;
}

function buildEvidenceNote(x: FinancialConditionExtraction): string {
  const src = x.specialRiskPresent
    ? 'Flagged on the FDD\'s "Special Risks" page and grounded in the Item 21 / Exhibit F audited financials.'
    : 'Derived from the Item 21 / Exhibit F audited financials.';
  return `${src} Figures are extracted; all ratios and grading are computed. Confirm against the source statements and a CPA before relying on them.`;
}

/* ========================================================================
 * 7. PUBLIC ENTRY POINT
 * ====================================================================== */

export function assessFinancialCondition(
  extraction: FinancialConditionExtraction | null | undefined
): FinancialConditionInsight | null {
  if (!extraction) return null;

  const metrics = computeMetrics(extraction);
  const dataQuality = gradeDataQuality(extraction, metrics);
  const grade = gradeSeverity(extraction, metrics, dataQuality);

  return {
    severity: grade.severity,
    headline: buildHeadline(grade.primaryDriver, metrics),
    context: buildContext(extraction, grade),
    body: buildBody(extraction, metrics, grade),
    aggravators: grade.aggravators,
    mitigants: grade.mitigants,
    metrics,
    evidenceNote: buildEvidenceNote(extraction),
    dataQuality,
  };
}
