// fdd-engine-deploy/app/api/checkout/route.ts
//
// Creates a Stripe Checkout session for an EXISTING report and redirects to it.
// GET so it's testable by direct navigation and so ReportView's Unlock can be a
// plain link. The brand-page path does NOT come through here anymore — it mints
// + creates the session in /api/mint-brand-report directly (P0 fix: avoids a
// Blob read-after-write race on the just-minted report). This route serves the
// already-persisted report case (ReportView unlock), where loadReport is
// race-free because the blob has long existed.
//
// reportId rides in session.metadata; the webhook reads it back to flip paid,
// and the success return carries the session id for verification.

import { NextRequest, NextResponse } from "next/server";
import { loadReport } from "@/lib/reports";
import { createCheckoutUrl } from "@/lib/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    const checkoutUrl = await createCheckoutUrl(reportId, origin, req);
    if (checkoutUrl) return NextResponse.redirect(checkoutUrl, 303);
    console.error("[checkout] Stripe returned no session url for", reportId);
  } catch (err) {
    console.error("[checkout] createCheckoutUrl threw for", reportId, err);
  }
  return NextResponse.redirect(`${origin}/report/${reportId}`, 303);
}
