// fdd-engine-deploy/lib/email.ts
//
// Transactional email via Resend. Right now this sends ONE message: the
// post-purchase "your report is ready" email, fired from the Stripe webhook
// after a checkout completes. It carries the permanent /report/<id> link so a
// buyer who closed the tab never loses what they paid for.
//
// The sending domain (foundersplinko.com) must be verified in the SAME Resend
// account that RESEND_API_KEY belongs to. It already is (verified for the
// marketing site), so any from-address @foundersplinko.com works immediately —
// no per-app re-verification.
//
// Phase 2 (PDF attachment) is additive: sendReportEmail already accepts an
// optional `attachments` array, so attaching the rendered report is a one-line
// change at the call site once PDF generation exists.

import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  _resend = new Resend(key);
  return _resend;
}

// Local attachment shape so callers don't import types from resend directly.
// `content` is a Buffer of bytes or a base64 string — both are what Resend takes.
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
}

export interface SendReportEmailArgs {
  to: string;
  reportUrl: string;
  brandName?: string | null;
  attachments?: EmailAttachment[]; // Phase 2: the report PDF
}

// Default sender. foundersplinko.com is the verified domain; override the exact
// address with RESEND_FROM (e.g. a no-reply@ or reports@) without code changes.
const FROM = process.env.RESEND_FROM || "Franchise Edge <hello@foundersplinko.com>";

/**
 * Send the post-purchase report email. Returns true on success, false on any
 * failure — it NEVER throws. The caller (the Stripe webhook) logs the result
 * and continues either way, because the payment is already recorded and the
 * buyer has instant unlock regardless of whether this email lands.
 */
export async function sendReportEmail(args: SendReportEmailArgs): Promise<boolean> {
  const { to, reportUrl, brandName, attachments } = args;

  const subject = brandName
    ? `Your Franchise Edge diligence report — ${brandName}`
    : "Your Franchise Edge diligence report";

  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html: reportEmailHtml({ reportUrl, brandName }),
      ...(attachments && attachments.length ? { attachments } : {}),
    });
    if (error) {
      console.error("[email] Resend returned an error:", error);
      return false;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[email] send failed:", msg);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Failure alert — internal notification to the operator when an FDD fails to
// extract. Carries the full technical error, a link to the RETAINED copy of the
// failed document (for local replay), and the buyer's inputs for context. This
// is what turns a silent production failure into something you can act on the
// same day, with the exact doc in hand.
// ---------------------------------------------------------------------------

export interface FailureAlertArgs {
  /** The full technical error message (provider chain, stack-ish detail). */
  error: string;
  /** Public Blob URL of the retained failed document, or null if re-upload failed. */
  failedDocUrl: string | null;
  /** Size of the uploaded file in bytes (helps spot truncation / huge docs). */
  fileSizeBytes?: number;
  /** Buyer inputs at time of failure (context only). */
  buyer?: { liquidCapital: number; netWorth: number };
}

// Where alerts go. Defaults to the operator inbox; override with FAILURE_ALERT_TO.
const ALERT_TO = process.env.FAILURE_ALERT_TO || "jason@foundersplinko.com";

/**
 * Email the operator that an extraction failed. Returns true on success, never
 * throws — the caller logs the result and continues, because the user still
 * needs their (calm) on-screen error regardless of whether this alert lands.
 */
export async function sendFailureAlert(args: FailureAlertArgs): Promise<boolean> {
  const { error, failedDocUrl, fileSizeBytes, buyer } = args;
  try {
    const resend = getResend();
    const { error: sendErr } = await resend.emails.send({
      from: FROM,
      to: ALERT_TO,
      subject: "⚠️ FDD extraction FAILED — needs a look",
      html: failureAlertHtml({ error, failedDocUrl, fileSizeBytes, buyer }),
    });
    if (sendErr) {
      console.error("[email] failure-alert returned an error:", sendErr);
      return false;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[email] failure-alert send failed:", msg);
    return false;
  }
}

function failureAlertHtml(args: FailureAlertArgs): string {
  const { error, failedDocUrl, fileSizeBytes, buyer } = args;
  const sizeLabel =
    typeof fileSizeBytes === "number"
      ? `${(fileSizeBytes / 1_000_000).toFixed(1)} MB`
      : "unknown";
  const buyerLabel = buyer
    ? `liquid $${buyer.liquidCapital.toLocaleString()} · net worth $${buyer.netWorth.toLocaleString()}`
    : "n/a";
  const when = new Date().toISOString();

  const docBlock = failedDocUrl
    ? `<a href="${failedDocUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:8px;">Download the failed FDD &rarr;</a>
       <p style="margin:8px 0 0 0;font-size:12px;color:#6b7280;word-break:break-all;">${failedDocUrl}</p>`
    : `<p style="margin:0;font-size:13px;color:#b91c1c;">Failed doc could not be retained (re-upload errored — see logs).</p>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;">
          <tr><td style="padding:24px 24px 0 24px;">
            <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#b91c1c;font-weight:700;">Franchise Edge · extraction failed</div>
            <h1 style="margin:8px 0 0 0;font-size:18px;color:#111827;">An FDD didn't extract</h1>
          </td></tr>
          <tr><td style="padding:18px 24px 0 24px;">${docBlock}</td></tr>
          <tr><td style="padding:18px 24px 0 24px;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700;margin-bottom:6px;">Error</div>
            <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;background:#f9fafb;border:1px solid #eceff3;border-radius:8px;padding:12px;color:#111827;">${escapeHtml(error)}</pre>
          </td></tr>
          <tr><td style="padding:16px 24px 24px 24px;">
            <p style="margin:0;font-size:13px;line-height:1.7;color:#374151;">
              <strong>File size:</strong> ${sizeLabel}<br>
              <strong>Buyer inputs:</strong> ${buyerLabel}<br>
              <strong>When:</strong> ${when}
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function reportEmailHtml(args: { reportUrl: string; brandName?: string | null }): string {
  const { reportUrl, brandName } = args;
  const brandLine = brandName
    ? `Your full diligence report for <strong>${escapeHtml(brandName)}</strong> is ready.`
    : `Your full diligence report is ready.`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e7ec;border-radius:14px;">
          <tr><td style="padding:28px 28px 0 28px;">
            <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;font-weight:700;">Franchise Edge</div>
          </td></tr>
          <tr><td style="padding:14px 28px 0 28px;">
            <h1 style="margin:0;font-size:20px;line-height:1.3;color:#111827;">Your diligence report is ready</h1>
          </td></tr>
          <tr><td style="padding:12px 28px 0 28px;">
            <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${brandLine} It reads the FDD against your capital position — Item 19 performance, the full initial-investment range, the fee stack, and the financial items worth a closer look.</p>
          </td></tr>
          <tr><td style="padding:24px 28px 0 28px;">
            <a href="${reportUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 22px;border-radius:9px;">View your report &rarr;</a>
          </td></tr>
          <tr><td style="padding:18px 28px 0 28px;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">Or paste this link into your browser:<br><a href="${reportUrl}" style="color:#2563eb;word-break:break-all;">${reportUrl}</a></p>
          </td></tr>
          <tr><td style="padding:18px 28px 0 28px;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">This link stays live for 18 months — bookmark it, and forward it to your lender, accountant, or attorney as you run the deal down.</p>
          </td></tr>
          <tr><td style="padding:22px 28px 26px 28px;">
            <hr style="border:none;border-top:1px solid #eceff3;margin:0 0 16px 0;">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#9aa3af;">Informational only — not legal, financial, or investment advice. Figures are extracted by an AI model and may contain errors; verify every number against the source FDD, and consult a qualified professional, before making any decision.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
