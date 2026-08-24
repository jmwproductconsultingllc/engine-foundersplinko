/**
 * FE-140 crit 7 + FE-143 crit 1 — a completeness claim is a claim.
 *
 * Two Maids' report announced the document read complete over four disclosed
 * cost columns that went unread across twelve charts. Bark & Mane's announced
 * it while the concept classifier had fallen through to "uncategorized" and
 * drawn generic cost bands — disclosed only in a footnote under the ladder,
 * where a reader who has already believed the headline will never go.
 *
 * Both were possible because the badge asserted rather than derived, and
 * because appearsComplete and warnings were extracted into the record and then
 * read by nothing at all.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assessCoverage, conceptIsKnown } from "./coverage";
import { scoreFdd } from "./scoring";
import { getSampleResult } from "./sampleReport";
import { reportSourceFromComputed } from "./reportSource";
import type { DiligenceResult } from "./types";
import type { ExtractedFDD } from "./schema";

const record = (slug: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "brands", `${slug}.json`), "utf8"))
    .result as DiligenceResult;

const rescored = (slug: string): DiligenceResult => {
  const r = record(slug);
  return { ...r, scoring: scoreFdd(r.extracted as ExtractedFDD) } as DiligenceResult;
};

describe("the completeness badge is derived, not asserted", () => {
  it("a clean record with a known concept still reads complete", () => {
    const c = assessCoverage(getSampleResult());
    expect(c.level).toBe("complete");
    expect(c.headline).toMatch(/Every figure above cites one of them/);
    expect(c.gaps.filter((g) => g.severity !== "note")).toEqual([]);
  });

  it("THE BARK & MANE DEFECT — an unclassified business cannot read complete", () => {
    const s = getSampleResult();
    const r = { ...s, extracted: { ...s.extracted, conceptType: "other" } } as DiligenceResult;
    const c = assessCoverage(r);
    expect(c.conceptKnown).toBe(false);
    expect(c.level).toBe("partial");
    const gap = c.gaps.find((g) => g.id === "concept-type")!;
    expect(gap.severity).toBe("material");
    // The consequence has to name what it does to the numbers, not just flag it.
    expect(gap.consequence).toMatch(/general franchise band/i);
    expect(gap.consequence).toMatch(/Item 20/);
  });

  it("unknown concept labels are all treated the same", () => {
    for (const c of ["other", "unknown", "uncategorized", "", "  OTHER  "]) {
      expect(conceptIsKnown({ conceptType: c } as unknown as ExtractedFDD)).toBe(false);
    }
    expect(conceptIsKnown({ conceptType: "home_services" } as unknown as ExtractedFDD)).toBe(true);
  });

  it("a refused filing reads UNVERIFIED, not partial", () => {
    const c = assessCoverage(rescored("gorilla-property-services"));
    expect(c.level).toBe("unverified");
    expect(c.gaps.find((g) => g.id === "top-line")?.severity).toBe("blocking");
    expect(c.headline).toMatch(/could not be read completely enough to model/i);
  });

  it("the extractor's own warnings finally reach the reader", () => {
    const s = getSampleResult();
    const r = {
      ...s,
      extracted: {
        ...s.extracted,
        documentCheck: { ...s.extracted.documentCheck, warnings: ["Item 19 tables are partially illegible"] },
      },
    } as DiligenceResult;
    const c = assessCoverage(r);
    expect(c.level).toBe("partial");
    expect(c.gaps.some((g) => g.what.includes("partially illegible"))).toBe(true);
  });

  it("appearsComplete=false and a scanned document both block", () => {
    const s = getSampleResult();
    for (const patch of [{ appearsComplete: false }, { appearsScanned: true }]) {
      const r = {
        ...s,
        extracted: { ...s.extracted, documentCheck: { ...s.extracted.documentCheck, ...patch } },
      } as DiligenceResult;
      expect(assessCoverage(r).level).toBe("unverified");
    }
  });

  it("the pipeline-version gap is a NOTE and must not degrade the badge", () => {
    // We have captured Item 19 cost columns on no brand yet. That is a fact
    // about our extractor, not about the filing in front of the reader, and
    // degrading every report for it would flatten the signal that matters.
    const c = assessCoverage(getSampleResult());
    const note = c.gaps.find((g) => g.id === "item19-costs");
    if (note) expect(note.severity).toBe("note");
    expect(c.level).toBe("complete");
  });

  it("the rendered section carries the verdict, not the old assertion", () => {
    const s = getSampleResult();
    const degraded = { ...s, extracted: { ...s.extracted, conceptType: "other" } } as DiligenceResult;
    const section = reportSourceFromComputed({ result: degraded }).sections.find(
      (x) => x.id === "document-check",
    )!;
    expect(section.blurb).not.toMatch(/Every figure above cites one of them/);
    expect(section.freeChips).toContain("PARTIAL READ");
    expect(section.freeChips).toContain("Business type unclassified");
  });
});

/**
 * FE-143 criterion 4 — classification quality, made visible and non-growing.
 *
 * Two Maids and Bark & Mane are both mobile, low-overhead home services. One
 * classified correctly and drew a 2–6% occupancy band; the other fell through
 * to "uncategorized" and drew 6–12%. Same portfolio, same operating shape,
 * bands differing by 2x, and nothing surfaced the inconsistency.
 *
 * A cross-brand "same shape should draw the same band" check cannot be written
 * honestly, because knowing the shape is exactly what failed. What CAN be
 * pinned is the size of the unclassified bucket. Eight of 83 brands currently
 * fall through — six tagged "other", including The UPS Store and Express
 * Employment Professionals, neither of which is a hard call, plus two carrying
 * no conceptType field at all. Each one draws generic cost bands and now
 * reads PARTIAL rather than complete.
 *
 * RATCHET. This number may shrink and may not grow. A new FDD that lands in
 * "other" fails this test, which is the point: misclassification should cost
 * something at the moment it happens rather than surfacing in a footnote under
 * a ladder a buyer has already believed.
 */
describe("classification quality is a ratchet", () => {
  // 8 = six brands tagged "other" plus TWO carrying no conceptType at all.
  // The second pair is the more interesting half: the field is required by the
  // schema and two records simply do not have it, which no test noticed until
  // this one counted. Both draw generic bands exactly like the "other" six.
  const UNCLASSIFIED_BASELINE = 8;

  const corpus = () =>
    fs
      .readdirSync(path.join(process.cwd(), "data", "brands"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "brands", f), "utf8")));

  it("the unclassified bucket does not grow", () => {
    const unclassified = corpus()
      .filter((b) => !conceptIsKnown(b.result?.extracted))
      .map((b) => b.slug);
    expect(unclassified.length).toBeLessThanOrEqual(UNCLASSIFIED_BASELINE);
  });

  it("every unclassified brand reads PARTIAL, never complete", () => {
    for (const b of corpus()) {
      if (conceptIsKnown(b.result?.extracted)) continue;
      const c = assessCoverage(b.result as DiligenceResult);
      expect(c.level, `${b.slug} must not read complete`).not.toBe("complete");
    }
  });
});
