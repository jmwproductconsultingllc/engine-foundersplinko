// middleware.ts (repo root) — P0-1: first-touch UTM capture.
// Any request carrying utm_* params gets them written to a `fe_utm` cookie
// (30 days, FIRST-touch: an existing cookie is never overwritten, so the
// campaign that actually acquired the buyer keeps attribution even if they
// return via a different path). Checkout reads this cookie into Stripe
// session metadata; the mint route persists it onto the report record.

import { NextRequest, NextResponse } from "next/server";

const KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hasUtm = KEYS.some((k) => url.searchParams.has(k));
  const res = NextResponse.next();

  if (hasUtm && !req.cookies.has("fe_utm")) {
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
  // skip static assets & API (API reads the cookie, doesn't need to set it)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
