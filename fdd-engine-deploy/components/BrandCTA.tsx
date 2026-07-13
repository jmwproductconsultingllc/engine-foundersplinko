"use client";

// components/BrandCTA.tsx — P0-3: the $199 conversion block, one component,
// data-driven brand name (never hardcoded), drops onto brand pages and report
// pages. Links to the mint route: UTM rides the middleware cookie, ref rides
// the query param, per-buyer payment stays intact.

import { track } from "@/lib/analytics";

export default function BrandCTA({
  brandName,
  slug,
  refTag,
  source,
}: {
  brandName: string;
  slug: string;
  refTag?: string | null;
  source: string; // e.g. "brand_page" | "report_page" | "compare_page"
}) {
  const href = `/api/mint-brand-report?slug=${slug}${refTag ? `&ref=${refTag}` : ""}`;
  return (
    <div className="rounded-2xl border border-[#34D399]/35 bg-gradient-to-b from-[#34D399]/[0.08] to-transparent p-5">
      <p className="text-[15px] font-bold text-[#F1F5F9]">
        Buying into {brandName}&apos;s system?
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-[#8194B0]">
        Get the full diligence report — every fee, tripwire, and the revenue modeled to what
        you&apos;d actually keep. $199, delivered in minutes.
      </p>
      <a
        href={href}
        onClick={() => track("upgrade_clicked", { source, slug, ref: refTag ?? "none" })}
        className="mt-3 block w-full rounded-xl bg-[#34D399] py-3 text-center text-[15px] font-extrabold text-[#0B1220] hover:brightness-110"
      >
        Get the {brandName} report — $199
      </a>
    </div>
  );
}
