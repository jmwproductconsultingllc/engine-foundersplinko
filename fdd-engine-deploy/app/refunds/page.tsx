// fdd-engine-deploy/app/refunds/page.tsx
//
// The full refund policy, on its own URL.
//
// WHY A PAGE AND NOT A MODAL
//
// Before this, the refund terms did not exist anywhere a buyer could read them.
// "Email me and I'll sort it out" is a real policy in practice, but a prospect
// deciding whether to send $199 to a founder they've never heard of cannot see
// practice — they can only see the page. A guarantee with no URL is a guarantee
// the buyer has to take on faith at exactly the moment they have least reason to.
//
// It is also the link Stripe, a card issuer, or a buyer's lawyer will ask for.
// A dispute where the merchant can point at a dated, public, unambiguous refund
// page is a dispute the merchant usually wins. One where the terms only ever
// lived in a component is not.
//
// Every word of the policy comes from lib/refund.ts. Nothing is retyped here —
// that is the whole point of the module, and lib/refund.test.ts enforces it.

import type { Metadata } from "next";
import Link from "next/link";
import {
  REFUND_DAYS,
  REFUND_EMAIL,
  REFUND_HEADLINE,
  REFUND_POLICY,
  REFUND_SENTENCE,
} from "@/lib/refund";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://engine.foundersplinko.com";

const DISPLAY =
  "var(--font-display, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)";

const TITLE = "Refund policy — Franchise Edge";
// Built from the constants, not typed out. The meta description is exactly the
// kind of copy that quietly keeps saying "30 days" a year after the policy
// changed — and it is the string Google shows, so it is the one a buyer reads
// first. lib/refund.test.ts fails the build if a window is hardcoded anywhere.
const DESC = `Franchise Edge reports carry a ${REFUND_HEADLINE}. Email within ${REFUND_DAYS} days of purchase for a full refund — no questions asked, no form to fill in.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${BASE}/refunds` },
  openGraph: { title: TITLE, description: DESC, url: `${BASE}/refunds`, type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

export default function RefundsPage() {
  return (
    <main className="min-h-screen bg-[#0B1220] px-4 py-8 text-[#F1F5F9] md:px-8 md:py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href="/" className="inline-block text-sm font-medium text-[#38BDF8] hover:underline">
          ← Back to Franchise Edge
        </Link>

        <header>
          <h1
            className="text-[30px] font-extrabold leading-tight text-[#F1F5F9] md:text-[38px]"
            style={{ fontFamily: DISPLAY }}
          >
            {REFUND_HEADLINE}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[#CBD5E1]">{REFUND_SENTENCE}</p>
        </header>

        <div className="space-y-4">
          {REFUND_POLICY.map((section) => (
            <section
              key={section.heading}
              className="rounded-xl border border-[#27344F] bg-[#0F172A] px-5 py-4"
            >
              <h2 className="text-[14px] font-extrabold text-[#34D399]">{section.heading}</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#CBD5E1]">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="rounded-xl border border-[#34D399]/25 bg-[#34D399]/[0.06] px-5 py-4">
          <p className="text-[13.5px] leading-relaxed text-[#CBD5E1]">
            Refund requests go to{" "}
            <a
              href={`mailto:${REFUND_EMAIL}?subject=Refund%20request`}
              className="font-bold text-[#34D399] underline decoration-dotted underline-offset-2"
            >
              {REFUND_EMAIL}
            </a>
            . A person reads it — there is no ticket queue, and you will get a reply from me.
          </p>
        </div>

        <p className="text-[12px] leading-relaxed text-[#5A6B88]">
          Franchise Edge reports are informational only and are not legal, financial, or investment
          advice. Figures are extracted from the franchisor&apos;s own Franchise Disclosure Document
          and should be verified against the source before you sign anything.
        </p>
      </div>
    </main>
  );
}
