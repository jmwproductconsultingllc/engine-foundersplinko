// lib/ogCopy.ts — WHAT a preview card says. (lib/og.tsx decides what it looks
// like; these two are split on purpose, see the bottom of this comment.)
//
// THE PROBLEM
//
// Every link we hand out — a brand page in a nurture email, /sample in a DM, a
// report link forwarded to a spouse — currently unfurls as a bare URL. In an
// email client or a group chat that is not a neutral outcome: a naked
// engine.foundersplinko.com/franchise/mathnasium next to a link that renders a
// title, an image and a description reads as the less legitimate of the two.
// The link is the product's first impression far more often than the homepage
// is, and right now it has no first impression at all.
//
// THE GATING PROBLEM, WHICH IS THE REAL ONE
//
// An OG image is fetched by an UNAUTHENTICATED third party — Slack, iMessage,
// Gmail, X — and then cached on their infrastructure, outside our control,
// indefinitely. That makes it the single leakiest surface in the app, and it
// bypasses every guard we built: the teaser transform, the paid gate, the
// server/client boundary. Two rules follow, and both are structural here rather
// than advisory:
//
//   1. brandOgSpec() THROWS on a retracted brand. The retraction design says a
//      pulled record shows no figures anywhere; a card is the one place that
//      could keep serving them for weeks after the page stopped. A rule that
//      says "remember to check retracted" is a rule someone forgets at 1am.
//
//   2. reportOgSpec() TAKES NO ARGUMENTS. A per-buyer report card cannot leak
//      buyer data if the function that builds it has no way to receive any.
//      Arity zero is the whole guarantee, and lib/ogCopy.test.ts asserts it.
//
// Everything a brand card DOES show is already public on the free brand page and
// in its meta description: cost range, the Item 19 monthly hero with its honest
// label, and the count of things to verify. No risk reason text, no tripwire
// descriptions, no deficit figures — those never reach BrandCard in the first
// place, which is why this module takes a card-shaped input and not a record.
//
// WHY THIS FILE HAS NO JSX AND NO next/og IMPORT
//
// So it can be unit-tested against the real brand store without dragging in a
// renderer, and so the copy rules above are enforced by plain assertions rather
// than by rendering a PNG and squinting at it.

import { verifyPhrase } from "./verify";
import { compactUsd } from "./publicFormat";
import { RETRACTION_HEADLINE } from "./retraction";
import { REFUND_HEADLINE, REFUND_SENTENCE } from "./refund";

/** Facebook/LinkedIn/X all want 1.91:1. 1200x630 is the one size everyone renders. */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/** Site palette, duplicated as hex because Satori has no Tailwind. */
export const OG_COLORS = {
  bg: "#0B1220",
  panel: "#131F35",
  border: "#22304C",
  text: "#F1F5F9",
  muted: "#8194B0",
  dim: "#586A88",
  green: "#34D399",
  blue: "#38BDF8",
  amber: "#F59E0B",
} as const;

export const OG_DOMAIN = "engine.foundersplinko.com";

export interface OgStat {
  /** The big number/figure. */
  value: string;
  /** The noun. Never omitted — a figure with no noun is the bug LABEL LAW exists for. */
  label: string;
  /** Optional qualifier. If a stat NEEDS one and it won't fit, the stat is dropped. */
  sub?: string;
}

export interface OgCardSpec {
  eyebrow: string;
  title: string;
  blurb: string;
  stats: OgStat[];
  footer: string;
  accent: string;
}

/**
 * The subset of BrandCard a preview card is allowed to see. Declared
 * structurally rather than importing BrandCard so this module pulls in no fs —
 * and so widening BrandCard can never silently widen what a card can print.
 */
export interface OgBrandFacts {
  brandName: string;
  vertical: string;
  lo: number | null;
  hi: number | null;
  buildoutMid: number | null;
  mo: number | null;
  moLabel: "average" | "median";
  moKind: "revenue" | "profit" | null;
  moBasis: "disclosed" | "derived";
  moCaveat: string | null;
  mn: number | null;
  verifyCount: number;
  retracted: boolean;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Same compact form the brand page's meta description uses, so the card and the
 * SERP snippet quote the same range.
 *
 * This was the THIRD hand-typed copy of that formatter (the others were the
 * local usd() in components/BrandCard.tsx and the one the glass hero was about
 * to grow). It is now an alias, kept only so the call sites in this file and
 * the OG route read in their own vocabulary. Do not re-inline the body: two
 * copies of a declaration always drift, and drift here means the tile, the OG
 * image and the glass hero quote three different numbers for one brand.
 */
export const ogUsd = compactUsd;

/** Word-boundary truncation. Satori will happily render a 60-character brand
 *  name straight off the right edge of the image, silently. */
export function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

/** Title size shrinks with length rather than wrapping to three lines. */
export function ogTitleSize(title: string): number {
  if (title.length <= 24) return 70;
  if (title.length <= 38) return 58;
  return 48;
}

function costStat(f: OgBrandFacts): OgStat | null {
  if (f.lo != null && f.hi != null) {
    return { value: `${ogUsd(f.lo)}–${ogUsd(f.hi)}`, label: "to open (Item 7)" };
  }
  if (f.buildoutMid != null) {
    return { value: `~${ogUsd(f.buildoutMid)}`, label: "to open", sub: "build-out estimate" };
  }
  return null;
}

/** The caveat length at which we drop the hero rather than truncate it.
 *  A "top quartile only" caveat cut to "top quart..." is worse than no figure:
 *  the number survives and the thing that makes it honest doesn't. */
export const OG_CAVEAT_MAX = 52;

function heroStat(f: OgBrandFacts): OgStat | null {
  if (f.mo == null || f.moKind == null) return null;
  if (f.moCaveat && f.moCaveat.length > OG_CAVEAT_MAX) return null;
  const label = `${f.moLabel} ${f.moKind} / unit`;
  const sub = f.moCaveat
    ? f.moCaveat
    : f.moBasis === "derived"
      ? "derived from annual"
      : f.mn != null
        ? `${f.mn.toLocaleString("en-US")} units reported`
        : undefined;
  return { value: `${ogUsd(f.mo)}/mo`, label, sub };
}

/** The verify chip. Number and noun are split across the two lines of one stat
 *  block, and the noun is DERIVED from verifyPhrase() rather than re-pluralized
 *  here — LABEL LAW lives in lib/verify.ts and gets to stay there. */
function verifyStat(count: number): OgStat {
  const phrase = verifyPhrase(count);
  const n = phrase.slice(0, phrase.indexOf(" "));
  return { value: n, label: phrase.slice(n.length + 1) };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/**
 * A live brand's card.
 *
 * Throws on a retracted brand. Callers must branch to retractedOgSpec() — the
 * throw is there so that a caller who forgets gets a build/render error instead
 * of a cached image of numbers we already took down.
 */
export function brandOgSpec(f: OgBrandFacts): OgCardSpec {
  if (f.retracted) {
    throw new Error(
      `brandOgSpec called for retracted brand "${f.brandName}" — use retractedOgSpec(). ` +
        `A preview card outlives the page it came from; a pulled figure must not survive in one.`,
    );
  }
  const stats = [costStat(f), heroStat(f), verifyStat(f.verifyCount)].filter(
    (s): s is OgStat => s !== null,
  );
  return {
    eyebrow: f.vertical.toUpperCase(),
    title: clamp(f.brandName, 44),
    blurb:
      "Cost to open, Item 19 earnings, the fee stack and what to verify — read from the actual FDD.",
    stats,
    footer: `${OG_DOMAIN} · free, no signup`,
    accent: OG_COLORS.green,
  };
}

/** A pulled record's card. No figures reach it because none are passed in. */
export function retractedOgSpec(brandName: string): OgCardSpec {
  return {
    eyebrow: "RECORD PULLED",
    title: RETRACTION_HEADLINE,
    blurb: `A figure we published for ${clamp(
      brandName,
      40,
    )} didn't reconcile against the source FDD, so the whole record came down until it does.`,
    stats: [],
    footer: OG_DOMAIN,
    accent: OG_COLORS.amber,
  };
}

export function homeOgSpec(brandCount: number): OgCardSpec {
  return {
    eyebrow: "FRANCHISE DILIGENCE",
    title: "Know if a franchise will actually make you money",
    blurb:
      "Upload the FDD. Get the real cost to open, the Item 19 unit economics, the full fee stack, and what to verify before you sign.",
    stats: [
      { value: brandCount.toLocaleString("en-US"), label: "brands already read" },
      { value: "Item 19", label: "earnings, honestly labeled" },
    ],
    footer: OG_DOMAIN,
    accent: OG_COLORS.green,
  };
}

export function libraryOgSpec(brandCount: number, verticalCount: number): OgCardSpec {
  return {
    eyebrow: "THE DILIGENCE LIBRARY",
    title: "Every franchise, read by AI.",
    blurb:
      "Real cost to open, Item 19 numbers and what to verify — free, before a salesperson gets to spin you.",
    stats: [
      { value: brandCount.toLocaleString("en-US"), label: "brands" },
      { value: verticalCount.toLocaleString("en-US"), label: "verticals" },
    ],
    footer: `${OG_DOMAIN}/brands`,
    accent: OG_COLORS.green,
  };
}

export function sampleOgSpec(): OgCardSpec {
  return {
    eyebrow: "SAMPLE REPORT",
    title: "What a diligence report actually looks like",
    blurb:
      "The whole report, end to end: cost to open, unit economics, the fee stack, financial condition, and what to verify. Illustrative example, fictional brand.",
    stats: [],
    footer: `${OG_DOMAIN}/sample`,
    accent: OG_COLORS.blue,
  };
}

export function playbookOgSpec(): OgCardSpec {
  return {
    eyebrow: "FREE GUIDE",
    title: "The Franchise Buyer's Playbook",
    blurb:
      "The 90-day checklist, the real cost to open, how to read Item 19 honestly, the full fee stack, and what to ask a franchisee before you sign.",
    stats: [],
    footer: `${OG_DOMAIN}/playbook`,
    accent: OG_COLORS.blue,
  };
}

/** Built from lib/refund.ts, so the card cannot outlive a policy change. */
export function refundsOgSpec(): OgCardSpec {
  return {
    eyebrow: "GUARANTEE",
    title: REFUND_HEADLINE,
    blurb: REFUND_SENTENCE,
    stats: [],
    footer: `${OG_DOMAIN}/refunds`,
    accent: OG_COLORS.green,
  };
}

export function compareOgSpec(a: string, b: string): OgCardSpec {
  return {
    eyebrow: "SIDE BY SIDE",
    title: `${clamp(a, 26)} vs ${clamp(b, 26)}`,
    blurb:
      "Cost to open, Item 19 earnings, royalty and what to verify — compared on the same rows, from each brand's actual FDD.",
    stats: [],
    footer: OG_DOMAIN,
    accent: OG_COLORS.green,
  };
}

/**
 * The card for /report/<id>.
 *
 * TAKES NOTHING, ON PURPOSE. A buyer forwards a report link to a spouse or a
 * partner; the recipient's mail client fetches this image with no session, and
 * the result is cached on someone else's servers forever. Any argument at all
 * is a channel for a figure to escape the paywall, so there isn't one.
 *
 * The page is already noindex/nofollow. This is the same decision applied to the
 * one part of the page a crawler still fetches.
 */
export function reportOgSpec(): OgCardSpec {
  return {
    eyebrow: "FRANCHISE EDGE",
    title: "A private diligence report",
    blurb:
      "This link opens one buyer's report. Nothing from inside it is shown here — open the link to read it.",
    stats: [],
    footer: OG_DOMAIN,
    accent: OG_COLORS.blue,
  };
}

/** Used when a slug resolves to nothing. Never a figure, never a guess. */
export function fallbackOgSpec(): OgCardSpec {
  return {
    eyebrow: "FRANCHISE EDGE",
    title: "Franchise diligence, from the actual FDD",
    blurb:
      "Real cost to open, Item 19 unit economics, the full fee stack, and what to verify before you sign.",
    stats: [],
    footer: OG_DOMAIN,
    accent: OG_COLORS.green,
  };
}
