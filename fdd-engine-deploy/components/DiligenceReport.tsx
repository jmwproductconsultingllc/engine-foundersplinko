"use client";

import { useState, type ReactNode } from "react";
import type { DiligenceResult } from "@/lib/types";

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);

const Card = ({ title, children }: { title: ReactNode; children: ReactNode }) => (
  <section className="bg-[#16223B] border border-[#27344F] rounded-xl p-6">
    <h3 className="text-sm font-bold uppercase tracking-wider text-[#38BDF8] mb-4">{title}</h3>
    {children}
  </section>
);

const Src = ({ s }: { s?: string }) =>
  s ? <span className="text-[11px] text-[#8194B0] ml-1">({s})</span> : null;

function amortize(p: number, ratePct: number, years: number) {
  if (p <= 0) return 0;
  const r = ratePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return p / n;
  return (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export default function DiligenceReport({ result }: { result: DiligenceResult }) {
  const { extracted: x, scoring: s, underwriting: u } = result;
  const ins = result.insights ?? null;

  const riskColor =
    s.riskLevel === "High"
      ? "text-red-400 border-red-500/40 bg-red-500/10"
      : s.riskLevel === "Medium"
        ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
        : "text-[#34D399] border-[#34D399]/40 bg-[#34D399]/10";

  // interactive debt-service model (client-side, pure math)
  const maxLoan = s.buildoutMidpoint ?? 0;
  const [loan, setLoan] = useState<number>(u.recommendedLoan ?? Math.round(maxLoan * 0.8));
  const [rate, setRate] = useState<number>(10.5);
  const [term, setTerm] = useState<number>(10);
  const debt = amortize(loan, rate, term);
  const ebitda = s.midCohort?.monthlyEbitda ?? 0;
  const net = ebitda - debt;

  return (
    <div className="space-y-5 text-[#F1F5F9]">
      {/* Header */}
      <div className="bg-[#0B1220] border border-[#27344F] rounded-xl p-6">
        <h2 className="text-2xl font-bold">{x.brandName || "Franchise"} — Diligence Report</h2>
        <p className="text-sm text-[#8194B0] mt-1">
          {x.franchisorEntity}
          {x.headquarters ? ` · ${x.headquarters}` : ""}
        </p>
      </div>

      {/* Document warnings */}
      {(!x.documentCheck?.appearsComplete ||
        x.documentCheck?.appearsScanned ||
        (x.documentCheck?.warnings?.length ?? 0) > 0) && (
        <div className="border border-amber-500/40 bg-amber-500/10 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-300 mb-1">Document check</p>
          <ul className="text-sm text-amber-200/90 list-disc pl-5 space-y-1">
            {!x.documentCheck.appearsComplete && (
              <li>The document may be incomplete or truncated — verify core Items are present.</li>
            )}
            {x.documentCheck.appearsScanned && (
              <li>This looks like a scanned PDF; extraction accuracy may be lower.</li>
            )}
            {x.documentCheck.warnings?.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
          <p className="text-xs text-[#8194B0] mt-2">Items found: {x.documentCheck.itemsFound?.join(", ") || "—"}</p>
        </div>
      )}

      {/* Risk score */}
      <div className={`border rounded-xl p-6 ${riskColor}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold uppercase tracking-wider text-[#CBD5E1]">Risk Level</span>
          <span className="text-2xl font-black">{s.riskLevel}</span>
        </div>
        <ul className="mt-3 space-y-1.5 text-sm text-[#CBD5E1]">
          {s.riskReasons.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-[#8194B0]">
          Score computed from disclosed assumptions (DSCR, rent share, payback, cohort survival) — not a
          statement of fact about the franchisor.
        </p>
      </div>

      {/* Buyer-fit underwriting (the killer feature) */}
      <div
        className={`border-l-4 rounded-xl p-6 bg-[#16223B] ${
          u.sbaLoanRequired ? "border-amber-400" : "border-[#34D399]"
        }`}
      >
        <h3 className="text-sm font-bold uppercase tracking-wider text-[#38BDF8] mb-3">
          Buyer-Fit Underwriting
        </h3>
        <p className="text-[#CBD5E1] leading-relaxed">{u.assessment}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          <Stat label="Capital Gap" value={usd(u.capitalGap)} />
          <Stat label="Loan Needed" value={u.sbaLoanRequired ? "Yes" : "No"} />
          <Stat
            label="Net Worth Req."
            value={
              u.meetsNetWorthRequirement == null ? "—" : u.meetsNetWorthRequirement ? "Met" : "Short"
            }
          />
          <Stat
            label="Net Cash Flow"
            value={usd(u.adjustedMonthlyNetCashFlow)}
            tone={(u.adjustedMonthlyNetCashFlow ?? 0) < 0 ? "bad" : "good"}
          />
        </div>
      </div>

      {/* Interactive pro forma */}
      <Card title={`Pro Forma — ${s.midCohort?.label ?? "Mid Cohort"}`}>
        {s.midCohort ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              <Row label="Monthly Gross Revenue" value={usd(s.midCohort.monthlyRevenue)} bold green />
              <Row
                label={`Franchise fees (${Math.round(s.variableRate * 100)}% of sales)`}
                value={`-${usd(s.midCohort.monthlyVariable)}`}
                red
              />
              <Row label="Fixed costs (fees + rent)" value={`-${usd(s.fixedMonthly)}`} red />
              <div className="border-t border-[#27344F] pt-3">
                <Row label="Margin after fees & rent" value={usd(s.midCohort.monthlyEbitda)} bold />
                <p className="text-[10px] text-[#8194B0] mt-1">Before COGS, labor, maintenance, and owner pay — see Insights below.</p>
              </div>
            </div>

            <div className="bg-[#0B1220] border border-[#27344F] rounded-lg p-4">
              <p className="text-xs font-bold uppercase text-[#8194B0] mb-3">Debt Service</p>
              <label className="block text-xs text-[#CBD5E1] mb-1">Loan: {usd(loan)}</label>
              <input
                type="range"
                min={0}
                max={maxLoan || 1000000}
                step={10000}
                value={loan}
                onChange={(e) => setLoan(Number(e.target.value))}
                className="w-full accent-[#34D399]"
              />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-[#8194B0] mb-1">Rate %</label>
                  <input
                    type="number"
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    className="w-full p-1.5 bg-[#16223B] border border-[#27344F] rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8194B0] mb-1">Term (yr)</label>
                  <input
                    type="number"
                    value={term}
                    onChange={(e) => setTerm(Number(e.target.value))}
                    className="w-full p-1.5 bg-[#16223B] border border-[#27344F] rounded text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-between text-sm mt-3 pt-3 border-t border-[#27344F]">
                <span className="text-[#8194B0]">Monthly payment</span>
                <span className="text-red-400 font-semibold">-{usd(debt)}</span>
              </div>
              <div
                className={`mt-3 p-3 rounded-lg border ${
                  net >= 0 ? "border-[#34D399]/40 bg-[#34D399]/10" : "border-red-500/40 bg-red-500/10"
                }`}
              >
                <p className="text-[11px] uppercase font-bold text-[#8194B0]">Net monthly cash flow</p>
                <p className={`text-2xl font-black ${net >= 0 ? "text-[#34D399]" : "text-red-400"}`}>
                  {usd(net)}
                </p>
                <p className="text-[10px] text-[#8194B0] mt-1">Before COGS, labor, maintenance, owner draw.</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#8194B0]">Not enough Item 19 data to build a pro forma.</p>
        )}
      </Card>

      {/* Franchise Edge · Insights — operating benchmarks the FDD can't disclose */}
      {ins && (() => {
        const b = ins.benchmark;
        const cc = ({
          consistent: { color: "#34D399", heading: "Consistent with industry norms" },
          optimistic: { color: "#F59E0B", heading: "Optimistic vs. industry norms" },
          conservative: { color: "#60A5FA", heading: "Conservative vs. industry norms" },
          no_disclosure: { color: "#8194B0", heading: "No margin disclosed in Item 19" },
        } as const)[ins.crossCheck.status];
        return (
          <Card title="Franchise Edge · Insights">
            <div className="space-y-4">
              <p className="text-xs text-[#8194B0]">
                Classified as{" "}
                <span className="text-[#CBD5E1] font-semibold">{ins.conceptLabel}</span>
                {ins.conceptRationale ? ` — ${ins.conceptRationale}` : ""}. An FDD discloses
                fees and investment, never the franchisee&apos;s operating costs. Here is what
                to budget for and verify.
              </p>

              {ins.staffingNote && (
                <div className="rounded-lg border border-[#60A5FA]/30 bg-[#60A5FA]/10 p-3">
                  <p className="text-[11px] font-bold uppercase text-[#60A5FA]">
                    Operating model: {ins.staffingLabel}
                  </p>
                  <p className="text-xs text-[#CBD5E1] mt-1">{ins.staffingNote}</p>
                </div>
              )}

              {/* disclosed-margin cross-check */}
              <div
                className="rounded-lg border p-3"
                style={{ borderColor: cc.color + "66", background: cc.color + "14" }}
              >
                <p className="text-[11px] font-bold uppercase" style={{ color: cc.color }}>
                  {cc.heading}
                </p>
                <p className="text-xs text-[#CBD5E1] mt-1">{ins.crossCheck.message}</p>
              </div>

              {/* transparent build-up to true operating EBITDA — show the math */}
              {ins.buildup.length > 0 && (
                <div className="rounded-lg border border-[#27344F]">
                  <p className="text-[10px] uppercase text-[#8194B0] px-3 pt-3">
                    How we get to true operating EBITDA
                  </p>
                  <div className="p-3 space-y-1.5">
                    {ins.buildup.map((r, i) => {
                      const isResult = r.kind === "result";
                      const dollar = r.dollarRange
                        ? r.dollarRange[0] === r.dollarRange[1]
                          ? usd(r.dollarRange[0])
                          : `${usd(r.dollarRange[0])}–${usd(r.dollarRange[1])}`
                        : "";
                      const pct = r.pctRange ? `${r.pctRange[0]}–${r.pctRange[1]}%` : "";
                      return (
                        <div key={i} className={isResult ? "pt-2 mt-1 border-t border-[#27344F]" : ""}>
                          <div className="flex justify-between items-baseline gap-3">
                            <span className={`text-xs ${isResult ? "font-semibold text-white" : "text-[#CBD5E1]"}`}>
                              {r.label}
                            </span>
                            <span className="text-xs whitespace-nowrap">
                              {pct && <span className="text-[#8194B0] mr-2">{pct}</span>}
                              {dollar && (
                                <span className={isResult ? "font-bold text-[#34D399]" : "text-[#CBD5E1]"}>
                                  {dollar}/mo
                                </span>
                              )}
                            </span>
                          </div>
                          {r.note && <p className="text-[10px] text-[#8194B0] mt-0.5">{r.note}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-[#8194B0]">
                {ins.trueEbitdaBasis === "modeled"
                  ? `COGS, labor, and other opex are category benchmarks applied to the modeled gross of ${usd(ins.proFormaRevenueMonthly)}/mo. Labor headcount is implied at ~$20/hr fully loaded. Rent and franchise fees are already inside "margin after fees & rent."`
                  : ins.trueEbitdaBasis === "disclosed"
                  ? "True operating EBITDA here uses the franchisor's own disclosed margin, applied to the modeled franchised gross."
                  : ""}
              </p>

              {/* contact hook → territory consulting */}
              <div className="rounded-lg border border-[#34D399]/30 bg-[#34D399]/5 p-3">
                <p className="text-xs text-[#CBD5E1]">{ins.consultCtaPitch}</p>
                {ins.consultCtaUrl && (
                  <a
                    href={ins.consultCtaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-xs font-semibold text-[#0B1220] bg-[#34D399] rounded-md px-3 py-1.5"
                  >
                    {ins.consultCtaLabel} →
                  </a>
                )}
              </div>

              <div className="text-xs text-[#CBD5E1] space-y-2">
                <p>
                  <span className="font-semibold text-white">What actually decides the deal:</span>{" "}
                  {b.dominantRisk}
                </p>
                <p>
                  <span className="font-semibold text-white">Ramp:</span> {b.rampNote}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase text-[#8194B0] mb-2">
                  Critical considerations — {ins.conceptLabel}
                </p>
                <ul className="space-y-1.5">
                  {b.considerations.map((c, i) => (
                    <li key={i} className="text-xs text-[#CBD5E1] flex gap-2">
                      <span className="text-[#34D399]">›</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[10px] text-[#64748B] border-t border-[#27344F] pt-2">
                {ins.disclaimer}
                {ins.disclosedMarginSource ? ` Disclosed-margin basis: ${ins.disclosedMarginSource}.` : ""}{" "}
                ({ins.asOf})
              </p>
            </div>
          </Card>
        );
      })()}

      {/* Item 19 cohorts */}
      <Card title={<>Item 19 — Financial Performance <Src s={x.item19?.sourcePage} /></>}>
        {x.item19?.hasItem19 ? (
          <div className="space-y-2">
            {x.item19.cohorts.map((c, i) => (
              <Row key={i} label={`${c.label}${c.basis ? ` — ${c.basis}` : ""}`} value={`${usd(c.avgMonthlyRevenue)}/mo`} />
            ))}
            {x.item19.notes && <p className="text-xs text-[#8194B0] mt-2">{x.item19.notes}</p>}
          </div>
        ) : (
          <p className="text-sm text-amber-300">No Item 19 disclosed — earnings are not represented by the franchisor.</p>
        )}
      </Card>

      {/* Item 17 costs */}
      <Card title={<>Item 17 — Initial Investment <Src s={x.item17?.sourcePage} /></>}>
        <p className="text-sm text-[#CBD5E1] mb-3">
          Estimated total: <span className="font-semibold">{usd(x.item17?.initialInvestmentLow)}</span> –{" "}
          <span className="font-semibold">{usd(x.item17?.initialInvestmentHigh)}</span>
        </p>
        <CostGroup title="Non-recurring (build-out)" items={x.item17?.lineItems?.filter((l) => !l.recurring) ?? []} />
        <CostGroup title="Recurring (ongoing)" items={x.item17?.lineItems?.filter((l) => l.recurring) ?? []} />
      </Card>

      {/* Fees + hidden costs */}
      <Card title="Ongoing Fees & Hidden Costs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2 text-sm">
            <Row label="Royalty" value={x.ongoingFees?.royaltyPct != null ? `${x.ongoingFees.royaltyPct}%` : "—"} />
            <Row label="Brand fund" value={x.ongoingFees?.brandFundPct != null ? `${x.ongoingFees.brandFundPct}%` : "—"} />
            <Row label="Local ad" value={x.ongoingFees?.localAdPct != null ? `${x.ongoingFees.localAdPct}%` : "—"} />
            {x.ongoingFees?.flatMonthlyFees?.map((ff, i) => (
              <Row key={i} label={<>{ff.name} <Src s={ff.source} /></>} value={`${usd(ff.monthlyAmount)}/mo`} />
            ))}
          </div>
          <div className="space-y-3">
            {(x.hiddenCosts ?? []).map((h, i) => (
              <div key={i} className="border border-[#27344F] rounded-lg p-3">
                <p className="text-sm font-semibold text-amber-300">
                  {h.name} {h.estimatedAnnualAmount != null ? `· ${usd(h.estimatedAnnualAmount)}/yr` : ""}
                </p>
                <p className="text-xs text-[#CBD5E1] mt-1">{h.description}</p>
                <Src s={h.source} />
              </div>
            ))}
            {(x.hiddenCosts?.length ?? 0) === 0 && (
              <p className="text-sm text-[#8194B0]">No ancillary/hidden costs flagged.</p>
            )}
          </div>
        </div>
      </Card>

      {/* Leadership */}
      {(x.leadership?.length ?? 0) > 0 && (
        <Card title="Franchisor Leadership">
          <div className="space-y-3">
            {x.leadership.map((m, i) => (
              <div key={i}>
                <p className="text-sm font-semibold">
                  {m.name} <span className="text-[#8194B0] font-normal">· {m.role}</span>
                </p>
                <p className="text-xs text-[#CBD5E1]">{m.background}</p>
                {m.whyItMatters && <p className="text-xs text-[#38BDF8] mt-0.5">Why it matters: {m.whyItMatters}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* System scale */}
      <Card title={<>System Scale <Src s={x.systemScale?.sourcePage} /></>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Total units" value={x.systemScale?.totalUnits?.toLocaleString() ?? "—"} />
          <Stat label="Opened (yr)" value={x.systemScale?.openedLastYear?.toLocaleString() ?? "—"} />
          <Stat label="Closed (yr)" value={x.systemScale?.closedLastYear?.toLocaleString() ?? "—"} tone="bad" />
          <Stat label="Transfers (yr)" value={x.systemScale?.transfersLastYear?.toLocaleString() ?? "—"} />
        </div>
      </Card>

      {/* Operational risks */}
      {(x.operationalRisks?.length ?? 0) > 0 && (
        <Card title="Operational Tripwires">
          <div className="space-y-3">
            {x.operationalRisks.map((r, i) => (
              <div key={i} className="border border-[#27344F] rounded-lg p-3">
                <p className="text-sm font-semibold">
                  {r.title}{" "}
                  <span
                    className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                      r.severity === "high"
                        ? "bg-red-500/20 text-red-300"
                        : r.severity === "medium"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-[#27344F] text-[#8194B0]"
                    }`}
                  >
                    {r.severity}
                  </span>
                </p>
                <p className="text-xs text-[#CBD5E1] mt-1">{r.description}</p>
                <Src s={r.source} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Disclaimer */}
      <p className="text-[11px] text-[#8194B0] leading-relaxed border-t border-[#27344F] pt-4">
        This report is generated from the uploaded document for informational purposes only and is not legal,
        financial, or investment advice. Figures are extracted by an AI model and may contain errors — verify
        every number against the source FDD before making any decision.
      </p>
    </div>
  );
}

/* ---- small presentational helpers ---- */

function Row({
  label,
  value,
  bold,
  red,
  green,
}: {
  label: ReactNode;
  value: string;
  bold?: boolean;
  red?: boolean;
  green?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={`text-sm ${bold ? "font-bold text-[#F1F5F9]" : "text-[#CBD5E1]"}`}>{label}</span>
      <span
        className={`${bold ? "text-lg font-bold" : "text-sm font-medium"} ${
          red ? "text-red-400" : green ? "text-[#34D399]" : "text-[#F1F5F9]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <p className="text-[11px] uppercase font-bold text-[#8194B0]">{label}</p>
      <p
        className={`text-lg font-bold ${
          tone === "bad" ? "text-red-400" : tone === "good" ? "text-[#34D399]" : "text-[#F1F5F9]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function CostGroup({
  title,
  items,
}: {
  title: string;
  items: { category: string; low: number | null; high: number | null; notes: string }[];
}) {
  if (items.length === 0) return null;
  const usdLocal = (n: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  return (
    <div className="mb-4">
      <p className="text-xs font-bold uppercase text-[#8194B0] mb-2">{title}</p>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-[#CBD5E1]">{it.category}</span>
            <span className="text-[#F1F5F9] font-medium">
              {usdLocal(it.low)} – {usdLocal(it.high)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
