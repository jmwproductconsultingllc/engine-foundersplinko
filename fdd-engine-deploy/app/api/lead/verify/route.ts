// app/api/lead/verify/route.ts  (spec v2)
//
// Verification beacon. The brand teaser page, on detecting ?lead=<token>,
// POSTs the token here. Flips the Supabase lead row verified=true via the
// verify_lead RPC (idempotent, service-role only). This is what separates hot
// (clicked) from cold (never clicked) leads — zero upfront-verification
// friction (spec §3).

import { NextRequest, NextResponse } from "next/server";
import { verifyLead } from "@/lib/supabaseLeads";

export const runtime = "nodejs";

async function handle(token: string | null) {
  if (!token) return NextResponse.json({ ok: false }, { status: 400 });
  const verified = await verifyLead(token);
  return NextResponse.json({ ok: true, verified });
}

export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({ token: null }));
  return handle(token ?? null);
}

export async function GET(req: NextRequest) {
  return handle(new URL(req.url).searchParams.get("token"));
}
