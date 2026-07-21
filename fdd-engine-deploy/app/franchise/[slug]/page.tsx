// app/franchise/[slug]/page.tsx — brand detail, revenue-first (Path-A funnel
// destination). SSG for every live slug (this is why the pages exist: fast,
// crawlable, titled). Free tier only — the $199 unlock mints a per-buyer
// report via /api/mint-brand-report and rides the existing checkout pipeline.
//
// P0 (2026-07-18): BrandDetail now takes a server-built TeaserCard, not the
// full card. toTeaserCard() runs HERE (server) and omits the locked values
// (deficit figures, cohort spread, tripwire descriptions) so they can never
// serialize into the client payload. Do not pass the full card/brand to
// BrandDetail; do not widen its props.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listBrands, getBrand, toCard } from "@/lib/brands";
import { auditBrandFacts } from "@/lib/brandFacts";
import { toTeaserCard } from "@/lib/teaserProps";
import BrandDetail from "@/components/BrandDetail";

export const revalidate = 3600;

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000).toLocaleString()}k`;

export async function generateStaticParams() {
  const brands = await listBrands();
  // Build-time consistency gate (single-resolver spec): any brand file that
  // resolves inconsistently FAILS THE BUILD, and the resolved-facts table
  // prints to the build log as a human-scannable snapshot per deploy.
  auditBrandFacts(brands);
  return brands
    .filter((b) => toCard(b).live)
    .map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) return { title: "Franchise not found | Franchise Edge" };
  const card = toCard(brand);
  const cost =
    card.lo != null && card.hi != null ? `${usd(card.lo)}–${usd(card.hi)}` : "cost to open";
  // P1-4: query-matched pattern over the registry — targets "[brand] franchise
  // cost", "[brand] franchise review", "is [brand] a good investment", "[brand] FDD"
  const year = new Date().getFullYear();
  const title = `${brand.brandName} Franchise Review (${year}): Cost, Item 19 Earnings, Fees — from the actual FDD`;
  const description = `Is ${brand.brandName} a good investment? Real cost to open (${cost}), Item 19 earnings, royalty and fee stack, and risk flags — read from the actual ${brand.brandName} FDD, not the sales deck.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
  };
}

export default async function FranchisePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const [{ slug }, { ref }] = await Promise.all([params, searchParams]);
  const brand = await getBrand(slug);
  if (!brand) notFound();

  // Keep the live-gate on the full card (server-side only — never passed down).
  const card = toCard(brand, "revenue");
  if (!card.live) notFound(); // THIN brands have no sellable detail page yet

  const refTag = ref?.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || null;

  // Server-side gating transform: builds the teaser by OMISSION — locked values
  // (fin-condition figures, cohort spread, tripwire text) never leave this file.
  const teaser = toTeaserCard(brand);

  return <BrandDetail teaser={teaser} refTag={refTag} />;
}
