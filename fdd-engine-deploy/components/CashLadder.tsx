"use client";

/**
 * components/CashLadder.tsx
 * The paid report's cash ladder and financing panel.
 *
 * ONE LADDER PER RENDER. Everything on this screen — the hero EBITDA, the debt
 * payment, DSCR, cash after debt, payback, the leverage read — is READ OFF a
 * single CashLadder object built once per (result, loan, rate, term). Nothing
 * here recomputes a rung. That rule is not stylistic: the previous report
 * derived operating EBITDA in three places with three different definitions and
 * disagreed with itself by $2 on the same screen.
 *
 * FE-116 — the all-cash branch. A buyer whose liquid capital covers the
 * build-out has no lender, and no lender is not a $0 loan. Rungs 10 and 12 say
 * "none" and "not applicable" in words; rung 11 restates a live figure and rung
 * 13 is a live figure on a cash denominator, so BOTH stay lit.
 *
 * LABEL LAW — the readout describes the DEAL, never our analysis. Color is tier
 * reinforcement only, and the hero is NEVER red: a negative number is already
 * the bad news, and red on top of it reads as an accusation against the brand.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { DiligenceResult } from "@/lib/types";
import { buildCashLadder, maxSupportableLoan, type Basis, type Money, type Rung } from "@/lib/ladder";
import { buildLadderInput, resolvePercentageFees } from "@/lib/ladderInput";
import { BASIS_STYLE } from "@/lib/basis";
import { range } from "@/lib/range";

/* ────────────────────────────── formatting ────────────────────────────── */

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** A money range. Exact figures collapse to one number. */
const money = (v: Money) => range(usd0(v.lo), usd0(v.hi));

const ratio = (v: Money) => range(v.lo.toFixed(2), v.hi.toFixed(2));

/** LENDER CONVENTION, not our cutoff. We never say "we flag anything below". */
const DSCR_LENDER_FLOOR = 1.25;

/* Provenance palette lives in lib/basis.ts — ONE palette, two surfaces. This
   file used to declare its own, and DiligenceReport.tsx declared a different
   one, so BENCHMARK was violet here and amber there on the same page. */
const BasisChip = ({ basis }: { basis: Basis }) => {
  const b = BASIS_STYLE[basis];
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide whitespace-nowrap"
      style={{ color: b.color, background: b.color + "1A", border: `1px solid ${b.color}44` }}
    >
      {b.label}
    </span>
  );
};

/** A figure that does not exist gets WORDS, not a zero and not a dash. */
const Absent = ({ children }: { children: ReactNode }) => (
  <span className="text-[#64748B] italic font-normal">{children}</span>
);

/* ─────────────────────── the default financing plan ─────────────────────── */

/**
 * R3 — THE DEFAULT PLAN, encoded rather than assumed.
 *
 * The ladder opens on the plan the buyer's OWN inputs imply, never on a house
 * assumption about how much debt is normal:
 *
 *   capital gap  > 0  →  finance exactly the gap, at the SBA reference terms
 *   capital gap == 0  →  all cash, no lender  (FE-116)
 *
 * Anything else is us picking a capital structure on the buyer's behalf and
 * then grading the deal against our own choice. The slider is how a buyer
 * explores alternatives; the default is the one plan we can defend from what
 * they told us.
 */
const DEFAULT_PLAN = "finance-the-gap" as const;

/* ────────────────────────────── the section ────────────────────────────── */

export function CashLadderSection({
  result,
  rentControl,
  rentNote,
  provenance,
}: {
  result: DiligenceResult;
  /** the rent override editor, rendered inside rung 4 so the buyer edits the number where they read it */
  rentControl?: ReactNode;
  rentNote?: ReactNode;
  /** the Item 19 provenance note, rendered under rung 1 */
  provenance?: ReactNode;
}) {
  const s = result.scoring;
  const u = result.underwriting;

  const gapLoan = u?.recommendedLoan ?? 0;
  const buildout = s?.buildoutMidpoint ?? 0;
  const maxSlider = Math.max(buildout, gapLoan, 100_000);

  // DEFAULT_PLAN: finance the gap. A zero gap means all cash, and allCash is
  // the posture flag — not a loan of zero dollars.
  const [loan, setLoan] = useState<number>(Math.round(gapLoan));
  const [rate, setRate] = useState<number>(10.5);
  const [term, setTerm] = useState<number>(10);

  const allCash = !(loan > 0);

  const ladder = useMemo(
    () => buildCashLadder(buildLadderInput(result, { financing: allCash ? null : { loan, ratePct: rate, termYears: term } })),
    [result, allCash, loan, rate, term],
  );

  const feeRes = useMemo(() => resolvePercentageFees(result.extracted), [result.extracted]);

  const ebitda = ladder.operatingEbitda;
  const equityIn = allCash ? buildout : Math.max(0, buildout - loan);

  /* Every figure below is READ, never recomputed. */
  const annualEbitda = ladder.get("operatingEbitda")?.annual ?? null;
  const roe =
    annualEbitda && equityIn > 0
      ? { lo: (annualEbitda.lo / equityIn) * 100, hi: (annualEbitda.hi / equityIn) * 100 }
      : null;

  const supportable =
    ebitda && ebitda.hi > 0 ? maxSupportableLoan(ebitda.hi, DSCR_LENDER_FLOOR, rate, term) : 0;

  return (
    <>
      <section id="ladder" className="bg-[#16223B] border border-[#27344F] rounded-xl p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[#38BDF8] mb-1">
          The cash ladder — {ladder.revenueLabel}
        </h3>
        <p className="text-xs text-[#8194B0] mb-4">
          Rungs 1 through 9 are the business. Rung 10 onward is the deal — how you pay for it changes
          the bottom of this table and nothing above it.
        </p>

        <Hero ebitda={ebitda} annual={annualEbitda} revenue={ladder.get("revenue")?.monthly ?? null} />

        {!feeRes.complete && feeRes.note && (
          <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
            {feeRes.note}
          </p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[#64748B]">
                <th className="text-left font-semibold pb-2 pl-1">Rung</th>
                <th className="text-right font-semibold pb-2">Monthly</th>
                <th className="text-right font-semibold pb-2 hidden sm:table-cell">Annual</th>
                <th className="text-right font-semibold pb-2 hidden md:table-cell">% of revenue</th>
              </tr>
            </thead>
            <tbody>
              {ladder.rungs.map((r) => (
                <RungRow
                  key={r.id}
                  r={r}
                  allCash={allCash}
                  neverAtLowEnd={ladder.paybackNeverAtLowEnd}
                  extra={
                    r.id === "revenue" ? provenance : r.id === "occupancy" ? (
                      <>
                        {rentNote}
                        {rentControl}
                      </>
                    ) : null
                  }
                />
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 border-t border-[#27344F] pt-3 text-[11px] leading-relaxed text-[#8194B0]">
          {ladder.blockNote ||
            "Cost of goods, labor, and other operating costs are category ranges — an FDD never discloses them."}{" "}
          Rung 9 is before the owner&apos;s own pay. If you intend to draw a salary, it comes out of rung 11.
        </p>
      </section>

      <section id="financing" className="bg-[#16223B] border border-[#27344F] rounded-xl p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[#38BDF8] mb-1">
          How you pay for it
        </h3>
        <p className="text-xs text-[#8194B0] mb-4">
          {allCash
            ? "Set to all cash — no lender, no debt service. Move the slider to see what borrowing would cost."
            : `Opens on the plan your own numbers imply: finance the ${usd0(gapLoan)} gap between your liquid capital and the Item 7 mid-point. Move the slider to model a different structure.`}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <label className="block text-xs text-[#CBD5E1] mb-1">
              Loan: {loan > 0 ? usd0(loan) : <Absent>all cash — no lender</Absent>}
            </label>
            <input
              type="range"
              min={0}
              max={maxSlider}
              step={10000}
              value={loan}
              onChange={(e) => setLoan(Number(e.target.value))}
              className="w-full accent-[#34D399]"
              aria-label="Loan amount"
            />
            <div className="grid grid-cols-2 gap-3 mt-3 max-w-xs">
              <div>
                <label className="block text-xs text-[#8194B0] mb-1">Rate %</label>
                <input
                  type="number"
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                  className="w-full p-1.5 bg-[#0B1220] border border-[#27344F] rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8194B0] mb-1">Term (yr)</label>
                <input
                  type="number"
                  value={term}
                  onChange={(e) => setTerm(Number(e.target.value))}
                  className="w-full p-1.5 bg-[#0B1220] border border-[#27344F] rounded text-sm"
                />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Fig
                label="Monthly payment"
                value={ladder.monthlyDebtService ? usd0(ladder.monthlyDebtService) : <Absent>none</Absent>}
              />
              <Fig
                label="Cash you put in"
                value={equityIn > 0 ? usd0(equityIn) : <Absent>none</Absent>}
              />
              <Fig
                label="Cash after debt"
                value={ladder.cashAfterDebt ? money(ladder.cashAfterDebt) : <Absent>not applicable</Absent>}
                tone={ladder.cashAfterDebt && ladder.cashAfterDebt.lo < 0 ? "warn" : "good"}
              />
              <Fig
                label="Return on your cash"
                value={roe ? range(`${roe.lo.toFixed(1)}%`, `${roe.hi.toFixed(1)}%`) : <Absent>no cash at risk</Absent>}
                tone={roe && roe.lo < 0 ? "warn" : "good"}
              />
            </div>
          </div>

          <div className="bg-[#0B1220] border border-[#27344F] rounded-lg p-4">
            <p className="text-xs font-bold uppercase text-[#8194B0] mb-2">Debt-service coverage</p>
            {ladder.dscr ? (
              <>
                <p
                  className="text-3xl font-black"
                  style={{ color: ladder.dscr.lo >= DSCR_LENDER_FLOOR ? "#34D399" : "#F59E0B" }}
                >
                  {ratio(ladder.dscr)}
                </p>
                <p className="text-[11px] text-[#8194B0] mt-2 leading-relaxed">
                  Operating EBITDA divided by debt service. Lenders typically want{" "}
                  {DSCR_LENDER_FLOOR.toFixed(2)} or better, and often write it into the loan as a
                  covenant you have to hold every year — not just at closing.
                  {ladder.dscr.lo < 0
                    ? " At the low end of the modeled cost range there is no coverage at all: the unit does not produce operating profit to cover the payment."
                    : ""}
                </p>
              </>
            ) : (
              <>
                <p className="text-3xl font-black text-[#64748B] italic">not applicable</p>
                <p className="text-[11px] text-[#8194B0] mt-2 leading-relaxed">
                  There is no debt in this plan, so there is no coverage ratio. It is the figure a
                  lender would grade you on the day you decide to borrow — lenders typically want{" "}
                  {DSCR_LENDER_FLOOR.toFixed(2)} or better.
                </p>
              </>
            )}

            <div className="mt-4 border-t border-[#27344F] pt-3">
              <p className="text-[10px] uppercase font-bold text-[#8194B0]">
                What this unit could support
              </p>
              <p className="text-lg font-bold text-[#CBD5E1] mt-1">
                {supportable > 0 ? usd0(supportable) : <Absent>nothing, at the modeled costs</Absent>}
              </p>
              <p className="text-[11px] text-[#8194B0] mt-1 leading-relaxed">
                The largest loan that still clears {DSCR_LENDER_FLOOR.toFixed(2)} coverage at{" "}
                {rate}% over {term} years, using the BEST end of the modeled cost range. At the low
                end it supports less, and the gap between those two numbers is the conversation to
                have with your lender.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ────────────────────────────── pieces ────────────────────────────── */

function Hero({
  ebitda,
  annual,
  revenue,
}: {
  ebitda: Money | null;
  annual: Money | null;
  revenue: Money | null;
}) {
  if (!ebitda) {
    return (
      <div className="rounded-lg border border-[#27344F] bg-[#0B1220] px-4 py-3">
        <p className="text-[10px] uppercase font-bold text-[#8194B0]">Operating EBITDA</p>
        <p className="text-lg text-[#64748B] italic mt-1">
          Not enough disclosed data to model this unit&apos;s operating profit.
        </p>
      </div>
    );
  }
  // R1 — the hero is NEVER red. A shortfall is amber; the number itself is the
  // bad news and does not need a second accusation on top of it.
  const strong = ebitda.lo > 0;
  const color = strong ? "#34D399" : "#F59E0B";
  const marginPct =
    revenue && revenue.hi > 0
      ? { lo: (ebitda.lo / revenue.hi) * 100, hi: (ebitda.hi / revenue.lo) * 100 }
      : null;
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: color + "66", background: color + "14" }}
    >
      <p className="text-[10px] uppercase font-bold text-[#8194B0]">
        Operating EBITDA — monthly, before debt and owner pay
      </p>
      <p className="text-3xl font-black mt-1" style={{ color }}>
        {money(ebitda)}
      </p>
      <p className="text-[11px] text-[#8194B0] mt-1">
        {annual ? `${money(annual)} a year` : ""}
        {marginPct ? ` · ${range(`${marginPct.lo.toFixed(1)}%`, `${marginPct.hi.toFixed(1)}%`)} of revenue` : ""}
        {strong ? "" : " · at the expensive end of the modeled cost range this unit does not turn an operating profit"}
      </p>
    </div>
  );
}

function RungRow({
  r,
  allCash,
  neverAtLowEnd,
  extra,
}: {
  r: Rung;
  allCash: boolean;
  neverAtLowEnd: boolean;
  extra?: ReactNode;
}) {
  /* Dim ONLY the rows that genuinely do not exist for a cash buyer. Rung 11
     restates a live figure and rung 13 is a live figure on a new denominator —
     both stay lit. */
  const dim = allCash && (r.id === "debtService" || r.id === "dscr");
  const emphatic = r.kind === "result" || r.kind === "subtotal";

  const value = (() => {
    if (r.id === "dscr") {
      if (!r.monthly) return <Absent>not applicable</Absent>;
      return ratio(r.monthly);
    }
    if (r.id === "payback") {
      if (!r.monthly) return <Absent>never, at the modeled costs</Absent>;
      if (neverAtLowEnd)
        return (
          <span>
            {r.monthly.lo.toFixed(1)} yrs at best{" "}
            <Absent>· never at worst</Absent>
          </span>
        );
      return `${range(r.monthly.lo.toFixed(1), r.monthly.hi.toFixed(1))} yrs`;
    }
    if (!r.monthly) {
      if (r.id === "debtService") return <Absent>none</Absent>;
      return <Absent>not disclosed</Absent>;
    }
    return money(r.monthly);
  })();

  const annual = (() => {
    if (r.kind === "ratio" || !r.annual) return null;
    return money(r.annual);
  })();

  return (
    <>
      <tr className={`border-t border-[#27344F]/70 ${dim ? "opacity-45" : ""}`}>
        <td className="py-2 pl-1 align-top">
          <span className="text-[10px] text-[#64748B] tabular-nums mr-2">{r.n}</span>
          <span className={emphatic ? "font-bold text-[#F1F5F9]" : "text-[#CBD5E1]"}>{r.label}</span>
          <span className="ml-2 inline-block align-middle">
            <BasisChip basis={r.basis} />
          </span>
          <span className="block text-[10px] text-[#64748B] mt-0.5">{r.source}</span>
        </td>
        <td className={`py-2 pl-2 text-right align-top tabular-nums whitespace-nowrap ${emphatic ? "font-bold text-[#F1F5F9]" : "text-[#CBD5E1]"}`}>
          {value}
        </td>
        <td className="py-2 text-right align-top tabular-nums text-[#8194B0] hidden sm:table-cell">
          {annual ?? ""}
        </td>
        <td className="py-2 text-right align-top tabular-nums text-[#8194B0] hidden md:table-cell">
          {r.pctOfRevenue
            ? Math.abs(r.pctOfRevenue.lo - r.pctOfRevenue.hi) < 0.05
              ? `${r.pctOfRevenue.lo.toFixed(1)}%`
              : `${r.pctOfRevenue.lo.toFixed(1)}–${r.pctOfRevenue.hi.toFixed(1)}%`
            : ""}
        </td>
      </tr>
      {(r.note || extra) && (
        <tr className={dim ? "opacity-45" : ""}>
          <td colSpan={4} className="pb-2 pl-1">
            {r.note && <p className="text-[10px] leading-relaxed text-[#8194B0]">{r.note}</p>}
            {extra}
          </td>
        </tr>
      )}
    </>
  );
}

function Fig({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "good" | "warn";
}) {
  const color = tone === "warn" ? "#F59E0B" : tone === "good" ? "#34D399" : "#F1F5F9";
  return (
    <div className="bg-[#0B1220] border border-[#27344F] rounded-lg p-3">
      <p className="text-[10px] uppercase font-bold text-[#8194B0]">{label}</p>
      <p className="text-base font-bold mt-1" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

export { DEFAULT_PLAN };
