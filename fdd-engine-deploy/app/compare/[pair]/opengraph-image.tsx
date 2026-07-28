// app/compare/[pair]/opengraph-image.tsx — the head-to-head card.
//
// NO generateStaticParams HERE, DELIBERATELY. The page SSGs every same-vertical
// pair, which is already in the hundreds and grows quadratically with the
// library. Pre-rendering a PNG for each one would add minutes to every deploy
// for images that mostly never get fetched. These render on first request and
// Vercel caches them at the edge, which is the right shape for a long tail.
//
// The card carries no figures — just the two names. That isn't squeamishness:
// a comparison's whole value is the shared rows, and two numbers ripped out of
// a fifteen-row table and put side by side in a chat preview is the exact
// "crowned winner" framing the compare page was built to avoid.

import { ogImage } from "@/lib/og";
import { compareOgSpec, fallbackOgSpec, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCopy";
import { parsePair } from "@/lib/comparePair";
import { listBrands, retractionOf } from "@/lib/brands";

export const alt = "Two franchises compared on the same rows, from each brand's actual FDD";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  const parsed = parsePair(pair);
  if (!parsed) return ogImage(fallbackOgSpec());

  const brands = await listBrands();
  const A = brands.find((b) => b.slug === parsed[0]);
  const B = brands.find((b) => b.slug === parsed[1]);

  // A retracted side redirects the page to the surviving brand, so naming the
  // pulled brand here would describe a comparison that no longer exists.
  if (!A || !B || retractionOf(A) || retractionOf(B)) return ogImage(fallbackOgSpec());

  return ogImage(compareOgSpec(A.brandName, B.brandName));
}
