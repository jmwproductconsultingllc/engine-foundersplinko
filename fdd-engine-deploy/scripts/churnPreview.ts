/**
 * scripts/churnPreview.ts — renders the System Scale card, before and after.
 *
 * Every card below is built by calling lib/churn.ts on the systemScale block
 * exactly as it sits in data/brands/*.json today. Nothing is re-extracted and
 * nothing is hand-written: what the phone shows here is what a paid report
 * shows on the next render.
 *
 * Output: churn-preview.html (frames are 390px — an iPhone in Safari).
 */
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { analyzeChurn, type SystemScaleCounts } from "../lib/churn";
import { BASIS_STYLE, basisColor } from "../lib/basis";
import { join } from "node:path";

const SHOW = [
  ["tint-world", "Tint World"],
  ["stretch-zone", "Stretch Zone"],
  ["crumbl", "Crumbl"],
  ["spenga", "SPENGA"],
  ["dunkin", "Dunkin'"],
  ["the-back-nine", "The Back Nine"],
] as const;

function scale(slug: string): SystemScaleCounts {
  const d = JSON.parse(readFileSync(join(process.cwd(), "data", "brands", `${slug}.json`), "utf8"));
  return (d?.result?.extracted?.systemScale ?? {}) as SystemScaleCounts;
}

const n = (v: number | null | undefined) => (v == null ? null : v.toLocaleString());

function statCell(label: string, value: string | null, opts: { tone?: string; sub?: string | null } = {}) {
  const missing = value == null;
  const color = missing ? "#8194B0" : opts.tone === "warn" ? "#F59E0B" : "#F1F5F9";
  const size = missing ? "font-size:14px;font-weight:600" : "font-size:18px;font-weight:700";
  return `<div class="stat">
    <p class="slab">${label}</p>
    <p style="color:${color};${size};margin:0">${value ?? "Not disclosed"}</p>
    ${opts.sub ? `<p class="ssub">${opts.sub}</p>` : ""}
  </div>`;
}

/** The card as it ships today: four counts, no denominator, em-dash for absent. */
function beforeCard(s: SystemScaleCounts): string {
  const cell = (label: string, v: number | null | undefined, red = false) =>
    `<div class="stat"><p class="slab">${label}</p><p style="color:${red && v != null ? "#F87171" : "#F1F5F9"};font-size:18px;font-weight:700;margin:0">${n(v) ?? "—"}</p></div>`;
  return `<div class="card">
    <h3>System Scale <span class="src">(${s.sourcePage ?? ""})</span></h3>
    <div class="grid">
      ${cell("Total units", s.totalUnits)}
      ${cell("Opened (yr)", s.openedLastYear)}
      ${cell("Closed (yr)", s.closedLastYear, true)}
      ${cell("Transfers (yr)", s.transfersLastYear)}
    </div>
  </div>`;
}

function afterCard(s: SystemScaleCounts): string {
  const ch = analyzeChurn(s);
  const tierColor = ch.tier === "High" ? "#F59E0B" : ch.tier === "Medium" ? "#F5B847" : "#34D399";
  const bc = basisColor(ch.basis);

  const body = ch.computable && ch.ownerTurnover
    ? `<div class="turnrow">
         <span class="slab">Owner turnover</span>
         <span class="turnpct">${ch.ownerTurnover.pct}%</span>
         <span class="chip" style="color:${bc};border-color:${bc}33;background:${bc}14">${BASIS_STYLE[ch.basis].label}</span>
         ${ch.tier ? `<span class="chip" style="color:${tierColor};border-color:${tierColor}44">${ch.tier.toUpperCase()}</span>` : ""}
       </div>
       <p class="head">${ch.headline}</p>
       ${ch.tell ? `<p class="tell">${ch.tell}</p>` : ""}
       ${ch.baseNote ? `<p class="foot">${ch.baseNote}</p>` : ""}`
    : `<p class="head">${ch.unavailable}</p>`;

  return `<div class="card">
    <h3>System Scale &amp; Turnover <span class="src">(${s.sourcePage ?? ""})</span></h3>
    <div class="grid">
      ${statCell("Total units", n(s.totalUnits), { sub: s.totalUnits != null ? "at year end" : null })}
      ${statCell("Opened (yr)", n(s.openedLastYear))}
      ${statCell("Closed (yr)", n(s.closedLastYear), { tone: "warn", sub: ch.closed ? `${ch.closed.pct}% of starting units` : null })}
      ${statCell("Changed hands (yr)", n(s.transfersLastYear), { sub: ch.transfers ? `${ch.transfers.pct}% of starting units` : null })}
    </div>
    <div class="rule">${body}<p class="foot">${ch.question}</p></div>
  </div>`;
}

const blocks = SHOW.map(([slug, name]) => {
  const s = scale(slug);
  return `<section class="brand">
    <h2>${name}</h2>
    <div class="cols">
      <div class="col"><p class="cap bad">Before</p><div class="phone"><div class="bar">engine.foundersplinko.com</div><div class="screen">${beforeCard(s)}</div></div></div>
      <div class="col"><p class="cap good">After</p><div class="phone"><div class="bar">engine.foundersplinko.com</div><div class="screen">${afterCard(s)}</div></div></div>
    </div>
  </section>`;
}).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Franchise Edge — system turnover, before &amp; after</title>
<style>
  :root{--bg:#0B1220;--card:#16223B;--surface:#0E1729;--border:#27344F;--accent:#38BDF8;
        --body:#CBD5E1;--muted:#8194B0;--faint:#64748B;--bright:#F1F5F9}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--body);
       font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:980px;margin:0 auto;padding:32px 20px 80px}
  h1{color:var(--bright);font-size:22px;margin:0 0 6px}
  .sub{color:var(--muted);font-size:14px;margin:0 0 28px;max-width:68ch}
  .brand{margin-top:38px;border-top:1px solid var(--border);padding-top:22px}
  .brand h2{font-size:16px;color:var(--bright);margin:0 0 12px}
  .cols{display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start}
  .cap{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px;font-weight:600}
  .bad{color:#F59E0B}.good{color:#34D399}
  .phone{width:390px;background:var(--surface);border:1px solid var(--border);border-radius:22px;overflow:hidden}
  .bar{height:32px;background:#111C31;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 14px;color:var(--faint);font-size:11px}
  .screen{padding:12px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px}
  .card h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin:0 0 14px}
  .src{color:var(--muted);font-size:11px;text-transform:none;letter-spacing:0;font-weight:400}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .slab{font-size:11px;text-transform:uppercase;font-weight:700;color:var(--muted);margin:0 0 2px}
  .ssub{font-size:10px;color:var(--muted);margin:2px 0 0;line-height:1.3}
  .stat p{margin:0}
  .rule{margin-top:18px;border-top:1px solid var(--border);padding-top:14px}
  .turnrow{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline}
  .turnpct{font-size:18px;font-weight:700;color:var(--bright);font-variant-numeric:tabular-nums}
  .chip{font-size:10px;letter-spacing:.07em;border:1px solid;border-radius:4px;padding:1px 6px;font-weight:600;white-space:nowrap}
  .head{font-size:12.5px;color:var(--body);margin:8px 0 0;line-height:1.55}
  .tell{font-size:12.5px;color:var(--body);margin:12px 0 0;line-height:1.55;border-left:2px solid #38BDF880;padding-left:12px}
  .foot{font-size:11px;color:var(--muted);margin:12px 0 0;line-height:1.55}
  .notes{margin-top:44px;border-top:1px solid var(--border);padding-top:20px;color:var(--muted);font-size:14px;max-width:74ch}
  .notes p{margin:0 0 12px}.notes b{color:var(--bright);font-weight:600}
  code{background:#111C31;border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-size:12.5px;color:var(--accent)}
</style></head>
<body><div class="wrap">
  <h1>System turnover — before and after</h1>
  <p class="sub">Every card is rendered by calling <code>lib/churn.ts</code> on the record already on disk. No re-extraction: this is arithmetic over four figures every report already carries, so it lands on reports already sold.</p>
  ${blocks}
  <div class="notes">
    <p><b>The denominator is outlets open at the START of the year.</b> Item 20's headline count is outlets at year end. Tint World ended the year at 149, having opened 11 and closed 7 — so 145 were open on day one, and that is what the rates divide by. Using 149 would print 20.8% instead of 21.4%: flattering, and wrong on every growing system, which is the kind most likely to be sold to a first-time buyer.</p>
    <p><b>A transfer is not a closure and it is not a success either.</b> Stretch Zone closed nothing and moved 67 units to new owners. Item 20 discloses transfers with no reason attached, so the card names the shape and hands over the question rather than deciding what it means.</p>
    <p><b>A figure that does not exist gets words.</b> Dunkin' and The Back Nine have no closure or transfer counts on file. The old card printed an em-dash, which reads as zero. The new one says what is missing and where to find it.</p>
    <p><b>Red is spoken for.</b> The closure count was painted red — the warning colour everywhere else in this product. A closure count is a disclosure, not our verdict on the brand, so it is amber now.</p>
  </div>
</div></body></html>`;

writeFileSync(join(process.cwd(), "churn-preview.html"), html, "utf8");
console.log("wrote churn-preview.html");
for (const [slug] of SHOW) {
  const c = analyzeChurn(scale(slug));
  console.log(
    slug.padEnd(16),
    c.computable ? `base=${c.base} turnover=${c.ownerTurnover?.pct}% tier=${c.tier ?? "(small)"}` : "WORDS",
  );
}
