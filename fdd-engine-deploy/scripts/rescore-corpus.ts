// scripts/rescore-corpus.ts
//
// RE-SCORE EVERY STORED RECORD FROM ITS OWN EXTRACTION. NO MODEL CALLS.
//
// Extraction is the only step in lib/pipeline.ts that talks to a model. Scoring,
// underwriting, insights and the financial-condition grade are deterministic
// local code, so every record in data/brands can be re-derived from the
// `extracted` block it already carries — for free, and offline.
//
// It SHOULD be. The corpus was minted over two years by whatever scorer existed
// on the day, and several defects have been fixed in the scorer since. Two live
// examples found on 2026-09-10, both minted 2026-07-13:
//
//   ellie-mental-health        top line $33/mo, taken from "Average new patients
//                              per clinic" — a COUNT. isRevenueCohort() rejects
//                              revenueType "other" today. It did not then. The
//                              same Item 19 discloses $818,077/yr of collected
//                              revenue per clinic.
//   gorilla-property-services  top line $11,431/mo from a P&L median, in a filing
//                              whose Table 1 is a system total ($10,028,981 across
//                              32 franchisees, printed beside its own per-outlet
//                              average of $313,405.66). suspectedSystemTotals()
//                              was written FOR this filing and landed after this
//                              record was minted.
//
// A CORPUS IS NOT A CACHE OF NUMBERS. IT IS A CACHE OF JUDGEMENTS. When the
// judgement improves, every record minted under the old one is stale — silently,
// and on a public URL someone can buy.
//
// USAGE
//   npx tsx scripts/rescore-corpus.ts            dry run — prints the diff, writes nothing
//   npx tsx scripts/rescore-corpus.ts --write    applies it
//
// PAID REPORTS ARE THE POINT OF THE DRY RUN. A record whose figures move is
// analysis somebody may have paid for that now disagrees with a re-run. The diff
// this prints is the work list for step 7 of the post-freeze runbook, and it is
// the reason this script does not write by default.
//
// BRAND-JSON-EXEMPT: this writes data/brands records on purpose. It is a
// re-derivation of stored judgements, never a new extraction, and it preserves
// each file's serialization format and any retraction already on it.

import fs from "node:fs";
import path from "node:path";
import { scoreFdd } from "../lib/scoring";
import { underwrite, type BuyerContext } from "../lib/underwriting";
import { buildInsights } from "../lib/insights";
import { assessFinancialCondition } from "../lib/financialCondition";
import { INSIGHTS_ENABLED, FINCON_ENABLED } from "../lib/features";
import { detectBrandJsonFormat, serializeBrandRecord } from "../lib/brandJson";

const WRITE = process.argv.includes("--write");
const dir = path.join(process.cwd(), "data", "brands");

const usd = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n)
    ? "$" + Math.round(n).toLocaleString("en-US") + "/mo"
    : "—";

type Row = { slug: string; what: string[]; retracted: boolean };

function main() {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const moved: Row[] = [];
  const failed: string[] = [];
  let unchanged = 0;

  for (const f of files) {
    const full = path.join(dir, f);
    const raw = fs.readFileSync(full, "utf8");
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      failed.push(`${f} — unparseable`);
      continue;
    }
    const result = rec.result as Record<string, unknown> | undefined;
    const extracted = result?.extracted as Parameters<typeof scoreFdd>[0] | undefined;
    // A STORED BUYER IS ONLY A BUYER IF IT IS COMPLETE. Half a buyer context
    // underwrites against a net worth nobody supplied, so an incomplete one is
    // treated as absent and the stored underwriting is carried forward instead.
    const buyerRaw = result?.buyer as Partial<BuyerContext> | undefined;
    const buyer: BuyerContext | undefined =
      typeof buyerRaw?.liquidCapital === "number" && typeof buyerRaw?.netWorth === "number"
        ? (buyerRaw as BuyerContext)
        : undefined;
    if (!extracted) {
      failed.push(`${f} — no result.extracted to re-score from`);
      continue;
    }

    const before = (result?.scoring ?? {}) as {
      midCohort?: { monthlyRevenue?: number; label?: string };
      riskLevel?: string;
      item19Unusable?: { reason?: string };
    };

    let scoring: ReturnType<typeof scoreFdd>;
    try {
      scoring = scoreFdd(extracted, buyer);
    } catch (e) {
      failed.push(`${f} — scoreFdd threw: ${(e as Error)?.message ?? e}`);
      continue;
    }
    const after = scoring as unknown as typeof before;

    const what: string[] = [];
    // COMPARE WHAT WE PUBLISH, NOT WHAT WE STORE. The first run of this script
    // reported 65 records "moving" because it compared raw floats: a top line
    // that renders as $35,667/mo either way still differs in the seventh decimal
    // after a re-derivation, and forty lines of "$35,667/mo → $35,667/mo" buried
    // the twenty-eight changes that were real. A diff nobody can read is a diff
    // nobody acts on.
    const round = (n: unknown) =>
      typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
    const b = round(before.midCohort?.monthlyRevenue);
    const a = round(after.midCohort?.monthlyRevenue);
    if (b !== a) {
      what.push(`top line ${usd(before.midCohort?.monthlyRevenue)} → ${usd(after.midCohort?.monthlyRevenue)}`);
    }
    if (before.midCohort?.label !== after.midCohort?.label) {
      what.push(`cohort "${before.midCohort?.label ?? "—"}" → "${after.midCohort?.label ?? "—"}"`);
    }
    if (before.riskLevel !== after.riskLevel) {
      what.push(`risk ${before.riskLevel ?? "—"} → ${after.riskLevel ?? "—"}`);
    }
    const wasRefused = Boolean(before.item19Unusable);
    const nowRefused = Boolean(after.item19Unusable);
    if (wasRefused !== nowRefused) {
      what.push(
        nowRefused
          ? `NOW REFUSED — ${after.item19Unusable?.reason ?? "no reason given"}`
          : `no longer refused`,
      );
    }

    if (what.length === 0) {
      unchanged++;
      continue;
    }
    moved.push({
      slug: String(rec.slug ?? f.replace(/\.json$/, "")),
      what,
      retracted: Boolean(rec.retraction),
    });

    if (WRITE) {
      // UNDERWRITING NEEDS A BUYER AND SCORING DOES NOT. A record stored without
      // one cannot be re-underwritten faithfully, and inventing a buyer would
      // silently restate someone's DSCR against assumptions they never gave. So
      // the stored underwriting block is carried forward untouched in that case
      // and the top line is still corrected — a partly-repaired record beats a
      // confidently-wrong one.
      const underwriting = buyer ? underwrite(extracted, scoring, buyer) : result?.underwriting;
      const insights = INSIGHTS_ENABLED ? buildInsights(extracted, scoring) : null;
      const financialCondition = FINCON_ENABLED
        ? assessFinancialCondition(
            (extracted as { financialCondition?: unknown }).financialCondition as never,
            (extracted as { systemScale?: unknown }).systemScale as never,
          )
        : null;
      const next = {
        ...rec,
        result: { ...result, scoring, underwriting, insights, financialCondition },
      };
      fs.writeFileSync(full, serializeBrandRecord(next as never, detectBrandJsonFormat(raw)));
    }
  }

  for (const r of moved) {
    console.log(`\n${r.slug}${r.retracted ? "   [RETRACTED]" : ""}`);
    for (const w of r.what) console.log(`   ${w}`);
  }
  if (failed.length) {
    console.warn(`\nCOULD NOT RE-SCORE:\n  ${failed.join("\n  ")}`);
  }
  const refusedNow = moved.filter((r) => r.what.some((w) => w.startsWith("NOW REFUSED"))).length;
  const gained = moved.filter((r) => r.what.some((w) => /^top line — →/.test(w))).length;
  const repriced = moved.length - refusedNow - gained;
  console.log(
    `\n${moved.length} record(s) move, ${unchanged} unchanged, ${failed.length} could not be re-scored.\n` +
      `   ${refusedNow} now REFUSE to state a per-outlet figure\n` +
      `   ${gained} gain a figure they did not have\n` +
      `   ${repriced} keep a figure at a different number`,
  );
  console.log(
    WRITE
      ? `\nWRITTEN. Every moved record is now derived from today's scorer.\n` +
          `Next: diff paid reports for the moved slugs (runbook step 7), then commit.`
      : `\nDRY RUN — nothing written. Re-run with --write to apply.`,
  );
}

main();
