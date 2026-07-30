/**
 * scripts/mobilePreview.ts — renders the BEFORE/AFTER mobile density preview.
 *
 * Both columns are built from the SAME ladder object and the same Item 7 line
 * items, so every dollar figure on the left equals the one on the right. The
 * only thing that differs is the rendering rule. That is the claim this commit
 * makes and this is the artifact that proves it.
 *
 * Output: mobile-density-preview.html (open at any width; the frames are 390px).
 */
import { getSampleResult } from "../lib/sampleReport";
import { applyRentCorrection } from "../lib/rentCorrection";
import { buildLadderInput } from "../lib/ladderInput";
import { buildCashLadder, type Rung, type Money } from "../lib/ladder";
import { costBandsFor } from "../lib/insights";
import { range } from "../lib/range";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const r = applyRentCorrection(getSampleResult());
const input = buildLadderInput(r);
const l = buildCashLadder(input);
const bands = costBandsFor(r.extracted?.conceptType, r.extracted?.staffingModel);

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** The OLD join: an ordinary space on both sides of the dash. */
const oldRange = (a: string, b: string) => `${a} – ${b}`;

const money = (v: Money | null, join: (a: string, b: string) => string) =>
  v ? join(usd0(v.lo), usd0(v.hi)) : "—";

const OLD_NOTE =
  "Cost of goods, labor, and other operating costs are never disclosed in an FDD. These are category ranges — replace them with real franchisee numbers from Item 20 before you sign.";
const OLD_SOURCE = `${bands.label} category bands`;
const COST = new Set(["cogs", "labor", "otherOpex"]);

const CHIP: Record<string, [string, string]> = {
  disclosed: ["#34D399", "DISCLOSED"],
  derived: ["#60A5FA", "DERIVED"],
  benchmark: ["#A78BFA", "BENCHMARK"],
  inferred: ["#F5B847", "INFERRED"],
  buyer: ["#38BDF8", "YOUR FIGURE"],
};

function rungRow(x: Rung, mode: "before" | "after"): string {
  const before = mode === "before";
  const join = before ? oldRange : range;
  const [hex, word] = CHIP[x.basis] ?? ["#8194B0", x.basis.toUpperCase()];
  const src = before && COST.has(x.id) ? OLD_SOURCE : x.source;
  const note = before && COST.has(x.id) ? OLD_NOTE : null;
  const val = money(x.monthly, join);
  return `
  <tr class="rung">
    <td class="n">${x.n}</td>
    <td class="lbl">
      <div class="lblrow"><span class="ltxt">${x.label}</span> <span class="chip" style="color:${hex};border-color:${hex}33;background:${hex}14">${word}</span></div>
      <div class="src">${src}</div>
      ${note ? `<div class="note">${note}</div>` : ""}
    </td>
    <td class="val${before ? "" : " nowrap"}">${val}</td>
  </tr>`;
}

function ladderTable(mode: "before" | "after"): string {
  const rows = l.rungs.filter((x) => x.n >= 5 && x.n <= 12).map((x) => rungRow(x, mode)).join("");
  const foot =
    mode === "before"
      ? OLD_NOTE
      : `${l.blockNote}`;
  return `<table class="ladder"><tbody>${rows}</tbody></table><p class="foot">${foot}</p>`;
}

/* ───────────────────────────── Item 7 ───────────────────────────── */

const items = (r.extracted?.item17?.lineItems ?? []).filter((i) => i.low != null || i.high != null);

function costRows(mode: "before" | "after"): string {
  const before = mode === "before";
  return items
    .slice(0, 14)
    .map((i) => {
      const lo = i.low != null ? usd0(i.low) : "—";
      const hi = i.high != null ? usd0(i.high) : "—";
      const v = before ? oldRange(lo, hi) : range(lo, hi);
      return `<div class="crow"><span class="ccat${before ? "" : " minw"}">${i.category}</span><span class="cval${before ? "" : " shrink"}">${v}</span></div>`;
    })
    .join("");
}

const totLo = usd0(r.extracted?.item17?.initialInvestmentLow ?? 0);
const totHi = usd0(r.extracted?.item17?.initialInvestmentHigh ?? 0);

const collapsed = items.filter(
  (i) => i.low != null && i.high != null && usd0(i.low) === usd0(i.high),
).length;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Franchise Edge — mobile density, before &amp; after</title>
<style>
  :root{--bg:#0B1220;--card:#16223B;--surface:#0E1729;--border:#27344F;--accent:#38BDF8;
        --body:#CBD5E1;--muted:#8194B0;--faint:#64748B;--bright:#F1F5F9}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--body);
       font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:32px 20px 72px}
  h1{color:var(--bright);font-size:22px;margin:0 0 6px}
  .sub{color:var(--muted);font-size:14px;margin:0 0 6px;max-width:60ch}
  .rule{color:var(--faint);font-size:13px;margin:0 0 28px;max-width:66ch}
  .cols{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
  .col{flex:0 0 auto}
  .caption{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px;font-weight:600}
  .bad{color:#F59E0B}.good{color:#34D399}
  .phone{width:390px;background:var(--surface);border:1px solid var(--border);
         border-radius:22px;overflow:hidden}
  .bar{height:34px;background:#111C31;border-bottom:1px solid var(--border);
       display:flex;align-items:center;padding:0 14px;color:var(--faint);font-size:11px}
  .screen{padding:14px}
  h2{font-size:15px;color:var(--bright);margin:0 0 10px;font-weight:600}
  table.ladder{width:100%;border-collapse:collapse}
  .rung td{border-top:1px solid var(--border);padding:8px 0;vertical-align:top}
  td.n{width:20px;color:var(--faint);font-size:12px;padding-right:6px;font-variant-numeric:tabular-nums}
  td.lbl{padding-right:8px}
  .lblrow{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
  .ltxt{color:var(--body);font-size:13.5px}
  .chip{font-size:9px;letter-spacing:.07em;border:1px solid;border-radius:4px;
        padding:1px 5px;white-space:nowrap;font-weight:600}
  .src{color:var(--faint);font-size:11.5px;margin-top:3px}
  .note{color:var(--faint);font-size:11.5px;margin-top:5px;line-height:1.45}
  td.val{text-align:right;color:var(--body);font-variant-numeric:tabular-nums;
         font-size:13.5px;width:104px}
  td.val.nowrap{white-space:nowrap}
  p.foot{color:var(--faint);font-size:11.5px;line-height:1.5;margin:12px 0 0;
         border-top:1px solid var(--border);padding-top:10px}
  .tot{color:var(--muted);font-size:13px;margin:0 0 10px}
  .tot b{color:var(--bright)}
  .tot .nowrap{white-space:nowrap}
  .crow{display:flex;justify-content:space-between;gap:12px;align-items:baseline;
        font-size:13px;padding:5px 0;border-bottom:1px solid #1E2A44}
  .ccat{color:var(--body)}
  .ccat.minw{min-width:0}
  .cval{color:var(--bright);font-weight:500;font-variant-numeric:tabular-nums;text-align:right}
  .cval.shrink{flex-shrink:0;white-space:nowrap}
  .safari{height:44px;background:#0A1120;border-top:1px solid var(--border);
          display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:11px}
  .notes{margin-top:36px;border-top:1px solid var(--border);padding-top:20px;
         color:var(--muted);font-size:14px;max-width:72ch}
  .notes p{margin:0 0 12px}
  .notes b{color:var(--bright);font-weight:600}
  code{background:#111C31;border:1px solid var(--border);border-radius:4px;padding:1px 5px;
       font-size:12.5px;color:var(--accent)}
</style></head>
<body><div class="wrap">
  <h1>Mobile density — before and after</h1>
  <p class="sub">Both columns are rendered from the same ladder object and the same Item 7 line items. Every dollar figure on the left equals the one on the right; only the rendering rule differs.</p>
  <p class="rule">Frames are 390px — an iPhone 14/15 in Safari. Scroll each frame's content the way you would on the phone.</p>

  <div class="cols">
    <div class="col">
      <p class="caption bad">Before — the cash ladder</p>
      <div class="phone"><div class="bar">engine.foundersplinko.com</div>
        <div class="screen"><h2>The cash ladder — ${l.revenueLabel}</h2>${ladderTable("before")}</div>
      </div>
    </div>
    <div class="col">
      <p class="caption good">After — the cash ladder</p>
      <div class="phone"><div class="bar">engine.foundersplinko.com</div>
        <div class="screen"><h2>The cash ladder — ${l.revenueLabel}</h2>${ladderTable("after")}</div>
      </div>
    </div>
  </div>

  <div class="cols" style="margin-top:40px">
    <div class="col">
      <p class="caption bad">Before — what it costs</p>
      <div class="phone"><div class="bar">engine.foundersplinko.com</div>
        <div class="screen">
          <p class="tot">Estimated total: <b>${oldRange(totLo, totHi)}</b></p>
          ${costRows("before")}
        </div>
        <div class="safari">Safari URL bar — last row lands under here</div>
      </div>
    </div>
    <div class="col">
      <p class="caption good">After — what it costs</p>
      <div class="phone"><div class="bar">engine.foundersplinko.com</div>
        <div class="screen">
          <p class="tot">Estimated total: <b class="nowrap">${range(totLo, totHi)}</b></p>
          ${costRows("after")}
          <div style="height:44px"></div>
        </div>
        <div class="safari">Safari URL bar — content now clears it</div>
      </div>
    </div>
  </div>

  <div class="notes">
    <p><b>The range rule.</b> A low/high pair is one figure. It is joined in <code>lib/range.ts</code> with a no-break space on both sides of the dash, or it is not joined at all — a build lint fails on a spaced en-dash written anywhere under <code>lib/</code>, <code>components/</code> or <code>app/</code>. Ten hand-rolled copies across five files were converted.</p>
    <p><b>A caveat that applies to a block is stated once.</b> The operating-cost warning was printed on rungs 6, 7 and 8 and again in the footer — four copies of one sentence, roughly a third of the phone screen. It now sits once under the table. Each of those rungs keeps its BENCHMARK chip, which is what tells a scanning reader the figure is a category band.</p>
    <p><b>Each cost rung's source is its own band.</b> The "% of revenue" column is hidden below the md breakpoint, so on a phone the band — the one thing that differed between rungs 6, 7 and 8 — never reached the screen, while the identical category label reached it three times. That is now inverted.</p>
    <p><b>Item 7.</b> ${collapsed} row${collapsed === 1 ? "" : "s"} in this sample published as <code>$X – $X</code>; an equal pair now collapses to one figure. The label wraps and the dollars do not, which was the other way round. And <code>#report-root</code> carries <code>padding-bottom: calc(4rem + env(safe-area-inset-bottom))</code> so Safari's URL bar stops eating the last row.</p>
  </div>
</div></body></html>`;

writeFileSync(join(process.cwd(), "mobile-density-preview.html"), html, "utf8");
console.log("wrote mobile-density-preview.html");
console.log("rungs 5-12 rendered:", l.rungs.filter((x) => x.n >= 5 && x.n <= 12).length);
console.log("item 7 rows rendered:", Math.min(items.length, 14), "of", items.length, "| identical-pair rows:", collapsed);
