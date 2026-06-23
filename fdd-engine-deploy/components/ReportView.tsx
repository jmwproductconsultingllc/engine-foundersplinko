// fdd-engine-deploy/components/ReportView.tsx
//
// The teaser/full gate for a persisted report, keyed on the paid flag.
// - paid:  open straight to the full DiligenceReport.
// - unpaid: show the InfographicTeaser; unlock is FREE for now (same as the old
//   in-session flow) and becomes Stripe checkout in #5/#6. Once the webhook
//   flips paid:true, the report loads unlocked with no click.

"use client";

import { useState } from "react";
import DiligenceReport from "@/components/DiligenceReport";
import InfographicTeaser from "@/components/InfographicTeaser";
import type { DiligenceResult } from "@/lib/types";

export default function ReportView({
  result,
  paid,
}: {
  result: DiligenceResult;
  paid: boolean;
}) {
  const [unlocked, setUnlocked] = useState(paid);

  return unlocked ? (
    <DiligenceReport result={result} />
  ) : (
    <InfographicTeaser result={result} onUnlock={() => setUnlocked(true)} />
  );
}
