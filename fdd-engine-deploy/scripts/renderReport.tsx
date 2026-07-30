/**
 * scripts/renderReport.tsx — static render of the paid report for visual QA.
 * Not shipped; it exists so the reorder can be screenshotted without a server.
 *   npx tsx scripts/renderReport.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import DiligenceReport from "../components/DiligenceReport";
import { getSampleResult } from "../lib/sampleReport";
import type { DiligenceResult } from "../lib/types";
import { join } from "node:path";

const page = (body: string, css: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style>
<style>body{background:#0B1220;margin:0;padding:24px;font-family:ui-sans-serif,system-ui,sans-serif}
.wrap{max-width:960px;margin:0 auto}</style></head>
<body><div class="wrap">${body}</div></body></html>`;

const css = process.argv[3] ? require("node:fs").readFileSync(process.argv[3], "utf8") : "";

const base = getSampleResult();
const variant = process.argv[2] ?? "levered";

const result: DiligenceResult =
  variant === "allcash"
    ? ({
        ...base,
        underwriting: { ...base.underwriting, recommendedLoan: 0, capitalGap: 0, sbaLoanRequired: false },
      } as DiligenceResult)
    : base;

writeFileSync(
  join(process.cwd(), `out-${variant}.html`),
  page(renderToStaticMarkup(<DiligenceReport result={result} />), css),
);
console.log("wrote out-" + variant + ".html");
