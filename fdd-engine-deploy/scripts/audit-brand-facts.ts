// scripts/audit-brand-facts.ts — standalone runner for the brand-facts audit.
//
// The SAME audit runs automatically inside the build (generateStaticParams in
// app/franchise/[slug]/page.tsx calls auditBrandFacts) — that is the gate that
// fails a deploy. This script is for running it locally / in CI without a full
// next build:
//
//   npx tsx scripts/audit-brand-facts.ts
//
// It is also exercised by lib/brandFacts.test.ts (vitest), so `npm test`
// covers the whole corpus on every CI run.

import fs from "node:fs/promises";
import path from "node:path";
import { auditBrandFacts } from "../lib/brandFacts";
import type { BrandRecord } from "../lib/brands";

async function main() {
  const dir = path.join(process.cwd(), "data", "brands");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const brands: BrandRecord[] = [];
  for (const f of files) {
    brands.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as BrandRecord);
  }
  auditBrandFacts(brands); // throws (non-zero exit) on any violation
  console.log(`\n[brand-facts audit] PASS — ${brands.length} brands, zero violations`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
