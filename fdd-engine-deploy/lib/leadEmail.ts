// lib/leadEmail.ts
//
// The teaser email (spec v2, D1) — copy is the HANDOFF TEMPLATE, verbatim by
// directive #4. It carries NO actual numbers: its only job is to pull the buyer
// back to the teaser page, where the numbers (and the $199 unlock) live.
// Resend is delivery-only (spec §7); Supabase is the system of record.

import { Resend } from "resend";

const FROM = process.env.RESEND_FROM || "Franchise Edge <hello@foundersplinko.com>";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  _resend = new Resend(key);
  return _resend;
}

export interface LeadEmailArgs {
  to: string;
  brandName: string;
  teaserUrl: string; // /franchise/<slug>?lead=<id>
}

const PREHEADER =
  "The cost, the Item 19 earnings, and the flags a broker won't lead with.";

/**
 * Send the teaser email. Never throws — returns true/false; the caller records
 * email_sent from the result.
 */
export async function sendLeadTeaserEmail(args: LeadEmailArgs): Promise<boolean> {
  const { to, brandName, teaserUrl } = args;
  const subject = `Your ${brandName} franchise analysis — saved`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#0B1220;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${PREHEADER}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B1220;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0E1729;border:1px solid #22304C;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:22px 26px 0;">
            <div style="font-size:15px;font-weight:700;color:#F1F5F9;">Franchise<span style="color:#34D399;">Edge</span></div>
          </td></tr>
          <tr><td style="padding:18px 26px 0;">
            <h1 style="margin:0;font-size:22px;line-height:1.25;color:#F1F5F9;font-weight:800;">Your ${brandName} analysis — saved</h1>
            <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#8194B0;">
              Here's the ${brandName} analysis you pulled up — saved so you can review it later or send it to your business partner.
            </p>
            <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#8194B0;">
              The free snapshot has the real cost to open, the disclosed Item 19 earnings, and the risk flags the sales deck won't lead with. The full report goes further: what you'd actually keep after every fee, the complete Item 19 breakdown, and the financial-health grade from the audited statements.
            </p>
          </td></tr>
          <tr><td style="padding:22px 26px 6px;">
            <a href="${teaserUrl}" style="display:block;background:#34D399;color:#0B1220;text-decoration:none;text-align:center;font-weight:800;font-size:15px;padding:13px 0;border-radius:10px;">
              Open my ${brandName} analysis
            </a>
          </td></tr>
          <tr><td style="padding:6px 26px 24px;">
            <p style="margin:0;font-size:11px;line-height:1.5;color:#586A88;">
              Not affiliated with or endorsed by ${brandName}. Informational only. Unsubscribe anytime.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = `Your ${brandName} franchise analysis — saved

Here's the ${brandName} analysis you pulled up — saved so you can review it later or send it to your business partner.

The free snapshot has the real cost to open, the disclosed Item 19 earnings, and the risk flags the sales deck won't lead with. The full report goes further: what you'd actually keep after every fee, the complete Item 19 breakdown, and the financial-health grade from the audited statements.

Open my ${brandName} analysis: ${teaserUrl}

Not affiliated with or endorsed by ${brandName}. Informational only. Unsubscribe anytime.`;

  try {
    const { error } = await getResend().emails.send({ from: FROM, to, subject, html, text });
    if (error) {
      console.error("[leadEmail] send failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[leadEmail] threw:", err);
    return false;
  }
}
