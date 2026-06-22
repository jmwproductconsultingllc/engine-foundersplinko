// harness/types.ts
//
// Result schema for the FDD eval harness. Self-contained — the only app import
// is the DiligenceResult *type* (so the stored report matches production).
// One FddRunResult is written as a JSONL line per (FDD × pass).

// Type-only import — erased at runtime, so a wrong path here can't crash the
// run. Adjust if your types live elsewhere.
import type { DiligenceResult } from "../fdd-engine-deploy/lib/types";

/** The failure taxonomy. "failure" is never a boolean — split it so the data
 *  becomes a punch list sorted by frequency. Soft signals (going-concern,
 *  INSUFFICIENT_DATA) are NOT statuses — they live on `signals` of a SUCCESS. */
export type RunStatus =
  | "SUCCESS" // pipeline returned a full DiligenceResult
  | "PDF_UNREADABLE" // file couldn't be parsed as a usable PDF (scanned/corrupt)
  | "EXTRACTION_EMPTY" // model returned but extraction had no usable figures
  | "MAX_TOKENS" // both full + minimal-mode passes exceeded the output cap
  | "MODEL_TIMEOUT" // the model call timed out
  | "PARSE_ERROR" // model returned non-JSON / schema-invalid output
  | "UNKNOWN_ERROR"; // anything else — message captured in `error`

/** Always-present, high-value reads we watch for run-to-run flips.
 *  Deliberately the bulletproof fields, not the fragile build-up rows. */
export interface RunSignals {
  finconSeverity: string | null; // HIGH / MEDIUM / LOW / INSUFFICIENT_DATA
  goingConcern: boolean | null; // auditor going-concern flag, if extracted
  riskLevel: string | null; // scoring risk level
}

/** One record per (file × pass). */
export interface FddRunResult {
  // identity
  file: string; // corpus filename
  fileHash: string; // sha256 of the PDF bytes — dedup + change detection
  pass: number; // which pass (1..N) for this file in this run
  runId: string; // shared by every record in one harness run

  // provenance — makes runs comparable across prompt/model edits
  model: string; // e.g. "gemini-3.5-flash"
  promptHash: string; // hash of the extraction prompt(s) used
  timestamp: string; // ISO of this pass

  // outcome
  status: RunStatus;
  error: string | null; // failure detail when status !== SUCCESS
  durationMs: number;

  // payload (only on SUCCESS)
  signals: RunSignals | null;
  report: DiligenceResult | null; // the full deterministic read
}

/** A field that gave more than one answer across passes for the same file. */
export interface FieldFlip {
  file: string;
  field: string; // "status" or "signals.<name>"
  values: string[]; // distinct values seen across passes
}

/** The committable summary — counts + flips only, no franchisor data. */
export interface StabilityReport {
  runId: string;
  filesTested: number;
  passesPerFile: number;
  statusCounts: Record<string, number>;
  flips: FieldFlip[];
}
