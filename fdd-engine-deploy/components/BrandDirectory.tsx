"use client";

// components/BrandDirectory.tsx — the interactive body of /brands (multi-vertical).
// Rows = verticals in VERTICAL_ORDER. Kids & Family keeps its sub-category
// sections + ghost universe (unchanged vs. kids-only launch — the acceptance
// canary); other verticals render flat until they earn sub-sections.

import { useMemo, useState } from "react";
import type { VerticalRow } from "@/lib/brands";
import { LiveBrandCard, GhostBrandCard } from "@/components/BrandCard";

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>
  );
}

export default function BrandDirectory({
  rows,
  refTag,
}: {
  rows: VerticalRow[];
  refTag?: string | null;
}) {
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!t) return rows;
    return rows
      .map((row) => ({
        ...row,
        cards: row.cards.filter((c) => c.brandName.toLowerCase().includes(t)),
        subsections: row.subsections
          ? row.subsections
              .map((s) => ({
                ...s,
                cards: s.cards.filter((c) => c.brandName.toLowerCase().includes(t)),
                ghostNames: s.ghostNames.filter((n) => n.toLowerCase().includes(t)),
              }))
              .filter((s) => s.cards.length + s.ghostNames.length > 0)
          : null,
      }))
      .filter((row) =>
        row.subsections ? row.subsections.length > 0 : row.cards.length > 0,
      );
  }, [rows, t]);

  const liveTotal = rows.reduce((a, r) => a + r.liveCount, 0);
  const trackedTotal = rows.reduce((a, r) => a + r.totalCount, 0);

  return (
    <>
      <div className="sticky top-0 z-10 bg-gradient-to-b from-[#0B1220] from-70% to-transparent pb-2.5 pt-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search any brand…"
          className="w-full rounded-xl border border-[#22304C] bg-[#0E1729] px-4 py-3 text-sm text-[#F1F5F9] outline-none placeholder:text-[#586A88] focus:border-[#38BDF8]"
        />
        <div className="mt-2 text-xs text-[#586A88]">
          {liveTotal} brands read · {trackedTotal} tracked · more added as FDDs are pulled
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="py-7 text-center text-sm text-[#8194B0]">No brands match that search.</div>
      )}

      {filtered.map((row) => (
        <section key={row.vertical} className="mt-9">
          <div className="mb-4 flex items-baseline gap-3 border-b-2 border-[#22304C] pb-2">
            <h2 className="text-lg font-extrabold tracking-tight text-[#F1F5F9]">{row.vertical}</h2>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#586A88]">
              {row.liveCount} live{row.totalCount - row.liveCount > 0 ? ` · ${row.totalCount - row.liveCount} pending` : ""}
            </span>
          </div>

          {row.subsections ? (
            row.subsections.map((s) => (
              <div key={s.category} className="mt-4">
                <div className="mb-3 flex items-baseline gap-3">
                  <h3 className="text-sm font-bold text-[#CBD5E1]">{s.category}</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#586A88]">
                    {s.liveCount} live · {s.totalCount - s.liveCount} pending
                  </span>
                </div>
                <CardGrid>
                  {s.cards.map((c) =>
                    c.live ? (
                      <LiveBrandCard key={c.slug} card={c} refTag={refTag} />
                    ) : (
                      <GhostBrandCard key={c.slug} name={c.brandName} category={s.category} />
                    ),
                  )}
                  {s.ghostNames.map((name) => (
                    <GhostBrandCard key={name} name={name} category={s.category} />
                  ))}
                </CardGrid>
              </div>
            ))
          ) : (
            <CardGrid>
              {row.cards.map((c) =>
                c.live ? (
                  <LiveBrandCard key={c.slug} card={c} refTag={refTag} />
                ) : (
                  <GhostBrandCard key={c.slug} name={c.brandName} category={row.vertical} />
                ),
              )}
            </CardGrid>
          )}
        </section>
      ))}
    </>
  );
}
