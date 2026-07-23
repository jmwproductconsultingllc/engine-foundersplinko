// app/brands/page.tsx — the diligence library directory (Path-A cold funnel
// entry). Server component: rows are computed at build/request time from the
// brand store; interactivity (search, ghost demand-signals) lives in the
// client BrandDirectory. Hero preference here is 'revenue' — the SEO honesty
// standard ("revenue, labeled revenue"); campaign wrappers pass 'profit'.

import type { Metadata } from "next";
import Link from "next/link";
import { listVerticalDirectory, listBrands, VERTICAL_ORDER, KIDS_VERTICAL } from "@/lib/brands";
import { computeRiskBenchmarks, overallSpread } from "@/lib/riskBenchmarks";
import BrandDirectory from "@/components/BrandDirectory";
import { DiligenceContextBanner } from "@/components/DiligenceToVerify";

export const revalidate = 3600; // store changes at converter cadence, not per-request

export const metadata: Metadata = {
  title: "Franchise Diligence Library — Browse by Vertical | Franchise Edge",
  description:
    "Browse franchises across 11 verticals — kids, home services, fitness, food, B2B and more. Every brand's FDD read by AI: real cost to open, Item 19 numbers, and risk level.",
  openGraph: {
    title: "Franchise Diligence Library — Browse by Vertical | Franchise Edge",
    description:
      "Every franchise, read by AI. Real cost to open, Item 19 numbers, and risk — free, before a salesperson spins you.",
  },
};

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const refTag = ref?.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || null;
  const rows = await listVerticalDirectory("revenue");
  // Risk Reframe context banner — corpus distribution, computed once server-side.
  const benchmarks = computeRiskBenchmarks(await listBrands());
  const spread = overallSpread(benchmarks);

  return (
    <main className="min-h-screen bg-[#0B1220] px-4 pb-16 text-[#F1F5F9] md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between border-b border-[#22304C] py-4">
          <Link href="/" className="text-[15px] font-extrabold">
            Franchise<span className="text-[#34D399]">Edge</span>
          </Link>
          <Link
            href="/"
            className="rounded-lg bg-[#34D399] px-3.5 py-2 text-[13px] font-bold text-[#0B1220]"
          >
            Read your own FDD →
          </Link>
        </div>

        <header className="pt-10">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#38BDF8]">
            The diligence library
          </p>
          <h1 className="mt-2 max-w-[20ch] text-[31px] font-extrabold leading-tight tracking-tight">
            Every franchise, read by AI.
          </h1>
          <p className="mt-2.5 max-w-[60ch] text-[15px] text-[#8194B0]">
            Pick a brand and see what it actually earns — the Item 19 monthly numbers, the real cost,
            and the risk — free, before a salesperson spins you.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {VERTICAL_ORDER.map((v) => (
              <span
                key={v}
                className="rounded-full border border-[#34D399]/50 bg-[#34D399]/[0.08] px-3 py-1.5 text-xs font-bold text-[#34D399]"
              >
                {v === KIDS_VERTICAL ? "Kids & Family" : v}
              </span>
            ))}
          </div>
        </header>

        <div className="mt-6">
          <DiligenceContextBanner spread={spread} total={benchmarks.overall.total} />
        </div>

        <BrandDirectory rows={rows} refTag={refTag} />

        <div className="mt-10 border-t border-[#22304C] pt-4 text-xs text-[#8194B0]">
          Don&apos;t see a brand?{" "}
          <Link href="/" className="text-[#38BDF8] hover:underline">
            Upload its FDD
          </Link>{" "}
          and we&apos;ll read it in ~2 minutes — or find one free on{" "}
          <a
            href="https://apps.dfi.wi.gov/apps/FranchiseSearch/MainSearch.aspx"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#38BDF8] hover:underline"
          >
            Wisconsin&apos;s registry
          </a>
          . Informational only — figures are AI-extracted; verify against the source FDD.
        </div>
      </div>
    </main>
  );
}
