// lib/leadEmail.ts — Capture v2 fulfillment emails (spec r2 §5/§5b/§6, Appendix A).
//
// Three templates, branched on lead_source — routes NEVER cross-deliver:
//   sendFindingsEmail     (shopper track, S1/S2/sheet)  — nurture email #1
//   sendPlaybookEmail     (dreamer track, S5)           — nurture email #1
//   sendCapitalMatchEmail (S3, ruling #1: scoped-down list, max 8 brands)
//
// COPY RULE (ruling #5, standing): "our audit" is BANNED. We read disclosures —
// framing is always "{Brand}'s own audited financials / FDD disclose".
// GATING RULE (spec S1): the findings email teases in CATEGORY terms only —
// generated from the same teaser transform, never from raw locked values.

import { Resend } from "resend";
import type { BrandRecord } from "@/lib/brands";
import { listBrands, toCard } from "@/lib/brands";

const FROM = process.env.RESEND_FROM || "Franchise Edge <hello@foundersplinko.com>";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  _resend = new Resend(key);
  return _resend;
}

// ── shared chrome ────────────────────────────────────────────────────────────
function shell(inner: string, preheader: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#0B1220;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B1220;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0E1729;border:1px solid #22304C;border-radius:16px;overflow:hidden;">
<tr><td style="padding:22px 26px 0;"><div style="font-size:15px;font-weight:700;color:#F1F5F9;">Franchise<span style="color:#34D399;">Edge</span></div></td></tr>
${inner}
</table></td></tr></table></body></html>`;
}
const P = 'style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#8194B0;"';
const H1 = 'style="margin:8px 0 0;font-size:21px;line-height:1.3;color:#F1F5F9;font-weight:800;"';
const BTN = 'style="display:block;background:#34D399;color:#0B1220;text-decoration:none;text-align:center;font-weight:800;font-size:15px;padding:13px 0;border-radius:10px;"';
const FOOT = 'style="margin:0;font-size:11px;line-height:1.5;color:#586A88;"';

const TWELVE_QUESTIONS: string[] = [
  "If you were writing the check again today, would you? Why or why not?",
  "How long did it take you to reach break-even — and how did that compare to what you expected when you signed?",
  "What did your total investment actually come to, versus the Item 7 range in the FDD?",
  "What does a realistic week of your labor look like — hours, and which tasks can't be delegated?",
  "Which recurring fees or required purchases surprised you after opening?",
  "How would you describe the franchisor's support in your first 90 days — and in the last 90?",
  "Have supply, pricing, or territory rules changed on you since you signed? How much notice did you get?",
  "What's your revenue seasonality really like, and how many months of reserves would you tell me to hold?",
  "If you wanted out tomorrow, what would selling actually look like? Has anyone in your market sold?",
  "What do the top-quartile operators in this system do differently from the bottom quartile?",
  "What question do you wish you'd asked before signing?",
  "Is there anything in your franchise agreement you'd negotiate differently now?",
];

async function send(to: string, subject: string, html: string, text: string): Promise<boolean> {
  try {
    const { error } = await getResend().emails.send({ from: FROM, to, subject, html, text });
    if (error) { console.error("[leadEmail] send failed:", error); return false; }
    return true;
  } catch (e) { console.error("[leadEmail] threw:", e); return false; }
}

// ── 1 · FINDINGS (shopper track) ─────────────────────────────────────────────
// Category-level teases from the same server-side teaser transform that gates
// the page — severity/category language only, never dollar figures.
export async function sendFindingsEmail(args: {
  to: string;
  brand: BrandRecord;
  brandName: string;
  teaserUrl: string;
}): Promise<boolean> {
  const { to, brand, brandName, teaserUrl } = args;
  const card = toCard(brand);
  const subject = `What ${brandName}'s FDD discloses — the parts most buyers miss`;

  // category teases: the SAME category labels the free page shows (single
  // resolver — the email can never tease something the page doesn't).
  const catList = (card.tripwires ?? [])
    .slice(0, 3)
    .map((t) => `<li style="margin-top:6px;">🔒 ${t.label}</li>`)
    .join("");
  // Fin-condition tease: the same locked-flag existence bit the page renders.
  const hasFinFlag = card.hasFinancialConditionFlag;
  const finLine = hasFinFlag
    ? `<p ${P}>${brandName}'s own audited financial statements disclose a <b style="color:#F1F5F9;">financial-condition item</b> — what it is, and what it means for your investment, is detailed in the full report.</p>`
    : "";

  const qHtml = TWELVE_QUESTIONS.map((q, i) => `<li style="margin-top:7px;"><b style="color:#CBD5E1;">${i + 1}.</b> ${q}</li>`).join("");

  const inner = `
<tr><td style="padding:18px 26px 0;">
  <h1 ${H1}>Your ${brandName} findings</h1>
  <p ${P}>Here's the plain-English summary you asked for — what ${brandName}'s own audited financials and FDD disclose, at the category level:</p>
  ${finLine}
  ${catList ? `<ul style="margin:12px 0 0;padding:0 0 0 4px;list-style:none;font-size:14px;color:#8194B0;">${catList}</ul>` : ""}
  <p ${P}>Each locked item above is explained — with the numbers and the FDD page citations — in the full $199 report.</p>
  <p ${P}><b style="color:#F1F5F9;">Before you sign anything, ask a current franchisee these 12 questions:</b></p>
  <ol style="margin:10px 0 0;padding:0;list-style:none;font-size:13.5px;line-height:1.55;color:#8194B0;">${qHtml}</ol>
</td></tr>
<tr><td style="padding:22px 26px 6px;"><a href="${teaserUrl}" ${BTN}>Back to your ${brandName} analysis</a></td></tr>
<tr><td style="padding:6px 26px 24px;"><p ${FOOT}>One-time $199 unlocks every number, cited to the page. Not affiliated with or endorsed by ${brandName}. Informational only. Unsubscribe anytime.</p></td></tr>`;

  const text = `Your ${brandName} findings\n\nWhat ${brandName}'s own audited financials and FDD disclose (category level) is summarized on your analysis page — the full numbers and page citations are in the $199 report.\n\nThe 12 questions to ask a franchisee:\n${TWELVE_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nYour analysis: ${teaserUrl}\n\nNot affiliated with ${brandName}. Informational only.`;
  return send(to, subject, shell(inner, "The findings summary + the 12 questions to ask before you sign."), text);
}

// ── 2 · PLAYBOOK (dreamer track, A3) ────────────────────────────────────────
export async function sendPlaybookEmail(args: { to: string; leadId: string }): Promise<boolean> {
  const { to } = args;
  const playbookUrl = process.env.PLAYBOOK_URL || "https://foundersplinko.com/playbook.pdf";
  const bridgeUrl = "https://engine.foundersplinko.com/brands?utm_source=playbook_email";
  const subject = "Your free Franchise Playbook";
  const inner = `
<tr><td style="padding:18px 26px 0;">
  <h1 ${H1}>Your Franchise Playbook</h1>
  <p ${P}>I put this together because I wish someone had handed it to me before I wrote my first franchise check. — Jason</p>
  <p ${P}>Inside: the 90-day checklist, the cost worksheets, and the location math the pros use — in plain English.</p>
</td></tr>
<tr><td style="padding:22px 26px 6px;"><a href="${playbookUrl}" ${BTN}>Download the Playbook</a></td></tr>
<tr><td style="padding:10px 26px 6px;"><a href="${bridgeUrl}" style="display:block;text-align:center;font-size:13.5px;font-weight:700;color:#38BDF8;text-decoration:none;">Next: see what the FDD actually says about 70+ brands →</a></td></tr>
<tr><td style="padding:14px 26px 24px;"><p ${FOOT}>Informational only. Unsubscribe anytime.</p></td></tr>`;
  const text = `Your Franchise Playbook\n\nI put this together because I wish someone had handed it to me before I wrote my first franchise check. — Jason\n\nDownload: ${playbookUrl}\n\nNext: see what the FDD actually says about 70+ brands: ${bridgeUrl}`;
  return send(to, subject, shell(inner, "The 90-day checklist, cost worksheets, and location math — in plain English."), text);
}

// ── 3 · CAPITAL MATCH (S3, ruling #1: scoped down) ──────────────────────────
// Max 8 brands where Item 7 low ≤ capital, sorted ascending by low. Name +
// range + link only — zero personalization beyond the filter.
export async function sendCapitalMatchEmail(args: {
  to: string;
  capital: number;
  leadId: string;
  origin: string;
}): Promise<boolean> {
  const { to, capital, origin } = args;
  const all = await listBrands();
  const fits = all
    .map((b) => toCard(b))
    .filter((c) => c.live && c.lo != null && c.lo <= capital)
    .sort((a, b) => (a.lo ?? 0) - (b.lo ?? 0))
    .slice(0, 8);

  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const capStr = fmt(capital);
  const subject = `Brands that fit your ${capStr} budget`;

  const rows = fits
    .map(
      (c) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid #22304C;"><a href="${origin}/franchise/${c.slug}" style="font-size:14px;font-weight:700;color:#38BDF8;text-decoration:none;">${c.brandName}</a></td>
<td style="padding:10px 0;border-bottom:1px solid #22304C;text-align:right;font-size:13px;color:#8194B0;">${c.lo != null && c.hi != null ? `${fmt(c.lo)} – ${fmt(c.hi)}` : "—"}</td>
</tr>`,
    )
    .join("");

  const inner = `
<tr><td style="padding:18px 26px 0;">
  <h1 ${H1}>Brands that fit ${capStr}</h1>
  <p ${P}>${fits.length ? `These ${fits.length} brands have a disclosed Item 7 low end at or under your budget:` : "No tracked brands currently have a disclosed Item 7 low end at or under that budget — the closest fits are on the brands index:"}</p>
  ${fits.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">${rows}</table>` : ""}
</td></tr>
<tr><td style="padding:22px 26px 6px;"><a href="${origin}/brands" ${BTN}>Browse all brands</a></td></tr>
<tr><td style="padding:6px 26px 24px;"><p ${FOOT}>Ranges are franchisor-disclosed Item 7 estimates from each brand's FDD. Informational only. Unsubscribe anytime.</p></td></tr>`;
  const text = `Brands that fit ${capStr}\n\n${fits.map((c) => `${c.brandName}: ${c.lo != null ? fmt(c.lo) : "—"}${c.hi != null ? " – " + fmt(c.hi) : ""} — ${origin}/franchise/${c.slug}`).join("\n")}\n\nAll brands: ${origin}/brands\n\nRanges are franchisor-disclosed Item 7 estimates.`;
  return send(to, subject, shell(inner, "Up to 8 tracked brands with an Item 7 low end inside your budget."), text);
}
