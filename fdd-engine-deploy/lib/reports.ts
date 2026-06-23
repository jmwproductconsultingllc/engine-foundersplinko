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
}

function keyFor(reportId: string): string {
  return `${PREFIX}${reportId}.json`;
}

/**
 * Persist a freshly-computed report. Returns the unguessable reportId, which is
 * the access token for the /report/[reportId] URL.
 */
export async function saveReport(
  result: DiligenceResult,
  fileHash: string,
): Promise<string> {
  const reportId = randomUUID();
  const now = Date.now();
  const record: StoredReport = {
    result,
    paid: false,
    fileHash,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
  await put(keyFor(reportId), JSON.stringify(record), {
    access: "public",
    addRandomSuffix: false, // deterministic pathname so we can find it by reportId
    contentType: "application/json",
  });
  // NOTE (#6): flipping paid=true re-puts at this same key, which will need
  // allowOverwrite: true, and a CDN-cache-busting read (overwrites take ~1 min
  // to clear). Not needed yet — paid is always false at creation.
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
