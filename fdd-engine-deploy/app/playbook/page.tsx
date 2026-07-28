// fdd-engine-deploy/app/playbook/page.tsx
//
// The standalone PLAYBOOK landing page.
//
// Until now the Playbook only existed as an email attachment reachable through a
// capture surface embedded in a brand page — which meant it could not be linked
// in a DM, put on a business card, sent to a partner, run as a paid destination,
// or indexed. It is the top of the funnel with no front door.
//
// SERVER COMPONENT ON PURPOSE: it resolves PLAYBOOK_URL (a server-only env var,
// deliberately NOT NEXT_PUBLIC_) via lib/playbook.ts and passes the resolved
// string down as a prop. The nurture email reads the same resolver, so the page
// and the email physically cannot point at different PDFs — the drift class that
// bites the day a v2 file lands under a new name.

import type { Metadata } from "next";
import PlaybookLanding from "@/components/PlaybookLanding";
import { playbookUrl } from "@/lib/playbook";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://engine.foundersplinko.com";

const TITLE = "The Franchise Buyer's Playbook — free guide | Franchise Edge";
const DESC =
  "A plain-English guide to buying a franchise: the 90-day checklist, the real cost to open, how to read Item 19 honestly, the full fee stack, and the questions to ask a franchisee before you sign.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${BASE}/playbook` },
  openGraph: { title: TITLE, description: DESC, url: `${BASE}/playbook`, type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

export default function PlaybookPage() {
  return <PlaybookLanding downloadUrl={playbookUrl()} />;
}
