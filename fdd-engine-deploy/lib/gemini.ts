/**
 * lib/gemini.ts
 * Handles ONLY extraction: upload the FDD via the Gemini Files API, 
 * then ask the current Gemini model to return strict JSON matching our schema.
 * * UPDATED: Hardened retry logic for network drops and explicit prompt 
 * constraint to prevent token overflow on dense tables.
 * * FIXED: Wrapped fileBytes in Blob to satisfy SDK type requirements.
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

// gemini-3.5-flash: 1M context, native PDF understanding, fast.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export const EXTRACTION_PROMPT = `
Extract the franchise disclosure document (FDD) into the requested JSON schema.
Only extract facts present in the document. Do not editorialize or score.
Cite every number and fact to its Item number and page (e.g., "Item 19, p.42").

SELF-CHECK before finishing Item 19: re-scan the section and confirm that every
EBITDA / net-income / operating-income table you saw is present as a
net_or_ebitda cohort. A missing profitability table is the most common and most
costly extraction error — do not make it.

CRITICAL ITEM 19 RULE: Do NOT extract location-by-location or outlet-by-outlet
line-item lists. If an Item 19 table lists the performance of individual units
row by row, IGNORE the individual unit rows and extract ONLY the summary,
average, median, or quartile rows at the bottom of the table.
`.trim();

/** Hardened retry logic that catches network drops (fetch failed) and timeouts. */
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.status;
      const msg = String(e?.message ?? "");
      
      // Catches HTTP errors AND native network/fetch failures
      const transient =
        status === 503 ||
        status === 429 ||
        status === 502 ||
        status === 504 ||
        /UNAVAILABLE|high demand|overloaded|try again|fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|network/i.test(msg);

      if (transient && i < retries - 1) {
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`[gemini] retry ${i + 1}/${retries} after error: ${msg}`);
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }
      throw e;
    }
  }
  return await fn();
}

export async function extractFddFromFile(
  fileBytes: ArrayBuffer,
  mimeType: string,
): Promise<ExtractedFDD> {
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  // FIX: Wrap the ArrayBuffer in a Blob instead of Uint8Array to satisfy the SDK type
  const uploadResult = await genAI.files.upload({
    file: new Blob([fileBytes], { type: mimeType }),
    mimeType,
  });

  try {
    return await withRetry(async () => {
      const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: fddResponseSchema,
        },
      });

      const result = await model.generateContent([
        {
          fileData: {
            fileUri: uploadResult.uri,
            mimeType,
          },
        },
        { text: EXTRACTION_PROMPT + FINANCIAL_CONDITION_EXTRACTION_PROMPT },
      ]);

      const text = result.response.text();
      return JSON.parse(text) as ExtractedFDD;
    });
  } finally {
    // Clean up file from Gemini API
    await genAI.files.delete(uploadResult.name).catch(() => {});
  }
}