// fdd-engine-deploy/app/api/stripe-webhook/route.ts
//
// Stripe webhook — the source of truth for "paid". On checkout.session.completed
// it reads reportId from the session metadata, flips that report to paid, and
// emails the buyer their report link.
//
// CRITICAL: signature verification needs the RAW request body. In the App Router
// req.text() gives exactly that (the body is not auto-parsed), so we must NOT
// JSON.parse it first. The webhook signing secret comes from registering this
// endpoint in the Stripe dashboard (STRIPE_WEBHOOK_SECRET).

import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { markPaid, loadReport } from "@/lib/reports";
import { sendReportEmail } from "@/lib/email";

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

    if (!reportId) {
      console.warn("[stripe-webhook] completed session missing reportId metadata");
    } else {
      const record = await loadReport(reportId);

      if (!record) {
        console.warn("[stripe-webhook] no report found for:", reportId);
      } else if (record.paid) {
        // Already processed on an earlier delivery of this event. markPaid is
        // idempotent, but the EMAIL is not — so gate on the prior paid state to
        // avoid emailing the buyer twice if Stripe re-delivers.
        console.log("[stripe-webhook] already paid, skipping email:", reportId);
      } else {
        await markPaid(reportId);
        console.log("[stripe-webhook] marked paid:", reportId);

        // Deliver by email. A failed send NEVER 500s the webhook: payment is
        // already recorded and the buyer has instant unlock on return, so a
        // bad send is logged loudly for manual resend rather than retried
        // (which would risk a double-charge-shaped retry loop on Stripe's side).
        const to =
          session.customer_details?.email ?? session.customer_email ?? null;

        if (!to) {
          console.warn("[stripe-webhook] no buyer email on session:", reportId);
        } else {
          const reportUrl = reportUrlFor(session, reportId);
          const ok = await sendReportEmail({
            to,
            reportUrl,
            brandName: record.result?.brandName ?? null,
          });
          console.log(
            `[stripe-webhook] report email ${ok ? "sent" : "FAILED"} -> ${to} (${reportId})`,
          );
        }
      }
    }
  }

  // Always 200 on a verified event so Stripe doesn't keep retrying.
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// The report's permanent link. The success_url we set in the checkout route is
// `${origin}/report/${id}?session_id=...`, so its origin is the exact host the
// buyer used — reuse it. Fall back to APP_BASE_URL, then the canonical host.
function reportUrlFor(session: Stripe.Checkout.Session, reportId: string): string {
  const su = session.success_url;
  if (su) {
    try {
      return `${new URL(su).origin}/report/${reportId}`;
    } catch {
      /* malformed — fall through to env/canonical */
    }
  }
  const base = process.env.APP_BASE_URL || "https://engine.foundersplinko.com";
  return `${base}/report/${reportId}`;
}
