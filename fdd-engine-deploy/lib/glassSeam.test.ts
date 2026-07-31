// lib/glassSeam.test.ts — THE SEAM LINT.
//
// Glass mode's entire defence is negative: the client is never handed a module
// that CAN produce a figure. Not "does not today" — cannot. THE LEAK TEST
// (lib/reportShell.test.ts) proves the SHELL carries no figures. This lint
// proves the second half, which no runtime test can see: that the code capable
// of computing one never reaches the browser bundle in the first place.
//
// The shape it exists to catch is one import line. `lib/reportSource.ts` pulls
// ladder.ts, ladderInput.ts, callList.ts, churn.ts, verify.ts and
// rentCorrection.ts. A "use client" component that imports it — or imports
// glassGate.ts, or anything that re-exports either — ships that whole
// arithmetic graph to the browser. Nothing leaks the day it happens: the
// component still renders masks, the leak test still passes, view-source is
// still clean. What changes is that the guarantee stops being structural and
// becomes a promise about what the component currently chooses to call.
//
// `tsc` cannot see this — the import is valid. The leak test cannot see it —
// it asserts on shell contents, not module graphs. `import "server-only"`
// cannot see it either: that package is not a dependency here, and even where
// it is, it only errors on a DIRECT import from a client module and is blind
// to a two-hop path through a shared helper. So it gets a lint.
//
// Registering a new server-only module: add it to SERVER_ONLY below.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["lib", "app", "components", "scripts"];
const EXTS = [".ts", ".tsx"];

/**
 * Modules that must never appear in a client module's import graph.
 * Keyed by the specifier stem as it appears in an import, without extension.
 */
const SERVER_ONLY = ["reportSource", "glassGate", "publicFigures"] as const;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

/**
 * Strip comments and string literals down to whitespace, preserving offsets.
 *
 * THE COMMENT-BLIND LINT. The first run of this file reported
 * `components/ReportGlass → lib/reportShell → lib/reportSource` — a leak that
 * does not exist. What it had actually found was the ADAPTER SEAM note at the
 * bottom of lib/reportShell.ts, which spells out the correct call site:
 *
 *     import { reportSourceFromComputed } from "@/lib/reportSource";
 *
 * inside a block comment. A lint that reads documentation as code punishes the
 * one file that took the trouble to explain itself, and the fix a hurried
 * reader reaches for is deleting the comment.
 *
 * Doing this with a regex is where it goes wrong in the other direction: a
 * naive //-to-end-of-line strip eats the rest of any line containing a URL in
 * a string, and an `import("...")` after one on the same line would vanish —
 * the lint would go quiet about a real edge. So this is a character walk that
 * tracks quote state, which is the only way to know whether a `//` is a
 * comment or the middle of "https://". Blanking rather than deleting keeps
 * every offset intact, so the regexes below need no adjustment.
 */
function stripNonCode(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) out[k] = src[k] === "\n" ? "\n" : " ";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      // Skipped, NOT blanked. Every specifier this lint looks for lives
      // inside a string, so blanking here would erase the thing being
      // measured. All this branch has to do is stop a `//` inside a string
      // literal — "https://…" — from being read as the start of a comment.
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) break;
        if (c !== "`" && src[j] === "\n") break; // unterminated; bail at EOL
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** Every module specifier this file imports from, however it is written. */
function importsOf(raw: string): string[] {
  const text = stripNonCode(raw);
  const out: string[] = [];
  const patterns = [
    /\bimport\s[^;]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s[^;]*?\sfrom\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** Resolve an import specifier to a repo-relative module stem, or null. */
function stemOf(specifier: string, fromFile: string): string | null {
  let p: string;
  if (specifier.startsWith("@/")) p = specifier.slice(2);
  else if (specifier.startsWith(".")) {
    p = relative(process.cwd(), join(fromFile, "..", specifier));
  } else return null; // a package, not one of ours
  return p.replace(/\.(tsx?|jsx?)$/, "").replace(/\\/g, "/");
}

const isClient = (text: string) => /^\s*["']use client["']/m.test(text);

describe("THE SEAM LINT", () => {
  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r)));

  const read = new Map<string, string>();
  for (const f of files) read.set(f, readFileSync(f, "utf8"));

  it("finds source to lint", () => {
    // The lint's own failure mode is scanning nothing and reporting green.
    expect(files.length).toBeGreaterThan(100);
  });

  it("importsOf reads code and ignores prose", () => {
    /* stripNonCode is the newest thing in this file and it fails in both
       directions. Under-strip and a documented import in a comment reports a
       leak that is not there (which is exactly what the first run of this lint
       did to lib/reportShell.ts). Over-strip — blank a shade too much — and
       every import list comes back empty, the graph has no edges, offenders is
       [] and the whole lint reports green forever. The second failure is
       silent, so it gets an explicit negative control. */
    const sample = [
      'import { a } from "./real";',
      'const url = "https://example.com/not-a-comment";',
      '// import { fake } from "./line-comment";',
      "/* import { fake2 } from \"./block-comment\"; */",
      'const lazy = await import("./dynamic");',
    ].join("\n");

    const found = importsOf(sample);
    expect(found).toContain("./real"); // over-strip guard
    expect(found).toContain("./dynamic"); // over-strip guard
    expect(found).not.toContain("./line-comment"); // under-strip guard
    expect(found).not.toContain("./block-comment"); // under-strip guard
    expect(found).not.toContain("https://example.com/not-a-comment");
  });

  it("the server-only modules it guards actually exist", () => {
    // A typo in SERVER_ONLY would make every assertion below vacuously true —
    // the lint would pass loudest at the exact moment it stopped guarding
    // anything. THE ALWAYS-PASSING VERIFIER is the mirror of the always-failing
    // one, and it is the more dangerous of the two.
    const stems = new Set(
      files.map((f) => relative(process.cwd(), f).replace(/\.(tsx?)$/, "")),
    );
    for (const m of SERVER_ONLY) {
      expect(stems.has(`lib/${m}`), `SERVER_ONLY lists "${m}" but lib/${m}.ts does not exist`).toBe(true);
    }
  });

  it("no client module reaches a server-only module, at any depth", () => {
    // Build the forward import graph over repo-local modules, then walk it from
    // every "use client" entry point. Depth matters: the failure this catches
    // is rarely a direct import. It is a shared helper that someone adds one
    // server-side convenience to, six weeks after the boundary was drawn.
    const graph = new Map<string, string[]>();
    const clients: string[] = [];

    for (const [file, text] of read) {
      const stem = relative(process.cwd(), file).replace(/\.(tsx?)$/, "");
      const deps = importsOf(text)
        .map((s) => stemOf(s, file))
        .filter((s): s is string => s !== null);
      graph.set(stem, deps);
      if (isClient(text)) clients.push(stem);
    }

    expect(clients.length, "no \"use client\" modules found — the walk is not running").toBeGreaterThan(0);

    const banned = new Set(SERVER_ONLY.map((m) => `lib/${m}`));
    const offenders: string[] = [];

    for (const entry of clients) {
      const seen = new Set<string>([entry]);
      const stack: Array<{ stem: string; path: string[] }> = [
        { stem: entry, path: [entry] },
      ];
      while (stack.length) {
        const { stem, path } = stack.pop()!;
        for (const dep of graph.get(stem) ?? []) {
          if (banned.has(dep)) {
            offenders.push(`${[...path, dep].join(" → ")}`);
            continue;
          }
          if (seen.has(dep) || !graph.has(dep)) continue;
          seen.add(dep);
          stack.push({ stem: dep, path: [...path, dep] });
        }
      }
    }

    expect(
      offenders,
      "A client module can reach a server-only module. That module can compute " +
        "a figure, so it must not be in the browser bundle — glass mode's " +
        "guarantee is that the client is never handed one, not that it " +
        "currently declines to call it. Move the server-side work behind a " +
        "prop computed in a server component.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the adapter is not imported by lib/reportShell.ts", () => {
    // The specific inversion the seam exists to prevent. reportShell.ts is
    // imported BY the client component; if it ever imports the adapter back,
    // the boundary is gone in one line and every client import of a type from
    // reportShell drags the arithmetic graph with it.
    const text = readFileSync(join(process.cwd(), "lib/reportShell.ts"), "utf8");
    const deps = importsOf(text).map((s) => stemOf(s, join(process.cwd(), "lib/reportShell.ts")));
    expect(deps).not.toContain("lib/reportSource");
    expect(deps).not.toContain("lib/glassGate");
  });
});
