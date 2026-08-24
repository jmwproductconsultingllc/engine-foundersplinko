// scripts/proveNewFields.ts
// ONE FDD, ONE MODEL CALL, FIVE QUESTIONS.
//
//   GEMINI_API_KEY=... npx tsx scripts/proveNewFields.ts <file.pdf> [--json out.json]
//
// WHAT THIS IS FOR. The August 2026 modeling release added five schema fields
// and the extraction instructions to populate them. Every one of them is
// currently exercised by fixtures alone, because no stored record carries any
// of them. Fixtures prove the modeling layer reads a field correctly. They
// prove nothing about whether the extractor ever produces one.
//
// That distinction is the whole reason this file exists. FE-142 was committed
// green and did not reach the report, and the lesson written down at the time
// was: a passing test proves a function is right, not that the product
// changed. This is the same check, one layer up.
//
// WHAT IT DELIBERATELY DOES NOT DO. It writes no brand record, touches no
// registry, and adds nothing to data/brands. It extracts, prints what the five
// new fields came back as, and stops. Registering a brand is a separate,
// gated decision (see scripts/registerBrand.ts) and a slug is a permanent
// public URL.
//
// COST: one extraction call on one document.

import { readFileSync, writeFileSync } from "node:fs";
import { extractFdd } from "../lib/extractFdd";

const [, , pdfPath, ...rest] = process.argv;
if (!pdfPath) {
  console.error("usage: npx tsx scripts/proveNewFields.ts <file.pdf> [--json out.json]");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set. This script makes a real extraction call.");
  process.exit(1);
}

const jsonAt = rest.indexOf("--json");
const outPath = jsonAt >= 0 ? rest[jsonAt + 1] : null;

const show = (label: string, value: unknown, verdict: string) => {
  const got = value === undefined ? "ABSENT" : JSON.stringify(value, null, 2);
  console.log(`\n${"─".repeat(72)}\n${label}\n  ${verdict}\n${"─".repeat(72)}\n${got}`);
};

async function main() {
  const buf = readFileSync(pdfPath);
  console.log(`extracting ${pdfPath} (${(buf.length / 1e6).toFixed(1)} MB) …`);

  // No fileHash on purpose. extractFdd read-throughs a cache keyed on it, and
  // the point of this run is a FRESH extraction against the new instructions —
  // a cache hit would prove the old prompt still works.
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const { result: x, provider, fellBack } = await extractFdd(bytes, "application/pdf");

  console.log(`\nprovider: ${provider}${fellBack ? " (FELL BACK — the primary failed)" : ""}`);
  console.log(`brand: ${x.brandName} · items found: ${(x.documentCheck?.itemsFound ?? []).length}`);

  // 1 · FE-143 — is this business run from premises at all?
  show("1 · premises  (FE-143)", (x as unknown as Record<string, unknown>).premises,
    "Expect homeBased false for Two Maids — it leases 1,500–2,000 sq ft. A null block is a MISS only if the filing says otherwise.");

  // 2 · FE-140 — the Item 19 cost columns
  const cohorts = x.item19?.cohorts ?? [];
  show("2 · item19.cohorts[].disclosedCosts  (FE-140)",
    cohorts.map((c) => ({ label: c.label, disclosedCosts: (c as unknown as Record<string, unknown>).disclosedCosts })),
    "Two Maids discloses Direct Labor and Cleaning Materials per cohort across twelve charts, pp. 51–62. 2nd Quintile should read labor 254,990 and cogs 22,471. ANY cohort coming back without them is the miss this run exists to find.");

  // 3 · Bar-B-Clean class — how many outlets does each row cover?
  show("3 · item19.cohorts[].outletsCovered",
    cohorts.map((c) => ({ label: c.label, outletsCovered: (c as unknown as Record<string, unknown>).outletsCovered, sampleSize: c.sampleSize })),
    "Every quintile row covers 19 territories but reports PER territory, so outletsCovered should be 1 — not 19. Chart 12 is the opposite: 24 owners, 65 locations, so 65. Getting 19 on the quintiles would be worse than getting nothing.");

  // 4 · Gorilla class — currency
  show("4 · item19.currency", (x.item19 as unknown as Record<string, unknown>)?.currency,
    "Expect USD or null for a US filing. This is here so the field is exercised, not because Two Maids is at risk.");

  // 5 · FE-141 — the second buyer
  show("5 · item17.conversion  (FE-141)", (x.item17 as unknown as Record<string, unknown>)?.conversion,
    "Ground truth from p. 21: totals 93,440–149,890 standard and 93,440–139,890 conversion, discount 0–10,000, and footnote 9's 'in our sole discretion … 10% of the total Gross Revenue for the previous year … in no event will the discount exceed $10,000.'");

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(x, null, 2));
    console.log(`\nfull extraction written to ${outPath}`);
  }
}

main().catch((e) => {
  console.error("\nEXTRACTION FAILED:", e?.message ?? e);
  process.exit(1);
});
