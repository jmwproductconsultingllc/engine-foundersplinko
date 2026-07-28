"use client";

// components/SampleStickyBar.tsx
//
// The same persistent bottom bar the brand pages carry (BrandDetail §8), ported
// to /sample. Reason it's here: someone who scrolls a full diligence report end
// to end is the highest-intent reader on the site, and until now the only buy
// affordance on this page sat in the banner at the TOP — where conviction is at
// its lowest. The bar keeps the ask in reach the whole way down.
//
// One difference from the brand-page bar, and it matters: there is nothing to
// "Unlock" here. Verde Bowls is fictional, so there is no checkout to mint — the
// conversion action is to go run the engine on a REAL FDD. The bar therefore
// routes to the upload flow, not to Stripe. Promising "Unlock" and landing them
// on an upload form would be a bait-and-switch on the hottest lead we have.
//
// Self-contained: it renders its own sentinel where it is placed in the tree, so
// the page shell stays a server component and no ref has to be threaded across
// the boundary.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";

const PRICE_LABEL = "$199";

export default function SampleStickyBar() {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    // No IO (old browser / jsdom): show the bar rather than silently losing the
    // CTA. A visible bar is the safe failure mode here.
    if (!el || typeof IntersectionObserver === "undefined") {
      setOn(true);
      return;
    }
    const obs = new IntersectionObserver(([e]) => setOn(!e.isIntersecting), { threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px w-full" />
      <div
        className={`fixed inset-x-0 bottom-0 z-50 border-t border-[#3A496A] bg-[#0B1220]/95 backdrop-blur transition-transform duration-200 ${
          on ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-hidden={!on}
      >
        <div className="mx-auto flex max-w-[820px] items-center gap-3 px-4 py-2.5">
          <div className="text-[13px] text-[#CBD5E1]">
            <b className="text-[15px] text-[#F1F5F9]">{PRICE_LABEL}</b> · this report, on your brand
          </div>
          <Link
            href="/"
            onClick={() => track("cta_clicked", { cta_id: "sample_sticky_run", section: "sample" })}
            className="ml-auto rounded-lg bg-[#34D399] px-5 py-2.5 text-[14px] font-extrabold text-[#0B1220] hover:brightness-110"
          >
            Run my FDD
          </Link>
        </div>
      </div>
    </>
  );
}
