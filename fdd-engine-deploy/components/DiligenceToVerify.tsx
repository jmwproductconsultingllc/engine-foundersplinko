"use client";

// components/DiligenceToVerify.tsx — THE ONE shared risk readout (Risk Reframe,
// Jul 23). Every surface that shows the risk summary renders THIS, so the library
// grid, the detail card, the upload result, and the paid report can never
// disagree (the card-vs-teaser bug class, killed structurally). A build-time
// drift audit asserts all four render the same count + items.
//
// ⚑ LABEL LAW (locked) — enforced here so no surface can violate it:
//  • The readout describes the DEAL / the buyer's to-do — never our analysis.
//    BANNED nouns: depth, detail, analysis, thoroughness, level.
//  • Always name the noun: "N things to verify", never a naked number.
//  • Pluralization lives HERE (single source): count === 1 ? "thing" : "things".
//  • Color = tier reinforcement ONLY: High=amber, Medium=gold, Low=emerald.
//    NEVER red. Red is reserved for a genuine financial-condition flag INSIDE
//    the report, where earned. NO signal-bar meter (full-bars=good misreads).
//  • Low is REASSURANCE ("1 thing to verify", emerald), not a shallow report.

import type { BenchmarkCopy } from "@/lib/riskBenchmarks";

export interface VerifyReadout {
  verifyCount: number;
  verifyItems: string[];
  /** "High" | "Medium" | "Low" | null — drives COLOR only, never a verdict word */
  risk: string | null;
}

type TierStyle = { text: string; chipBg: string; chipText: string; strip: string };

// High=amber, Medium=gold, Low=emerald. Distinct, warm→cool. No red anywhere.
const TIER: Record<string, TierStyle> = {
  High: { text: "text-[#E9A85A]", chipBg: "bg-[#E0913A]/15", chipText: "text-[#E9A85A]", strip: "bg-[#E0913A]" },
  Medium: { text: "text-[#F5B847]", chipBg: "bg-[#F5B847]/15", chipText: "text-[#F5B847]", strip: "bg-[#F5B847]" },
  Low: { text: "text-[#34D399]", chipBg: "bg-[#34D399]/15", chipText: "text-[#34D399]", strip: "bg-[#34D399]" },
};
const NEUTRAL: TierStyle = {
  text: "text-slate-300",
  chipBg: "bg-slate-500/15",
  chipText: "text-slate-300",
  strip: "bg-slate-500",
};

function tierStyle(risk: string | null): TierStyle {
  return (risk && TIER[risk]) || NEUTRAL;
}

/** THE single source of the noun + pluralization. Never a naked number. */
export function verifyPhrase(count: number): string {
  const n = Math.max(1, Math.round(count));
  return `${n} ${n === 1 ? "thing" : "things"} to verify`;
}

// ───────────────────────────────────────────────────────────────────────────
// Variant: CHIP — library grid (Surface #1) + anywhere a compact pill is wanted.
// Replaces the old "HIGH RISK" red pill.
// ───────────────────────────────────────────────────────────────────────────
export function DiligenceChip({ readout }: { readout: VerifyReadout }) {
  const t = tierStyle(readout.risk);
  return (
    <span
      className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide ${t.chipBg} ${t.chipText}`}
    >
      {verifyPhrase(readout.verifyCount)}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Spread strip — a POPULATION distribution (how the whole library splits), NOT a
// per-brand meter. Three proportional segments, amber→gold→emerald. Deliberately
// NOT a full-bars meter (that convention reads full=good, backwards here).
// ───────────────────────────────────────────────────────────────────────────
export function SpreadStrip({
  spread,
  total,
}: {
  spread: { high: number; medium: number; low: number };
  total?: number;
}) {
  return (
    <div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full">
        <div className="bg-[#E0913A]" style={{ width: `${spread.high}%` }} />
        <div className="bg-[#F5B847]" style={{ width: `${spread.medium}%` }} />
        <div className="bg-[#34D399]" style={{ width: `${spread.low}%` }} />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[#8194B0]">
        <b className="font-semibold text-[#CBD5E1]">{spread.high}%</b> have more to verify ·{" "}
        <b className="font-semibold text-[#CBD5E1]">{spread.medium}%</b> a moderate few ·{" "}
        <b className="font-semibold text-[#CBD5E1]">{spread.low}%</b> run clean
        {total ? <span className="text-[#586A88]"> — of {total} brands</span> : null}
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Variant: MODULE — detail card, upload result, paid report (Surfaces #2/#3/#4).
// Eyebrow "Before you commit" + count headline + benchmark + spread + the list.
// ───────────────────────────────────────────────────────────────────────────
export function DiligenceModule({
  readout,
  benchmark,
  total,
}: {
  readout: VerifyReadout;
  benchmark?: BenchmarkCopy | null;
  total?: number;
}) {
  const t = tierStyle(readout.risk);
  const items = readout.verifyItems.slice(0, 3);
  return (
    <div className="rounded-2xl border border-[#22304C] bg-[#0E1729] p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8194B0]">
        Before you commit
      </p>
      <p className={`mt-1 text-[28px] font-extrabold leading-none ${t.text}`}>
        {verifyPhrase(readout.verifyCount)}
      </p>

      {benchmark ? (
        <>
          <p className="mt-2 text-[13px] leading-snug text-[#CBD5E1]">
            {benchmark.overall}
            {benchmark.category ? (
              <span className="text-[#8194B0]"> {benchmark.category}</span>
            ) : null}
          </p>
          <div className="mt-3">
            <SpreadStrip spread={benchmark.spread} total={total} />
          </div>
        </>
      ) : null}

      {items.length ? (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
            Here's what to resolve
          </p>
          <ol className="mt-2 space-y-1.5">
            {items.map((label, i) => (
              <li key={`${label}-${i}`} className="flex gap-2 text-[13px] leading-snug text-[#E2E8F0]">
                <span className="font-bold text-[#8194B0]">{i + 1}</span>
                <span className="font-semibold">{label}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Library context banner (Surface #1, top of grid). Corpus-level, not per-brand.
// "Most franchises have a few things worth verifying — that's normal."
// ───────────────────────────────────────────────────────────────────────────
export function DiligenceContextBanner({
  spread,
  total,
}: {
  spread: { high: number; medium: number; low: number };
  total?: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#22304C] bg-[#0E1729] p-4 md:flex-row md:items-center md:justify-between">
      <p className="max-w-2xl text-[13px] leading-snug text-[#CBD5E1]">
        <b className="font-bold text-[#F1F5F9]">
          Most franchises have a few things worth verifying — that's normal, not a warning.
        </b>{" "}
        The count shows how much to check before you sign, never whether it's a good business.
      </p>
      <div className="w-full md:w-72 md:shrink-0">
        <SpreadStrip spread={spread} total={total} />
      </div>
    </div>
  );
}
