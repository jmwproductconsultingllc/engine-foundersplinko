// lib/stripComments.test.ts — the helper four lints depend on.
//
// This module is load-bearing for lints, which means a bug in it makes those
// lints report green while asserting nothing — THE ALWAYS-PASSING VERIFIER, at
// four call sites at once. It is worth its own tests.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "./stripComments";

describe("stripComments", () => {
  it("removes a line comment", () => {
    expect(stripComments("const a = 1; // banned").trim()).toBe("const a = 1;");
  });

  it("removes a block comment, including a multi-line one", () => {
    expect(stripComments("a/* banned */b")).toBe("a            b");
    expect(stripComments("a/* one\ntwo */b")).toBe("a      \n      b");
  });

  it("preserves line numbers", () => {
    const src = "one\n// two\nthree";
    expect(stripComments(src).split("\n").length).toBe(src.split("\n").length);
  });

  // The reason this is a character walk. The regex version this replaced would
  // have eaten the tail of the second line here.
  it("does not treat a slash pair inside a string as a comment", () => {
    expect(stripComments('const u = "https://example.com/x";')).toBe(
      'const u = "https://example.com/x";',
    );
    expect(stripComments("const t = `a // b`;")).toBe("const t = `a // b`;");
    expect(stripComments("const s = '// not a comment';")).toBe("const s = '// not a comment';");
  });

  it("does not treat a block-comment opener inside a string as a comment", () => {
    expect(stripComments('const g = "/* literal */";')).toBe('const g = "/* literal */";');
  });

  // STRINGS ARE SKIPPED, NOT BLANKED. Every caller relies on this: the banned
  // copy a lint is hunting for lives inside the string literals.
  it("leaves string contents intact for the caller to scan", () => {
    const src = 'const copy = "our audit of the franchisor"; // explains the ban';
    const out = stripComments(src);
    expect(out).toContain("our audit of the franchisor");
    expect(out).not.toContain("explains the ban");
  });

  it("handles an escaped quote inside a string", () => {
    expect(stripComments('const s = "he said \\"hi\\" // x";')).toBe(
      'const s = "he said \\"hi\\" // x";',
    );
  });

  it("handles an unterminated string without consuming the rest of the file", () => {
    // A bail-at-EOL, so one malformed line cannot blind the lint to the file.
    const out = stripComments("const bad = 'oops\nconst good = 1; // gone");
    expect(out).toContain("const good = 1;");
    expect(out).not.toContain("gone");
  });

  it("is a no-op on source with no comments", () => {
    const src = "export function f(a: number) { return a + 1; }";
    expect(stripComments(src)).toBe(src);
  });
});

// ── The reason it was hoisted: no fifth copy. ──
describe("there is exactly one stripComments declaration", () => {
  const ROOT = process.cwd();

  function sourceFiles(): string[] {
    const out: string[] = [];
    for (const dir of ["app", "components", "lib", "scripts"]) {
      const walk = (d: string) => {
        for (const entry of readdirSync(path.join(ROOT, d))) {
          const rel = path.join(d, entry);
          if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
          else if (/\.tsx?$/.test(entry)) out.push(rel);
        }
      };
      walk(dir);
    }
    return out;
  }

  it("scanned the tree", () => {
    expect(sourceFiles().length).toBeGreaterThan(50);
  });

  it("no file re-declares it", () => {
    // The module itself, obviously. And this file: the pattern below is a
    // regex LITERAL containing the declaration text, so the scan matches its
    // own source. Two paths, both self-reference, neither an exception to the
    // rule being enforced.
    const SELF = [path.join("lib", "stripComments.ts"), path.join("lib", "stripComments.test.ts")];
    const redeclared = sourceFiles().filter(
      (rel) =>
        !SELF.includes(rel) &&
        /function stripComments|const stripComments\s*=/.test(
          readFileSync(path.join(ROOT, rel), "utf8"),
        ),
    );
    // If this is red: import it from lib/stripComments.ts. Do not paste it.
    // Three copies existed before this module and two of them had already
    // drifted apart -- one was a regex that could not tell a comment from the
    // characters "//" inside a URL.
    expect(redeclared).toEqual([]);
  });
});
