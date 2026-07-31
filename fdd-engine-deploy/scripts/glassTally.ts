/**
 * scripts/glassTally.ts — why is this brand still on the teaser?
 *
 * Runs the real glassDecision() over every live brand with the ?v=glass
 * override applied (so the launch flag is out of the picture) and prints, per
 * brand, the reason it does or does not get a glass page — plus, for the
 * too-thin ones, exactly which of the two floors it missed and by how much.
 *
 * The gate is deliberately conservative and there is no way to eyeball it from
 * a record: `minFiguresForGlass` counts figures ACROSS the built shell, and the
 * required sections are checked for figureCount > 0, not for existing. So the
 * only honest answer to "why is back9 not glass" is to run the gate and read it.
 *
 *   npx tsx scripts/glassTally.ts            # summary + the failures
 *   npx tsx scripts/glassTally.ts --all      # every brand, one line each
 *   npx tsx scripts/glassTally.ts back9 golf # only slugs matching these
 */

import { listBrands } from "@/lib/brands";
import { glassDecision } from "@/lib/glassGate";
import {
  buildReportShell,
  qualifiesForGlass,
  DEFAULT_GLASS_CONFIG,
} from "@/lib/reportShell";
import { reportSourceFromComputed } from "@/lib/reportSource";

const argv = process.argv.slice(2);
const showAll = argv.includes("--all");
const filters = argv.filter((a) => !a.startsWith("--"));

type Row = {
  slug: string;
  reason: string;
  figures: number | null;
  missing: string[];
  detail: string;
};

async function main() {
  const brands = await listBrands();
  const rows: Row[] = [];

  for (const b of brands) {
    if (filters.length && !filters.some((f) => b.slug.includes(f))) continue;

    // The override bypasses GLASS_ENABLED and nothing else — exactly what a
    // ?v=glass visit does. It cannot bypass the thinness floor.
    const d = glassDecision(b, "glass");

    let figures: number | null = null;
    let missing: string[] = [];
    let detail = "";

    if (d.reason === "too-thin") {
      // Re-build to read the counts. glassDecision throws the shell away on a
      // failure because a half-qualified shell has no consumer — but the
      // numbers are what makes the answer actionable, so re-derive them here.
      try {
        const shell = buildReportShell(
          reportSourceFromComputed(b),
          DEFAULT_GLASS_CONFIG,
        );
        figures = shell.counts.figures;
        const withFigures = new Set(
          shell.sections.filter((s) => s.figureCount > 0).map((s) => s.id),
        );
        missing = DEFAULT_GLASS_CONFIG.requiredSections.filter(
          (id) => !withFigures.has(id),
        );
        const short = DEFAULT_GLASS_CONFIG.minFiguresForGlass - figures;
        const parts: string[] = [];
        if (short > 0) {
          parts.push(
            `${figures} figures, needs ${DEFAULT_GLASS_CONFIG.minFiguresForGlass} (short ${short})`,
          );
        }
        if (missing.length) {
          parts.push(`no figures in: ${missing.join(", ")}`);
        }
        detail = parts.join(" · ");
        // A too-thin verdict with neither cause is the gate disagreeing with
        // itself. Say so rather than printing an empty reason.
        if (!parts.length) {
          detail = `qualifiesForGlass()=${qualifiesForGlass(shell)} but no floor missed — INVESTIGATE`;
        }
      } catch (e) {
        detail = `re-build threw: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    if (d.shell) figures = d.shell.counts.figures;

    rows.push({ slug: b.slug, reason: d.reason, figures, missing, detail });
  }

  const ok = rows.filter((r) => r.reason === "ok");
  const bad = rows.filter((r) => r.reason !== "ok");

  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));

  if (showAll) {
    for (const r of rows.sort((a, b) => a.slug.localeCompare(b.slug))) {
      console.log(
        `  ${pad(r.slug, 34)} ${pad(r.reason, 13)} ${
          r.figures != null ? `${r.figures} figures` : ""
        } ${r.detail}`,
      );
    }
    console.log("");
  }

  if (bad.length) {
    console.log("  NOT GLASS:");
    for (const r of bad.sort((a, b) => a.slug.localeCompare(b.slug))) {
      console.log(`    ${pad(r.slug, 34)} ${pad(r.reason, 13)} ${r.detail}`);
    }
    console.log("");
  }

  const byReason = new Map<string, number>();
  for (const r of rows) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  const tally = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`)
    .join(" / ");

  console.log(`  glass: ${tally}   (${ok.length}/${rows.length} qualify)`);
  console.log(
    `  floor: ${DEFAULT_GLASS_CONFIG.minFiguresForGlass} figures, sections required: ${DEFAULT_GLASS_CONFIG.requiredSections.join(", ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
