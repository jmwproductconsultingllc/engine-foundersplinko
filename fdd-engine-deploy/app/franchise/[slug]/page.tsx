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
import { listBrands, getBrand, toCard, retractionOf } from "@/lib/brands";
import { auditBrandFacts } from "@/lib/brandFacts";
import { toTeaserCard } from "@/lib/teaserProps";
import { computeRiskBenchmarks, benchmarkFor } from "@/lib/riskBenchmarks";
import BrandDetail from "@/components/BrandDetail";
import RetractionNotice from "@/components/RetractionNotice";
// Server-only: glassGate pulls the adapter and the whole arithmetic graph.
// It is imported HERE, in a server component, and never from components/ —
// THE SEAM LINT (lib/glassSeam.test.ts) fails the build if that ever inverts.
import { glassDecision, parseGlassOverride } from "@/lib/glassGate";
import ReportGlass from "@/components/ReportGlass";

export const revalidate = 3600;

// SELF-REFERENCING CANONICAL. Brand pages are the SEO product — they are also
// the URLs that pick up ?ref= and ?utm_* from every ad, email and partner link,
// and Next serves identical HTML for all of them. 80 live brand pages with no
// canonical means 80 pages splitting their own ranking signal across however
// many tagged variants get crawled.
const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://engine.foundersplinko.com";

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000).toLocaleString()}k`;

export async function generateStaticParams() {
  const brands = await listBrands();
  // Build-time consistency gate (single-resolver spec): any brand file that
  // resolves inconsistently FAILS THE BUILD, and the resolved-facts table
  // prints to the build log as a human-scannable snapshot per deploy.
  auditBrandFacts(brands);
  // live OR retracted. A retraction forces live=false at the resolver (that's
  // how it disappears from the grid, the sitemap and the count in one move) —
  // which means a `.filter(live)` here would stop generating the page entirely
  // and the URL would 404. That is precisely the outcome the retraction design
  // exists to prevent, so the pulled slugs are re-admitted explicitly.
  return brands
    .filter((b) => toCard(b).live || retractionOf(b) !== null)
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

  // A retracted record must not keep advertising cost figures in the SERP
  // snippet — that string outlives the page in Google's index for days. noindex
  // asks Google to stop serving it; follow stays on so the exits still pass
  // equity. Canonical is dropped: there is no content here to be canonical for.
  const pulled = retractionOf(brand);
  if (pulled) {
    return {
      title: `${brand.brandName} — record retracted | Franchise Edge`,
      description: `We pulled the ${brand.brandName} record because a disclosed figure didn't reconcile against the source FDD. It goes back up once it does.`,
      robots: { index: false, follow: true },
    };
  }

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
    alternates: { canonical: `${BASE}/franchise/${slug}` },
    openGraph: { title, description, url: `${BASE}/franchise/${slug}`, type: "article" },
  };
}

export default async function FranchisePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string; v?: string }>;
}) {
  const [{ slug }, { ref, v }] = await Promise.all([params, searchParams]);
  const brand = await getBrand(slug);
  if (!brand) notFound();

  // RETRACTION CHECK GOES FIRST, ahead of the live gate — a retracted brand is
  // !live by construction, so any ordering that reaches notFound() first turns
  // the visible retraction back into a 404.
  const pulled = retractionOf(brand);
  if (pulled) {
    // Only the name and the retraction cross this boundary. No card, no teaser,
    // no figures: we can't currently stand behind them, so they don't render.
    return <RetractionNotice brandName={brand.brandName} retraction={pulled} />;
  }

  // Keep the live-gate on the full card (server-side only — never passed down).
  const card = toCard(brand, "revenue");
  if (!card.live) notFound(); // THIN brands have no sellable detail page yet

  const refTag = ref?.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || null;

  /* ---------- GLASS MODE ----------
     Same URL, deliberately. This is where every ad, email and partner link
     already points, it carries the self-referencing canonical above, and a
     /franchise/[slug]/glass would split ranking signal and then receive no
     traffic. Two page types on one URL; rollback is GLASS_ENABLED, not a
     revert.

     Placed AFTER the retraction check and the live gate, and that order is
     load-bearing. A retracted brand must keep showing its retraction, and a
     THIN brand must keep 404ing — glass mode is a better page for a brand we
     can stand behind, not a way to publish one we cannot. Every path out of
     glassDecision() that is not "ok" falls through to the teaser below, which
     is a working product. */
  const decision = glassDecision(brand, parseGlassOverride(v));
  if (decision.shell) {
    return (
      <ReportGlass
        shell={decision.shell}
        refTag={refTag}
        // Byte-identical to BrandDetail's mintHref. Both pages must land on the
        // same endpoint with the same params or first-touch attribution splits
        // between the two variants, and the before/after read glass mode exists
        // to produce is exactly that comparison.
        unlockHref={`/api/mint-brand-report?slug=${brand.slug}${refTag ? `&ref=${refTag}` : ""}`}
      />
    );
  }

  // Server-side gating transform: builds the teaser by OMISSION — locked values
  // (fin-condition figures, cohort spread, tripwire text) never leave this file.
  const teaser = toTeaserCard(brand);

  // Risk Reframe — corpus benchmark for this brand's tier + vertical (server-side).
  const benchmarks = computeRiskBenchmarks(await listBrands());
  const tier = card.risk === "High" || card.risk === "Medium" || card.risk === "Low" ? card.risk : null;
  const benchmark = tier ? benchmarkFor(tier, card.vertical, benchmarks) : null;

  return (
    <BrandDetail
      teaser={teaser}
      refTag={refTag}
      benchmark={benchmark}
      benchmarkTotal={benchmarks.overall.total}
    />
  );
}
