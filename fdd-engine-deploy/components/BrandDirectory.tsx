"use client";

// components/BrandDirectory.tsx — the interactive body of /brands.
// Server page loads the rows (SSG-friendly); this handles search filtering and
// renders live cards vs ghosts. THIN store entries (parsed but not sellable —
// e.g. a broken Item 7) render as ghosts alongside the never-parsed universe.

import { useMemo, useState } from "react";
import type { CategoryRow } from "@/lib/brands";
import { LiveBrandCard, GhostBrandCard } from "@/components/BrandCard";

export default function BrandDirectory({
  rows,
  refTag,
}: {
  rows: CategoryRow[];
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
        ghostNames: row.ghostNames.filter((n) => n.toLowerCase().includes(t)),
      }))
      .filter((row) => row.cards.length + row.ghostNames.length > 0);
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
        <section key={row.category} className="mt-8">
          <div className="mb-3.5 flex items-baseline gap-3 border-b border-[#22304C] pb-2">
            <h2 className="text-base font-extrabold tracking-tight text-[#F1F5F9]">{row.category}</h2>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#586A88]">
              {row.liveCount} live · {row.totalCount - row.liveCount} pending
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {row.cards.map((c) =>
              c.live ? (
                <LiveBrandCard key={c.slug} card={c} refTag={refTag} />
              ) : (
                <GhostBrandCard key={c.slug} name={c.brandName} category={row.category} />
              ),
            )}
            {row.ghostNames.map((name) => (
              <GhostBrandCard key={name} name={name} category={row.category} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
