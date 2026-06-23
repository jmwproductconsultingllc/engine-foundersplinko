// fdd-engine-deploy/app/report/[reportId]/page.tsx
//
// Permanent, shareable report surface. Loads the persisted report from Blob and
// renders the existing DiligenceReport. This is where the paywall gate (teaser
// vs full) will live in #2 — for now it renders the full report.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DiligenceReport from "@/components/DiligenceReport";
import { loadReport } from "@/lib/reports";

// Always read fresh — the paid flag changes out-of-band (Stripe webhook in #6).
export const dynamic = "force-dynamic";

// Buyer reports should never be indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const record = await loadReport(reportId);
  if (!record) notFound();

  return (
    <main className="min-h-screen bg-[#0B1220] text-[#F1F5F9]">
      <div className="mx-auto max-w-4xl px-4 py-8 md:py-12">
        <a
          href="/"
          className="mb-6 inline-block text-sm text-[#38BDF8] hover:text-[#7DD3FC]"
        >
          ← Analyze another FDD
        </a>
        <DiligenceReport result={record.result} />
      </div>
    </main>
  );
}
