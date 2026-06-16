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

export default function FDDUpload({
  intake,
  onResult,
}: {
  intake: IntakeData;
  onResult: (r: DiligenceResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
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
      setLoading(false);
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
        <p className="mt-4 text-xs text-[#8194B0]">
          Reading the FDD and cross-referencing your capital — a full 300-page document can take up to a
          minute. Hang tight.
        </p>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          {error}
        </p>
      )}
    </div>
  );
}
