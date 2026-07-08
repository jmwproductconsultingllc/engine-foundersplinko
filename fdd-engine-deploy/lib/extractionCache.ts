// fdd-engine-deploy/lib/extractionCache.ts
//
// Content-addressed cache for the FINISHED extraction of an FDD.
//
// Why this exists
// ---------------
// An FDD is immutable for its filing year. Re-running the (slow, paid, and
// slightly non-deterministic) model on the SAME bytes is wasted money AND the
// source of the "same document graded HIGH one run, MEDIUM the next" flip-flop:
// tiny run-to-run variance in the extracted numbers tips a borderline case across
// a scoring threshold. Cache the extraction once, keyed by the document's content
// hash, and every subsequent run returns byte-identical data → identical score →
// no flip-flop, forever. First run pays the model cost; every run after is instant
// and free.
//
// Scope boundary (IMPORTANT — do not "simplify" this away)
// --------------------------------------------------------
// This caches the EXTRACTION (buyer-independent facts pulled from the PDF). It is
// deliberately SEPARATE from report persistence (lib/reports.ts):
//   - Reports are keyed by a random UUID and carry a per-buyer `paid` flag.
//     Two buyers of the same brand get two reports with two paid states.
//   - Extractions are keyed by the file hash and shared across ALL buyers. There
//     is nothing buyer-specific in an ExtractedFDD, so sharing it is safe and is
//     the whole point.
// Keying reports by hash would let a second buyer inherit the first's paid unlock
// — so we never do that. Two stores, two key schemes, on purpose.
//
// Failure policy
// --------------
// The cache is an OPTIMIZATION, never a dependency. Every read/write is wrapped so
// that a Blob hiccup can never block a sale: a failed read → treat as a miss and
// extract normally; a failed write → serve the just-computed result and move on.

import { head, put, del } from "@vercel/blob";
import type { ExtractedFDD } from "./schema";

// Bump this when the extraction SCHEMA or the backfill logic changes in a way that
// makes previously-cached extractions stale. Old entries under a prior version are
// simply never read (a miss), so a bump is a safe, instant, global invalidation —
// no manual purge needed. (Scoring/underwriting changes do NOT need a bump: those
// run downstream at read time and are not part of the cached object.)
const CACHE_VERSION = "v1";

// Same 18-month horizon as reports.ts — an FDD's useful life is one filing cycle
// plus slack. Entries past this are re-extracted on next request (and refreshed).
const MAX_AGE_MS = 18 * 30 * 24 * 60 * 60 * 1000;

function keyFor(fileHash: string): string {
  return `extractions/${CACHE_VERSION}/${fileHash}.json`;
}

interface CacheEnvelope {
  fileHash: string;
  cachedAt: string; // ISO
  version: string;
  extracted: ExtractedFDD;
}

/**
 * Look up a finished extraction by content hash.
 * Returns the cached ExtractedFDD on hit, or null on miss / any error.
 * Never throws — callers treat null as "not cached, extract normally".
 */
export async function getCachedExtraction(
  fileHash: string,
): Promise<ExtractedFDD | null> {
  if (!fileHash) return null;
  const key = keyFor(fileHash);
  try {
    // head() confirms existence + gives us the URL without downloading the body.
    // On a miss it THROWS (Blob has no "maybe" API), so the catch is the miss path.
    const meta = await head(key);
    if (!meta?.url) return null;

    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;

    const env = (await res.json()) as CacheEnvelope;
    if (!env?.extracted) return null;

    // Expire stale entries lazily on read (mirrors reports.ts).
    const age = Date.now() - new Date(env.cachedAt).getTime();
    if (Number.isFinite(age) && age > MAX_AGE_MS) {
      // Fire-and-forget delete; don't block the caller on cleanup.
      del(meta.url).catch(() => {});
      return null;
    }

    return env.extracted;
  } catch {
    // Miss, network blip, or malformed entry — all mean "extract fresh".
    return null;
  }
}

/**
 * Store a FINISHED extraction (post-backfill) under its content hash.
 * Overwrites any existing entry for the same hash+version (idempotent).
 * Never throws — a write failure just means the next run re-extracts.
 */
export async function putCachedExtraction(
  fileHash: string,
  extracted: ExtractedFDD,
): Promise<void> {
  if (!fileHash || !extracted) return;
  const key = keyFor(fileHash);
  const env: CacheEnvelope = {
    fileHash,
    cachedAt: new Date().toISOString(),
    version: CACHE_VERSION,
    extracted,
  };
  try {
    await put(key, JSON.stringify(env), {
      access: "public",
      addRandomSuffix: false, // stable, content-addressed path (last write wins)
      allowOverwrite: true,
      contentType: "application/json",
    });
  } catch (e) {
    // Non-fatal: log and move on. The result is already being served to the user.
    console.warn(
      "[extractionCache] write failed (non-fatal):",
      e instanceof Error ? e.message : e,
    );
  }
}
