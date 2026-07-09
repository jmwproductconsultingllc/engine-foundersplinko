// scripts/jsonl-to-brands.ts
// Harness batch JSONL → canonical brand files (data/brands/<slug>.json).
//   npx tsx scripts/jsonl-to-brands.ts harness/runs/run-2026-07-09.jsonl
//
// THE REGISTRY IS THE IDENTITY SOURCE. Slug + category come from the explicit
// stem→{slug, category} map below, NEVER from the extracted brandName —
// re-derived slugs are how SEO URLs silently 404 when a re-extraction changes
// the cover-page name ("The Goddard School" → "The Goddard School, Inc.").
// Extracted brandName is display-only. A batch stem with no registry entry is
// reported and SKIPPED, forcing a deliberate slug decision before a URL is
// minted. Re-running on a new batch flips ghosts to live automatically.

import fs from "node:fs";
import path from "node:path";
import type { DiligenceResult } from "../lib/types";

interface RegistryEntry {
  slug: string;
  category: string; // must be one of lib/brands.ts CATEGORY_ORDER to render
}

// Corpus stems observed in the 2026-07 batches. Messy on purpose — these are
// exactly why identity can't be computed ("brittish-swim", "school of rock",
// "pigtails&crewcuts").
const REGISTRY: Record<string, RegistryEntry> = {
  mathnasium: { slug: "mathnasium", category: "Education & STEM" },
  "code-ninjas": { slug: "code-ninjas", category: "Education & STEM" },
  kumon: { slug: "kumon", category: "Education & STEM" },
  "brittish-swim": { slug: "british-swim-school", category: "Swim" },
  "goldfish-swim": { slug: "goldfish-swim-school", category: "Swim" },
  aquatots: { slug: "aqua-tots-swim-school", category: "Swim" },
  i9: { slug: "i9-sports", category: "Sports & Athletics" },
  "soccer-shots": { slug: "soccer-shots", category: "Sports & Athletics" },
  skyzone: { slug: "sky-zone", category: "Play & Entertainment" },
  "urban-air-adventure": { slug: "urban-air-adventure-park", category: "Play & Entertainment" },
  kidstrong: { slug: "kidstrong", category: "Fitness & Gym" },
  "little-gym": { slug: "the-little-gym", category: "Fitness & Gym" },
  "goddard-school": { slug: "the-goddard-school", category: "Childcare & Preschool" },
  "primrose-schools": { slug: "primrose-schools", category: "Childcare & Preschool" },
  "school of rock": { slug: "school-of-rock", category: "Arts & Music" },
  "sharkeys-kids-cut": { slug: "sharkey-s-cuts-for-kids", category: "Hair & Personal Care" },
  "pigtails&crewcuts": { slug: "pigtails-crewcuts", category: "Hair & Personal Care" },
  onceuponachildstore: { slug: "once-upon-a-child", category: "Kids Retail" },
  "learning-express-toys": { slug: "learning-express-toys-gifts", category: "Kids Retail" },
  // kona ice: mobile QSR, not a kids-services concept — parked off-taxonomy on
  // purpose (excluded from /brands by the taxonomy guard) until a Food/Mobile
  // vertical exists. Keeping the entry means the file still converts and the
  // exclusion is logged, not accidental.
  "kona ice": { slug: "kona-ice", category: "Mobile Food & Events" },
};

interface BatchLine {
  file: string;
  status: string;
  report?: DiligenceResult;
}

// Sellable = READY. THIN files still persist (they render as ghost demand
// signals and flip live on re-extraction) but never get a detail page.
function gradeOf(r: DiligenceResult): "READY" | "THIN" {
  const e = r.extracted;
  const li = e.item17?.lineItems ?? [];
  const sumHi = li.reduce((a, x) => a + (x.high ?? 0), 0);
  const hasCost = e.item17?.initialInvestmentHigh != null || sumHi > 0;
  const ok =
    Boolean(e.brandName) &&
    Boolean(r.scoring?.riskLevel) &&
    hasCost &&
    e.item19?.hasItem19 != null &&
    e.systemScale?.totalUnits != null;
  return ok ? "READY" : "THIN";
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npx tsx scripts/jsonl-to-brands.ts <batch.jsonl>");
    process.exit(1);
  }
  const outDir = path.join(process.cwd(), "data", "brands");
  fs.mkdirSync(outDir, { recursive: true });

  const lines = fs.readFileSync(input, "utf8").split("\n").filter(Boolean);
  let written = 0;
  const skipped: string[] = [];

  for (const line of lines) {
    let row: BatchLine;
    try {
      row = JSON.parse(line) as BatchLine;
    } catch {
      continue;
    }
    if (row.status !== "SUCCESS" || !row.report) continue;

    const stem = row.file.replace(/\.pdf$/i, "").toLowerCase();
    const reg = REGISTRY[stem];
    if (!reg) {
      skipped.push(stem);
      continue;
    }

    const record = {
      slug: reg.slug,
      brandName: row.report.extracted.brandName || reg.slug,
      category: reg.category,
      grade: gradeOf(row.report),
      sourceFddYear: null as number | null, // populate when the harness carries it
      generatedAt: new Date().toISOString(),
      sourceStem: stem,
      result: row.report,
    };

    fs.writeFileSync(path.join(outDir, `${reg.slug}.json`), JSON.stringify(record, null, 1));
    written++;
    console.log(`✓ ${reg.slug} [${record.grade}] ← ${stem}`);
  }

  if (skipped.length) {
    console.warn(
      `\nSKIPPED (no registry entry — add slug+category to REGISTRY before these get URLs):\n  ${skipped.join("\n  ")}`,
    );
  }
  console.log(`\n${written} brand files → ${outDir}`);
}

main();
