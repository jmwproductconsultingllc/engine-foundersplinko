// lib/retraction.ts — pulling a brand record, in public.
//
// THE PROBLEM THIS SOLVES
//
// Every figure on a brand page is machine-extracted from a 300-page PDF. The
// extraction is good; it is not perfect. Occasionally a disclosed figure on a
// page will not reconcile against the source document — a royalty read from the
// wrong column, an Item 7 total that doesn't sum, a cohort mislabeled. When we
// find one, the number has to come down. There is no version of this product
// where we knowingly leave up a figure we can't stand behind, because the entire
// premise is that we read the FDD more carefully than the buyer has time to.
//
// WHY VISIBLE AND NAMED, NOT A 404
//
// The obvious implementation is to drop the brand from the store and let the URL
// 404. That is the wrong call for three reasons, and they compound:
//
//   1. Somebody has the link. Brand pages are the SEO product and the ad landing
//      pages — the URL is in Google, in a nurture email, in someone's saved tabs,
//      possibly in a text thread with their spouse about a $250k decision. A 404
//      tells that person the page never existed. It reads as "this outfit is
//      falling apart," which is the opposite of what actually happened.
//
//   2. A buyer who already read the page needs to know. If they took a number
//      off it into a spreadsheet, silence is the one outcome that leaves them
//      worse off than if we'd never published. Naming the retraction is the only
//      version where the person we may have misinformed finds out.
//
//   3. Catching your own error and saying so out loud is the single most
//      credible thing a diligence product can do. Handled quietly it is a cost.
//      Handled in public it is the proof the method works. We are asking people
//      to trust our arithmetic over a franchisor's sales deck — "here is one we
//      got wrong, here is what we did about it" is worth more than any page of
//      claims about rigor.
//
// SO: the URL keeps serving 200 with a page that says we pulled the record and
// why. It leaves the library, the sitemap, the brand count, the comparison
// pages, the fit emails and the risk benchmarks — automatically, because all of
// those already gate on `live`, and a retraction forces `live` false at the
// single resolver. The page itself is noindex: we are not asking Google to rank
// a retraction, only to stop asking us for a page that no longer has content.
//
// WHAT A RETRACTION IS NOT
//
// This is not the mechanism for a brand we simply haven't parsed well (that's
// grade: "THIN"), for a stale FDD year, or for a brand we've decided not to
// cover. It is specifically: a figure we published that does not reconcile
// against the source document. Keep it that way — the notice derives its whole
// force from being rare and specific. A retraction page that could mean five
// different things means nothing.
//
// CLIENT-SAFE. Pure types and string helpers, no fs, no imports.

/**
 * The record of a pull. Stored on the brand JSON itself rather than in a side
 * list, because a side list is a second source of truth that will eventually
 * disagree with the store — and because the brand file is what gets copied,
 * re-generated and diffed, so the retraction has to travel with it.
 */
export interface Retraction {
  /** ISO date (YYYY-MM-DD is fine). Shown to the reader — a retraction with no
   *  date is a retraction the reader can't place against when they read it. */
  retractedAt: string;
  /** WHICH figure, in buyer language. e.g. "the disclosed royalty rate",
   *  "the Item 7 total investment range". Rendered into the notice verbatim. */
  figure: string;
  /** Optional one line of specificity: what didn't reconcile. Kept short and
   *  factual. NEVER speculate about the franchisor here — the failure is ours
   *  until proven otherwise, and saying so is both true and safer. */
  detail?: string;
  /** Internal note, NEVER rendered. For us, in the diff, six months later. */
  internal?: string;
}

/** Minimal structural shape — avoids importing BrandRecord (circular). */
type MaybeRetracted = { retraction?: Retraction | null } | null | undefined;

export function retractionOf(b: MaybeRetracted): Retraction | null {
  const r = b?.retraction;
  if (!r || typeof r !== "object") return null;
  // A half-written retraction must not half-pull a brand. Either it has the two
  // fields the notice needs, or it isn't a retraction and the brand stays live.
  if (!r.retractedAt || !r.figure) return null;
  return r;
}

export function isRetracted(b: MaybeRetracted): boolean {
  return retractionOf(b) !== null;
}

/** Headline. Deliberately first-person and unhedged — "under review" is the
 *  weasel version and it is the one thing we agreed not to ship. */
export const RETRACTION_HEADLINE = "We pulled this record";

/** Long date for the notice, from a plain ISO string. Built without Date
 *  parsing of ambiguous formats: "2026-07-28" parsed as local time silently
 *  becomes the 27th in every timezone west of UTC. */
export function formatRetractionDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const month = MONTHS[Number(m[2]) - 1] ?? "";
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : iso;
}

/**
 * The buyer-facing copy, built in ONE place so the brand page, any future email
 * and any status list all say the same thing. Returns paragraphs rather than
 * JSX so it can also be rendered into an email body without being retyped.
 */
export function retractionCopy(
  brandName: string,
  r: Retraction,
): { headline: string; dateLine: string; paragraphs: string[] } {
  // The detail is its OWN sentence, not an em-dash aside inside the first one.
  // Inlined it reads "because the royalty rate — the record shows 30%; the FDD
  // doesn't support it did not reconcile against…" — a dangling clause on the
  // one page that has to sound like we're in control of our own facts.
  const detail = r.detail ? ` Specifically: ${r.detail.replace(/\.\s*$/, "")}.` : "";
  return {
    headline: RETRACTION_HEADLINE,
    dateLine: `${brandName} · pulled ${formatRetractionDate(r.retractedAt)}`,
    paragraphs: [
      `We took the ${brandName} page down because ${r.figure} did not reconcile against the franchisor's Franchise Disclosure Document.${detail} Every figure we publish is read out of the FDD itself, and when one of them doesn't survive a second read, the honest move is to pull the whole record rather than quietly edit the number and hope nobody noticed.`,
      `This is our error, not the franchisor's. Nothing here should be read as a claim about ${brandName} as a business or about the accuracy of what ${brandName} filed.`,
      `The record goes back up once the figure is re-read against the source document and checks out — usually a few days. If you already bought a report on ${brandName}, email me and I'll refund it and send you the corrected version when it's ready.`,
    ],
  };
}
