// fdd-engine-deploy/lib/providerInventory.test.ts
//
// WHY THIS FILE EXISTS
// --------------------
// On 2026-08-06 an outside reader checked a public claim ("Gemini is the only
// LLM in the production path") against this repo and found a second Claude call
// site — lib/financialsPass.ts — sitting in the NORMAL SUCCESSFUL path, not the
// error path. Nobody lied. Nobody remembered it was there.
//
// The failure was not the code. The failure was that the inventory of model
// call sites lived in somebody's head, and a head does not fail a build.
//
// AN ENUMERATED GUARD ONLY GUARDS WHAT SOMEONE REMEMBERED TO ENUMERATE.
// So this guard does not enumerate call sites from memory — it SCANS for them
// and compares the scan to a declared manifest. Adding a model call anywhere in
// the app now breaks the build until the author writes down which vendor it
// calls, in what order, and why. That is the whole point: the next person to
// add a Claude call cannot do it silently.
//
// The scanner is also mutation-tested below against a synthetic offending file,
// because a lint that has never been observed to fail is not a lint.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { stripComments } from "./stripComments";

// ---------------------------------------------------------------------------
// The manifest. Every model call site in the product, declared.
// ---------------------------------------------------------------------------
//
// role:
//   "leaf"        — a single-vendor extractor. It is ONE branch by design and
//                   therefore does not consult the order; the orchestrator does.
//   "orchestrator"— chooses between vendors. MUST import ./providerOrder.
//   "schema"      — imports an SDK for TYPES or schema builders only. Must not
//                   construct a client.
type Role = "leaf" | "orchestrator" | "schema";

const MANIFEST: Record<string, { role: Role; vendor: string; why: string }> = {
  "lib/gemini.ts": {
    role: "leaf",
    vendor: "google",
    why: "Primary FDD extractor. The default vendor for the whole engine.",
  },
  "lib/claude.ts": {
    role: "leaf",
    vendor: "anthropic",
    why: "Failover FDD extractor. Same schema, same prompt, different vendor — this is the durability story, and we say it out loud.",
  },
  "lib/financialsPass.ts": {
    role: "orchestrator",
    vendor: "google->anthropic",
    why: "Late-exhibit financials recovery. Runs inside the SUCCESS path on cache misses, so its vendor order is part of the public claim and must match the main path.",
  },
  "lib/extractFdd.ts": {
    role: "orchestrator",
    vendor: "google->anthropic",
    why: "Determinism cache + primary/failover for the main extraction.",
  },
  "lib/schema.ts": {
    role: "schema",
    vendor: "none",
    why: "Imports @google/genai's Type enum to BUILD the shared response schema. No client, no network.",
  },
  "lib/schemaToJsonSchema.ts": {
    role: "schema",
    vendor: "none",
    why: "Converts the Gemini schema to Claude tool input_schema. Pure function.",
  },
};

// ---------------------------------------------------------------------------
// The scanner.
// ---------------------------------------------------------------------------

const SCAN_DIRS = ["lib", "app", "components", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage"]);
// Test files are excluded on purpose. The claim being guarded is about the
// PRODUCTION path, and this file would otherwise flag itself for containing the
// vendor strings it searches for. (A test that made a real billed model call
// would be a different problem, caught by the fact that CI has no vendor keys.)
const TEST_RE = /\.(test|spec)\.tsx?$/;

/** Anything that means "this file can talk to a model vendor". */
const SDK_RE =
  /(@anthropic-ai\/sdk|@google\/genai|api\.anthropic\.com|generativelanguage\.googleapis\.com)/;
/**
 * An orchestrator does not import an SDK — it imports the single-vendor leaves
 * and chooses between them. extractFdd.ts is exactly this shape, and an
 * SDK-string-only scan is blind to it. Depth is deliberately ONE: a direct
 * importer of a leaf is in the model path; a transitive importer (pipeline.ts,
 * the route, the whole app) is not, or the manifest would swallow the codebase.
 */
const LEAF_IMPORT_RE = /from\s+["'](?:\.{1,2}\/)*(gemini|claude)["']/;
/** Anything that means "this file actually opens a connection". */
const CLIENT_RE = /(new\s+Anthropic\s*\(|new\s+GoogleGenAI\s*\()/;
const ORDER_IMPORT_RE = /from\s+["'](?:\.{1,2}\/)*providerOrder["']/;

interface Hit {
  file: string;
  constructsClient: boolean;
  importsOrder: boolean;
}

function walk(root: string, dir: string, out: string[]): void {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(root, path.join(dir, entry.name), out);
    } else if (/\.tsx?$/.test(entry.name) && !TEST_RE.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
}

export function scanProviderCallSites(root: string, dirs: string[] = SCAN_DIRS): Hit[] {
  const files: string[] = [];
  for (const d of dirs) walk(root, d, files);
  const hits: Hit[] = [];
  for (const rel of files) {
    // Comments are stripped BEFORE the scan. A comment cannot open a connection,
    // so a vendor string inside one is documentation, not a call site — and the
    // documentation most worth writing is the kind that names the SDK it is
    // keeping OUT of a bundle. components/DiligenceReport.tsx carries exactly
    // that sentence and this scanner flagged it, which would have taught the
    // next author to stop writing the comment rather than to declare the call.
    // A GUARD THAT PUNISHES THE COMMENT EXPLAINING THE RULE TEACHES SILENCE.
    const src = stripComments(fs.readFileSync(path.join(root, rel), "utf8"));
    if (!SDK_RE.test(src) && !LEAF_IMPORT_RE.test(src)) continue;
    hits.push({
      file: rel.split(path.sep).join("/"),
      constructsClient: CLIENT_RE.test(src),
      importsOrder: ORDER_IMPORT_RE.test(src),
    });
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file));
}

// The repo root, from this file's location (lib/ -> ..).
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// The guards.
// ---------------------------------------------------------------------------

describe("model-provider inventory", () => {
  const hits = scanProviderCallSites(ROOT);

  it("scanned something — a scanner that finds nothing always passes", () => {
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  it("finds no model call site that is missing from the manifest", () => {
    const undeclared = hits.map((h) => h.file).filter((f) => !(f in MANIFEST));
    expect(
      undeclared,
      "A new file talks to a model vendor. Add it to MANIFEST in lib/providerInventory.test.ts " +
        "with its role, vendor and reason — and then check whether it changes what we claim " +
        "publicly about which models are in the production path.",
    ).toEqual([]);
  });

  it("finds no manifest entry that no longer exists (stale declarations lie too)", () => {
    const found = new Set(hits.map((h) => h.file));
    const stale = Object.keys(MANIFEST).filter((f) => !found.has(f));
    expect(stale, "MANIFEST declares call sites the scan cannot find.").toEqual([]);
  });

  it("every orchestrator imports the shared provider order", () => {
    const offenders = hits
      .filter((h) => MANIFEST[h.file]?.role === "orchestrator")
      .filter((h) => !h.importsOrder)
      .map((h) => h.file);
    expect(
      offenders,
      "An orchestrator that picks its own vendor order is how the engine came to " +
        "disagree with its own documentation. Import ./providerOrder.",
    ).toEqual([]);
  });

  it("schema-only files never construct a client", () => {
    const offenders = hits
      .filter((h) => MANIFEST[h.file]?.role === "schema")
      .filter((h) => h.constructsClient)
      .map((h) => h.file);
    expect(offenders).toEqual([]);
  });

  it("there are exactly two single-vendor leaves, one per vendor", () => {
    const leaves = Object.entries(MANIFEST)
      .filter(([, m]) => m.role === "leaf")
      .map(([f, m]) => `${f}:${m.vendor}`)
      .sort();
    expect(
      leaves,
      "A third single-vendor leaf means a model call that no failover covers.",
    ).toEqual(["lib/claude.ts:anthropic", "lib/gemini.ts:google"]);
  });

  it("every declaration carries a reason a stranger could read", () => {
    for (const [file, m] of Object.entries(MANIFEST)) {
      expect(m.why.length, `${file} needs a real reason`).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
// Mutation test — prove the scanner can actually fail.
// ---------------------------------------------------------------------------

describe("model-provider inventory — the scanner itself", () => {
  it("detects a newly-added, undeclared Claude call site", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "provinv-"));
    try {
      fs.mkdirSync(path.join(tmp, "lib"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "lib", "innocuousHelper.ts"),
        [
          'import Anthropic from "@anthropic-ai/sdk";',
          "const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });",
          "export const ping = () => c;",
        ].join("\n"),
      );
      fs.writeFileSync(path.join(tmp, "lib", "pure.ts"), "export const two = 1 + 1;\n");

      const found = scanProviderCallSites(tmp, ["lib"]);
      expect(found.map((h) => h.file)).toEqual(["lib/innocuousHelper.ts"]);
      expect(found[0].constructsClient).toBe(true);
      expect(found[0].importsOrder).toBe(false);
      expect("lib/innocuousHelper.ts" in MANIFEST).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not flag a file that merely mentions the words in prose", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "provinv-"));
    try {
      fs.mkdirSync(path.join(tmp, "lib"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "lib", "copy.ts"),
        'export const BLURB = "We use Gemini first and Claude as a failover.";\n',
      );
      expect(scanProviderCallSites(tmp, ["lib"])).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
