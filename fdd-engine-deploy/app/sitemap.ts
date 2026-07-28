// app/sitemap.ts — home + /brands + every LIVE /franchise/[slug].
// Ghosts and THIN brands are deliberately absent: never invite Google to a 404.

import type { MetadataRoute } from "next";
import { listBrands, toCard, verticalOf } from "@/lib/brands";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://engine.foundersplinko.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const brands = await listBrands();
  const live = brands.filter((b) => toCard(b).live);

  return [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/brands`, changeFrequency: "daily", priority: 0.9 },
    // Two evergreen top-of-funnel pages. /sample answers "what does a franchise
    // diligence report actually look like" — a real query with no honest answer
    // on the web; /playbook is the free guide and the front door to the list.
    { url: `${BASE}/sample`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/playbook`, changeFrequency: "monthly", priority: 0.7 },
    // Low priority, but indexed on purpose: "<product> refund policy" is a query
    // a hesitating buyer actually runs, and the answer should be our page rather
    // than nothing.
    { url: `${BASE}/refunds`, changeFrequency: "yearly", priority: 0.3 },
    ...live.map((b) => ({
      url: `${BASE}/franchise/${b.slug}`,
      lastModified: b.generatedAt ? new Date(b.generatedAt) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    // P1-6: same-vertical comparison pages (canonical = alphabetical slug order)
    ...(() => {
      const out: MetadataRoute.Sitemap = [];
      for (let i = 0; i < live.length; i++)
        for (let j = i + 1; j < live.length; j++) {
          if (verticalOf(live[i]) !== verticalOf(live[j])) continue;
          const [a, b2] = [live[i].slug, live[j].slug].sort();
          out.push({ url: `${BASE}/compare/${a}-vs-${b2}`, changeFrequency: "weekly", priority: 0.6 });
        }
      return out;
    })(),
  ];
}
