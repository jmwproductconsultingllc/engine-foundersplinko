// app/franchise/[slug]/opengraph-image.tsx — the card that matters.
//
// Brand pages are the links that actually get shared: pasted into a group chat
// with "thoughts on this one?", forwarded by a broker, dropped in a Reddit
// thread. This is the surface where an unfurled cost range and an honest Item 19
// line does more selling than the homepage ever will.
//
// THREE THINGS THIS FILE IS CAREFUL ABOUT
//
// 1. Retracted brands. The page still resolves (200, retraction notice, no
//    figures) because the retraction design says a pulled record explains
//    itself rather than 404ing. So this route still gets fetched for those
//    slugs, and it must NOT render the figure card. brandOgSpec() throws if you
//    hand it a retracted brand; the branch below is what keeps that throw
//    theoretical.
//
// 2. Missing slugs. A dead link that renders a broken image looks worse than
//    one that renders a plain product card. fallbackOgSpec() covers it — no
//    figures, no guesses about a brand we don't have.
//
// 3. Nothing beyond BrandCard reaches the spec. toCard() is the same resolver
//    the public page uses, which is exactly the point: if a value isn't already
//    public on the free page, it isn't on the card either. Do not reach past
//    toCard() into the raw record here.

import { ogImage } from "@/lib/og";
import {
  brandOgSpec,
  retractedOgSpec,
  fallbackOgSpec,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "@/lib/ogCopy";
import { listBrands, getBrand, toCard, retractionOf } from "@/lib/brands";

export const alt = "Franchise cost to open, Item 19 earnings and what to verify";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Same admission rule as the page's generateStaticParams: live OR retracted. A
// retraction forces live=false at the resolver, so filtering on live alone
// would leave pulled slugs rendering on demand instead of at build time — and
// the build is where we want the retracted branch exercised.
export async function generateStaticParams() {
  const brands = await listBrands();
  return brands
    .filter((b) => toCard(b).live || retractionOf(b) !== null)
    .map((b) => ({ slug: b.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) return ogImage(fallbackOgSpec());

  if (retractionOf(brand)) return ogImage(retractedOgSpec(brand.brandName));

  return ogImage(brandOgSpec(toCard(brand)));
}
