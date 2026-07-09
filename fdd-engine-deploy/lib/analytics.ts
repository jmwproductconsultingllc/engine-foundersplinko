// Thin analytics layer over PostHog (loaded via the snippet in app/layout.tsx).
//
// Every call site uses these typed helpers instead of touching window.posthog
// directly, so if we later swap to the posthog-js SDK (or another tool), only
// this file changes. All calls no-op safely when PostHog hasn't loaded or when
// running on the server.

type PropValue = string | number | boolean | null | undefined;
type Props = Record<string, PropValue>;

/**
 * The full funnel taxonomy in one place.
 *
 * Events above the divider fire today (the free funnel: land → upload → report).
 * Events below are pre-named but dormant — payment, paywall, and the infographic
 * teaser (punch-list #2 / #3 / #5 / #6) will call them as they ship, so the
 * funnel stays coherent from the first dollar with no analytics refactor.
 */
export type AnalyticsEvent =
  // ── live now ──
  | "primer_opened" // novice opened the "what's an FDD" explainer  { source }
  | "fdd_lookup_clicked" // clicked through to the state registry
  | "sample_report_clicked" // clicked "See a sample report"
  | "file_selected" // picked or dropped a PDF                       { sizeMB }
  | "analyze_started" // hit "Run my diligence"                      { capital, fileSizeMB }
  | "analyze_succeeded" // report generated   { capital, durationMs, riskLevel, finconSeverity, proFormaBuilt }
  | "analyze_failed" // parse errored                                { message, network }
  // ── wired when monetization lands ──
  | "teaser_viewed" // infographic teaser shown (#3)
  | "paywall_viewed" // upgrade gate shown (#2)                      { priceVariant, price }
  | "upgrade_clicked" // clicked to pay (#2)                         { priceVariant, price }
  | "checkout_started" // Stripe checkout opened (#5)                { priceVariant, price }
  | "purchase_completed" // payment succeeded (#5/#6)                { priceVariant, price }
  | "report_unlocked" // full report accessed after payment (#6)
  // ── brand pages (feat/brand-pages: Path-A cold funnel + demand loop) ──
  | "brands_library_clicked" // home hero pill → /brands             { source }
  | "brand_card_clicked" // live card → /franchise/[slug]            { slug, risk, mo }
  | "brand_requested" // ghost card demand signal — "which FDD next" { brand, category }
  | "snapshot_email_submitted"; // detail-page email capture, pre-A2 { slug, ref }

interface PostHogLike {
  capture: (event: string, props?: Props) => void;
  identify: (id: string, props?: Props) => void;
}

function ph(): PostHogLike | null {
  if (typeof window === "undefined") return null;
  const p = (window as unknown as { posthog?: PostHogLike }).posthog;
  return p ?? null;
}

/** Capture a funnel event. Safe to call anywhere; no-ops if PostHog isn't loaded. */
export function track(event: AnalyticsEvent, props?: Props): void {
  ph()?.capture(event, props);
}

/** Associate the session with a person (use once we capture an email at checkout). */
export function identify(id: string, props?: Props): void {
  ph()?.identify(id, props);
}
