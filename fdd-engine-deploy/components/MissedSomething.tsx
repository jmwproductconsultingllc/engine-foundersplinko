// components/MissedSomething.tsx — the capture, at the only moment it's worth
// anything.
//
// A buyer who wants a refund is a buyer who paid, read the whole report, and
// can name the exact gap. That message is the highest-signal thing that reaches
// the inbox, and today the default path loses it: they either request the
// refund with no detail, or they don't bother and quietly don't come back. The
// $199 is the cheap part of a refund. The unheard reason is the expensive part.
//
// THREE DELIBERATE CONSTRAINTS
//
// 1. PAID ONLY, AND AT THE FOOT. This never renders on the teaser. Asking
//    someone who hasn't bought what the report missed is asking them to imagine
//    a disappointment, which is a strange thing to do to a prospect.
//
// 2. NOT NEXT TO THE PRICE. Same reason. lib/refund.ts documents the rule.
//
// 3. mailto, NOT A FORM. Two reasons. A form here is a support desk we'd have
//    to build, staff and monitor, and the whole refund design is "a person, not
//    a ticket queue." And the subject line does the work a form field would:
//    it arrives pre-tagged and pre-identified, so the reply is a build ticket
//    instead of a thread that starts with "which report was this?"
//
// The buyer's own mail client opens with the draft; nothing is transmitted
// until they hit send, and they see everything in it first.

import Link from "next/link";
import { REFUND_ASK, REFUND_EMAIL, REFUND_HREF } from "@/lib/refund";

export default function MissedSomething({ reportId }: { reportId: string }) {
  const subject = `Franchise Edge report ${reportId} — what's missing`;
  const body = [
    "What I was looking for and didn't find:",
    "",
    "",
    "(Anything specific helps — a section, a number, a question you still can't answer.)",
  ].join("\n");
  const href = `mailto:${REFUND_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  return (
    <section className="mt-10 rounded-xl border border-[#22304C] bg-[#131F35]/60 px-5 py-4">
      <h3 className="text-[13px] font-extrabold tracking-wide text-[#F1F5F9]">
        What&rsquo;s missing?
      </h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#8194B0]">
        {REFUND_ASK}{" "}
        <a
          href={href}
          className="font-semibold text-[#38BDF8] underline decoration-dotted underline-offset-2 hover:text-[#7DD3FC]"
        >
          Email us
        </a>
        {" · "}
        <Link
          href={REFUND_HREF}
          className="underline decoration-dotted underline-offset-2 hover:text-[#CBD5E1]"
        >
          Refund terms
        </Link>
      </p>
    </section>
  );
}
