"use client";

import { useState, useRef, type CSSProperties, type DragEvent } from "react";
import { upload } from "@vercel/blob/client";
import type { DiligenceResult } from "@/lib/types";
import { track } from "@/lib/analytics";

// Display face with a system fallback, so this works whether or not the
// next/font variable is set in layout.tsx.
const DISPLAY =
  "var(--font-display, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)";

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

/** Style for the vertical connector between steps. */
function connectorStyle(done: boolean, active: boolean): CSSProperties {
  if (done) return { backgroundColor: "#34D399" };
  const color = active ? "#38BDF8" : "#27344F";
  return {
    backgroundImage: `repeating-linear-gradient(to bottom, ${color} 0 4px, transparent 4px 9px)`,
    ...(active ? { animation: "fe-flow 0.55s linear infinite" } : {}),
  };
}

const QUICK = [
  { label: "$100k", value: 100_000 },
  { label: "$250k", value: 250_000 },
  { label: "$500k", value: 500_000 },
  { label: "$1M", value: 1_000_000 },
];

export default function FDDUpload({
  onResult,
}: {
  onResult: (r: DiligenceResult) => void;
}) {
  const [liquid, setLiquid] = useState<number>(250_000);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (f.type !== "application/pdf") {
      setError("That doesn't look like a PDF. Upload the FDD as a PDF file.");
      return;
    }
    setFile(f);
    setError(null);
    track("file_selected", { sizeMB: Math.round((f.size / 1048576) * 100) / 100 });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files?.[0] ?? null);
  };

  const run = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setPhase(0);
    const startedAt = Date.now();
    track("analyze_started", {
      capital: liquid,
      fileSizeMB: Math.round((file.size / 1048576) * 100) / 100,
    });
    // Narrate the ~1-minute parse so it never looks frozen. Timed, not tied to
    // real server events; paced to file size and parked on the last messages.
    const scale = Math.min(2, Math.max(0.5, file.size / (12 * 1024 * 1024)));
    const timers = [3000, 7000, 12000, 22000, 35000, 70000].map((ms, i) =>
      setTimeout(() => setPhase(i + 1), Math.round(ms * scale)),
    );
    try {
      // Upload straight to Vercel Blob (no 4.5MB body limit), then hand the
      // route the blob URL + buyer capital as small JSON. We collect one number
      // now — liquid capital toward the build-out — and pass it as both the
      // liquid figure and a conservative net-worth floor.
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
      });

      const res = await fetch("/api/parse-fdd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl: blob.url,
          liquidAssets: liquid,
          netWorth: liquid,
        }),
      });

      // Pre-flight failures (bad request, file retrieval) come back as a normal
      // JSON error with a status code — map them the old way.
      if (!res.ok) {
        const raw = await res.text();
        let errParsed: unknown = null;
        try {
          errParsed = raw ? JSON.parse(raw) : null;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(readError(errParsed, res.status));
      }

      // Success is a keep-alive STREAM: heartbeat whitespace while the server
      // works (so Safari/proxies don't drop a long, silent request), then one
      // final JSON line — the result, or an { error } payload. Read to the end,
      // then parse the trailing JSON (heartbeats are whitespace, so trim clears them).
      let acc = "";
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
        }
        acc += decoder.decode();
      } else {
        acc = await res.text();
      }

      let parsed: unknown = null;
      try {
        const trimmed = acc.trim();
        parsed = trimmed ? JSON.parse(trimmed) : null;
      } catch {
        throw new Error("The server returned an unexpected response. Please try again.");
      }
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        const e = (parsed as { error?: unknown }).error;
        throw new Error(typeof e === "string" && e.trim() ? e : "Failed to analyze the FDD.");
      }
      if (!parsed) {
        throw new Error("The server returned an unexpected response. Please try again.");
      }

      const r = parsed as DiligenceResult;
      track("analyze_succeeded", {
        capital: liquid,
        durationMs: Date.now() - startedAt,
        riskLevel: r.scoring?.riskLevel ?? null,
        finconSeverity: r.financialCondition?.severity ?? "none",
        proFormaBuilt: r.scoring?.midCohort != null,
      });
      onResult(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      const isNetwork = /load failed|networkerror|failed to fetch|terminated/i.test(msg);
      setError(
        isNetwork
          ? "The request didn't complete — usually a timeout on a large FDD. Please try again."
          : msg,
      );
      track("analyze_failed", { message: msg, network: isNetwork });
    } finally {
      timers.forEach(clearTimeout);
      setLoading(false);
      setPhase(0);
    }
  };

  const fmt = (n: number) => (n ? n.toLocaleString("en-US") : "");

  return (
    <div className="rounded-2xl border border-[#27344F] bg-gradient-to-b from-[#16223B] to-[#111B30] p-6 md:p-8 shadow-2xl shadow-black/40">
      <style>{`
        @keyframes fe-flow { to { background-position: 0 9px; } }
        @keyframes fe-spin { to { transform: rotate(360deg); } }
        @keyframes fe-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* ── Step 1: the one number (the signature) ── */}
      <label className="block text-sm font-semibold text-[#F1F5F9]">
        How much can you put toward opening?
      </label>
      <p className="mt-1 text-xs text-[#8194B0]">
        The cash you have for the build-out — the one number we measure the whole deal against.
      </p>

      <div
        className="mt-4 flex items-center gap-1.5 rounded-xl border border-[#F5B847]/30 bg-[#0B1220] px-4 py-3
          focus-within:border-[#F5B847]/70 focus-within:ring-2 focus-within:ring-[#F5B847]/15 transition-colors"
      >
        <span
          className="text-3xl md:text-4xl font-semibold text-[#F5B847] leading-none select-none"
          style={{ fontFamily: DISPLAY }}
        >
          $
        </span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Capital available toward opening, in dollars"
          value={fmt(liquid)}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 9);
            setLiquid(digits ? Number(digits) : 0);
          }}
          onFocus={(e) => e.target.select()}
          placeholder="250,000"
          className="w-full bg-transparent text-3xl md:text-4xl font-semibold text-[#F5B847] leading-none
            placeholder:text-[#5A6B88] focus:outline-none"
          style={{ fontFamily: DISPLAY }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => setLiquid(q.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              liquid === q.value
                ? "border-[#F5B847]/60 bg-[#F5B847]/10 text-[#F5B847]"
                : "border-[#27344F] text-[#8194B0] hover:border-[#3A496A] hover:text-[#CBD5E1]"
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* ── Step 2: the document ── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!loading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !loading && fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !loading) {
            e.preventDefault();
            fileInput.current?.click();
          }
        }}
        className={`mt-6 cursor-pointer rounded-xl border-2 border-dashed px-5 py-7 text-center transition-colors ${
          dragging
            ? "border-[#34D399] bg-[#34D399]/5"
            : file
              ? "border-[#34D399]/50 bg-[#34D399]/5"
              : "border-[#27344F] hover:border-[#3A496A] bg-[#0B1220]/40"
        }`}
      >
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          disabled={loading}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#34D399] text-[13px] font-bold text-[#0B1220]">
              ✓
            </span>
            <span className="font-medium text-[#F1F5F9] truncate max-w-[16rem]">{file.name}</span>
            <span className="text-[#8194B0]">· tap to change</span>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-[#CBD5E1]">
              Drop the FDD here, or <span className="text-[#38BDF8]">browse</span>
            </p>
            <p className="mt-1 text-xs text-[#8194B0]">PDF · up to ~4.5MB</p>
          </>
        )}
      </div>

      {/* ── Step 3: go ── */}
      <button
        onClick={run}
        disabled={!file || loading}
        className="mt-5 w-full rounded-xl bg-[#34D399] px-6 py-3.5 text-base font-bold text-[#0B1220]
          hover:brightness-110 active:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed
          transition shadow-lg shadow-[#34D399]/10"
      >
        {loading ? "Analyzing…" : "Run my diligence"}
      </button>
      <p className="mt-2.5 text-center text-xs text-[#5A6B88]">
        Your file is processed to generate the report, not stored or sold.
      </p>

      {/* ── Loading overlay (unchanged behavior) ── */}
      {loading && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          aria-live="polite"
          role="status"
        >
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
