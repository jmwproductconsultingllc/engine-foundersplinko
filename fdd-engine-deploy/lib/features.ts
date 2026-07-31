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
