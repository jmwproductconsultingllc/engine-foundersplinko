// app/franchise/[slug]/page.tsx — brand detail, revenue-first (Path-A funnel
// destination). SSG for every live slug (this is why the pages exist: fast,
// crawlable, titled). Free tier only — the $199 unlock mints a per-buyer
// report via /api/mint-brand-report and rides the existing checkout pipeline.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listBrands, getBrand, toCard, pickHeroCohort } from "@/lib/brands";
import BrandDetail from "@/components/BrandDetail";

export const revalidate = 3600;

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000).toLocaleString()}k`;

export async function generateStaticParams() {
  const brands = await listBrands();
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

  const card = toCard(brand, "revenue");
  if (!card.live) notFound(); // THIN brands have no sellable detail page yet

  const refTag = ref?.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || null;

  // The detail hero is revenue-first (SEO honesty standard). We also compute
  // the profit pick so the page can show "what owners keep" as a secondary
  // line when the FDD discloses it — labeled from its own revenueType + caveat.
  const profitHero = pickHeroCohort(brand.result.extracted.item19?.cohorts, "profit");
  const profitLine =
    profitHero && profitHero.kind === "profit"
      ? { monthly: profitHero.monthly, caveat: profitHero.caveat, sampleSize: profitHero.sampleSize }
      : null;

  return (
    <BrandDetail
      card={card}
      profitLine={profitLine}
      cohortCount={brand.result.extracted.item19?.cohorts?.length ?? 0}
      refTag={refTag}
    />
  );
}
