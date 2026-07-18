// middleware.ts (repo root) — first-touch attribution capture.
// Any request carrying utm_* or gclid gets them written to a `fe_utm` cookie
// (30 days, FIRST-touch: an existing cookie is never overwritten, so the
// campaign that actually acquired the buyer keeps attribution even if they
// return by another path). /api/checkout reads it into Stripe session metadata;
// /api/lead reads it onto the Supabase lead row.
//
// 2026-07-18: added `gclid` to KEYS. This matters twice over — it captures the
// Google Ads click id, AND it makes an auto-tagged click (gclid with no utm_*
// params, which is Google's default) set the cookie at all. Previously those
// landings matched nothing here and were attributed as direct traffic.

import { NextRequest, NextResponse } from "next/server";

const KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
] as const;

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hasAttribution = KEYS.some((k) => url.searchParams.has(k));
  const res = NextResponse.next();

  if (hasAttribution && !req.cookies.has("fe_utm")) {
    const utm: Record<string, string> = {};
    for (const k of KEYS) {
      const v = url.searchParams.get(k);
      if (v) utm[k] = v.slice(0, 100);
    }
    res.cookies.set("fe_utm", encodeURIComponent(JSON.stringify(utm)), {
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
    });
  }
  return res;
}

export const config = {
  // skip static assets & API (API reads the cookie, it doesn't need to set it)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
