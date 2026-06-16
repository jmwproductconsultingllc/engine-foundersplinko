"use client";

import { useState } from "react";
import type { IntakeData } from "./IntakeForm";
import type { DiligenceResult } from "@/lib/types";

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed.");
      onResult(data as DiligenceResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
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
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-[#8194B0] file:mr-4 file:py-2.5 file:px-4 file:rounded-lg
            file:border-0 file:text-sm file:font-semibold file:bg-[#1E2C49] file:text-[#38BDF8]
            hover:file:bg-[#27344F] cursor-pointer"
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

      {error && (
        <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          {error}
        </p>
      )}
    </div>
  );
}
