// app/api/lead/enrich/route.ts — Capture v2 S4 (progressive profile).
// POST { id, first_name?, phone?, phone_consent? }
// Id-keyed PATCH onto the existing lead row — no email in the payload. Phone is
// stored ONLY with explicit consent (checkbox); consent timestamp set server-
// side. Server-side length/format caps like utm. Soft per-instance throttle
// (serverless best-effort; possession of a valid lead id is the real gate).

import { NextRequest, NextResponse } from "next/server";
import { enrichLead } from "@/lib/supabaseLeads";

export const runtime = "nodejs";

// Best-effort per-instance throttle. Possession of a valid lead id is the real
// gate; this only stops a script hammering one id.
//
// 2026-08-04 — TWO DEFECTS FIXED HERE, AND THEY COMPOUNDED.
//
// (1) THE WINDOW ROLLED. `seen.set(id, now)` ran BEFORE the comparison, so a
//     REJECTED call pushed the window forward. Anyone clicking faster than once
//     every 2s was in a lockout that only cleared by giving up: click at 1.5s ->
//     429 and the clock resets; click at 3.0s -> 429 again, because the clock
//     now says 1.5s. Measured in lib/captureButtons.test.ts. A THROTTLE THAT
//     RESETS ON THE REJECT IS A LOCKOUT, NOT A THROTTLE.
//
// (2) THE WINDOW WAS SIZED FOR ONE BUTTON AND THIS FORM HAS THREE. S4 is a
//     name field, a phone field and a broker field, each with its own Save,
//     filled top to bottom in one sitting. Two seconds between "Save the name"
//     and "Save the broker" is not abuse, it is a person typing. 400ms still
//     stops a hammering script and is below the floor of deliberate human
//     re-click. THE THROTTLE MUST BE SHORTER THAN THE GAP BETWEEN TWO FIELDS A
//     HUMAN FILLS IN SEQUENCE.
const THROTTLE_MS = 400;
const seen = new Map<string, number>();
function throttled(id: string): boolean {
  const now = Date.now();
  const last = seen.get(id) ?? 0;
  if (now - last < THROTTLE_MS) return true; // reject WITHOUT extending
  seen.set(id, now);
  if (seen.size > 500) seen.clear();
  return false;
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
