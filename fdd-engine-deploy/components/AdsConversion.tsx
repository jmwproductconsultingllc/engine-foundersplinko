"use client";

// components/AdsConversion.tsx — Google Ads purchase conversion (spec Fix 3).
// Mounted ONCE in the root layout; self-arms only on the Stripe success return:
// pathname /report/<id> AND ?session_id=<cs_...> present. Fires
// gtag('event','conversion') against the Ads tag with a per-session dedupe
// guard (localStorage) so a success-page refresh never double-counts.
//
// Inert until NEXT_PUBLIC_ADS_CONVERSION_LABEL is set — that label comes from
// Ads → Goals → Conversions → New conversion action → Website → "use the
// Google tag" (the xxxx part of send_to: 'AW-.../xxxx').

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const ADS_TAG_ID = process.env.NEXT_PUBLIC_ADS_TAG_ID || "AW-18323298547";
const LABEL = process.env.NEXT_PUBLIC_ADS_CONVERSION_LABEL;
const VALUE = Number(process.env.NEXT_PUBLIC_PRICE_USD) || 199;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function Inner() {
  const pathname = usePathname();
  const params = useSearchParams();
  const sessionId = params.get("session_id");

  useEffect(() => {
    if (!LABEL || !sessionId || !pathname.startsWith("/report/")) return;
    if (typeof window.gtag !== "function") return;

    // dedupe: one conversion per Stripe session, refresh-proof (spec pitfall #2)
    const guardKey = `fe_conv_${sessionId}`;
    try {
      if (localStorage.getItem(guardKey)) return;
      localStorage.setItem(guardKey, "1");
    } catch {
      /* storage blocked → fire anyway; Ads also dedupes on transaction_id */
    }

    const reportId = pathname.split("/")[2] ?? sessionId;
    window.gtag("event", "conversion", {
      send_to: `${ADS_TAG_ID}/${LABEL}`,
      value: VALUE,
      currency: "USD",
      transaction_id: reportId,
    });
  }, [pathname, sessionId]);

  return null;
}

export default function AdsConversion() {
  // useSearchParams requires a Suspense boundary in the App Router
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
