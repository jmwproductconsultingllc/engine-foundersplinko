// fdd-engine-deploy/app/page.tsx — SERVER SHELL for the home page.
//
// This file used to BE the home page and carried "use client". That made it
// structurally impossible to give the site's single most-linked URL a canonical
// tag or real Open Graph metadata, because a client component cannot export
// `metadata`. Every ad, every business card, every share of foundersplinko.com
// landed here, and here was the one page with no canonical.
//
// The fix is the standard split, and it is the same one /playbook already uses:
// a server component owns the metadata and renders the client view. All the
// interactive code moved verbatim to components/HomeView.tsx.

import type { Metadata } from "next";
import HomeView from "@/components/HomeView";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://engine.foundersplinko.com";

const TITLE = "Franchise Edge — know if a franchise will actually make you money";
const DESC =
  "Upload a franchise's FDD and get a plain-English diligence read: real cost to open, Item 19 unit economics, the full fee stack, and what to verify before you sign.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: BASE },
  openGraph: { title: TITLE, description: DESC, url: BASE, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

export default function Page() {
  return <HomeView />;
}
