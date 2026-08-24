/**
 * lib/currency.ts — a foreign-denominated FPR, handled honestly.
 *
 * Gorilla Property Services' entire Item 19 is Canadian dollars, and the filing
 * says so: "All dollar amounts are presented in CAD and not USD." The extractor
 * captured that sentence verbatim. Every figure we rendered from it carried a
 * US dollar sign anyway, because nothing read it.
 *
 * WHY THIS MODULE DOES NOT CONVERT BY DEFAULT.
 *
 * Two reasons, and the second is the one that matters.
 *
 * First, a rate is a fact about today, and this codebase ships figures that are
 * read months later. A hardcoded rate is a number that is wrong by an unknown
 * amount at the moment someone relies on it, wearing the same confident
 * formatting as the disclosed figures beside it. We do not ship invented
 * numbers into a six-figure decision — the same rule that stopped a made-up
 * rent floor from shipping two commits ago.
 *
 * Second, and more interesting: the franchisor may be arguing that conversion
 * is the WRONG operation. Gorilla writes that "a Canadian franchisee will
 * charge $250 CAD and a US franchisee will charge $250 USD for the same
 * service" — a parity claim, which says the US revenue line would be
 * numerically similar rather than FX-adjusted. That claim may be right or it
 * may be salesmanship, but it is the buyer's to weigh, not ours to silently
 * overrule with an exchange rate.
 *
 * So: NAME the currency everywhere a figure appears, SURFACE the franchisor's
 * own reasoning, and provide the conversion primitive for when a buyer supplies
 * a rate — the same shape as the rent override, where the buyer brings the
 * local truth and the whole chain recomputes.
 */

import type { ExtractedFDD } from "./schema";

/** ISO code, uppercased, or null when the filing does not say. */
export function resolveCurrency(fdd: ExtractedFDD | null | undefined): string | null {
  const explicit = (fdd?.item19 as { currency?: string | null } | undefined)?.currency;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim().toUpperCase();
  const notes = fdd?.item19?.notes;
  if (typeof notes === "string") {
    const m = notes.match(/\b(?:presented|denominated|reported|expressed)\s+in\s+([A-Z]{3})\b/);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** True when the FPR is denominated in something other than US dollars. */
export function isForeignDenominated(fdd: ExtractedFDD | null | undefined): boolean {
  const c = resolveCurrency(fdd);
  return c != null && c !== "USD";
}

/**
 * The franchisor's own argument for why its foreign figures should read across
 * to a US unit, when it makes one. Quoted, never paraphrased — the buyer is
 * being asked to weigh it, so they get it in the filing's words.
 */
const PARITY_RE =
  /\b(?:parity pricing|substantially similar performance|no material differences|will charge \$?\d[\d,]*\s*(?:CAD|GBP|EUR|AUD)\b)/i;

export function parityClaim(fdd: ExtractedFDD | null | undefined): string | null {
  const notes = fdd?.item19?.notes;
  if (typeof notes !== "string" || !PARITY_RE.test(notes)) return null;
  return notes.trim().slice(0, 300);
}

/**
 * The sentence that has to appear anywhere a figure from a foreign FPR is
 * rendered. Returns null for a US filing so callers can append unconditionally.
 */
export function currencyDisclosure(fdd: ExtractedFDD | null | undefined): string | null {
  const code = resolveCurrency(fdd);
  if (code == null || code === "USD") return null;
  const parity = parityClaim(fdd);
  return (
    `Every figure on this page is denominated in ${code}, exactly as disclosed, with no conversion applied. ` +
    (parity
      ? `The franchisor argues these results read across to a US unit — "${parity}" — which is its claim to defend, not a fact we have checked. `
      : "") +
    `Check the current ${code}/USD rate, and ask the franchisor directly what a US unit bills for the same work.`
  );
}

/**
 * Convert at a rate the BUYER supplied. Never called with a rate this codebase
 * invented. Throws rather than silently returning a wrong number, because a
 * bad rate silently applied is worse than a missing figure.
 */
export function convertAtRate(amount: number, rateToUsd: number): number {
  if (!Number.isFinite(amount)) throw new Error("convertAtRate: amount is not a finite number");
  if (!Number.isFinite(rateToUsd) || rateToUsd <= 0)
    throw new Error("convertAtRate: rate must be a positive, finite number");
  return Math.round(amount * rateToUsd * 100) / 100;
}
