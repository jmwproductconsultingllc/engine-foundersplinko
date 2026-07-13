// lib/utm.ts — read the first-touch UTM cookie server-side (P0-1)
import type { NextRequest } from "next/server";

export interface Utm {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export function readUtm(req: NextRequest): Utm {
  const raw = req.cookies.get("fe_utm")?.value;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    const out: Utm = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const) {
      if (typeof parsed[k] === "string") out[k] = (parsed[k] as string).slice(0, 100);
    }
    return out;
  } catch {
    return {};
  }
}
