// lib/severity.test.ts — THE SEVERITY LINT.
//
// WHAT THIS CATCHES
//
// components/DiligenceReport.tsx indexed a four-key object literal with the
// PERSISTED severity and read `.color` off the result:
//
//     ({ HIGH: {...}, MEDIUM: {...}, LOW: {...}, INSUFFICIENT_DATA: {...} }
//       as const)[fc.severity].color
//
// Two catalog records — the-back-nine and golftrk — carry `'INSUFFICIENT'`,
// one token short of the union. The lookup returned undefined, `.color` threw,
// and THE PAID REPORT RENDERED A BLANK PAGE for exactly those two brands.
// the-back-nine is the brand we ship as the sample.
//
// A PARTIAL LOOKUP IS WORSE THAN A WRONG ONE. A total lookup would have shown a
// grey pill on a report that otherwise worked. The partial one took the page.
//
// WHY A LINT AND NOT JUST A FIX
//
// The bad value was not written by assessFinancialCondition(). Both bad records
// also carry `summary: "Engine financial-condition audit pending full parse."`,
// a string that appears NOWHERE in this repo — so a producer outside this repo
// wrote them, and it will write the next batch too. normalizeSeverity() makes
// every consumer safe. This lint makes the drift VISIBLE, so a new spelling
// gets a row in SEVERITY_ALIASES on purpose instead of silently collapsing to
// INSUFFICIENT_DATA and quietly suppressing a real HIGH.
//
// THE FAILURE MODE THIS LINT ITSELF HAS
//
// normalizeSeverity() can never be red — it returns a valid Severity for null,
// for 42, for "banana". A lint written against it would be THE ALWAYS-PASSING
// VERIFIER: green forever, catching nothing. That is why the assertion below is
// isKnownSeverity(), the predicate that CAN fail, and why the last test feeds it
// garbage to prove it fails.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSeverity, isKnownSeverity, SEVERITIES } from "./severity";

// process.cwd(), never __dirname or a relative literal — THE PORTABILITY LINT.
const BRANDS_DIR = join(process.cwd(), "data", "brands");

type Row = { slug: string; severity: unknown };

function loadSeverities(): Row[] {
  const files = readdirSync(BRANDS_DIR).filter((f) => f.endsWith(".json"));
  const out: Row[] = [];
  for (const f of files) {
    const rec = JSON.parse(readFileSync(join(BRANDS_DIR, f), "utf8"));
    const fc = rec?.result?.financialCondition;
    if (!fc) continue; // a record with no assessment is not this lint's business
    out.push({ slug: f.replace(/\.json$/, ""), severity: fc.severity });
  }
  return out;
}

describe("THE SEVERITY LINT", () => {
  const rows = loadSeverities();

  // A lint's own failure mode is scanning zero files and reporting green. If a
  // path change or a rename empties BRANDS_DIR, every assertion below passes
  // vacuously. This is the floor.
  it("scanned the catalog", () => {
    expect(rows.length).toBeGreaterThan(50);
  });

  it("every persisted severity is one normalizeSeverity() understands ON PURPOSE", () => {
    const unknown = rows
      .filter((r) => !isKnownSeverity(r.severity))
      .map((r) => `${r.slug} → ${JSON.stringify(r.severity)}`);
    // If this is red: read the value. If it is a new spelling of something we
    // already model, add a row to SEVERITY_ALIASES in lib/severity.ts. If it is
    // a grade we do NOT model, that is a schema change, not an alias.
    expect(unknown).toEqual([]);
  });

  it("resolves every persisted severity to a member of the union", () => {
    for (const r of rows) {
      expect(SEVERITIES).toContain(normalizeSeverity(r.severity));
    }
  });

  // The specific records that took the page down. Pinned by name so a future
  // re-extraction that fixes them at the source does not quietly delete the
  // coverage — if these stop carrying an alias, this test says so.
  it("the two known off-enum records still resolve", () => {
    for (const slug of ["the-back-nine", "golftrk"]) {
      const row = rows.find((r) => r.slug === slug);
      if (!row) continue; // brand removed from the catalog — not a failure
      expect(isKnownSeverity(row.severity), `${slug} → ${JSON.stringify(row.severity)}`).toBe(true);
      expect(SEVERITIES).toContain(normalizeSeverity(row.severity));
    }
  });

  // ── The mutation test. A lint is not real until you have watched it fail. ──
  it("is red on a value it does not model", () => {
    for (const bogus of ["banana", "SEVERE", "", null, undefined, 42, {}]) {
      expect(isKnownSeverity(bogus), `isKnownSeverity(${JSON.stringify(bogus)})`).toBe(false);
    }
  });

  it("normalizes the shapes the alias table exists for", () => {
    expect(normalizeSeverity("INSUFFICIENT")).toBe("INSUFFICIENT_DATA");
    expect(normalizeSeverity("insufficient_data")).toBe("INSUFFICIENT_DATA");
    expect(normalizeSeverity("  high  ")).toBe("HIGH");
    expect(normalizeSeverity("insufficient-data")).toBe("INSUFFICIENT_DATA");
  });

  it("falls back to INSUFFICIENT_DATA, never to a concern", () => {
    // An unrecognised grade is the ABSENCE of information, not the presence of
    // a concern. We do not publish a claim about a NAMED FRANCHISOR on the
    // strength of a token we failed to read.
    for (const bogus of ["banana", null, 42, {}]) {
      expect(normalizeSeverity(bogus)).toBe("INSUFFICIENT_DATA");
    }
  });
});
