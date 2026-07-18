// middleware.ts (app root: fdd-engine-deploy/) — first-touch attribution capture.
// Any request carrying utm_* or gclid gets them written to a `fe_utm` cookie
// (30 days, FIRST-touch: a VALID existing cookie is never overwritten, so the
// campaign that actually acquired the buyer keeps attribution even if they
// return by another path). /api/checkout reads it into Stripe session metadata;
// /api/lead reads it onto the Supabase lead row.
//
// 2026-07-18: added `gclid` to KEYS. This matters twice over — it captures the
// Google Ads click id, AND it makes an auto-tagged click (gclid with no utm_*
// params, which is Google's default) set the cookie at all. Previously those
// landings matched nothing here and were attributed as direct traffic.
//
// 2026-07-18b: SELF-HEAL. First-touch now defers only to a cookie the server
// can actually parse. The old (pre-fix) middleware double-encoded the value, so
// every visitor from that era carries a 30-day cookie that readUtm() cannot
// read — and the old `!req.cookies.has()` guard treated that corrupt cookie as
// sacred, blocking the overwrite forever. Validity is judged with EXACTLY the
// same decode path readUtm() uses: if the reader can't parse it, it doesn't
// count as first-touch, and the next attributed visit replaces it.

import { NextRequest, NextResponse } from "next/server";

const KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
] as const;

/** True only if the existing fe_utm cookie parses the same way readUtm() will
 *  read it AND carries at least one value. Corrupt/legacy/empty cookies return
 *  false so they get replaced instead of protected. */
function hasValidUtmCookie(req: NextRequest): boolean {
  const raw = req.cookies.get("fe_utm")?.value;
  if (!raw) return false;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length > 0
    );
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hasAttribution = KEYS.some((k) => url.searchParams.has(k));
  const res = NextResponse.next();

  if (hasAttribution && !hasValidUtmCookie(req)) {
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
