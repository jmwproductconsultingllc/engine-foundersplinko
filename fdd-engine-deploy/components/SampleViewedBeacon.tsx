"use client";

// components/SampleViewedBeacon.tsx
//
// Fires `sample_report_viewed` once per page view on /sample.
//
// Why this exists separately from `sample_report_clicked`: the click event only
// fires for people who came off the home-page button. Once /sample is a real
// URL it also gets reached from email, from a partner link, from the sample
// page in the sitemap, and from /playbook — all of which would be invisible in
// the funnel without a view event. `entry` separates those populations.
//
// Unlike TeaserViewedBeacon this fires on mount, not on intersection: the whole
// point of /sample is that landing on it IS the event. A ref guard keeps React
// StrictMode's double-effect from double-counting.

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";

export default function SampleViewedBeacon() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const device =
      typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent)
        ? "mobile"
        : "desktop";

    // Same-origin referrer = they clicked through from our own page (home,
    // /playbook). Anything else — or nothing — is an external/direct arrival.
    let entry = "direct";
    try {
      const ref = document.referrer;
      if (ref) {
        const u = new URL(ref);
        entry = u.origin === window.location.origin ? `internal:${u.pathname}` : "external";
      }
    } catch {
      /* referrer unparseable — leave as direct */
    }

    track("sample_report_viewed", { device, entry });
  }, []);

  return null;
}
