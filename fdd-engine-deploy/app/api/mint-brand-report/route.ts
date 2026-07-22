// app/api/mint-brand-report/route.ts
//
// THE payment decision, implemented (brief §payment): a brand page must never
// send buyers to checkout with a shared reportId — markPaid on one record would
// unlock the brand for everyone. This route mints a FRESH per-buyer report from
// the brand's canonical template, then creates the Stripe Checkout session
// DIRECTLY and 303s the buyer to Stripe.
//
// P0 FIX (2026-07-21): this route used to 303 to /api/checkout?reportId=<new>,
// which re-read the just-minted report from Vercel Blob via list(). Blob's list
// index lags a put() by ~1-2s, so that re-read intermittently returned null and
// checkout bounced the buyer home — a real cold user (Jersey Mike's, replay
// 019f873e) clicked Unlock twice and never reached Stripe. Stripe only needs the
// reportId, so we now create the session here in the same request (no re-read,
// no cross-route Blob race). The report is read later — on the success return
// and by the webhook — by which time the blob has long propagated.
//
// Attribution (brief reconciliation #3): the `ref` query param (?ref=mallory,
// ?ref=seo, …) is persisted onto the buyer's record at mint time, so
// cold-vs-Related-Party revenue tagging is a field the Stripe webhook can read.
//
// GET so the "Unlock $199" button is a plain link. Next.js does not prefetch API
// routes, so no spurious mints.
//   /api/mint-brand-report?slug=i9-sports&ref=mallory[&email=…]

import { NextRequest, NextResponse } from "next/server";
import { getBrand } from "@/lib/brands";
import { saveReport } from "@/lib/reports";
import { createCheckoutUrl } from "@/lib/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ref is analytics-grade data that ends up on a stored record — sanitize to a
// short slug so nobody can stuff arbitrary strings into the store via the URL.
function cleanRef(v: string | null): string | null {
  if (!v) return null;
  const s = v.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  return s || null;
}

function cleanEmail(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const slug = url.searchParams.get("slug");
  const ref = cleanRef(url.searchParams.get("ref"));
  const email = cleanEmail(url.searchParams.get("email"));

  if (!slug) return NextResponse.redirect(`${origin}/brands`, 303);

  const brand = await getBrand(slug);
  if (!brand || brand.grade !== "READY") {
    // Unknown slug or a THIN/ghost brand that has no sellable report yet.
    return NextResponse.redirect(`${origin}/brands`, 303);
  }

  // Fresh per-buyer record from the immutable canonical template. fileHash is a
  // synthetic brand marker (no buyer upload to hash) — unique per mint so
  // hash-based dedup analytics never collide two buyers.
  const { readUtm } = await import("@/lib/utm");
  const utm = readUtm(req);
  let reportId: string;
  try {
    reportId = await saveReport(brand.result, `brand:${slug}:${Date.now()}`, {
      email,
      ref,
      brandSlug: slug,
      utm: Object.keys(utm).length ? (utm as Record<string, string>) : null,
    });
  } catch (err) {
    console.error("[mint] saveReport failed:", err);
    return NextResponse.redirect(`${origin}/franchise/${slug}`, 303);
  }

  // Create the Stripe session HERE with the reportId in memory — no Blob re-read.
  try {
    const checkoutUrl = await createCheckoutUrl(reportId, origin, req);
    if (checkoutUrl) return NextResponse.redirect(checkoutUrl, 303);
    console.error("[mint] Stripe returned no session url for", reportId);
  } catch (err) {
    console.error("[mint] createCheckoutUrl threw for", reportId, err);
  }
  // Fallback: the report exists and is persisted — send the buyer to it so they
  // can retry Unlock from the report page rather than dead-ending.
  return NextResponse.redirect(`${origin}/report/${reportId}`, 303);
}
