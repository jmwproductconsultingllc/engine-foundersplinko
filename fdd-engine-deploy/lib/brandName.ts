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

// ---------------------------------------------------------------------------
// Indefinite article ("a" / "an")
// ---------------------------------------------------------------------------
//
// bareName() alone is NOT enough for copy that supplies its own INDEFINITE
// article. "the 12 questions to ask a {Brand} franchisee" is the live example:
// stripping the article off "The UPS Store" leaves "a UPS Store franchisee"
// (correct), but the same slot renders "a Anytime Fitness franchisee" and
// "a Ellie Mental Health franchisee" on brands that never had an article at
// all. 19 of the 83 brands in the corpus break on this string today — more
// than double the 8 the article bug touched.
//
// English picks a/an on the SOUND, not the letter, so a naive /^[aeiou]/ test
// gets three real corpus entries wrong. The traps that actually exist here:
//
//   The UPS Store        → "a UPS Store"        (initialism, U reads "yoo")
//   Once Upon A Child    → "a Once Upon A Child" (O reads "wun")
//   Ultimate Longevity   → "an Ultimate ..."     (plain vowel — must stay "an")
//
// The order below matters: explicit sound exceptions, then initialisms, then
// the letter fallback. Keep it boring and testable — see brandName.test.ts,
// which asserts the article for every brand in the live corpus.

/** Words that START with a vowel letter but a CONSONANT sound → take "a". */
const CONSONANT_SOUND = /^(uni|use|usu|usa|uti|util|ubiq|euro|eu|ewe|one|once|ouija)/i;

/** Words that START with a consonant letter but a VOWEL sound → take "an". */
const VOWEL_SOUND = /^(hour|honest|honor|honour|heir|herb\b)/i;

/**
 * Letter names that begin with a vowel sound, for initialisms read aloud
 * letter-by-letter: an F, an H, an M, an S, an X — but *a* U ("yoo").
 */
const AN_LETTERS = new Set(["A", "E", "F", "H", "I", "L", "M", "N", "O", "R", "S", "X"]);

/**
 * True when a token looks like an initialism read letter-by-letter (UPS, DDH,
 * MRI) rather than a pronounceable all-caps word (SPENGA, IMAGE, JAN-PRO).
 *
 * Two signals, either sufficient: all-caps and at most three letters, or
 * all-caps with no vowel after the first character. The first catches MRI and
 * FBS, which the vowel test alone misses; the second catches longer strings of
 * consonants. Neither fires on IMAGE (5 letters, vowels throughout) or SPENGA.
 *
 * A pronounceable three-letter all-caps brand (ACE, POP) is misclassified as an
 * initialism here — harmless, because the letter-name and word-sound answers
 * agree for every such case. ONE would disagree, and is caught earlier by
 * CONSONANT_SOUND.
 */
function isInitialism(token: string): boolean {
  const letters = token.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  if (letters !== letters.toUpperCase()) return false;
  return letters.length <= 3 || !/[AEIOU]/.test(letters.slice(1));
}

/**
 * "a" or "an" for a brand name, article already stripped.
 *
 * Use with bareName() — or just call withArticle(), which does both.
 */
export function indefiniteArticle(name: string): "a" | "an" {
  const token = bareName(name).trim().split(/\s+/)[0] ?? "";
  if (!token) return "a";
  if (CONSONANT_SOUND.test(token)) return "a";
  if (VOWEL_SOUND.test(token)) return "an";
  if (isInitialism(token)) {
    return AN_LETTERS.has(token.replace(/[^A-Za-z]/g, "")[0].toUpperCase()) ? "an" : "a";
  }
  return /^[aeiou]/i.test(token) ? "an" : "a";
}

/**
 * The whole phrase: "a Crumbl", "an Anytime Fitness", "a UPS Store".
 *
 * This is what copy should interpolate. Do NOT write "a {Brand}" in a template
 * and hope — the article has to travel with the name.
 */
export function withArticle(name: string): string {
  return `${indefiniteArticle(name)} ${bareName(name)}`;
}
