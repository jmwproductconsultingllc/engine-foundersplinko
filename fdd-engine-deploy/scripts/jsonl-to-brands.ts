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
import {
  serializeBrandRecord,
  detectBrandJsonFormat,
  DEFAULT_BRAND_JSON_FORMAT,
  type BrandJsonFormat,
} from "../lib/brandJson";

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
// EXPORTED so tooling can READ it without duplicating it. scripts/registerBrand.ts
// imports this to check stem/slug collisions before minting a URL — a second
// hand-maintained copy of the identity source is exactly the drift this file's
// header exists to prevent.
export const REGISTRY: Record<string, RegistryEntry> = {
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
  // ── Re-mint (2026-09-09) ──
  // the-back-nine was minted from an older extraction whose Item 19 cohorts carry
  // no page citation and labels the current cohort selector does not match, so the
  // catalog page recomputes to a null midCohort and renders every cash-ladder rung
  // as "not disclosed" while the Item 19 block above it prints $19,770/mo. The live
  // upload path reads the same PDF and produces four properly cited cohorts. This
  // entry makes the record re-mintable from b9-fdd.pdf instead of hand-built.
  "b9-fdd": { slug: "the-back-nine", category: "Golf & Simulators", vertical: "Sports & Entertainment", sourceFddYear: 2026 },

  // ── HFC portfolio (2026-09-10) ──
  // The six brands the FE-140 / FE-142 / FE-144 fixtures were written against. Two Maids
  // is the acceptance test for FE-140's extraction half: its Item 19 discloses labor 42.9%
  // and materials 3.8% across twelve charts, so minting it proves the cost sweep populates
  // cohorts from a real extraction rather than from a fixture.
  "two-maids": { slug: "two-maids", category: "Residential cleaning", vertical: "Home & Property Services", sourceFddYear: 2026 },
  "budget-blinds": { slug: "budget-blinds", category: "Window coverings", vertical: "Home & Property Services", sourceFddYear: 2026 },
  "kitchen-tune-up": { slug: "kitchen-tune-up", category: "Cabinet refacing", vertical: "Home & Property Services", sourceFddYear: 2026 },
  "premier-garage": { slug: "premier-garage", category: "Garage remodel", vertical: "Home & Property Services", sourceFddYear: 2026 },
  "the-tailored-closet": { slug: "the-tailored-closet", category: "Closet & storage", vertical: "Home & Property Services", sourceFddYear: 2026 },
  "bark-and-mane": { slug: "bark-and-mane", category: "Mobile pet grooming", vertical: "Pets", sourceFddYear: 2026 },
  "bath-tune-up": { slug: "bath-tune-up", category: "Bath remodel", vertical: "Home & Property Services", sourceFddYear: 2026 },
  "lightspeed-restoration": { slug: "lightspeed-restoration", category: "Restoration", vertical: "Home & Property Services", sourceFddYear: 2026 },
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

// ── ITEM 19 PLAUSIBILITY GATE ────────────────────────────────────────────────
//
// data/brands is the static source for the public catalog and a slug is a
// permanent, purchasable URL. Three defects found on 2026-09-10, all the same
// family — A NUMBER CARRYING THE WRONG DENOMINATOR:
//
//   ellie-mental-health  minted 2026-07-13, graded READY, still live. The top
//                        line is "Average new patients per clinic" — a COUNT —
//                        read as $33/mo of revenue with coversCosts true, while
//                        the same Item 19 discloses $818,077/yr of collected
//                        revenue per clinic two rows down.
//   molly-maid           Item 19 is disclosed "Per Target Household"
//                        ($49.92/yr). Read as per outlet that is $4/mo.
//   patrice-associates   annualRevenue 11,680 x sampleSize 82 = 957,760 against
//                        a stated totalAnnualRevenue of 4,520,279. 11,680 is
//                        revenue per PLACEMENT; 4,520,279 / 11,680 is exactly
//                        387 placements across 82 outlets.
//
// A fourth, found by the same sweep and NOT yet resolved:
//
//   gorilla-property-services  top line $11,431/mo carries revenueType
//                              "net_or_ebitda" from a cohort labelled
//                              "Canadian Franchisees Profit and Loss Table 4
//                              Median" — a P&L median sitting where revenue
//                              belongs. Needs a human read of the filing before
//                              anyone decides what it is. Still live.
//
// Measured against all 83 records in data/brands on 2026-09-10: no cohort names
// a non-outlet denominator, no cohort carries all three reconciliation fields,
// and the lowest per-outlet top line that is unambiguously revenue is
// $15,858/mo (the-vital-stretch). So none of these checks can retroactively
// reject a record that is already correct — they catch failures only.
//
// COVERAGE IS PARTIAL AND THAT IS THE POINT TO REMEMBER: 41 of the 83 records
// carry no revenueType on the selected cohort at all, so the first check cannot
// fire on them. The gate narrows the hole; it does not close it.
//
// This gate BLOCKS the write. A brand whose top line cannot be trusted is a
// build error, not a card to skip.
const REVENUE_TYPES = new Set([
  "gross_sales",
  "net_sales",
  "revenue",
  "gross_revenue",
  "net_revenue",
  "collected_revenue",
]);
const NON_OUTLET_DENOMINATOR =
  /per\s+(target\s+)?(household|capita|placement|patient|appointment|transaction|ticket|job|customer|member|student|visit|order|invoice|lead|call)/i;
const PLAUSIBLE_MONTHLY_FLOOR = 2000;

function item19Defects(report: unknown): string[] {
  const r = report as {
    scoring?: {
      midCohort?: {
        monthlyRevenue?: number | null;
        label?: string;
        source?: { revenueType?: string };
      };
    };
    extracted?: { item19?: { cohorts?: Array<Record<string, unknown>> } };
  };
  const defects: string[] = [];
  const mid = r?.scoring?.midCohort;

  const revType = mid?.source?.revenueType;
  if (mid && revType && !REVENUE_TYPES.has(revType)) {
    defects.push(
      `top-line cohort "${mid.label ?? "?"}" carries revenueType "${revType}" — that is not a revenue figure`,
    );
  }

  const monthly = mid?.monthlyRevenue;
  if (typeof monthly === "number" && monthly > 0 && monthly < PLAUSIBLE_MONTHLY_FLOOR) {
    defects.push(
      `top line $${Math.round(monthly).toLocaleString("en-US")}/mo is below the ` +
        `$${PLAUSIBLE_MONTHLY_FLOOR.toLocaleString("en-US")}/mo plausibility floor`,
    );
  }

  for (const c of r?.extracted?.item19?.cohorts ?? []) {
    const label = String((c as { label?: unknown }).label ?? "");
    const basis = String((c as { basis?: unknown }).basis ?? "");
    const scope = (c as { figureScope?: unknown }).figureScope;
    const m = NON_OUTLET_DENOMINATOR.exec(`${label} ${basis}`);
    if (m && scope === "per_outlet") {
      defects.push(`cohort "${label}" is disclosed "${m[0]}" but is tagged figureScope per_outlet`);
    }
    const ar = (c as { annualRevenue?: unknown }).annualRevenue;
    const ss = (c as { sampleSize?: unknown }).sampleSize;
    const tot = (c as { totalAnnualRevenue?: unknown }).totalAnnualRevenue;
    if (
      typeof ar === "number" &&
      typeof ss === "number" &&
      typeof tot === "number" &&
      ar > 0 &&
      ss > 0 &&
      tot > 0
    ) {
      const ratio = tot / (ar * ss);
      if (ratio < 0.95 || ratio > 1.05) {
        defects.push(
          `cohort "${label}" does not reconcile: annualRevenue ` +
            `${Math.round(ar).toLocaleString("en-US")} x sampleSize ${ss} = ` +
            `${Math.round(ar * ss).toLocaleString("en-US")}, but totalAnnualRevenue is ` +
            `${Math.round(tot).toLocaleString("en-US")}`,
        );
      }
    }
  }
  return defects;
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
  const statusDropped: string[] = [];
  const blocked: string[] = [];
  const rows: string[] = [];

  for (const line of lines) {
    let row: BatchLine;
    try {
      row = JSON.parse(line) as BatchLine;
    } catch {
      continue;
    }
    if (!row.report) continue;
    if (row.status !== "SUCCESS") {
      // A DROPPED LINE USED TO BE SILENT. On 2026-09-09 a status mismatch
      // ("ok" where the contract says "SUCCESS") minted nothing and said
      // nothing, and the run reported "0 brand files" with no reason given.
      // Name every drop.
      const why = (row as { refusal?: { reason?: string } }).refusal?.reason;
      statusDropped.push(`${row.file} (status "${row.status}")${why ? ` — ${why}` : ""}`);
      continue;
    }

    const stem = row.file.replace(/\.pdf$/i, "").toLowerCase();
    const reg = REGISTRY[stem];
    if (!reg) {
      skipped.push(stem);
      continue;
    }

    const grade = gradeOf(row.report);

    const defects = item19Defects(row.report);
    if (defects.length) {
      blocked.push(`${reg.slug}\n      ${defects.join("\n      ")}`);
      continue;
    }

    // PRESERVE AN EXISTING RETRACTION ACROSS A REGENERATION.
    //
    // This converter overwrites data/brands/<slug>.json wholesale. Without this
    // read-back, re-running it for any reason — a batch re-extract, one
    // unrelated brand added to the registry — silently UN-retracts every pulled
    // record and quietly republishes the exact figures we took down. That is a
    // one-line bug with a straight line to the only kind of damage this product
    // can't absorb, and it fails silently and invisibly.
    //
    // So a retraction survives a rebuild and can only be cleared deliberately:
    //   npx tsx scripts/retract-brand.ts <slug> --restore
    const outPath = path.join(outDir, `${reg.slug}.json`);
    let carriedRetraction: unknown = undefined;
    // The prior file is also where the FORMAT comes from. The corpus is not
    // uniformly serialized (five variants across 83 files, laid down by
    // different writers over two years), so regenerating one brand in a
    // canonical format would reformat that file wholesale and bury the actual
    // change in a 150-line whitespace diff. Read the shape, write it back.
    // New slugs get DEFAULT. See lib/brandJson.ts.
    let outFmt: BrandJsonFormat = DEFAULT_BRAND_JSON_FORMAT;
    try {
      const rawPrev = fs.readFileSync(outPath, "utf8");
      outFmt = detectBrandJsonFormat(rawPrev);
      const prev = JSON.parse(rawPrev);
      if (prev?.retraction?.retractedAt && prev?.retraction?.figure) {
        carriedRetraction = prev.retraction;
      }
    } catch {
      /* no prior file — first write for this slug */
    }
    if (carriedRetraction) {
      console.warn(
        `[jsonl-to-brands] ${reg.slug} is RETRACTED — regenerated and kept pulled. ` +
          `Run "npx tsx scripts/retract-brand.ts ${reg.slug} --restore" once the figure reconciles.`,
      );
    }

    const record = {
      slug: reg.slug,
      brandName: row.report.extracted.brandName || reg.slug,
      category: reg.category,
      vertical: reg.vertical ?? KIDS,
      grade,
      sourceFddYear: reg.sourceFddYear ?? null,
      generatedAt: new Date().toISOString(),
      sourceStem: stem,
      ...(carriedRetraction ? { retraction: carriedRetraction } : {}),
      result: row.report,
    };

    fs.writeFileSync(outPath, serializeBrandRecord(record, outFmt));
    written++;
    rows.push(
      `✓ ${reg.slug.padEnd(30)} [${grade}] ${(reg.vertical ?? KIDS).padEnd(26)} ← ${stem}`,
    );
  }

  console.log(rows.join("\n"));
  if (statusDropped.length) {
    console.warn(
      `\nDROPPED (status is not SUCCESS — the engine refused or the run failed):\n  ${statusDropped.join("\n  ")}`,
    );
  }
  if (blocked.length) {
    console.warn(
      `\nBLOCKED BY THE ITEM 19 PLAUSIBILITY GATE (not written — fix the extraction, do not override):\n  ${blocked.join("\n  ")}`,
    );
  }
  if (skipped.length) {
    console.warn(
      `\nSKIPPED (no registry entry — add slug+category+vertical to REGISTRY before these get URLs):\n  ${skipped.join("\n  ")}`,
    );
  }
  console.log(`\n${written} brand files → ${outDir}`);
}

// RUN ONLY WHEN INVOKED AS A SCRIPT. REGISTRY is exported above so
// scripts/registerBrand.ts can read the identity source instead of duplicating
// it — but a bare `main()` at module scope turns that import into an
// EXECUTION: the importer would immediately hit the missing-argv branch and
// process.exit(1), killing the caller with a usage message about a file it
// never meant to convert. Same defect shape as the machine-path bug: valid TS,
// invisible to tsc, only fails at runtime in the caller.
const invokedDirectly =
  Boolean(process.argv[1]) && /jsonl-to-brands\.[cm]?[jt]sx?$/.test(process.argv[1]);
if (invokedDirectly) main();
