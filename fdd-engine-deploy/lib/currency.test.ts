/**
 * A foreign-denominated FPR, handled honestly.
 *
 * Gorilla Property Services' Item 19 states "All dollar amounts are presented
 * in CAD and not USD." The extractor captured that sentence verbatim. Every
 * figure rendered from it carried a US dollar sign anyway, because nothing read
 * it — the same failure as the revenueType tag and the premises statement: the
 * fact was extracted correctly and then consumed by no one.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveCurrency,
  isForeignDenominated,
  currencyDisclosure,
  parityClaim,
  convertAtRate,
} from "./currency";
import { buildLadderInput } from "./ladderInput";
import type { ExtractedFDD } from "./schema";

const load = (slug: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "brands", `${slug}.json`), "utf8"))
    .result.extracted as ExtractedFDD;

const withNotes = (notes: string) =>
  ({ item19: { hasItem19: true, cohorts: [], notes, networkAverageMonthly: null } }) as unknown as ExtractedFDD;

describe("currency is named, never invented", () => {
  it("reads the CAD disclosure out of the stored Gorilla record", () => {
    const fdd = load("gorilla-property-services");
    expect(resolveCurrency(fdd)).toBe("CAD");
    expect(isForeignDenominated(fdd)).toBe(true);
  });

  it("an explicit field beats the note", () => {
    const fdd = {
      item19: { currency: "gbp", notes: "All amounts presented in CAD and not USD.", cohorts: [] },
    } as unknown as ExtractedFDD;
    expect(resolveCurrency(fdd)).toBe("GBP");
  });

  it("a US filing is silent — callers append the disclosure unconditionally", () => {
    expect(currencyDisclosure(withNotes("Figures are for the 2025 calendar year."))).toBeNull();
    expect(currencyDisclosure(load("code-ninjas"))).toBeNull();
  });

  it("the disclosure names the currency and refuses to convert", () => {
    const d = currencyDisclosure(load("gorilla-property-services"))!;
    expect(d).toMatch(/CAD/);
    expect(d).toMatch(/no conversion applied/i);
    expect(d).toMatch(/ask the franchisor/i);
  });

  it("the franchisor's parity argument is quoted, not paraphrased away", () => {
    const fdd = withNotes(
      "All dollar amounts are presented in CAD and not USD. Parity pricing per service applies: a Canadian franchisee will charge $250 CAD and a US franchisee will charge $250 USD for the same service.",
    );
    const claim = parityClaim(fdd);
    expect(claim).toMatch(/parity pricing/i);
    expect(currencyDisclosure(fdd)).toMatch(/its claim to defend, not a fact we have checked/);
  });

  it("rung 1 carries the disclosure, because rung 1 is where the number enters", () => {
    // A synthetic record so the ladder builds; the currency comes from the note.
    const s = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "brands", "code-ninjas.json"), "utf8"),
    ).result;
    const extracted = {
      ...s.extracted,
      item19: { ...s.extracted.item19, notes: "All dollar amounts are presented in CAD and not USD." },
    };
    const input = buildLadderInput({ ...s, extracted } as never);
    expect(input.currencyCode).toBe("CAD");
    expect(input.revenueSource).toMatch(/CAD/);
  });

  it("conversion exists for a rate the BUYER supplies, and refuses a bad one", () => {
    expect(convertAtRate(1000, 0.73)).toBe(730);
    expect(() => convertAtRate(1000, 0)).toThrow(/positive/);
    expect(() => convertAtRate(1000, -1)).toThrow(/positive/);
    expect(() => convertAtRate(1000, Number.NaN)).toThrow(/positive/);
    expect(() => convertAtRate(Number.NaN, 0.73)).toThrow(/finite/);
  });

  it("NO HARDCODED RATE SHIPS — the module must not contain one", () => {
    // The rule this file exists to enforce. A rate is a fact about today, and
    // these figures are read months later; a stale rate wears the same
    // confident formatting as the disclosed numbers beside it.
    const src = fs.readFileSync(path.join(process.cwd(), "lib", "currency.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b0\.\d{2,}\b/); // no rate literals outside comments
    expect(code).not.toMatch(/RATES?\s*[:=]/);
  });
});
