// lib/portability.test.ts — THE PORTABILITY LINT.
//
// On 2026-07-30 a green CI job printed "251 passed · 0 failed" next to a red X.
// lib/callList.test.ts read `/root/work/data/brands` — an absolute authoring-
// sandbox path that exists on exactly one machine on earth — so in CI the whole
// FILE aborted at collection with EACCES before a single one of its 36 tests
// ran. Nothing failed, because nothing executed. The suite counted the tests it
// could still see and called that a pass.
//
// That is the same defect class as the silent state-table guard: the failure is
// quiet, plausible, and reads as a property of the environment rather than a
// bug. `tsc` cannot see it — the string is a valid string. vitest cannot see it
// on the authoring machine, because there the path resolves.
//
// So it gets a lint. Every path into the repo resolves from process.cwd().

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["lib", "app", "components", "scripts"];
const EXTS = [".ts", ".tsx"];

// Absolute prefixes that belong to a machine, not to the project. Written as
// character classes so this file's own explanatory prose doesn't match itself.
const MACHINE_PATHS: Array<[RegExp, string]> = [
  [/["'`]\/root\/[a-z]/i, "/root/… (the authoring sandbox)"],
  [/["'`]\/home\/[a-z]/i, "/home/… (a user home directory)"],
  [/["'`]\/Users\//, "/Users/… (a macOS home directory)"],
  [/["'`]\/(?:tmp|var\/folders)\//, "/tmp or /var/folders (scratch space)"],
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // a root that doesn't exist in this checkout is not a failure
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

describe("THE PORTABILITY LINT", () => {
  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r)));

  it("finds source to lint (the lint itself must not silently pass on zero files)", () => {
    // The lint's own failure mode: a bad root list scans nothing and reports
    // green. Same shape as the bug it exists to catch, so it gets a floor.
    expect(files.length).toBeGreaterThan(100);
  });

  it("no source file hardcodes an absolute machine path", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith(join("lib", "portability.test.ts"))) continue; // the patterns above
      const src = readFileSync(f, "utf8");
      for (const [re, label] of MACHINE_PATHS) {
        for (const line of src.split("\n")) {
          if (re.test(line)) {
            offenders.push(`${f.replace(process.cwd() + "/", "")} → ${label}: ${line.trim().slice(0, 90)}`);
            break;
          }
        }
      }
    }
    expect(offenders, `hardcoded machine paths:\n${offenders.join("\n")}`).toEqual([]);
  });
});
