// app/api/lead/route.ts  (spec v2 — D1 + D2)
//
// POST { email, slug, honeypot?, context? }
//   1. honeypot filled  → silently accept-and-drop (bot)
//   2. invalid format    → 400
//   3. disposable domain → flag disposable=true, store, do NOT send
//   4. write lead to SUPABASE (D2 — reportable Postgres, RLS on, service-role)
//   5. send the TEASER email (D1) whose CTA links to the BRAND TEASER page:
//        /franchise/<slug>?lead=<lead.id>
//      NO /report/<id> is minted anywhere in this path (D1 — nothing to leak).
//
// The lead row id is the verify token: the brand page detects ?lead=<id> and
// POSTs it to /api/lead/verify, flipping verified=true (the click IS the
// verification).

import { NextRequest, NextResponse } from "next/server";
import {
  insertLead,
  isValidEmail,
  isDisposable,
  type LeadContext,
} from "@/lib/supabaseLeads";
import { sendLeadTeaserEmail } from "@/lib/leadEmail";
import { getBrand, toCard } from "@/lib/brands";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: {
    email?: string;
    slug?: string;
    honeypot?: string;
    context?: LeadContext & { brandName?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  // honeypot: hidden field only a bot fills. Return success (no signal), store
  // nothing, send nothing.
  if (body.honeypot && body.honeypot.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const email = (body.email || "").trim().toLowerCase();
  const slug = (body.slug || "").trim();
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (!slug) {
    return NextResponse.json({ ok: false, error: "missing_slug" }, { status: 400 });
  }

  const brand = await getBrand(slug);
  if (!brand || brand.grade !== "READY") {
    return NextResponse.json({ ok: false, error: "unknown_brand" }, { status: 404 });
  }

  const disposable = isDisposable(email);
  const brandName = toCard(brand).brandName;

  const { brandName: _drop, ...ctx } = body.context ?? {};

  // Write the lead FIRST so we have the id (= verify token) for the email link.
  // If Supabase is misconfigured this throws → 500, and nothing is sent (better
  // than sending an email whose verify token was never stored).
  let leadId: string;
  try {
    leadId = (
      await insertLead({
        email,
        context: {
          brand_slug: slug,
          capital_entered: ctx.capital_entered ?? null,
          utm_source: ctx.utm_source ?? null,
          utm_medium: ctx.utm_medium ?? null,
          utm_campaign: ctx.utm_campaign ?? null,
          utm_content: ctx.utm_content ?? null,
          gclid: ctx.gclid ?? null,
          device: ctx.device ?? null,
        },
        disposable,
        email_sent: false,
      })
    ).id;
  } catch (err) {
    console.error("[lead] insert failed:", err);
    return NextResponse.json({ ok: false, error: "store_failed" }, { status: 500 });
  }

  // Teaser email → brand teaser page (D1). Never full report.
  const origin = new URL(req.url).origin;
  const teaserUrl = `${origin}/franchise/${slug}?lead=${leadId}`;

  let sent = false;
  if (!disposable) {
    sent = await sendLeadTeaserEmail({ to: email, brandName, teaserUrl });
    // best-effort: flip email_sent if it dispatched. A failed update is
    // non-fatal (the lead row already exists); log and move on.
    if (sent) {
      try {
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );
        await sb.from("leads").update({ email_sent: true }).eq("id", leadId);
      } catch (e) {
        console.error("[lead] email_sent update failed:", e);
      }
    }
  }

  return NextResponse.json({ ok: true, sent });
}
