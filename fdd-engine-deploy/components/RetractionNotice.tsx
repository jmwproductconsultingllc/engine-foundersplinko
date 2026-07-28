// components/RetractionNotice.tsx — what a pulled brand's URL serves.
//
// This page has exactly one job: a person who followed a link to a brand page
// must leave understanding (a) the page is gone on purpose, (b) why, and (c)
// what to do next. Everything else is decoration.
//
// DESIGN CONSTRAINTS, each one deliberate:
//
//   No figures. Not the cost range, not the royalty, not the risk tier. The
//   whole premise of the retraction is that we can't currently stand behind the
//   numbers on this record, so re-printing any of them "for context" undoes it.
//   The component receives a brand NAME and a Retraction. Nothing else. It is
//   structurally incapable of leaking a figure, which is the point — a props
//   shape that can't carry the mistake beats a rule that says don't.
//
//   Amber, not red. Red reads as danger *about the franchise*, and the one
//   reading we must not create is that we're implying something about the
//   brand. The failure is ours; the color should say "notice," not "warning."
//
//   Exits, plural. Somebody arrived here wanting to research a franchise. Send
//   them to the library and to the sample report rather than leaving a dead end
//   whose only control is the back button.
//
// See lib/retraction.ts for why this exists at all instead of a 404.

import Link from "next/link";
import { retractionCopy, type Retraction } from "@/lib/retraction";
import { REFUND_EMAIL, REFUND_HREF } from "@/lib/refund";

const DISPLAY =
  "var(--font-display, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)";

export default function RetractionNotice({
  brandName,
  retraction,
}: {
  brandName: string;
  retraction: Retraction;
}) {
  const copy = retractionCopy(brandName, retraction);

  return (
    <main className="min-h-screen bg-[#0B1220] px-4 py-8 text-[#F1F5F9] md:px-8 md:py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href="/brands" className="inline-block text-sm font-medium text-[#38BDF8] hover:underline">
          ← Back to the brand library
        </Link>

        <div className="rounded-2xl border border-[#F59E0B]/35 bg-[#F59E0B]/[0.07] px-5 py-5 md:px-6 md:py-6">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#F59E0B]">
            Record retracted
          </p>
          <h1
            className="mt-2 text-[26px] font-extrabold leading-tight text-[#F1F5F9] md:text-[32px]"
            style={{ fontFamily: DISPLAY }}
          >
            {copy.headline}
          </h1>
          <p className="mt-1.5 text-[13px] font-bold text-[#CBD5E1]">{copy.dateLine}</p>

          <div className="mt-4 space-y-3">
            {copy.paragraphs.map((p, i) => (
              <p key={i} className="text-[14px] leading-relaxed text-[#CBD5E1]">
                {p}
              </p>
            ))}
          </div>

          <p className="mt-4 text-[13.5px] leading-relaxed text-[#CBD5E1]">
            Questions, or a report to refund:{" "}
            <a
              href={`mailto:${REFUND_EMAIL}?subject=${encodeURIComponent(`${brandName} — retracted record`)}`}
              className="font-bold text-[#34D399] underline decoration-dotted underline-offset-2"
            >
              {REFUND_EMAIL}
            </a>
            {". "}
            <Link
              href={REFUND_HREF}
              className="text-[#8194B0] underline decoration-dotted underline-offset-2 hover:text-[#CBD5E1]"
            >
              Refund policy
            </Link>
          </p>
        </div>

        <div className="rounded-xl border border-[#27344F] bg-[#0F172A] px-5 py-4">
          <p className="text-[13px] font-extrabold text-[#F1F5F9]">While this one is down</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#8194B0]">
            Every other brand in the library is up and unchanged. You can also run the engine on any
            FDD you already have — it reads the document you upload, not our store.
          </p>
          <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
            <Link
              href="/brands"
              className="block flex-1 rounded-xl bg-[#34D399] py-3 text-center text-[14px] font-extrabold text-[#0B1220] hover:brightness-110"
            >
              Browse the library
            </Link>
            <Link
              href="/sample"
              className="block flex-1 rounded-xl border border-[#27344F] py-3 text-center text-[14px] font-bold text-[#CBD5E1] hover:border-[#38BDF8]/50"
            >
              See a sample report
            </Link>
          </div>
        </div>

        <p className="text-[12px] leading-relaxed text-[#5A6B88]">
          We publish figures read out of the franchisor&apos;s own Franchise Disclosure Document. When
          one of ours doesn&apos;t reconcile against that document, the record comes down until it
          does — and we say so here rather than editing the number quietly.
        </p>
      </div>
    </main>
  );
}
