// fdd-engine-deploy/lib/financialsPass.ts
//
// Targeted financials recovery — a transparency fix.
//
// The main extraction reads only the trimmed (leading-150-page) PDF. When a
// franchisor's audited financial statements sit as a LATE exhibit (e.g. UPS
// Store, ~600pp), they fall outside that window: financialCondition comes back
// empty AND the report warns the statements are "not in the provided pages."
// To a buyer who uploaded the COMPLETE FDD, that reads like the engine quietly
// altered their document — the exact opposite of what this product stands for.
//
// So rather than trim the financials away and narrate their absence, we FIND
// them in the full document (text-layer search for the financial-statements
// block), extract ONLY those pages in a focused second pass, and hand the result
// back to the orchestrator to backfill. Closes a real data gap and lets the
// orchestrator drop the now-false warning.
//
// Best-effort and self-contained: any failure (no text layer, no statements
// block located, model error) returns null and the caller proceeds unchanged —
// never worse than today. `unpdf` is imported dynamically so a bundling issue
// can never break the main extraction path.

import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { fddResponseSchema } from "./schema";
import type { FinancialConditionExtraction } from "./financialCondition";
import { FINANCIAL_CONDITION_EXTRACTION_PROMPT } from "./financialCondition";
import { geminiSchemaToJsonSchema } from "./schemaToJsonSchema";

const CLAUDE_MODEL = process.env.CLAUDE_EXTRACTION_MODEL || "claude-sonnet-4-6";
const TOOL_NAME = "emit_financial_condition";

// Pages to scan/carve as the statements block. Audited statements are a
// contiguous section, rarely more than ~30 pages.
const FIN_WINDOW = 30;

// Page-level signal that we're inside the audited financial statements. Each
// pattern that matches on a page adds 1 to that page's score.
const FIN_PATTERNS: RegExp[] = [
  /balance sheets?/i,
  /statements? of operations/i,
  /statements? of cash flows?/i,
  /income statements?/i,
  /statements? of (members|stockholders|shareholders).{0,4}(equity|deficit)/i,
  /independent registered public accounting/i,
  /report of independent/i,
  /total stockholders.{0,4}equity/i,
  /total assets/i,
  /total liabilities/i,
  /notes to (the )?(consolidated )?financial statements/i,
];

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  _client = new Anthropic({ apiKey: key, timeout: 780_000 });
  return _client;
}

/** Per-page financial-signal score for the whole document. */
async function scorePages(bytes: ArrayBuffer): Promise<number[]> {
  // Dynamic import keeps unpdf (and its bundled pdfjs) out of the main bundle
  // and off the build's critical path — if it ever fails, only this pass does.
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages: string[] = Array.isArray(text) ? text : [String(text)];
  return pages.map((t) => {
    const s = typeof t === "string" ? t : "";
    return FIN_PATTERNS.reduce((acc, re) => acc + (re.test(s) ? 1 : 0), 0);
  });
}

/**
 * Locate the densest contiguous block of financial-statement signal. Returns a
 * page range, or null if there isn't enough signal to be confident — so we never
 * carve out a random block and risk hallucinating financials.
 */
function densestRange(scores: number[]): { start: number; end: number } | null {
  if (!scores.length) return null;
  let bestStart = -1;
  let bestScore = 0;
  for (let i = 0; i < scores.length; i++) {
    let windowScore = 0;
    for (let j = i; j < Math.min(scores.length, i + FIN_WINDOW); j++) {
      windowScore += scores[j];
    }
    if (windowScore > bestScore) {
      bestScore = windowScore;
      bestStart = i;
    }
  }
  // A true statements section lights up several patterns across multiple pages.
  // A lone "total assets" in a fee table won't clear this bar.
  if (bestStart < 0 || bestScore < 5) return null;
  return { start: bestStart, end: Math.min(scores.length - 1, bestStart + FIN_WINDOW - 1) };
}

/** Carve the given page range into a standalone PDF. */
async function carvePages(bytes: ArrayBuffer, start: number, end: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indices: number[] = [];
  for (let i = start; i <= end && i < src.getPageCount(); i++) indices.push(i);
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

/** The financialCondition sub-schema of fddResponseSchema, as a Claude tool input_schema. */
function financialConditionSchema(): Anthropic.Tool.InputSchema {
  const root = fddResponseSchema as unknown as { properties?: Record<string, unknown> };
  const node = root.properties?.financialCondition;
  if (!node) throw new Error("financialCondition schema node not found in fddResponseSchema.");
  return geminiSchemaToJsonSchema(node) as Anthropic.Tool.InputSchema;
}

/**
 * Recover the franchisor's financial condition from the FULL document when the
 * main (trimmed) extraction missed it. Returns the extracted object, or null if
 * no statements block is found or anything fails.
 */
export async function recoverFinancials(
  fileBytes: ArrayBuffer,
): Promise<FinancialConditionExtraction | null> {
  let scores: number[];
  try {
    scores = await scorePages(fileBytes);
  } catch (e) {
    console.warn("[financials] text scan failed; skipping recovery:", e instanceof Error ? e.message : e);
    return null;
  }

  const range = densestRange(scores);
  if (!range) {
    console.log("[financials] no statements block located in full doc — nothing to recover.");
    return null;
  }
  console.log(`[financials] statements block at pages ${range.start + 1}-${range.end + 1}; extracting.`);

  let subPdf: Uint8Array;
  try {
    subPdf = await carvePages(fileBytes, range.start, range.end);
  } catch (e) {
    console.warn("[financials] sub-PDF carve failed:", e instanceof Error ? e.message : e);
    return null;
  }

  const tool: Anthropic.Tool = {
    name: TOOL_NAME,
    description:
      "Return the franchisor's financial condition as a single JSON object matching the schema, " +
      "extracted ONLY from the attached audited financial-statement pages.",
    input_schema: financialConditionSchema(),
  };

  try {
    const message = await getClient()
      .messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        tools: [tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: Buffer.from(subPdf).toString("base64"),
                },
              },
              {
                type: "text",
                text:
                  "The attached pages are the financial-statements section of a franchise FDD. " +
                  "Extract the franchisor's financial condition strictly from these audited statements.\n\n" +
                  FINANCIAL_CONDITION_EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      })
      .finalMessage();

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      console.warn("[financials] focused pass returned no tool_use block.");
      return null;
    }
    return toolUse.input as FinancialConditionExtraction;
  } catch (e) {
    console.warn("[financials] focused extraction failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
