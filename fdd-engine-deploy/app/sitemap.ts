// app/sitemap.ts — home + /brands + every LIVE /franchise/[slug].
// Ghosts and THIN brands are deliberately absent: never invite Google to a 404.

import type { MetadataRoute } from "next";
import { listBrands, toCard } from "@/lib/brands";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://engine.foundersplinko.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const brands = await listBrands();
  const live = brands.filter((b) => toCard(b).live);

  return [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/brands`, changeFrequency: "daily", priority: 0.9 },
    ...live.map((b) => ({
      url: `${BASE}/franchise/${b.slug}`,
      lastModified: b.generatedAt ? new Date(b.generatedAt) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
