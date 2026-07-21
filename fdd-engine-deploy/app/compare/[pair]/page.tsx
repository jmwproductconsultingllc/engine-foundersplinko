// app/compare/[pair]/page.tsx — P1-6: /compare/<a>-vs-<b> for same-vertical
// pairs, library data only, one template. Fit-map framing, no crowned winner
// (banked comparison principle): anything comparable renders on shared rows;
// direction is only marked where structural. SSG over all same-vertical live
// pairs; slugs sorted alphabetically define the canonical URL.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { listBrands, toCard, verticalOf, type BrandCard as Card } from "@/lib/brands";
import BrandCTA from "@/components/BrandCTA";

export const revalidate = 3600;

const usd = (n: number | null) =>
  n == null ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;

function parsePair(pair: string): [string, string] | null {
  const i = pair.indexOf("-vs-");
  if (i <= 0) return null;
  const a = pair.slice(0, i);
  const b = pair.slice(i + 4);
  return a && b && a !== b ? [a, b] : null;
}

async function livePairs(): Promise<Array<[string, string, string]>> {
  const brands = await listBrands();
  const live = brands.filter((b) => toCard(b).live);
  const out: Array<[string, string, string]> = [];
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      if (verticalOf(live[i]) !== verticalOf(live[j])) continue;
      const [a, b] = [live[i].slug, live[j].slug].sort();
      out.push([a, b, verticalOf(live[i])]);
    }
  return out;
}

export async function generateStaticParams() {
  return (await livePairs()).map(([a, b]) => ({ pair: `${a}-vs-${b}` }));
}

export async function generateMetadata({ params }: { params: Promise<{ pair: string }> }): Promise<Metadata> {
  const { pair } = await params;
  const parsed = parsePair(pair);
  if (!parsed) return { title: "Franchise Comparison | Franchise Edge" };
  const brands = await listBrands();
  const A = brands.find((b) => b.slug === parsed[0]);
  const B = brands.find((b) => b.slug === parsed[1]);
  if (!A || !B) return { title: "Franchise Comparison | Franchise Edge" };
  const year = new Date().getFullYear();
  const title = `${A.brandName} vs ${B.brandName} (${year}): Franchise Cost, Earnings & Fees Compared`;
  return {
    title,
    description: `${A.brandName} or ${B.brandName}? Cost to open, Item 19 earnings, royalty and risk — side by side, read from each brand's actual FDD.`,
    openGraph: { title, type: "article" },
  };
}

function Row({ label, a, b, sub }: { label: string; a: React.ReactNode; b: React.ReactNode; sub?: string }) {
  return (
    <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-2 border-t border-[#22304C] py-3 text-sm">
      <div>
        <span className="font-semibold text-[#CBD5E1]">{label}</span>
        {sub && <div className="text-[11px] text-[#586A88]">{sub}</div>}
      </div>
      <div className="text-[#F1F5F9]">{a}</div>
      <div className="text-[#F1F5F9]">{b}</div>
    </div>
  );
}

const heroCell = (c: Card) =>
  c.mo == null ? (
    <span className="text-[#8194B0]">Not disclosed</span>
  ) : (
    <span>
      ${Math.round(c.mo / 1000)}k/mo <span className="text-[#8194B0]">{c.moKind}</span>
      {c.moCaveat && <div className="text-[11px] text-[#586A88]">{c.moCaveat}</div>}
    </span>
  );

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ pair: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const [{ pair }, { ref }] = await Promise.all([params, searchParams]);
  const parsed = parsePair(pair);
  if (!parsed) notFound();
  const [aSlug, bSlug] = parsed;
  // canonical order: alphabetical — redirect the reversed URL so SEO equity pools
  if (aSlug > bSlug) permanentRedirect(`/compare/${bSlug}-vs-${aSlug}`);

  const brands = await listBrands();
  const A = brands.find((x) => x.slug === aSlug);
  const B = brands.find((x) => x.slug === bSlug);
  if (!A || !B) notFound();
  if (verticalOf(A) !== verticalOf(B)) notFound(); // same-vertical pairs only

  const a = toCard(A);
  const b = toCard(B);
  if (!a.live || !b.live) notFound();
  const refTag = ref?.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || null;

  return (
    <main className="min-h-screen bg-[#0B1220] px-5 pb-16 text-[#F1F5F9]">
      <div className="mx-auto max-w-[860px]">
        <div className="flex items-center justify-between border-b border-[#27344F] py-4">
          <Link href="/" className="text-[15px] font-extrabold">
            Franchise<span className="text-[#34D399]">Edge</span>
          </Link>
          <Link href="/brands" className="text-[13px] font-bold text-[#38BDF8] hover:underline">
            ← All brands
          </Link>
        </div>

        <p className="mt-8 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#38BDF8]">
          {verticalOf(A)} · head to head · from each brand&apos;s actual FDD
        </p>
        <h1 className="mt-2 text-[28px] font-extrabold leading-tight tracking-tight">
          {A.brandName} vs {B.brandName} ({new Date().getFullYear()})
        </h1>
        <p className="mt-2 max-w-[62ch] text-[14px] text-[#8194B0]">
          No winner is crowned here — these are different bets for different buyers. Every figure is
          read from the brand&apos;s own disclosure document; caveats travel with their numbers.
        </p>

        <div className="mt-6 grid grid-cols-[1.2fr_1fr_1fr] gap-2 text-sm font-extrabold">
          <div />
          <Link href={`/franchise/${a.slug}`} className="text-[#34D399] hover:underline">{a.brandName}</Link>
          <Link href={`/franchise/${b.slug}`} className="text-[#34D399] hover:underline">{b.brandName}</Link>
        </div>

        <Row
          label="Cost to open"
          sub="Item 7 declared (or engine mid-point est.)"
          a={a.lo != null ? `${usd(a.lo)} – ${usd(a.hi)}` : a.buildoutMid != null ? `~${usd(a.buildoutMid)}` : "—"}
          b={b.lo != null ? `${usd(b.lo)} – ${usd(b.hi)}` : b.buildoutMid != null ? `~${usd(b.buildoutMid)}` : "—"}
        />
        <Row label="Disclosed monthly figure" sub="Item 19 · labeled by its own type" a={heroCell(a)} b={heroCell(b)} />
        <Row
          label="Royalty"
          a={a.royaltyPct != null ? `${a.royaltyPct}%` : a.flatRoyaltyNote ?? "—"}
          b={b.royaltyPct != null ? `${b.royaltyPct}%` : b.flatRoyaltyNote ?? "—"}
        />
        <Row label="System size" sub="Item 20" a={a.units ?? "—"} b={b.units ?? "—"} />
        <Row
          label="Diligence risk level"
          a={<span className={a.risk === "High" ? "text-red-400" : a.risk === "Medium" ? "text-amber-300" : "text-[#34D399]"}>{a.risk}</span>}
          b={<span className={b.risk === "High" ? "text-red-400" : b.risk === "Medium" ? "text-amber-300" : "text-[#34D399]"}>{b.risk}</span>}
        />
        <Row
          label="Top FDD disclosure"
          sub="category — detail in the full report"
          a={a.tripwires[0] ? `🔒 ${a.tripwires[0].label}` : "—"}
          b={b.tripwires[0] ? `🔒 ${b.tripwires[0].label}` : "—"}
        />

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <BrandCTA brandName={a.brandName} slug={a.slug} refTag={refTag} source="compare_page" />
          <BrandCTA brandName={b.brandName} slug={b.slug} refTag={refTag} source="compare_page" />
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-[#586A88]">
          Informational only — not legal, financial, or investment advice. Figures are AI-extracted
          from each brand&apos;s FDD and may contain errors; verify against the source documents. Different
          brands disclose different cohorts and periods — compare contracts and disclosures, not destinies.
        </p>
      </div>
    </main>
  );
}
