// lib/riskReframeDrift.test.ts — THE drift audit (Risk Reframe acceptance).
// Sibling to the brand-facts audit: fails the build if the four surfaces could
// render a different "N things to verify" for the same brand, or if the shared
// component reintroduces red / a banned noun. This is the structural guarantee
// behind the single-source requirement — one component, one derivation.

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { toCard } from "./brands";
import { toTeaserCard } from "./teaserProps";
import { resolveBrandFacts } from "./brandFacts";
import { computeVerify, verifyPhrase, VERIFY_LABELS } from "./verify";
import type { BrandRecord } from "./brands";

async function loadAll(): Promise<BrandRecord[]> {
  const dir = path.join(process.cwd(), "data", "brands");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const out: BrandRecord[] = [];
  for (const f of files) out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
  return out;
}

describe("Risk Reframe drift audit — all surfaces agree", () => {
  it("library card, detail teaser, resolver, and paid-report path render the SAME count + items", async () => {
    const brands = await loadAll();
    for (const b of brands) {
      const facts = resolveBrandFacts(b); // surfaces #1/#2/#3 read these fields
      const card = toCard(b); // library grid (Surface #1)
      const teaser = toTeaserCard(b); // detail card (Surface #2)
      // Paid report (Surface #4) + free snapshot (Surface #3) compute directly
      // from scoring.riskReasons via the SAME helper — this is the divergence risk.
      const reportPath = computeVerify((b as any)?.result?.scoring?.riskReasons);

      const counts = [facts.verifyCount, card.verifyCount, teaser.verifyCount, reportPath.verifyCount];
      expect(new Set(counts).size, `${facts.slug}: verifyCount drift ${JSON.stringify(counts)}`).toBe(1);

      const items = [facts.verifyItems, card.verifyItems, teaser.verifyItems, reportPath.verifyItems];
      const serialized = items.map((x) => JSON.stringify(x));
      expect(new Set(serialized).size, `${facts.slug}: verifyItems drift ${JSON.stringify(items)}`).toBe(1);

      for (const label of facts.verifyItems) expect(VERIFY_LABELS).toContain(label as (typeof VERIFY_LABELS)[number]);
    }
  });

  it("verifyPhrase obeys the label law — names the noun, singular at 1, plural above", () => {
    expect(verifyPhrase(1)).toBe("1 thing to verify");
    expect(verifyPhrase(2)).toBe("2 things to verify");
    expect(verifyPhrase(6)).toBe("6 things to verify");
    expect(verifyPhrase(0)).toBe("1 thing to verify"); // floored — never "0 things"
    // never a naked number: the noun is always present
    for (const n of [1, 2, 3, 5]) expect(verifyPhrase(n)).toMatch(/thing/);
  });
});

describe("shared component holds the visual law", () => {
  it("DiligenceToVerify uses NO red Tailwind classes or red hexes (red is reserved for earned findings)", async () => {
    const src = await fs.readFile(
      path.join(process.cwd(), "components", "DiligenceToVerify.tsx"),
      "utf8",
    );
    // Tailwind red utilities (text-red-*, bg-red-*, border-red-*) + common red hexes.
    expect(src).not.toMatch(/\b(?:text|bg|border)-red-\d/);
    expect(src.toLowerCase()).not.toMatch(/#ef4444|#f87171|#dc2626|#fca5a5/);
  });
});
