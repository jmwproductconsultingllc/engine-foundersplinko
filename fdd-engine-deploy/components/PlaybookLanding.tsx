"use client";

// components/PlaybookLanding.tsx
//
// The client half of /playbook. The page shell is a server component (metadata +
// the resolved PDF URL); everything interactive lives here.
//
// CAPTURE MODEL — deliberate, and worth stating because it is a judgment call:
// the PDF is GATED behind an email, because the Playbook's entire job is to be
// the top-of-funnel lead magnet and the nurture path (lead_source: "playbook" →
// sendPlaybookEmail) already exists. But the moment capture succeeds we ALSO
// reveal the direct download inline. Making someone go find an email to read the
// thing you just convinced them to want is how you lose them — and the email
// still goes out, so the nurture is untouched either way.
//
// The reveal rides CaptureContext rather than EmailCapture's internal state, so
// it is the same coordination primitive the brand pages use — one capture on the
// page satisfies every surface.

import { CaptureProvider, useCapture } from "@/components/CaptureContext";
import EmailCapture from "@/components/EmailCapture";
import { PLAYBOOK_CONTENTS, PLAYBOOK_SLUG } from "@/lib/playbook";
import { track } from "@/lib/analytics";
import Link from "next/link";
import { useEffect, useRef } from "react";

const DISPLAY =
  "var(--font-display, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)";

/** Post-capture: the immediate download, so nobody has to go dig in their inbox. */
function DownloadReveal({ href, brandCount }: { href: string; brandCount: string }) {
  const capture = useCapture();
  if (!capture?.captured) return null;

  return (
    <div className="mt-4 rounded-2xl border border-[#34D399]/40 bg-[#34D399]/[0.08] p-5">
      <p className="text-[15px] font-bold text-[#F1F5F9]">It&apos;s on its way to your inbox.</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[#8194B0]">
        No need to wait — grab it right here.
      </p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track("playbook_downloaded", { source: "landing_page" })}
        className="mt-3 block w-full rounded-xl bg-[#34D399] py-3 text-center text-[15px] font-extrabold text-[#0B1220] hover:brightness-110"
      >
        Download the Playbook (PDF)
      </a>
      <p className="mt-3 text-center text-[12.5px] text-[#8194B0]">
        Next:{" "}
        <Link
          href="/brands"
          onClick={() => track("brands_library_clicked", { source: "playbook_page" })}
          className="font-bold text-[#38BDF8] hover:underline"
        >
          see what the FDD actually says about {brandCount} →
        </Link>
      </p>
    </div>
  );
}

export default function PlaybookLanding({
  downloadUrl,
  brandCount,
}: {
  downloadUrl: string;
  brandCount: string;
}) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    track("capture_shown", { capture_surface: "playbook" });
  }, []);

  return (
    <CaptureProvider>
      <main className="min-h-screen bg-[#0B1220] text-[#F1F5F9] px-4 py-10 md:px-8 md:py-14">
        <div className="mx-auto max-w-3xl">
          <Link href="/" className="mb-6 inline-block text-sm font-medium text-[#38BDF8] hover:underline">
            ← Franchise Edge
          </Link>

          {/* hero */}
          <header className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#38BDF8]">
              Free · The Franchise Buyer&apos;s Playbook
            </p>
            <h1
              className="mt-3 text-3xl font-bold leading-[1.1] text-[#F1F5F9] md:text-[2.6rem]"
              style={{ fontFamily: DISPLAY }}
            >
              Everything I wish I&apos;d known before I wrote the check.
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-[#8194B0]">
              I bought a franchise before I built the tool that reads the fine print. This is the
              plain-English guide I needed then: what the numbers mean, what the franchisor is
              legally required to tell you, and the order to do things in so nothing gets decided for
              you by a deadline.
            </p>
          </header>

          {/* capture — the gate, right under the promise */}
          <div className="mt-8">
            <EmailCapture
              brandName="Franchise Edge"
              brandSlug={PLAYBOOK_SLUG}
              surface="playbook"
              refTag={null}
            />
            <DownloadReveal href={downloadUrl} brandCount={brandCount} />
          </div>

          {/* what's inside */}
          <section className="mt-10">
            <h2 className="text-lg font-bold text-[#F1F5F9]" style={{ fontFamily: DISPLAY }}>
              What&apos;s inside
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {PLAYBOOK_CONTENTS.map((c) => (
                <div
                  key={c.t}
                  className="rounded-xl border-l-[3px] border-[#34D399] bg-[#111C33] px-4 py-3.5"
                >
                  <p className="text-[14px] font-bold text-[#F1F5F9]">{c.t}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[#8194B0]">{c.d}</p>
                </div>
              ))}
            </div>
          </section>

          {/* who it's for */}
          <section className="mt-10 rounded-2xl border border-[#27344F] bg-[#111C33] p-5">
            <h2 className="text-lg font-bold text-[#F1F5F9]" style={{ fontFamily: DISPLAY }}>
              Who it&apos;s for
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#8194B0]">
              First-time buyers, people comparing two or three brands, and anyone who has just been
              handed an FDD and a deadline. If you have already read three FDDs cover to cover, this
              will be too basic — go straight to{" "}
              <Link href="/brands" className="font-bold text-[#38BDF8] hover:underline">
                the brand library
              </Link>
              .
            </p>
          </section>

          {/* the ladder up — playbook is the top of the funnel, not the end of it */}
          <section className="mt-10">
            <h2 className="text-lg font-bold text-[#F1F5F9]" style={{ fontFamily: DISPLAY }}>
              When you&apos;re ready for the actual numbers
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#8194B0]">
              The Playbook teaches you what to look for. Franchise Edge finds it for you — it reads a
              brand&apos;s FDD and returns the real cost to open, the disclosed Item 19 earnings, the
              full fee stack, a plain-English list of what to verify, and the franchisees to call
              before you sign.
            </p>
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              <Link
                href="/sample"
                onClick={() => track("sample_report_clicked", { source: "playbook_page" })}
                className="block flex-1 rounded-xl border border-[#27344F] py-3 text-center text-[15px] font-bold text-[#CBD5E1] transition-colors hover:border-[#38BDF8] hover:text-[#38BDF8]"
              >
                See a sample report
              </Link>
              <Link
                href="/"
                className="block flex-1 rounded-xl bg-[#34D399] py-3 text-center text-[15px] font-extrabold text-[#0B1220] hover:brightness-110"
              >
                Run my FDD
              </Link>
            </div>
          </section>

          <p className="mt-10 text-xs leading-relaxed text-[#5A6B88]">
            Informational only — not legal, financial, or investment advice. Not affiliated with or
            endorsed by any franchisor. No spam: the Playbook, then occasional notes as you go —
            unsubscribe anytime.
          </p>
        </div>
      </main>
    </CaptureProvider>
  );
}
