// lib/brandJson.test.ts -- the ON-DISK FORMAT CONTRACT.
//
// This is the test that catches the bug it was written for. The retraction CLI
// wrote a brand file with JSON.stringify's default output; every assertion in
// retraction.test.ts still passed, tsc was clean, the parsed record was
// deep-equal to the original, and the only evidence anything was wrong was a
// 146-line diff on a change that touched four fields.
//
// The assertion below is the strongest available one and it is nearly free: run
// every committed brand file through detect-then-serialize and require the bytes
// back unchanged. No writer's format can drift without this going red, and no
// future brand file can arrive in a sixth shape we cannot reproduce.
//
// IF THIS FAILS on a file you did not touch: a writer changed. Fix the writer.
// Do NOT "fix" it by reformatting the corpus -- an 18-file whitespace diff
// buries whatever real change ships alongside it, which is the exact failure
// this whole module exists to prevent.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  serializeBrandRecord,
  detectBrandJsonFormat,
  DEFAULT_BRAND_JSON_FORMAT,
} from "./brandJson";

const ROOT = process.cwd();
const BRAND_DIR = path.join(ROOT, "data", "brands");
const files = readdirSync(BRAND_DIR).filter((f) => f.endsWith(".json"));

describe("the real corpus round-trips byte-for-byte", () => {
  it("found brand files to test against", () => {
    // Guard against a vacuous pass if the directory moves or the filter breaks.
    expect(files.length).toBeGreaterThan(20);
  });

  it("every committed record survives detect -> parse -> serialize unchanged", () => {
    const drifted: string[] = [];
    for (const f of files) {
      const raw = readFileSync(path.join(BRAND_DIR, f), "utf8");
      const out = serializeBrandRecord(JSON.parse(raw), detectBrandJsonFormat(raw));
      if (out === raw) continue;
      // Report the first difference rather than dumping 32kB per file.
      let i = 0;
      while (i < raw.length && i < out.length && raw[i] === out[i]) i++;
      drifted.push(
        `${f} @${i}: on-disk ${JSON.stringify(raw.slice(i, i + 40))} != ` +
          `serialized ${JSON.stringify(out.slice(i, i + 40))}`,
      );
    }
    // NO EXCEPTIONS LIST HERE, on purpose. There was one file that couldn't
    // round-trip (crumbl carried a single escaped em-dash among fifty raw ones,
    // so no boolean escaping policy could reproduce it). The tempting move was
    // to allowlist it and move on. The better one was to normalize that single
    // line, because an exceptions list is where the next real drift hides: the
    // day a second file lands in the list nobody re-derives whether it belongs
    // there. A zero-exception invariant is worth a one-line diff.
    expect(drifted).toEqual([]);
  });

  it("reproduces every format shape present in the corpus", () => {
    // If a sixth shape ever lands, the round-trip test above catches it. This
    // one documents what we believe is there, so the census stays honest.
    const shapes = new Set(
      files.map((f) => {
        const fmt = detectBrandJsonFormat(readFileSync(path.join(BRAND_DIR, f), "utf8"));
        return `${fmt.indent}/${fmt.escapeNonAscii}/${fmt.trailingNewline}`;
      }),
    );
    expect([...shapes].sort()).toEqual([
      "0/true/false", //  13 files -- Python indent=None, ", " separators
      "1/false/false", //  4 files -- the TS converter before this module existed
      "1/true/false", //  65 files -- the launch corpus, and the default for new
      "2/true/false", //   1 file  -- sharkey-s-cuts-for-kids
    ]);
  });
});

describe("detectBrandJsonFormat", () => {
  it("reads the indent off the first key", () => {
    expect(detectBrandJsonFormat('{\n "a": 1\n}').indent).toBe(1);
    expect(detectBrandJsonFormat('{\n  "a": 1\n}').indent).toBe(2);
  });

  it("reports indent 0 for a file with no newlines", () => {
    expect(detectBrandJsonFormat('{"a": 1}').indent).toBe(0);
  });

  it("infers escaping from the absence of raw non-ASCII, not the presence of escapes", () => {
    // A fully-ASCII file with no escapes at all is still an ensure_ascii file --
    // it just had nothing to escape. Getting this backwards would flip 65 files
    // to raw UTF-8 the first time one of them was edited.
    expect(detectBrandJsonFormat('{"a": "plain"}').escapeNonAscii).toBe(true);
    expect(detectBrandJsonFormat('{"a": "\\u2014"}').escapeNonAscii).toBe(true);
    expect(detectBrandJsonFormat('{"a": "—"}').escapeNonAscii).toBe(false);
  });

  it("notices a trailing newline", () => {
    expect(detectBrandJsonFormat('{"a": 1}').trailingNewline).toBe(false);
    expect(detectBrandJsonFormat('{"a": 1}\n').trailingNewline).toBe(true);
  });
});

describe("serializeBrandRecord", () => {
  it("indents with exactly the requested width", () => {
    expect(serializeBrandRecord({ a: 1 })).toBe('{\n "a": 1\n}');
    expect(serializeBrandRecord({ a: 1 }, { indent: 2, escapeNonAscii: true, trailingNewline: false }))
      .toBe('{\n  "a": 1\n}');
  });

  it("uses Python's \", \" separator when un-indented", () => {
    // THE reason this is hand-rolled. JSON.stringify emits "," with no space,
    // and you cannot patch that in afterwards without corrupting every comma
    // inside every string -- and the risk reasons are full of them.
    const fmt = { indent: 0, escapeNonAscii: true, trailingNewline: false };
    expect(serializeBrandRecord({ a: 1, b: 2 }, fmt)).toBe('{"a": 1, "b": 2}');
    expect(serializeBrandRecord({ a: [1, 2] }, fmt)).toBe('{"a": [1, 2]}');
  });

  it("does not put a space after a comma that lives inside a string", () => {
    const fmt = { indent: 0, escapeNonAscii: true, trailingNewline: false };
    expect(serializeBrandRecord({ a: "x,y" }, fmt)).toBe('{"a": "x,y"}');
  });

  it("escapes non-ASCII when asked, and emits it raw when not", () => {
    expect(serializeBrandRecord({ n: "a — b" })).toContain("\\u2014");
    expect(serializeBrandRecord({ n: "é" })).toContain("\\u00e9");
    const raw = serializeBrandRecord({ n: "a — b" }, {
      indent: 1, escapeNonAscii: false, trailingNewline: false,
    });
    expect(raw).toContain("—");
    expect(raw).not.toContain("\\u2014");
  });

  it("produces pure ASCII output when escaping is on", () => {
    const out = serializeBrandRecord({ n: "café — \u{1F600}" });
    expect([...out].every((c) => c.codePointAt(0)! < 128)).toBe(true);
  });

  it("escapes non-BMP characters as surrogate pairs", () => {
    // U+1F600. Python's ensure_ascii writes 😀; so must we.
    expect(serializeBrandRecord({ e: "\u{1F600}" })).toContain("\\ud83d\\ude00");
  });

  it("renders empty containers inline", () => {
    expect(serializeBrandRecord({ a: [], b: {} })).toBe('{\n "a": [],\n "b": {}\n}');
  });

  it("drops undefined-valued keys, matching JSON.stringify", () => {
    expect(serializeBrandRecord({ a: 1, b: undefined })).toBe('{\n "a": 1\n}');
  });

  it("emits no trailing newline by default", () => {
    expect(serializeBrandRecord({ a: 1 }).endsWith("\n")).toBe(false);
  });

  it("agrees with JSON.stringify on everything except the high range", () => {
    // Sanity net: for ASCII-only input at indent 1 with escaping off, the two
    // must be identical, or the hand-rolled emitter has a structural bug.
    const rec = {
      s: 'quotes " and \\ back',
      ctrl: "tab\there\nnewline",
      n: [1, -2.5, 0],
      nested: { deep: { deeper: [{ x: true }, null] } },
      empty: [],
    };
    expect(
      serializeBrandRecord(rec, { indent: 1, escapeNonAscii: false, trailingNewline: false }),
    ).toBe(JSON.stringify(rec, null, 1));
  });
});

describe("both writers go through the serializer", () => {
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it.each(["scripts/retract-brand.ts", "scripts/jsonl-to-brands.ts"])(
    "%s serializes through this module, not a bare JSON.stringify",
    (rel) => {
      const src = read(rel);
      expect(src).toContain("serializeBrandRecord");
      // The specific regression: writeFileSync(path, JSON.stringify(...)).
      expect(src).not.toMatch(/writeFileSync\([^)]*JSON\.stringify/);
    },
  );

  it.each(["scripts/retract-brand.ts", "scripts/jsonl-to-brands.ts"])(
    "%s preserves the file's existing format rather than imposing one",
    (rel) => {
      // Writing DEFAULT unconditionally would reformat 18 of the 83 files the
      // first time one of them is touched -- the noise this module removes.
      expect(read(rel)).toMatch(/detectBrandJsonFormat|formatOfFile/);
    },
  );

  it("the serializer source contains no literal non-ASCII", () => {
    // The first version of this escaping regex was a literal high-range class:
    // two invisible characters in source, one a C1 control byte, one
    // encoding-normalizing editor away from silently matching nothing.
    const bad = [...read("lib/brandJson.ts")].filter((c) => c.codePointAt(0)! > 127);
    expect(bad).toEqual([]);
  });

  it("the default is the format the majority of the corpus is already in", () => {
    const counts = new Map<string, number>();
    for (const f of files) {
      const fmt = detectBrandJsonFormat(readFileSync(path.join(BRAND_DIR, f), "utf8"));
      const k = `${fmt.indent}/${fmt.escapeNonAscii}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    expect(top[0]).toBe(
      `${DEFAULT_BRAND_JSON_FORMAT.indent}/${DEFAULT_BRAND_JSON_FORMAT.escapeNonAscii}`,
    );
  });
});
