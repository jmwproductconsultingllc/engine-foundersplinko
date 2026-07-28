// lib/brandName.ts — brand-name display helpers.
//
// Pure, zero imports, safe in a client bundle (same discipline as lib/verify.ts).
// Deliberately NOT in lib/brands.ts: that module reads the brand store off disk,
// and the components that need this — BrandDetail, BrandCTA — are client
// components. Importing from lib/brands.ts would drag the whole store into the
// browser bundle to answer a two-line string question.

/**
 * Strip a leading article so copy that supplies its OWN article reads correctly.
 *
 * "Unlock the full {brandName} report" rendered "Unlock the full The UPS Store
 * report" — and this is not a one-brand typo. 8 of the 83 brands in the corpus
 * lead with an article (The UPS Store, The Goddard School, The Little Gym, The
 * Exercise Coach, The Back Nine, The Vital Stretch, The Original Rainbow Cone,
 * The Brothers that just do Gutters), and it fires on four separate strings, so
 * roughly one page in ten had visibly broken English on its primary CTA — the
 * exact button that has to look competent to take $199.
 *
 * Use this ONLY where the surrounding copy already supplies the article. A bare
 * headline or a link label should render the brand's real name, article and all.
 */
export function bareName(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, "");
}
