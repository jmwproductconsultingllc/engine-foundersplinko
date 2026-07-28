// app/opengraph-image.tsx — the site-wide default preview card.
//
// Metadata files INHERIT down the tree, so this one file is what any route
// without its own opengraph-image.tsx unfurls as. That inheritance is a safety
// property, not just convenience: a route added tomorrow gets a correct,
// figure-free card automatically instead of reverting to a bare URL. Routes that
// need something more specific override it in their own segment.

import { ogImage } from "@/lib/og";
import { homeOgSpec, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCopy";
import { liveBrandCount } from "@/lib/brandCount";

export const alt = "Franchise Edge — know if a franchise will actually make you money";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  // Same resolver the page copy uses (lib/brandCount.ts), so the card cannot
  // claim a library size the site disagrees with — the exact drift that had
  // /sample saying "80+" while the nurture email said "70+".
  return ogImage(homeOgSpec(await liveBrandCount()));
}
