// lib/playbook.ts
//
// ONE place that knows where the Franchise Buyer's Playbook PDF lives.
//
// Why a resolver instead of a constant in two files: the playbook URL is used
// by (a) the nurture email (lib/leadEmail.ts, server) and (b) the /playbook
// landing page's direct-download button. Before this they would have been two
// literals — and the day the v2 PDF is uploaded under a new filename, one of
// them silently keeps serving v1. Same drift class the brand-facts resolver
// exists to kill.
//
// Deliberately NOT a NEXT_PUBLIC_ var. The landing page is a server component
// that reads this and passes the resolved string down as a prop, so there is
// exactly one env var (PLAYBOOK_URL, already set in Vercel) and no chance of a
// client bundle inlining `undefined` for a server-only name.
//
// To ship the v2 PDF: upload it, then set PLAYBOOK_URL in Vercel. Nothing else
// in the codebase needs to change.

const FALLBACK_PLAYBOOK_URL = "https://foundersplinko.com/playbook.pdf";

/** Server-side only (reads a non-public env var). Pass the result down as a prop. */
export function playbookUrl(): string {
  const fromEnv = (process.env.PLAYBOOK_URL || "").trim();
  return fromEnv || FALLBACK_PLAYBOOK_URL;
}

/**
 * The sentinel brand_slug for playbook leads captured OUTSIDE a brand page
 * (i.e. the standalone /playbook landing page).
 *
 * /api/lead normally resolves `slug` to a READY brand — that lookup exists to
 * build the findings email. A playbook lead has no brand, so it uses this
 * sentinel, which the route allows only when lead_source === "playbook".
 *
 * It doubles as the upsert key: leads upsert on (email, brand_slug), so one
 * person can be a playbook lead once AND a brand_findings lead per brand,
 * without either collapsing the other.
 */
export const PLAYBOOK_SLUG = "__playbook";

/** What the landing page promises is inside — mirrored in the nurture email. */
export const PLAYBOOK_CONTENTS: { t: string; d: string }[] = [
  {
    t: "The 90-day checklist",
    d: "What to do, in order, from first franchisor call to signed agreement — including the two weeks the FTC gives you to actually read the FDD.",
  },
  {
    t: "The cost worksheets",
    d: "Item 7 is a range, not a number. Work out your real cost to open — build-out, working capital, and the months before the first dollar lands.",
  },
  {
    t: "The location math",
    d: "Rent is a top-three line in the model and the one most buyers sign without stress-testing. What occupancy you can carry, and what to negotiate first.",
  },
  {
    t: "Reading Item 19 honestly",
    d: "Averages, medians, top-quartile framing — how to tell what the typical unit earns from what the sales deck put in front of you.",
  },
  {
    t: "The full fee stack",
    d: "Royalty, brand fund, tech, and the recurring costs that don't show up in the pitch — and what they leave you at the bottom.",
  },
  {
    t: "Questions to ask a franchisee",
    d: "The conversations that decide the deal, and the exact things to ask before you write the check.",
  },
];
