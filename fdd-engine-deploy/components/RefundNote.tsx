// components/RefundNote.tsx — the guarantee, rendered next to the price.
//
// The whole point of this component is that the guarantee stops being something
// a buyer has to go looking for. It was previously nowhere on the site: a
// prospect deciding whether to spend $199 on a report from a founder they've
// never heard of had no stated recourse, and the honest read of "no refund
// policy displayed" is "there isn't one."
//
// Two variants, because the surfaces genuinely differ:
//   "full"    — headline + sentence + policy link. For blocks with room.
//   "compact" — one line. For teaser CTAs and anywhere a third line of text
//               would push the button below the fold on a phone.
//
// Deliberately NOT a modal, tooltip, or accordion. A guarantee you have to
// click to read is a guarantee that reads as conditional.

import Link from "next/link";
import { REFUND_HEADLINE, REFUND_SENTENCE, REFUND_SHORT, REFUND_HREF } from "@/lib/refund";

export default function RefundNote({
  variant = "full",
  className = "",
}: {
  variant?: "full" | "compact";
  className?: string;
}) {
  if (variant === "compact") {
    return (
      <p className={`text-[11px] leading-relaxed text-[#8194B0] ${className}`}>
        <span className="font-bold text-[#34D399]">{REFUND_SHORT}</span>
        {" · "}
        <Link href={REFUND_HREF} className="underline decoration-dotted underline-offset-2 hover:text-[#CBD5E1]">
          terms
        </Link>
      </p>
    );
  }

  return (
    <div
      className={`rounded-xl border border-[#34D399]/25 bg-[#34D399]/[0.06] px-4 py-3 text-left ${className}`}
    >
      <p className="text-[13px] font-extrabold text-[#34D399]">{REFUND_HEADLINE}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#CBD5E1]">
        {REFUND_SENTENCE}{" "}
        <Link
          href={REFUND_HREF}
          className="text-[#8194B0] underline decoration-dotted underline-offset-2 hover:text-[#CBD5E1]"
        >
          Full terms
        </Link>
      </p>
    </div>
  );
}
