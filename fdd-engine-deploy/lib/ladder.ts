/**
 * lib/ladder.ts — THE CASH LADDER. One canonical model of unit economics.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this module, the same subtraction was retyped in three places
 * (lib/scoring.ts, lib/rentCorrection.ts twice), debt service was applied to
 * the wrong line in two more (components/DiligenceReport.tsx, lib/underwriting.ts),
 * and the field that held "revenue minus fees minus rent" was named
 * `monthlyEbitda` — so every consumer that read it believed it was EBITDA.
 * It is not. It is the FOURTH line of a THIRTEEN line ladder. COGS, labor and
 * other operating costs had not been subtracted yet.
 *
 * The consequence was not cosmetic. For Noodles & Company that field holds
 * ~$92k/mo; true operating EBITDA is ~$2k/mo. DSCR computed off the wrong line
 * reads 5.65 when the honest figure is ~0.14. A buyer reading the old number
 * would conclude the deal covers its debt five times over. It does not cover it
 * at all.
 *
 * THE RULE THIS FILE ENFORCES
 * ---------------------------
 * There is exactly ONE ladder. Every surface — the pro forma block, the
 * Insights build-up, the risk rubric, the underwriting sidebar, the debt
 * slider — reads rungs off THIS object. Nobody recomputes. Nobody renames.
 * Only rung 9 may be called EBITDA.
 *
 * PROVENANCE IS A FIRST-CLASS FIELD
 * ---------------------------------
 * Every rung carries a `basis` matching the vocabulary already on screen:
 *   disclosed — stated in this FDD
 *   derived   — our calculation from disclosed figures
 *   benchmark — our industry range, used only where the FDD is silent
 *   inferred  — an AI classification
 * A rung that is a range because we had to reach for a benchmark STAYS a range.
 * We do not collapse to a midpoint. The spread is the finding.
 *
 * COPY LAW (see lib/scoring.ts:299 and lib/reasonCopy.test.ts)
 * -----------------------------------------------------------
 * Name the output, never the cutoff. Our internal rubric thresholds do not get
 * published to the buyer. The 1.25 DSCR figure is the ONE exception, and only
 * because it is not ours: it is a lender convention. It may be attributed to
 * lenders ("lenders typically want 1.25 or better"). It may never be attributed
 * to us ("we flag anything below 1.25").
 */

/* ────────────────────────────── types ────────────────────────────── */

/**
 * Where a figure came from.
 *
 * "buyer" is a number the reader typed in (today: the rent override). It is not
 * a disclosure and is never labeled one — but it outranks a category benchmark,
 * because it is a real local quote rather than our estimate.
 */
export type Basis = "disclosed" | "buyer" | "derived" | "benchmark" | "inferred";

/** Every money figure in the ladder is a range. When a figure is exact, lo === hi.
 *  This is deliberate: it means no consumer ever has to ask "is this one a range?" */
export type Money = { lo: number; hi: number };

export type RungKind = "base" | "subtract" | "subtotal" | "result" | "ratio";

export interface Rung {
  /** stable identifier — consumers select by this, never by array index or label */
  id: RungId;
  /** display order, 1..13 */
  n: number;
  /** buyer-facing label. Only rung 9 contains the word EBITDA. */
  label: string;
  kind: RungKind;
  /** monthly dollars. null when the input needed to compute it is missing. */
  monthly: Money | null;
  /** the same figure annualized, for rungs where the annual view is the useful one */
  annual: Money | null;
  /** as a % of gross revenue, where meaningful */
  pctOfRevenue: Money | null;
  basis: Basis;
  /** where the number came from, in the buyer's language — rendered under the row */
  source: string;
  /** optional caveat rendered as a footnote */
  note?: string;
}

export type RungId =
  | "revenue"
  | "franchiseFees"
  | "fixedFees"
  | "occupancy"
  | "marginAfterFeesAndRent"
  | "cogs"
  | "labor"
  | "otherOpex"
  | "operatingEbitda"
  | "debtService"
  | "cashAfterDebt"
  | "dscr"
  | "payback";

/** What the buyer is financing, passed in as a PARAMETER — never module state.
 *  The debt slider re-invokes buildCashLadder() with a new `financing` on every
 *  move, so rungs 10-13 are always internally consistent with rungs 1-9. */
export interface Financing {
  loan: number;
  ratePct: number;
  termYears: number;
}

/** The operating cost structure. Supplied DISCLOSED when the FDD actually states
 *  it (Noodles & Company discloses a full company-unit P&L in Item 19), and
 *  BENCHMARK when it does not — which is the common case. */
export interface CostStructure {
  /** % of revenue */
  cogsPct: [number, number];
  laborPct: [number, number];
  otherOpexPct: [number, number];
  /** occupancy % of revenue — used ONLY when no rent figure resolved */
  occupancyPct?: [number, number];
  basis: Basis;
  source: string;
  /** rendered as a footnote on rungs 6-8 */
  note?: string;
}

export interface LadderInput {
  /** gross monthly revenue for the cohort being modeled */
  monthlyRevenue: number | null;
  /** what that cohort is, in the buyer's words — e.g. "Network average, all units" */
  revenueLabel: string;
  revenueSource: string;
  /** franchised | company | mixed — company-unit revenue is NOT franchisee revenue */
  revenueOwnership?: string;

  /** % of revenue, disclosed in Item 6. Sum of ALL percentage-of-sales fees.
   *  Pass every one of them. A missing 1.25% marketing administration fee is
   *  $17k/yr the buyer never sees coming. */
  feePcts: { label: string; pct: number }[];
  /** flat dollar fees per month, disclosed in Item 6 (tech, RTS, support) */
  fixedFees: { label: string; monthly: number }[];

  /** resolved monthly rent. null → we fall back to costs.occupancyPct. */
  rentMonthly: number | null;
  rentBasis: Basis;
  rentSource: string;

  costs: CostStructure;

  /** Item 7 midpoint — the denominator of payback */
  buildoutMidpoint: number | null;

  financing: Financing | null;
}

export interface CashLadder {
  rungs: Rung[];
  /** selector — the ONLY sanctioned way to read a rung */
  get(id: RungId): Rung | null;
  /** convenience accessors for the figures other modules ask for by name.
   *  These exist so nobody is tempted to re-derive them. */
  marginAfterFeesAndRent: Money | null;
  operatingEbitda: Money | null;
  cashAfterDebt: Money | null;
  dscr: Money | null;
  paybackYears: Money | null;
  /** true when paybackYears.hi is Infinity — the low end of the modeled cost
   *  range never recovers the build-out. Renderers read this instead of
   *  testing for Infinity, so "never" is never printed as a number. */
  paybackNeverAtLowEnd: boolean;
  monthlyDebtService: number | null;
  /** true when any rung leaned on a benchmark — drives the "modeled" disclaimer */
  usesBenchmark: boolean;
  /** the widest basis used for rungs 6-8, for the provenance legend */
  costBasis: Basis;
  /**
   * The Item 19 cohort this entire ladder runs on — "Middle 50% — Average",
   * not "Gross revenue".
   *
   * input.revenueLabel was populated from the cohort and then never read, so
   * the section heading fell back to rung 1's own label and rendered "The cash
   * ladder — Gross revenue": true, tautological, and silent on the one
   * qualifier that governs all thirteen rungs below it.
   */
  revenueLabel: string;
}

/* ──────────────────────────── arithmetic ──────────────────────────── */

/** THE amortization function. There is one. It used to live inside
 *  components/DiligenceReport.tsx, which meant the server and the client
 *  computed debt service independently. */
export function amortize(principal: number, annualRatePct: number, years: number): number {
  if (!(principal > 0) || !(years > 0)) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  const f = r / (1 - Math.pow(1 + r, -n));
  return principal * f;
}

/** The monthly payment factor per dollar borrowed — exposed because the
 *  max-supportable-debt solver (FE-103) inverts it. */
export function paymentFactor(annualRatePct: number, years: number): number {
  if (!(years > 0)) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return 1 / n;
  return r / (1 - Math.pow(1 + r, -n));
}

/** Largest loan whose debt service still clears `targetDscr` against `ebitdaMonthly`.
 *  This is the breakeven / pre-planning calculator: a buyer walks into an SBA
 *  conversation knowing the number instead of discovering it in underwriting. */
export function maxSupportableLoan(
  ebitdaMonthly: number,
  targetDscr: number,
  annualRatePct: number,
  years: number,
): number {
  if (!(ebitdaMonthly > 0) || !(targetDscr > 0)) return 0;
  const f = paymentFactor(annualRatePct, years);
  if (!(f > 0)) return 0;
  return ebitdaMonthly / targetDscr / f;
}

const m = (lo: number, hi: number): Money => ({ lo, hi });
const exact = (v: number): Money => ({ lo: v, hi: v });
const sub = (a: Money, b: Money): Money => ({ lo: a.lo - b.hi, hi: a.hi - b.lo });
const scale = (a: Money, k: number): Money => ({ lo: a.lo * k, hi: a.hi * k });
const round = (a: Money): Money => ({ lo: Math.round(a.lo), hi: Math.round(a.hi) });
const pctOf = (a: Money, base: number): Money | null =>
  base > 0 ? { lo: (a.lo / base) * 100, hi: (a.hi / base) * 100 } : null;

/** Widest basis wins: if any input to a line is a benchmark, the line is a benchmark. */
function weakest(...b: Basis[]): Basis {
  if (b.includes("inferred")) return "inferred";
  if (b.includes("benchmark")) return "benchmark";
  if (b.includes("derived")) return "derived";
  if (b.includes("buyer")) return "buyer";
  return "disclosed";
}

/* ───────────────────────────── the ladder ───────────────────────────── */

export function buildCashLadder(input: LadderInput): CashLadder {
  const rungs: Rung[] = [];
  const rev = input.monthlyRevenue;
  const push = (r: Rung) => rungs.push(r);

  const nullRung = (id: RungId, n: number, label: string, kind: RungKind, source: string): Rung => ({
    id, n, label, kind, monthly: null, annual: null, pctOfRevenue: null,
    basis: "derived", source,
  });

  /* 1 — gross revenue */
  if (rev == null || !(rev > 0)) {
    // Without revenue there is no ladder. Emit the shape so consumers can render
    // "not disclosed" per rung rather than crashing or, worse, showing zeros.
    const ids: [RungId, string, RungKind][] = [
      ["revenue", "Gross revenue", "base"],
      ["franchiseFees", "− Franchise fees", "subtract"],
      ["fixedFees", "− Fixed monthly fees", "subtract"],
      ["occupancy", "− Rent & occupancy", "subtract"],
      ["marginAfterFeesAndRent", "= Margin after fees & rent", "subtotal"],
      ["cogs", "− Cost of goods", "subtract"],
      ["labor", "− Labor", "subtract"],
      ["otherOpex", "− Other operating costs", "subtract"],
      ["operatingEbitda", "= Operating EBITDA", "result"],
      ["debtService", "− Debt service", "subtract"],
      ["cashAfterDebt", "= Cash after debt, before owner draw", "result"],
      ["dscr", "Debt-service coverage ratio", "ratio"],
      ["payback", "Years to recover the build-out", "ratio"],
    ];
    ids.forEach(([id, label, kind], i) =>
      push(nullRung(id, i + 1, label, kind, "No revenue figure disclosed in Item 19")),
    );
    return finalize(rungs, null, "benchmark", false, input.revenueLabel);
  }

  const revenue = exact(rev);
  push({
    id: "revenue", n: 1, label: "Gross revenue", kind: "base",
    monthly: round(revenue), annual: round(scale(revenue, 12)),
    pctOfRevenue: exact(100), basis: "disclosed",
    source: input.revenueSource,
    note: input.revenueOwnership === "company"
      ? "Company-operated units. Franchisee results are disclosed separately and are not the same figure."
      : undefined,
  });

  /* 2 — percentage-of-sales fees */
  const feePctTotal = input.feePcts.reduce((a, f) => a + f.pct, 0);
  const fees = scale(revenue, feePctTotal / 100);
  push({
    id: "franchiseFees", n: 2, label: "− Franchise fees", kind: "subtract",
    monthly: round(fees), annual: round(scale(fees, 12)),
    pctOfRevenue: exact(feePctTotal), basis: "disclosed",
    source: input.feePcts.length
      ? `Item 6: ${input.feePcts.map((f) => `${f.label} ${f.pct}%`).join(", ")}`
      : "Item 6 — no percentage-of-sales fees disclosed",
  });

  /* 3 — flat monthly fees */
  const fixedTotal = input.fixedFees.reduce((a, f) => a + f.monthly, 0);
  const fixed = exact(fixedTotal);
  push({
    id: "fixedFees", n: 3, label: "− Fixed monthly fees", kind: "subtract",
    monthly: round(fixed), annual: round(scale(fixed, 12)),
    pctOfRevenue: pctOf(fixed, rev), basis: "disclosed",
    source: input.fixedFees.length
      ? `Item 6: ${input.fixedFees.map((f) => `${f.label} $${f.monthly.toLocaleString()}/mo`).join(", ")}`
      : "Item 6 — no flat monthly fees disclosed",
  });

  /* 4 — rent & occupancy */
  let occupancy: Money;
  let occupancyBasis: Basis;
  let occupancySource: string;
  if (input.rentMonthly != null && input.rentMonthly > 0) {
    occupancy = exact(input.rentMonthly);
    occupancyBasis = input.rentBasis;
    occupancySource = input.rentSource;
  } else if (input.costs.occupancyPct) {
    occupancy = scale(revenue, 1 / 100);
    occupancy = m(
      (rev * input.costs.occupancyPct[0]) / 100,
      (rev * input.costs.occupancyPct[1]) / 100,
    );
    occupancyBasis = "benchmark";
    occupancySource = `Category range ${input.costs.occupancyPct[0]}–${input.costs.occupancyPct[1]}% of revenue — this FDD discloses no rent figure`;
  } else {
    occupancy = exact(0);
    occupancyBasis = "benchmark";
    occupancySource = "No rent figure disclosed and no category range available";
  }
  push({
    id: "occupancy", n: 4, label: "− Rent & occupancy", kind: "subtract",
    monthly: round(occupancy), annual: round(scale(occupancy, 12)),
    pctOfRevenue: pctOf(occupancy, rev), basis: occupancyBasis,
    source: occupancySource,
  });

  /* 5 — margin after fees & rent. THE LINE THAT USED TO BE CALLED EBITDA. */
  const margin = sub(sub(sub(revenue, fees), fixed), occupancy);
  push({
    id: "marginAfterFeesAndRent", n: 5, label: "= Margin after fees & rent", kind: "subtotal",
    monthly: round(margin), annual: round(scale(margin, 12)),
    pctOfRevenue: pctOf(margin, rev),
    basis: weakest("disclosed", occupancyBasis, "derived"),
    source: "Rungs 1 − 2 − 3 − 4",
    note: "Not profit. Cost of goods, labor and operating costs have not been subtracted yet.",
  });

  /* 6, 7, 8 — the operating cost block */
  const c = input.costs;
  const cogs = m((rev * c.cogsPct[0]) / 100, (rev * c.cogsPct[1]) / 100);
  const labor = m((rev * c.laborPct[0]) / 100, (rev * c.laborPct[1]) / 100);
  const opex = m((rev * c.otherOpexPct[0]) / 100, (rev * c.otherOpexPct[1]) / 100);
  const costRow = (id: RungId, n: number, label: string, v: Money, p: [number, number]): Rung => ({
    id, n, label, kind: "subtract",
    monthly: round(v), annual: round(scale(v, 12)),
    pctOfRevenue: m(p[0], p[1]), basis: c.basis, source: c.source, note: c.note,
  });
  push(costRow("cogs", 6, "− Cost of goods", cogs, c.cogsPct));
  push(costRow("labor", 7, "− Labor", labor, c.laborPct));
  push(costRow("otherOpex", 8, "− Other operating costs", opex, c.otherOpexPct));

  /* 9 — TRUE OPERATING EBITDA. The only rung that may carry the word. */
  const ebitda = sub(sub(sub(margin, cogs), labor), opex);
  const ebitdaBasis = weakest("derived", occupancyBasis, c.basis);
  push({
    id: "operatingEbitda", n: 9, label: "= Operating EBITDA", kind: "result",
    monthly: round(ebitda), annual: round(scale(ebitda, 12)),
    pctOfRevenue: pctOf(ebitda, rev), basis: ebitdaBasis,
    source: "Rung 5 − 6 − 7 − 8",
    note: "Before debt service, owner compensation, depreciation and taxes.",
  });

  /* 10 — debt service */
  const fin = input.financing;
  const debtMonthly = fin ? amortize(fin.loan, fin.ratePct, fin.termYears) : null;
  push(
    debtMonthly == null
      ? nullRung("debtService", 10, "− Debt service", "subtract", "No financing entered")
      : {
          id: "debtService", n: 10, label: "− Debt service", kind: "subtract",
          monthly: round(exact(debtMonthly)), annual: round(exact(debtMonthly * 12)),
          pctOfRevenue: pctOf(exact(debtMonthly), rev), basis: "derived",
          source: `$${Math.round(fin!.loan).toLocaleString()} at ${fin!.ratePct}% over ${fin!.termYears} years`,
        },
  );

  /* 11 — cash after debt, before owner draw
   *
   * ALL CASH IS NOT AN ABSENT FIGURE. Rungs 10 and 12 genuinely do not exist
   * without a lender — there is no payment, and a coverage ratio has no
   * denominator. Rung 11 is different: subtracting a debt service of nothing
   * from rung 9 is a real subtraction with a real answer, and it is the rung
   * the all-cash buyer most wants to read. Nulling it here printed "not
   * disclosed" over a number we had computed one line above. */
  const cashAfter = debtMonthly == null ? ebitda : sub(ebitda, exact(debtMonthly));
  push({
    id: "cashAfterDebt", n: 11, label: "= Cash after debt, before owner draw", kind: "result",
    monthly: round(cashAfter), annual: round(scale(cashAfter, 12)),
    pctOfRevenue: pctOf(cashAfter, rev), basis: weakest("derived", ebitdaBasis),
    source: debtMonthly == null ? "Rung 9 — no debt service to subtract" : "Rung 9 − rung 10",
    note:
      debtMonthly == null
        ? "All cash, so this is rung 9 unchanged. The operator has not been paid out of this yet."
        : "The operator has not been paid out of this yet.",
  });

  /* 12 — DSCR, derived, shown as its own long division */
  const dscr =
    debtMonthly != null && debtMonthly > 0
      ? m(ebitda.lo / debtMonthly, ebitda.hi / debtMonthly)
      : null;
  push(
    dscr == null
      ? nullRung("dscr", 12, "Debt-service coverage ratio", "ratio", "No financing entered")
      : {
          id: "dscr", n: 12, label: "Debt-service coverage ratio", kind: "ratio",
          monthly: dscr, annual: dscr, pctOfRevenue: null,
          basis: weakest("derived", ebitdaBasis),
          source: `Rung 9 ÷ rung 10 — operating EBITDA divided by the loan payment`,
          note: "Lenders typically want 1.25 or better: $1.25 of operating profit for every $1.00 of loan payment.",
        },
  );

  /* 13 — payback, off rung 9 (it used to run off rung 5, understating it ~4.5x) */
  const bo = input.buildoutMidpoint;
  const boOk = bo != null && bo > 0;
  /* The build-out is recovered out of ANNUAL operating EBITDA. When the modeled
     cost range STRADDLES ZERO the best end still recovers and only the worst end
     never does — nulling the whole rung threw away a figure the buyer needs
     ("9.7 years at best, never at worst"), and forced the all-cash mock to
     recompute it locally. The worst end is Infinity, which is the honest value;
     paybackNeverAtLowEnd exists so no renderer has to sniff for it. */
  const paybackBest = boOk && ebitda.hi > 0 ? bo! / (ebitda.hi * 12) : null;
  const neverAtLowEnd = boOk && ebitda.lo <= 0;
  const payback =
    paybackBest == null
      ? null
      : m(paybackBest, neverAtLowEnd ? Number.POSITIVE_INFINITY : bo! / (ebitda.lo * 12));
  push(
    payback == null
      ? {
          ...nullRung("payback", 13, "Years to recover the build-out", "ratio",
            bo == null
              ? "No Item 7 investment range disclosed"
              : "Item 7 midpoint ÷ annual operating EBITDA"),
          note: boOk
            ? "The unit does not generate operating profit anywhere in the modeled cost range, so the build-out is never recovered."
            : undefined,
        }
      : {
          id: "payback", n: 13, label: "Years to recover the build-out", kind: "ratio",
          monthly: payback, annual: payback, pctOfRevenue: null,
          basis: weakest("derived", ebitdaBasis),
          source: `Item 7 midpoint $${Math.round(bo!).toLocaleString()} ÷ annual operating EBITDA`,
          note: neverAtLowEnd
            ? "Recovery of the build-out only, and it does not include the operator's own time. At the low end of the modeled cost range the unit does not generate operating profit, so the build-out is never recovered."
            : "Recovery of the build-out only. It does not include the operator's own time.",
        },
  );

  return finalize(rungs, debtMonthly, c.basis, neverAtLowEnd, input.revenueLabel);
}

function finalize(
  rungs: Rung[],
  debtMonthly: number | null,
  costBasis: Basis,
  paybackNeverAtLowEnd = false,
  revenueLabel = "Item 19 top line",
): CashLadder {
  const byId = new Map(rungs.map((r) => [r.id, r]));
  const get = (id: RungId) => byId.get(id) ?? null;
  return {
    rungs,
    get,
    marginAfterFeesAndRent: get("marginAfterFeesAndRent")?.monthly ?? null,
    operatingEbitda: get("operatingEbitda")?.monthly ?? null,
    cashAfterDebt: get("cashAfterDebt")?.monthly ?? null,
    dscr: get("dscr")?.monthly ?? null,
    paybackYears: get("payback")?.monthly ?? null,
    paybackNeverAtLowEnd,
    monthlyDebtService: debtMonthly,
    usesBenchmark: rungs.some((r) => r.basis === "benchmark"),
    costBasis,
    revenueLabel,
  };
}
