"use client";

// components/BrandDetail.tsx — free tier of /franchise/[slug], ported from the
// i9-sports.html prototype to the InfographicTeaser tokens. Deliberately built
// only on the bulletproof card-model fields; the fragile derived economics stay
// behind the $199 unlock (free/paid split is LOCKED in the brief).
//
// The unlock CTA is a plain link to /api/mint-brand-report — the mint route
// creates the per-buyer record (with ref for attribution) and 303s into the
// existing checkout. No client-side payment logic here at all.

import { useMemo, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics";
import EmailCapture from "@/components/EmailCapture";
import TeaserViewedBeacon from "@/components/TeaserViewedBeacon";
import LeadVerifyBeacon from "@/components/LeadVerifyBeacon";
import { Suspense } from "react";
import type { BrandCard } from "@/lib/brands";

const PRICE_LABEL = "$199"; // display only; charged amount lives in /api/checkout PRICE_CENTS

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const RISK_TONE: Record<string, { text: string; border: string; bg: string }> = {
  High: { text: "text-red-400", border: "border-red-500/40", bg: "bg-red-500/10" },
  Medium: { text: "text-amber-300", border: "border-amber-500/40", bg: "bg-amber-500/10" },
  Low: { text: "text-[#34D399]", border: "border-[#34D399]/40", bg: "bg-[#34D399]/10" },
};

export default function BrandDetail({
  card,
  profitLine,
  cohortCount,
  refTag,
}: {
  card: BrandCard;
  profitLine: { monthly: number; caveat: string | null; sampleSize: number | null } | null;
  cohortCount: number;
  refTag?: string | null;
}) {
  const [cap, setCap] = useState(250_000);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const tone = card.risk ? (RISK_TONE[card.risk] ?? RISK_TONE.Medium) : null;
  // Item 7 range preferred; engine mid-point build-out as last resort
  // (batch2 brief §data-2 — dormant on current data, all records carry Item 7).
  const hasRange = card.lo != null && card.hi != null;
  const lo = card.lo ?? card.buildoutMid ?? 0;
  const hi = card.hi ?? card.buildoutMid ?? 0;
  const scaleMax = hi * 1.15;

  const fit = useMemo(() => {
    const gap = hi - cap;
    if (gap <= 0) return { label: "Capital fit", amt: "Covered", pill: "Within your capital", cls: "ok" };
    return {
      label: "Capital gap to top of range",
      amt: usd(gap),
      pill: gap > lo ? "SBA loan or partner likely" : "Small gap — bridgeable",
      cls: gap > lo ? "loan" : "gap",
    };
  }, [cap, lo, hi]);

  const mintHref = `/api/mint-brand-report?slug=${card.slug}${refTag ? `&ref=${refTag}` : ""}${
    email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `&email=${encodeURIComponent(email)}` : ""
  }`;

  const heroKind = card.moKind === "profit" ? "profit" : "revenue";

  return (
    <main className="min-h-screen bg-[#0B1220] px-5 pb-16 text-[#F1F5F9]" data-parse-quality={card.parseQuality}>
      <Suspense fallback={null}><LeadVerifyBeacon /></Suspense>
      <div className="mx-auto max-w-[820px]">
        <div className="flex items-center justify-between border-b border-[#27344F] py-4">
          <Link href="/" className="text-[15px] font-extrabold">
            Franchise<span className="text-[#34D399]">Edge</span>
          </Link>
          <Link
            href={refTag ? `/brands?ref=${refTag}` : "/brands"}
            className="text-[13px] font-bold text-[#38BDF8] hover:underline"
          >
            ← All brands
          </Link>
        </div>

        <p className="mt-8 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#38BDF8]">
          Franchise Diligence · Free snapshot
        </p>
        <h1 className="mt-2 text-[30px] font-extrabold leading-[1.2] tracking-tight">
          {card.brandName} Franchise Review ({new Date().getFullYear()})
        </h1>
        <p className="mt-1 text-[15px] font-semibold text-[#8194B0]">
          Cost, Item 19 earnings &amp; fees — from the actual FDD
        </p>
        <p className="mt-2.5 max-w-[62ch] text-[15px] text-[#8194B0]">
          A private-equity-grade read of the {card.brandName} Franchise Disclosure Document — the real
          cost to open, the earnings picture, and the risks a salesperson has no incentive to mention.
        </p>
        <span className="mt-3.5 inline-block rounded-full border border-[#27344F] bg-[#16223B] px-2.5 py-0.5 text-xs font-semibold text-[#CBD5E1]">
          {card.vertical}
        </span>
        {card.category !== card.vertical && (
          <span className="ml-2 mt-3.5 inline-block rounded-full border border-[#27344F] px-2.5 py-0.5 text-xs font-semibold text-[#8194B0]">
            {card.category}
          </span>
        )}

        <TeaserViewedBeacon brandSlug={card.slug} />
        {/* Item 19 hero — number labeled by its own revenueType, always */}
        {card.mo != null ? (
          <div className="mt-6 rounded-2xl border border-[#34D399]/35 bg-gradient-to-b from-[#34D399]/[0.08] to-transparent px-6 py-5">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#8194B0]">
              Item 19 · average monthly {heroKind}
            </div>
            <div className="mt-2 text-[44px] font-extrabold leading-none text-[#F5B847]">
              {usd(card.mo)}
              <span className="ml-1 text-lg font-bold text-[#8194B0]">/mo</span>
            </div>
            <p className="mt-2.5 max-w-[54ch] text-xs leading-relaxed text-[#CBD5E1]">
              Franchisor-disclosed{card.mn != null ? ` across ${card.mn} reporting units` : ""}.
              {card.moCaveat ? ` ${card.moCaveat[0].toUpperCase()}${card.moCaveat.slice(1)}.` : ""} This is{" "}
              <b className="text-[#F1F5F9]">{heroKind}</b> — the full report models what you&apos;d actually
              keep after every fee.
            </p>
            {profitLine && heroKind === "revenue" && (
              <p className="mt-2 text-xs text-[#8194B0]">
                Disclosed owner-side figure: <b className="text-[#CBD5E1]">{usd(profitLine.monthly)}/mo</b>
                {profitLine.caveat ? ` (${profitLine.caveat})` : ""}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-[#27344F] bg-[#0E1729] px-6 py-5">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#8194B0]">
              Item 19 · earnings disclosure
            </div>
            <div className="mt-2 text-[28px] font-extrabold text-[#8194B0]">Not disclosed</div>
            <p className="mt-2 max-w-[54ch] text-xs leading-relaxed text-[#CBD5E1]">
              This franchisor chose not to publish unit earnings. That is itself a data point — the full
              report shows how to pressure-test economics through Item 20 operators instead.
            </p>
          </div>
        )}

        {/* verdict — or the honest in-progress state for manual-verified stubs */}
        {tone ? (
          <div className={`mt-4 flex items-center gap-3.5 rounded-2xl border px-5 py-4 ${tone.border} ${tone.bg}`}>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#8194B0]">
                Diligence risk level
              </div>
              <div className={`mt-0.5 text-[22px] font-extrabold ${tone.text}`}>{card.risk}</div>
              {card.riskReasons[0] && <div className="mt-1 text-[13px] text-[#CBD5E1]">{card.riskReasons[0]}</div>}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-[#27344F] bg-[#0E1729] px-5 py-4">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#8194B0]">
              Diligence risk level
            </div>
            <div className="mt-0.5 text-[18px] font-extrabold text-[#8194B0]">Grading in progress</div>
            <div className="mt-1 text-[13px] text-[#CBD5E1]">
              Key figures below are hand-verified against the FDD; the full computed risk grade and
              fee-stack model publish when the complete extraction finishes.
            </div>
          </div>
        )}

        {/* capital-fit calculator */}
        <section className="mt-8">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#8194B0]">
            Does it fit your capital?
          </div>
          <div className="mt-3 rounded-2xl border border-[#27344F] bg-[#0E1729] p-5">
            <label className="text-sm font-bold">How much can you put toward opening?</label>
            <p className="mt-0.5 text-xs text-[#8194B0]">
              The cash you have for the build-out — the one number the whole deal is measured against.
            </p>
            <div className="mt-3.5 flex items-center gap-1.5 rounded-xl border border-[#F5B847]/30 bg-[#0B1220] px-4 py-3 focus-within:border-[#F5B847]/70">
              <span className="text-3xl font-bold text-[#F5B847]">$</span>
              <input
                inputMode="numeric"
                value={cap.toLocaleString("en-US")}
                onChange={(e) => {
                  const d = e.target.value.replace(/[^0-9]/g, "").slice(0, 9);
                  setCap(d ? Number(d) : 0);
                }}
                className="w-full bg-transparent text-3xl font-bold text-[#F5B847] outline-none"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[100_000, 250_000, 500_000, 1_000_000].map((v) => (
                <button
                  key={v}
                  onClick={() => setCap(v)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                    cap === v
                      ? "border-[#F5B847]/60 bg-[#F5B847]/10 text-[#F5B847]"
                      : "border-[#27344F] text-[#8194B0] hover:border-[#3A496A] hover:text-[#CBD5E1]"
                  }`}
                >
                  {v >= 1_000_000 ? "$1M" : `$${v / 1000}k`}
                </button>
              ))}
            </div>

            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-xs text-[#8194B0]">
                <span>
                  {hasRange
                    ? `Estimated cost to open (Item 7${card.costSource === "summed" ? ", summed" : ""})`
                    : "Estimated mid-point build-out (engine model)"}
                </span>
                <span>your capital ▎</span>
              </div>
              <div className="relative h-3.5 rounded-lg bg-[#16223B]">
                <div
                  className="absolute bottom-0 top-0 rounded-lg bg-gradient-to-r from-[#1e5f4a] to-[#34D399]"
                  style={{ left: `${(lo / scaleMax) * 100}%`, width: `${((hi - lo) / scaleMax) * 100}%` }}
                />
                <div
                  className="absolute -top-1.5 h-[26px] w-[3px] rounded bg-[#F5B847]"
                  style={{ left: `${Math.min(100, Math.max(0, (cap / scaleMax) * 100))}%` }}
                />
              </div>
              <div className="mt-3 flex justify-between text-[13px] font-bold text-[#F5B847]">
                <span>{usd(lo)}</span>
                <span>{usd(hi)}</span>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2.5 border-t border-[#27344F] pt-3.5 text-sm">
              <span className="text-[#8194B0]">{fit.label}</span>
              <span
                className={`ml-auto text-lg font-extrabold ${fit.cls === "ok" ? "text-[#34D399]" : "text-[#F5B847]"}`}
              >
                {fit.amt}
              </span>
              <span
                className={`rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                  fit.cls === "ok"
                    ? "bg-[#34D399]/15 text-[#34D399]"
                    : fit.cls === "loan"
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-[#F5B847]/15 text-[#F5B847]"
                }`}
              >
                {fit.pill}
              </span>
            </div>
          </div>
        </section>

        {/* at a glance */}
        <section className="mt-8">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#8194B0]">At a glance</div>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-[#27344F] bg-[#0E1729] p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">System units</div>
              <div className="mt-1 text-[19px] font-extrabold">{card.units ?? "—"}</div>
              <div className="mt-0.5 text-[11px] text-[#5A6B88]">
                {card.openedLastYear != null ? `+${card.openedLastYear}` : ""}
                {card.closedLastYear != null ? ` / −${card.closedLastYear}` : ""} last yr
              </div>
            </div>
            <div className="rounded-xl border border-[#27344F] bg-[#0E1729] p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">Earnings (Item 19)</div>
              <div className={`mt-1 text-[19px] font-extrabold ${card.i19 ? "text-[#34D399]" : "text-amber-300"}`}>
                {card.i19 ? "Disclosed" : "Withheld"}
              </div>
              <div className="mt-0.5 text-[11px] text-[#5A6B88]">
                {card.i19 ? `${cohortCount} cohort${cohortCount === 1 ? "" : "s"}` : "ask Item 20 operators"}
              </div>
            </div>
            <div className="rounded-xl border border-[#27344F] bg-[#0E1729] p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">Royalty</div>
              <div className="mt-1 text-[19px] font-extrabold">
                {card.royaltyPct != null ? `${card.royaltyPct}%` : "—"}
              </div>
              <div className="mt-0.5 text-[11px] text-[#5A6B88]">
                {card.royaltyPct != null ? "ongoing royalty" : "see fee model in report"}
              </div>
            </div>
          </div>
        </section>

        {/* flags */}
        {card.riskReasons.length > 0 && (
          <section className="mt-8">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#8194B0]">
              What the sales deck won&apos;t lead with
            </div>
            <p className="mt-1 text-xs text-[#586A88]">
              Descriptive, FDD-cited disclosures — read them before discovery day.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {(card.tripwires.length > 0
                ? card.tripwires.map((t) => ({
                    key: t.title,
                    text: `The FDD discloses: ${t.description || t.title}`,
                    cite: t.source,
                  }))
                : card.riskReasons.slice(0, 3).map((r) => ({ key: r, text: r, cite: null }))
              ).map((f) => (
                <div
                  key={f.key}
                  className="flex items-start gap-2.5 rounded-xl border border-[#27344F] bg-[#0E1729] px-3.5 py-3 text-[13px] text-[#CBD5E1]"
                >
                  <span className="shrink-0 text-amber-300">▲</span>
                  <span>
                    {f.text}
                    {f.cite && <span className="ml-1.5 text-[11px] text-[#586A88]">({f.cite})</span>}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-[#8194B0]">
              Every fee, tripwire and territory term is in the full report
            </p>
          </section>
        )}

        {/* unlock */}
        <section className="mt-8">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#8194B0]">
            The full report opens
          </div>
          <div className="mt-3 rounded-2xl border border-[#27344F] bg-[#0E1729] p-6">
            <ul className="flex flex-col gap-2.5 text-sm text-[#CBD5E1]">
              <li className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
                <span>
                  <b>What you&apos;d actually keep</b> — that {heroKind} modeled to profit after royalty,
                  fees and debt service
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
                <span>
                  The full Item 19 breakdown — {cohortCount} disclosed cohort{cohortCount === 1 ? "" : "s"}
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
                <span>Financial-health severity grade (Item 21 audit)</span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
                <span>Every fee and hidden cost, with page cites</span>
              </li>
              <li className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
                <span>Operational tripwires and territory terms</span>
              </li>
            </ul>
            <a
              href={mintHref}
              onClick={() =>
                track("upgrade_clicked", { source: "brand_page", slug: card.slug, ref: refTag ?? "none" })
              }
              className="mt-4 block w-full rounded-xl bg-[#34D399] py-3.5 text-center text-base font-extrabold text-[#0B1220] hover:brightness-110"
            >
              Unlock the full {card.brandName} report — {PRICE_LABEL}
            </a>
            <p className="mt-2 text-center text-xs text-[#8194B0]">
              One-time payment · instant access · secure checkout
            </p>
          </div>
        </section>

        {/* email capture — delivery-framed nurture (spec §1-9). Replaces the old
            client-only facade; carries over only this slot. Renders BELOW the
            unlock, never gates the free teaser. */}
        <section className="mt-3">
          <EmailCapture
            brandName={card.brandName}
            brandSlug={card.slug}
            capitalEntered={cap}
            refTag={refTag}
          />
        </section>

        <p className="mt-5 text-[11px] leading-relaxed text-[#586A88]">
          Informational only — not legal, financial, or investment advice. Figures are AI-extracted from
          the {card.brandName} FDD and may contain errors; verify every number against the source
          document and consult a qualified professional before deciding. Your uploads are processed to
          generate reports, not stored or sold.
        </p>
        <div className="mt-6 border-t border-[#27344F] pt-4 text-xs text-[#8194B0]">
          Don&apos;t have the FDD yet? Under FTC rules the franchisor must give it to you free, at least
          14 days before you sign — or{" "}
          <a
            href="https://apps.dfi.wi.gov/apps/FranchiseSearch/MainSearch.aspx"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#38BDF8] hover:underline"
          >
            look one up on Wisconsin&apos;s free registry
          </a>
          .
        </div>
      </div>
    </main>
  );
}
