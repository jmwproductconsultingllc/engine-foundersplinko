// fdd-engine-deploy/lib/checkout.ts
//
// Shared Stripe-checkout-session creation for the two entry points:
//   • /api/mint-brand-report — brand-page Unlock (mints a fresh report, then
//     creates the session HERE with the just-minted reportId in memory. It does
//     NOT re-read the report from Blob first — that read-after-write race
//     (put → list) was the P0: Blob's list index lags a put by a second or two,
//     so the old checkout re-read intermittently returned null and bounced the
//     buyer away before Stripe. Stripe only needs the reportId, so we skip the
//     re-read entirely on the revenue path.)
//   • /api/checkout — an EXISTING report's Unlock (ReportView). That report has
//     long been persisted, so its loadReport is race-free; checkout keeps the
//     load for the paid-check + existence guard, then calls this.
//
// PRICE_CENTS: single launch price. Per the 2026-06-30 wiring, PRICE_CENTS is
// intentionally UNSET in Vercel (fallback 19900) — do not reintroduce it as an
// env var without meaning to change the live price.

import type { NextRequest } from "next/server";
import { readUtm } from "@/lib/utm";
import { getStripe } from "@/lib/stripe";

export const PRICE_CENTS = Number(process.env.PRICE_CENTS) || 19900; // $199.00

/**
 * Create a Stripe Checkout session for a report and return its hosted URL.
 * Returns null only if Stripe returns a session without a url (rare). Throws if
 * Stripe itself errors (missing key, API failure) — the caller decides the
 * fallback destination. reportId rides in metadata; the webhook reads it back to
 * flip paid, and success_url carries the session id for immediate verification.
 */
export async function createCheckoutUrl(
  reportId: string,
  origin: string,
  req: NextRequest,
): Promise<string | null> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "Franchise Edge — Full Diligence Report" },
          unit_amount: PRICE_CENTS,
        },
        quantity: 1,
      },
    ],
    // First-touch UTM from the middleware cookie → Stripe metadata, so every
    // purchase carries its acquisition source (ads acceptance test).
    metadata: { reportId, ...readUtm(req) },
    success_url: `${origin}/report/${reportId}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/report/${reportId}`,
  });
  return session.url ?? null;
}
