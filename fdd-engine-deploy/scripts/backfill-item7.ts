// scripts/backfill-item7.ts — hand-transcribed Item 7 → a catalog record.
//
//   npx tsx scripts/backfill-item7.ts            # write
//   npx tsx scripts/backfill-item7.ts --check    # verify only, write nothing
//
// WHY THIS FILE EXISTS RATHER THAN A ONE-OFF
//
// data/brands/the-back-nine.json shipped with `item17: { lineItems: [], ... }`
// — no cost table at all. Two consequences, both live:
//
//   1. The PAID report rendered "Estimated total: —" with two empty cost
//      groups, on a brand we ship as the sample and have sold at $199.
//   2. lib/reportShell.ts requires the `what-it-costs` section to carry at
//      least one figure, so the brand could never qualify for a glass page
//      no matter how thick the rest of the record got.
//
// The FDD has the table. The catalog record was built by a batch path that
// missed it. This script is the transcription, kept in the repo BECAUSE it is
// hand-entered data about a named franchisor: the numbers below are a claim we
// publish, and a claim we publish needs a reviewable source, not a shell
// history. Re-running it is a no-op — that idempotence is the check that the
// record on disk still says what this file says it should.
//
// THE ADDING-UP CHECK
//
// A hand-transcribed table is worth nothing unless it reconciles to the
// franchisor's OWN stated total. Every line is summed and compared to the
// TOTAL printed on p.16; if either end is off by a dollar the script refuses to
// write. A typo'd digit in a build-out row is otherwise invisible — it renders
// as a plausible number on a report someone signs a lease against.

import fs from "node:fs";
import path from "node:path";
import {
  serializeBrandRecord,
  detectBrandJsonFormat,
  DEFAULT_BRAND_JSON_FORMAT,
} from "../lib/brandJson";

const SLUG = "the-back-nine";
const SOURCE_PAGE = "Item 7, p.14-16";
const SOURCE_DOC = "The Back Nine FDD 2026 A";

/**
 * Item 7 — ESTIMATED INITIAL INVESTMENT, pp.14-16. Transcribed from the
 * document, not inferred and not modelled.
 *
 * `recurring` follows the convention golf-envy.json already set, so the two
 * brands' cost cards group the same way and a reader comparing them is
 * comparing like with like: a row is recurring only when it is an ongoing
 * operating expense the franchisor states in months. Deposits are one-time
 * (and potentially refundable), so they stay non-recurring.
 *
 * "Additional Funds - 3 months" is left NON-recurring specifically to match
 * golf-envy's treatment of the identical line. I think a case exists for the
 * other call; comparability across the catalog beats my private opinion, and
 * the flag is load-bearing — lib/reportSource.ts filters `!recurring` when it
 * builds the cost section, so flipping it silently changes what a buyer sees
 * in "What it costs to open" AND changes the glass figure count.
 */
const LINES: [string, number, number, boolean, string][] = [
  ["Initial Franchise Fee",                   50000,  50000, false, "Item 5 discounts may apply; one outlet, single Franchise Agreement."],
  ["Travel expenses while training",           1000,   5000, false, "Training for up to three people is included in the franchise fee; travel is not."],
  ["Real Estate Improvements",                50000, 225000, false, "Build-out and leasehold improvements. A tenant improvement allowance can defray a significant portion."],
  ["Signage",                                  5000,  15000, false, ""],
  ["Equipment",                               156050, 251000, false, "High end assumes 5 simulators; minimum is 3. Simulators must be purchased from Full Swing."],
  ["Miscellaneous Supplies",                   3000,   3000, false, "Cleaning supplies, golf balls, tees, swag."],
  ["Initial Supply of Advertising Materials",  3000,   3000, false, ""],
  ["Marketing Launch Ad Spend",                6000,  10000, false, "Required spend across the 60 days before opening and first 30 days after."],
  ["Premises Deposit",                         2000,   9500, false, "Typically due on signing; potentially refundable absent a lease default."],
  ["Rent (3 months)",                          6000,  28500, true,  "Three months of rent. Implies $2,000-$9,500/mo at the stated range."],
  ["Internet/Utilities (3 months)",            1800,   2500, true,  ""],
  ["Furniture",                                5000,  25000, false, ""],
  ["Business Licenses and Permits",             200,   1000, false, ""],
  ["Insurance",                                1000,   2000, true,  "Due upon operation."],
  ["Professional Fees",                           0,   5000, false, "Attorney, accountant, other professional service providers."],
  ["Security/Automation",                      7500,  25000, false, ""],
  ["Utility Deposits",                         1500,   3000, false, ""],
  ["Additional Funds - 3 months",              8000,  25000, false, "Working capital for the first three months of operation."],
];

/** The TOTAL the franchisor prints at the foot of the table, p.16. */
const STATED_LOW = 307050;
const STATED_HIGH = 688500;

function reconcile(): void {
  const sumLow = LINES.reduce((a, l) => a + l[1], 0);
  const sumHigh = LINES.reduce((a, l) => a + l[2], 0);
  if (sumLow !== STATED_LOW || sumHigh !== STATED_HIGH) {
    console.error(
      `RECONCILE FAILED: ${LINES.length} lines sum to ${sumLow} / ${sumHigh}, ` +
        `${SOURCE_DOC} states ${STATED_LOW} / ${STATED_HIGH}. Nothing written.`,
    );
    process.exit(1);
  }
  console.log(
    `reconciled: ${LINES.length} lines sum to exactly ${sumLow} / ${sumHigh} (${SOURCE_PAGE})`,
  );
}

function main(): void {
  const checkOnly = process.argv.slice(2).includes("--check");
  reconcile();

  // process.cwd(), never __dirname — THE PORTABILITY LINT.
  const file = path.join(process.cwd(), "data", "brands", `${SLUG}.json`);
  const raw = fs.readFileSync(file, "utf8");

  // Detect, never impose. Writing DEFAULT unconditionally reformats the file —
  // this record is a Python-writer file (indent 0, ", " separators) and a bare
  // JSON.stringify turned a 4-field change into a whole-file rewrite once
  // already. See lib/brandJson.test.ts, THE ON-DISK FORMAT CONTRACT.
  const fmt = detectBrandJsonFormat(raw) ?? DEFAULT_BRAND_JSON_FORMAT;
  const rec = JSON.parse(raw);

  rec.result.extracted.item17 = {
    initialInvestmentLow: STATED_LOW,
    initialInvestmentHigh: STATED_HIGH,
    lineItems: LINES.map(([category, low, high, recurring, notes]) => ({
      category,
      low,
      high,
      recurring,
      notes,
    })),
    sourcePage: SOURCE_PAGE,
  };

  // The document check should now agree that Item 7 is present, or the report
  // header advertises a missing item the body renders in full.
  const dc = rec.result.extracted.documentCheck;
  if (dc && Array.isArray(dc.itemsFound) && !dc.itemsFound.includes("Item 7")) {
    dc.itemsFound.push("Item 7");
  }

  const out = serializeBrandRecord(rec, fmt);
  if (out === raw) {
    console.log(`${SLUG}: already current — no write.`);
    return;
  }
  if (checkOnly) {
    console.error(`${SLUG}: DRIFTED from this script's transcription (--check).`);
    process.exit(1);
  }
  fs.writeFileSync(file, out);
  console.log(`${SLUG}: wrote ${out.length} bytes, format ${fmt.indent}/${fmt.escapeNonAscii}/${fmt.trailingNewline}`);
}

main();
