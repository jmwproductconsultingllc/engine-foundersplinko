"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FDDUpload from "@/components/FDDUpload";
import FeatureMatrix from "@/components/FeatureMatrix";
import DiligenceReport from "@/components/DiligenceReport";
import InfographicTeaser from "@/components/InfographicTeaser";
import type { DiligenceResult } from "@/lib/types";
import { track } from "@/lib/analytics";
import { getSampleResult } from "@/lib/sampleReport";

const DISPLAY =
  "var(--font-display, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)";

export default function Page() {
  const router = useRouter();
  // Result state below is now used ONLY by the sample report (an in-session
  // demo). A real upload persists server-side and redirects to /report/[id].
  const [result, setResult] = useState<DiligenceResult | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [isSample, setIsSample] = useState(false);
  const [primerOpen, setPrimerOpen] = useState(false);

  if (result) {
    const reset = () => {
      setResult(null);
      setUnlocked(false);
      setIsSample(false);
    };
    return (
      <main className="min-h-screen bg-[#0B1220] text-[#F1F5F9] px-4 py-10 md:px-8">
        <div className="mx-auto max-w-4xl space-y-5">
          <button onClick={reset} className="text-sm font-medium text-[#38BDF8] hover:underline">
            ← {isSample ? "Back to start" : "Analyze another FDD"}
          </button>
          {isSample && (
            <div className="rounded-xl border border-[#38BDF8]/30 bg-[#38BDF8]/[0.07] px-5 py-3.5 text-sm leading-relaxed text-[#CBD5E1]">
              <span className="font-semibold text-[#38BDF8]">Sample report.</span> An illustrative example of a
              full Franchise Edge read — fictional brand, realistic numbers.{" "}
              <button onClick={reset} className="font-medium text-[#38BDF8] hover:underline">
                Run yours →
              </button>
            </div>
          )}
          {unlocked ? (
            <DiligenceReport result={result} />
          ) : (
            <InfographicTeaser result={result} onUnlock={() => setUnlocked(true)} />
          )}
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
          className="mx-auto mb-7 max-w-2xl text-center"
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
            Upload the franchise&apos;s{" "}
            <button
              type="button"
              onClick={() => {
                if (!primerOpen) track("primer_opened", { source: "hero_link" });
                setPrimerOpen(true);
              }}
              className="font-medium text-[#38BDF8] underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              FDD
            </button>{" "}
            — the disclosure document every franchisor must give you — and tell us what you can put
            toward opening. In minutes you get a scored diligence read: real unit economics, hidden
            fees, and the franchisor&apos;s financial health, measured against your own capital.
          </p>
        </header>

        {/* command center (with the FDD on-ramp directly above the input) */}
        <div
          className="mx-auto max-w-xl"
          style={{ animation: "fe-hero 0.5s ease-out 0.08s both" }}
        >
          {/* On-ramp for cold/novice visitors — sky-tinted so it reads as "help is here,"
              and placed above the box so no one is stranded at "how much can you put toward opening." */}
          <div className="mb-4 rounded-xl border border-[#38BDF8]/25 bg-[#38BDF8]/[0.05] px-5 py-3.5">
            <button
              type="button"
              onClick={() => {
                if (!primerOpen) track("primer_opened", { source: "strip" });
                setPrimerOpen((o) => !o);
              }}
              aria-expanded={primerOpen}
              className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-[#CBD5E1]"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#38BDF8]/20 text-xs font-bold text-[#38BDF8]">
                  ?
                </span>
                New to franchises? What an FDD is — and where to get one
              </span>
              <svg
                className={`h-4 w-4 shrink-0 text-[#5A6B88] transition-transform duration-200 ${
                  primerOpen ? "rotate-180" : ""
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {primerOpen && (
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-[#8194B0]">
                <p>
                  An FDD — Franchise Disclosure Document — is the 200–300 page disclosure every
                  franchisor must give you before you invest: the real costs, fees, financials,
                  litigation, and the rules of the deal.
                </p>
                <p>
                  Ask the franchise for it directly — under FTC rules they must provide it free, at
                  least 14 days before you sign anything or pay a dime. Or look one up in a state
                  registry to compare brands before you ever talk to a salesperson.
                </p>
                <a
                  href="https://apps.dfi.wi.gov/apps/FranchiseSearch/MainSearch.aspx"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("fdd_lookup_clicked")}
                  className="inline-flex items-center gap-1.5 font-medium text-[#38BDF8] hover:underline"
                >
                  Look up an FDD on Wisconsin&apos;s free registry
                  <span aria-hidden>↗</span>
                </a>
              </div>
            )}
          </div>

          <FDDUpload onComplete={(reportId) => router.push(`/report/${reportId}`)} />

          <div className="mt-4 text-center">
            <button
              onClick={() => {
                track("sample_report_clicked");
                setIsSample(true);
                setUnlocked(true);
                setResult(getSampleResult());
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#27344F] px-4 py-2
                text-sm font-medium text-[#CBD5E1] transition-colors hover:border-[#38BDF8] hover:text-[#38BDF8]"
            >
              See a sample report
              <span aria-hidden>→</span>
            </button>
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
