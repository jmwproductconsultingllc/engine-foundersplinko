// app/refunds/opengraph-image.tsx
//
// The card is built from lib/refund.ts like every other refund surface, so the
// window on it moves with the policy. An OG image is the worst possible place
// for a stale guarantee: it is cached on Slack's and Gmail's servers, not ours,
// and a buyer who screenshots a preview saying "30-day" has an offer we then
// have to honor.

import { ogImage } from "@/lib/og";
import { refundsOgSpec, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCopy";
import { REFUND_HEADLINE } from "@/lib/refund";

export const alt = `Franchise Edge — ${REFUND_HEADLINE}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage(refundsOgSpec());
}
