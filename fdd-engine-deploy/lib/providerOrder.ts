// fdd-engine-deploy/lib/providerOrder.ts
//
// ONE source of truth for which model vendor the engine calls FIRST.
//
// Why this file exists at all: the ordering used to be a one-line ternary inside
// extractFdd.ts, and the second model call site (financialsPass.ts) never
// consulted it — it just imported the Anthropic SDK directly. The result was a
// system where "Gemini is primary" was true of ONE code path and false of the
// engine. A claim that lives in a ternary in one file is not an architecture; it
// is a coincidence. So the order lives here, every model call site imports it,
// and providerInventory.test.ts fails the build if a new call site appears that
// does not.
//
// AN ORDER THAT ONLY ONE CALL SITE OBEYS IS NOT AN ORDER.
//
// Product position (locked): Gemini is the PRIMARY extraction model. Claude is
// the FAILOVER. This is a durability property, not a hedge — a single-vendor
// engine is one 503 away from a lost sale, and the failover has fired in
// production. We say so out loud; we never claim there is no fallback.

export type ModelProvider = "gemini" | "claude";

/** The shipped default. Changing this line changes the product claim. */
export const DEFAULT_PRIMARY: ModelProvider = "gemini";

const VALID: readonly ModelProvider[] = ["gemini", "claude"] as const;

function isProvider(v: unknown): v is ModelProvider {
  return typeof v === "string" && (VALID as readonly string[]).includes(v);
}

/**
 * Which vendor to call first.
 *
 * EXTRACTION_PRIMARY is an OPERATIONAL override for a vendor outage — flip it,
 * redeploy nothing, skip the dead vendor entirely. It is NOT the place the
 * product decision lives. An unset or unrecognised value resolves to
 * DEFAULT_PRIMARY, and an unrecognised value is logged loudly rather than
 * silently swallowed: a typo'd env var used to fail open to Gemini with no
 * signal at all, which is how a deploy can quietly disagree with its own docs.
 */
export function resolvePrimary(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  const raw = env.EXTRACTION_PRIMARY;
  if (raw === undefined || raw === "") return DEFAULT_PRIMARY;
  if (isProvider(raw)) return raw;
  console.warn(
    `[providers] EXTRACTION_PRIMARY="${raw}" is not a known provider ` +
      `(expected ${VALID.join(" | ")}) — falling back to "${DEFAULT_PRIMARY}".`,
  );
  return DEFAULT_PRIMARY;
}

/** The other one. Two vendors, so this is total. */
export function resolveSecondary(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  return resolvePrimary(env) === "gemini" ? "claude" : "gemini";
}

/**
 * The ordered vendor list for a call site that wants to loop rather than
 * hand-roll try/catch. Index 0 is primary.
 */
export function providerOrder(env: NodeJS.ProcessEnv = process.env): ModelProvider[] {
  const primary = resolvePrimary(env);
  return [primary, primary === "gemini" ? "claude" : "gemini"];
}
