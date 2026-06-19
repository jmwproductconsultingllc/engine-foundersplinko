"use client";

import { useEffect } from "react";
import type { DiligenceResult } from "@/lib/types";
import { track } from "@/lib/analytics";
import { recurringFeeDisplays } from "@/lib/fees";

/**
 * InfographicTeaser — the FREE tier shown after a parse.
 *
 * Deliberately built ONLY on bulletproof, always-present fields: brand, risk
 * level + reasons, Item 7 range, the buyer's capital gap, system scale, Item 19
 * presence, and the royalty line (via the fees helper). It never touches the
 * fragile derived cohort margins / build-up — those live behind the unlock.
 *
 * The unlock CTA fires `upgrade_clicked` and calls onUnlock. Today onUnlock just
 * reveals the full report; when payment lands it routes to checkout instead —
 * same event, so the funnel reads coherently from the first dollar.
 */

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);

export default function InfographicTeaser({
  result,
  onUnlock,
}: {
  result: DiligenceResult;
  onUnlock: () => void;
}) {
  const { extracted: x, scoring: s, underwriting: u, buyer } = result;
  const fc = result.financialCondition ?? null;
  const fees = recurringFeeDisplays(x);

  const eventProps = {
    riskLevel: s.riskLevel ?? null,
    capital: buyer?.liquidCapital ?? null,
    finconSeverity: fc?.severity ?? "none",
    proFormaBuilt: s.midCohort != null,
  };

  useEffect(() => {
    track("teaser_viewed", eventProps);
    // fire once when the teaser is shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const risk = s.riskLevel ?? "—";
  const tone =
    risk === "High"
      ? { text: "text-red-400", border: "border-red-500/40", bg: "bg-red-500/10", dot: "bg-red-400" }
      : risk === "Medium"
        ? { text: "text-amber-300", border: "border-amber-500/40", bg: "bg-amber-500/10", dot: "bg-amber-300" }
        : { text: "text-[#34D399]", border: "border-[#34D399]/40", bg: "bg-[#34D399]/10", dot: "bg-[#34D399]" };

  const low = x.item17?.initialInvestmentLow ?? null;
  const high = x.item17?.initialInvestmentHigh ?? null;
  const hasRange = low != null || high != null;

  const capital = buyer?.liquidCapital ?? 0;
  const gap = u?.capitalGap ?? null; // positive = shortfall
  const loanNeeded = !!u?.sbaLoanRequired;
  const hasGap = capital > 0 && gap != null;

  const units = x.systemScale?.totalUnits ?? null;
  const opened = x.systemScale?.openedLastYear ?? null;
  const closed = x.systemScale?.closedLastYear ?? null;
  const item19 = !!x.item19?.hasItem19;
  const royalty = fees.royalty.pct ?? "No % royalty";

  const reasons = (s.riskReasons ?? []).filter(Boolean);
  const topReason = reasons[0] ?? null;
  const moreReasons = Math.max(0, reasons.length - 1);

  const handleUnlock = () => {
    track("upgrade_clicked", { ...eventProps, price: null });
    onUnlock();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="overflow-hidden rounded-2xl border border-[#27344F] bg-[#0E1729]">
        {/* header */}
        <div className="border-b border-[#27344F] px-6 py-5">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#38BDF8]">
            Franchise Edge · Free snapshot
          </p>
          <h2 className="text-2xl font-bold leading-tight text-[#F1F5F9]">
            {x.brandName || "This franchise"}
          </h2>
        </div>

        {/* risk verdict */}
        <div className="px-6 pt-5">
          <div className={`flex items-center gap-2.5 rounded-xl border ${tone.border} ${tone.bg} px-4 py-3`}>
            <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
            <span className="text-sm text-[#CBD5E1]">Diligence risk level</span>
            <span className={`ml-auto text-lg font-bold ${tone.text}`}>{risk}</span>
          </div>
          {topReason && (
            <p className="mt-2 px-1 text-[13px] leading-snug text-[#8194B0]">
              {topReason}
              {moreReasons > 0 && (
                <span className="text-[#5A6B88]">
                  {" "}
                  · +{moreReasons} more flag{moreReasons > 1 ? "s" : ""} inside
                </span>
              )}
            </p>
          )}
        </div>

        {/* capital fit — the signature */}
        <div className="px-6 pt-5">
          <div className="rounded-xl border border-[#27344F] bg-[#0B1220] p-4">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8194B0]">To open</p>
                <p className="mt-0.5 text-xl font-bold text-[#F5B847]">
                  {hasRange ? (
                    <>
                      {usd(low)} <span className="text-sm font-medium text-[#8194B0]">–</span> {usd(high)}
                    </>
                  ) : (
                    "—"
                  )}
                </p>
              </div>
              {capital > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8194B0]">Your capital</p>
                  <p className="mt-0.5 text-xl font-bold text-[#F1F5F9]">{usd(capital)}</p>
                </div>
              )}
            </div>
            {hasGap && (
              <div className="mt-4 flex items-center gap-2 border-t border-[#27344F] pt-3">
                {gap > 0 ? (
                  <>
                    <span className="text-sm text-[#CBD5E1]">Capital gap</span>
                    <span className="ml-auto text-lg font-bold text-[#F5B847]">{usd(gap)}</span>
                    {loanNeeded && (
                      <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                        Loan or partner needed
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-sm text-[#CBD5E1]">Capital fit</span>
                    <span className="ml-auto rounded-md bg-[#34D399]/15 px-2 py-0.5 text-[11px] font-semibold text-[#34D399]">
                      Covered by your capital
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* at a glance */}
        <div className="grid grid-cols-3 gap-2 px-6 pt-5">
          <Glance
            label="System units"
            value={units != null ? units.toLocaleString() : "—"}
            sub={opened != null || closed != null ? `+${opened ?? 0} / −${closed ?? 0} yr` : undefined}
          />
          <Glance
            label="Earnings (Item 19)"
            value={item19 ? "Disclosed" : "None"}
            sub={item19 ? undefined : "not represented"}
            tone={item19 ? "good" : "warn"}
          />
          <Glance label="Royalty" value={royalty} />
        </div>

        {/* what's inside */}
        <div className="px-6 pt-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#8194B0]">The full report opens</p>
          <ul className="mt-2 space-y-1.5">
            {[
              "Real unit economics, modeled against your capital",
              "Financial-health severity grade (Item 21 audit)",
              "Every fee and hidden cost, with page cites",
              "Operational tripwires and territory terms",
              "Leadership, system scale, and Item 19 cohorts",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-[13px] text-[#CBD5E1]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* CTA */}
        <div className="px-6 pb-6 pt-5">
          <button
            onClick={handleUnlock}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#34D399] px-5 py-3.5 text-[15px] font-bold text-[#06231A] transition-colors hover:bg-[#2BBD87]"
          >
            Unlock the full report
            <span aria-hidden>→</span>
          </button>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-[#5A6B88]">
            Informational only — not legal, financial, or investment advice. Figures are AI-extracted; verify
            against the source FDD.
          </p>
        </div>
      </div>
    </div>
  );
}

function Glance({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn";
}) {
  const valColor = tone === "good" ? "text-[#34D399]" : tone === "warn" ? "text-amber-300" : "text-[#F1F5F9]";
  return (
    <div className="rounded-lg border border-[#27344F] bg-[#0B1220] px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8194B0]">{label}</p>
      <p className={`mt-1 text-base font-bold ${valColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-[#5A6B88]">{sub}</p>}
    </div>
  );
}
