// lib/brandCount.ts — ONE place that knows how many brands the library serves.
//
// Before this the number was a literal, typed independently on three surfaces,
// and they disagreed: /sample said "80+ brands", /playbook said "80+ brands",
// and the playbook nurture email — the FIRST thing a new lead reads — said
// "70+ brands". Same funnel, same week, two different claims about the size of
// the product. That is the exact drift class lib/playbook.ts and
// resolveBrandFacts exist to kill, and it had simply never been applied to a
// number that reads like copy.
//
// It also resolves a second problem: 80 brands are live, so "80+" was FALSE.
// Not badly false, but this is a diligence product whose entire pitch is that we
// count things correctly, and it is the one number on the page a reader can
// check for themselves in about nine seconds by scrolling /brands. Say the real
// number. It goes up on its own as the corpus grows, with nobody remembering to
// edit three files.
//
// SERVER ONLY — reads the brand store off disk. Client surfaces take it as a
// prop from their server page, the same pattern /playbook uses for PLAYBOOK_URL.

import { listBrands, toCard } from "./brands";

/** Brands with a clickable, publicly-served page. Ghost/THIN rows don't count. */
export async function liveBrandCount(): Promise<number> {
  const brands = await listBrands();
  return brands.map((b) => toCard(b)).filter((c) => c.live).length;
}

/**
 * The copy form. Exact, never "N+".
 *
 * Kept as a function rather than inlined at each call site so that if we ever DO
 * want a rounded form ("nearly 100"), it changes in one place and every surface
 * moves together — which was the whole failure mode above.
 */
export function brandCountPhrase(n: number): string {
  return `${n} brands`;
}
