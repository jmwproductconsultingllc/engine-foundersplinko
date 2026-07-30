/**
 * scripts/leadWithCallsMock.ts — "lead with the calls" as a picture.
 *
 * Four proposals, each shown BEFORE (what is on disk and md5-verified right now)
 * against AFTER (what promoting the call list to the lead position looks like).
 * Nothing here is imported by the app and nothing here has been applied — this is
 * a decision aid, same posture as scripts/callListPreview.ts.
 *
 * The BEFORE copy is pinned against the real source files so this cannot drift
 * into showing you a "before" that is not actually your before.
 *
 * Output: lead-with-calls-mock.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function pin(rel: string, needle: string): void {
  if (!readFileSync(join(process.cwd(), rel), "utf8").includes(needle)) {
    throw new Error(`mock drift: ${rel} no longer contains ${JSON.stringify(needle.slice(0, 56))}`);
  }
}

// ── the one paragraph both teaser layouts share ─────────────────────────────
const CALL_BODY =
  "The franchisor already printed the phone numbers — every current owner, and " +
  "everyone who left last year, is in the FDD you were handed. The report tells you " +
  "which of those groups are worth an afternoon, where those pages sit, and the first " +
  "question that opens each call.";

const BULLETS = [
  "Real unit economics, modeled against your capital",
  "Financial-health severity grade (Item 21 audit)",
  "Every fee and hidden cost, with page cites",
  "Operational tripwires and territory terms",
  "Leadership, system scale, and Item 19 cohorts",
];

pin("components/InfographicTeaser.tsx", "The franchisor already printed the phone numbers");
pin("components/InfographicTeaser.tsx", "The full report opens");

// ── 1 · the teaser ──────────────────────────────────────────────────────────
const bullets = BULLETS.map((b) => `<li>${b}</li>`).join("");
const callCard = (big: boolean) => `<div class="moat${big ? " big" : ""}">
  <p class="mtitle">🔒 Who to call, and what to ask</p>
  <p class="mbody">${CALL_BODY}</p>
</div>`;

const teaserBefore = `<div class="card">
  <p class="kicker">The full report opens</p>
  <ul class="bul">${bullets}</ul>
  ${callCard(false)}
  <a class="btn">Unlock the full report — $199 →</a>
</div>`;

const teaserAfter = `<div class="card">
  ${callCard(true)}
  <p class="kicker mt">Plus everything else the report opens</p>
  <ul class="bul">${bullets}</ul>
  <a class="btn">Unlock the full report — $199 →</a>
</div>`;

// ── 2 · the feature matrix ──────────────────────────────────────────────────
type MRow = [string, string, "yes" | "no" | "partial", boolean];
const STAKES: MRow[] = [
  ["Reads all 23 items, in plain English", "", "yes", false],
  ["Red flags and a risk score", "", "yes", false],
  ["Every figure cited to its Item and page", "", "yes", false],
];
const CALLS: MRow = [
  "Who to call, and what to ask",
  "The franchisee groups worth an afternoon, and the question that opens each",
  "no",
  true,
];
const MOAT: MRow[] = [
  ["Scored against your capital", "Your gap and your loan need — not a generic document score", "no", true],
  ["Real unit economics", "True operating margin, not just what the FDD chose to disclose", "no", true],
  ["Item 19, apples-to-apples", "Isolates franchised units from company- and affiliate-owned", "no", true],
  ["Franchisor financial health", "Going-concern, deficit, runway — severity-graded", "partial", true],
  ["Disclosed vs. estimated", "Every number tagged, so you know fact from model", "no", true],
];

const mark = (k: string) =>
  k === "yes" ? `<span class="yes">✓</span>` : k === "partial" ? `<span class="part">partial</span>` : `<span class="no">—</span>`;

const matrix = (rows: MRow[], hi: number) => `<div class="card plain">
  <p class="kicker">What you get</p>
  <div class="grid gh"><span></span><span class="ch">Typical</span><span class="ch us">Us</span></div>
  ${rows
    .map(
      ([label, sub, typical, moat], i) => `<div class="grid gr${moat ? " gm" : ""}${i === hi ? " lead" : ""}${
        i === rows.length - 1 ? " last" : ""
      }">
      <span><b class="${moat ? "lb" : "ln"}">${label}</b>${sub ? `<br><span class="sub">${sub}</span>` : ""}</span>
      <span class="cc">${mark(typical)}</span>
      <span class="cc us">${mark("yes")}</span>
    </div>`,
    )
    .join("")}
</div>`;

const matrixBefore = matrix([...STAKES, ...MOAT, CALLS], 8);
const matrixAfter = matrix([...STAKES, CALLS, ...MOAT], 3);

// ── 3 · the homepage ────────────────────────────────────────────────────────
const H1 = "Know if this franchise will actually make you money.";
const SUB_BEFORE =
  "Upload the franchise's FDD — the disclosure document every franchisor must give you — and " +
  "tell us what you can put toward opening. In minutes you get a scored diligence read: real " +
  "unit economics, hidden fees, and the franchisor's financial health, measured against your " +
  "own capital.";
const SUB_AFTER =
  "Upload the franchise's FDD — the disclosure document every franchisor must give you — and " +
  "tell us what you can put toward opening. In minutes you get a scored diligence read — real " +
  "unit economics, hidden fees and financial health, all measured against your own capital — " +
  "and the franchisees to call before you sign.";

const DESC_BEFORE =
  "Upload a franchise's FDD and get a plain-English diligence read: real cost to open, Item 19 " +
  "unit economics, the full fee stack, and what to verify before you sign.";
const DESC_AFTER =
  "Upload a franchise's FDD: real unit economics, hidden fees and financial health scored " +
  "against your capital — plus the franchisees to call before you sign.";
const H1_ALT = "Know if this franchise will actually make you money. Then call the people who already do.";

pin("components/HomeView.tsx", H1);
pin("app/page.tsx", "real cost to open, Item 19 unit economics");

const CUT = 155;
const cut = (s: string) =>
  s.length <= CUT
    ? `<span class="keep">${s}</span>`
    : `<span class="keep">${s.slice(0, CUT)}</span><span class="lost">${s.slice(CUT)}</span>`;

const home = `<div class="card plain wide">
  <p class="kicker">1 · the hero, on the page</p>
  <p class="lbl">before</p>
  <p class="hero">${H1}</p>
  <p class="hsub">${SUB_BEFORE}</p>
  <p class="lbl aft">after — same length, ends on the action instead of an abstraction</p>
  <p class="hero">${H1}</p>
  <p class="hsub">${SUB_AFTER.replace(
    "and the franchisees to call before you sign.",
    "<b>and the franchisees to call before you sign.</b>",
  )}</p>
  <p class="opt"><span class="tag">optional, riskier</span> the H1 itself: &ldquo;<b>${H1_ALT}</b>&rdquo; — stronger, but the current H1 is your best-ranking organic line and I would not churn it in the same week as a pricing push.</p>

  <p class="kicker mt2">2 · the meta description, at Google's ~${CUT}-character cut</p>
  <p class="lbl">before — ${DESC_BEFORE.length} chars, so everything after the cut is invisible</p>
  <p class="mono">${cut(DESC_BEFORE)}</p>
  <p class="lbl aft">after — ${DESC_AFTER.length} chars, nothing lost, and the differentiator is inside the cut</p>
  <p class="mono">${cut(DESC_AFTER)}</p>
</div>`;

// ── 4 · the demo open ───────────────────────────────────────────────────────
// Figures are the shipped Tint World record, pinned in lib/callList.test.ts.
// The needle is the ESCAPED form, because the assertion in that file is a regex
// literal (`/6\.2× spread/`) — pinning the unescaped string pins nothing.
pin("lib/callList.test.ts", "6\\.2× spread");
pin("lib/callList.test.ts", "$160,456 a month");
const demo = `<div class="card plain wide">
  <p class="kicker">The thirty-second open</p>
  <p class="stage">[Report already on screen. Scroll <i>past</i> the numbers, straight to &ldquo;Who To Call, And What To Ask&rdquo;.]</p>
  <p class="say">&ldquo;Before I show you a single number — this is the part nobody else does.</p>
  <p class="say">The franchisor is legally required to print every current owner&rsquo;s phone number in the document they hand you. Plus everyone who left last year. Nobody uses it, because a list of a hundred and forty-nine names isn&rsquo;t information.</p>
  <p class="say">So we sort it. <b>These 149 are still in the system</b> — and here are the five questions that get you their real COGS and their real labor, including their own hours. <b>These 31 left last year</b> — and question one is how the exit actually happened, because the FDD discloses that they left and never says why.</p>
  <p class="say">And this one. <b>This brand discloses $160,456 a month at the top of its system and $26,044 at the bottom.</b> That&rsquo;s a 6.2× spread inside one brand. So when an owner tells you they&rsquo;re doing fine, you ask for the number — and you know within ten seconds whether you just talked to the top of this system or the bottom of it.</p>
  <p class="say">Now. The numbers.&rdquo; [scroll up]</p>
  <p class="foot2">Every figure spoken is from the shipped Tint World record and pinned in <code>lib/callList.test.ts</code> — 149 units, 31 departures, $160,456, $26,044, 6.2×. Nothing in the script needs to be true only on demo day.</p>
</div>`;

// ── page ────────────────────────────────────────────────────────────────────
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Franchise Edge — lead with the calls</title>
<style>
  :root{--bg:#0B1220;--card:#16223B;--surface:#0E1729;--border:#27344F;--accent:#38BDF8;
        --body:#CBD5E1;--muted:#8194B0;--faint:#64748B;--bright:#F1F5F9;--gold:#F5B847;
        --green:#34D399;--red:#F87171}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--body);
       font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:1400px;margin:0 auto;padding:32px 20px 80px}
  h1{color:var(--bright);font-size:22px;margin:0 0 6px}
  h2{color:var(--bright);font-size:16px;margin:44px 0 4px;font-weight:700}
  .sub{color:var(--muted);font-size:14px;margin:0 0 8px;max-width:82ch}
  .row{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;margin-top:16px}
  .col h3{font-size:12px;margin:0 0 9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em}
  .col.b h3{color:var(--faint)}
  .col.a h3{color:var(--green)}
  .phone{width:390px;background:var(--surface);border:1px solid var(--border);border-radius:22px;overflow:hidden}
  .a .phone{border-color:#34D39959;box-shadow:0 0 0 1px #34D39926}
  .bar{height:32px;background:#111C31;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 14px;color:var(--faint);font-size:11px}
  .screen{padding:12px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px}
  .card.plain{background:var(--surface)}
  .card.wide{max-width:860px;padding:22px 24px}
  .kicker{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:var(--muted);margin:0 0 10px}
  .kicker.mt{margin-top:16px}
  .kicker.mt2{margin-top:30px;padding-top:22px;border-top:1px solid var(--border)}
  ul.bul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
  ul.bul li{position:relative;padding-left:16px;font-size:13px;line-height:1.5;color:var(--body)}
  ul.bul li:before{content:"";position:absolute;left:0;top:7px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
  .moat{margin-top:14px;border:1px solid #F5B84766;background:#F5B8470D;border-radius:12px;padding:14px 16px}
  .moat.big{margin-top:0;border-color:#F5B847A6;background:#F5B84714;padding:16px}
  .moat.big .mtitle{font-size:14.5px}
  .mtitle{margin:0;font-size:13px;font-weight:700;color:var(--bright)}
  .mbody{margin:6px 0 0;font-size:12.5px;line-height:1.6;color:var(--body)}
  .btn{display:block;margin-top:18px;background:var(--green);color:#06231A;text-align:center;
       font-weight:800;font-size:15px;padding:13px 0;border-radius:12px;text-decoration:none}
  .grid{display:grid;grid-template-columns:minmax(0,1fr) 4.5rem 4.5rem;align-items:center}
  .gh{padding:0 0 8px;border-bottom:1px solid var(--border)}
  .ch{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);text-align:center}
  .ch.us{color:var(--green)}
  .gr{padding:9px 0;border-bottom:1px solid #1B2942}
  .gr.last{border-bottom:0}
  .gm{border-left:2px solid #F5B84780;background:#F5B84708;padding-left:8px}
  .gr.lead{background:#F5B8471F;border-left-color:var(--gold);box-shadow:inset 0 0 0 1px #F5B84726}
  .ln{font-size:12.5px;font-weight:400;color:var(--body)}
  .lb{font-size:12.5px;font-weight:600;color:var(--bright)}
  .sub{font-size:11px;color:var(--muted);line-height:1.45}
  .cc{text-align:center;font-size:13px}
  .yes{color:var(--green);font-weight:800}.no{color:var(--faint)}
  .part{font-size:9.5px;color:var(--gold);text-transform:uppercase;letter-spacing:.06em}
  .lbl{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);margin:0 0 8px}
  .lbl.aft{color:var(--green);margin-top:26px;text-transform:none;letter-spacing:.02em;font-size:11.5px}
  .hero{font-size:26px;font-weight:700;color:var(--bright);line-height:1.15;margin:0}
  .hsub{margin:10px 0 0;font-size:14px;line-height:1.6;color:var(--muted);max-width:60ch}
  .hsub b{color:var(--bright)}
  .opt{margin:22px 0 0;font-size:12.5px;line-height:1.6;color:var(--muted);border-top:1px dashed var(--border);padding-top:14px}
  .opt b{color:var(--body)}
  .mono{margin:0;font:12.5px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;
        background:#111C31;border:1px solid var(--border);border-radius:8px;padding:12px 14px}
  .keep{color:var(--body)}
  .lost{color:var(--red);text-decoration:line-through;opacity:.75}
  .stage{margin:0 0 14px;font-size:12.5px;color:var(--faint);line-height:1.6}
  .say{margin:0 0 12px;font-size:14.5px;line-height:1.7;color:var(--body);border-left:2px solid #38BDF880;padding-left:14px}
  .say b{color:var(--bright)}
  .foot2{margin:18px 0 0;font-size:11.5px;line-height:1.6;color:var(--faint);border-top:1px solid var(--border);padding-top:12px}
  .tag{display:inline-block;margin-right:6px;font-size:10px;font-weight:700;letter-spacing:.06em;
       color:var(--gold);background:#F5B84714;border:1px solid #F5B84733;border-radius:4px;padding:1px 5px}
  .notes{margin-top:52px;border-top:1px solid var(--border);padding-top:20px;color:var(--muted);font-size:14px;max-width:84ch}
  .notes p{margin:0 0 12px}.notes b{color:var(--bright);font-weight:600}
  code{background:#111C31;border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-size:12.5px;color:var(--accent)}
</style></head>
<body><div class="wrap">
  <h1>Lead with the calls</h1>
  <p class="sub">Nothing here is applied. Left is what is on your disk right now; right is what promoting the call list to the lead position looks like. The paid report section does not change in any of these.</p>

  <h2>1 · The free snapshot</h2>
  <p class="sub">Same components, same copy, order swapped. The only line that tells the buyer what to <i>do</i> stops being the footnote to five lines about what we tell them.</p>
  <div class="row">
    <div class="col b"><h3>Before — closer</h3>
      <div class="phone"><div class="bar">engine.foundersplinko.com</div><div class="screen">${teaserBefore}</div></div></div>
    <div class="col a"><h3>After — lead</h3>
      <div class="phone"><div class="bar">engine.foundersplinko.com</div><div class="screen">${teaserAfter}</div></div></div>
  </div>

  <h2>2 · The feature table</h2>
  <p class="sub">Nine rows either way. On the left it is row nine, styled identically to four other amber rows, so nothing is the headline. On the right it opens the moat block and is the one row carrying weight.</p>
  <div class="row">
    <div class="col b"><h3>Before — row 9 of 9</h3>
      <div class="phone"><div class="bar">engine.foundersplinko.com</div><div class="screen">${matrixBefore}</div></div></div>
    <div class="col a"><h3>After — row 4, opens the moat</h3>
      <div class="phone"><div class="bar">engine.foundersplinko.com</div><div class="screen">${matrixAfter}</div></div></div>
  </div>

  <h2>3 · The homepage</h2>
  <p class="sub">Two separate changes: the subhead a visitor reads, and the meta description Google truncates. Red strikethrough is past the cut — invisible in search results.</p>
  <div class="row">${home}</div>

  <h2>4 · The demo you have been struggling to give</h2>
  <p class="sub">You said you always have to start with the numbers, and that the live report does not show well. This is the alternative: the numbers come second.</p>
  <div class="row">${demo}</div>

  <div class="notes">
    <p><b>What this costs.</b> Two component edits, two string edits, no new tests — the shelf lint already holds the promise on every surface regardless of position, so a reorder cannot silently drop it. About twenty minutes, and it lands on the same commit as the seven surfaces already on your disk.</p>
    <p><b>What I would not do in the same week.</b> Change the H1, and change the findings-email subject line. Both are your strongest existing organic and deliverability signals, and churning them alongside a positioning change means that if the number moves you will not know which lever did it.</p>
    <p><b>The honest limitation.</b> <code>teaser_viewed</code> and <code>upgrade_clicked</code> fire with no variant dimension, so this is an opinion, not an experiment. You will see it in aggregate conversion or you will not see it at all. Given August 17 I would take the opinion — instrumenting a clean A/B costs more days than the reorder is likely to win, and revenue in production is the requirement.</p>
    <p><b>Why the demo script matters more than any of the layout changes.</b> The layout moves conversion a few points if it works. The open changes what the product <i>is</i> in the listener's head — from &ldquo;a better read of a document I already have&rdquo; to &ldquo;the thing that tells me who to call on Monday.&rdquo; That reframe is worth more in a room with Nate than every pixel above it.</p>
  </div>
</div></body></html>`;

writeFileSync(join(process.cwd(), "lead-with-calls-mock.html"), html, "utf8");
console.log("wrote lead-with-calls-mock.html");
console.log(`meta desc: before ${DESC_BEFORE.length} chars (${DESC_BEFORE.length - CUT} past the cut), after ${DESC_AFTER.length} chars (0 past the cut)`);
