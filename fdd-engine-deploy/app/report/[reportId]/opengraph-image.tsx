// app/report/[reportId]/opengraph-image.tsx
//
// THIS FILE EXISTS TO BE EXPLICIT ABOUT SAYING NOTHING.
//
// The root card at app/opengraph-image.tsx would already be inherited here, and
// it is also figure-free, so strictly speaking this file changes no bytes that
// matter today. It is here anyway, because the next person to touch this route
// should have to read this comment before they add a brand name "just for
// context" to a buyer's report card.
//
// The threat is concrete. A buyer forwards /report/<id> to their spouse, their
// accountant, a franchise broker. Every one of those clients fetches this image
// with no session, from an IP we've never seen, and caches the result on
// infrastructure we don't control, for as long as they feel like. There is no
// paid gate on an OG fetch and no way to un-cache one. So the card is built by
// reportOgSpec(), which takes no arguments — it is structurally incapable of
// carrying anything about the report, including which brand it is for.
//
// Note there is no params argument below. That is the point; don't add one.

import { ogImage } from "@/lib/og";
import { reportOgSpec, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCopy";

export const alt = "A private Franchise Edge diligence report";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage(reportOgSpec());
}
