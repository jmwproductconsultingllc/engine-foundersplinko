// scripts/jsonl-to-brands.ts
// Harness batch JSONL → canonical brand files (data/brands/<slug>.json).
//   npx tsx scripts/jsonl-to-brands.ts harness/runs/run-2026-07-21.jsonl
//
// THE REGISTRY IS THE IDENTITY SOURCE. slug + category + vertical + sourceFddYear
// come from the explicit stem→entry map below, NEVER from the extracted
// brandName — re-derived slugs are how SEO URLs silently 404 when a
// re-extraction changes the cover-page name ("The Goddard School" → "The
// Goddard School, Inc."). Extracted brandName is display-only. A batch stem with
// no registry entry is reported and SKIPPED, forcing a deliberate slug decision
// before a URL is minted. Re-running on a new batch flips ghosts to live
// automatically.
//
// vertical must be one of lib/brands.ts VERTICAL_ORDER (rows on /brands).
// category is free-form/descriptive for non-Kids verticals; for Kids & Family it
// must be one of CATEGORY_ORDER (the strict subcategory list) to render.
// Absent vertical defaults to Kids & Family, so the original kids entries below
// need no vertical field (zero migration).

import fs from "node:fs";
import path from "node:path";
import type { DiligenceResult } from "../lib/types";

const KIDS = "Kids & Family";

interface RegistryEntry {
  slug: string;
  category: string;
  /** VERTICAL_ORDER value; omit for the original Kids & Family entries */
  vertical?: string;
  /** FDD cover year when known (display/analytics only) */
  sourceFddYear?: number | null;
}

// Corpus stems observed across the 2026-07 batches. Messy on purpose — these are
// exactly why identity can't be computed ("brittish-swim", "school of rock").
// The stem is the corpus FILENAME (minus .pdf), lowercased. Keep corpus
// filenames aligned with the intended slug so the mapping stays obvious.
const REGISTRY: Record<string, RegistryEntry> = {
  // ── Kids & Family (original launch; vertical defaults to Kids & Family) ──
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
  "kona ice": { slug: "kona-ice", category: "Mobile Food & Events" }, // off-taxonomy; logged, not rendered

  // ── Jul-21 extraction queue (12; run corpus filenames = these stems) ──
  // Tier 1 — Franchise Sidekick shelf brands
  "aire-serv": { slug: "aire-serv", category: "HVAC & appliance repair", vertical: "Home & Property Services", sourceFddYear: null },
  "molly-maid": { slug: "molly-maid", category: "Residential cleaning", vertical: "Home & Property Services", sourceFddYear: null },
  crestcom: { slug: "crestcom", category: "Leadership training", vertical: "B2B & Business Services", sourceFddYear: null },
  "jetset-pilates": { slug: "jetset-pilates", category: "Boutique fitness", vertical: "Fitness & Wellness", sourceFddYear: null },
  "everline-coatings": { slug: "everline-coatings", category: "Concrete coatings", vertical: "Home & Property Services", sourceFddYear: null },
  "360-painting": { slug: "360-painting", category: "Painting", vertical: "Home & Property Services", sourceFddYear: null },
  "patrice-associates": { slug: "patrice-associates", category: "Recruiting", vertical: "B2B & Business Services", sourceFddYear: null },
  // Tier 2 — other new brands
  "realclean-aircraft-detailing": { slug: "realclean-aircraft-detailing", category: "Aircraft detailing", vertical: "Auto & Transport", sourceFddYear: null },
  "cascadia-pizza": { slug: "cascadia-pizza", category: "Pizza QSR", vertical: "Food & Beverage", sourceFddYear: null },
  "five-iron-golf": { slug: "five-iron-golf", category: "Indoor golf & entertainment", vertical: "Sports & Entertainment", sourceFddYear: 2026 },
  // joshua-tree: CONFIRM public brand name from Item 1 before promoting. Cover =
  // "JTE Franchising LLC"; web ties JTE → "Joshua Tree Experts" (tree/lawn/pest),
  // but the source filename said "safe-home" — the two-reader settles it. Corpus
  // filename intentionally neutral ("joshua-tree.pdf"); confirm, then set slug.
  "joshua-tree": { slug: "joshua-tree-experts", category: "Tree & lawn care", vertical: "Home & Property Services", sourceFddYear: null },
  "cabinet-iq": { slug: "cabinet-iq", category: "Cabinet remodel", vertical: "Home & Property Services", sourceFddYear: null },
};

interface BatchLine {
  file: string;
  status: string;
  report?: DiligenceResult;
}

// Sellable = READY. THIN files still persist (ghost demand signals; flip live on
// re-extraction) but never get a detail page.
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
  const rows: string[] = [];

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

    const grade = gradeOf(row.report);
    const record = {
      slug: reg.slug,
      brandName: row.report.extracted.brandName || reg.slug,
      category: reg.category,
      vertical: reg.vertical ?? KIDS,
      grade,
      sourceFddYear: reg.sourceFddYear ?? null,
      generatedAt: new Date().toISOString(),
      sourceStem: stem,
      result: row.report,
    };

    fs.writeFileSync(path.join(outDir, `${reg.slug}.json`), JSON.stringify(record, null, 1));
    written++;
    rows.push(
      `✓ ${reg.slug.padEnd(30)} [${grade}] ${(reg.vertical ?? KIDS).padEnd(26)} ← ${stem}`,
    );
  }

  console.log(rows.join("\n"));
  if (skipped.length) {
    console.warn(
      `\nSKIPPED (no registry entry — add slug+category+vertical to REGISTRY before these get URLs):\n  ${skipped.join("\n  ")}`,
    );
  }
  console.log(`\n${written} brand files → ${outDir}`);
}

main();
