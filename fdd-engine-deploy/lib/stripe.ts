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
