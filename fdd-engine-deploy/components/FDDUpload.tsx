"use client";

import { useState, type CSSProperties } from "react";
import type { IntakeData } from "./IntakeForm";
import type { DiligenceResult } from "@/lib/types";

/** Pull a human-readable error out of whatever the server returned. */
function readError(parsed: unknown, status: number): string {
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const e = (parsed as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) return e;
  }
  if (status === 504) {
    return "The analysis timed out — large FDDs can run long. Give it another try; if it keeps timing out, the document may be unusually large.";
  }
  if (status === 413) {
    return "That PDF is too large to upload directly (over ~4.5MB). Try a smaller or text-based copy of the FDD.";
  }
  if (status >= 500) {
    return `The server hit an error (status ${status}). Please try again in a moment.`;
  }
  return `Couldn't analyze the FDD (status ${status}).`;
}

/** Narrated phases shown during the parse. Index 0 shows immediately; the rest
 *  are timed (see run()). The last two are safe to dwell on if the call runs long. */
const PHASES = [
  "Reading the document you uploaded…",
  "Confirming this is a Franchise Disclosure Document…",
  "Identifying the brand and franchisor…",
  "Extracting Item 7, Item 19 & the fee structure…",
  "Separating franchisee vs. company-owned performance…",
  "Running the numbers and generating your report…",
  "Finishing touches — flagging anomalies in the data…",
];

/** Style for the vertical connector between steps: solid green once a step is
 *  done, flowing dashes on the active segment (toward the "win" below), muted
 *  static dashes ahead. */
function connectorStyle(done: boolean, active: boolean): CSSProperties {
  if (done) return { backgroundColor: "#34D399" };
  const color = active ? "#38BDF8" : "#27344F";
  return {
    backgroundImage: `repeating-linear-gradient(to bottom, ${color} 0 4px, transparent 4px 9px)`,
    ...(active ? { animation: "fe-flow 0.55s linear infinite" } : {}),
  };
}

export default function FDDUpload({
  intake,
  onResult,
}: {
  intake: IntakeData;
  onResult: (r: DiligenceResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setPhase(0);
    // Narrate the ~1-minute parse so it never looks frozen. These are timed, not
    // tied to real server events — the heavy extraction is one opaque ~45s model
    // call with no sub-progress — but they're paced to the real phases, and the
    // last messages park until the response actually lands.
    // Pace to file size: small FDDs move faster, big filings stretch. Baseline
    // tuned to ~12MB; clamped so tiny/huge files stay sane. Calibrate the base
    // array from your real run durations.
    const scale = Math.min(2, Math.max(0.5, file.size / (12 * 1024 * 1024)));
    const timers = [3000, 7000, 12000, 22000, 35000, 70000].map((ms, i) =>
      setTimeout(() => setPhase(i + 1), Math.round(ms * scale)),
    );
    try {
      const fd = new FormData();
      fd.append("fdd", file);
      fd.append("liquidAssets", String(intake.liquidCapital));
      fd.append("netWorth", String(intake.netWorth));

      const res = await fetch("/api/parse-fdd", { method: "POST", body: fd });

      // Read the body ONCE as text, then try to parse it. This way a non-JSON
      // response (a timeout page, an empty 504 body, an HTML error) never throws
      // a cryptic "Unexpected token" / "did not match the expected pattern".
      const raw = await res.text();
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        /* response wasn't JSON — handled below */
      }

      if (!res.ok) {
        throw new Error(readError(parsed, res.status));
      }
      if (!parsed) {
        throw new Error("The server returned an unexpected response. Please try again.");
      }

      onResult(parsed as DiligenceResult);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      // Network-level failures (dropped connection, some timeouts) surface here.
      const isNetwork = /load failed|networkerror|failed to fetch|terminated/i.test(msg);
      setError(
        isNetwork
          ? "The request didn't complete — usually a timeout on a large FDD. Please try again."
          : msg,
      );
    } finally {
      timers.forEach(clearTimeout);
      setLoading(false);
      setPhase(0);
    }
  };

  return (
    <div className="bg-[#16223B] border border-[#27344F] rounded-xl p-6 md:p-8">
      <h2 className="text-lg font-bold text-[#F1F5F9] mb-1">Upload the FDD</h2>
      <p className="text-sm text-[#8194B0] mb-5">
        We&apos;ll cross-reference your{" "}
        <span className="text-[#CBD5E1] font-medium">${intake.liquidCapital.toLocaleString()}</span> liquid
        capital against this franchise&apos;s real unit economics and required build-out.
      </p>

      <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
        <input
          type="file"
          accept="application/pdf"
          disabled={loading}
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setError(null);
          }}
          className="block w-full text-sm text-[#8194B0] file:mr-4 file:py-2.5 file:px-4 file:rounded-lg
            file:border-0 file:text-sm file:font-semibold file:bg-[#1E2C49] file:text-[#38BDF8]
            hover:file:bg-[#27344F] cursor-pointer disabled:opacity-50"
        />
        <button
          onClick={run}
          disabled={!file || loading}
          className="whitespace-nowrap px-6 py-2.5 rounded-lg font-semibold bg-[#34D399] text-[#0B1220]
            hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {loading ? "Analyzing…" : "Generate Diligence Report"}
        </button>
      </div>

      {loading && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          aria-live="polite"
          role="status"
        >
          <style>{`
            @keyframes fe-flow { to { background-position: 0 9px; } }
            @keyframes fe-spin { to { transform: rotate(360deg); } }
          `}</style>
          <div className="w-[min(92vw,440px)] rounded-2xl border border-[#27344F] bg-[#16223B] p-7 shadow-2xl">
            <h3 className="text-base font-bold text-[#F1F5F9]">Analyzing the FDD</h3>
            <p className="mt-1 mb-5 text-xs text-[#8194B0] truncate">
              Reading {file?.name ?? "your document"} — up to a minute for a large filing.
            </p>
            <ol>
              {PHASES.map((label, i) => {
                const done = i < phase;
                const active = i === phase;
                const last = i === PHASES.length - 1;
                return (
                  <li key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      {done ? (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#34D399] text-[13px] font-bold text-[#0B1220]">
                          ✓
                        </span>
                      ) : active ? (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[#1E2C49]">
                          <span
                            className="h-3.5 w-3.5 rounded-full border-2 border-[#38BDF8] border-t-transparent"
                            style={{ animation: "fe-spin 0.7s linear infinite" }}
                          />
                        </span>
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[#27344F]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#3A496A]" />
                        </span>
                      )}
                      {!last && (
                        <span
                          className="my-1 w-[2px] flex-1"
                          style={{ minHeight: 16, ...connectorStyle(done, active) }}
                        />
                      )}
                    </div>
                    <div
                      className={`pb-5 pt-0.5 text-sm ${
                        done
                          ? "text-[#6E7F9E]"
                          : active
                            ? "font-semibold text-[#F1F5F9]"
                            : "text-[#5A6B88]"
                      }`}
                    >
                      {label}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          {error}
        </p>
      )}
    </div>
  );
}
