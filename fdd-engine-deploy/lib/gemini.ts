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
  disclosures (Items 1, 6, 7, 19, 20) are missing or the file looks truncated.
  Set appearsScanned=true if the document appears to be scanned images with no
  reliable extractable text. List every concern in documentCheck.warnings.
- The lineItems array holds the ESTIMATED INITIAL INVESTMENT table. In an FDD this
  table is **Item 7** (NOT Item 17) — cite it as "Item 7, p.X". Mark recurring=false
  for one-time build-out costs and recurring=true for ongoing costs. Actively hunt
  for ancillary / hidden costs mentioned outside the investment table (e.g. mandatory
  third-party software/maintenance fees, technology fees, step-in or ACH provisions)
  and put them in hiddenCosts.
- Item 17 itself covers renewal, termination, transfer, and dispute resolution — pull
  those risks into operationalRisks, never into the investment table.
- item19.cohorts: capture every performance grouping disclosed. These come in
  very different shapes across FDDs, so capture what is actually there:
    * ownership (CRITICAL): tag each grouping as "franchised", "company"
      (franchisor-owned), "affiliate" (affiliate-owned), or "mixed". Many FDDs
      lead with COMPANY- or AFFILIATE-owned results that run far higher than
      franchised ones — never blur the two. If a brand reports "Company Centers"
      and "Franchised Centers" separately, that is two cohorts with different
      ownership.
    * sampleSize: how many outlets back the figure (e.g. 2). Small = unreliable.
    * revenueType: "gross_sales" for top-line sales, "net_or_ebitda" for a
      profit/EBITDA figure, "pre_sale_only" if the number is pre-opening
      membership/pre-sale revenue (NOT ongoing operations), else "other".
    * If the figure is disclosed MONTHLY (a Jan-Dec breakdown), list every monthly
      value in monthlyValues — we average it in code. If it is disclosed ANNUALLY
      (e.g. an average yearly gross sales of $3,000,000), put that in annualRevenue
      and leave avgMonthlyRevenue null — code divides by 12. Only set
      avgMonthlyRevenue directly when a true monthly average is the disclosed figure.
      Never pick a single month, and never pre-convert annual to monthly yourself.
  If the franchisor makes NO financial performance representation (the Item 19 says
  it does not provide one), set hasItem19=false, cohorts=[], and say so in notes —
  do not fabricate or infer any revenue. That absence is a finding, not a gap.
- rentDetail: capture rent exactly as disclosed — rawValue, its unit
  (per_sqft_per_year is common; also per_sqft_per_month, per_month, per_year), and
  squareFootage if a unit size is given (needed to convert per-sqft figures). Cite
  the source. CRITICAL: an Item 7 line such as "Lease Deposit and Rent - 3 Months"
  is a deposit-plus-a-few-months cash outlay, NOT monthly rent — do not put that in
  rawValue as if it were a monthly figure; prefer a stated $/sqft or monthly rent.
  Leave averageRentMonthly null; code computes it from rentDetail.
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
            // Rich FDDs (e.g. Five Iron's 6 Item 19 cohorts + full tables) blow
            // past the default output ceiling, which truncates the JSON and
            // breaks parsing. Give generous headroom.
            maxOutputTokens: 32768,
          },
        }),
      "extract",
    );

    const text = response.text;
    if (!text) throw new Error("Empty extraction response from Gemini.");

    // If the model hit the output-token ceiling, the JSON is truncated and will
    // not parse — surface that precisely instead of a cryptic "Expected ',' or '}'".
    const finish = String(response.candidates?.[0]?.finishReason ?? "");
    if (finish === "MAX_TOKENS") {
      throw new Error(
        "Extraction exceeded the model's output limit — this FDD is unusually rich. Try again; if it persists, the output cap (maxOutputTokens) needs raising.",
      );
    }
    try {
      extracted = JSON.parse(text) as ExtractedFDD;
    } catch {
      throw new Error(
        "The model returned malformed or truncated JSON for this FDD. Please try again; if it persists, the document is unusually large.",
      );
    }

    // Normalize Item 19 cohorts IN CODE so the model never has to do arithmetic.
    // Priority: (1) mean of monthly values if a Jan-Dec breakdown exists — this
    // also defeats the "grabbed a single month" misread; (2) annual figure / 12.
    for (const c of extracted.item19?.cohorts ?? []) {
      if (c.monthlyValues && c.monthlyValues.length >= 6) {
        const mean =
          c.monthlyValues.reduce((a, b) => a + b, 0) / c.monthlyValues.length;
        c.avgMonthlyRevenue = Math.round(mean);
      } else if (
        (c.avgMonthlyRevenue === null || c.avgMonthlyRevenue === undefined) &&
        typeof c.annualRevenue === "number"
      ) {
        c.avgMonthlyRevenue = Math.round(c.annualRevenue / 12);
      }
    }

    // Normalize rent to a monthly dollar figure IN CODE from the raw disclosure,
    // so $/sqft/yr, $/sqft/mo, $/yr and $/mo all collapse to one comparable number
    // and a per-sqft figure is never mistaken for a monthly one.
    const rd = extracted.rentDetail;
    if (rd && typeof rd.rawValue === "number") {
      const sqft = typeof rd.squareFootage === "number" ? rd.squareFootage : null;
      let monthly: number | null = null;
      switch (rd.unit) {
        case "per_sqft_per_year":
          monthly = sqft !== null ? (rd.rawValue * sqft) / 12 : null;
          break;
        case "per_sqft_per_month":
          monthly = sqft !== null ? rd.rawValue * sqft : null;
          break;
        case "per_year":
          monthly = rd.rawValue / 12;
          break;
        case "per_month":
          monthly = rd.rawValue;
          break;
        default:
          monthly = null; // unknown unit — leave null rather than guess
      }
      if (monthly !== null) extracted.averageRentMonthly = Math.round(monthly);
    }
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
