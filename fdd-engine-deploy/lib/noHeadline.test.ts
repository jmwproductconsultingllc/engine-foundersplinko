// lib/noHeadline.test.ts — the reason a card gives when it gives no number.
//
// The ladder gate stopped fourteen live pages advertising a figure they could
// not stand behind. This is the other half: an em-dash is truthful and useless,
// so every withheld card has to say something specific and checkable instead.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveBrandFacts } from "./brandFacts";
import { explainNoHeadline } from "./noHeadline";
import type { BrandRecord } from "./brands";

async function loadAll(): Promise<BrandRecord[]> {
  const dir = path.join(process.cwd(), "data", "brands");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  return Promise.all(
    files.map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as BrandRecord),
  );
}

describe("explainNoHeadline — classification", () => {
  it("no Item 19 at all outranks everything else", () => {
    const r = explainNoHeadline({ cohorts: [], hasItem19: false, systemUnits: 1933 });
    expect(r.kind).toBe("no-item19");
    expect(r.detail).toContain("1,933 outlets");
    // The point of the card: a large system with no FPR is the most useful
    // thing a candidate can learn, and the thing no broker leads with.
    expect(r.detail).toMatch(/Item 20/);
  });

  it("a system total is named as one and never divided", () => {
    const r = explainNoHeadline({
      cohorts: [{ label: "Table 1", ownership: "franchised", avgMonthlyRevenue: 835748 }],
      hasItem19: true,
      unusableReason: "it reports outlets together rather than one at a time",
    });
    expect(r.kind).toBe("reported-together");
    expect(r.detail).toMatch(/will not estimate one/);
  });

  it("corporate-only disclosure is never presented as franchisee earnings", () => {
    const r = explainNoHeadline({
      cohorts: [{ label: "Affiliate 2025", ownership: "affiliate", avgMonthlyRevenue: 157948 }],
      hasItem19: true,
    });
    expect(r.kind).toBe("no-franchisee-data");
    expect(r.short).toBe("No franchisee results disclosed");
  });

  it("a per-managed-unit basis is a different denominator, not a small number", () => {
    const r = explainNoHeadline({
      cohorts: [
        { label: "Annual Revenue per Unit Managed", ownership: "franchised", avgMonthlyRevenue: null },
      ],
      hasItem19: true,
    });
    expect(r.kind).toBe("not-per-outlet");
  });

  it("thinness is measured against the system, not in the abstract", () => {
    // Puddle Pool: one franchised outlet out of forty-four, because 42 of 43
    // were excluded for being open under twelve months.
    const r = explainNoHeadline({
      cohorts: [{ label: "The Villages FL", ownership: "franchised", sampleSize: 1, avgMonthlyRevenue: 138718 }],
      hasItem19: true,
      systemUnits: 44,
    });
    expect(r.kind).toBe("too-few-reporting");
    expect(r.short).toBe("1 outlet of 44 reported");
  });

  it("keeps the franchisor's own basis note, and never invents one", () => {
    const note = "42 of 43 franchised outlets were excluded because they had been open less than 12 months.";
    const withNote = explainNoHeadline({ cohorts: [], hasItem19: false, notes: note });
    expect(withNote.filingNote).toBe(note);
    expect(explainNoHeadline({ cohorts: [], hasItem19: false }).filingNote).toBeNull();
    expect(explainNoHeadline({ cohorts: [], hasItem19: false, notes: "   " }).filingNote).toBeNull();
  });
});

describe("explainNoHeadline — against the live corpus", () => {
  it("every withheld card carries a reason, and a published one carries none", async () => {
    const brands = await loadAll();
    const facts = brands.map((b) => resolveBrandFacts(b));
    const withheld = facts.filter((f) => !f.moModelable);
    // Floor: a corpus with nothing withheld would pass every assertion below by
    // measuring an empty set.
    expect(withheld.length).toBeGreaterThan(0);
    for (const f of withheld) {
      expect(f.noHeadline, `${f.slug} is withheld with no reason`).not.toBeNull();
      expect(f.noHeadline!.short.length, `${f.slug} reason is empty`).toBeGreaterThan(0);
    }
    for (const f of facts.filter((x) => x.moModelable)) {
      expect(f.noHeadline, `${f.slug} publishes a figure AND a reason`).toBeNull();
    }
  });

  it('the "unexplained" residue stays small', async () => {
    /* A RATCHET ON VAGUENESS. "Not enough disclosed to model a unit" is the
       honest fallback, but it is also the sentence that says least, so it is
       the one that must not quietly become the answer for everything.
       Measured 2026-09-11 against the re-scored corpus: 19 cards carry a
       reason and exactly ONE (SPENGA) falls through to the fallback. SPENGA
       discloses franchised cohorts at n=8, 9 and 44 against a 45-outlet system
       and is still refused — worth a look on its own, not a new rule.
       Lower this when it drops; never raise it to make a build pass. */
    const UNEXPLAINED_BASELINE = 1;
    const brands = await loadAll();
    const vague = brands
      .map((b) => resolveBrandFacts(b))
      .filter((f) => f.noHeadline?.kind === "unexplained")
      .map((f) => f.slug);
    expect(vague.length, `unexplained: ${vague.join(", ")}`).toBeLessThanOrEqual(
      UNEXPLAINED_BASELINE,
    );
  });
});
