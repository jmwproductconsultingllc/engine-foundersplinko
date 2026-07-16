// app/api/lead/debug/route.ts  — TEMPORARY diagnostic. DELETE after use.
// Reads the ACTUAL runtime env the server holds and reports what role the
// SUPABASE_SERVICE_ROLE_KEY resolves to, plus which project SUPABASE_URL points
// at, plus a live probe insert so we see the raw Postgres error.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";

export async function GET() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  // What role does the key claim? Legacy JWT → decode payload.role.
  // New sb_secret_ keys aren't JWTs → will be "not-a-jwt".
  let keyKind = "MISSING";
  let role = "n/a";
  if (key.startsWith("eyJ")) {
    keyKind = "legacy-jwt";
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64").toString());
      role = payload.role || "no-role-claim";
    } catch { role = "unparseable-jwt"; }
  } else if (key.startsWith("sb_secret_")) {
    keyKind = "new-secret";
  } else if (key.startsWith("sb_publishable_")) {
    keyKind = "new-publishable(WRONG)";
  } else if (key) {
    keyKind = "unknown-format";
  }

  // Live probe: attempt a trivial insert and capture the RAW error.
  let probe: { ok: boolean; error?: string; code?: string } = { ok: false };
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await sb
      .from("leads")
      .insert({ email: "debug-probe@example.com", brand_slug: "__debug__" })
      .select("id")
      .single();
    if (error) probe = { ok: false, error: error.message, code: (error as { code?: string }).code };
    else probe = { ok: true };
  } catch (e) {
    probe = { ok: false, error: String(e) };
  }

  return NextResponse.json({
    urlSet: !!url,
    urlHost: url.replace(/^https?:\/\//, "").slice(0, 30), // which project
    keyPresent: !!key,
    keyKind,     // legacy-jwt | new-secret | new-publishable(WRONG) | MISSING
    keyRole: role, // want: service_role
    keyPrefix: key.slice(0, 8),
    probe,       // the live insert result + raw PG error
  });
}
