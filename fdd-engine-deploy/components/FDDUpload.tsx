"use client";

import { useState } from "react";
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
  "Large document — almost there, hang tight…",
];

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
    const timers = [3000, 7000, 12000, 22000, 35000, 70000].map((ms, i) =>
      setTimeout(() => setPhase(i + 1), ms),
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
        <div className="mt-5" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#38BDF8] opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#38BDF8]" />
            </span>
            <span className="text-sm font-medium text-[#CBD5E1] transition-opacity duration-300">
              {PHASES[phase]}
            </span>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#1E2C49]">
            <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#34D399] to-[#38BDF8] animate-pulse" />
          </div>
          <p className="mt-2 text-xs text-[#8194B0]">
            A full 300-page FDD can take up to a minute — this isn&apos;t stuck.
          </p>
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
