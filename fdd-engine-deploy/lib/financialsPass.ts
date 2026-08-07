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
//
// PROVIDER ORDER (changed 2026-08-06)
// -----------------------------------
// This pass used to be hardcoded Anthropic with no Gemini branch. That mattered
// more than it looks: recoverFinancials() runs inside the NORMAL SUCCESSFUL path
// (extractFdd -> backfillFinancials on every cache miss whose financials look
// thin), not the error path. So a Claude-only implementation here meant Claude
// was in the production path of a large share of extractions no matter which
// vendor was "primary" — and any sentence claiming otherwise was false.
//
// It now honours lib/providerOrder.ts like every other model call site: Gemini
// primary, Claude failover, same schema, same prompt, same merge contract.
// Gemini's branch needs no schema conversion — fddResponseSchema is ALREADY a
// Gemini schema; it is the Claude branch that converts.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { PDFDocument } from "pdf-lib";
import { fddResponseSchema } from "./schema";
import type { FinancialConditionExtraction } from "./financialCondition";
import { FINANCIAL_CONDITION_EXTRACTION_PROMPT } from "./financialCondition";
import { geminiSchemaToJsonSchema } from "./schemaToJsonSchema";
import { providerOrder, type ModelProvider } from "./providerOrder";

const CLAUDE_MODEL = process.env.CLAUDE_EXTRACTION_MODEL || "claude-sonnet-4-6";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
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

const FOCUSED_INSTRUCTION =
  "The attached pages are the financial-statements section of a franchise FDD. " +
  "Extract the franchisor's financial condition strictly from these audited statements.\n\n" +
  FINANCIAL_CONDITION_EXTRACTION_PROMPT;

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  _anthropic = new Anthropic({ apiKey: key, timeout: 780_000 });
  return _anthropic;
}

let _gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (_gemini) return _gemini;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  _gemini = new GoogleGenAI({ apiKey: key });
  return _gemini;
}

/** Per-page financial-signal score for the whole document. */
async function scorePages(bytes: ArrayBuffer): Promise<number[]> {
  // Dynamic import keeps unpdf (and its bundled pdfjs) out of the main bundle
  // and off the build's critical path — if it ever fails, only this pass does.
  const { getDocumentProxy, extractText } = await import("unpdf");
  // CRITICAL: hand pdfjs a COPY of the bytes. pdfjs takes ownership of the typed
  // array it's given and DETACHES the underlying ArrayBuffer. Because the caller's
  // `bytes` is that same buffer, detaching it would corrupt every later step that
  // reuses it — the page carve below, and the route's failure-capture re-upload
  // and file-size readout (which is why a failure showed "0.0 MB").
  const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
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

/**
 * The financialCondition sub-schema node, in its NATIVE Gemini form. Both
 * branches start here, so the two vendors cannot drift onto different shapes:
 * Gemini consumes it directly, Claude converts it.
 */
function financialConditionNode(): unknown {
  const root = fddResponseSchema as unknown as { properties?: Record<string, unknown> };
  const node = root.properties?.financialCondition;
  if (!node) throw new Error("financialCondition schema node not found in fddResponseSchema.");
  return node;
}

/** The same node as a Claude tool input_schema. */
function financialConditionSchema(): Anthropic.Tool.InputSchema {
  return geminiSchemaToJsonSchema(financialConditionNode()) as Anthropic.Tool.InputSchema;
}

// --- Vendor branches --------------------------------------------------------
// Each returns the extraction or THROWS. Throwing (not returning null) is what
// lets the caller distinguish "this vendor is down, try the other one" from
// "both vendors read the pages and there is nothing there." A branch that
// swallowed its own error would make the failover unreachable.

async function recoverWithGemini(subPdf: Uint8Array): Promise<FinancialConditionExtraction | null> {
  const ai = getGemini();
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: Buffer.from(subPdf).toString("base64"),
            },
          },
          { text: FOCUSED_INSTRUCTION },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      // Native Gemini schema — no conversion, no hand-maintained duplicate.
      responseSchema: financialConditionNode() as never,
      temperature: 0,
      maxOutputTokens: 8192,
    },
  });
  const text = response.text;
  if (!text) return null;
  return JSON.parse(text) as FinancialConditionExtraction;
}

async function recoverWithClaude(subPdf: Uint8Array): Promise<FinancialConditionExtraction | null> {
  const tool: Anthropic.Tool = {
    name: TOOL_NAME,
    description:
      "Return the franchisor's financial condition as a single JSON object matching the schema, " +
      "extracted ONLY from the attached audited financial-statement pages.",
    input_schema: financialConditionSchema(),
  };

  const message = await getAnthropic()
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
            { type: "text", text: FOCUSED_INSTRUCTION },
          ],
        },
      ],
    })
    .finalMessage();

  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    console.warn("[financials] focused pass returned no tool_use block.");
    return null;
  }
  return toolUse.input as FinancialConditionExtraction;
}

const BRANCHES: Record<
  ModelProvider,
  (subPdf: Uint8Array) => Promise<FinancialConditionExtraction | null>
> = {
  gemini: recoverWithGemini,
  claude: recoverWithClaude,
};

/**
 * Recover the franchisor's financial condition from the FULL document when the
 * main (trimmed) extraction missed it. Returns the extracted object, or null if
 * no statements block is found or every vendor fails.
 *
 * Vendor order is lib/providerOrder.ts — the SAME order the main extraction
 * uses, so there is exactly one answer to "which model does this product call
 * first," and it is true of the whole engine rather than of one file.
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

  const order = providerOrder();
  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    try {
      const out = await BRANCHES[provider](subPdf);
      if (i > 0) {
        console.warn(`[financials] recovered via FAILOVER provider "${provider}".`);
      } else {
        console.log(`[financials] recovered via primary provider "${provider}".`);
      }
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isLast = i === order.length - 1;
      console.warn(
        `[financials] provider "${provider}" failed${isLast ? " (last resort)" : " — failing over"}: ${msg}`,
      );
      // Best-effort pass: if every vendor is down we return null and the caller
      // keeps the main-pass financials and the honest "not provided" warning.
      // We never fail the whole report over a recovery attempt.
    }
  }
  return null;
}
