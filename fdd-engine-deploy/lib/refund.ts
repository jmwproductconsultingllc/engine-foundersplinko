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
// WHY IT NO LONGER SAYS "NOT USEFUL?" (Jul 28)
//
// It used to open "Not useful? Email within 7 days…". That framing was wrong on
// the facts: the report has been validated in market with SMEs and consumers,
// and it IS useful. Naming a failure mode that isn't real costs twice — it
// concedes a weakness we don't have, and it invites the buyer to evaluate the
// whole report as a yes/no instead of on the one thing they actually came for.
//
// The real failure mode is narrower and far more valuable: the report MISSED
// something this particular buyer needed. Naming that changes what comes back
// in the reply. "It wasn't useful" is unactionable. "There was nothing on
// multi-unit development terms" is a build ticket.
//
// Hence REFUND_ASK. The refund stays unconditional — the ask sits AFTER the
// promise and is explicitly decoupled from it, because a guarantee that reads
// as "tell me why and then I'll consider it" is not the guarantee we approved.
//
// WHY THE ASK IS FOUR WORDS (Jason, Jul 28: "just tell us what is missing")
//
// The first draft was "Tell me what it missed and that's what I build next —
// the refund doesn't depend on it." Accurate, and too long to be an
// instruction. An ask a buyer has to parse is an ask a buyer skips. The
// imperative comes first, in the plainest words available, and the reasoning
// that used to be inline moved to the /refunds section where there is room for
// it. "What's missing" also reads forward — it invites the thing they still
// need, not a verdict on what they already read.
//
// PLACEMENT RULE, and it matters: the ask does NOT go next to the price.
// Pre-purchase, "tell us what's missing" primes a buyer to expect a miss. It
// belongs on /refunds and at the foot of a report someone has already read.
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
export const REFUND_SENTENCE = `If this report missed something you needed, email within ${REFUND_DAYS} days and I'll refund it — no questions, no form.`;

/**
 * The follow-on ask. Post-purchase surfaces only — never next to the price.
 *
 * A refund request is the single highest-signal message that reaches the inbox:
 * someone paid, read the whole thing, and can name the gap. Losing that to a
 * silent Stripe refund is the expensive part of a refund, not the $199.
 *
 * The last clause is not decoration. Without it the ask reads as a condition,
 * and a conditional guarantee is worth less than no guarantee. It is the one
 * thing that may not be cut for brevity.
 */
export const REFUND_ASK = `Tell us what's missing — that's what gets built next. It doesn't affect the refund.`;

/**
 * The full policy, for /refunds and for anywhere the terms need to be quoted
 * verbatim. Kept as data rather than JSX so it can be rendered into a page, an
 * email, or a Stripe description without being retyped.
 */
export const REFUND_POLICY: { heading: string; body: string }[] = [
  {
    heading: "The guarantee",
    body: `If this report missed something you needed, email ${REFUND_EMAIL} within ${REFUND_DAYS} days of purchase and I'll refund it in full. You don't have to explain why, and there is no form to fill in.`,
  },
  {
    heading: "How long it takes",
    body: "I process refunds manually, usually the same day and always within two business days. The money goes back to the card you paid with; your bank decides how quickly it posts, which is typically five to ten days.",
  },
  {
    heading: "Tell us what's missing",
    body: `This is a request, not a condition — the refund is already yours. ${REFUND_ASK} Be specific if you can: "there was nothing on multi-unit development terms" is worth more to me than the sale was, because it tells me what the next version of the report has to cover. You'll hear from me when it does.`,
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
