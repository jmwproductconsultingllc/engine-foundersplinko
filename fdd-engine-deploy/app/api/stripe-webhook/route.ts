// fdd-engine-deploy/app/api/stripe-webhook/route.ts
//
// Stripe webhook — the source of truth for "paid". On checkout.session.completed
// it reads reportId from the session metadata and flips that report to paid.
//
// CRITICAL: signature verification needs the RAW request body. In the App Router
// req.text() gives exactly that (the body is not auto-parsed), so we must NOT
// JSON.parse it first. The webhook signing secret comes from registering this
// endpoint in the Stripe dashboard (STRIPE_WEBHOOK_SECRET).

import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { markPaid } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text(); // RAW body — required for signature verification
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return new Response("Missing signature or webhook secret.", { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[stripe-webhook] signature verification failed:", msg);
    return new Response(`Webhook Error: ${msg}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const reportId = session.metadata?.reportId;
    if (reportId) {
      await markPaid(reportId); // idempotent — safe if Stripe retries the event
      console.log("[stripe-webhook] marked paid:", reportId);
    } else {
      console.warn("[stripe-webhook] completed session missing reportId metadata");
    }
  }

  // Always 200 on a verified event so Stripe doesn't keep retrying.
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
