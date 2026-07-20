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

export type LeadSource = "brand_findings" | "playbook" | "capital_match";

export interface LeadContext {
  brand_slug?: string | null;
  capital_entered?: number | null;
  capital_edited?: boolean;
  lead_source?: LeadSource;
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
  // Ruling #2 (spec r2): conflict semantics live in the upsert_lead RPC —
  // attribution fill-forward (never overwrite non-null), lead_source first-
  // value-wins, capital updates only when capital_edited. The route cannot
  // get it wrong.
  const { data, error } = await getClient().rpc("upsert_lead", {
    p_email: args.email,
    p_brand_slug: args.context.brand_slug ?? null,
    p_capital_entered: args.context.capital_entered ?? null,
    p_capital_edited: args.context.capital_edited ?? false,
    p_utm_source: args.context.utm_source ?? null,
    p_utm_medium: args.context.utm_medium ?? null,
    p_utm_campaign: args.context.utm_campaign ?? null,
    p_utm_content: args.context.utm_content ?? null,
    p_gclid: args.context.gclid ?? null,
    p_device: args.context.device ?? null,
    p_disposable: args.disposable,
    p_lead_source: args.context.lead_source ?? "brand_findings",
  });

  if (error || !data) {
    throw new Error(`insertLead failed: ${error?.message ?? "no id returned"}`);
  }
  return { id: data as string };
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

/**
 * Enrich an existing lead (S4 progressive profile). Id-keyed — no email in the
 * payload. Phone stored ONLY when consent === true (TCPA), consent timestamp
 * set server-side. Bare 10-digit numbers get a hardcoded +1 (US assumption,
 * ruling #6b); entries already carrying +CC pass through.
 */
export async function enrichLead(args: {
  id: string;
  first_name?: string | null;
  phone?: string | null;
  phone_consent?: boolean;
}): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(args.id)) return false;
  const patch: Record<string, unknown> = { enriched_at: new Date().toISOString() };
  if (typeof args.first_name === "string" && args.first_name.trim()) {
    patch.first_name = args.first_name.trim().slice(0, 60);
  }
  if (args.phone && args.phone_consent === true) {
    const digits = args.phone.replace(/[^\d+]/g, "");
    const e164 = digits.startsWith("+") ? digits.slice(0, 16) : `+1${digits.slice(-10)}`;
    if (/^\+\d{11,15}$/.test(e164)) {
      patch.phone = e164;
      patch.phone_consent = true;
      patch.phone_consent_at = new Date().toISOString();
    }
  }
  if (Object.keys(patch).length === 1) return false; // nothing to write
  try {
    const { data, error } = await getClient()
      .from("leads").update(patch).eq("id", args.id).select("id");
    if (error) { console.error("[leads] enrich error:", error.message); return false; }
    return Boolean(data && data.length > 0);
  } catch (e) { console.error("[leads] enrich threw:", e); return false; }
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
