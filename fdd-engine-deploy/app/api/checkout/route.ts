// fdd-engine-deploy/app/api/checkout/route.ts
//
// Creates a Stripe Checkout session for a given report and redirects to it.
// GET so it's testable by direct navigation (/api/checkout?reportId=<id>) before
// the teaser button is wired in part B — and so the button can be a plain link.
//
// The reportId rides in session.metadata; the webhook reads it back to flip the
// report to paid, and the success return carries the session id for verification.

import { NextRequest, NextResponse } from "next/server";
import { readUtm } from "@/lib/utm";
import { getStripe } from "@/lib/stripe";
import { loadReport } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single launch price. The A/B ($149 vs $199) is a later step (#2) — start with
// one price to get money flowing. Override with the PRICE_CENTS env var.
const PRICE_CENTS = Number(process.env.PRICE_CENTS) || 19900; // $199.00

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const reportId = url.searchParams.get("reportId");

  if (!reportId) {
    return NextResponse.redirect(`${origin}/`, 303);
  }

  const record = await loadReport(reportId);
  if (!record) {
    // Unknown or expired report — send home rather than charge for nothing.
    return NextResponse.redirect(`${origin}/`, 303);
  }
  if (record.paid) {
    // Already paid — no second charge; just open the report.
    return NextResponse.redirect(`${origin}/report/${reportId}`, 303);
  }

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
    // P0-1: first-touch UTM from the middleware cookie -> Stripe metadata, so
    // every purchase carries its acquisition source (ads acceptance test).
    metadata: { reportId, ...readUtm(req) },
    success_url: `${origin}/report/${reportId}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/report/${reportId}`,
  });

  if (!session.url) {
    return NextResponse.redirect(`${origin}/report/${reportId}`, 303);
  }
  return NextResponse.redirect(session.url, 303);
}
