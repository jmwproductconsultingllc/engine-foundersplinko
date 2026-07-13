// lib/ga4.ts — P0-2 server-side purchase event (GA4 Measurement Protocol).
// Fired from the Stripe webhook after markPaid: the source of truth for the
// Google Ads conversion import (client gtag can be blocked; the webhook can't).
// Inert until GA4_API_SECRET + NEXT_PUBLIC_GA4_MEASUREMENT_ID are set.
//
// INTEGRATION (app/api/stripe-webhook/route.ts, after markPaid succeeds):
//   import { sendGa4Purchase } from "@/lib/ga4";
//   await sendGa4Purchase({
//     transactionId: reportId,
//     valueUsd: (session.amount_total ?? 19900) / 100,
//     clientId: session.metadata?.ga_client_id,   // optional
//     utm: {
//       source: session.metadata?.utm_source,
//       medium: session.metadata?.utm_medium,
//       campaign: session.metadata?.utm_campaign,
//     },
//   });
// Failures log and never throw — same discipline as sendReportEmail.

const MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
const API_SECRET = process.env.GA4_API_SECRET;

export async function sendGa4Purchase(opts: {
  transactionId: string;
  valueUsd: number;
  clientId?: string | null;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null };
}): Promise<void> {
  if (!MEASUREMENT_ID || !API_SECRET) return;
  try {
    const body = {
      client_id: opts.clientId || `srv.${opts.transactionId}`,
      events: [
        {
          name: "purchase",
          params: {
            transaction_id: opts.transactionId,
            value: opts.valueUsd,
            currency: "USD",
            items: [{ item_id: "diligence_report", item_name: "FDD Diligence Report", price: opts.valueUsd, quantity: 1 }],
            ...(opts.utm?.source ? { source: opts.utm.source } : {}),
            ...(opts.utm?.medium ? { medium: opts.utm.medium } : {}),
            ...(opts.utm?.campaign ? { campaign: opts.utm.campaign } : {}),
          },
        },
      ],
    };
    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    if (!res.ok) console.error("[ga4] purchase event failed:", res.status);
  } catch (err) {
    console.error("[ga4] purchase event error:", err);
  }
}
