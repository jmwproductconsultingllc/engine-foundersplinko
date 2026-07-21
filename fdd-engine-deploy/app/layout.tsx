import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import AdsConversion from "@/components/AdsConversion";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

// Display face for headlines and the big capital figure. Exposed as a CSS
// variable; every component that uses it falls back to the system stack, so the
// app renders correctly even if this file isn't deployed.
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

// PostHog loads via the official snippet below (no npm dependency). It stays
// completely inert until NEXT_PUBLIC_POSTHOG_KEY is set in Vercel, so this is
// safe to deploy before the project key exists. Host defaults to US cloud.
// Google tags (P0-2 / spec Fix 3). One gtag.js load configures both:
//  - Ads account tag (AW-…): live conversion tracking — defaults to the account
//    tag from the Jul-14 spec, override via NEXT_PUBLIC_ADS_TAG_ID
//  - GA4 property (G-…): optional analytics depth, inert until env is set
const ADS_ID = process.env.NEXT_PUBLIC_ADS_TAG_ID || "AW-18323298547";
const GA4_ID = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
const TAG_IDS = [ADS_ID, GA4_ID].filter(Boolean) as string[];

const PH_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const PH_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

const POSTHOG_SNIPPET = `
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('${PH_KEY}',{api_host:'${PH_HOST}',person_profiles:'always',defaults:'2025-05-24'});
`;

export const metadata: Metadata = {
  title: "Franchise Edge — FDD Diligence",
  description: "Turn a 300-page FDD into a clear, scored diligence read — measured against your own capital.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={display.variable}>
      <body className="antialiased">
        <AdsConversion />
        {children}
        {PH_KEY && (
          <Script
            id="posthog-init"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{ __html: POSTHOG_SNIPPET }}
          />
        )}
        {TAG_IDS.length > 0 && (
          <>
            <Script src={"https://www.googletagmanager.com/gtag/js?id=" + TAG_IDS[0]} strategy="afterInteractive" />
            <Script id="gtag-init" strategy="afterInteractive">
              {"window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); " +
                TAG_IDS.map((id) => "gtag('config', '" + id + "');").join(" ")}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
