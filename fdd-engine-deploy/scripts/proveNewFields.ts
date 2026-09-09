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
// BRAND-JSON-EXEMPT: writes only an optional extraction dump for inspection, never a
// data/brands record. It exists to prove the extractor populates the new schema fields
// and stops there. Caught by the detector because the header names data/brands in
// order to say it does NOT write one.

import { readFileSync, writeFileSync } from "node:fs";
import { extractFdd } from "../lib/extractFdd";

const [, , pdfPath, ...rest] = process.argv;
if (!pdfPath) {
  console.error("usage: npx tsx scripts/proveNewFields.ts <file.pdf> [--json out.json]");
  process.exit(1);
}
// A KEY THAT IS OBVIOUSLY NOT A KEY SHOULD FAIL IN ONE LINE.
//
// Twice on August 24, 2026 this ran with a placeholder — first the literal
// string "...", then "<paste your key>" left in the shell by an earlier export
// that a failed `read` never overwrote. Both times the output was a two-page
// cascade: Gemini's 400, the failover to Claude, Claude's missing-key error,
// and then the whole thing repeated inside a wrapper message. The real fault —
// nobody ever typed a key — appeared nowhere in it.
//
// Cheap to check, and the check is the message.
const KEYS = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"] as const;
const present = KEYS.filter((k) => (process.env[k] ?? "").trim().length > 0);
if (present.length === 0) {
  console.error(
    `No API key set. This script makes a real extraction call and needs one of:\n` +
      `  GEMINI_API_KEY     (primary provider)\n` +
      `  ANTHROPIC_API_KEY  (fallback provider)\n`,
  );
  process.exit(1);
}
for (const k of present) {
  const v = (process.env[k] ?? "").trim();
  const looksPlaceholder =
    /[<>]/.test(v) || /\s/.test(v) || /^\.{2,}$/.test(v) || /paste|your.?key|xxx|example/i.test(v) || v.length < 20;
  if (looksPlaceholder) {
    console.error(
      `${k} is set but does not look like a key: ${JSON.stringify(v.slice(0, 24))}${v.length > 24 ? "…" : ""}\n\n` +
        `If a previous command left a placeholder in this shell, it is still there —\n` +
        `a failed \`read\` does not clear an earlier export. Run:\n\n` +
        `  unset ${KEYS.join(" ")}\n`,
    );
    process.exit(1);
  }
}
console.log(`using ${present.join(" + ")}`);

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
    "Does the filing say the business runs from premises at all? A hedged answer — \"the majority operate from a home office\" — is not the same claim as \"you will run it from your home\", and the evidence string is what carries that difference.");

  // 2 · FE-140 — the Item 19 cost columns
  const cohorts = x.item19?.cohorts ?? [];
  show("2 · item19.cohorts[].disclosedCosts  (FE-140)",
    cohorts.map((c) => ({ label: c.label, disclosedCosts: (c as unknown as Record<string, unknown>).disclosedCosts })),
    "Cost columns beside the revenue column, per cohort. All-null on a revenue-only table is correct. Costs landing on a PROFIT table are inert — that cohort can never be the top line — but they are noise, and noise on the wrong row is how the next reader is misled.");

  // 3 · Bar-B-Clean class — is each row one outlet, or several added together?
  show("3 · item19.cohorts[].figureScope",
    cohorts.map((c) => {
      const r = c as unknown as Record<string, unknown>;
      return {
        label: c.label,
        figureScope: r.figureScope ?? "(absent)",
        combinedAcross: r.combinedAcross ?? null,
        revenueType: c.revenueType,
        sampleSize: c.sampleSize,
        annualRevenue: c.annualRevenue,
      };
    }),
    "An AVERAGE across a cohort is per_outlet however many are in it. A SUM across several outlets is combined, with combinedAcross set. ABSENT on every row means the instruction did not land — and absent never divides, so the failure is silent.");

  // 4 · Gorilla class — currency
  show("4 · item19.currency", (x.item19 as unknown as Record<string, unknown>)?.currency,
    "A non-US filing MUST populate this. lib/currency.ts falls back to sniffing item19.notes, so check the notes below before calling an absent field a miss.");

  // 5 · FE-141 — the second buyer
  show("5 · item17.conversion  (FE-141)", (x.item17 as unknown as Record<string, unknown>)?.conversion,
    "ABSENT is correct for a filing with no conversion path — this doubles as the negative control.");

  // The currency fallback reads this, so an absent currency field is only a
  // miss if the note does not carry the sentence either.
  show("4b · item19.notes  (the currency fallback's input)", x.item19?.notes ?? null,
    "lib/currency.ts matches /presented|denominated|reported|expressed in ([A-Z]{3})/ against this.");

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(x, null, 2));
    console.log(`\nfull extraction written to ${outPath}`);
  }
}

main().catch((e) => {
  console.error("\nEXTRACTION FAILED:", e?.message ?? e);
  process.exit(1);
});
