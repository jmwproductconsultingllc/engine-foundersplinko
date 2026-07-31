/**
 * rankAudit.ts — run the corrected fee load and the rank test across the library.
 *
 *   npx tsx scripts/rankAudit.ts            # from fdd-engine-deploy/
 *   npx tsx scripts/rankAudit.ts --json     # machine-readable
 *
 * This script answers four questions that gate the rank test's release, and it
 * answers them from the real records rather than from a guess:
 *
 *   1. How many brands have a locatable recurring-fee table at all?
 *   2. How many contain a percentage-of-sales fee this code cannot classify?
 *      Every distinct unclassified label printed here is an extraction ticket.
 *   3. How many brands have Item 19 figures, and how many do not? That count is
 *      a real product boundary, not a gap to fill.
 *   4. HOW MANY BRANDS CHANGE SEVERITY WHEN THE OMITTED FEES ARE INCLUDED?
 *      That is the size of the current defect, stated in brands.
 *
 * The reader functions below are GUESSES against the computed-record shape. They
 * are deliberately permissive and they report what they could not find. Bind
 * them before trusting any count.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { computeFeeLoad, rawFeesFromComputed, type RawFee } from "../lib/feeLoad";
import { computeRankTest, type Band, type Item19Distribution, type Severity } from "../lib/rankTest";

const BRANDS_DIR = resolve(process.cwd(), "data/brands");
const BANDS_FILE = resolve(process.cwd(), "data/bands.v1.json");
const JSON_OUT = process.argv.includes("--json");

const DEFAULT_RATE_PCT = 10.5; // versioned constant; review date lives with the bands table
const DEFAULT_TERM_YEARS = 10;
const LENDER_BAR = 1.25;

type BandsFile = {
  version: string;
  categories: Record<string, { low: number; mid: number; high: number }>;
  default: { low: number; mid: number; high: number };
};

function loadBands(): BandsFile {
  if (!existsSync(BANDS_FILE)) {
    throw new Error(`bands table not found at ${BANDS_FILE}. Stand it up before running.`);
  }
  return JSON.parse(readFileSync(BANDS_FILE, "utf8")) as BandsFile;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** READER — field names are guesses. */
function readItem19(rec: any): Item19Distribution {
  const i19 = rec?.item19 ?? rec?.financialPerformance ?? {};
  const toAnnual = (annual: unknown, monthly: unknown): number | null => {
    const a = num(annual);
    if (a !== null) return a;
    const m = num(monthly);
    return m !== null ? m * 12 : null;
  };
  return {
    lowAnnual: toAnnual(i19.lowAnnual, i19.lowMonthly ?? i19.low),
    medianAnnual: toAnnual(i19.medianAnnual, i19.medianMonthly ?? i19.median),
    averageAnnual: toAnnual(i19.averageAnnual, i19.averageMonthly ?? i19.average),
    highAnnual: toAnnual(i19.highAnnual, i19.highMonthly ?? i19.high),
    unitsDescribed: num(i19.unitsDescribed ?? i19.unitsReporting ?? i19.unitCount),
    systemUnits: num(rec?.systemScale?.totalUnits ?? rec?.item20?.totalUnits),
    basis: typeof i19.basis === "string" ? i19.basis : null,
    multiYearSameUnit:
      typeof i19.multiYearSameUnit === "boolean" ? i19.multiYearSameUnit : null,
  };
}

/** READER — field names are guesses. */
function readCapitalGap(rec: any): number | null {
  return num(rec?.buyerFit?.capitalGap ?? rec?.item7?.totalHigh ?? rec?.item7?.total);
}

function readCategory(rec: any): string {
  return String(rec?.category ?? rec?.vertical ?? "").toLowerCase();
}

function bandFor(bands: BandsFile, category: string): Band {
  const hit = bands.categories[category] ?? bands.default;
  return { ...hit, sourced: "category", version: bands.version };
}

/**
 * The uncorrected load — used to size the defect, and it isolates ONE cause.
 *
 * Two different omissions are possible and they must not be conflated:
 *   (a) CLASS omission — a co-op / regional / local advertising percentage that
 *       was never in scope. This is what section 5 of the audit measures.
 *   (b) NAMING omission — a fund line the old matcher did not recognise because
 *       it is called something other than "brand fund". Section 6 measures that.
 *
 * Reporting (a) and (b) as one number would overstate the co-op finding, so the
 * uncorrected set here keeps every other load-bucket fee and drops only the
 * co-op / regional / local class.
 */
const COOP_CLASS = /co[-\s]?op|cooperative\s+advertis|regional\s+(advertis|marketing)|local\s+(advertis|marketing)/i;
const OLD_MATCHER = /royalt|brand\s*fund/i;

function uncorrectedFees(fees: RawFee[]): RawFee[] {
  return fees.filter((f) => !COOP_CLASS.test(f.label));
}

/** Load-bucket fees the previous royalty+brand-fund matcher would have missed. */
function namingMisses(fees: RawFee[]): string[] {
  return fees
    .filter(
      (f) =>
        typeof f.ratePctLow === "number" &&
        !COOP_CLASS.test(f.label) &&
        !OLD_MATCHER.test(f.label),
    )
    .map((f) => f.label);
}

type Row = {
  slug: string;
  category: string;
  feesFound: boolean;
  feeComplete: boolean;
  unclassified: string[];
  namingMisses: string[];
  loadLow: number | null;
  loadHigh: number | null;
  hasItem19: boolean;
  coveragePct: number | null;
  severity: Severity | null;
  severityUncorrected: Severity | null;
  status: string;
  reason: string | null;
};

function main(): void {
  const bands = loadBands();
  if (!existsSync(BRANDS_DIR)) throw new Error(`no brand records at ${BRANDS_DIR}`);
  const files = readdirSync(BRANDS_DIR).filter((f) => f.endsWith(".json"));
  const rows: Row[] = [];

  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    let rec: any;
    try {
      rec = JSON.parse(readFileSync(join(BRANDS_DIR, file), "utf8"));
    } catch {
      rows.push({
        slug, category: "", feesFound: false, feeComplete: false, unclassified: [], namingMisses: [],
        loadLow: null, loadHigh: null, hasItem19: false, coveragePct: null,
        severity: null, severityUncorrected: null, status: "unreadable", reason: "bad json",
      });
      continue;
    }

    const raw = rawFeesFromComputed(rec);
    const category = readCategory(rec);
    const item19 = readItem19(rec);
    const hasItem19 = [item19.medianAnnual, item19.averageAnnual, item19.highAnnual].some(
      (v) => typeof v === "number",
    );
    const gap = readCapitalGap(rec);
    const band = bandFor(bands, category);

    if (raw === null) {
      rows.push({
        slug, category, feesFound: false, feeComplete: false, unclassified: [], namingMisses: [],
        loadLow: null, loadHigh: null, hasItem19,
        coveragePct:
          item19.unitsDescribed && item19.systemUnits
            ? item19.unitsDescribed / item19.systemUnits
            : null,
        severity: null, severityUncorrected: null,
        status: "no-fee-table", reason: "could not locate a recurring fee table",
      });
      continue;
    }

    const fl = computeFeeLoad(raw);
    const flOld = computeFeeLoad(uncorrectedFees(raw));

    const run = (load: typeof fl): { sev: Severity | null; status: string; reason: string | null } => {
      if (gap === null) return { sev: null, status: "no-capital-gap", reason: "no financed amount" };
      const r = computeRankTest({
        capitalGap: gap,
        annualRatePct: DEFAULT_RATE_PCT,
        termYears: DEFAULT_TERM_YEARS,
        fixedFeesAnnual: load.fixedAnnual,
        feeLoad: load,
        band,
        lenderBar: LENDER_BAR,
        item19,
      });
      return { sev: r.severity, status: r.status, reason: r.reason };
    };

    const now = run(fl);
    const before = run({ ...flOld, complete: fl.complete });

    rows.push({
      slug, category,
      feesFound: true,
      feeComplete: fl.complete,
      unclassified: fl.unclassified,
      namingMisses: namingMisses(raw),
      loadLow: fl.low, loadHigh: fl.high,
      hasItem19,
      coveragePct:
        item19.unitsDescribed && item19.systemUnits
          ? item19.unitsDescribed / item19.systemUnits
          : null,
      severity: now.sev,
      severityUncorrected: before.sev,
      status: now.status,
      reason: now.reason,
    });
  }

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ bandVersion: bands.version, rows }, null, 2));
    return;
  }

  const n = rows.length;
  const pct = (k: number) => `${((k / Math.max(n, 1)) * 100).toFixed(0)}%`;
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;

  console.log(`\nrank audit — ${n} brand records — band table ${bands.version}\n`);

  console.log("1. FEE TABLE COVERAGE");
  console.log(`   located          ${count((r) => r.feesFound)} (${pct(count((r) => r.feesFound))})`);
  console.log(`   not located      ${count((r) => !r.feesFound)}`);
  console.log(`   fully classified ${count((r) => r.feeComplete)}`);

  const labels = new Map<string, number>();
  for (const r of rows) for (const u of r.unclassified) labels.set(u, (labels.get(u) ?? 0) + 1);
  if (labels.size) {
    console.log("\n2. UNCLASSIFIED FEE LABELS — each one is an extraction ticket");
    [...labels.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([l, c]) => console.log(`   ${String(c).padStart(4)}  ${l}`));
  } else {
    console.log("\n2. UNCLASSIFIED FEE LABELS — none");
  }

  console.log("\n3. DISCLOSED PERFORMANCE");
  console.log(`   with Item 19     ${count((r) => r.hasItem19)} (${pct(count((r) => r.hasItem19))})`);
  console.log(`   without Item 19  ${count((r) => !r.hasItem19)}  <- the highest-risk tier, not a gap`);
  const cov = rows.map((r) => r.coveragePct).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (cov.length) {
    const q = (p: number) => cov[Math.min(cov.length - 1, Math.floor(p * cov.length))];
    console.log(
      `   coverage p10 ${(q(0.1) * 100).toFixed(0)}%  p50 ${(q(0.5) * 100).toFixed(0)}%  p90 ${(q(0.9) * 100).toFixed(0)}%`,
    );
  }

  console.log("\n4. SEVERITY DISTRIBUTION (corrected load)");
  for (const s of ["high", "medium", "low", "none"] as const) {
    console.log(`   ${s.padEnd(8)} ${count((r) => r.severity === s)}`);
  }
  console.log(`   unavailable ${count((r) => r.severity === null)}`);

  const worsened = rows.filter(
    (r) =>
      r.severity !== null &&
      r.severityUncorrected !== null &&
      r.severity !== r.severityUncorrected,
  );
  console.log("\n5. SIZE OF THE DEFECT");
  console.log(`   brands whose severity changes once the omitted fees are counted: ${worsened.length}`);
  worsened
    .slice(0, 25)
    .forEach((r) =>
      console.log(`   ${r.slug.padEnd(28)} ${r.severityUncorrected} -> ${r.severity}`),
    );
  if (worsened.length > 25) console.log(`   ... and ${worsened.length - 25} more`);
  console.log("   (this counts the co-op / regional / local advertising class only)");

  const misses = new Map<string, number>();
  for (const r of rows) for (const m of r.namingMisses) misses.set(m, (misses.get(m) ?? 0) + 1);
  console.log("\n6. FUND LINES THE OLD ROYALTY+BRAND-FUND MATCHER WOULD HAVE MISSED");
  if (misses.size === 0) console.log("   none");
  else
    [...misses.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([l, c]) => console.log(`   ${String(c).padStart(4)}  ${l}`));
  console.log("");
}

main();
