/**
 * scripts/unlockPreview.ts — the call list as it now appears BEFORE anyone pays.
 *
 * Five acquisition surfaces at phone width. This is a visual mockup: the copy
 * below is the copy in the shipped source, and what guarantees it stays there is
 * THE SHELF LINT in lib/callList.test.ts, not this file. Nothing here is
 * imported by the app — same posture as scripts/callListPreview.ts.
 *
 * The paid section itself is unchanged; only the reasons to buy it are new.
 *
 * Output: unlock-preview.html (frames are 390px — an iPhone in Safari).
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Fail loudly if a frame below has drifted from the source it depicts. */
function pin(rel: string, needle: string): void {
  if (!readFileSync(join(process.cwd(), rel), "utf8").includes(needle)) {
    throw new Error(`preview drift: ${rel} no longer contains ${JSON.stringify(needle.slice(0, 48))}`);
  }
}

const TEASER_BODY =
  "The franchisor already printed the phone numbers — every current owner, and " +
  "everyone who left last year, is in the FDD you were handed. The report tells you " +
  "which of those groups are worth an afternoon, where those pages sit, and the first " +
  "question that opens each call.";

const EMAIL_BODY =
  "Those twelve are the generic ones. The full report tells you who to ask. " +
  "Crumbl's FDD is required to list every current owner — and everyone who left last " +
  "fiscal year — with contact information. The report sorts them into the calls " +
  "actually worth an afternoon, points you at the pages that carry the roster, and " +
  "gives you the first question for each group.";

pin("components/InfographicTeaser.tsx", "The franchisor already printed the phone numbers");
pin("components/FeatureMatrix.tsx", "Who to call, and what to ask");
pin("components/BrandDetail.tsx", "Who to call before you sign");
pin("components/BrandCTA.tsx", "and who to call before you sign");
pin("lib/leadEmail.ts", "Those twelve are the generic ones");
pin("app/sample/page.tsx", "who to call\n            before you sign");
pin("components/PlaybookLanding.tsx", "the franchisees to call");

// ── 1 · free snapshot, straight after a parse ───────────────────────────────
const teaser = `<div class="card">
  <p class="kicker">The full report opens</p>
  <ul class="bul">
    <li>Real unit economics, modeled against your capital</li>
    <li>Financial-health severity grade (Item 21 audit)</li>
    <li>Every fee and hidden cost, with page cites</li>
    <li>Operational tripwires and territory terms</li>
    <li>Leadership, system scale, and Item 19 cohorts</li>
  </ul>
  <div class="moat">
    <p class="mtitle">🔒 Who to call, and what to ask</p>
    <p class="mbody">${TEASER_BODY}</p>
  </div>
  <a class="btn">Unlock the full report — $199 →</a>
  <p class="mini">One-time payment · instant access · secure checkout</p>
</div>`;

// ── 2 · the ask card on a free brand page ───────────────────────────────────
const ask = `<div class="card plain">
  <ul class="bul">
    <li><b>What you&rsquo;d actually keep</b> — that revenue modeled to profit after every fee</li>
    <li>Every clause that could trap you, cited to the page</li>
    <li><b>Who to call before you sign</b> — the owner groups worth an afternoon, and the question that opens each</li>
  </ul>
  <a class="btn">Unlock the full Crumbl report — $199</a>
  <p class="mini"><b>One-time $199 · not a subscription · yours forever.</b></p>
</div>`;

// ── 3 · the marketing feature table ─────────────────────────────────────────
const MATRIX: [string, string, string, boolean][] = [
  ["Reads all 23 items, in plain English", "", "yes", false],
  ["Red flags and a risk score", "", "yes", false],
  ["Every figure cited to its Item and page", "", "yes", false],
  ["Scored against your capital", "Your gap and your loan need — not a generic document score", "no", true],
  ["Real unit economics", "True operating margin, not just what the FDD chose to disclose", "no", true],
  ["Item 19, apples-to-apples", "Isolates franchised units from company- and affiliate-owned", "no", true],
  ["Franchisor financial health", "Going-concern, deficit, runway — severity-graded", "partial", true],
  ["Disclosed vs. estimated", "Every number tagged, so you know fact from model", "no", true],
  ["Who to call, and what to ask", "The franchisee groups worth an afternoon, and the question that opens each", "no", true],
];
const mark = (k: string) =>
  k === "yes" ? `<span class="yes">✓</span>` : k === "partial" ? `<span class="part">partial</span>` : `<span class="no">—</span>`;
const matrix = `<div class="card plain">
  <p class="kicker">What you get</p>
  <div class="grid gh"><span></span><span class="ch">Typical</span><span class="ch us">Us</span></div>
  ${MATRIX.map(
    ([label, sub, typical, moat], i) => `<div class="grid gr${moat ? " gm" : ""}${i === MATRIX.length - 1 ? " last" : ""}">
      <span><b class="${moat ? "lb" : "ln"}">${label}</b>${sub ? `<br><span class="sub">${sub}</span>` : ""}</span>
      <span class="cc">${mark(typical)}</span>
      <span class="cc us">${mark("yes")}</span>
    </div>`,
  ).join("")}
</div>`;

// ── 4 · nurture email #1, shopper track ─────────────────────────────────────
const email = `<div class="mail">
  <p class="logo">Franchise<span style="color:#34D399">Edge</span></p>
  <p class="h1">Your Crumbl findings</p>
  <p class="mp">Here&rsquo;s the plain-English summary you asked for — what Crumbl&rsquo;s own audited financials and FDD disclose, at the category level:</p>
  <p class="mp">🔒 Supplier restriction &nbsp;·&nbsp; 🔒 Territory carve-out &nbsp;·&nbsp; 🔒 Transfer consent</p>
  <p class="mp"><b style="color:#F1F5F9">Before you sign anything, ask a current franchisee these 12 questions:</b></p>
  <p class="mp" style="color:#586A88">1. If you were writing the check again today, would you? …<br>&nbsp;&nbsp;&nbsp;<i>(12 questions)</i></p>
  <p class="mp hl">${EMAIL_BODY}</p>
  <a class="btn mailbtn">Back to your Crumbl analysis</a>
  <p class="mfoot">One-time $199 unlocks every number, cited to the page — plus who to call before you sign.</p>
</div>`;

// ── 5 · the two one-liners ──────────────────────────────────────────────────
const liners = `<div class="card plain">
  <p class="kicker">The one-liners</p>
  <p class="lin"><span class="tag">BrandCTA</span> Get the full diligence report — every fee, tripwire, the revenue modeled to what you&rsquo;d actually keep, <b>and who to call before you sign</b>. $199, delivered in minutes.</p>
  <p class="lin"><span class="tag">/sample</span> Upload that brand&rsquo;s FDD and get everything above on its numbers — real cost to open, the disclosed Item 19 cohorts, the full fee stack, financial condition, <b>who to call before you sign</b>, and your list of what to verify.</p>
  <p class="lin"><span class="tag">/playbook</span> … the real cost to open, the disclosed Item 19 earnings, the full fee stack, a plain-English list of what to verify, <b>and the franchisees to call before you sign</b>.</p>
</div>`;

const FRAMES: [string, string, string][] = [
  ["Free snapshot", "components/InfographicTeaser.tsx — directly above the $199 button", teaser],
  ["Brand-page ask card", "components/BrandDetail.tsx — the last bullet before the button", ask],
  ["Feature matrix", "components/FeatureMatrix.tsx — new last row, moat tint", matrix],
  ["Nurture email #1", "lib/leadEmail.ts — under the 12 generic questions", email],
  ["Everything else", "BrandCTA · /sample · /playbook", liners],
];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Franchise Edge — the call list, before the paywall</title>
<style>
  :root{--bg:#0B1220;--card:#16223B;--surface:#0E1729;--border:#27344F;--accent:#38BDF8;
        --body:#CBD5E1;--muted:#8194B0;--faint:#64748B;--bright:#F1F5F9;--gold:#F5B847;--green:#34D399}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--body);
       font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:1380px;margin:0 auto;padding:32px 20px 80px}
  h1{color:var(--bright);font-size:22px;margin:0 0 6px}
  .sub{color:var(--muted);font-size:14px;margin:0 0 28px;max-width:78ch}
  .row{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
  .brand h2{font-size:15px;color:var(--bright);margin:0 0 10px;font-weight:600}
  .note{color:var(--muted);font-size:12px;font-weight:400}
  .phone{width:390px;background:var(--surface);border:1px solid var(--border);border-radius:22px;overflow:hidden}
  .bar{height:32px;background:#111C31;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 14px;color:var(--faint);font-size:11px}
  .screen{padding:12px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px}
  .card.plain{background:var(--surface)}
  .kicker{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:var(--muted);margin:0 0 10px}
  ul.bul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
  ul.bul li{position:relative;padding-left:16px;font-size:13px;line-height:1.5;color:var(--body)}
  ul.bul li:before{content:"";position:absolute;left:0;top:7px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
  ul.bul b{color:var(--bright)}
  .moat{margin-top:14px;border:1px solid #F5B84766;background:#F5B8470D;border-radius:12px;padding:14px 16px}
  .mtitle{margin:0;font-size:13px;font-weight:700;color:var(--bright)}
  .mbody{margin:6px 0 0;font-size:12.5px;line-height:1.6;color:var(--body)}
  .btn{display:block;margin-top:18px;background:var(--green);color:#06231A;text-align:center;font-weight:800;
       font-size:15px;padding:13px 0;border-radius:12px;text-decoration:none}
  .mini{margin:8px 0 0;text-align:center;font-size:11px;color:var(--muted)}
  .mini b{color:var(--bright)}
  .grid{display:grid;grid-template-columns:minmax(0,1fr) 4.5rem 4.5rem;gap:0;align-items:center}
  .gh{padding:0 0 8px;border-bottom:1px solid var(--border)}
  .ch{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);text-align:center}
  .ch.us{color:var(--green)}
  .gr{padding:9px 0;border-bottom:1px solid #1B2942}
  .gr.last{border-bottom:0}
  .gm{border-left:2px solid #F5B84780;background:#F5B84708;padding-left:8px}
  .ln{font-size:12.5px;font-weight:400;color:var(--body)}
  .lb{font-size:12.5px;font-weight:600;color:var(--bright)}
  .sub2,.sub{font-size:11px;color:var(--muted);line-height:1.45}
  .cc{text-align:center;font-size:13px}
  .yes{color:var(--green);font-weight:800}.no{color:var(--faint)}
  .part{font-size:9.5px;color:var(--gold);text-transform:uppercase;letter-spacing:.06em}
  .mail{background:var(--surface);border:1px solid #22304C;border-radius:16px;padding:20px 22px}
  .logo{margin:0;font-size:15px;font-weight:700;color:var(--bright)}
  .h1{margin:10px 0 0;font-size:20px;font-weight:800;color:var(--bright);line-height:1.3}
  .mp{margin:12px 0 0;font-size:13.5px;line-height:1.6;color:var(--muted)}
  .mp.hl{color:var(--body);border-left:2px solid #F5B84780;padding-left:12px}
  .mp.hl b{color:var(--bright)}
  .mailbtn{margin-top:18px}
  .mfoot{margin:10px 0 0;font-size:11px;line-height:1.5;color:#586A88}
  .lin{font-size:12.5px;line-height:1.6;margin:12px 0 0;color:var(--body)}
  .lin b{color:var(--bright)}
  .tag{display:inline-block;margin-right:6px;font-size:10px;font-weight:700;letter-spacing:.06em;
       color:var(--accent);background:#38BDF814;border:1px solid #38BDF833;border-radius:4px;padding:1px 5px}
  .notes{margin-top:48px;border-top:1px solid var(--border);padding-top:20px;color:var(--muted);font-size:14px;max-width:82ch}
  .notes p{margin:0 0 12px}.notes b{color:var(--bright);font-weight:600}
  code{background:#111C31;border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-size:12.5px;color:var(--accent)}
</style></head>
<body><div class="wrap">
  <h1>The call list, before the paywall</h1>
  <p class="sub">The paid section did not change. What changed is that a buyer can now find out it exists before paying $199 for it — on the free snapshot, the brand-page ask, the feature table, the nurture email, and three one-liners. Pinned by <code>THE SHELF LINT</code> in <code>lib/callList.test.ts</code>.</p>
  <div class="row">
    ${FRAMES.map(([name, where, body]) => `<section class="brand">
      <h2>${name} <span class="note">— ${where}</span></h2>
      <div class="phone"><div class="bar">engine.foundersplinko.com</div>
      <div class="screen">${body}</div></div>
    </section>`).join("")}
  </div>
  <div class="notes">
    <p><b>The feature was invisible to everyone who had not already paid.</b> It shipped complete, tested, and rendering — behind the paywall only. A buyer deciding whether to spend $199 had no way to learn the report contained it, so it could not have moved conversion by a dollar. The paid render was built; the reason to pay for it was not. <code>tsc</code> cannot see that, vitest could not see it, and the report looked perfect the whole time. The only symptom is a number that does not move.</p>
    <p><b>So the shelf is now a lint.</b> <code>THE SHELF LINT</code> lists the seven surfaces a buyer reads before the decision and fails the build if any of them stops naming this section. It is loose on wording and strict on presence — copy gets rewritten and should not break a build, but silence should. This is the same shape as <code>PRICE_SURFACES</code> in <code>lib/refund.test.ts</code>, which holds the same line for the guarantee.</p>
    <p><b>The teaser copy is static on purpose, and that is a gating decision, not laziness.</b> <code>lib/callList.ts</code> holds the cohort prose and the ordered questions, and <code>InfographicTeaser</code> is a client component — importing the module to make the teaser data-aware would have shipped every question we charge for into the free page&rsquo;s JavaScript bundle. The teaser names the shape of the section and nothing inside it. The system-unit count is already on the Glance row directly above, so repeating it in the callout would print the same number twice on one phone screen.</p>
    <p><b>It is framed, not bulleted.</b> Every other line in &ldquo;The full report opens&rdquo; is something we tell the buyer. This is the only one that tells them what to DO, and bullet six would have buried it. The amber is the same moat tint the feature matrix uses, so both acquisition surfaces agree about which line is the differentiator.</p>
    <p><b>No surface promises contact data from us.</b> Item 20&rsquo;s exhibits are personal contact details for named individuals, and the franchisor is required to put them in the buyer&rsquo;s own copy of the FDD — 16 CFR 436.5(t), Exhibits A and B. Every line above says so out loud (&ldquo;is in the FDD you were handed&rdquo;, &ldquo;${"Crumbl"}&rsquo;s FDD is required to list&rdquo;). What we sell is which groups are worth an afternoon and what opens each call. A second lint scans all seven surfaces for copy that reads as <i>we</i> supply the phone numbers.</p>
    <p><b>The email&rsquo;s plain-text half carries the line too.</b> It was already sending all twelve generic questions in text, and Gmail clipping plus every text-first client render that part — an HTML-only promise would be a promise half the list never sees.</p>
  </div>
</div></body></html>`;

writeFileSync(join(process.cwd(), "unlock-preview.html"), html, "utf8");
console.log("wrote unlock-preview.html");
console.log(`frames: ${FRAMES.length}   matrix rows: ${MATRIX.length} (was ${MATRIX.length - 1})`);
