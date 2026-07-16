// app/api/lead/debug/route.ts — TEMPORARY. DELETE after use.
// Now probes the TEASER EMAIL send directly and reports the raw result, since
// the lead insert works but Resend shows no teaser send.
import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET() {
  const out: Record<string, unknown> = {
    resendKeyPresent: !!process.env.RESEND_API_KEY,
    resendKeyPrefix: (process.env.RESEND_API_KEY || "").slice(0, 6),
    resendFrom: process.env.RESEND_FROM || "(default) Franchise Edge <hello@foundersplinko.com>",
  };

  // 1) Can we even import the module? (a bad import = silent route failure)
  try {
    const mod = await import("@/lib/leadEmail");
    out.leadEmailImport = "ok";
    // 2) Actually attempt a send to the account owner address and capture result.
    try {
      const sent = await mod.sendLeadTeaserEmail({
        to: "jason.wright09@gmail.com",
        brandName: "DebugBrand",
        teaserUrl: "https://engine.foundersplinko.com/franchise/crumbl?lead=debug",
      });
      out.teaserSendResult = sent; // true = Resend accepted it; false = it failed inside
    } catch (e) {
      out.teaserSendThrew = String(e);
    }
  } catch (e) {
    out.leadEmailImport = "FAILED: " + String(e);
  }

  // 3) Raw Resend call bypassing our wrapper, to isolate wrapper vs. Resend.
  try {
    const { Resend } = await import("resend");
    const r = new Resend(process.env.RESEND_API_KEY!);
    const { data, error } = await r.emails.send({
      from: process.env.RESEND_FROM || "Franchise Edge <hello@foundersplinko.com>",
      to: "jason.wright09@gmail.com",
      subject: "DEBUG raw teaser test",
      html: "<p>raw resend probe</p>",
      text: "raw resend probe",
    });
    out.rawResend = error ? { error: error.message, name: (error as { name?: string }).name } : { ok: true, id: data?.id };
  } catch (e) {
    out.rawResendThrew = String(e);
  }

  return NextResponse.json(out);
}
