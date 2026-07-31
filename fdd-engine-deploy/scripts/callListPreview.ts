/**
 * scripts/callListPreview.ts — the new "Who To Call" section, at phone width.
 *
 * Every card below is built by calling lib/callList.ts on the record exactly as
 * it sits in data/brands/*.json today. Nothing is re-extracted, nothing is
 * hand-written, and no franchisee name touches this file or our database: the
 * roster is in the buyer's own copy of the FDD, which the franchisor is required
 * to give them. What ships is which cohorts are worth calling and what to ask.
 *
 * Output: calllist-preview.html (frames are 390px — an iPhone in Safari).
 *
 * BRAND-JSON-EXEMPT: reads data/brands and writes only an HTML preview to the
 * repo root — it never writes a record back, so the on-disk format contract in
 * lib/brandJson.test.ts does not apply here.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildCallList, type CallListInput } from "../lib/callList";
import { BASIS_STYLE, basisColor } from "../lib/basis";
import { join } from "node:path";

const SHOW = [
  ["tint-world", "Tint World", "all three cohorts; bands derived from annual volume"],
  ["crumbl", "Crumbl", "disclosed monthly bands, 9.4× spread"],
  ["stretch-zone", "Stretch Zone", "67 transfers, zero closures — the sellers are the call"],
  ["dunkin", "Dunkin'", "8,780 outlets: filter, do not work the list in order"],
  ["alloy-personal-training", "Alloy Personal Training", "quartile bands, 8 transfers"],
  ["the-back-nine", "The Back Nine", "no closure or transfer counts on file"],
] as const;

function input(slug: string): CallListInput {
  const e = JSON.parse(readFileSync(join(process.cwd(), "data", "brands", `${slug}.json`), "utf8"))?.result?.extracted;
  return {
    totalUnits: e?.systemScale?.totalUnits,
    closedLastYear: e?.systemScale?.closedLastYear,
    transfersLastYear: e?.systemScale?.transfersLastYear,
    item20Page: e?.systemScale?.sourcePage,
    cohorts: e?.item19?.cohorts,
    item19Page: e?.item19?.sourcePage,
  };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function card(slug: string): string {
  const cl = buildCallList(input(slug));
  if (!cl.available) {
    return `<div class="card"><h3>Who To Call, And What To Ask</h3>
      <p class="head">${esc(cl.unavailable ?? "")}</p></div>`;
  }
  const blocks = cl.cohorts.map((c) => {
    const bc = basisColor(c.basis);
    return `<div class="cohort">
      <div class="hrow">
        <span class="ctitle">${esc(c.title)}</span>
        ${c.count != null ? `<span class="cnum">${c.count.toLocaleString()}</span>` : ""}
        <span class="chip" style="color:${bc};border-color:${bc}33;background:${bc}14">${BASIS_STYLE[c.basis].label}</span>
      </div>
      <p class="head">${esc(c.who)}</p>
      <p class="why">${esc(c.why)}</p>
      <ol>${c.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
      ${c.where ? `<p class="foot">${esc(c.where)}</p>` : ""}
    </div>`;
  }).join("");

  return `<div class="card">
    <h3>Who To Call, And What To Ask</h3>
    <p class="head">${esc(cl.intro)}</p>
    <div class="stack">${blocks}</div>
    <p class="foot">${esc(cl.note)}</p>
  </div>`;
}

const frames = SHOW.map(([slug, name, note]) => `<section class="brand">
  <h2>${name} <span class="note">— ${note}</span></h2>
  <div class="phone"><div class="bar">engine.foundersplinko.com</div>
  <div class="screen">${card(slug)}</div></div>
</section>`).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Franchise Edge — who to call</title>
<style>
  :root{--bg:#0B1220;--card:#16223B;--surface:#0E1729;--border:#27344F;--accent:#38BDF8;
        --body:#CBD5E1;--muted:#8194B0;--faint:#64748B;--bright:#F1F5F9}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--body);
       font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:1320px;margin:0 auto;padding:32px 20px 80px}
  h1{color:var(--bright);font-size:22px;margin:0 0 6px}
  .sub{color:var(--muted);font-size:14px;margin:0 0 28px;max-width:74ch}
  .row{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
  .brand h2{font-size:15px;color:var(--bright);margin:0 0 10px;font-weight:600}
  .note{color:var(--muted);font-size:12px;font-weight:400}
  .phone{width:390px;background:var(--surface);border:1px solid var(--border);border-radius:22px;overflow:hidden}
  .bar{height:32px;background:#111C31;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 14px;color:var(--faint);font-size:11px}
  .screen{padding:12px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px}
  .card h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin:0 0 12px}
  .stack{margin-top:16px;display:flex;flex-direction:column;gap:18px}
  .cohort{border:1px solid var(--border);border-radius:8px;padding:14px}
  .hrow{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
  .ctitle{font-size:13px;font-weight:600;color:var(--bright)}
  .cnum{font-size:17px;font-weight:700;color:var(--bright);font-variant-numeric:tabular-nums}
  .chip{font-size:10px;letter-spacing:.07em;border:1px solid;border-radius:4px;padding:1px 6px;font-weight:600;white-space:nowrap}
  .head{font-size:12.5px;color:var(--body);margin:8px 0 0;line-height:1.55}
  .why{font-size:12.5px;color:var(--body);margin:12px 0 0;line-height:1.55;border-left:2px solid #38BDF880;padding-left:12px}
  ol{margin:12px 0 0;padding-left:20px}
  li{font-size:12.5px;line-height:1.55;margin:0 0 6px;color:var(--body)}
  .foot{font-size:11px;color:var(--muted);margin:12px 0 0;line-height:1.55}
  .notes{margin-top:48px;border-top:1px solid var(--border);padding-top:20px;color:var(--muted);font-size:14px;max-width:80ch}
  .notes p{margin:0 0 12px}.notes b{color:var(--bright);font-weight:600}
  code{background:#111C31;border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-size:12.5px;color:var(--accent)}
</style></head>
<body><div class="wrap">
  <h1>Who to call, and what to ask</h1>
  <p class="sub">Every card is rendered by calling <code>lib/callList.ts</code> on the record already on disk. No re-extraction, no re-minting, and no franchisee names in our database — the roster is in the buyer's own FDD by law. This lands on reports already sold.</p>
  <div class="row">${frames}</div>
  <div class="notes">
    <p><b>We do not need the names to ship the call list.</b> Every diligence checklist ends on "validate with existing franchisees" and none of them says which ones, how many, or what to ask — so it stays advice people nod at rather than work people do. Item 20's exhibits already print every current franchisee and everyone who left last year, with phone numbers, in the document the franchisor is required to hand over. What was missing was the cohorts and the questions, and those are derivable from figures every record already carries.</p>
    <p><b>A cohort with no data is absent, never empty.</b> The Back Nine has no closure or transfer counts, so it gets no departed cohort — not a card reading "0 franchisees left." Where a system genuinely had a clean year, that sentence is itself the finding and it says so, along with how to check whether one clean year is a clean record.</p>
    <p><b>The exit reason is question one, not a label we apply.</b> Item 20 discloses departures with no reason attached per person, so nothing here characterises how any individual left. Stretch Zone closed nothing and moved 67 units; the card names the shape and hands over the question.</p>
    <p><b>Only like is ranked against like.</b> Item 19 puts sales bands, EBITDA bands and company-owned figures in one array. Tint World's EBITDA bands sit beside its sales bands, and reading one against the other would print a 20× spread that is really two units of measure. Company- and affiliate-owned outlets are excluded outright — they routinely gross about twice what franchised ones do and must never be shown as franchisee earnings.</p>
    <p><b>No sample size is printed beside a band.</b> Tint World's "Highest" row describes one centre and carries a sample size of 105, the population it was drawn from. Printing "105 outlets" beside a single outlet's figure is a false denominator, so the sample question is asked on the call instead, where the answer is reliable.</p>
    <p><b>Provenance is not assumed.</b> Item 19 discloses annual volume far more often than monthly. Where we divided by twelve to get a monthly figure — Tint World, Dunkin' and eighteen others — the cohort's chip drops to DERIVED rather than continuing to claim DISCLOSED.</p>
  </div>
</div></body></html>`;

writeFileSync(join(process.cwd(), "calllist-preview.html"), html, "utf8");
console.log("wrote calllist-preview.html");
for (const [slug] of SHOW) {
  const cl = buildCallList(input(slug));
  console.log(
    slug.padEnd(26),
    cl.available ? cl.cohorts.map((c) => `${c.key}${c.count != null ? `(${c.count})` : ""}`).join(" ") : "WORDS",
  );
}
