// components/reportRender.test.tsx — THE RENDER LINT.
//
// WHY THIS FILE EXISTS
//
// On 2026-07-31 the PAID report threw on render for two brands in the live
// catalog — including the-back-nine, the brand we ship as the sample:
//
//     TypeError: Cannot read properties of undefined (reading 'color')
//         at DiligenceReport (components/DiligenceReport.tsx:441)
//
// Cause: `result.financialCondition.severity === 'INSUFFICIENT'` indexed into a
// four-key object literal with no fallback. lib/severity.test.ts now catches
// THAT class of defect at the data layer. This file catches the class the data
// lint cannot: ANY reason the component throws on a record we actually ship.
//
// The defect survived because nothing in the suite had ever rendered the paid
// report against a real record. Every other lint reads JSON, or reads source
// text, or renders the GLASS component. The one surface a buyer pays for was
// covered by zero tests. tsc could not see it — the record satisfies the type;
// it is the VALUE that is off-enum.
//
// WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
//
// It asserts only: renderToStaticMarkup does not throw, and the output is not
// empty. It makes NO claim about correctness of any figure. A render lint that
// starts asserting content becomes a snapshot test, and a snapshot test over 80
// brands is red every time anyone edits copy — THE ALWAYS-FAILING VERIFIER,
// "a lint that is red on 100% of the catalog is a lint someone disables."
//
// KNOWN LIMIT, STATED ON PURPOSE
//
// This is a static server render. It exercises the first paint only: hooks run,
// effects do not, and no branch behind a click is reached. It would not have
// caught a crash inside an onClick handler. It DOES catch every crash on the
// path a reader hits before they touch anything, which is where the blank page
// came from.

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import DiligenceReport from "@/components/DiligenceReport";
import type { DiligenceResult } from "@/lib/types";

// The component tracks. A render lint must not emit 80 analytics events, and
// posthog is not loaded under vitest anyway.
vi.mock("@/lib/analytics", () => ({
  track: () => {},
  identify: () => {},
}));

// process.cwd(), never __dirname — THE PORTABILITY LINT.
const BRANDS_DIR = join(process.cwd(), "data", "brands");

function loadRecords(): { slug: string; result: DiligenceResult }[] {
  const files = readdirSync(BRANDS_DIR).filter((f) => f.endsWith(".json"));
  const out: { slug: string; result: DiligenceResult }[] = [];
  for (const f of files) {
    const rec = JSON.parse(readFileSync(join(BRANDS_DIR, f), "utf8"));
    if (!rec?.result) continue;
    out.push({ slug: f.replace(/\.json$/, ""), result: rec.result as DiligenceResult });
  }
  return out;
}

describe("THE RENDER LINT", () => {
  const records = loadRecords();

  // The floor. A lint that scanned zero files reports green.
  it("loaded the catalog", () => {
    expect(records.length).toBeGreaterThan(50);
  });

  it("every catalog record renders the paid report without throwing", () => {
    const broken: string[] = [];
    for (const r of records) {
      try {
        const html = renderToStaticMarkup(<DiligenceReport result={r.result} />);
        if (!html || html.length < 500) {
          broken.push(`${r.slug} → rendered ${html.length} chars`);
        }
      } catch (e) {
        broken.push(`${r.slug} → ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Named, not counted: the point of a failure here is knowing WHICH brand is
    // dark, because that brand's buyers are looking at a blank page right now.
    expect(broken).toEqual([]);
  });

  // Pinned by name. These two are the reason the file exists; if a future
  // re-extraction fixes them at the source, the general test above still covers
  // them, but the named case keeps the history attached to the code.
  it("renders the two records that used to throw", () => {
    for (const slug of ["the-back-nine", "golftrk"]) {
      const rec = records.find((r) => r.slug === slug);
      if (!rec) continue; // brand removed from the catalog — not a failure
      const html = renderToStaticMarkup(<DiligenceReport result={rec.result} />);
      expect(html.length, slug).toBeGreaterThan(500);
    }
  });
});
