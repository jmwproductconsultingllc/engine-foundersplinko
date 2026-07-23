// app/api/report/broker/route.ts — attach the buyer's broker/consultant to a
// report (optional enrichment from the analyzing wait or the teaser fallback).
// POST { reportId, broker_name }. Capture ONLY — the name is stored on the
// report record and NEVER transmitted to the named broker. Possession of the
// unguessable reportId is the gate; soft per-instance throttle on top.

import { NextRequest, NextResponse } from "next/server";
import { setReportBroker } from "@/lib/reports";

export const runtime = "nodejs";

const seen = new Map<string, number>();
function throttled(id: string): boolean {
  const now = Date.now();
  const last = seen.get(id) ?? 0;
  seen.set(id, now);
  if (seen.size > 500) seen.clear();
  return now - last < 2000;
}

export async function POST(req: NextRequest) {
  let body: { reportId?: string; broker_name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const reportId = (body.reportId || "").trim();
  const brokerName = (body.broker_name || "").trim();
  if (!reportId || !brokerName) return NextResponse.json({ ok: false }, { status: 400 });
  if (throttled(reportId)) return NextResponse.json({ ok: false, error: "slow_down" }, { status: 429 });

  const ok = await setReportBroker(reportId, brokerName);
  console.log("[report] broker", { id: reportId.slice(0, 8), ok });
  return NextResponse.json({ ok });
}
