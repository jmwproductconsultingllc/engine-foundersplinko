// fdd-engine-deploy/lib/schemaToJsonSchema.ts
//
// Converts the Gemini responseSchema object (built with @google/genai's `Type`
// enum) into standard JSON Schema, which is what Claude's tool `input_schema`
// expects. This lets the Claude extraction path reuse the EXACT same schema as
// the Gemini path (fddResponseSchema) — one source of truth, no hand-maintained
// duplicate that could silently drift out of sync.
//
// The mapping is mechanical:
//   Type.OBJECT  -> { type: "object", properties, required, additionalProperties:false }
//   Type.ARRAY   -> { type: "array", items }
//   Type.STRING  -> { type: "string" } (+ enum)
//   Type.NUMBER  -> { type: "number" }
//   Type.INTEGER -> { type: "integer" }
//   Type.BOOLEAN -> { type: "boolean" }
//   nullable:true -> type union with "null"
// `description` is preserved (it helps the model); Gemini-only hints like
// propertyOrdering/format are dropped (JSON Schema / Claude ignore them).

/* eslint-disable @typescript-eslint/no-explicit-any */

export type JsonSchema = Record<string, any>;

export function geminiSchemaToJsonSchema(node: any): JsonSchema {
  if (!node || typeof node !== "object") return {};

  const kind = String(node.type ?? "").toUpperCase();
  const out: JsonSchema = {};
  if (node.description) out.description = node.description;

  switch (kind) {
    case "OBJECT": {
      out.type = "object";
      const props: JsonSchema = {};
      for (const [key, value] of Object.entries(node.properties ?? {})) {
        props[key] = geminiSchemaToJsonSchema(value);
      }
      out.properties = props;
      if (Array.isArray(node.required) && node.required.length) {
        out.required = [...node.required];
      }
      // Keep extraction tight: no extra invented keys.
      out.additionalProperties = false;
      break;
    }
    case "ARRAY":
      out.type = "array";
      out.items = geminiSchemaToJsonSchema(node.items);
      break;
    case "STRING":
      out.type = "string";
      if (Array.isArray(node.enum) && node.enum.length) out.enum = [...node.enum];
      break;
    case "NUMBER":
      out.type = "number";
      break;
    case "INTEGER":
      out.type = "integer";
      break;
    case "BOOLEAN":
      out.type = "boolean";
      break;
    default:
      // Unknown/unspecified — leave loosely typed rather than guessing.
      break;
  }

  // Gemini "nullable" → JSON Schema null-union, so the model may legitimately
  // emit null for optional disclosures (e.g. no required net worth stated).
  if (node.nullable && typeof out.type === "string") {
    out.type = [out.type, "null"];
  }

  return out;
}
