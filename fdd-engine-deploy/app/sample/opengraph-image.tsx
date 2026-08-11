// app/sample/opengraph-image.tsx
//
// No figures from the sample report on this card, even though every number in
// it is fictional. "Stonecrop Bowls does $41k/mo" unfurled in a group chat with no
// page around it to say the brand is invented is a claim we'd have to walk
// back — the /sample page labels the fixture twice above the fold precisely
// because that labeling is load-bearing, and a preview card cannot carry it.

import { ogImage } from "@/lib/og";
import { sampleOgSpec, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCopy";

export const alt = "A complete Franchise Edge diligence report, end to end";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage(sampleOgSpec());
}
