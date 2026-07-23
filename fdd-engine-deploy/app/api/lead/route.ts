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
// P0 (2026-07-18): attribution is read SERVER-SIDE from the fe_utm cookie via
// readUtm(req) — the exact function /api/checkout uses for Stripe metadata, so a
// lead's first-touch attribution matches its eventual purchase attribution.
// The previous client-side cookie read decoded once against a double-encoded
// cookie value, so JSON.parse threw and every utm_*/gclid landed NULL. Anything
// the client sends is now only a fallback; the server value wins.
//
// Capture v2 (2026-07-19 spec r2): body gains lead_source ("brand_findings" |
// "playbook" | "capital_match") + capital_edited; response gains { id } for the
// S4 enrich PATCH. Fulfillment branches on lead_source — findings (shopper),
// playbook (dreamer), capital-match (S3 list) — routes never cross-deliver.
// Upsert semantics (ruling #2) live in the upsert_lead RPC.
//
// The lead row id is the verify token: the brand page detects ?lead=<id> and
// POSTs it to /api/lead/verify, flipping verified=true (the click IS the
// verification).

import { NextRequest, NextResponse } from "next/server";
import {
  insertLead,
  claimEmailSend,
  releaseEmailSend,
  isValidEmail,
  isDisposable,
  type LeadContext,
} from "@/lib/supabaseLeads";
import { sendFindingsEmail, sendPlaybookEmail, sendCapitalMatchEmail } from "@/lib/leadEmail";
import { getBrand, toCard } from "@/lib/brands";
import { readUtm } from "@/lib/utm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: {
    email?: string;
    slug?: string;
    honeypot?: string;
    lead_source?: "brand_findings" | "playbook" | "capital_match";
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

  // ── P0: first-touch attribution, server-side ──────────────────────────────
  // readUtm() gets one decode from NextRequest cookie parsing plus its own
  // decodeURIComponent, which is why the server path resolves a double-encoded
  // cookie correctly and document.cookie did not.
  //
  // IMPORTANT: whitelist the five columns that exist in public.leads. readUtm
  // also returns utm_term / landed / ts, and passing those to Supabase would
  // fail the insert with "column does not exist".
  const ft = readUtm(req);
  const attribution = {
    utm_source: ft.utm_source ?? ctx.utm_source ?? null,
    utm_medium: ft.utm_medium ?? ctx.utm_medium ?? null,
    utm_campaign: ft.utm_campaign ?? ctx.utm_campaign ?? null,
    utm_content: ft.utm_content ?? ctx.utm_content ?? null,
    gclid: ft.gclid ?? ctx.gclid ?? null,
  };
  // Visible in Vercel runtime logs — the acceptance check without a debug route.
  console.log("[lead] attribution", {
    slug,
    server: Object.keys(ft).length > 0,
    utm_campaign: attribution.utm_campaign,
    gclid: attribution.gclid ? "present" : null,
  });

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
          capital_edited: ctx.capital_edited === true,
          lead_source: body.lead_source ?? "brand_findings",
          ...attribution,
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
  let deduped = false;
  const source = body.lead_source ?? "brand_findings";
  if (!disposable) {
    // IDEMPOTENCY: atomically claim the fulfillment. insertLead upserts on
    // (email, brand_slug), so a duplicate submit (the multi-surface double-
    // submit bug) returns the SAME leadId — and loses this claim because
    // email_sent is already true. A lost claim sends ZERO additional emails and
    // fires no second lead_email_sent. Only the winner dispatches.
    const claimed = await claimEmailSend(leadId);
    if (!claimed) {
      deduped = true;
      console.log("[lead] duplicate submit — fulfillment already claimed:", leadId.slice(0, 8));
    } else {
      if (source === "playbook") {
        sent = await sendPlaybookEmail({ to: email, leadId });
      } else if (source === "capital_match" && ctx.capital_edited === true && ctx.capital_entered) {
        sent = await sendCapitalMatchEmail({ to: email, capital: ctx.capital_entered, leadId, origin });
      } else {
        sent = await sendFindingsEmail({ to: email, brand, brandName, teaserUrl });
      }
      // Send failed → release the claim so a real retry can re-send.
      if (!sent) await releaseEmailSend(leadId);
    }
  }

  return NextResponse.json({ ok: true, sent, id: leadId, deduped });
}
