// lib/utm.ts — first-touch attribution, read server-side from the fe_utm cookie.
// Single source of truth for BOTH /api/checkout (Stripe metadata) and /api/lead
// (Supabase lead rows), so a lead's attribution matches its eventual purchase.
//
// 2026-07-18: added `gclid`. Google Ads auto-tagging appends ONLY gclid to the
// landing URL — no utm_* params — so without this key an auto-tagged paid click
// produced no cookie at all and therefore no attribution anywhere.

import type { NextRequest } from "next/server";

const KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
] as const;

export interface Utm {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  /** Google Ads click id — the match key for conversion import */
  gclid?: string;
}

export function readUtm(req: NextRequest): Utm {
  const raw = req.cookies.get("fe_utm")?.value;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    const out: Utm = {};
    for (const k of KEYS) {
      if (typeof parsed[k] === "string") out[k] = (parsed[k] as string).slice(0, 100);
    }
    return out;
  } catch {
    return {};
  }
}
