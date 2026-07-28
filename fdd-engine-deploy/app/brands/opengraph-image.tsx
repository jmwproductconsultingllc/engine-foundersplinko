// app/brands/opengraph-image.tsx — the library's preview card.

import { ogImage } from "@/lib/og";
import { libraryOgSpec, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCopy";
import { liveBrandCount } from "@/lib/brandCount";
import { VERTICAL_ORDER } from "@/lib/brands";

export const alt = "The Franchise Edge diligence library — every franchise, read by AI";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  // Both numbers are derived, never typed: the brand count from the store and
  // the vertical count from VERTICAL_ORDER — the same array that builds the
  // rows. Adding a vertical updates the card with no edit here.
  return ogImage(libraryOgSpec(await liveBrandCount(), VERTICAL_ORDER.length));
}
