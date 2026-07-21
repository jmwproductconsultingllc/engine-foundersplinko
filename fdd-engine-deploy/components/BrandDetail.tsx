"use client";

// components/BrandDetail.tsx — P0 SUBSET (2026-07-18). Conversion layout.
//
// Measured problem: 74–86% of paid visitors never scrolled to the ask; the free
// tier gave away the paid product's unique findings. This layout:
//   1. compressed top (no lede)
//   2. Item 19 hero VISIBLE + correctly labeled (middle path — promise match)
//   3. HIGH/MED/LOW verdict + LOCKED financial-condition tease (no figures)
//   4. compact ask card at ~1.5 screens (cta_surface:"ask_card")
//   5. email capture directly under the ask (capture_surface:"inline")
//   6. free proof layer: capital calculator, at-a-glance, tripwire teases
//   7. second full CTA (cta_surface:"ask_bottom")
//   8. sticky bottom bar after hero scroll (cta_surface:"sticky")
//
// GATING: this component accepts TeaserCard ONLY (lib/teaserProps). Locked values
// never arrive as props, so they cannot leak via view-source. Do not widen the type.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics";
import EmailCapture from "@/components/EmailCapture";
import CaptureSheet from "@/components/CaptureSheet";
import type { TeaserCard } from "@/lib/teaserProps";

const PRICE_LABEL = "$199";

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
  teaser,
  refTag,
}: {
  teaser: TeaserCard;
  refTag?: string | null;
}) {
  const card = teaser;
  const [cap, setCap] = useState(250_000);
  // ruling #3: the 250K default never enters the DB — only a user edit counts
  const [capEdited, setCapEdited] = useState(false);
  const [lockTip, setLockTip] = useState<string | null>(null);
  const [showCalcCapture, setShowCalcCapture] = useState(false);
  const [stickyOn, setStickyOn] = useState(false);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const askRef = useRef<HTMLDivElement | null>(null);
  const playbookRef = useRef<HTMLElement | null>(null);
  const inlineCaptureRef = useRef<HTMLElement | null>(null);
  const teaserFired = useRef(false);

  const tone = card.risk ? (RISK_TONE[card.risk] ?? RISK_TONE.Medium) : null;
  const hasRange = card.lo != null && card.hi != null;
  const lo = card.lo ?? 0;
  const hi = card.hi ?? 0;
  const scaleMax = hi > 0 ? hi * 1.15 : 1;

  const fit = useMemo(() => {
    if (!hasRange) return null;
    const gap = hi - cap;
    if (gap <= 0) return { label: "Capital fit", amt: "Covered", pill: "Within your capital", cls: "ok" };
    return {
      label: "Capital gap to top of range",
      amt: usd(gap),
      pill: gap > lo ? "SBA loan or partner likely" : "Small gap — bridgeable",
      cls: gap > lo ? "loan" : "gap",
    };
  }, [cap, lo, hi, hasRange]);

  const mintHref = (surface: string) =>
    `/api/mint-brand-report?slug=${card.slug}${refTag ? `&ref=${refTag}` : ""}`;

  const onUnlock = (surface: string) => {
    track("upgrade_clicked", { source: "brand_page", slug: card.slug, ref: refTag ?? "none", cta_surface: surface });
    try { sessionStorage.setItem("fe_cta_clicked", "1"); } catch {} // suppresses the S2 sheet
  };

  // sticky bar: appears once the hero leaves the viewport
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setStickyOn(true); return; }
    const obs = new IntersectionObserver(([e]) => setStickyOn(!e.isIntersecting), { threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // teaser_viewed: fires once when the ask card enters view
  useEffect(() => {
    const el = askRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !teaserFired.current) {
        teaserFired.current = true;
        track("teaser_viewed", { slug: card.slug, ref: refTag ?? "none" });
        try { sessionStorage.setItem("fe_teaser_viewed", "1"); } catch {}
        obs.disconnect();
      }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [card.slug, refTag]);

  // S1 inline capture: capture_shown at 40% visibility (the teaser_viewed
  // standard), once — the surface breakdown was blind to inline exposure.
  const inlineShown = useRef(false);
  useEffect(() => {
    const el = inlineCaptureRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !inlineShown.current) {
        inlineShown.current = true;
        track("capture_shown", { capture_surface: "inline" });
        obs.disconnect();
      }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // S5 playbook block: capture_shown at 50% visibility, once
  const playbookShown = useRef(false);
  useEffect(() => {
    const el = playbookRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !playbookShown.current) {
        playbookShown.current = true;
        track("capture_shown", { capture_surface: "playbook" });
        obs.disconnect();
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const heroKind = card.moKind === "profit" ? "profit" : "revenue";

  return (
    <main
      className="min-h-screen bg-[#0B1220] px-5 pb-28 text-[#F1F5F9]"
      data-parse-quality={card.parseQuality}
    >
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

        {/* 1 · compressed top — no lede paragraph */}
        <p className="mt-6 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#38BDF8]">
          Franchise Diligence · Free snapshot
        </p>
        <h1 className="mt-2 text-[28px] font-extrabold leading-[1.2] tracking-tight">
          {card.brandName} Franchise Review ({new Date().getFullYear()})
        </h1>
        <p className="mt-1 text-[15px] font-semibold text-[#8194B0]">
          Cost, Item 19 earnings &amp; fees — from the actual FDD
        </p>

        {/* 2 · Item 19 hero — VISIBLE, correctly labeled (middle path) */}
        <div ref={heroRef}>
          {card.mo != null ? (
            <div className="mt-5 rounded-2xl border border-[#34D399]/35 bg-gradient-to-b from-[#34D399]/[0.08] to-transparent px-6 py-5">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#8194B0]">
                Item 19 · {card.moLabel} monthly {heroKind}
              </div>
              <div className="mt-2 text-[44px] font-extrabold leading-none text-[#F5B847]">
                {usd(card.mo)}
                <span className="ml-1 text-lg font-bold text-[#8194B0]">/mo</span>
              </div>
              <p className="mt-2.5 max-w-[54ch] text-[13px] leading-relaxed text-[#CBD5E1]">
                Franchisor-disclosed{card.mn != null ? <> across <b className="text-[#F1F5F9]">{card.mn.toLocaleString()} reporting units</b></> : null}.{" "}
                {card.cohortCount > 1 && (
                  <span className="font-bold text-[#34D399]">
                    🔒 The full spread — high, median, low across {card.cohortCount} cohorts — is in the full report.
                  </span>
                )}
              </p>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-[#27344F] bg-[#0E1729] px-6 py-5">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#8194B0]">
                Item 19 · earnings disclosure
              </div>
              <div className="mt-2 text-[26px] font-extrabold text-[#8194B0]">Not disclosed</div>
              <p className="mt-2 max-w-[54ch] text-[13px] leading-relaxed text-[#CBD5E1]">
                This franchisor chose not to publish unit earnings. That is itself a data point — the full
                report shows how to pressure-test economics through Item 20 operators instead.
              </p>
            </div>
          )}
        </div>

        {/* 3 · verdict + LOCKED financial-condition tease */}
        {tone && (
          <div className={`mt-3 flex items-center gap-3.5 rounded-2xl border px-5 py-3.5 ${tone.border} ${tone.bg}`}>
            <div className={`text-[20px] font-extrabold ${tone.text}`}>{card.risk?.toUpperCase()}</div>
            <div className="text-[13px] text-[#CBD5E1]">
              Diligence risk level{card.hasFinancialConditionFlag ? " — driven by a disclosure most buyers never find." : "."}
            </div>
          </div>
        )}
        {card.hasFinancialConditionFlag && (
          <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-[#3A496A] bg-[#0E1729] px-4 py-3.5 text-[14px] text-[#CBD5E1]">
            <span aria-hidden>🔒</span>
            <span>
              This franchisor&apos;s own audited statements disclose a{" "}
              <b className="text-[#F1F5F9]">serious financial-condition item</b>. What it is — and what
              it means for your investment — is in the full report.
            </span>
          </div>
        )}

        {/* 4 · compact ask at ~1.5 screens */}
        <div ref={askRef} className="mt-3 rounded-2xl border border-[#27344F] bg-[#0E1729] p-5">
          <ul className="flex flex-col gap-2 text-sm text-[#CBD5E1]">
            <li className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
              <span><b className="text-[#F1F5F9]">What you&apos;d actually keep</b> — that {heroKind} modeled to profit after every fee</span>
            </li>
            {card.hasFinancialConditionFlag && (
              <li className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
                <span>The financial-health flag, explained with the numbers</span>
              </li>
            )}
            <li className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
              <span>Every clause that could trap you, cited to the page</span>
            </li>
          </ul>
          <a
            href={mintHref("ask_card")}
            onClick={() => onUnlock("ask_card")}
            className="mt-4 block w-full rounded-xl bg-[#34D399] py-3.5 text-center text-[15px] font-extrabold text-[#0B1220] hover:brightness-110"
          >
            Unlock the full {card.brandName} report — {PRICE_LABEL}
          </a>
          <p className="mt-2 text-center text-xs text-[#8194B0]">
            <b className="text-[#F1F5F9]">One-time {PRICE_LABEL} · not a subscription · yours forever.</b>
          </p>
        </div>

        {/* 5 · email capture directly under the ask */}
        <section ref={inlineCaptureRef} className="mt-2.5">
          <EmailCapture
            brandName={card.brandName}
            brandSlug={card.slug}
            capitalEntered={cap}
            capitalEdited={capEdited}
            refTag={refTag}
            surface="inline"
          />
        </section>

        {/* 6 · FREE PROOF LAYER — capital calculator (unchanged mechanics) */}
        {hasRange && (
          <section className="mt-8">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#8194B0]">
              Does it fit your capital?
            </div>
            <div className="mt-3 rounded-2xl border border-[#27344F] bg-[#0E1729] p-5">
              <label className="text-sm font-bold">How much can you put toward opening?</label>
              <div className="mt-3.5 flex items-center gap-1.5 rounded-xl border border-[#F5B847]/30 bg-[#0B1220] px-4 py-3 focus-within:border-[#F5B847]/70">
                <span className="text-3xl font-bold text-[#F5B847]">$</span>
                <input
                  inputMode="numeric"
                  value={cap.toLocaleString("en-US")}
                  onChange={(e) => {
                    const d = e.target.value.replace(/[^0-9]/g, "").slice(0, 9);
                    setCap(d ? Number(d) : 0);
                    if (!capEdited) {
                      setCapEdited(true);
                      track("cta_clicked", { cta_id: "calc_custom_input", section: "calculator" });
                    }
                  }}
                  className="w-full bg-transparent text-3xl font-bold text-[#F5B847] outline-none"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[100_000, 250_000, 500_000, 1_000_000].map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      setCap(v);
                      setCapEdited(true);
                      track("cta_clicked", { cta_id: `calc_preset_${v >= 1_000_000 ? "1m" : Math.round(v / 1000) + "k"}`, section: "calculator" });
                    }}
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
                  <span>Estimated cost to open (Item 7)</span>
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
              {fit && (
                <div className="mt-4 flex items-center gap-2.5 border-t border-[#27344F] pt-3.5 text-sm">
                  <span className="text-[#8194B0]">{fit.label}</span>
                  <span className={`ml-auto text-lg font-extrabold ${fit.cls === "ok" ? "text-[#34D399]" : "text-[#F5B847]"}`}>
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
              )}
              {capEdited && (
                <div className="mt-3 text-[13px]">
                  {!showCalcCapture ? (
                    <button
                      type="button"
                      onClick={() => {
                        track("cta_clicked", { cta_id: "calc_match_link", section: "calculator" });
                        setShowCalcCapture(true);
                        track("capture_shown", { capture_surface: "calculator" });
                      }}
                      className="text-[#38BDF8]"
                    >
                      Want this matched against other brands?{" "}
                      <b className="underline">Email me brands that fit {usd(cap)} →</b>
                    </button>
                  ) : (
                    <div className="mt-2">
                      <EmailCapture
                        brandName={card.brandName}
                        brandSlug={card.slug}
                        capitalEntered={cap}
                        capitalEdited={capEdited}
                        refTag={refTag}
                        surface="calculator"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* at a glance — free stats */}
        <section className="mt-8">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#8194B0]">At a glance</div>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-[#27344F] bg-[#0E1729] p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">System units</div>
              <div className="mt-1 text-[19px] font-extrabold">{card.units?.toLocaleString() ?? "—"}</div>
              <div className="mt-0.5 text-[11px] text-[#5A6B88]">
                {card.openedLastYear != null ? `+${card.openedLastYear}` : ""}
                {card.closedLastYear != null ? ` / −${card.closedLastYear}` : ""} last yr
              </div>
            </div>
            <div className="rounded-xl border border-[#27344F] bg-[#0E1729] p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">Earnings (Item 19)</div>
              <div className={`mt-1 text-[19px] font-extrabold ${card.mo != null ? "text-[#34D399]" : "text-amber-300"}`}>
                {card.mo != null ? "Disclosed" : "Withheld"}
              </div>
              <div className="mt-0.5 text-[11px] text-[#5A6B88]">
                {card.mo != null ? `${card.cohortCount} cohort${card.cohortCount === 1 ? "" : "s"}` : "ask Item 20 operators"}
              </div>
            </div>
            <div className="rounded-xl border border-[#27344F] bg-[#0E1729] p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#8194B0]">Royalty</div>
              <div className="mt-1 text-[19px] font-extrabold">
                {card.royaltyPct != null ? `${card.royaltyPct}%` : card.flatRoyaltyNote ? "Flat" : "—"}
              </div>
              <div className="mt-0.5 text-[11px] text-[#5A6B88]">
                {card.royaltyPct == null && card.flatRoyaltyNote
                  ? card.flatRoyaltyNote
                  : card.brandFundPct != null
                    ? `+ ${card.brandFundPct}% brand fund`
                    : "see fee model in report"}
              </div>
            </div>
          </div>
        </section>

        {/* tripwires — existence only, contents locked */}
        {card.tripwires.length > 0 && (
          <section className="mt-8">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#8194B0]">
              What the sales deck won&apos;t lead with
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {card.tripwires.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => {
                    // ruling #6a: a lock-tap is the purest purchase-intent signal
                    track("cta_clicked", { cta_id: "tripwire_lock", section: "tripwires", label: t.label });
                    setLockTip(t.label);
                    window.setTimeout(() => setLockTip((cur) => (cur === t.label ? null : cur)), 1800);
                  }}
                  className="relative flex w-full items-start gap-2.5 rounded-xl border border-[#27344F] bg-[#0E1729] px-3.5 py-3 text-left text-[13.5px] text-[#CBD5E1]"
                >
                  <span aria-hidden>🔒</span>
                  <span>
                    <b className="text-[#F1F5F9]">{t.label}</b> — a detail most buyers miss → in the full report
                  </span>
                  {lockTip === t.label && (
                    <span className="absolute -top-2 right-3 rounded-md bg-[#27344F] px-2 py-0.5 text-[10.5px] font-bold text-[#CBD5E1]">
                      In the full report
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 7 · second CTA */}
        <a
          href={mintHref("ask_bottom")}
          onClick={() => onUnlock("ask_bottom")}
          className="mt-6 block w-full rounded-xl bg-[#34D399] py-3.5 text-center text-[15px] font-extrabold text-[#0B1220] hover:brightness-110"
        >
          See everything — {PRICE_LABEL}
        </a>

        {/* 8 · FOUNDER STRIP (A2 — approved copy, verbatim) */}
        <section className="mt-8">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#586A88]">
            Who reads these?
          </p>
          <div className="mt-3 flex items-start gap-4 rounded-2xl border border-[#27344F] bg-[#0E1729] p-5">
            <div
              aria-hidden
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#16223B] text-sm font-extrabold text-[#34D399]"
            >
              JW
            </div>
            <div>
              <h3 className="text-[15px] font-extrabold text-[#F1F5F9]">
                Jason Wright — founder, FoundersPlinko
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#8194B0]">
                20 years in product. PE/M&amp;A diligence consultant. Franchise owner myself — I wrote
                a $50K franchise-fee check before building the tool that reads the fine print. Every
                number on this page is cited to the FDD.
              </p>
              <a
                href="https://linkedin.com/in/jasonmwright"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track("cta_clicked", { cta_id: "founder_linkedin", section: "founder" })}
                className="mt-2 inline-block text-[13px] font-bold text-[#38BDF8]"
              >
                LinkedIn →
              </a>
              <p className="mt-2 text-[10.5px] text-[#586A88]">
                Not affiliated with or endorsed by {card.brandName}.
              </p>
            </div>
          </div>
        </section>

        {/* 9 · S5 PLAYBOOK — the dreamer door (below proof layer, above footer) */}
        <section ref={playbookRef} className="mt-8">
          <EmailCapture
            brandName={card.brandName}
            brandSlug={card.slug}
            capitalEntered={cap}
            capitalEdited={capEdited}
            refTag={refTag}
            surface="playbook"
          />
          <p className="mt-2.5 text-[12.5px] text-[#8194B0]">
            Looking for something in particular? Email me directly —{" "}
            <a
              href={`mailto:jason@foundersplinko.com?subject=${encodeURIComponent(`Question from the ${card.brandName} page`)}`}
              onClick={() => track("cta_clicked", { cta_id: "contact_email", section: "playbook" })}
              className="font-bold text-[#38BDF8]"
            >
              jason@foundersplinko.com
            </a>{" "}
            — real question, real answer.
          </p>
        </section>

        <p className="mt-5 text-[11px] leading-relaxed text-[#586A88]">
          Informational only — not legal, financial, or investment advice. Figures are extracted from
          the {card.brandName} FDD and may contain errors; verify every number against the source
          document and consult a qualified professional before deciding. Not affiliated with or endorsed
          by {card.brandName}.
        </p>
      </div>

      {/* 8 · sticky bottom bar */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 border-t border-[#3A496A] bg-[#0B1220]/95 backdrop-blur transition-transform duration-200 ${
          stickyOn ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-hidden={!stickyOn}
      >
        <div className="mx-auto flex max-w-[820px] items-center gap-3 px-4 py-2.5">
          <div className="text-[13px] text-[#CBD5E1]">
            <b className="text-[15px] text-[#F1F5F9]">{PRICE_LABEL}</b> · full {card.brandName} report
          </div>
          <a
            href={mintHref("sticky")}
            onClick={() => onUnlock("sticky")}
            className="ml-auto rounded-lg bg-[#34D399] px-5 py-2.5 text-[14px] font-extrabold text-[#0B1220] hover:brightness-110"
          >
            Unlock
          </a>
        </div>
      </div>

      {/* S2 · hunt-triggered bottom sheet (fires once/session on 80% + 8s dwell) */}
      <CaptureSheet brandName={card.brandName} brandSlug={card.slug} />
    </main>
  );
}
