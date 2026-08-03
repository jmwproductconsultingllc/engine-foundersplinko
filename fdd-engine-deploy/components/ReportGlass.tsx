"use client";

/**
 * ReportGlass.tsx — the glass-mode renderer.
 *
 * Props are `{ shell: ReportShell; refTag: string | null; unlockHref: string }`
 * and that is the whole contract. Same discipline as BrandDetail's
 * `{ teaser, refTag }`: the component cannot leak a figure because it is never
 * handed one. All three props are serializable, which is not a nicety — the
 * caller is a server component and nothing else can cross that boundary.
 *
 * DO NOT widen these props. DO NOT pass the computed record "just for the
 * chart". If a future feature needs a number, it needs a new MaskToken field
 * on the server, not a new prop here.
 *
 * Every mask is an empty <span>. There is no text node behind it, no title
 * attribute, no data-value, no aria-label carrying a figure. View-source on
 * this page contains labels and prose and nothing else.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { usePathname } from "next/navigation";

import {
  PROVENANCE_LABEL,
  PROVENANCE_LEGEND,
  unlockCopy,
  type Intent,
  type MaskToken,
  type Provenance,
  type ReportShell,
  type ShellLine,
  type ShellSection,
} from "@/lib/reportShell";

import { RANGE_SEP } from "@/lib/range";
// citation.ts imports nothing but a type from reportShell — safe in the client
// bundle. It is the only place a citation becomes display text.
import { formatCitation } from "@/lib/citation";
import { usePriceBlockTelemetry } from "@/lib/priceBlockTelemetry";

/* The hero's public figures. TYPE-ONLY from publicFormat, which has zero
   imports — the BUILDER lives in lib/publicFigures.ts and is on SERVER_ONLY in
   lib/glassSeam.test.ts, so importing it here would fail the build rather than
   quietly ship resolveBrandFacts (and rent.ts, fees.ts, perUnitRevenue.ts,
   verify.ts behind it) to the browser. The hook arrives on the shell, attached
   in lib/glassGate.ts. This is not a widened prop: `shell` was always the
   contract. */
import type { PublicHook } from "@/lib/publicFormat";
import { REFUND_EMAIL } from "@/lib/refund";

/* CAPTURE (2026-07-30). Glass shipped with none of it: BrandDetail mounts
   CaptureProvider, three EmailCapture surfaces and CaptureSheet, and none of
   that is global — app/layout.tsx mounts no capture machinery — so the glass
   branch of app/franchise/[slug]/page.tsx returned a page that could take
   money and could not take a lead. Unlock or leave, nothing in between.

   Neither import breaches THE SEAM LINT. EmailCapture reaches only
   lib/analytics, lib/brandName and CaptureContext; nothing here can compute a
   figure, which is why capture could be added without widening the props. */
import EmailCapture from "@/components/EmailCapture";
import { CaptureProvider } from "@/components/CaptureContext";
import { track } from "@/lib/analytics";

import styles from "./ReportGlass.module.css";

const PRICE = "$199";

/* ------------------------------------------------------------------ */

function Mask({
  token,
  bind,
}: {
  token: MaskToken;
  bind: (el: HTMLElement | null) => void;
}) {
  const cls = [
    styles.mask,
    styles[`w${token.width}`],
    token.sign === "negative" ? styles.negative : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      ref={bind}
      className={token.sign === "negative" ? styles.valueNeg : styles.value}
    >
      <span className={cls} aria-hidden="true" />
      {token.parts === 2 && (
        <>
          {/* RANGE_SEP, not a literal en dash. The repo has exactly one range
              separator (lib/range.ts) and THE RANGE LINT exists because a bare
              dash with whitespace either side breaks across lines on a phone —
              where 83% of the spend lands. A masked range that wraps mid-token
              reads as two broken elements, not one withheld number. */}
          <span className={styles.dash} aria-hidden="true">{RANGE_SEP}</span>
          <span className={cls} aria-hidden="true" />
        </>
      )}
      <span className={styles.srOnly}>Locked</span>
    </span>
  );
}

function ProvenanceChip({ kind }: { kind: Provenance }) {
  return (
    <span className={`${styles.chip} ${styles[kind]}`}>
      {PROVENANCE_LABEL[kind]}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * THE HOOK — the already-free figures, said out loud, above the fold.
 *
 * THE DEFECT THIS FIXES. A visitor arrives from a paid ad and the first
 * concrete statement on the page was "Below the disclosed minimum" — below
 * WHAT? The ad does not carry a figure. The /brands tile does ("$115k/mo
 * revenue · from $364k to open") but an ad click never passes through it. So
 * the one number the buyer needs in order to read the rest of the page was
 * visible on a surface they never saw, and the landing page had stopped
 * saying it. That is not a moat. It is an orphaned page.
 *
 * THIS IS NOT A WIDENING OF THE FREE TIER. Every string here is already
 * public: lib/brandFacts.ts marks the Item 19 headline "(PUBLIC by
 * middle-path design)", Item 7 low/high "(PUBLIC)", system scale "(PUBLIC)",
 * and all three render unpaywalled on the library tile and in the SERP
 * snippet today. Glass lost them by accident, not by decision —
 * buildReportShell() builds from the arithmetic graph and never consults the
 * public-facts resolver. See lib/publicFigures.ts.
 *
 * THE COMPACTION IS LOAD-BEARING. "$115k" is what makes this shippable;
 * "$115,340" would be a figure no free surface has ever shown. Both figures
 * come from lib/publicFormat.ts — the SAME function the tile calls, not the
 * same rounding — so the tile and this hero cannot print one brand two ways.
 *
 * THE BASIS IS NOT DECORATION. lib/brandFacts.ts: surfaces must NEVER claim a
 * derived headline was franchisor-disclosed. The verb changes with the basis
 * ("reports" vs "works out to"), the chip states it, and monthlyCaveat is
 * rendered verbatim rather than summarised.
 * ------------------------------------------------------------------ */

/* Exported for THE PROSE PROVENANCE LINT in ReportGlass.test.tsx, which renders
   this block alone across the whole catalog. Not a public API — nothing outside
   this file and that test may mount it, because mounting it elsewhere is how a
   second surface starts printing figures without passing the hook lint. */
export function HeroHook({ hook, brandName }: { hook: PublicHook; brandName: string }) {
  // Degrade by omission, never by placeholder. A brand with no Item 19 and no
  // Item 7 range gets no hook at all — an em-dash where a headline should be
  // reads as a broken page, which is worse than a page that never promised one.
  if (!hook.monthly && !hook.cost) return null;

  // The chip states the basis. It used to be followed by the words
  // "Franchisor-disclosed", which is the chip again in longhand — the reader
  // is told the same thing twice before being told anything new. The chip
  // stays because it carries the palette the rest of the report is read in;
  // the longhand goes.
  const meta = [
    hook.monthly && hook.hasItem19 ? "Item 19" : null,
    hook.monthlySample,
    hook.cost ? "Item 7" : null,
    hook.units,
    hook.fddEdition,
  ].filter(Boolean) as string[];

  /* THE NOTE MUST TRACK THE BASIS.
   *
   * This sentence was hardcoded as "Both figures are the franchisor's own,
   * straight out of the disclosure document." True on Wingstop. FALSE on
   * real-property-management, whose monthly headline is DERIVED — its own
   * caveat, rendered two lines above, says per-franchise revenue "is not
   * disclosed directly."
   *
   * lib/brandFacts.ts states the rule outright: a surface must NEVER claim a
   * derived headline was franchisor-disclosed. The verb and the chip already
   * honour it. A fixed sentence underneath them made the banned claim anyway,
   * in prose, where the moBasis plumbing was not looking. Provenance has to
   * survive into the sentences, not just the labels.
   */
  const provenance =
    hook.monthly && hook.cost
      ? hook.monthlyBasis === "disclosed"
        ? "Both figures are the franchisor’s own, straight out of the disclosure document."
        : "The opening range is the franchisor’s own, straight out of the disclosure document. The monthly figure is our arithmetic on figures it does disclose."
      : hook.cost
        ? "That range is the franchisor’s own, straight out of the disclosure document."
        : hook.monthlyBasis === "disclosed"
          ? "That figure is the franchisor’s own, straight out of the disclosure document."
          : "That figure is our arithmetic on figures the franchisor does disclose.";

  const masked = hook.cost
    ? "What is masked below is the rest of the analysis — and the capital check that follows measures your cash against that opening range."
    : "What is masked below is the rest of the analysis.";

  return (
    <div className={styles.hook}>
      {hook.monthly && (
        <p className={styles.hookBig}>
          The {hook.monthlyLabel ?? "average"} {brandName} unit{" "}
          {hook.monthlyBasis === "disclosed" ? "reports" : "works out to"}{" "}
          <strong className={styles.hookFig}>{hook.monthly}</strong>
          <span className={styles.hookUnit}>
            /mo in {hook.monthlyKind ?? "revenue"}
          </span>
          .
        </p>
      )}

      {hook.cost && (
        <p className={styles.hookBig}>
          Opening one costs{" "}
          <strong className={styles.hookFig}>{hook.cost}</strong>.
        </p>
      )}

      <p className={styles.hookMeta}>
        {hook.monthly && hook.monthlyBasis && (
          <ProvenanceChip kind={hook.monthlyBasis} />
        )}
        <span className={styles.hookMetaText}>{meta.join(" · ")}</span>
      </p>

      {hook.monthlyCaveat && (
        <p className={styles.hookCaveat}>{hook.monthlyCaveat}</p>
      )}

      <p className={styles.hookNote}>
        {provenance} {masked}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * WHAT THIS IS — positioning, plus the FDD in plain language.
 *
 * WHY THE DEFINITION IS NOT BEHIND THE <details>. Mobile is the overwhelming
 * majority of traffic, and a definition someone has to tap for is a
 * definition most of them never read. The one-sentence version is always
 * visible; only the Item-by-Item breakdown collapses. A buyer who does not
 * know what an FDD is cannot evaluate a page whose entire credibility rests
 * on our having read one.
 *
 * WHAT THIS DELIBERATELY DOES NOT SAY. Not "the leading provider of franchise
 * diligence." An unsubstantiated superlative on a commercial page is an FTC
 * substantiation problem we cannot support, and — the bigger cost — it reads
 * as marketing to exactly the skeptical buyer who is about to spend $200k+.
 * "We read the document and here is the arithmetic" is a stronger claim
 * because it is checkable, and every line below it is checkable.
 * ------------------------------------------------------------------ */

function WhatThisIs({ brandName }: { brandName: string }) {
  const mailto = `mailto:${REFUND_EMAIL}?subject=${encodeURIComponent(
    `Question about the ${brandName} report`,
  )}`;

  return (
    <section className={styles.whatIs}>
      <p className={styles.whatIsLead}>
        {/* {" "} not a literal space: the space after </strong> renders under
            react-dom/server but was dropped in the shipped Next build, giving
            "Franchise Edgeautomates" on the live page. Every other inline tag
            in this block already uses the explicit form. Match it. */}
        <strong className={styles.wordmark}>Franchise Edge</strong>{" "}
        automates franchise diligence. We read the franchisor&rsquo;s own{" "}
        <b>Franchise Disclosure Document</b> — the filing a franchisor is
        legally required to hand you at least 14 days before you sign anything
        or pay anything — and run the work that takes a buyer weeks by hand:
        every disclosed cost, the unit economics behind the headline, the full
        fee stack, and what happened to the units that opened before you.
      </p>

      <p className={styles.whatIsLead}>
        Your analysis is ready. The framework is below — every section, every
        cited figure, every question, exactly as it appears in the report.
      </p>

      <details className={styles.fdd}>
        <summary className={styles.fddSummary}>
          New to FDDs? Here is what is in one
        </summary>
        <div className={styles.fddBody}>
          <p>
            An FDD runs to 23 numbered Items and a few hundred pages. Four of
            them do most of the work in this report:
          </p>
          <ul className={styles.fddList}>
            <li>
              <b>Item 7</b> — what it costs to open, low to high. That is the
              range above, and it is the franchisor&rsquo;s own estimate.
            </li>
            <li>
              <b>Item 19</b> — what units actually earn. A franchisor is{" "}
              <b>not required to publish one at all</b>; when it is missing, or
              when it reports profit where you expected revenue, that is itself
              a finding.
            </li>
            <li>
              <b>Item 20</b> — openings, closures, transfers and terminations,
              year by year. This is where churn shows up, and where a growth
              story either holds or does not.
            </li>
            <li>
              <b>Item 6</b> — the ongoing fees. Royalty and ad fund get quoted
              on a discovery call; the rest of the list usually does not.
            </li>
          </ul>
          <p>
            Every figure in the report is cited to its Item and page, so you can
            check any of it against the document yourself.
          </p>
        </div>
      </details>

      <p className={styles.contact}>
        Questions before you buy?{" "}
        <a className={styles.contactLink} href={mailto}>
          {REFUND_EMAIL}
        </a>{" "}
        — a person, not a ticket queue.
      </p>
    </section>
  );
}

function Line({
  line,
  bind,
}: {
  line: ShellLine;
  bind: (lockId: string) => (el: HTMLElement | null) => void;
}) {
  return (
    <div className={styles.line}>
      <div className={styles.lineHead}>
        <span className={styles.label}>{line.label}</span>
        <ProvenanceChip kind={line.provenance} />
        {line.citation && (
          <span className={styles.cite}>{formatCitation(line.citation)}</span>
        )}
        <Mask token={line.value} bind={bind(line.value.lockId)} />
      </div>
      {line.note && <p className={styles.note}>{line.note}</p>}
    </div>
  );
}

/** Rows we know exist and can count, but whose titles are themselves paid. */
function MaskedRows({
  count,
  sectionId,
  bind,
}: {
  count: number;
  sectionId: string;
  bind: (lockId: string) => (el: HTMLElement | null) => void;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className={styles.line} key={i}>
          <div className={styles.lineHead}>
            <span
              ref={bind(`${sectionId}.row-${i + 1}`)}
              className={`${styles.mask} ${styles.w8} ${styles.maskWide}`}
              aria-hidden="true"
            />
            <span className={styles.srOnly}>Locked finding</span>
          </div>
        </div>
      ))}
    </>
  );
}

function Section({
  section,
  bind,
}: {
  section: ShellSection;
  bind: (lockId: string) => (el: HTMLElement | null) => void;
}) {
  const sev = section.severityCounts;
  return (
    <section className={styles.section} id={section.id}>
      <header className={styles.sectionHead}>
        <h2 className={styles.h2}>{section.title}</h2>
        <span className={styles.count}>{section.figureCount} locked</span>
      </header>
      {section.blurb && <p className={styles.blurb}>{section.blurb}</p>}

      {sev && (
        <div className={styles.sevRow}>
          {sev.high ? <span className={styles.sevHigh}>{sev.high} high</span> : null}
          {sev.medium ? <span className={styles.sevMed}>{sev.medium} medium</span> : null}
          {sev.low ? <span className={styles.sevLow}>{sev.low} low</span> : null}
        </div>
      )}

      {section.finding && (
        /* Amber, not red. LABEL LAW: this describes the DEAL — the franchisor's
           own table — and never our analysis, and the palette never goes red. */
        <p className={styles.finding}>{section.finding}</p>
      )}

      {section.freeChips && section.freeChips.length > 0 && (
        <div className={styles.chipRow}>
          {section.freeChips.map((c) => (
            <span className={styles.freeChip} key={c}>
              {c}
            </span>
          ))}
        </div>
      )}

      {section.lines.map((l) => (
        <Line line={l} bind={bind} key={l.value.lockId} />
      ))}

      {section.maskedRows ? (
        <MaskedRows count={section.maskedRows} sectionId={section.id} bind={bind} />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The free capital verdict.
 *
 * Compares the buyer's own number against the Item 7 disclosed range and
 * says which side of it they land on. It computes nothing derived and it
 * calls nothing. Its only job is to be the one thing on the page that
 * responds to the visitor — replay says people already do this.
 * ------------------------------------------------------------------ */

/** Slider granularity. Named because the thumb's rest position snaps to it. */
const STEP = 5000;

function CapitalVerdict({
  range,
  onChange,
}: {
  range: [number, number];
  /**
   * Now carries the value. It used to be `() => void` — telemetry only cared
   * that the slider MOVED, not where it landed.
   *
   * The capture surface below cares where it landed: EmailCapture's S4 phone
   * offer is gated on capitalEdited === true && capital >= $150K (TCPA — the
   * number is only asked for when the visitor is plausibly financeable, and
   * always behind a consent checkbox). Without the value threaded out, glass
   * could collect a name and a broker but never a phone.
   *
   * RULING #3 HOLDS, and is now structural rather than a convention: there is
   * no seeded value to mistake for an edit. `capital` is null until the visitor
   * drags, this fires only on a real change event, and only an edited value
   * ever reaches the DB.
   */
  onChange: (capital: number) => void;
}) {
  const [low, high] = range;

  /**
   * THE DEFECT THIS REPLACES.
   *
   * This was `useState(Math.round(low * 0.6))`. On seniors-helping-seniors that
   * is round(95,235 × 0.6) = 57,141, so first paint rendered
   *
   *     CAPITAL AVAILABLE   $57,141   Below the disclosed minimum
   *
   * three inches into a page the visitor had been on for two seconds. It reads
   * as "we have assessed you and you do not qualify." We had assessed nobody;
   * we had multiplied the franchisor's own minimum by 0.6.
   *
   * Defaulting to the disclosed minimum instead would be the same defect with
   * a friendlier verdict. A number the visitor did not choose is the problem,
   * not which number it is. So: no number until they give us one.
   *
   * The thumb still has to sit somewhere — a range input has no null position.
   * It sits at the middle of the DISCLOSED range, which communicates nothing
   * quantitative while no figure is on screen, and puts the first drag a short
   * distance from wherever they are heading. Parking it at 0 would read as
   * "$0" to anyone who glanced at it. `seed` is a thumb position and never a
   * value: it is never displayed, never passed to onChange, and never stored.
   *
   * Kept a slider, not a dropdown or a text input — the capture path's 800ms
   * debounce on capital_modified is written against a control that emits a
   * stream of change events.
   */
  const seed = Math.round((low + high) / 2 / STEP) * STEP;

  const [capital, setCapital] = useState<number | null>(null);

  const verdict =
    capital === null
      ? null
      : capital < low
        ? { text: "Below the disclosed minimum", tone: styles.vBad }
        : capital > high
          ? { text: "Above the disclosed range", tone: styles.vOk }
          : { text: "Inside the disclosed range", tone: styles.vMid };

  return (
    <div className={styles.capital}>
      <label className={styles.capLabel} htmlFor="rg-capital">
        Capital available
      </label>
      <input
        id="rg-capital"
        className={styles.slider}
        type="range"
        min={0}
        max={Math.round(high * 1.5)}
        step={STEP}
        value={capital ?? seed}
        /* A screen reader would otherwise announce the seed as the current
           value — the same false claim the sighted defect made, in the one
           channel where nobody would have print-to-PDF'd it. */
        aria-valuetext={
          capital === null ? "Not set" : `$${capital.toLocaleString("en-US")}`
        }
        onChange={(e) => {
          const next = Number(e.target.value);
          setCapital(next);
          onChange(next);
        }}
      />
      <div className={styles.capRow}>
        {capital === null || verdict === null ? (
          <span className={styles.capPrompt}>
            Drag to enter the capital you have available.
          </span>
        ) : (
          <>
            <span className={styles.capValue}>
              ${capital.toLocaleString("en-US")}
            </span>
            <span className={verdict.tone}>{verdict.text}</span>
          </>
        )}
      </div>
      <p className={styles.capNote}>
        Against the total investment the franchisor discloses in Item 7. What it
        means for your loan, your coverage ratio and your payback is locked.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function ReportGlass({
  shell,
  refTag,
  unlockHref,
}: {
  shell: ReportShell;
  refTag: string | null;
  /**
   * Where the unlock CTAs point: /api/mint-brand-report?slug=…&ref=…
   *
   * A URL, not report data — this does not widen the payload. It was an
   * `onUnlock: () => void` callback in the handoff, and that could never have
   * worked here: the caller is app/franchise/[slug]/page.tsx, a server
   * component, and functions do not cross the RSC boundary. The prop had to
   * become serializable or the page had to become a client component, and
   * making the page a client component would have dragged getBrand() and the
   * whole catalog read into the browser.
   *
   * An anchor rather than a button-plus-router.push for three reasons, all of
   * which BrandDetail already learned: cmd-click and middle-click keep working,
   * the browser gives PostHog a tick to flush before the navigation commits,
   * and there is no JS path to fail silently on a cold mobile connection.
   */
  unlockHref: string;
}) {
  const { priceBlockRef, onCheckoutClick, onCapitalChange, lockedRef } =
    usePriceBlockTelemetry(refTag);

  /* The slug, derived from the pathname rather than passed in.
     usePriceBlockTelemetry already does exactly this and says why in its
     header: "do not simplify that later by threading a slug prop down from the
     server component; it reopens a door that took real work to close." The
     capture surface needs a slug too, and it gets one the same way — so the
     props stay `{ shell, refTag, unlockHref }` and THE RSC PAYLOAD CHECK in
     components/ReportGlass.test.tsx keeps covering the entire page. */
  const pathname = usePathname();
  const brandSlug = (pathname ?? "").split("/").filter(Boolean).pop() ?? "";

  /* Capital, lifted out of CapitalVerdict so the capture surface can read it.
     `edited` starts false and only a real drag flips it — the seeded default
     never counts (ruling #3) and never reaches the DB. */
  const [capital, setCapital] = useState<number | null>(null);
  const [capitalEdited, setCapitalEdited] = useState(false);
  const onCapital = useCallback(
    (next: number) => {
      setCapital(next);
      setCapitalEdited(true);
      onCapitalChange(); // debounced capital_modified — unchanged
    },
    [onCapitalChange],
  );

  /* Idempotency, carried over from components/BrandDetail.tsx: a real cold
     user double-clicked Unlock (replay 019f873e). The first click proceeds and
     navigates away; any second click before the navigation commits is
     swallowed, so we do not fire a second mint. Glass mode makes this MORE
     likely, not less — the sticky bar travels with the reader for the whole
     page, so the CTA is under the thumb far longer than on the teaser. */
  const navigatingRef = useRef(false);

  // Telemetry first, then navigation. PostHog batches, and a synchronous
  // redirect to Stripe will drop the event if the order is reversed. The
  // anchor's default action is what navigates — do not preventDefault here.
  const unlock = (e: MouseEvent) => {
    if (navigatingRef.current) {
      e.preventDefault();
      return;
    }
    navigatingRef.current = true;
    onCheckoutClick();
    try {
      /* Honors the Capture v2 coordination contract even though glass mounts
         no S2 sheet (see the capture block below for why it must not). Kept
         because it costs nothing and because a session that starts on a teaser
         and continues onto a glass page shares this sessionStorage — a click
         here should still suppress the sheet over there. */
      sessionStorage.setItem("fe_cta_clicked", "1");
    } catch {}
  };

  const [intent, setIntent] = useState<Intent>(null);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("intent");
    setIntent(
      raw === "cost" || raw === "profit" || raw === "invest" ? raw : null,
    );
  }, []);

  /* capture_shown, at 40% visibility, once — the same trigger and the same
     threshold BrandDetail uses for its S1 inline surface (components/
     BrandDetail.tsx:126). Matching it is the point: capture_shown / lead_email_
     submitted is the funnel, and if the two page types define "shown"
     differently the conversion rates are not comparable and the flip cannot be
     read. Only capture_surface differs. */
  const captureRef = useRef<HTMLDivElement | null>(null);
  const captureShown = useRef(false);
  useEffect(() => {
    const el = captureRef.current;
    if (!el || captureShown.current) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !captureShown.current) {
          captureShown.current = true;
          track("capture_shown", { capture_surface: "glass" });
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const copy = useMemo(() => unlockCopy(shell, intent), [shell, intent]);
  const c = shell.counts;

  const nav = shell.sections.filter((s) => s.anchor);

  return (
    <div className={styles.root}>
      {/* ---------- hero ---------- */}
      <header className={styles.hero}>
        <div className={styles.badges}>
          {shell.badges.map((b) => (
            <span
              key={b.label}
              className={
                b.severity === "high"
                  ? styles.badgeHigh
                  : b.severity === "medium"
                    ? styles.badgeMed
                    : styles.badge
              }
            >
              {b.label}
            </span>
          ))}
        </div>

        <h1 className={styles.h1}>{shell.brandName} — full diligence report</h1>

        {/* THE HOOK. Above the counts on purpose: the counts describe what the
            report contains, the hook describes the BUSINESS. A cold ad visitor
            needs the second one before the first means anything, and needs both
            before "Below the disclosed minimum" further down has a referent. */}
        {shell.hook && (
          <HeroHook hook={shell.hook} brandName={shell.brandName} />
        )}

        <p className={styles.heroCounts}>
          <strong>{c.sections}</strong> sections · <strong>{c.figures}</strong>{" "}
          cited figures · <strong>{c.tripwires}</strong> operational tripwires ·{" "}
          <strong>{c.questions}</strong> diligence questions
        </p>

        <p className={styles.heroSub}>
          Everything below is in the report. Every figure is cited to an FDD
          Item and page, and labelled with where the number came from. The
          labels are free. The numbers are what you are buying.
        </p>
      </header>

      {/* ---------- who we are, and what an FDD is ---------- */}
      <WhatThisIs brandName={shell.brandName} />

      {/* ---------- provenance legend: the trust argument, free ---------- */}
      <div className={styles.legend}>
        {(Object.keys(PROVENANCE_LABEL) as Provenance[]).map((k) => (
          <span className={styles.legendItem} key={k}>
            <ProvenanceChip kind={k} />
            <span className={styles.legendText}>{PROVENANCE_LEGEND[k]}</span>
          </span>
        ))}
      </div>

      {/* ---------- quick nav ---------- */}
      {nav.length > 0 && (
        <nav className={styles.nav}>
          {nav.map((s) => (
            <a className={styles.navItem} href={`#${s.id}`} key={s.id}>
              {s.anchor}
            </a>
          ))}
        </nav>
      )}

      {/* ---------- the one free interaction ---------- */}
      {shell.capitalRange && (
        <CapitalVerdict range={shell.capitalRange} onChange={onCapital} />
      )}

      {/* ---------- the report, in full, behind the glass ---------- */}
      {shell.sections.map((s) => (
        <Section section={s} bind={lockedRef} key={s.id} />
      ))}

      {/* ---------- in-flow offer block ----------
          NOTE: priceBlockRef goes HERE, not on the sticky bar. The sticky bar
          is always in the viewport, so binding it would make
          locked_value_engaged.price_in_view permanently true and destroy the
          layout-vs-pricing diagnostic. See HANDOFF §Telemetry. */}
      <div ref={priceBlockRef} className={styles.offer}>
        <h2 className={styles.offerHead}>{copy.headline}</h2>
        <p className={styles.offerSub}>{copy.sub}</p>
        <a className={styles.cta} href={unlockHref} onClick={unlock}>
          Unlock the full report — {PRICE}
        </a>
        <p className={styles.offerFine}>
          One report, one brand, instant access. Not a subscription.
        </p>
      </div>

      {/* ---------- lead capture ----------
          PLACEMENT IS THE DECISION HERE, and it is deliberate on both axes.

          AFTER the offer block, never before. This is a free ask on a page
          whose entire thesis is that the numbers are paid; put it above the
          $199 CTA and it is the first offer the reader meets, and it competes
          with the product for the reader who was closest to buying. Below the
          CTA it only ever catches the visitor who has already scrolled past
          the price without clicking — a reader we currently lose completely.

          ONE surface, not four, and specifically NOT the S2 bottom sheet.
          BrandDetail runs four because a teaser is a browsing page. Glass is a
          single decision. The sheet is also physically unavailable here:
          CaptureSheet renders `fixed inset-x-0 bottom-0 z-[60] max-h-[35dvh]`
          and the traveling unlock bar is bottom-anchored on the same screen —
          on mobile, which is 83% of spend, they occupy the same real estate
          and the sheet would cover the CTA it is meant to back up. (It would
          also never arm: eligible() requires fe_teaser_viewed, which only
          BrandDetail sets. Two independent reasons, same answer.)

          Not wrapped in `shell.capitalRange &&` — capital is optional context
          for the S4 phone gate, not a precondition for taking an email. */}
      <div ref={captureRef} className={styles.capture}>
        <CaptureProvider>
          <EmailCapture
            brandName={shell.brandName}
            brandSlug={brandSlug}
            surface="glass"
            capitalEntered={capital}
            capitalEdited={capitalEdited}
            refTag={refTag}
          />
        </CaptureProvider>
      </div>

      {/* ---------- traveling unlock bar ---------- */}
      <div className={styles.bar} role="complementary">
        <div className={styles.barText}>
          <span className={styles.barHead}>{copy.headline}</span>
          <span className={styles.barSub}>{copy.sub}</span>
        </div>
        <a className={styles.barCta} href={unlockHref} onClick={unlock}>
          Unlock — {PRICE}
        </a>
      </div>
    </div>
  );
}
