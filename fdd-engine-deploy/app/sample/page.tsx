// fdd-engine-deploy/app/sample/page.tsx
//
// The standalone SAMPLE REPORT surface.
//
// Before this, "See a sample report" was an in-session state swap on the home
// page: no URL, so it could not be linked in an email, sent to a partner,
// bookmarked, indexed by Google, or reached with the back button. It also kept
// DiligenceReport + InfographicTeaser in the home page's client bundle purely
// to render a demo.
//
// Now it is a real route. The fixture is built server-side through the REAL
// pipeline (lib/sampleReport.ts → scoreFdd → underwrite → buildInsights →
// assessFinancialCondition), so this page tracks the engine: if scoring logic
// changes, the sample changes with it. Nothing here is hand-faked.
//
// INDEXED deliberately — "what does a franchise diligence report actually look
// like" is a real search, and this is the honest answer. The brand is fictional
// (Verde Bowls) and labeled as such above the fold, twice, so no reader can
// mistake it for a real franchisor's disclosed numbers.

import type { Metadata } from "next";
import Link from "next/link";
import DiligenceReport from "@/components/DiligenceReport";
import SampleViewedBeacon from "@/components/SampleViewedBeacon";
import SampleStickyBar from "@/components/SampleStickyBar";
import { getSampleResult } from "@/lib/sampleReport";
import { liveBrandCount, brandCountPhrase } from "@/lib/brandCount";
import RefundNote from "@/components/RefundNote";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://engine.foundersplinko.com";

const PRICE_LABEL = "$199";

const DISPLAY =
  "var(--font-display, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)";

const TITLE = "Sample franchise diligence report — Franchise Edge";
const DESC =
  "See a complete Franchise Edge report end to end: real cost to open, Item 19 unit economics, the full fee stack, financial condition, and what to verify. Illustrative example, fictional brand.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${BASE}/sample` },
  openGraph: {
    title: TITLE,
    description: DESC,
    url: `${BASE}/sample`,
    type: "article",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

export default async function SamplePage() {
  // Single source (lib/brandCount.ts) — this was a hand-typed literal.
  const brandCount = brandCountPhrase(await liveBrandCount());
  const result = getSampleResult();
  const brandName = result.extracted.brandName ?? "this brand";

  return (
    <main className="min-h-screen bg-[#0B1220] text-[#F1F5F9] px-4 py-8 md:px-8 md:py-12">
      {/* pb-24: the sticky bar is fixed, so the last paragraph needs clearance or
          it sits underneath it on mobile. */}
      <div className="mx-auto max-w-4xl space-y-5 pb-24">
        <Link href="/" className="inline-block text-sm font-medium text-[#38BDF8] hover:underline">
          ← Back to Franchise Edge
        </Link>

        {/* Above the fold: what this is, in one breath, before any number. */}
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#38BDF8]">
            Sample report
          </p>
          <h1
            className="mt-2 text-2xl font-bold leading-[1.15] text-[#F1F5F9] md:text-[2rem]"
            style={{ fontFamily: DISPLAY }}
          >
            This is what the $199 report gives you.
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#8194B0]">
            Every section below is the real engine output — the same scoring, underwriting, and
            financial-condition logic that runs on your FDD. Only the disclosure behind it is
            invented, so nothing here is any franchisor&apos;s actual numbers.
          </p>
        </header>

        {/* Honesty banner — the second, unmissable statement that this is fictional. */}
        <div className="rounded-xl border border-[#38BDF8]/30 bg-[#38BDF8]/[0.07] px-5 py-3.5 text-sm leading-relaxed text-[#CBD5E1]">
          <span className="font-semibold text-[#38BDF8]">Illustrative example.</span>{" "}
          <span className="font-semibold text-[#F1F5F9]">{brandName}</span> is a fictional brand with
          realistic numbers, built to show the complete report. It is not a real franchise, and no
          figure on this page describes a real company.
        </div>

        <SampleViewedBeacon />

        <DiligenceReport result={result} />

        {/* THE ASK — deliberately at the BOTTOM, not the top. A reader who has
            gone through an entire diligence report end to end is the highest-
            intent visitor on the site; making them scroll back up to a banner CTA
            taxes exactly the person who is most ready to buy. The price and the
            guarantee line sit together, because "$199" and "one-time, yours
            forever" answer each other. */}
        <section className="rounded-2xl border border-[#34D399]/35 bg-gradient-to-b from-[#34D399]/[0.08] to-transparent p-5 md:p-6">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#34D399]">
            Your brand, this report
          </p>
          <h2
            className="mt-2 text-xl font-bold leading-tight text-[#F1F5F9] md:text-2xl"
            style={{ fontFamily: DISPLAY }}
          >
            Now run it on the franchise you&apos;re actually looking at.
          </h2>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-[#8194B0]">
            Upload that brand&apos;s FDD and get everything above on its numbers — real cost to open,
            the disclosed Item 19 cohorts, the full fee stack, financial condition, and your list of
            what to verify. About two minutes. The free snapshot comes first.
          </p>

          {/* price + guarantee, side by side */}
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="shrink-0">
              <span className="text-[34px] font-extrabold leading-none text-[#F1F5F9]">{PRICE_LABEL}</span>
              <span className="ml-2 text-[13px] text-[#8194B0]">full report</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-[#CBD5E1] sm:border-l sm:border-[#27344F] sm:pl-4">
              <b className="text-[#F1F5F9]">
                One-time {PRICE_LABEL} · not a subscription · yours forever.
              </b>{" "}
              No account required, and we never sell your information to a franchisor or a broker.
            </p>
          </div>

          {/* The block above was labeled "price + guarantee" and had no
              guarantee in it — the copy promised reassurance the page never
              delivered. This is the guarantee. */}
          <RefundNote className="mt-4" />

          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <Link
              href="/"
              className="block flex-1 rounded-xl bg-[#34D399] py-3.5 text-center text-[15px] font-extrabold text-[#0B1220] hover:brightness-110"
            >
              Run my FDD — {PRICE_LABEL}
            </Link>
            <Link
              href="/brands"
              className="block flex-1 rounded-xl border border-[#27344F] py-3.5 text-center text-[15px] font-bold text-[#CBD5E1] transition-colors hover:border-[#38BDF8] hover:text-[#38BDF8]"
            >
              Browse {brandCount} free
            </Link>
          </div>
          <p className="mt-3 text-center text-[12.5px] text-[#8194B0]">
            No FDD yet?{" "}
            <Link href="/playbook" className="font-bold text-[#38BDF8] hover:underline">
              Start with the free Playbook →
            </Link>
          </p>
        </section>

        <SampleStickyBar />

        <p className="text-center text-xs leading-relaxed text-[#5A6B88]">
          Illustrative sample — fictional brand, invented disclosure. Informational only; not legal,
          financial, or investment advice. On a real FDD, figures are extracted by an AI model and
          may contain errors; verify against the source document and a qualified advisor before
          making any decision.
        </p>
      </div>
    </main>
  );
}
