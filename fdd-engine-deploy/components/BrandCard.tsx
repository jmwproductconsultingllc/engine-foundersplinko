"use client";

// components/BrandCard.tsx — one card in a /brands category row.
// Ported from the brands.html prototype to the InfographicTeaser token set
// (#0B1220 canvas, #0E1729 surface, #34D399 green, #F5B847 gold, #38BDF8 blue;
// risk always color + LABEL, never color alone).
//
// Two variants:
//  - live  → links to /franchise/[slug] (ref passthrough for attribution)
//  - ghost → "FDD pending", but CLICKABLE as a demand signal (brief
//    reconciliation #2): fires `brand_requested` so ghost clicks tell us which
//    FDD to pull next. Pull by demand, not guesswork.

import { useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics";
import type { BrandCard as BrandCardModel } from "@/lib/brands";

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;

const RISK_STYLE: Record<string, { chip: string; edge: string }> = {
  High: { chip: "bg-red-500/15 text-red-400", edge: "border-l-[3px] border-l-red-400" },
  Medium: { chip: "bg-amber-500/15 text-amber-300", edge: "border-l-[3px] border-l-amber-300" },
  Low: { chip: "bg-[#34D399]/15 text-[#34D399]", edge: "border-l-[3px] border-l-[#34D399]" },
};

export function LiveBrandCard({ card, refTag }: { card: BrandCardModel; refTag?: string | null }) {
  const risk = RISK_STYLE[card.risk ?? ""] ?? { chip: "bg-slate-500/15 text-slate-300", edge: "" };
  const href = refTag ? `/franchise/${card.slug}?ref=${refTag}` : `/franchise/${card.slug}`;
  const kindLabel = card.moKind === "profit" ? "profit" : "revenue";

  return (
    <Link
      href={href}
      onClick={() => track("brand_card_clicked", { slug: card.slug, risk: card.risk, mo: card.mo })}
      className={`flex min-h-[112px] flex-col rounded-xl border border-[#22304C] bg-[#0E1729] p-4 transition hover:-translate-y-0.5 hover:border-[#3A496A] ${risk.edge}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-bold leading-tight text-[#F1F5F9]">{card.brandName}</span>
        {card.risk && (
          <span
            className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${risk.chip}`}
          >
            {card.risk}
          </span>
        )}
      </div>

      {card.mo != null ? (
        <>
          <div className="mt-auto pt-3 text-[25px] font-extrabold leading-none text-[#F5B847]">
            ${Math.round(card.mo / 1000)}k
            <span className="ml-1.5 text-[11px] font-semibold text-[#8194B0]">
              /mo {kindLabel}
              {card.i19 ? " · Item 19" : ""}
            </span>
          </div>
          {card.moCaveat && (
            <div className="mt-1 text-[10px] leading-snug text-[#586A88]">{card.moCaveat}</div>
          )}
          <div className="mt-1.5 text-[11px] text-[#8194B0]">
            from{" "}
            <b className="font-bold text-[#CBD5E1]">
              {card.lo != null && card.hi != null ? `${usd(card.lo)}–${usd(card.hi)}` : "—"}
            </b>{" "}
            to open · see the diligence →
          </div>
        </>
      ) : (
        <>
          <div className="mt-auto pt-3 text-[21px] font-extrabold leading-none text-[#F5B847]">
            {card.lo != null && card.hi != null ? `${usd(card.lo)}–${usd(card.hi)}` : "—"}
            <span className="ml-1.5 text-[11px] font-semibold text-[#8194B0]">to open</span>
          </div>
          <div className="mt-1.5 text-[11px] text-[#8194B0]">
            Item 19 not disclosed · see the diligence →
          </div>
        </>
      )}
    </Link>
  );
}

export function GhostBrandCard({ name, category }: { name: string; category: string }) {
  const [requested, setRequested] = useState(false);

  return (
    <button
      type="button"
      data-name={name.toLowerCase()}
      onClick={() => {
        if (requested) return;
        setRequested(true);
        // The demand loop: which FDD do we pull next? This event is the answer.
        track("brand_requested", { brand: name, category });
      }}
      className={`flex min-h-[112px] flex-col rounded-xl border border-dashed p-4 text-left transition ${
        requested
          ? "border-[#34D399]/50 bg-[#34D399]/[0.05] opacity-90"
          : "border-[#22304C] bg-[#0E1729] opacity-50 hover:opacity-75"
      }`}
    >
      <span className="text-[15px] font-bold leading-tight text-[#F1F5F9]">{name}</span>
      <span className={`mt-auto pt-3 text-[11px] ${requested ? "text-[#34D399]" : "text-[#586A88]"}`}>
        {requested ? "Requested — we pull FDDs where demand shows up ✓" : "FDD pending · tap to request"}
      </span>
    </button>
  );
}
