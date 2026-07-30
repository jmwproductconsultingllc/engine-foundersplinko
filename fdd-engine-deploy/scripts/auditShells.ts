/**
 * auditShells.ts — the thinness audit.
 *
 * Run this BEFORE any glass-mode UI work ships. An 84-figure shell is a
 * promise; a brand with 9 real figures cannot keep it, and a page full of
 * masks over nothing is worse than the teaser we have today.
 *
 *   npx tsx scripts/auditShells.ts
 *   npx tsx scripts/auditShells.ts --csv > glass-audit.csv
 *   npx tsx scripts/auditShells.ts --slug crumbl --verbose
 *
 * Reads the same records the catalog renders: data/brands/<slug>.json.
 * Writes nothing. Safe to run against prod data.
 *
 * What to do with the output:
 *   - Read the p10, not the mean. The mean is carried by the good brands.
 *   - Set GlassConfig.minFiguresForGlass at or just above the point where
 *     the section-coverage column starts showing holes.
 *   - Any brand under the threshold keeps the current teaser. That is a
 *     supported outcome, not a failure — two page types is fine.
 *   - A brand with paid traffic pointed at it that falls under the threshold
 *     is a launch blocker, not a backlog item. Cross-check against the
 *     paid-slug list before shipping.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildReportShell,
  qualifiesForGlass,
  DEFAULT_GLASS_CONFIG,
  type ReportShell,
} from "../lib/reportShell";

/* The adapter lives in its own module, NOT in reportShell.ts. reportShell.ts is
   imported by the client component; the adapter reaches into ladder.ts,
   callList.ts, churn.ts and verify.ts, and pulling that graph into the browser
   bundle would put a module that CAN produce a figure one import away from the
   glass page. See the ADAPTER SEAM note at the bottom of lib/reportShell.ts. */
import { reportSourceFromComputed } from "../lib/reportSource";

import type { DiligenceResult } from "../lib/types";

/** The on-disk catalog record. Only the three fields the adapter reads. */
type BrandRecord = { slug?: string; brandName?: string; result: DiligenceResult };

const BRANDS_DIR = resolve(process.cwd(), "data/brands");

/** Sections whose absence changes what the page can claim. */
const LOAD_BEARING = [
  "what-it-costs",
  "cash-ladder",
  "ongoing-fees",
  "item-19",
  "tripwires",
  "document-check",
  "to-verify",
] as const;

interface Row {
  slug: string;
  ok: boolean;
  error?: string;
  sections: number;
  figures: number;
  citations: number;
  itemsCited: number;
  tripwires: number;
  questions: number;
  missing: string[];
  qualifies: boolean;
}

function auditOne(slug: string, raw: BrandRecord): Row {
  const base: Row = {
    slug,
    ok: false,
    sections: 0,
    figures: 0,
    citations: 0,
    itemsCited: 0,
    tripwires: 0,
    questions: 0,
    missing: [...LOAD_BEARING],
    qualifies: false,
  };

  let shell: ReportShell;
  try {
    shell = buildReportShell(reportSourceFromComputed(raw), DEFAULT_GLASS_CONFIG);
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }

  /* A section is present if it carries ANYTHING — figures, free chips, or
     counted masked rows. Not figures alone.

     The first run of this audit reported document-check missing on 83 of 83
     brands. It was present on all 83: it is a free-chip section by design (the
     Item numbers found in the document, zero figures), and figureCount > 0 can
     never see it. THE ALWAYS-FAILING VERIFIER — a row that is red on 100% of
     the catalog is a row you learn to skim past, and the next real hole hides
     directly underneath it. Same for to-verify, which is why it was quietly
     absent from LOAD_BEARING rather than fixed. */
  const present = new Set(
    shell.sections
      .filter(
        (s) =>
          s.figureCount > 0 ||
          (s.freeChips?.length ?? 0) > 0 ||
          (s.maskedRows ?? 0) > 0,
      )
      .map((s) => s.id),
  );

  return {
    slug,
    ok: true,
    sections: shell.counts.sections,
    figures: shell.counts.figures,
    citations: shell.counts.citations,
    itemsCited: shell.counts.itemsCited,
    tripwires: shell.counts.tripwires,
    questions: shell.counts.questions,
    missing: LOAD_BEARING.filter((id) => !present.has(id)),
    qualifies: qualifiesForGlass(shell, DEFAULT_GLASS_CONFIG),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function main() {
  const args = process.argv.slice(2);
  const csv = args.includes("--csv");
  const only = args.includes("--slug") ? args[args.indexOf("--slug") + 1] : null;

  if (!existsSync(BRANDS_DIR)) {
    console.error(`No brand records at ${BRANDS_DIR}. Run from fdd-engine-deploy/.`);
    process.exit(1);
  }

  const files = readdirSync(BRANDS_DIR)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => (only ? f === `${only}.json` : true));

  /* FLOOR. Pointed at an empty-but-present directory this script printed a
     tidy table of zeros and a summary that read like a pass. Same failure mode
     every lint in lib/ carries a floor assertion against: scanning nothing and
     reporting green. A calibration run that measured no brands must be loud. */
  if (!only && files.length < 50) {
    console.error(
      `Only ${files.length} brand records found in ${BRANDS_DIR}. The catalog ` +
        `is 80+. Refusing to calibrate a threshold against a partial catalog — ` +
        `run from fdd-engine-deploy/ with the full data/brands/ checked out.`,
    );
    process.exit(1);
  }

  const rows: Row[] = files.map((f) => {
    const slug = f.replace(/\.json$/, "");
    const raw = JSON.parse(readFileSync(join(BRANDS_DIR, f), "utf8")) as BrandRecord;
    return auditOne(slug, raw);
  });

  if (csv) {
    console.log("slug,ok,figures,sections,citations,items_cited,tripwires,questions,qualifies,missing");
    for (const r of rows) {
      console.log(
        [
          r.slug, r.ok, r.figures, r.sections, r.citations, r.itemsCited,
          r.tripwires, r.questions, r.qualifies, `"${r.missing.join(" ")}"`,
        ].join(","),
      );
    }
    return;
  }

  const good = rows.filter((r) => r.ok);
  const failed = rows.filter((r) => !r.ok);
  const figs = good.map((r) => r.figures).sort((a, b) => a - b);

  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log(
    pad("slug", 28) + pad("figs", 6) + pad("sect", 6) + pad("cites", 7) +
    pad("trip", 6) + pad("glass", 7) + "missing",
  );
  console.log("-".repeat(96));
  for (const r of [...good].sort((a, b) => a.figures - b.figures)) {
    console.log(
      pad(r.slug, 28) + pad(r.figures, 6) + pad(r.sections, 6) + pad(r.citations, 7) +
      pad(r.tripwires, 6) + pad(r.qualifies ? "yes" : "NO", 7) + r.missing.join(" "),
    );
  }

  console.log("\n" + "=".repeat(96));
  console.log(`brands audited        ${rows.length}`);
  console.log(`built cleanly         ${good.length}`);
  if (failed.length) {
    console.log(`FAILED TO BUILD       ${failed.length}  ${failed.slice(0, 6).map((r) => r.slug).join(", ")}`);
    console.log(`  first error         ${failed[0].error}`);
  }
  console.log(`figures  min / p10    ${percentile(figs, 0)} / ${percentile(figs, 10)}`);
  console.log(`figures  p50 / p90    ${percentile(figs, 50)} / ${percentile(figs, 90)}`);
  console.log(`figures  max          ${percentile(figs, 100)}`);
  console.log(`qualify for glass     ${good.filter((r) => r.qualifies).length} / ${good.length} at threshold ${DEFAULT_GLASS_CONFIG.minFiguresForGlass}`);

  const holes = new Map<string, number>();
  for (const r of good) for (const m of r.missing) holes.set(m, (holes.get(m) ?? 0) + 1);
  if (holes.size) {
    console.log("\nsections missing across the catalog:");
    for (const [id, n] of [...holes].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${pad(id, 24)} missing on ${n} brands`);
    }
  }
}

/* THE SIDE-EFFECT IMPORT DEFECT. A bare main() at module scope turns any
   `import` of this file into an execution — valid TS, invisible to tsc, and it
   fails only at runtime and only in the caller. Same guard Commit C put on
   jsonl-to-brands.ts. */
const invokedDirectly =
  Boolean(process.argv[1]) && /auditShells\.[cm]?[jt]sx?$/.test(process.argv[1]);
if (invokedDirectly) main();
