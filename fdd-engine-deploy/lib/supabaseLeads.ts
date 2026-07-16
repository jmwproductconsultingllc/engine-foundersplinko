// lib/supabaseLeads.ts
//
// Lead persistence in Supabase (email-capture spec v2, D2). System of record +
// reporting surface — replaces the Vercel Blob store (which wrote emails to
// PUBLIC urls, a PII exposure). Writes happen server-side ONLY, with the
// service-role key, which bypasses RLS; the anon key can read nothing.
//
// Env (FoundersPlinko Supabase project — separate from Wattson):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (server-only; NEVER prefix NEXT_PUBLIC_)

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export interface LeadContext {
  brand_slug?: string | null;
  capital_entered?: number | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
  device?: string | null;
}

export interface InsertLeadResult {
  id: string; // uuid — also the emailed verify token
}

/**
 * Upsert a lead on (email, brand_slug) — the canonical write path from
 * plinko-leads.sql: one lead per person per brand; a re-submit refreshes the
 * context. Returns the row id (the emailed verify token).
 */
export async function insertLead(args: {
  email: string;
  context: LeadContext;
  disposable: boolean;
  email_sent: boolean;
}): Promise<InsertLeadResult> {
  const { data, error } = await getClient()
    .from("leads")
    .upsert({
      email: args.email,
      brand_slug: args.context.brand_slug ?? null,
      capital_entered: args.context.capital_entered ?? null,
      utm_source: args.context.utm_source ?? null,
      utm_medium: args.context.utm_medium ?? null,
      utm_campaign: args.context.utm_campaign ?? null,
      utm_content: args.context.utm_content ?? null,
      gclid: args.context.gclid ?? null,
      device: args.context.device ?? null,
      disposable: args.disposable,
      email_sent: args.email_sent,
    }, { onConflict: "email,brand_slug" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`insertLead failed: ${error?.message ?? "no row returned"}`);
  }
  return { id: data.id as string };
}

/**
 * Flip a lead to verified via the token (the row id) — the canonical verify
 * path from plinko-leads.sql: a direct service-role update. Idempotent (keeps
 * the first verified_at). Never throws; a bad token returns false.
 */
export async function verifyLead(token: string): Promise<boolean> {
  // cheap guard: must look like a uuid before we hit the DB
  if (!/^[0-9a-f-]{36}$/i.test(token)) return false;
  try {
    const { data, error } = await getClient()
      .from("leads")
      .update({ verified: true, verified_at: new Date().toISOString() })
      .eq("id", token)
      .eq("verified", false) // idempotent: already-verified rows untouched
      .select("id");
    if (error) {
      console.error("[leads] verify update error:", error.message);
      return false;
    }
    // 0 rows can mean already-verified — treat as success if the row exists
    if (data && data.length > 0) return true;
    const { data: existing } = await getClient()
      .from("leads").select("id").eq("id", token).limit(1);
    return Boolean(existing && existing.length > 0);
  } catch (err) {
    console.error("[leads] verify threw:", err);
    return false;
  }
}

// ── junk-filter helpers (spec §5) ──
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "throwawaymail.com", "yopmail.com", "trashmail.com", "getnada.com",
  "temp-mail.org", "fakeinbox.com", "sharklasers.com", "guerrillamailblock.com",
  "maildrop.cc", "dispostable.com", "mintemail.com", "mailnesia.com",
]);

export function isDisposable(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  return domain ? DISPOSABLE.has(domain) : false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}
