// app/api/mint-brand-report/route.ts
//
// THE payment decision, implemented (brief §payment): a brand page must never
// send buyers to checkout with a shared reportId — markPaid on one record would
// unlock the brand for everyone. This route mints a FRESH per-buyer report from
// the brand's canonical template, then hands off to the EXISTING checkout →
// Stripe → webhook → /report/[reportId] pipeline unchanged.
//
// It is also where attribution physically lives (brief reconciliation #3): the
// `ref` query param (?ref=mallory, ?ref=seo, …) is persisted onto the buyer's
// record at mint time, so cold-vs-Related-Party revenue tagging is a field on
// the record the Stripe webhook can read — automatic and audit-ready — not a
// manual Stripe chore or a PostHog session inference.
//
// GET so the "Unlock $199" button is a plain link (same convention as
// /api/checkout). Next.js does not prefetch API routes, so no spurious mints.
//   /api/mint-brand-report?slug=i9-sports&ref=mallory[&email=…]

import { NextRequest, NextResponse } from "next/server";
import { getBrand } from "@/lib/brands";
import { saveReport } from "@/lib/reports";

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

  // Fresh per-buyer record from the immutable canonical template. fileHash is
  // a synthetic brand marker (there's no buyer upload to hash) — kept unique
  // per mint so hash-based dedup analytics never collide two buyers.
  const reportId = await saveReport(brand.result, `brand:${slug}:${Date.now()}`, {
    email,
    ref,
    brandSlug: slug,
  });

  return NextResponse.redirect(`${origin}/api/checkout?reportId=${reportId}`, 303);
}
