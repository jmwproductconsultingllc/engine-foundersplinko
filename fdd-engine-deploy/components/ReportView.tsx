// fdd-engine-deploy/components/ReportView.tsx
//
// The gate for a persisted report.
// - paid:   full DiligenceReport.
// - unpaid: the InfographicTeaser, whose unlock now sends the buyer to Stripe
//   checkout (was a free in-session reveal). On return, the report page verifies
//   the session and flips paid, so this renders the full report.

"use client";

import DiligenceReport from "@/components/DiligenceReport";
import InfographicTeaser from "@/components/InfographicTeaser";
import type { DiligenceResult } from "@/lib/types";
import type { BenchmarkCopy } from "@/lib/riskBenchmarks";

export default function ReportView({
  result,
  paid,
  reportId,
  benchmark,
  benchmarkTotal,
  hasBroker,
}: {
  result: DiligenceResult;
  paid: boolean;
  reportId: string;
  /** Risk Reframe — corpus benchmark computed server-side, passed to the teaser */
  benchmark?: BenchmarkCopy | null;
  benchmarkTotal?: number;
  /** broker already captured (during the analyzing wait) → teaser skips the ask */
  hasBroker?: boolean;
}) {
  if (paid) return <DiligenceReport result={result} />;

  return (
    <InfographicTeaser
      result={result}
      reportId={reportId}
      benchmark={benchmark}
      benchmarkTotal={benchmarkTotal}
      hasBroker={hasBroker}
      onUnlock={() => {
        // Full navigation to the checkout route, which 303-redirects to Stripe.
        window.location.href = `/api/checkout?reportId=${reportId}`;
      }}
    />
  );
}
