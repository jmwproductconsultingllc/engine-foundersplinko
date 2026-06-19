"use client";

import { useState } from "react";
import FDDUpload from "@/components/FDDUpload";
import FeatureMatrix from "@/components/FeatureMatrix";
import DiligenceReport from "@/components/DiligenceReport";
import type { DiligenceResult } from "@/lib/types";

const DISPLAY =
  "var(--font-display, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)";

// Set NEXT_PUBLIC_SAMPLE_REPORT_URL in Vercel when the canonical sample exists;
// until then the button scrolls to the value matrix.
const SAMPLE_URL = process.env.NEXT_PUBLIC_SAMPLE_REPORT_URL || "#what-you-get";

export default function Page() {
  const [result, setResult] = useState<DiligenceResult | null>(null);

  if (result) {
    return (
      <main className="min-h-screen bg-[#0B1220] text-[#F1F5F9] px-4 py-10 md:px-8">
        <div className="mx-auto max-w-4xl space-y-5">
          <button
            onClick={() => setResult(null)}
            className="text-sm font-medium text-[#38BDF8] hover:underline"
          >
            ← Analyze another FDD
          </button>
          <DiligenceReport result={result} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B1220] text-[#F1F5F9] px-4 py-12 md:px-8 md:py-16">
      <style>{`@keyframes fe-hero { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }`}</style>

      <div className="mx-auto max-w-3xl">
        {/* hero */}
        <header
          className="mx-auto mb-8 max-w-2xl text-center"
          style={{ animation: "fe-hero 0.5s ease-out both" }}
        >
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#38BDF8]">
            Franchise Edge
          </p>
          <h1
            className="text-3xl font-bold leading-[1.1] text-[#F1F5F9] md:text-[2.75rem]"
            style={{ fontFamily: DISPLAY }}
          >
            Know if this franchise will actually make you money.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[#8194B0]">
            Upload the FDD and tell us what you can put toward opening. In minutes you get a scored
            diligence read — real unit economics, hidden fees, and the franchisor&apos;s financial
            health — measured against your own capital.
          </p>
        </header>

        {/* command center */}
        <div
          className="mx-auto max-w-xl"
          style={{ animation: "fe-hero 0.5s ease-out 0.08s both" }}
        >
          <FDDUpload onResult={setResult} />

          <div className="mt-4 text-center">
            <a
              href={SAMPLE_URL}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#27344F] px-4 py-2
                text-sm font-medium text-[#CBD5E1] transition-colors hover:border-[#38BDF8] hover:text-[#38BDF8]"
            >
              See a sample report
              <span aria-hidden>→</span>
            </a>
          </div>
        </div>

        {/* value matrix */}
        <FeatureMatrix />

        <p className="mt-12 text-center text-xs leading-relaxed text-[#5A6B88]">
          Informational only — not legal, financial, or investment advice. Figures are extracted by
          an AI model and may contain errors; verify against the source FDD and a qualified advisor
          before making any decision.
        </p>
      </div>
    </main>
  );
}
