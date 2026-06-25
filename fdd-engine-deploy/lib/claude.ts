// fdd-engine-deploy/lib/claude.ts
//
// The Claude extraction path — a drop-in sibling to extractFddFromFile (Gemini).
// Same contract: (ArrayBuffer, mimeType) -> ExtractedFDD. Used by lib/extractFdd.ts
// as the automatic fallback when Gemini is unavailable (503 spikes) and as an
// instant primary swap via EXTRACTION_PRIMARY=claude.
//
// Why this also helps beyond resilience: Claude's 1M-context models accept large
// PDFs natively and allow far more output than Gemini 3.5 Flash's 65,536-token
// ceiling, so data-dense FDDs that overflowed Gemini extract cleanly here.
//
// Structure is enforced via FORCED TOOL USE: we hand Claude one tool whose
// input_schema is the JSON-Schema form of our exact fddResponseSchema and set
// tool_choice to require it, so the model must return schema-shaped JSON. We
// reuse the SAME extraction prompt as the Gemini path (imported, not copied) so
// the two providers extract identically.

import Anthropic from "@anthropic-ai/sdk";
import { ExtractedFDD, fddResponseSchema } from "./schema";
import { EXTRACTION_PROMPT } from "./gemini";
import { FINANCIAL_CONDITION_EXTRACTION_PROMPT } from "./financialCondition";
import { geminiSchemaToJsonSchema } from "./schemaToJsonSchema";
import { trimPdfToPages } from "./pdfTrim";

// Default to Sonnet 4.6: 1M context, large output budget, strong extraction,
// cheaper than Opus. Override with CLAUDE_EXTRACTION_MODEL (e.g. claude-opus-4-8).
const CLAUDE_MODEL = process.env.CLAUDE_EXTRACTION_MODEL || "claude-sonnet-4-6";

// Output ceiling. 64k comfortably exceeds Gemini Flash's 65,536 effective wall
// for our (bounded, SCOPE-fenced) extraction. Raise via env if a filing ever
// needs more (Claude supports up to 128k on current models).
const MAX_OUTPUT_TOKENS = Number(process.env.CLAUDE_MAX_OUTPUT_TOKENS) || 64000;

// Trim oversized filings to this many leading pages before sending, so the
// prompt fits Claude's 1M-token context window. A UPS Store-class FDD is ~600
// pages / ~1.5M tokens; 250 leading pages keep the disclosure Items + financials
// with margin even for image-heavy docs. Raise via CLAUDE_MAX_PDF_PAGES.
const MAX_PDF_PAGES = Number(process.env.CLAUDE_MAX_PDF_PAGES) || 250;

const TOOL_NAME = "emit_fdd_extraction";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  _client = new Anthropic({ apiKey: key });
  return _client;
}

export async function extractFddWithClaude(
  fileBytes: ArrayBuffer,
  _mimeType: string,
): Promise<ExtractedFDD> {
  const client = getClient();

  // Keep huge filings within Claude's context window — trim the exhibit tail,
  // which carries no extraction signal. Falls back to the full doc if trim fails.
  const { data, trimmed, originalPages } = await trimPdfToPages(fileBytes, MAX_PDF_PAGES);
  if (trimmed) {
    console.warn(
      `[claude] large FDD: trimmed ${originalPages} -> ${MAX_PDF_PAGES} pages to fit context.`,
    );
  }
  const base64 = Buffer.from(data).toString("base64");

  const tool: Anthropic.Tool = {
    name: TOOL_NAME,
    description:
      "Return the structured FDD extraction as a single JSON object that matches the schema. " +
      "Populate every field strictly from the FDD's numbered disclosure Items (1–23) and the " +
      "audited financial statements, following the extraction rules in the message.",
    input_schema: geminiSchemaToJsonSchema(fddResponseSchema) as Anthropic.Tool.InputSchema,
  };

  // Stream the response: with a large max_tokens the SDK refuses a blocking
  // .create() (a request that *could* exceed 10 minutes must stream). We keep
  // the high output ceiling — that's what clears Gemini's overflow wall — and
  // collect the assembled Message via finalMessage(), so callers still get a
  // single result object. The route's maxDuration=800 + Fluid compute cover it.
  const message = await client.messages
    .stream({
      model: CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      tools: [tool],
      // Force the tool so the model MUST emit schema-shaped JSON (no prose).
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
                data: base64,
              },
            },
            {
              type: "text",
              text: EXTRACTION_PROMPT + FINANCIAL_CONDITION_EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    })
    .finalMessage();

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  if (!toolUse) {
    const stop = message.stop_reason ?? "unknown";
    throw new Error(`Claude returned no tool_use block (stop_reason: ${stop}).`);
  }

  return toolUse.input as ExtractedFDD;
}
