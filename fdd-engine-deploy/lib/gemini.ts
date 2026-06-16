/**
 * gemini.ts
 * Handles ONLY extraction: upload the FDD via the Gemini Files API
 * (NOT inline base64 — that truncates on 300-page FDDs), then ask the
 * current Gemini model to return strict JSON matching our schema.
 *
 * The model is explicitly told NOT to score risk or editorialize.
 * Scoring/underwriting happen downstream in scoring.ts + underwriting.ts.
 *
 * Includes retry-with-backoff for transient Gemini errors (503 "model
 * overloaded / high demand", 429 rate limit) — these are server-side blips
 * on Google's end, NOT a wrong model, and usually clear on a quick retry.
 *
 * NOTE: verify the model string + SDK surface against current docs:
 *   https://ai.google.dev/gemini-api/docs/models
 *   https://ai.google.dev/gemini-api/docs/files
 */

import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "@google/genai";
import { ExtractedFDD, fddResponseSchema } from "./schema";

// gemini-3.5-flash: GA, 1M context, native PDF understanding up to ~1000 pages,
// and FAST — which matters for staying under the function timeout. Only move to
// gemini-3.5-pro for genuinely gnarly docs; it's slower and more timeout-prone.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

const EXTRACTION_PROMPT = `
You are an expert franchise economics analyst extracting structured data from a
Franchise Disclosure Document (FDD). Return ONLY JSON matching the provided schema.

RULES:
- Extract FACTS ONLY. Do NOT assign a risk score, rating, or recommendation —
  that is computed downstream. Do not editorialize.
- For EVERY figure you extract, fill the matching "source" / "sourcePage" field
  with the Item number and page (e.g. "Item 19, p.37"). If you cannot locate the
  page, say so in that field. Never invent a citation.
- Use raw numbers only: 250000, not "$250,000". Use null for anything you
  genuinely cannot find. NEVER guess a number.
- documentCheck: set appearsComplete=false and add a clear warning if core
  disclosures (Items 1, 7, 17, 19) are missing or the file looks truncated.
  Set appearsScanned=true if the document appears to be scanned images with no
  reliable extractable text. List every concern in documentCheck.warnings.
- Item 17 lineItems: mark recurring=false for one-time build-out costs and
  recurring=true for ongoing costs. Actively hunt for ancillary / hidden costs
  mentioned outside Item 17 (e.g. mandatory third-party software/maintenance
  fees, technology fees, step-in or ACH provisions) and put them in hiddenCosts.
- item19.cohorts: capture each performance tier disclosed (e.g. top/middle/bottom
  percentiles or quartiles) with its average MONTHLY revenue. If figures are
  annual, convert to monthly and note that in basis.
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry a Gemini call on transient errors (503 UNAVAILABLE / "high demand",
 * 429 rate limit). Non-transient errors throw immediately.
 * Backoff: 1s, 2s, 4s. Keep `attempts` modest so the total stays under your
 * function's maxDuration.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const e = err as { status?: number; code?: number; message?: string };
      const status = e?.status ?? e?.code;
      const transient =
        status === 503 ||
        status === 429 ||
        /UNAVAILABLE|high demand|overloaded|try again/i.test(String(e?.message ?? ""));
      if (!transient || i === attempts - 1) throw err;
      const wait = 1000 * Math.pow(2, i); // 1s, 2s, 4s
      console.warn(`[${label}] transient ${status} — retrying in ${wait}ms (attempt ${i + 1}/${attempts})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/**
 * Upload an FDD to the Gemini Files API and extract structured data.
 * @param fileBytes the raw PDF bytes
 * @param mimeType  usually "application/pdf"
 */
export async function extractFddFromFile(
  fileBytes: ArrayBuffer,
  mimeType: string,
): Promise<ExtractedFDD> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // 1) Upload via Files API (the right path for large PDFs). Retry transient blips.
  const blob = new Blob([fileBytes], { type: mimeType });
  const uploaded = await withRetry(
    () => ai.files.upload({ file: blob, config: { mimeType, displayName: "fdd-upload.pdf" } }),
    "upload",
  );

  // 2) Wait for the file to finish processing (tight poll: 1.5s x up to 20 = ~30s budget).
  let fileInfo = await ai.files.get({ name: uploaded.name as string });
  let tries = 0;
  while (fileInfo.state === "PROCESSING" && tries < 20) {
    await sleep(1500);
    fileInfo = await ai.files.get({ name: uploaded.name as string });
    tries++;
  }
  if (fileInfo.state === "FAILED") {
    throw new Error("Gemini could not process the uploaded PDF.");
  }

  // 3) Extract -> strict JSON, retrying transient 503/429 overloads.
  let extracted: ExtractedFDD;
  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: MODEL,
          contents: createUserContent([
            createPartFromUri(fileInfo.uri as string, fileInfo.mimeType as string),
            EXTRACTION_PROMPT,
          ]),
          config: {
            responseMimeType: "application/json",
            responseSchema: fddResponseSchema,
            temperature: 0.1, // low = more deterministic extraction
          },
        }),
      "extract",
    );

    const text = response.text;
    if (!text) throw new Error("Empty extraction response from Gemini.");
    extracted = JSON.parse(text) as ExtractedFDD;
  } finally {
    // 4) Clean up the uploaded file (don't leave PII/docs lying around).
    try {
      await ai.files.delete({ name: uploaded.name as string });
    } catch {
      /* non-fatal */
    }
  }

  return extracted;
}
