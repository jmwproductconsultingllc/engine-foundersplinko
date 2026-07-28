// lib/brandJson.ts -- the on-disk serialization format for data/brands/*.json.
//
// WHY THIS EXISTS
//
// Two programs write brand records: scripts/jsonl-to-brands.ts (regenerates a
// record from a batch) and scripts/retract-brand.ts (pulls one, or puts it
// back). Both had their own inline `JSON.stringify(rec, null, 1)`, and both
// produced files that did not match what was already on disk. Symptom: pulling
// one brand -- a change that adds four fields -- produced a 146-line diff.
//
// That symptom is the entire problem. Retraction is deliberately implemented as
// a committed file edit so the change is reviewable in a pull request: someone
// should be able to see in five seconds that we pulled exactly one record and
// changed no figures. A 146-line whitespace diff destroys that property, and
// destroys it silently -- the reviewer's only options are to trust it or read
// all 146 lines, and under time pressure everyone picks trust.
//
// WHY FORMAT DETECTION AND NOT ONE CANONICAL FORMAT
//
// The obvious fix is to declare one format and write it everywhere. That was the
// first attempt, and it was built on a false premise: that the corpus was
// uniformly Python json.dump output. It is not. A census of the 83 committed
// files found FIVE distinct shapes, laid down by different writers over time:
//
//     65  indent 1, non-ASCII escaped         (Python json.dump, ensure_ascii)
//     13  no indent, ", " separators          (Python json.dump, indent=None)
//      4  indent 1, raw UTF-8                 (the TS converter, pre-fix)
//      1  indent 2                            (sharkey-s-cuts-for-kids)
//      1  indent 1, raw UTF-8 AND escapes     (crumbl, mixed)
//
// Declaring a canonical format means the first retraction also reformats
// whatever file it lands on -- exactly the noise we are trying to remove, just
// relocated. Normalizing the corpus up front is a separate 18-file diff that has
// nothing to do with retraction and would bury it.
//
// So the writer reads the file's existing shape and re-emits in it. The property
// we actually want is not "one format" -- it is "editing a record changes only
// what the edit changed." Detection gives us that on all 83 files today and on
// whatever a future writer lays down, without a migration.
//
// If the corpus is ever normalized on purpose, this module keeps working: every
// file simply detects to the same format. Detection is the weaker, safer claim.

/** The shape of one file on disk. Everything a writer needs to reproduce it. */
export interface BrandJsonFormat {
  /** Spaces per level. 0 means no newlines at all (Python indent=None). */
  indent: number;
  /** True = non-ASCII stored as \uXXXX (Python ensure_ascii=True). */
  escapeNonAscii: boolean;
  /** Almost always false here; Python's dump adds none. */
  trailingNewline: boolean;
}

/**
 * What a NEW record gets. The 65-file majority, which is also what the original
 * corpus build produced -- so a brand added tomorrow matches a brand added at
 * launch rather than starting a sixth variant.
 */
export const DEFAULT_BRAND_JSON_FORMAT: BrandJsonFormat = {
  indent: 1,
  escapeNonAscii: true,
  trailingNewline: false,
};

/**
 * Read a file's shape back out of its bytes.
 *
 * escapeNonAscii is inferred from the ABSENCE of raw non-ASCII rather than the
 * presence of escapes, because the two are not symmetric: a file can be fully
 * ASCII by coincidence (no em-dashes in its risk reasons) and still be an
 * ensure_ascii file. Absence-of-raw is the property that actually predicts what
 * the original writer would have emitted for a non-ASCII character.
 *
 * Corollary for the one mixed file (crumbl has both raw em-dashes and escapes):
 * it detects as raw, and re-emitting turns its handful of escapes into raw
 * characters. That is a real diff on that one file, on the day someone edits it,
 * and it is the right trade -- the alternative is a format model that can
 * represent "some of them" and no writer that can honor it.
 */
export function detectBrandJsonFormat(raw: string): BrandJsonFormat {
  const nl = raw.indexOf("\n");
  let indent = 0;
  if (nl > -1) {
    // First key of the top-level object carries the indent unit.
    const m = /^\s*[{[]\r?\n( *)\S/.exec(raw);
    indent = m ? m[1].length : DEFAULT_BRAND_JSON_FORMAT.indent;
  }
  const hasRawNonAscii = /[^\x00-\x7F]/.test(raw);
  return {
    indent,
    escapeNonAscii: !hasRawNonAscii,
    trailingNewline: raw.endsWith("\n"),
  };
}

/** JSON string literal, with non-ASCII escaped the way Python's ensure_ascii
 *  does it. Delegates the hard part (quotes, backslashes, control characters)
 *  to JSON.stringify, which already matches; only the high range differs.
 *
 *  Surrogate pairs fall out correctly: a non-BMP character is two UTF-16 code
 *  units, each in D800-DFFF, each matched and escaped separately -- precisely
 *  what ensure_ascii produces for the same input. */
function str(s: string, escapeNonAscii: boolean): string {
  const j = JSON.stringify(s);
  if (!escapeNonAscii) return j;
  return j.replace(/[^\x00-\x7F]/g, (c) =>
    "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

/**
 * Serialize a brand record in a given on-disk shape.
 *
 * Hand-rolled rather than JSON.stringify(rec, null, n) because of the 13
 * un-indented files: Python's json.dump with indent=None uses ", " between
 * items, and JSON.stringify uses ",". You cannot patch that in afterwards
 * without a JSON parser -- a naive comma replace corrupts every comma inside
 * every string, and the risk reasons are full of them.
 */
export function serializeBrandRecord(
  rec: unknown,
  fmt: BrandJsonFormat = DEFAULT_BRAND_JSON_FORMAT,
): string {
  const { indent, escapeNonAscii } = fmt;
  const pretty = indent > 0;
  const pad = (level: number) => " ".repeat(indent * level);

  const emit = (v: unknown, level: number): string => {
    if (v === null) return "null";
    if (typeof v === "string") return str(v, escapeNonAscii);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";

    if (Array.isArray(v)) {
      const items = v.map((x) => emit(x, level + 1));
      if (!items.length) return "[]";
      return pretty
        ? `[\n${items.map((s) => pad(level + 1) + s).join(",\n")}\n${pad(level)}]`
        : `[${items.join(", ")}]`;
    }

    if (typeof v === "object") {
      // undefined-valued keys are dropped, matching JSON.stringify.
      const entries = Object.entries(v as Record<string, unknown>).filter(
        ([, val]) => val !== undefined && typeof val !== "function",
      );
      if (!entries.length) return "{}";
      const items = entries.map(
        ([k, val]) => `${str(k, escapeNonAscii)}: ${emit(val, level + 1)}`,
      );
      return pretty
        ? `{\n${items.map((s) => pad(level + 1) + s).join(",\n")}\n${pad(level)}}`
        : `{${items.join(", ")}}`;
    }

    return "null";
  };

  return emit(rec, 0) + (fmt.trailingNewline ? "\n" : "");
}

/**
 * The combination both writers actually want: parse a file, let a caller change
 * the record, and write it back in the shape it arrived in.
 *
 * Returns DEFAULT for a file that does not exist yet, so a first write and a
 * rewrite go through the same path.
 */
export function formatOfFile(
  readFile: (p: string) => string,
  file: string,
): BrandJsonFormat {
  try {
    return detectBrandJsonFormat(readFile(file));
  } catch {
    return DEFAULT_BRAND_JSON_FORMAT;
  }
}
