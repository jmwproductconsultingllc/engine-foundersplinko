// scripts/retract-brand.ts — pull a brand record, or put it back.
//
// This is a CLI and not an admin UI on purpose. Retracting a record is rare,
// consequential, and reviewable: it edits one committed JSON file, which means
// it shows up in the diff, gets a commit message, and ships through the same
// deploy as everything else. An admin button would let it happen with no
// history and no review, which is the wrong trade for an action whose whole
// value is that it's accountable.
//
//   npx tsx scripts/retract-brand.ts <slug> \
//     --figure "the disclosed royalty rate" \
//     [--detail "Item 6 lists 30%; the Item 6 table reads 6%"] \
//     [--internal "extractor grabbed the transfer-fee column"] \
//     [--date 2026-07-28]
//
//   npx tsx scripts/retract-brand.ts <slug> --restore
//   npx tsx scripts/retract-brand.ts --list
//
// After running it: commit the changed file and deploy. Nothing is live until
// the deploy lands — this script touches data, not production.

import fs from "node:fs";
import path from "node:path";
import {
  serializeBrandRecord,
  detectBrandJsonFormat,
  type BrandJsonFormat,
} from "../lib/brandJson";

const DIR = path.join(process.cwd(), "data", "brands");

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function load(slug: string): { file: string; rec: any; fmt: BrandJsonFormat } {
  const file = path.join(DIR, `${slug}.json`);
  if (!fs.existsSync(file)) die(`No brand record at data/brands/${slug}.json`);
  const raw = fs.readFileSync(file, "utf8");
  // Capture the file's shape on the way IN, so save() can put it back the way it
  // found it. The corpus is not uniformly formatted -- five variants across 83
  // files -- and imposing one here means every retraction also silently
  // reformats whatever record it lands on. See lib/brandJson.ts.
  return { file, rec: JSON.parse(raw), fmt: detectBrandJsonFormat(raw) };
}

function save(file: string, rec: unknown, fmt: BrandJsonFormat) {
  fs.writeFileSync(file, serializeBrandRecord(rec, fmt));
}

function list() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
  const pulled: string[] = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
      if (r?.retraction?.retractedAt && r?.retraction?.figure) {
        pulled.push(
          `  ${r.slug.padEnd(30)} ${r.retraction.retractedAt}  ${r.retraction.figure}`,
        );
      }
    } catch {
      /* unparseable files are the store's problem, not this script's */
    }
  }
  if (!pulled.length) {
    console.log(`\nNo retracted records. ${files.length} brands in the store.\n`);
    return;
  }
  console.log(`\n${pulled.length} retracted record(s):\n${pulled.join("\n")}\n`);
  console.log(`Restore one with:  npx tsx scripts/retract-brand.ts <slug> --restore\n`);
}

function main() {
  if (has("--list")) return list();

  const slug = process.argv[2];
  if (!slug || slug.startsWith("--")) {
    die(
      "Usage:\n" +
        '  npx tsx scripts/retract-brand.ts <slug> --figure "the disclosed royalty rate" [--detail "..."] [--internal "..."] [--date YYYY-MM-DD]\n' +
        "  npx tsx scripts/retract-brand.ts <slug> --restore\n" +
        "  npx tsx scripts/retract-brand.ts --list",
    );
  }

  const { file, rec, fmt } = load(slug);

  if (has("--restore")) {
    if (!rec.retraction) die(`${slug} is not retracted.`);
    const was = rec.retraction;
    delete rec.retraction;
    save(file, rec, fmt);
    console.log(
      `\n✓ Restored ${slug} (was pulled ${was.retractedAt}: ${was.figure}).\n` +
        `  It returns to the library, the sitemap, the brand count and the compare pages on the next deploy.\n` +
        `  Confirm the figure actually reconciles before you commit this.\n`,
    );
    return;
  }

  const figure = arg("--figure");
  if (!figure) {
    die(
      'A retraction needs --figure: which number came down, in buyer language.\n' +
        '  e.g. --figure "the disclosed royalty rate"\n' +
        "  It renders verbatim on the public notice, so write it for a reader, not for us.",
    );
  }
  if (/^\s*$/.test(figure) || figure.length < 6) {
    die(`--figure "${figure}" is too vague to publish. Name the number.`);
  }

  const date = arg("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`--date must be YYYY-MM-DD, got "${date}"`);

  if (rec.retraction) {
    console.warn(
      `! ${slug} was already retracted ${rec.retraction.retractedAt} — overwriting that record.`,
    );
  }

  rec.retraction = {
    retractedAt: date,
    figure,
    ...(arg("--detail") ? { detail: arg("--detail") } : {}),
    ...(arg("--internal") ? { internal: arg("--internal") } : {}),
  };
  save(file, rec, fmt);

  console.log(
    `\n✓ Retracted ${slug} (${rec.brandName}) as of ${date}.\n` +
      `  Figure: ${figure}\n` +
      (rec.retraction.detail ? `  Detail: ${rec.retraction.detail}\n` : "") +
      `\n  On the next deploy:\n` +
      `    · /franchise/${slug} serves the retraction notice — 200, noindex, no figures\n` +
      `    · it leaves /brands, the sitemap, the brand count, the compare pages and the fit emails\n` +
      `    · compare URLs involving it redirect to the notice\n` +
      `\n  Commit data/brands/${slug}.json and deploy. Nothing changes until you do.\n`,
  );
}

main();
