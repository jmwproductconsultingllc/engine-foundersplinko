/**
 * FE-141 · the second buyer this filing is written for.
 *
 * Fixtures are transcribed from the source documents, not invented. Two Maids
 * Item 7 printed p. 21, footnote 9; Ellie Mental Health Item 5 and its separate
 * conversion investment table.
 */
import { describe, it, expect } from "vitest";
import { conversionPath } from "./conversion";
import { range } from "./range";
import type { ExtractedFDD } from "./schema";

const fdd = (item17: Record<string, unknown>): ExtractedFDD =>
  ({ item17: { lineItems: [], sourcePage: "Item 7, p. 21", ...item17 } }) as unknown as ExtractedFDD;

/** Two Maids: a COMPUTED, capped, discretionary credit on the territory fee. */
const twoMaids = () =>
  fdd({
    initialInvestmentLow: 93_440,
    initialInvestmentHigh: 149_890,
    conversion: {
      totalLow: 93_440,
      totalHigh: 139_890,
      discountLow: 0,
      discountHigh: 10_000,
      howDetermined:
        "The Initial Territory Fee for a conversion franchise is equal to our then-current Initial Territory Fee, reduced by an amount equal to 10% of the total Gross Revenue for the previous year for your existing business, but in no event will the discount exceed $10,000.",
      eligibility:
        "in our sole discretion, we may offer a franchise to persons desiring to convert their existing residential cleaning business",
      discretionary: null,
      sourcePage: "Item 7, p. 21",
    },
  });

/** Ellie: a FLAT replacement fee, eligibility decided by the franchisor. */
const ellie = () =>
  fdd({
    initialInvestmentLow: 189_467,
    initialInvestmentHigh: 445_018,
    conversion: {
      totalLow: 169_467,
      totalHigh: 425_018,
      discountLow: 20_000,
      discountHigh: 20_000,
      howDetermined: "the Initial Franchise Fee will be reduced to $20,000 per converting clinic",
      eligibility:
        "We will determine whether an existing outpatient counseling and therapy clinic qualifies as a Conversion Franchised Business based on various factors",
      discretionary: null,
      sourcePage: "Item 5",
    },
  });

describe("FE-141 — a conversion is a different purchase, priced differently", () => {
  it("says nothing at all when the filing offers no conversion path", () => {
    expect(conversionPath(fdd({ initialInvestmentLow: 100_000, initialInvestmentHigh: 200_000 }))).toBeNull();
    expect(conversionPath(null)).toBeNull();
  });

  it("TWO MAIDS — both totals reach the reader", () => {
    const c = conversionPath(twoMaids())!;
    expect(c.standard).toEqual([93_440, 149_890]);
    expect(c.conversion).toEqual([93_440, 139_890]);
    expect(c.headline).toContain(range("$93,440", "$149,890"));
    expect(c.headline).toContain(range("$93,440", "$139,890"));
  });

  it("THE FE-142 MIRROR — a discretionary credit is never applied as if granted", () => {
    const c = conversionPath(twoMaids())!;
    expect(c.discretionary).toBe(true);
    expect(c.headline).toMatch(/not a credit you have/i);
    // $0 is a disclosed outcome of this range and the reader is told so.
    expect(c.headline).toMatch(/\$0 is one of the disclosed outcomes/);
  });

  it("discretion is inferred from the filing's words when the flag is absent", () => {
    // The extractor left discretionary null on both fixtures, deliberately.
    expect(conversionPath(twoMaids())!.discretionary).toBe(true); // "sole discretion"
    expect(conversionPath(ellie())!.discretionary).toBe(true); // "We will determine ... various factors"
  });

  it("the filing's own sentence is quoted, because the formula is the product", () => {
    const c = conversionPath(twoMaids())!;
    expect(c.headline).toMatch(/10% of the total Gross Revenue for the previous year/);
    expect(c.howDetermined).toMatch(/in no event will the discount exceed \$10,000/);
  });

  it("ELLIE — a flat replacement fee reads as a single number, not a range", () => {
    const c = conversionPath(ellie())!;
    expect(c.discount).toEqual([20_000, 20_000]);
    expect(c.headline).toMatch(/The disclosed conversion credit is \$20,000\./);
    expect(c.headline).not.toMatch(/one of the disclosed outcomes/);
  });

  it("the buyer is pointed at the negotiation, not at our arithmetic", () => {
    const c = conversionPath(twoMaids())!;
    expect(c.whatToAsk).toMatch(/in writing/i);
    expect(c.whatToAsk).toMatch(/last three conversions/i);
  });

  it("a discount with no second total still surfaces", () => {
    const c = conversionPath(
      fdd({
        initialInvestmentLow: 100_000,
        initialInvestmentHigh: 200_000,
        conversion: { totalLow: null, totalHigh: null, discountLow: 0, discountHigh: 5_000, howDetermined: null, eligibility: null, discretionary: false, sourcePage: null },
      }),
    )!;
    expect(c.conversion).toBeNull();
    expect(c.discount).toEqual([0, 5_000]);
    expect(c.discretionary).toBe(false);
    expect(c.headline).toContain(range("$0", "$5,000"));
  });
});
