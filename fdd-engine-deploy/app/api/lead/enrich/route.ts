// app/api/lead/enrich/route.ts — Capture v2 S4 (progressive profile).
// POST { id, first_name?, phone?, phone_consent? }
// Id-keyed PATCH onto the existing lead row — no email in the payload. Phone is
// stored ONLY with explicit consent (checkbox); consent timestamp set server-
// side. Server-side length/format caps like utm. Soft per-instance throttle
// (serverless best-effort; possession of a valid lead id is the real gate).

import { NextRequest, NextResponse } from "next/server";
import { enrichLead } from "@/lib/supabaseLeads";

export const runtime = "nodejs";

const seen = new Map<string, number>(); // best-effort per-instance throttle
function throttled(id: string): boolean {
  const now = Date.now();
  const last = seen.get(id) ?? 0;
  seen.set(id, now);
  if (seen.size > 500) seen.clear();
  return now - last < 2000;
}

export async function POST(req: NextRequest) {
  let body: {
    id?: string;
    first_name?: string;
    phone?: string;
    phone_consent?: boolean;
    broker_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const id = (body.id || "").trim();
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  if (throttled(id)) return NextResponse.json({ ok: false, error: "slow_down" }, { status: 429 });

  const ok = await enrichLead({
    id,
    first_name: body.first_name ?? null,
    phone: body.phone ?? null,
    phone_consent: body.phone_consent === true,
    broker_name: body.broker_name ?? null,
  });
  console.log("[lead] enrich", {
    id: id.slice(0, 8),
    ok,
    fields:
      [body.first_name && "name", body.phone && "phone", body.broker_name && "broker"]
        .filter(Boolean)
        .join("+") || "none",
  });
  return NextResponse.json({ ok });
}
