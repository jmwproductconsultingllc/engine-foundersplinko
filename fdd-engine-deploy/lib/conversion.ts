/**
 * lib/conversion.ts — FE-141 · the second buyer this filing is written for.
 *
 * Some FDDs describe two different purchases. A STARTUP buyer opens a new
 * location. A CONVERSION buyer brings an existing independent business under
 * the brand, and the franchisor charges them differently for it. Two Maids
 * prints both totals in Item 7, printed p. 21:
 *
 *     Conversion Discount                        $0 – ($10,000)
 *     Total Estimated Initial Investment         $93,440 – $149,890
 *     Total Estimated Initial Investment
 *     (Conversion)                               $93,440 – $139,890
 *
 * Our report surfaced the first total and neither of the other two lines, so a
 * converting operator — the buyer this brand actively recruits — read a number
 * built for somebody else.
 *
 * NOT AN EDGE CASE. Measured across eleven filings on hand: two carry a
 * conversion path, and they take different shapes.
 *
 *   Two Maids   a COMPUTED discount on the Initial Territory Fee — "reduced by
 *               an amount equal to 10% of the total Gross Revenue for the
 *               previous year for your existing business, but in no event will
 *               the discount exceed $10,000." Your number depends on your old
 *               business. You would need roughly $100,000 of prior-year revenue
 *               to reach the cap.
 *   Ellie       a FLAT replacement fee — "the Initial Franchise Fee will be
 *               reduced to $20,000 per converting clinic" — plus an entirely
 *               separate Item 7 investment table for conversions.
 *
 * WHY THIS IS NOT SIMPLY A CHEAPER DEAL, and why nothing here is applied by
 * default. Two Maids grants the discount "in our sole discretion". Ellie
 * decides eligibility "based on various factors" AND excludes conversion
 * buyers from a separate discount program available to startups. So converting
 * can cost less, and it can also cost more than the headline suggests.
 *
 * Crediting a discretionary maximum to a buyer who has not been granted it is
 * the exact mirror of FE-142, where a discretionary ceiling was charged as a
 * certainty. The rule that fixed that one applies here with the sign flipped:
 * the pro forma runs on the standard total, the conversion path is disclosed
 * beside it, and the buyer is told what determines their own number.
 */

import type { ExtractedFDD } from "./schema";
import { range } from "./range";

export interface ConversionPath {
  /** the standard estimated initial investment, low and high */
  standard: [number, number] | null;
  /** the franchisor's own conversion total, when it publishes one */
  conversion: [number, number] | null;
  /** the disclosed discount magnitudes, as positive dollars */
  discount: [number, number] | null;
  /** the franchisor decides case by case */
  discretionary: boolean;
  /** how the number is determined, in the filing's words */
  howDetermined: string | null;
  /** who qualifies, in the filing's words */
  eligibility: string | null;
  sourcePage: string | null;
  /** the line the report shows */
  headline: string;
  /** what the buyer should ask, because we cannot compute their figure */
  whatToAsk: string;
}

const DISCRETION_RE =
  /\b(?:sole discretion|our discretion|we (?:may|will determine)|based on various factors|qualifies? as)\b/i;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
// Joined by range() from lib/range.ts, never by hand. A spaced dash is where a
// figure breaks in half on a phone, and there is a source lint that enforces it
// — which caught this file's first draft.
const moneyRange = (r: [number, number]) => (r[0] === r[1] ? money(r[0]) : range(money(r[0]), money(r[1])));

export function conversionPath(fdd: ExtractedFDD | null | undefined): ConversionPath | null {
  const i17 = fdd?.item17;
  const c = (i17 as { conversion?: Record<string, unknown> } | undefined)?.conversion;
  if (!c) return null;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? Math.abs(v) : null;
  const pair = (a: unknown, b: unknown): [number, number] | null => {
    const lo = num(a), hi = num(b);
    if (lo == null && hi == null) return null;
    const l = lo ?? (hi as number), h = hi ?? (lo as number);
    return [Math.min(l, h), Math.max(l, h)];
  };

  const standard = pair(i17?.initialInvestmentLow, i17?.initialInvestmentHigh);
  const conversion = pair(c.totalLow, c.totalHigh);
  const discount = pair(c.discountLow, c.discountHigh);
  if (!conversion && !discount) return null;

  const howDetermined = typeof c.howDetermined === "string" ? c.howDetermined.trim() || null : null;
  const eligibility = typeof c.eligibility === "string" ? c.eligibility.trim() || null : null;
  const discretionary =
    c.discretionary === true ||
    DISCRETION_RE.test(`${howDetermined ?? ""} ${eligibility ?? ""}`);

  const parts: string[] = [];
  if (standard && conversion) {
    parts.push(
      `This filing prices two different purchases. Opening new, the estimated initial investment is ${moneyRange(standard)}. Converting an existing business, the franchisor discloses ${moneyRange(conversion)}.`,
    );
  } else if (conversion) {
    parts.push(`Converting an existing business, the franchisor discloses an estimated initial investment of ${moneyRange(conversion)}.`);
  }
  if (discount) {
    parts.push(
      discount[0] === discount[1]
        ? `The disclosed conversion credit is ${money(discount[0])}.`
        : `The disclosed conversion credit runs ${moneyRange(discount)} — and ${money(discount[0])} is one of the disclosed outcomes.`,
    );
  }
  if (discretionary) {
    parts.push(
      "The franchisor decides who qualifies and by how much. Nothing here is applied to the figures above, because a credit granted at the franchisor's discretion is not a credit you have.",
    );
  }
  if (howDetermined) parts.push(`How it is set, in the filing's words: "${howDetermined}"`);

  return {
    standard,
    conversion,
    discount,
    discretionary,
    howDetermined,
    eligibility,
    sourcePage: typeof c.sourcePage === "string" ? c.sourcePage : (i17?.sourcePage ?? null),
    headline: parts.join(" "),
    whatToAsk: discretionary
      ? "Ask, in writing and before you sign: do I qualify as a conversion, what exactly is my credit, and what did you grant the last three conversions? A discretionary number is a negotiation, and it is the cheapest one you will have with this franchisor."
      : "Ask the franchisor to confirm your conversion figure in writing before you sign, and to state which Item 7 lines it changes.",
  };
}
