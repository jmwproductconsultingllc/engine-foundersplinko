// harness/batch.ts
//
// FoundersPlinko FDD eval harness — v1 (crude on purpose: smoke detector, not
// a product). Runs the REAL diligence pipeline over a local corpus, N passes
// per FDD, writes one JSONL line per (file × pass), then prints a stability
// report — which signals flipped run-to-run for the same file. This is what
// quantifies the Five Iron going-concern flake instead of you eyeballing it.
//
// Run locally from the REPO ROOT (NOT in Vercel, NOT a CI gate — it hits the
// live model). The pipeline reuses the app's @/ alias imports transitively, so
// point tsx at the app tsconfig:
//   npx tsx --tsconfig fdd-engine-deploy/tsconfig.json harness/batch.ts
//   PASSES=5 CONCURRENCY=4 CAPITAL=300000 npx tsx --tsconfig fdd-engine-deploy/tsconfig.json harness/batch.ts
//
// ─── Remaining seams (only surface at runtime; the compiler can't catch them) ─
//   • signal field paths in extractSignals() — confirm against the real result
//   • error -> status mapping in classifyError() — confirm against gemini.ts
//   • MODEL string + prompt hashing — see CONFIG
// ────────────────────────────────────────────────────────────────────────────

import {
  readFileSync,
  readdirSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { runDiligence, type BuyerContext } from "../fdd-engine-deploy/lib/pipeline";
import type { DiligenceResult } from "../fdd-engine-deploy/lib/types";
import type {
  FddRunResult,
  RunSignals,
  RunStatus,
  StabilityReport,
  FieldFlip,
} from "./types";

// ── CONFIG ──────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = resolve(HERE, "corpus");
const RUNS_DIR = resolve(HERE, "runs");

const PASSES = Number(process.env.PASSES ?? 3);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);

// Buyer context for the run. Net worth defaults to the liquid value, mirroring
// the app's single-gold-field behavior. Override either via env.
const LIQUID_CAPITAL = Number(process.env.CAPITAL ?? 250_000);
const NET_WORTH = Number(process.env.NET_WORTH ?? LIQUID_CAPITAL);
const BUYER: BuyerContext = { liquidCapital: LIQUID_CAPITAL, netWorth: NET_WORTH };

// VERIFY: the model id you actually call in lib/gemini.ts.
const MODEL = process.env.MODEL ?? "gemini-3.5-flash";

// VERIFY: hash the REAL extraction prompt so runs are comparable across edits.
// If gemini.ts exports its prompt(s), import + hash them here instead of this
// env fallback. Until then, bump PROMPT_HASH_SOURCE whenever you change a prompt.
const PROMPT_SOURCE = process.env.PROMPT_HASH_SOURCE ?? "UNSET_PROMPT";
const PROMPT_HASH = sha256(PROMPT_SOURCE).slice(0, 12);

// ── helpers ──────────────────────────────────────────────────────────────---
function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

// Node reads files as Buffer; extractFddFromFile wants an ArrayBuffer. Copy into
// a fresh Uint8Array so .buffer is a tight, standalone ArrayBuffer.
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return new Uint8Array(buf).buffer;
}

function listCorpus(): string[] {
  if (!existsSync(CORPUS_DIR)) {
    console.error(
      `No corpus dir at ${CORPUS_DIR}.\nCreate it and drop FDD PDFs in (they stay gitignored).`,
    );
    process.exit(1);
  }
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();
}

// VERIFY: field paths. Defensive optional-chaining means a wrong path yields
// null rather than crashing — but confirm these against the real result shape.
function extractSignals(r: DiligenceResult): RunSignals {
  const x = r as any;
  return {
    finconSeverity: x.financialCondition?.severity ?? null,
    goingConcern:
      x.financialCondition?.goingConcern ??
      x.extracted?.financialCondition?.goingConcern ??
      null, // VERIFY: real key name (goingConcernRaised? hasGoingConcern?)
    riskLevel: x.scoring?.riskLevel ?? null,
  };
}

// VERIFY: map the errors gemini.ts actually throws to the taxonomy.
function classifyError(err: unknown): { status: RunStatus; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.toLowerCase();
  if (m.includes("max_tokens") || m.includes("output cap"))
    return { status: "MAX_TOKENS", message };
  if (m.includes("timeout") || m.includes("timed out") || m.includes("etimedout"))
    return { status: "MODEL_TIMEOUT", message };
  if (m.includes("json") || m.includes("parse") || m.includes("schema"))
    return { status: "PARSE_ERROR", message };
  if (m.includes("pdf") || m.includes("no pages") || m.includes("unreadable"))
    return { status: "PDF_UNREADABLE", message };
  if (m.includes("empty") || m.includes("no figures") || m.includes("no data"))
    return { status: "EXTRACTION_EMPTY", message };
  return { status: "UNKNOWN_ERROR", message };
}

async function runOnePass(
  file: string,
  pdf: Buffer,
  fileHash: string,
  pass: number,
  runId: string,
): Promise<FddRunResult> {
  const base = {
    file,
    fileHash,
    pass,
    runId,
    model: MODEL,
    promptHash: PROMPT_HASH,
    timestamp: new Date().toISOString(),
  };
  const t0 = Date.now();
  try {
    const report = await runDiligence({
      bytes: toArrayBuffer(pdf),
      mimeType: "application/pdf",
      buyer: BUYER,
    });
    return {
      ...base,
      status: "SUCCESS",
      error: null,
      durationMs: Date.now() - t0,
      signals: extractSignals(report as DiligenceResult),
      report: report as DiligenceResult,
    };
  } catch (err) {
    const { status, message } = classifyError(err);
    return {
      ...base,
      status,
      error: message,
      durationMs: Date.now() - t0,
      signals: null,
      report: null,
    };
  }
}

// Minimal concurrency pool — N workers pull from a shared cursor.
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

function buildStability(runId: string, results: FddRunResult[]): StabilityReport {
  const statusCounts: Record<string, number> = {};
  for (const r of results)
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  const byFile = new Map<string, FddRunResult[]>();
  for (const r of results) {
    const arr = byFile.get(r.file) ?? [];
    if (!byFile.has(r.file)) byFile.set(r.file, arr);
    arr.push(r);
  }

  const flips: FieldFlip[] = [];
  const signalFields: (keyof RunSignals)[] = [
    "finconSeverity",
    "goingConcern",
    "riskLevel",
  ];
  for (const [file, passes] of byFile) {
    // status itself should be identical across passes
    const statuses = Array.from(new Set(passes.map((p) => p.status)));
    if (statuses.length > 1) flips.push({ file, field: "status", values: statuses });

    // signals only exist on SUCCESS passes
    const ok = passes.filter((p) => p.status === "SUCCESS" && p.signals);
    for (const field of signalFields) {
      const distinct = Array.from(
        new Set(ok.map((p) => String(p.signals![field]))),
      );
      if (distinct.length > 1)
        flips.push({ file, field: `signals.${field}`, values: distinct });
    }
  }

  return {
    runId,
    filesTested: byFile.size,
    passesPerFile: PASSES,
    statusCounts,
    flips,
  };
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const files = listCorpus();
  if (files.length === 0) {
    console.error(`No PDFs in ${CORPUS_DIR}.`);
    process.exit(1);
  }

  mkdirSync(RUNS_DIR, { recursive: true });
  const jsonlPath = join(RUNS_DIR, `run-${runId}.jsonl`);

  console.log(
    `Eval run ${runId} — ${files.length} FDD(s) x ${PASSES} pass(es), ` +
      `concurrency ${CONCURRENCY}, model ${MODEL}, promptHash ${PROMPT_HASH}`,
  );

  // one work item per (file × pass); read each PDF once and reuse the buffer
  const work: { file: string; pdf: Buffer; fileHash: string; pass: number }[] = [];
  for (const file of files) {
    const pdf = readFileSync(join(CORPUS_DIR, file));
    const fileHash = sha256(pdf).slice(0, 16);
    for (let pass = 1; pass <= PASSES; pass++)
      work.push({ file, pdf, fileHash, pass });
  }

  const results = await mapPool(work, CONCURRENCY, async (w) => {
    const res = await runOnePass(w.file, w.pdf, w.fileHash, w.pass, runId);
    appendFileSync(jsonlPath, JSON.stringify(res) + "\n");
    const tag = res.status === "SUCCESS" ? "ok " : "ERR";
    console.log(
      `  [${tag}] ${w.file} pass ${w.pass}/${PASSES} (${res.durationMs}ms)` +
        (res.status === "SUCCESS" ? "" : ` — ${res.status}`),
    );
    return res;
  });

  const stability = buildStability(runId, results);
  const summaryPath = join(RUNS_DIR, `run-${runId}.summary.json`);
  writeFileSync(summaryPath, JSON.stringify(stability, null, 2));

  console.log("\n── Stability report ─────────────────────────────");
  console.log("Status counts:", stability.statusCounts);
  if (stability.flips.length === 0) {
    console.log("No flips across passes. ✅");
  } else {
    console.log("Flips (same file, different answer across passes):");
    for (const f of stability.flips)
      console.log(`  ⚠ ${f.file} — ${f.field}: ${f.values.join(" / ")}`);
  }
  console.log(`\nWrote:\n  ${jsonlPath}\n  ${summaryPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
