"use client";

// components/TeaserViewedBeacon.tsx — spec §12a.
// Fires `teaser_viewed` exactly once, when the teaser actually scrolls into
// view (not on route mount — that would count bounces who never saw it). An
// IntersectionObserver + a ref guard prevents double-firing on re-render or
// back-nav. This is the funnel's MIDDLE: without it, brand-page visitors fire
// upgrade_clicked with no preceding teaser_viewed and the funnel shows a false
// ~100% drop at the teaser step.
//
// Rendered as an invisible sentinel wrapping (or just above) the teaser block.

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";

export default function TeaserViewedBeacon({
  brandSlug,
  reportId,
}: {
  brandSlug: string;
  reportId?: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || fired.current) return;

    const device =
      typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent)
        ? "mobile"
        : "desktop";

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !fired.current) {
            fired.current = true;
            track("teaser_viewed", {
              brandSlug,
              $device_type: device,
              reportId: reportId ?? null,
            });
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 }, // ~half the teaser visible = genuinely seen
    );
    io.observe(el);
    return () => io.disconnect();
  }, [brandSlug, reportId]);

  return <div ref={ref} aria-hidden="true" style={{ height: 1 }} />;
}
