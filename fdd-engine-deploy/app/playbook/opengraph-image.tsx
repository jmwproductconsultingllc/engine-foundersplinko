// app/playbook/opengraph-image.tsx — the free guide's preview card.
//
// This is the most-shared link we have that isn't a brand page: it's the one
// someone forwards to a friend who's "thinking about buying a franchise." It
// unfurling as a bare URL is the version of that message that doesn't get
// clicked.

import { ogImage } from "@/lib/og";
import { playbookOgSpec, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCopy";

export const alt = "The Franchise Buyer's Playbook — a free guide from Franchise Edge";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage(playbookOgSpec());
}
