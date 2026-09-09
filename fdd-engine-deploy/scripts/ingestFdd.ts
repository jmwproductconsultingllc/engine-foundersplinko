// scripts/ingestFdd.ts
// PDF → full DiligenceResult → a batch JSONL line the corpus converter reads.
//
//   npx tsx scripts/ingestFdd.ts <file.pdf> [more.pdf …] \
//     [--out harness/runs/hfc-2026-08-24.jsonl] \
//     [--liquid 250000] [--networth 250000]
//
// THE GAP THIS FILLS. scripts/proveNewFields.ts extracts and inspects; it does
// not score, underwrite, or produce anything the catalog can consume.
// lib/pipeline.ts runDiligence() does the whole chain, and nothing on disk
// called it from a file path. So there was no way to take an FDD off the desk
// and turn it into a record — every corpus entry came from a harness batch run
// that is not in this repo.
//
// WHAT IT WRITES, and what it deliberately does not.
//
//   --out <path>   one JSONL line per PDF: { file, status, report }, appended.
//                  This is the exact shape scripts/jsonl-to-brands.ts reads.
//   <stem>.result.json   the standalone DiligenceResult beside the JSONL, for
//                  rendering a report without minting anything.
//
// IT DOES NOT WRITE data/brands. That step is gated on purpose: the converter
// skips any stem with no REGISTRY entry, because a slug is a permanent public
// URL and data/brands is the static source for the public catalog. Deciding to
// publish a brand page is a separate, deliberate act — see
// scripts/registerBrand.ts. Getting a corrected REPORT and publishing a public
// PAGE are different things and this script only does the first.
//
// The determinism cache is keyed on the file hash, so re-running the same PDF
// costs nothing and returns byte-identical extraction.
// BRAND-JSON-EXEMPT: writes a .result.json snapshot and a batch JSONL line, never a
// data/brands record. scripts/jsonl-to-brands.ts is the writer that mints records from
// this output, and it is held to this contract. Caught by the detector because the
// header above names data/brands in order to say it does NOT write there.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { runDiligence } from "../lib/pipeline";

const args = process.argv.slice(2);
const flag = (name: string, dflt: string | null = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const pdfs = args.filter((a, i) => a.toLowerCase().endsWith(".pdf") && args[i - 1]?.startsWith("--") !== true);

if (pdfs.length === 0) {
  console.error("usage: npx tsx scripts/ingestFdd.ts <file.pdf> [more.pdf …] [--out batch.jsonl] [--liquid N] [--networth N]");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error("No API key set. Needs GEMINI_API_KEY or ANTHROPIC_API_KEY.");
  process.exit(1);
}

const outJsonl = flag("out");
const buyer = {
  liquidCapital: Number(flag("liquid", "250000")),
  netWorth: Number(flag("networth", "250000")),
};

async function one(pdfPath: string) {
  const buf = readFileSync(pdfPath);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const fileHash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const stem = path.basename(pdfPath).replace(/\.pdf$/i, "");

  console.log(`\n── ${stem} (${(buf.length / 1e6).toFixed(1)} MB, hash ${fileHash})`);
  const report = await runDiligence({ bytes, mimeType: "application/pdf", buyer, fileHash });

  const rev = report.scoring?.midCohort?.monthlyRevenue ?? null;
  const usd = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}/mo`);
  console.log(`   ${report.extracted.brandName}`);
  console.log(`   top line ${usd(rev)}   risk ${report.scoring?.riskLevel ?? "—"}`);
  if ((report.scoring as { item19Unusable?: unknown })?.item19Unusable) {
    console.log(`   REFUSED — Item 19 could not produce a per-outlet figure`);
  }

  const resultPath = pdfPath.replace(/\.pdf$/i, ".result.json");
  writeFileSync(resultPath, JSON.stringify(report, null, 2));
  console.log(`   result → ${resultPath}`);

  if (outJsonl) {
    mkdirSync(path.dirname(outJsonl), { recursive: true });
    appendFileSync(outJsonl, JSON.stringify({ file: `${stem}.pdf`, status: "ok", report }) + "\n");
    console.log(`   batch line appended → ${outJsonl}`);
  }
}

async function main() {
  for (const p of pdfs) {
    try {
      await one(p);
    } catch (e) {
      console.error(`   FAILED: ${(e as Error)?.message ?? e}`);
      if (outJsonl) {
        appendFileSync(outJsonl, JSON.stringify({ file: path.basename(p), status: "failed", error: String((e as Error)?.message ?? e) }) + "\n");
      }
    }
  }
  console.log(
    outJsonl
      ? `\nNothing has been published. To mint public brand pages from this batch:\n` +
          `  1. npx tsx scripts/registerBrand.ts <file.pdf> --vertical "…" --category "…" --write\n` +
          `  2. npx tsx scripts/jsonl-to-brands.ts ${outJsonl}\n` +
          `A stem with no registry entry is skipped, deliberately.`
      : `\nNo --out given, so no batch line was written. The .result.json files are standalone.`,
  );
}

main().catch((e) => {
  console.error("\nINGEST FAILED:", (e as Error)?.message ?? e);
  process.exit(1);
});
