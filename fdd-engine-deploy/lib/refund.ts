// lib/refund.ts — the refund policy, in ONE place.
//
// WHY THIS IS A MODULE AND NOT FOUR STRINGS
//
// A guarantee that appears next to the price on four surfaces is a guarantee
// that will eventually say three different things. We already lived this with
// the brand count: /sample said "80+", /playbook said "80+", the nurture email
// said "70+" — same funnel, same week, two different claims. A wrong brand
// count is embarrassing. A refund window that reads "7 days" on the brand page
// and "30 days" on the sample page is a chargeback you lose, because the buyer
// screenshots whichever one is longer and Stripe reads it as the offer.
//
// So: the window is a number here and nowhere else, and lib/refund.test.ts
// fails the build if any component hardcodes a competing one.
//
// WHY 7 DAYS, NO QUESTIONS
//
// The report is consumed in one sitting. A 30-day window on a fully-consumed
// digital good is a free trial with extra steps, and it lands exactly where we
// can least afford it — revenue has to be on the board and *stay* there. Seven
// days is long enough that nobody feels rushed, short enough that the window
// closes before the report stops being fresh.
//
// The "no questions, no form" part is the load-bearing half. A guarantee with a
// process attached reads as a guarantee you intend to make hard to claim, which
// costs more conversion than the refunds themselves ever will. Honoring it is a
// manual refund in the Stripe dashboard — deliberately not automated, because
// at this volume a human reply is cheaper to build and better for the brand
// than a self-serve flow.
//
// CLIENT-SAFE. Pure constants, zero imports, same discipline as brandName.ts.

/** The window, in days. Change it HERE and every surface moves together. */
export const REFUND_DAYS = 7;

/** Where a refund request goes. A person, not a ticket queue. */
export const REFUND_EMAIL = "jason@foundersplinko.com";

/** Canonical full-policy page. */
export const REFUND_HREF = "/refunds";

/** Bold lead-in. Used as the headline of the note and of the policy page. */
export const REFUND_HEADLINE = `${REFUND_DAYS}-day money-back guarantee`;

/**
 * The one-liner for tight spots (sticky bars, teaser CTAs) where a full
 * sentence would wrap onto three lines on a phone.
 */
export const REFUND_SHORT = `${REFUND_DAYS}-day refund, no questions`;

/**
 * The standard form — what sits under the price on a page with room. Written to
 * be legible as a promise in one read: the claim, the window, the mechanism.
 */
export const REFUND_SENTENCE = `Not useful? Email within ${REFUND_DAYS} days and I'll refund it — no questions, no form.`;

/**
 * The full policy, for /refunds and for anywhere the terms need to be quoted
 * verbatim. Kept as data rather than JSX so it can be rendered into a page, an
 * email, or a Stripe description without being retyped.
 */
export const REFUND_POLICY: { heading: string; body: string }[] = [
  {
    heading: "The guarantee",
    body: `If the report isn't useful to you, email ${REFUND_EMAIL} within ${REFUND_DAYS} days of purchase and I'll refund it in full. You don't have to explain why, and there is no form to fill in.`,
  },
  {
    heading: "How long it takes",
    body: "I process refunds manually, usually the same day and always within two business days. The money goes back to the card you paid with; your bank decides how quickly it posts, which is typically five to ten days.",
  },
  {
    heading: "You keep the report",
    body: "I don't revoke access to a refunded report. If a number in it was wrong, you may well need it to show someone — pulling it out from under you would be the opposite of the point.",
  },
  {
    heading: "If a figure doesn't match the FDD",
    body: `That's a different and more serious problem than "not useful," and the ${REFUND_DAYS}-day window doesn't apply to it. Tell me which figure and which page, whenever you find it, and I'll refund you and correct the record. Where a disclosed figure can't be reconciled against the source document, the brand comes out of the library until it can.`,
  },
  {
    heading: "What this doesn't cover",
    body: "This is a refund policy, not a warranty on the underlying disclosure. The report reads what the franchisor filed. If the franchisor's own numbers turn out to be optimistic, that's what the report is for — it isn't a defect in the report.",
  },
];
