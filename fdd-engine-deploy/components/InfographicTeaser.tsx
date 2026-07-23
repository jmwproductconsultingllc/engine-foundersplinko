"use client";

import { useEffect, useState } from "react";
import type { DiligenceResult } from "@/lib/types";
import { track } from "@/lib/analytics";
import { recurringFeeDisplays } from "@/lib/fees";
import { DiligenceModule } from "@/components/DiligenceToVerify";
import { computeVerify } from "@/lib/verify";
import type { BenchmarkCopy } from "@/lib/riskBenchmarks";

/**
 * InfographicTeaser — the FREE tier shown after a parse.
 *
 * Deliberately built ONLY on bulletproof, always-present fields: brand, risk
 * level + reasons, Item 7 range, the buyer's capital gap, system scale, Item 19
 * presence, and the royalty line (via the fees helper). It never touches the
 * fragile derived cohort margins / build-up — those live behind the unlock.
 *
 * The unlock CTA fires `upgrade_clicked` and calls onUnlock. onUnlock now routes
 * to Stripe checkout (the parent handles the navigation) — same event, so the
 * funnel reads coherently from the first dollar.
 */

// Launch price shown on the CTA. NOTE: the charged amount is set independently
// in app/api/checkout/route.ts (PRICE_CENTS). Keep these in sync until the A/B
// (#2) consolidates pricing into one source.
const PRICE_CENTS = 19900;
const PRICE_LABEL = "$199";

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
  benchmark,
  benchmarkTotal,
  reportId,
  hasBroker,
}: {
  result: DiligenceResult;
  onUnlock: () => void;
  /** Risk Reframe — corpus benchmark for this brand's tier + vertical */
  benchmark?: BenchmarkCopy | null;
  benchmarkTotal?: number;
  /** report id — lets the broker fallback persist to the report record */
  reportId?: string;
  /** broker already captured during the analyzing wait → skip the teaser ask */
  hasBroker?: boolean;
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

  const verify = computeVerify(s.riskReasons);

  const low = x.item17?.initialInvestmentLow ?? null;
  const high = x.item17?.initialInvestmentHigh ?? null;
  const hasRange = low != null || high != null;

  // Interactive capital fit (P1): the buyer can model THEIR capital and watch the
  // gap recompute live — same formula the server used (buildout midpoint − capital).
  // buildoutMidpoint is a bulletproof always-present field (Item 7), so this stays
  // within the teaser's "never touch fragile derived fields" contract.
  const buildoutMid = s.buildoutMidpoint ?? null;
  const [cap, setCap] = useState<number>(
    buyer?.liquidCapital && buyer.liquidCapital > 0 ? buyer.liquidCapital : 250000,
  );
  const gap = buildoutMid != null ? Math.max(0, Math.round(buildoutMid - cap)) : (u?.capitalGap ?? null);
  const loanNeeded = gap != null && gap > 0;
  const hasGap = buildoutMid != null || u?.capitalGap != null;
  const capital = cap;

  const units = x.systemScale?.totalUnits ?? null;
  const opened = x.systemScale?.openedLastYear ?? null;
  const closed = x.systemScale?.closedLastYear ?? null;
  const item19 = !!x.item19?.hasItem19;
  const royalty = fees.royalty.pct ?? "No % royalty";

  const handleUnlock = () => {
    track("upgrade_clicked", { ...eventProps, price: PRICE_CENTS });
    onUnlock();
  };

  // Broker capture fallback — only if it wasn't captured during the analyzing
  // wait (hasBroker). Persists to the report record. Capture ONLY, never sent.
  const [broker, setBroker] = useState("");
  const [brokerSaved, setBrokerSaved] = useState(false);
  const saveBroker = async () => {
    const name = broker.trim();
    if (!name || !reportId) return;
    setBrokerSaved(true);
    try {
      await fetch("/api/report/broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, broker_name: name }),
      });
      track("broker_captured", { has_broker: true, capture_surface: "teaser" });
    } catch {
      /* best-effort */
    }
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

        {/* Risk Reframe — "N things to verify" (shared module, matches the
            library + detail surfaces via the same computeVerify). */}
        <div className="px-6 pt-5">
          <DiligenceModule
            readout={{ ...verify, risk: s.riskLevel ?? null }}
            benchmark={benchmark}
            total={benchmarkTotal}
          />
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
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8194B0]">Your capital</p>
                <div className="mt-0.5 flex items-center gap-1 rounded-lg border border-[#F5B847]/30 bg-[#0E1729] px-2 py-1 focus-within:border-[#F5B847]/70">
                  <span className="text-lg font-bold text-[#F5B847]">$</span>
                  <input
                    inputMode="numeric"
                    aria-label="Your capital"
                    value={cap.toLocaleString("en-US")}
                    onChange={(e) => {
                      const d = e.target.value.replace(/[^0-9]/g, "").slice(0, 9);
                      setCap(d ? Number(d) : 0);
                    }}
                    className="w-28 bg-transparent text-xl font-bold text-[#F5B847] outline-none"
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[100000, 250000, 500000, 1000000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setCap(v)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-bold transition ${
                    cap === v
                      ? "border-[#F5B847]/60 bg-[#F5B847]/10 text-[#F5B847]"
                      : "border-[#27344F] text-[#8194B0] hover:border-[#3A496A] hover:text-[#CBD5E1]"
                  }`}
                >
                  {v >= 1000000 ? "$1M" : `$${v / 1000}k`}
                </button>
              ))}
            </div>
            {hasGap && gap != null && (
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

        {/* Broker capture — fallback (only if not captured during the analyzing
            wait). Optional, capture-only; never transmitted to the named broker. */}
        {!hasBroker && reportId && (
          <div className="mx-6 mt-5 rounded-xl border border-[#27344F] bg-[#0B1220] px-4 py-3.5">
            {!brokerSaved ? (
              <>
                <p className="text-[12.5px] text-[#8194B0]">
                  <span className="mr-1.5 rounded bg-[#27344F] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">
                    Optional
                  </span>
                  Working with a franchise consultant or broker? Tell us who, so we can coordinate.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={broker}
                    onChange={(e) => setBroker(e.target.value)}
                    placeholder="Broker or consultant name"
                    aria-label="Franchise consultant or broker (optional)"
                    className="min-w-[150px] flex-1 rounded-lg border border-[#27344F] bg-[#0E1729] px-3 py-2 text-sm text-[#F1F5F9] outline-none placeholder:text-[#586A88] focus:border-[#38BDF8]"
                  />
                  <button
                    type="button"
                    onClick={saveBroker}
                    disabled={!broker.trim()}
                    className="rounded-lg bg-[#27344F] px-3.5 py-2 text-sm font-bold text-[#CBD5E1] disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[12.5px] text-[#8194B0]">Thanks — we&apos;ll coordinate.</p>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="px-6 pb-6 pt-5">
          <button
            onClick={handleUnlock}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#34D399] px-5 py-3.5 text-[15px] font-bold text-[#06231A] transition-colors hover:bg-[#2BBD87]"
          >
            Unlock the full report — {PRICE_LABEL}
            <span aria-hidden>→</span>
          </button>
          <p className="mt-2 text-center text-[11px] text-[#8194B0]">
            One-time payment · instant access · secure checkout
          </p>
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
