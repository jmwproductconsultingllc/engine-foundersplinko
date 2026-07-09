/**
 * lib/fees.ts
 * Display logic for the recurring-fee lines (royalty / brand fund / local ad).
 *
 * Why this exists: a bare "—" on the Royalty line reads as "this tool missed the
 * most important fee," when in reality some brands (e.g. Maui Wowi) take NO
 * percentage royalty and instead monetize through a markup on required product
 * purchases. The FDD is right; the old rendering just didn't say so. This turns
 * an empty slot into a plain-language explanation, and — only from the brand's
 * OWN disclosed fee text — flags when the model looks purchase-based.
 *
 * This is pure, deterministic display logic (no AI, no I/O) so it can be pinned
 * by a golden test the same way scoring/underwriting are. The JSX renders what
 * this returns and makes no decisions of its own.
 */

import type { ExtractedFDD } from "./schema";

export interface FeeDisplay {
  /** percentage text when the FDD discloses a rate, e.g. "8%" or "0%"; null when not disclosed as a percentage */
  pct: string | null;
  /** plain-language explanation shown when pct is null, so the report never renders a bare dash on a key fee */
  note: string | null;
}

export interface RecurringFeeDisplays {
  royalty: FeeDisplay;
  brandFund: FeeDisplay;
  localAd: FeeDisplay;
}

type FeeFacts = Pick<ExtractedFDD, "ongoingFees" | "hiddenCosts">;

/**
 * Does the disclosed fee set point to a purchase-/product-markup model rather
 * than a percentage-of-sales royalty? Detected ONLY from the brand's own
 * disclosed fee names/descriptions — we never infer a number, and the note that
 * uses this is hedged ("appears to ... confirm in Items 5–6").
 */
function hasPurchaseBasedFee(x: FeeFacts): boolean {
  const hay: string[] = [];
  for (const f of x.ongoingFees?.flatMonthlyFees ?? []) hay.push(f.name ?? "");
  for (const h of x.hiddenCosts ?? []) {
    hay.push(h.name ?? "");
    hay.push(h.description ?? "");
  }
  return hay.some((s) => /(purchase|markup|wholesale|product\s+(?:price|cost))/i.test(s));
}

/**
 * R2 fix — the corpus stores percentages in two conventions: fractions
 * (0.07 → 7%) and whole percents (7.5 → 7.5%). No real franchise fee is below
 * 1%, so v<1 is safely a fraction. Shared by the report UI and the brand pages
 * (lib/brands.ts imports this) so both render "7%", never "0.07%".
 */
export function normalizeRoyaltyPct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round((v < 1 ? v * 100 : v) * 100) / 100;
}

/** Disclosed percentage → a clean "{n}%". 0 is a real disclosure ("0%"), not absence. */
function asPct(pct: number | null | undefined): FeeDisplay | null {
  const n = normalizeRoyaltyPct(pct);
  if (n == null) return null;
  return { pct: `${n}%`, note: null };
}

export function recurringFeeDisplays(x: FeeFacts): RecurringFeeDisplays {
  const f = x.ongoingFees;
  const purchaseModel = hasPurchaseBasedFee(x);

  const royalty: FeeDisplay =
    asPct(f?.royaltyPct) ?? {
      pct: null,
      note: purchaseModel
        ? "No percentage royalty disclosed — this brand appears to monetize through marked-up product purchases instead (see the purchase-based fee below). Confirm in Items 5–6."
        : "No percentage royalty disclosed — confirm in Items 5–6 how this brand charges (some take a markup on required purchases rather than a sales royalty).",
    };

  const brandFund: FeeDisplay =
    asPct(f?.brandFundPct) ?? {
      pct: null,
      note: "No separate brand/marketing-fund percentage disclosed.",
    };

  const localAd: FeeDisplay =
    asPct(f?.localAdPct) ?? {
      pct: null,
      note: "No local-advertising requirement disclosed.",
    };

  return { royalty, brandFund, localAd };
}
