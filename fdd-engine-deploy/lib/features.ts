/**
 * lib/features.ts — server-side feature flags.
 *
 * Flip via Vercel env vars (a redeploy applies the change). Each flag defaults
 * ON; set the env var to the string "false" to disable it. The route reads
 * these, so toggling off cleanly removes the feature from every run without a
 * code change.
 *
 *   INSIGHTS_ENABLED=false   → disables the "Franchise Edge · Insights" section
 *   FINCON_ENABLED=false     → disables the "Financial Condition" severity card
 *                               (its own switch: this is the report's highest-
 *                               stakes claim, so you can kill it independently of
 *                               Insights if it ever misfires on a brand)
 *   CONSULT_CTA_URL=https://… → destination for the in-report "book a territory
 *                               review" hook (leave unset to hide the button)
 */

export const INSIGHTS_ENABLED = process.env.INSIGHTS_ENABLED !== "false";

export const FINCON_ENABLED = process.env.FINCON_ENABLED !== "false";

export const CONSULT_CTA_URL = process.env.CONSULT_CTA_URL || "";

/**
 * GLASS MODE — the full-report shell on /franchise/[slug].
 *
 * THE ONE FLAG IN THIS FILE THAT DEFAULTS OFF, and the deviation is deliberate.
 *
 * READY IS EARNED, NEVER INHERITED: a publishing gate's default must be the
 * withholding side. Every other flag here toggles a section inside a page that
 * already works. This one swaps the page type on the exact URLs every ad,
 * email and partner link points at. Defaulting it on means the merge is the
 * launch — glass would go live the moment the branch lands, before anyone has
 * viewed a rendered page, checked the RSC payload, or watched a single event
 * land from a real phone.
 *
 * Set GLASS_ENABLED=true to launch. Record the deploy timestamp when you do:
 * the whole point of glass mode is a clean before/after read against the
 * teaser, and that read needs a boundary you can name.
 *
 * Unset or "false" → every brand serves the current teaser. Full rollback is
 * an env change, not a revert.
 */
export const GLASS_ENABLED = process.env.GLASS_ENABLED === "true";
