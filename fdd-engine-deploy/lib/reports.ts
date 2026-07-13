// fdd-engine-deploy/lib/reports.ts
//
// Report persistence over Vercel Blob. A computed DiligenceResult is stored as
// JSON under reports/{reportId}.json so it has a permanent URL the buyer can
// return to. reportId is a random UUID — NOT the file hash — because payment is
// per-buyer: a hash-keyed record would let a second buyer of the same FDD
// inherit the first's paid status. The hash is stored on the record for
// dedup/analytics, never used as the key.
//
// Vercel Blob has no native TTL, so the 18-month retention is enforced on read
// (createdAt/expiresAt). A cron can hard-delete expired blobs later to reclaim
// storage; until then this just treats anything past expiry as gone.

import { put, list, del } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import type { DiligenceResult } from "./types";

const PREFIX = "reports/";
const TTL_MS = 540 * 24 * 60 * 60 * 1000; // ~18 months

export interface StoredReport {
  result: DiligenceResult;
  paid: boolean;
  fileHash: string;
  createdAt: string; // ISO
  expiresAt: string; // ISO
  /** buyer email when captured pre-checkout (Brief A2 persists + sends against this) */
  email?: string | null;
  /** acquisition ref (?ref=… or campaign route). THE cold/warm revenue tag:
   *  ref="mallory" → Related-Party (warm, disclosed separately for XPRIZE);
   *  ref ∈ {seo, reddit, broker, paid, …} or absent → cold arms-length.
   *  Written at mint/save time so the Stripe webhook attributes off the record,
   *  not off session inference. */
  ref?: string | null;
  /** first-touch utm_* params captured by middleware at landing */
  utm?: Record<string, string> | null;
  /** set when this record was minted from a canonical brand template
   *  (app/api/mint-brand-report) rather than a user upload */
  brandSlug?: string | null;
}

export interface SaveReportOptions {
  email?: string | null;
  ref?: string | null;
  brandSlug?: string | null;
  /** first-touch acquisition params (P0 conversion sprint) */
  utm?: Record<string, string> | null;
}

function keyFor(reportId: string): string {
  return `${PREFIX}${reportId}.json`;
}

/**
 * Persist a freshly-computed report. Returns the unguessable reportId, which is
 * the access token for the /report/[reportId] URL.
 *
 * `result` may come from the live pipeline OR be a pre-computed copy of a
 * canonical brand template (the brand-page mint flow) — payment stays per-buyer
 * either way because every call creates a fresh UUID record.
 */
export async function saveReport(
  result: DiligenceResult,
  fileHash: string,
  options: SaveReportOptions = {},
): Promise<string> {
  const reportId = randomUUID();
  const now = Date.now();
  const record: StoredReport = {
    result,
    paid: false,
    fileHash,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    email: options.email ?? null,
    ref: options.ref ?? null,
    brandSlug: options.brandSlug ?? null,
    utm: options.utm ?? null,
  };
  await put(keyFor(reportId), JSON.stringify(record), {
    access: "public",
    addRandomSuffix: false, // deterministic pathname so we can find it by reportId
    contentType: "application/json",
  });
  return reportId;
}

/**
 * Load a report by id. Returns null if missing or past its 18-month TTL.
 */
export async function loadReport(reportId: string): Promise<StoredReport | null> {
  // Cheap guard: must look like a UUID. The real protection is unguessability.
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return null;

  const { blobs } = await list({ prefix: keyFor(reportId), limit: 1 });
  if (blobs.length === 0) return null;

  let record: StoredReport;
  try {
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    if (!res.ok) return null;
    record = (await res.json()) as StoredReport;
  } catch {
    return null;
  }

  if (Date.now() > Date.parse(record.expiresAt)) {
    // Past retention — treat as gone and reclaim the storage.
    await del(blobs[0].url).catch(() => {});
    return null;
  }
  return record;
}

/**
 * Flip a report to paid. Called by the Stripe webhook after checkout completes.
 * Idempotent — Stripe can deliver the same event more than once, so setting
 * paid on an already-paid record is a no-op success.
 *
 * Note: overwriting a public blob takes up to ~1 min to clear the CDN cache, so
 * the /report page won't necessarily reflect this instantly. The buyer-facing
 * flow (part B) verifies the Stripe session on return for immediate unlock; this
 * write is the durable source of truth for later visits.
 */
export async function markPaid(reportId: string): Promise<boolean> {
  const record = await loadReport(reportId);
  if (!record) return false;
  if (record.paid) return true;

  const updated: StoredReport = { ...record, paid: true };
  await put(keyFor(reportId), JSON.stringify(updated), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    allowOverwrite: true, // overwriting the existing report record
  });
  return true;
}
