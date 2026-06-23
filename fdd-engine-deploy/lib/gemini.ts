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
  ThinkingLevel,
} from "@google/genai";
import { PDFDocument } from "pdf-lib";
import { ExtractedFDD, fddResponseSchema } from "./schema";
import { FINANCIAL_CONDITION_EXTRACTION_PROMPT } from "./financialCondition";

// gemini-3.5-flash: GA, 1M context, native PDF understanding up to ~1000 pages,
// and FAST — which matters for staying under the function timeout. Only move to
// gemini-3.5-pro for genuinely gnarly docs; it's slower and more timeout-prone.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

// Gemini's input context is ~1M tokens. A normal FDD (≤300pp) fits easily, but
// the largest filings (e.g. Dunkin's ~675pp) blow past it — and ~80% of those
// pages are exhibits (the franchise agreement, 50-state addenda, audited
// financials, the franchisee roster) that carry NONE of the diligence signal,
// which lives entirely in Items 1-23. We cap the pages sent so the model only
// ever sees the disclosure items. No real FDD's Items 1-23 run past ~200pp, so
// this is quality-neutral; it also makes every large extraction faster/cheaper.
// Tunable — raise only if you find a legitimately enormous Items section.
const MAX_FDD_PAGES = Number(process.env.MAX_FDD_PAGES) || 300;

// Extraction is mechanical (locate figures, fill the schema, cite pages), not
// reasoning — so we constrain Gemini's thinking, the single biggest latency
// lever. The model's DEFAULT is dynamic/HIGH thinking, which is what pushed
// every extraction (even small FDDs) toward the 300s function timeout. "low"
// keeps a little reasoning for Item 19 cohort pairing while cutting most of the
// latency. Override via env GEMINI_THINKING_LEVEL = low | medium | high.
// (Flash also supports a lower "minimal" floor; wire that enum member in if
// "low" still isn't fast enough on the largest filings.)
const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
const THINKING_LEVEL: ThinkingLevel =
  THINKING_LEVELS[(process.env.GEMINI_THINKING_LEVEL || "low").toLowerCase()] ??
  ThinkingLevel.LOW;

const EXTRACTION_PROMPT = `
You are an expert franchise economics analyst extracting structured data from a
Franchise Disclosure Document (FDD). Return ONLY JSON matching the provided schema.

RULES:
- Extract FACTS ONLY. Do NOT assign a risk score, rating, or recommendation —
  that is computed downstream. Do not editorialize.
- LANGUAGE — ENGLISH ONLY. Write EVERY prose, descriptive, or narrative field in
  English, no matter what language the source FDD (or any text quoted inside it)
  is written in. This covers all leadership.background and whyItMatters,
  brandBackground, every fee and hiddenCost description, every operationalRisk
  description, every Item 19 cohort description and notes, conceptRationale,
  staffingRationale, and any other rationale/summary field. If source text is in
  another language, translate the relevant facts into English — never copy or
  generate prose in another language. Proper nouns (company, person, and place
  names) stay exactly as written.
- OUTPUT BUDGET — BE CONCISE. Keep EVERY prose field (background, whyItMatters,
  brandBackground, fee and hiddenCost descriptions, operationalRisk descriptions,
  cohort descriptions/notes, rationales) to ONE short sentence or phrase. These
  are labels, not narrative — never write multi-sentence histories or restate a
  fact several ways. The structured numbers and the Item 19 / Item 7 / fees /
  financialCondition data are what matter; verbose prose wastes a hard output
  budget and can truncate the document mid-extraction. If the FDD is very rich,
  protect the COMPLETENESS of those structured sections over prose length
  everywhere else.
- leadership: extract only the 6 MOST SENIOR people (CEO/President plus the key
  finance, legal, operations, and development heads). One short sentence of
  background each, one short clause for whyItMatters — no multi-job chronologies.
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
- Fees are FACTS, not math. Record every fee EXACTLY as the FDD states it and do NO
  arithmetic on it. If a fee is stated PER UNIT (per bay, per simulator, per seat, per
  location, per terminal, per employee), put the disclosed PER-UNIT amount in
  estimatedAnnualAmount and name the unit in BOTH name and description — e.g.
  "approximately $2,000 per golf simulator bay per year" becomes amount 2000, name
  "Trackman License Fee (per simulator bay)". NEVER multiply a per-unit fee by an
  assumed number of units (bays/seats/locations) to produce a per-center total: you do
  not know the count, and the per-unit rate is the correct figure to report. Likewise
  never convert monthly↔annual or sum fees together — report each fee as written and
  leave all math to downstream code.
- Item 17 itself covers renewal, termination, transfer, and dispute resolution — pull
  those risks into operationalRisks, never into the investment table.
- item19.cohorts: capture EVERY table the franchisor discloses in Item 19. Each
  table is its own cohort, and Item 19 is routinely UNDER-captured because it
  contains several tables. CRITICAL: a franchisor very often discloses a separate
  PROFITABILITY table — EBITDA, adjusted EBITDA, net income, or operating income —
  IN ADDITION to a gross-sales table for the same group of outlets. You MUST
  capture BOTH. The profitability figure is the single most important number in
  the FDD: the true owner-margin downstream is computed by pairing a group's gross
  sales with its EBITDA, so NEVER skip, summarize away, or merge a profit table.
  Worked example — a brand disclosing "Company Centers Average Gross Sales",
  "Franchised Centers Average Gross Sales", "Company Centers Average EBITDA", and
  "Select Company Centers Average EBITDA" is FOUR separate cohorts: two
  gross_sales and two net_or_ebitda. Returning only the gross-sales tables is WRONG.
  For each cohort:
    * ownership (CRITICAL): "franchised", "company" (franchisor-owned),
      "affiliate" (affiliate-owned), or "mixed". Many FDDs lead with COMPANY- or
      AFFILIATE-owned results that run far higher than franchised ones — never
      blur the two. "Company Centers" and "Franchised Centers" are two cohorts.
    * revenueType (CRITICAL): "gross_sales" for a top-line sales/revenue figure;
      "net_or_ebitda" for ANY profit figure (EBITDA, adjusted EBITDA, net income,
      operating income); "pre_sale_only" for pre-opening/pre-sale membership
      revenue (NOT ongoing operations); else "other". Classify every cohort.
    * label: name a profit cohort in PARALLEL with its gross-sales cohort so the
      two can be matched downstream — e.g. gross "Company Centers" pairs with
      EBITDA "Company Centers EBITDA" (same group name, differing only by the
      EBITDA/sales word).
    * sampleSize: how many outlets back the figure (e.g. 2). Small = unreliable.
    * If a figure is disclosed MONTHLY (a Jan-Dec breakdown), list every monthly
      value in monthlyValues — we average it in code. If disclosed ANNUALLY (e.g.
      an average yearly gross sales of $3,000,000), put it in annualRevenue and
      leave avgMonthlyRevenue null — code divides by 12. Set avgMonthlyRevenue
      directly only when a true monthly average is the disclosed figure. Never
      pick a single month; never pre-convert yourself. These same rules apply to
      EBITDA/profit figures.
  SELF-CHECK before finishing Item 19: re-scan the section and confirm that every
  EBITDA / net-income / operating-income table you saw is present as a
  net_or_ebitda cohort. A missing profitability table is the most common and most
  costly extraction error — do not make it.
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
- conceptType: classify the franchise into ONE industry/concept so the report can
  apply the right operating benchmarks. Choose exactly one of:
  food_beverage_full_service, food_beverage_qsr, experiential_entertainment,
  experiential_with_fb (an experiential/entertainment venue with a meaningful
  bar/restaurant attach — e.g. an indoor-golf or simulator concept with a full bar
  and kitchen), fitness_studio, health_wellness (med-spa, IV, longevity, recovery),
  retail_product, home_trade_services, beauty_personal_care, education_childcare,
  or other. Put a one-line reason in conceptRationale. CLASSIFY ONLY — do NOT
  estimate any costs, margins, or ratios; downstream code supplies those.
- staffingModel: classify how the business is run, from the FDD's own description.
  Use "automated" for an unattended / self-service / keyless / 24-hour concept that
  operates with little or no on-site staff; "lightly_staffed" for a small-crew or
  semi-absentee model; "staffed" for a conventionally staffed venue. Read the concept
  description (Item 1), the owner's on-site obligation (Item 15), and staffing cues in
  Item 11. If unclear, default to "staffed". Put a one-line reason in staffingRationale.
  CLASSIFY ONLY — do not estimate labor cost.
`;

// Appended ONLY on a retry, after the full extraction hits the 65,536-token
// output ceiling (gemini-3.5-flash's hard max — it cannot be raised). It forces
// a numbers-only extraction: identical schema, every prose field emptied, so the
// JSON fits the budget while all figures and citations survive.
const MINIMAL_MODE_SUFFIX = `
MINIMAL OUTPUT MODE (retry — the full extraction exceeded the output limit):
This FDD is exceptionally data-dense, so you MUST cut output size hard. Return the
SAME JSON schema, but:
- Set EVERY prose / descriptive / narrative field to an empty string "": all
  leadership.background and leadership.whyItMatters, brandBackground, every fee and
  hiddenCost description, every operationalRisk description, every Item 19 cohort
  description and notes, conceptRationale, staffingRationale, and any other
  rationale / explanation / summary text field.
- Keep ALL numbers, ranges, labels, ownership and revenueType tags, sampleSize,
  monthly and annual figures, every fee name and amount, all source / sourcePage
  citations, the documentCheck flags, and the FULL financialCondition structure
  COMPLETE and accurate. Do not drop a single line item, fee, cohort, or financial
  figure. Still cap leadership at the 6 most senior people.
The goal: identical structured data, zero prose, so the JSON fits the output budget.
`;

// True when Gemini stopped because it hit the output-token ceiling (truncated JSON).
function hitOutputCap(r: {
  candidates?: ReadonlyArray<{ finishReason?: unknown }> | null;
}): boolean {
  return String(r?.candidates?.[0]?.finishReason ?? "") === "MAX_TOKENS";
}

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

  // 0) Trim oversized FDDs to the disclosure items so we never exceed Gemini's
  //    input window. Only kicks in for filings past MAX_FDD_PAGES; normal docs
  //    pass through byte-for-byte untouched (no regression for the FDDs that
  //    already work). ignoreEncryption lets us read permission-flagged PDFs.
  //    If the trim fails for any reason, fall back to the original bytes.
  let uploadBytes: ArrayBuffer = fileBytes;
  try {
    const src = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();
    if (pageCount > MAX_FDD_PAGES) {
      const trimmed = await PDFDocument.create();
      const indices = Array.from({ length: MAX_FDD_PAGES }, (_, i) => i);
      const copied = await trimmed.copyPages(src, indices);
      copied.forEach((p) => trimmed.addPage(p));
      // save() yields a Uint8Array; copy it into a standalone ArrayBuffer so the
      // Blob constructor's BlobPart type is satisfied (TS 5.7 made typed arrays
      // generic over their backing buffer, so Uint8Array no longer assigns to it).
      const saved = await trimmed.save();
      const ab = new ArrayBuffer(saved.byteLength);
      new Uint8Array(ab).set(saved);
      uploadBytes = ab;
      console.warn(
        `[extract] large FDD: trimmed ${pageCount} -> ${MAX_FDD_PAGES} pages ` +
          `(exhibits dropped) to fit the model input window.`,
      );
    }
  } catch (e) {
    console.warn("[extract] PDF page-trim skipped (load failed); sending original.", e);
  }

  // 1) Upload via Files API (the right path for large PDFs). Retry transient blips.
  const blob = new Blob([uploadBytes], { type: mimeType });
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
    // One extraction call. `minimal` appends the strip-prose suffix used on the
    // retry path below; same schema + output cap either way.
    const callExtraction = (minimal: boolean) =>
      withRetry(
        () =>
          ai.models.generateContent({
            model: MODEL,
            contents: createUserContent([
              createPartFromUri(fileInfo.uri as string, fileInfo.mimeType as string),
              EXTRACTION_PROMPT +
                "\n\n" +
                FINANCIAL_CONDITION_EXTRACTION_PROMPT +
                (minimal ? "\n\n" + MINIMAL_MODE_SUFFIX : ""),
            ]),
            config: {
              responseMimeType: "application/json",
              responseSchema: fddResponseSchema,
              temperature: 0.1, // low = more deterministic extraction
              // Constrain thinking — the dominant latency lever. The default is
              // dynamic/HIGH; "low" (or "minimal" on Flash) keeps each extraction
              // fast enough to stay under the 300s function ceiling, including
              // the double-pass that fires on rich docs.
              thinkingConfig: { thinkingLevel: THINKING_LEVEL },
              // 65,536 is gemini-3.5-flash's HARD max output — there is no higher
              // number. A rich FDD that exceeds it truncates the JSON; the fix is
              // less output (the minimal-mode retry below), not a bigger cap.
              maxOutputTokens: 65536,
            },
          }),
        minimal ? "extract-minimal" : "extract",
      );

    // Full extraction first (best quality). If it blows the output ceiling the
    // JSON is truncated, so retry ONCE in minimal mode: identical structured
    // schema with all prose stripped, so the numbers (Item 7 / 19 / fees /
    // financials) survive and only the narrative goes light. Only a genuinely
    // enormous filing fails after that.
    let response = await callExtraction(false);
    if (hitOutputCap(response)) {
      console.warn("[extract] output cap hit — retrying in minimal (numbers-only) mode.");
      response = await callExtraction(true);
      if (hitOutputCap(response)) {
        throw new Error(
          "This FDD is too data-dense to extract in full, even after compacting — its Item 19 or fee tables are exceptionally large. Try a text-based copy of the document.",
        );
      }
    }

    const text = response.text;
    if (!text) throw new Error("Empty extraction response from Gemini.");
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
