// fdd-engine-deploy/app/report/[reportId]/page.tsx
//
// Permanent, shareable report surface. Loads the persisted report and hands it
// to ReportView (teaser/paid gate). On return from Stripe (?session_id=…) it
// verifies the session directly for immediate unlock, since the webhook's flip
// of the stored paid flag can lag ~1 min on the Blob CDN.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReportView from "@/components/ReportView";
import { loadReport } from "@/lib/reports";
import { isSessionPaidFor } from "@/lib/stripe";
import { listBrands, verticalForResult } from "@/lib/brands";
import { computeRiskBenchmarks, benchmarkFor } from "@/lib/riskBenchmarks";

// Always read fresh — the paid flag changes out-of-band (Stripe webhook).
export const dynamic = "force-dynamic";

// Buyer reports should never be indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { reportId } = await params;
  const { session_id } = await searchParams;

  const record = await loadReport(reportId);
  if (!record) notFound();

  // Immediate unlock on return from Stripe. The webhook is the durable source of
  // truth (it flips the stored flag), but the Blob CDN can serve the stale,
  // unpaid copy for up to ~a minute. So if the buyer just paid, verify the
  // session directly and open the full report now.
  let paid = record.paid;
  if (!paid && session_id) {
    paid = await isSessionPaidFor(session_id, reportId);
  }

  // Risk Reframe — corpus benchmark for the free snapshot's "N things to verify"
  // module (only needed for the unpaid teaser). Tier + vertical off the result.
  let benchmark = null;
  let benchmarkTotal: number | undefined;
  if (!paid) {
    const tier = record.result.scoring?.riskLevel ?? null;
    if (tier === "High" || tier === "Medium" || tier === "Low") {
      const benchmarks = computeRiskBenchmarks(await listBrands());
      const vertical = verticalForResult(record.result) ?? "";
      benchmark = benchmarkFor(tier, vertical, benchmarks);
      benchmarkTotal = benchmarks.overall.total;
    }
  }

  return (
    <main className="min-h-screen bg-[#0B1220] text-[#F1F5F9]">
      <div className="mx-auto max-w-4xl px-4 py-8 md:py-12">
        <a
          href="/"
          className="mb-6 inline-block text-sm text-[#38BDF8] hover:text-[#7DD3FC]"
        >
          ← Analyze another FDD
        </a>
        <ReportView
          result={record.result}
          paid={paid}
          reportId={reportId}
          benchmark={benchmark}
          benchmarkTotal={benchmarkTotal}
        />
      </div>
    </main>
  );
}
