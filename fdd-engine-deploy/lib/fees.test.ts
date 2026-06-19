import { describe, it, expect } from "vitest";
import { recurringFeeDisplays } from "./fees";
import type { ExtractedFDD } from "./schema";

/**
 * GOLDEN BASELINE — recurring-fee display logic.
 *
 * Pins how disclosed (and undisclosed) fees turn into what the report shows.
 * The headline case: a NULL royalty must never render as a bare dash — it must
 * explain itself, and when the brand's own disclosed fees look purchase-based
 * (Maui Wowi), it should say so (hedged). If you change lib/fees.ts and it alters
 * any of these, this fails on purpose — decide if intended, then update.
 */

type FeeFacts = Pick<ExtractedFDD, "ongoingFees" | "hiddenCosts">;

describe("recurringFeeDisplays — fee line copy", () => {
  it("renders a disclosed royalty as a percentage, and treats 0 as a real disclosure", () => {
    const facts: FeeFacts = {
      ongoingFees: { royaltyPct: 8, brandFundPct: 0, localAdPct: 0, flatMonthlyFees: [] },
      hiddenCosts: [],
    };
    const d = recurringFeeDisplays(facts);
    expect(d.royalty.pct).toBe("8%");
    expect(d.royalty.note).toBeNull();
    // 0 is "explicitly zero", not "not disclosed" — it must show 0%, never a note.
    expect(d.brandFund.pct).toBe("0%");
    expect(d.brandFund.note).toBeNull();
    expect(d.localAd.pct).toBe("0%");
  });

  it("explains a null royalty and flags the purchase-markup model from the brand's own fees (the Maui Wowi case)", () => {
    const facts: FeeFacts = {
      ongoingFees: { royaltyPct: null, brandFundPct: null, localAdPct: 3, flatMonthlyFees: [] },
      hiddenCosts: [
        {
          name: "Advertising Fee on Purchases",
          description: "15% of the purchase price of Maui Wowi Products, Supplies, and Equipment.",
          estimatedAnnualAmount: null,
          source: "Item 6, p.28",
        },
      ],
    };
    const d = recurringFeeDisplays(facts);
    // No bare dash — a real explanation that names the markup mechanism.
    expect(d.royalty.pct).toBeNull();
    expect(d.royalty.note).toMatch(/marked-up product purchases/i);
    expect(d.royalty.note).toMatch(/Items 5/i);
    // Disclosed local-ad % still renders normally.
    expect(d.localAd.pct).toBe("3%");
    expect(d.localAd.note).toBeNull();
  });

  it("gives a neutral royalty note when nothing in the fees suggests a purchase model", () => {
    const facts: FeeFacts = {
      ongoingFees: { royaltyPct: null, brandFundPct: null, localAdPct: null, flatMonthlyFees: [] },
      hiddenCosts: [],
    };
    const d = recurringFeeDisplays(facts);
    expect(d.royalty.pct).toBeNull();
    expect(d.royalty.note).toMatch(/confirm in Items 5/i);
    // Must NOT assert the markup model when there's no evidence for it.
    expect(d.royalty.note).not.toMatch(/marked-up product purchases/i);
    expect(d.brandFund.note).toMatch(/brand\/marketing-fund/i);
    expect(d.localAd.note).toMatch(/local-advertising/i);
  });
});
