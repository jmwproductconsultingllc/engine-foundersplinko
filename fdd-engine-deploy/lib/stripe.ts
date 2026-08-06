// fdd-engine-deploy/lib/stripe.ts
//
// Shared Stripe client. Lazy so a missing key throws at request time (a clear
// error in the route) rather than at module load — which would risk failing the
// Vercel build if the env var weren't present at build time.

import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  // No apiVersion pin — uses the account's default. Pin later if you want
  // version stability across Stripe SDK upgrades.
  _stripe = new Stripe(key);
  return _stripe;
}

/**
 * Verify a completed Checkout session was settled AND belongs to this report.
 * Used for immediate unlock on return from Stripe, independent of the Blob paid
 * flag (which lags ~1 min behind on the CDN after the webhook flips it).
 * The reportId match prevents unlocking report A with report B's session id.
 *
 * Why this is not `payment_status === "paid"`:
 * a 100%-off promotion code drives the session total to $0. Stripe collects no
 * payment, so payment_status comes back "no_payment_required" — not "paid" —
 * and a strict equality check would let checkout complete while leaving the
 * report locked. The test below is written to not depend on that exact enum
 * value: the session must be terminally complete, and must not be sitting in
 * the one state that means money is genuinely owed ("unpaid"). Anything else
 * Stripe considers settled unlocks.
 */
export async function isSessionPaidFor(
  sessionId: string,
  reportId: string,
): Promise<boolean> {
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.reportId !== reportId) return false;
    if (session.status !== "complete") return false;
    return session.payment_status !== "unpaid";
  } catch {
    return false;
  }
}
