"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { applyRentCorrection, applyRentOverride } from "@/lib/rentCorrection";
import { DiligenceModule } from "@/components/DiligenceToVerify";
import { computeVerify, verifyPhrase } from "@/lib/verify";
import { CashLadderSection } from "@/components/CashLadder";
import type { RentResolution } from "@/lib/rent";
import { track } from "@/lib/analytics";
import type { DiligenceResult } from "@/lib/types";
import { recurringFeeDisplays } from "@/lib/fees";
import { BASIS_STYLE, LEGEND_ORDER, basisColor } from "@/lib/basis";
import { range } from "@/lib/range";
// @/lib/severity, NOT @/lib/financialCondition: this is a "use client"
// component and that module exports a 33KB extraction prompt.
import { normalizeSeverity, resolveFinancialContext } from "@/lib/severity";
import { analyzeChurn } from "@/lib/churn";
import { buildCallList } from "@/lib/callList";
// lib/exitTerms.ts imports ONLY a type from lib/schema.ts, so nothing from
// @google/genai reaches this "use client" bundle. Keep it that way.
import { buildLeaving } from "@/lib/exitTerms";
// The registry. Safe in a "use client" bundle: it imports only ./types (types
// only), ./exitTerms, ./callList and ./severity — all four already imported
// above. It is imported here for COPY, not for control flow; each surface
// still decides for itself what to draw.
import { sectionSpec, undisclosedSpec } from "@/lib/sections";

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);

const Card = ({ id, title, children }: { id?: string; title: ReactNode; children: ReactNode }) => (
  <section id={id} className="bg-[#16223B] border border-[#27344F] rounded-xl p-6">
    <h3 className="text-sm font-bold uppercase tracking-wider text-[#38BDF8] mb-4">{title}</h3>
    {children}
  </section>
);

const Src = ({ s }: { s?: string }) =>
  s ? <span className="text-[11px] text-[#8194B0] ml-1">({s})</span> : null;

/**
 * A STRUCTURAL FRAME in the paid report.
 *
 * The section exists in the product for every brand; we did not get a readable
 * table out of THIS filing. Before this component that case rendered as
 * nothing at all — no card, no nav entry, no acknowledgement — which meant a
 * buyer who had paid could not tell the difference between "this franchisor
 * has no post-term covenant" and "we never read the page". Those are opposite
 * facts and silence rendered them identically.
 *
 * TWO THINGS THIS MUST NOT DO.
 *
 * It must not blame the document. "Not in this filing" is a claim about the
 * franchisor's disclosure and we have no basis for it — Item 17 is mandatory,
 * so the near-certain truth is that the table is there and our pass did not
 * resolve it. Saying otherwise is a factual assertion about a named company.
 *
 * It must not sell. No "unlock", no "upgrade", no count of what is missing. The
 * reader already paid. The chips restate what the section covers so the frame
 * is worth the vertical space it takes, and that is all it does.
 *
 * Copy comes from lib/sections.ts so the frame on this page and the frame on
 * the glass teaser describe the section in the same words.
 */
const Frame = ({ id }: { id: string }) => {
  const spec = sectionSpec(id);
  if (!spec) return null;
  return (
    <section
      id={id}
      className="border border-dashed border-[#27344F] rounded-xl p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[#8194B0]">
          {spec.title}
        </h3>
        <span className="text-[11px] italic text-[#8194B0]">
          Not readable in this filing
        </span>
      </div>
      <p className="text-xs text-[#CBD5E1] leading-relaxed">{spec.covers}</p>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {spec.chips.map((c) => (
          <span
            key={c}
            className="text-[11px] text-[#8194B0] border border-dashed border-[#27344F] rounded px-2 py-0.5"
          >
            {c}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-[#8194B0] leading-relaxed mt-4 border-t border-[#27344F] pt-3">
        Our pass did not produce a readable table for this section on this
        document. Nothing has been inferred in its place, and no figure
        elsewhere in this report depends on it. If you want it read, reply to
        the delivery email with the page number and we will run it.
      </p>
    </section>
  );
};

/**
 * THE UNDISCLOSED BLOCK — the franchisor said nothing, and that is the finding.
 *
 * Not a Frame, and the difference is the entire reason both exist. A Frame is an
 * apology for our pass and is styled to recede. This is a result: we read the
 * filing, and the filing exercises a legal right to disclose nothing. For Item
 * 19 that is true of roughly half the franchisors in the country and it is
 * usually the most decision-relevant fact in the document, so it is styled to be
 * read — amber, per LABEL LAW, because it is negative and never red.
 *
 * WHAT THIS MUST NOT DO. It must not read as our failure; the paid reader would
 * reasonably ask for a refund on a section we simply skipped, and this is not
 * that. It must not point the buyer back at the franchisor for numbers — under
 * the FTC Franchise Rule a franchisor with no financial performance
 * representation may not supply earnings figures outside the document at all, so
 * "ask the brand" solicits a violation and sets the buyer up to be sold on a
 * figure with no source. The route out is the Item 20 franchisee list.
 *
 * Copy comes from lib/sections.ts so this block and the glass teaser's state the
 * finding in the same words.
 */
const Undisclosed = ({ id }: { id: string }) => {
  const u = undisclosedSpec(id);
  if (!u) return null;
  return (
    <div className="rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/10 border-l-[3px] border-l-[#F59E0B] p-4">
      <p className="text-sm font-bold text-[#F1F5F9]">{u.heading}</p>
      <p className="text-xs text-[#CBD5E1] leading-relaxed mt-2">{u.body}</p>
      <p className="text-xs text-[#CBD5E1] leading-relaxed mt-3 border-t border-[#F59E0B]/25 pt-3">
        {u.nextStep}
      </p>
    </div>
  );
};

/**
 * A condition-strip pill.
 *
 * `loud` is the whole point of this component. The strip has exactly three
 * pills and the document-warning pill has to win the scan when it fires —
 * filled, bordered, bold — while the other two stay outlined. Equal weight
 * across three pills is what turns a strip into wallpaper.
 */
const Pill = ({
  label,
  color,
  href,
  loud,
}: {
  label: string;
  color: string;
  href?: string;
  loud?: boolean;
}) => {
  const cls = `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] uppercase tracking-wide whitespace-nowrap ${
    loud ? "font-extrabold" : "font-semibold"
  }`;
  const style = loud
    ? { color: "#0B1220", background: color, border: `1px solid ${color}` }
    : { color, background: color + "14", border: `1px solid ${color}55` };
  return href ? (
    <a href={href} className={`${cls} hover:opacity-80`} style={style}>
      {label}
    </a>
  ) : (
    <span className={cls} style={style}>
      {label}
    </span>
  );
};

/* amortize() used to live here — a second copy of the payment formula that
   drifted from lib/ladder.ts. Deleted: every debt figure on this page is now
   READ off the one CashLadder object built in components/CashLadder.tsx. */

// ───────────────────────────────────────────────────────────────────────────
// Item 19 provenance — trace the pro-forma headline back to its disclosed source
//
// The pro-forma top line (s.midCohort.monthlyRevenue) is asserted with no
// lineage today, and when the cohort table renders all-null (median / network
// fallback) the reader has no way to see where the number came from. This
// resolves the source from the disclosed cohort fields and degrades HONESTLY:
// when a figure can't be traced to a disclosed line, it says "verify against the
// FDD" rather than implying a source it can't substantiate.
//
// Forward-compatible: if scoring later stamps s.midCohort.source, that is
// trusted verbatim and this reverse-engineering is skipped.
// ───────────────────────────────────────────────────────────────────────────
type ProvBasis = "disclosed" | "network" | "estimated" | "untraced";

// The extractor populates these Item19Cohort fields (see lib/schema.ts); the
// base view type may not surface all of them, so we read through a local
// optional view. Every field is guarded — missing ones simply drop out.
type CohortView = {
  label?: string | null;
  basis?: string | null;
  avgMonthlyRevenue?: number | null;
  annualRevenue?: number | null;
  monthlyValues?: number[] | null;
  sampleSize?: number | null;
  revenueType?: string | null;
  ownership?: string | null;
  rangePosition?: string | null;
};

const METRIC_LABEL: Record<string, string> = {
  gross_sales: "gross sales",
  net_or_ebitda: "EBITDA / profit",
  pre_sale_only: "pre-opening sales",
  other: "a non-standard metric",
};
const OWNER_LABEL: Record<string, string> = {
  franchised: "franchised units",
  company: "company-owned units",
  affiliate: "affiliate units",
  mixed: "a franchised + company blend",
  unknown: "units of unstated ownership",
};
// within $2 or 2% counts as a match (rounding between annual÷12 and stored monthly)
const approxEq = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.02);

type Provenance = {
  basis: ProvBasis;
  sourceLabel: string | null;
  page?: string;
  math: string | null;
  metric: string | null;
  applicability: string | null;
  sample: number | null;
};

function resolveProvenance(result: DiligenceResult): Provenance | null {
  const s = result.scoring;
  const x = result.extracted;
  const mid = s?.midCohort;
  if (!mid) return null;
  const used = mid.monthlyRevenue;
  const page = x.item19?.sourcePage;

  // 1) Authoritative: if scoring stamped the source at routing time, trust it
  //    verbatim and skip the reverse-engineering below.
  const stamped = (mid as {
    source?: {
      label?: string;
      math?: string | null;
      basis?: ProvBasis;
      revenueType?: string | null;
      ownership?: string | null;
      sample?: number | null;
    } | null;
  }).source;
  if (stamped?.label) {
    return {
      basis: stamped.basis ?? "disclosed",
      sourceLabel: stamped.label,
      page,
      math: stamped.math ?? null,
      metric: stamped.revenueType ? METRIC_LABEL[stamped.revenueType] ?? null : null,
      applicability: stamped.ownership ? OWNER_LABEL[stamped.ownership] ?? null : null,
      sample: stamped.sample ?? null,
    };
  }

  const cohorts = (x.item19?.cohorts ?? []) as CohortView[];

  // 2) The cohort scoring named (match by label).
  const src = cohorts.find((c) => c.label === mid.label) ?? null;
  if (src) {
    const metric = src.revenueType ? METRIC_LABEL[src.revenueType] ?? null : null;
    const applicability = src.ownership ? OWNER_LABEL[src.ownership] ?? null : null;
    let math: string | null = null;
    if (used != null) {
      if (src.avgMonthlyRevenue != null && approxEq(src.avgMonthlyRevenue, used)) {
        math = "disclosed monthly average";
      } else if (src.annualRevenue != null && approxEq(src.annualRevenue / 12, used)) {
        math = `${usd(src.annualRevenue)}/yr ÷ 12`;
      } else if (src.monthlyValues && src.monthlyValues.length) {
        const avg = src.monthlyValues.reduce((a, b) => a + b, 0) / src.monthlyValues.length;
        if (approxEq(avg, used)) math = `average of ${src.monthlyValues.length} disclosed monthly figures`;
      }
    }
    return { basis: "disclosed", sourceLabel: src.label ?? mid.label, page, math, metric, applicability, sample: src.sampleSize ?? null };
  }

  // 3) Not a named cohort — is it the network average of all disclosed cohorts?
  const net = (x.item19 as { networkAverageMonthly?: number | null } | undefined)?.networkAverageMonthly ?? null;
  if (net != null && used != null && approxEq(net, used)) {
    return { basis: "network", sourceLabel: "network average of disclosed Item 19 cohorts", page, math: null, metric: null, applicability: null, sample: null };
  }

  // 4) Couldn't trace it. Be honest: estimated (no Item 19 at all) vs untraced.
  return { basis: x.item19?.hasItem19 ? "untraced" : "estimated", sourceLabel: null, page, math: null, metric: null, applicability: null, sample: null };
}

function ProvenanceNote({ result }: { result: DiligenceResult }) {
  const p = resolveProvenance(result);
  if (!p) return null;

  // Honest fallback — figure is NOT a traced disclosed number.
  if (p.basis === "estimated" || p.basis === "untraced") {
    return (
      <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-300">How this is calculated</p>
        <p className="mt-0.5 text-[12px] leading-snug text-[#E8C97A]">
          {p.basis === "estimated"
            ? "No Item 19 earnings were disclosed — this top line is an industry estimate, not a disclosed figure. Verify against the FDD before relying on it."
            : `This figure couldn't be traced to a specific disclosed Item 19 line${p.page ? ` (${p.page})` : ""} — verify it against the FDD.`}
        </p>
      </div>
    );
  }

  const axisBits = [p.applicability, p.metric].filter(Boolean).join(" · ");
  return (
    <div className="mt-2 rounded-lg border border-[#27344F] bg-[#0B1220] px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#38BDF8]">How this is calculated</p>
      <p className="mt-0.5 text-[12px] leading-snug text-[#CBD5E1]">
        Source: <span className="font-medium text-[#F1F5F9]">Item 19 — {p.sourceLabel}</span>
        {p.page ? <span className="text-[#8194B0]"> ({p.page})</span> : null}
        {p.sample != null ? <span className="text-[#8194B0]"> · {p.sample} units</span> : null}
        {p.math ? (
          <>
            {" · "}
            <span className="text-[#F1F5F9]">{p.math}</span>
          </>
        ) : null}
      </p>
      {axisBits ? <p className="mt-0.5 text-[11px] text-[#8194B0]">Basis: {axisBits}</p> : null}
      <p className="mt-1 text-[10px] text-[#5A6B88]">
        Disclosed figure extracted from the FDD — confirm against the source before relying on it.
      </p>
    </div>
  );
}

export default function DiligenceReport({ result: rawResult }: { result: DiligenceResult }) {
  // Rent-resolver hotfix: stored results were scored with rent silently $0 when
  // averageRentMonthly was null. Correct the economics at render (risk level is
  // NOT re-scored — it stays consistent with the public brand card).
  const baseResult = useMemo(() => applyRentCorrection(rawResult), [rawResult]);
  // Rent override — the third basis ("your input"). Session-local; the buyer's
  // number flows through the FULL recompute chain like the resolved mid.
  const [rentOverride, setRentOverride] = useState<number | null>(null);
  const [rentEditing, setRentEditing] = useState(false);
  const [rentDraft, setRentDraft] = useState<string>("");
  const lastOverrideFired = useRef<number | null>(null);
  const result = useMemo(
    () => (rentOverride != null ? applyRentOverride(baseResult, rentOverride) : baseResult),
    [baseResult, rentOverride],
  );
  const { extracted: x, scoring: s, underwriting: u } = result;
  // baseline (pre-override) resolution — drives the edit affordance + reset copy
  const baselineRent =
    (baseResult.scoring as { rentResolution?: RentResolution | null }).rentResolution ?? null;
  const rent = (s as { rentResolution?: RentResolution | null }).rentResolution ?? null;
  /* fixedFees was the pro forma's own flat-fee subtotal. Rung 3 of the ladder
     is the only place that figure is computed now. */

  const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const commitRentOverride = (raw: number) => {
    if (!baselineRent || !Number.isFinite(raw)) return;
    const clamped = Math.min(200_000, Math.max(200, Math.round(raw)));
    setRentOverride(clamped);
    setRentDraft(clamped.toLocaleString("en-US"));
    if (lastOverrideFired.current !== clamped) {
      lastOverrideFired.current = clamped;
      track("rent_override_set", {
        brand_slug: slugify(x.brandName || "unknown"),
        baseline_basis: baselineRent.basis === "disclosed" ? "disclosed" : "estimated",
        baseline_mid: baselineRent.mid,
        override_value: clamped,
      });
    }
  };
  const resetRentOverride = () => {
    setRentOverride(null);
    setRentDraft("");
    setRentEditing(false);
    lastOverrideFired.current = null;
    track("rent_override_reset", {});
  };
  const rentWarn =
    rentOverride != null && baselineRent != null &&
    (rentOverride > baselineRent.mid * 3 || rentOverride < baselineRent.mid / 3);
  const ins = result.insights ?? null;
  const fc = result.financialCondition ?? null;
  // Persisted severities are NOT guaranteed to be in the Severity union — two
  // catalog records carry 'INSUFFICIENT' and used to crash this component on
  // the object-literal lookups below. Resolve once, here, and index with this.
  const fcSeverity = fc ? normalizeSeverity(fc.severity) : null;
  // Persisted context paragraphs are NOT guaranteed to agree with the figures
  // beside them — 21 of 29 assert losses or a deficit the record cannot
  // support. Resolve once, here, and render this.
  const fcContext = fc ? resolveFinancialContext(fc.context, fc.metrics) : null;
  const fees = recurringFeeDisplays(x);

  // Financial Condition (rendered below) now owns this topic, so drop the
  // boilerplate "Financial Condition" special-risk from the tripwires list —
  // otherwise the same concern gets reported twice, in two different voices.
  const tripwires = (x.operationalRisks ?? []).filter(
    (r) => !(fc && /financial condition/i.test(r.title)),
  );

  // Risk Reframe — the paid report's summary reframes to "N things to verify"
  // (same shared component + same computeVerify as every teaser, so the drift
  // audit holds). The DETAILED findings below (Financial Condition, tripwires)
  // still render at full strength — we reframe the summary, never the findings.
  const verify = computeVerify(s.riskReasons);

  // The debt-service model now lives in <CashLadderSection>, which owns the
  // loan / rate / term state AND the single CashLadder object every figure is
  // read off. This component no longer does financial arithmetic.

  // Financial-condition detail is collapsed by default — the headline and the
  // for/against lists already carry the severity; the body is opt-in.
  const [fcOpen, setFcOpen] = useState<boolean>(false);

  // ── The condition strip ──────────────────────────────────────────────────
  // Three pills, warnings first and warnings loudest. NEVER a fourth: three is
  // a scan, four is decoration a reader trains past by page three.
  //
  // The strip carries what is wrong with the DOCUMENT and the DISCLOSURE. Deal
  // shape — all cash, financed, how big the loan is — is NOT a condition and
  // belongs in the financing card, not up here.
  //
  // docWarnCount counts exactly the <li> elements the warnings section renders,
  // so the pill's number always equals the list the reader lands on.
  const docWarnCount =
    (x.documentCheck?.appearsComplete === false ? 1 : 0) +
    (x.documentCheck?.appearsScanned ? 1 : 0) +
    (x.documentCheck?.warnings?.length ?? 0);
  const hasWarnings = docWarnCount > 0;
  const fcPill = fc
    ? ({
        HIGH: { label: "Franchisor financials: high concern", color: "#F5B847" },
        MEDIUM: { label: "Franchisor financials: worth a look", color: "#F5B847" },
        LOW: { label: "No franchisor distress signals", color: "#34D399" },
        INSUFFICIENT_DATA: { label: "Franchisor financials not assessable", color: "#8194B0" },
      } as const)[fcSeverity ?? "INSUFFICIENT_DATA"]
    : { label: "Franchisor financials not assessable", color: "#8194B0" };
  // Unchanged semantics: INSUFFICIENT_DATA still renders a section ("Not enough
  // data"), so the pill still links to it. Only the lookup key is normalised.
  const fcLinked = !!fc && fcSeverity !== "LOW";

  // Item 17. Derived once: the nav entry and the section have to agree, and the
  // only way to guarantee that is one source for both.
  const leaving = buildLeaving(x.exitTerms);

  const NAV = [
    { href: "#item7", label: "What it costs" },
    { href: "#underwriting", label: "Buyer fit" },
    { href: "#ladder", label: "Cash ladder" },
    { href: "#financing", label: "Financing" },
    { href: "#fees", label: "Fees" },
    { href: "#item19", label: "Item 19" },
    { href: "#warnings", label: "Document" },
    { href: "#risks", label: "To verify" },
    { href: "#leaving", label: "Leaving" },
    // #leaving is NO LONGER conditional. The section renders for every record
    // now — as the table when we read it, as a frame when we did not — so the
    // nav entry always has a target. This mirrors navAnchor() in
    // lib/sections.ts, which the glass teaser uses; the two surfaces have to
    // make the identical nav decision or the product looks different before
    // and after payment.
  ].filter((n) => (n.href === "#warnings" ? hasWarnings : true));

  // Rent lives on rung 4 of the ladder now — the buyer edits the number where
  // they read it. State stays here; the controls are passed down as nodes.
  const rentNote = rent ? (
    <p className="text-[10px] text-[#8194B0] leading-relaxed">
      {rent.basis === "override"
        ? `Your figure — the ${baselineRent?.basis === "disclosed" ? "disclosed" : "estimated"} baseline was ${usd(baselineRent?.mid ?? null)}. Local quotes beat national averages; use your broker's number.`
        : rent.basis === "disclosed"
          ? `Disclosed — ${rent.source}.`
          : `${rent.basis === "disclosed_range" ? "Disclosed range" : "Category occupancy estimate"} — ${rent.source}; the model uses the midpoint (${usd(rent.mid)}).`}
    </p>
  ) : null;

  const rentControl = rent ? (
    <div className="mt-1 space-y-1">
      {rent.basis !== "override" && baselineRent && (
        <button
          type="button"
          onClick={() => {
            setRentEditing((v) => !v);
            setRentDraft(Math.round(baselineRent.mid).toLocaleString("en-US"));
          }}
          className="text-[10px] font-bold text-[#38BDF8] hover:underline"
        >
          ✎ Adjust for your market
        </button>
      )}
      {rent.basis === "override" && (
        <button
          type="button"
          onClick={resetRentOverride}
          className="text-[10px] font-bold text-[#38BDF8] hover:underline"
        >
          Reset to {baselineRent?.basis === "disclosed" ? "disclosed" : "estimate"}
        </button>
      )}
      {rentEditing && rent.basis !== "override" && baselineRent && (
        <RentOverrideEditor
          baseline={baselineRent}
          draft={rentDraft}
          setDraft={setRentDraft}
          onCommit={commitRentOverride}
          onCancel={() => setRentEditing(false)}
        />
      )}
      {rentWarn && (
        <p className="text-[10px] text-amber-300">
          That&apos;s far from the disclosed/estimated range for this concept — double-check the quote
          covers the same square footage.
        </p>
      )}
    </div>
  ) : null;

  return (
    <div id="report-root" className="space-y-5 text-[#F1F5F9]">
      {/* The jump nav is sticky at 52px, so an anchored section has to clear
          both it and the app chrome above it or the heading lands underneath. */}
      {/* Two mobile rules live here because they are page-level, not component-level.
          scroll-margin: the jump nav is sticky at 52px, so an anchored section has
          to clear both it and the app chrome or the heading lands underneath it.
          padding-bottom: Safari's URL bar overlays the bottom of the viewport, and
          it was eating the last row of the Item 7 table on every phone. */}
      <style>{`#report-root section[id]{scroll-margin-top:112px}
#report-root{padding-bottom:calc(4rem + env(safe-area-inset-bottom))}`}</style>

      {/* Header + condition strip */}
      <div className="bg-[#0B1220] border border-[#27344F] rounded-xl p-6">
        <h2 className="text-2xl font-bold">{x.brandName || "Franchise"} — Diligence Report</h2>
        <p className="text-sm text-[#8194B0] mt-1">
          {x.franchisorEntity}
          {x.headquarters ? ` · ${x.headquarters}` : ""}
        </p>
        {/* DEAL SHAPE lives here, not in the strip. The strip is for what is
            wrong with the document; how you fund the deal is not a defect. */}
        {s.buildoutMidpoint != null && (
          <p className="text-xs text-[#8194B0] mt-2 leading-relaxed">
            Built on the Item 7 mid-point of {usd(s.buildoutMidpoint)}.{" "}
            {(u.recommendedLoan ?? 0) > 0
              ? `Your capital leaves a ${usd(u.capitalGap)} gap, so the ladder opens financed at that amount — move the slider to model it differently.`
              : "Your capital covers it, so the ladder opens all cash — move the slider to see what borrowing would cost."}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Pill
            loud={hasWarnings}
            color={hasWarnings ? "#F59E0B" : "#34D399"}
            href={hasWarnings ? "#warnings" : undefined}
            label={
              hasWarnings
                ? `${docWarnCount} document warning${docWarnCount === 1 ? "" : "s"}`
                : "Document reads complete"
            }
          />
          <Pill color="#F5B847" href="#risks" label={verifyPhrase(verify.verifyCount)} />
          <Pill color={fcPill.color} href={fcLinked ? "#condition" : undefined} label={fcPill.label} />
        </div>
      </div>

      {/* Jump nav */}
      <nav
        className="sticky z-20 rounded-xl border border-[#27344F] bg-[#0B1220]/95 px-3 py-2 backdrop-blur"
        style={{ top: 52 }}
      >
        <ul className="flex gap-1 overflow-x-auto text-[11px] font-semibold">
          {NAV.map((n) => (
            <li key={n.href}>
              <a
                href={n.href}
                className="block whitespace-nowrap rounded-lg px-2.5 py-1 text-[#8194B0] hover:bg-[#16223B] hover:text-[#38BDF8]"
              >
                {n.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Initial investment (Item 7 in an FDD; the schema field is named item17
          for legacy reasons — the Src below shows the real Item 7 page). */}
      <Card id="item7" title={<>Initial Investment <Src s={x.item17?.sourcePage} /></>}>
        <p className="text-sm text-[#CBD5E1] mb-3">
          Estimated total:{" "}
          <span className="font-semibold whitespace-nowrap">
            {range(usd(x.item17?.initialInvestmentLow), usd(x.item17?.initialInvestmentHigh))}
          </span>
        </p>
        <CostGroup title="Non-recurring (build-out)" items={x.item17?.lineItems?.filter((l) => !l.recurring) ?? []} />
        <CostGroup title="Recurring (ongoing)" items={x.item17?.lineItems?.filter((l) => l.recurring) ?? []} />
      </Card>

      {/* Buyer-fit underwriting (the killer feature) */}
      <section
        id="underwriting"
        className={`border-l-4 rounded-xl p-6 bg-[#16223B] ${
          u.sbaLoanRequired ? "border-amber-400" : "border-[#34D399]"
        }`}
      >
        <h3 className="text-sm font-bold uppercase tracking-wider text-[#38BDF8] mb-3">
          Buyer-Fit Underwriting
        </h3>
        <p className="text-[#CBD5E1] leading-relaxed">{u.assessment}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          <Stat label="Capital Gap" value={usd(u.capitalGap)} />
          <Stat label="Loan Needed" value={u.sbaLoanRequired ? "Yes" : "No"} />
          <Stat
            label="Net Worth Req."
            value={
              u.meetsNetWorthRequirement == null ? "—" : u.meetsNetWorthRequirement ? "Met" : "Short"
            }
          />
          {/*
            THIS TILE USED TO SAY "NET CASH FLOW" AND IT WAS NOT NET OF MUCH.
            u.adjustedMonthlyNetCashFlow is scoring.midCohort.monthlyEbitda −
            debt service, and midCohort.monthlyEbitda is RUNG 5 — margin after
            fees and rent, before cost of goods and before labor. Calling that
            "net cash flow" is how the report ended up publishing $19,638 two
            cards above a ladder that lands at −$9,330.

            Recomputing it off the ladder is the right fix, but underwrite()
            runs at extraction time on stored data and its output is persisted,
            so changing the arithmetic re-dates every report already sold
            (FE-101 blast radius — Jason's call, still open). What is free and
            correct today is to stop mislabelling it: name the rung it actually
            is, and hand the reader down to the ladder for the rest.
          */}
          {/* No tone. A green number here is a verdict, and this figure is an
              intermediate rung, not a verdict — the hero of the ladder is.
              Colouring it good was how $19,638 read as the answer. */}
          <Stat label="After fees, rent & debt" value={usd(u.adjustedMonthlyNetCashFlow)} />
        </div>
        {u.adjustedMonthlyNetCashFlow != null && (
          <p className="mt-3 text-[11px] leading-relaxed text-[#8194B0]">
            That last figure is rung 5 of the ladder minus a debt payment — cost of goods and
            labor have not come out of it yet.{" "}
            <a href="#ladder" className="font-bold text-[#38BDF8] hover:underline">
              The cash ladder below subtracts them ▾
            </a>
          </p>
        )}
      </section>

      {/* The cash ladder + financing — FE-111.
          ONE CashLadder object per render. Every figure from rung 1 to rung 13,
          including debt service, DSCR and payback, is READ off that object.
          This component does no financial arithmetic of its own any more. */}
      <CashLadderSection
        result={result}
        provenance={<ProvenanceNote result={result} />}
        rentNote={rentNote}
        rentControl={rentControl}
      />

      {/* Fees + hidden costs */}
      <Card id="fees" title="Ongoing Fees & Hidden Costs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2 text-sm">
            <FeeRow label="Royalty" d={fees.royalty} />
            <FeeRow label="Brand fund" d={fees.brandFund} />
            <FeeRow label="Local ad" d={fees.localAd} />
            {x.ongoingFees?.flatMonthlyFees?.map((ff, i) => (
              <Row key={i} label={<>{ff.name} <Src s={ff.source} /></>} value={`${usd(ff.monthlyAmount)}/mo`} />
            ))}
          </div>
          <div className="space-y-3">
            {(x.hiddenCosts ?? []).map((h, i) => (
              <div key={i} className="border border-[#27344F] rounded-lg p-3">
                <p className="text-sm font-semibold text-amber-300">
                  {h.name} {h.estimatedAnnualAmount != null ? `· ${usd(h.estimatedAnnualAmount)}/yr` : ""}
                </p>
                <p className="text-xs text-[#CBD5E1] mt-1">{h.description}</p>
                <Src s={h.source} />
              </div>
            ))}
            {(x.hiddenCosts?.length ?? 0) === 0 && (
              <p className="text-sm text-[#8194B0]">No ancillary/hidden costs flagged.</p>
            )}
          </div>
        </div>
      </Card>

      {/* Item 19 cohorts */}
      <Card id="item19" title={<>Item 19 — Financial Performance <Src s={x.item19?.sourcePage} /></>}>
        {x.item19?.hasItem19 ? (
          <div className="space-y-2">
            {x.item19.cohorts.map((c, i) => {
              const cv = c as CohortView;
              // Match the pro-forma "basis" cohort by LABEL only. Its display value
              // (avgMonthlyRevenue) is frequently null even when scoring derived a
              // usable monthly figure (annual ÷ 12, median, etc.), so the old
              // value-equality test silently failed on exactly those reports.
              const isBasis = !!s.midCohort && c.label === s.midCohort.label;
              // Best monthly figure to SHOW for this row: disclosed avg → annual ÷ 12
              // → (for the basis row only) the figure the pro forma actually used.
              const derivedMonthly =
                cv.avgMonthlyRevenue != null
                  ? cv.avgMonthlyRevenue
                  : cv.annualRevenue != null
                    ? cv.annualRevenue / 12
                    : isBasis
                      ? s.midCohort!.monthlyRevenue
                      : null;
              const annualNote = cv.avgMonthlyRevenue == null && cv.annualRevenue != null;
              if (isBasis) {
                return (
                  <div key={i} className="rounded-lg border border-[#38BDF8]/50 bg-[#38BDF8]/10 px-3 py-2">
                    <div className="flex justify-between items-baseline gap-3">
                      <span className="text-sm font-semibold text-[#F1F5F9]">
                        {c.label}
                        {c.basis ? ` — ${c.basis}` : ""}
                      </span>
                      <span className="text-sm font-bold text-[#38BDF8] whitespace-nowrap">
                        {usd(derivedMonthly)}/mo
                        {annualNote ? (
                          <span className="text-[10px] font-normal text-[#8194B0]"> (annual ÷ 12)</span>
                        ) : null}
                      </span>
                    </div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#38BDF8] mt-1">
                      {/* Named the pro forma until FE-115 deleted that card. The
                          reader now scrolls up into the cash ladder, so the
                          pointer has to name what is actually up there. */}
                      ◄ Rung 1 of the cash ladder above — the franchised, apples-to-apples number
                    </p>
                  </div>
                );
              }
              return (
                <Row
                  key={i}
                  label={`${c.label}${c.basis ? ` — ${c.basis}` : ""}${annualNote ? " (annual ÷ 12)" : ""}`}
                  value={`${usd(derivedMonthly)}/mo`}
                />
              );
            })}
            {x.item19.notes && <p className="text-xs text-[#8194B0] mt-2">{x.item19.notes}</p>}
          </div>
        ) : (
          /* Was a single amber sentence. It stated the fact and then stranded
             the reader — no explanation of why the silence is informative, and
             no lawful route to the number they came for. See Undisclosed. */
          <Undisclosed id="item-19" />
        )}
      </Card>

      {/* Franchise Edge · Insights — operating benchmarks the FDD can't disclose */}
      {ins && (() => {
        const b = ins.benchmark;
        const cc = ({
          consistent: { color: "#34D399", heading: "Consistent with industry norms" },
          optimistic: { color: "#F59E0B", heading: "Optimistic vs. industry norms" },
          conservative: { color: "#60A5FA", heading: "Conservative vs. industry norms" },
          no_disclosure: { color: "#8194B0", heading: "No margin disclosed in Item 19" },
        } as const)[ins.crossCheck.status];
        return (
          <Card title="Franchise Edge · Insights">
            <div className="space-y-4">
              <p className="text-xs text-[#8194B0]">
                Classified as{" "}
                <span className="text-[#CBD5E1] font-semibold">{ins.conceptLabel}</span>
                {ins.conceptRationale ? ` — ${ins.conceptRationale}` : ""}. An FDD discloses
                fees and investment, never the franchisee&apos;s operating costs. Here is what
                to budget for and verify.
              </p>

              {ins.staffingNote && (
                <div className="rounded-lg border border-[#60A5FA]/30 bg-[#60A5FA]/10 p-3">
                  <p className="text-[11px] font-bold uppercase text-[#60A5FA]">
                    Operating model: {ins.staffingLabel}
                  </p>
                  <p className="text-xs text-[#CBD5E1] mt-1">{ins.staffingNote}</p>
                </div>
              )}

              {/* disclosed-margin cross-check */}
              <div
                className="rounded-lg border p-3"
                style={{ borderColor: cc.color + "66", background: cc.color + "14" }}
              >
                <p className="text-[11px] font-bold uppercase" style={{ color: cc.color }}>
                  {cc.heading}
                </p>
                <p className="text-xs text-[#CBD5E1] mt-1">{ins.crossCheck.message}</p>
              </div>

              {/* assumptions legend — provenance key, placed ABOVE the build-up so
                  the reader knows how to read the numbers before seeing them */}
              {ins.assumptions && ins.assumptions.length > 0 && (
                <div className="rounded-lg border border-[#27344F]">
                  <p className="text-[10px] uppercase text-[#8194B0] px-3 pt-3">
                    How to read the numbers below — disclosed vs. estimated
                  </p>
                  <div className="p-3 space-y-2">
                    {ins.assumptions.map((a, i) => {
                      /* Palette from lib/basis.ts. This map used to be declared
                         inline with benchmark = #F59E0B, while CashLadder.tsx
                         declared benchmark = #A78BFA — the same word in two
                         colours on one page, and one of them was the warning
                         colour. Both surfaces now read the same module. */
                      const tag = BASIS_STYLE[a.basis];
                      return (
                        <div key={i} className="flex items-baseline gap-2">
                          <span
                            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                            style={{ color: tag.color, background: tag.color + "1A", border: `1px solid ${tag.color}55` }}
                          >
                            {tag.word}
                          </span>
                          <span className="text-[11px] text-[#CBD5E1]">
                            <span className="text-white font-medium">{a.field}:</span> {a.detail}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Definitions come from the same module as the chips, so a
                      term can never be defined in one colour and chipped in
                      another. */}
                  <p className="text-[9px] text-[#64748B] px-3 pb-3 leading-relaxed">
                    {LEGEND_ORDER.map((b, i) => (
                      <span key={b}>
                        {i > 0 ? " · " : ""}
                        <span style={{ color: BASIS_STYLE[b].color }}>{BASIS_STYLE[b].word}</span>
                        {" = "}
                        {BASIS_STYLE[b].definition}
                      </span>
                    ))}
                  </p>
                </div>
              )}

              {/* transparent build-up to true operating EBITDA — show the math */}
              {ins.buildup.length > 0 && (
                <div className="rounded-lg border border-[#27344F]">
                  <p className="text-[10px] uppercase text-[#8194B0] px-3 pt-3">
                    How we get to true operating EBITDA
                  </p>
                  <div className="p-3 space-y-1.5">
                    {ins.buildup.map((r, i) => {
                      const isResult = r.kind === "result";
                      const dollar = r.dollarRange
                        ? r.dollarRange[0] === r.dollarRange[1]
                          ? usd(r.dollarRange[0])
                          : `${usd(r.dollarRange[0])}–${usd(r.dollarRange[1])}`
                        : "";
                      const pct = r.pctRange ? `${r.pctRange[0]}–${r.pctRange[1]}%` : "";
                      /* Colour each value by provenance, from the same palette
                         as the chips and the definitions above. */
                      const valColor = r.basis
                        ? basisColor(r.basis)
                        : isResult
                          ? BASIS_STYLE.disclosed.color
                          : "#CBD5E1";
                      return (
                        <div key={i} className={isResult ? "pt-2 mt-1 border-t border-[#27344F]" : ""}>
                          <div className="flex justify-between items-baseline gap-3">
                            <span className={`text-xs ${isResult ? "font-semibold text-white" : "text-[#CBD5E1]"}`}>
                              {r.label}
                            </span>
                            <span className="text-xs whitespace-nowrap">
                              {pct && <span className="mr-2" style={{ color: valColor }}>{pct}</span>}
                              {dollar && (
                                <span className={isResult ? "font-bold" : ""} style={{ color: valColor }}>
                                  {dollar}/mo
                                </span>
                              )}
                            </span>
                          </div>
                          {r.note && <p className="text-[10px] text-[#8194B0] mt-0.5">{r.note}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-[#8194B0]">
                {ins.trueEbitdaBasis === "modeled"
                  ? `Dollar figures use the midpoint of each category band (the % ranges show the spread); your unit's actuals will vary. Labor headcount implied at ~$20/hr fully loaded. Rent and franchise fees are already inside the margin line above.`
                  : ins.trueEbitdaBasis === "disclosed"
                  ? "True operating EBITDA here uses the franchisor's own disclosed margin, applied to the modeled franchised gross."
                  : ""}
              </p>

              {/* contact hook → territory consulting */}
              <div className="rounded-lg border border-[#34D399]/30 bg-[#34D399]/5 p-3">
                <p className="text-xs text-[#CBD5E1]">{ins.consultCtaPitch}</p>
                {ins.consultCtaUrl && (
                  <a
                    href={ins.consultCtaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-xs font-semibold text-[#0B1220] bg-[#34D399] rounded-md px-3 py-1.5"
                  >
                    {ins.consultCtaLabel} →
                  </a>
                )}
              </div>

              <div className="text-xs text-[#CBD5E1] space-y-2">
                <p>
                  <span className="font-semibold text-white">What actually decides the deal:</span>{" "}
                  {b.dominantRisk}
                </p>
                <p>
                  <span className="font-semibold text-white">Ramp:</span> {b.rampNote}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase text-[#8194B0] mb-2">
                  Critical considerations — {ins.conceptLabel}
                </p>
                <ul className="space-y-1.5">
                  {b.considerations.map((c, i) => (
                    <li key={i} className="text-xs text-[#CBD5E1] flex gap-2">
                      <span className="text-[#34D399]">›</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[10px] text-[#64748B] border-t border-[#27344F] pt-2">
                {ins.disclaimer}
                {ins.disclosedMarginSource ? ` Disclosed-margin basis: ${ins.disclosedMarginSource}.` : ""}{" "}
                ({ins.asOf})
              </p>
            </div>
          </Card>
        );
      })()}

      {/* Who to call — the executable half of "validate with existing franchisees".
          No names are stored or rendered: the buyer already holds the FDD, and the
          franchisor is required to print the roster in it. What we add is which
          groups are worth an afternoon and what question opens each one. */}
      {(() => {
        const cl = buildCallList({
          totalUnits: x.systemScale?.totalUnits,
          closedLastYear: x.systemScale?.closedLastYear,
          transfersLastYear: x.systemScale?.transfersLastYear,
          item20Page: x.systemScale?.sourcePage,
          cohorts: x.item19?.cohorts,
          item19Page: x.item19?.sourcePage,
        });
        return (
          <Card id="calls" title="Who To Call, And What To Ask">
            {cl.available ? (
              <>
                <p className="text-xs text-[#CBD5E1] leading-relaxed">{cl.intro}</p>
                <div className="mt-5 space-y-5">
                  {cl.cohorts.map((c) => (
                    <div key={c.key} className="border border-[#27344F] rounded-lg p-4">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-sm font-semibold text-[#F1F5F9]">{c.title}</span>
                        {c.count != null && (
                          <span className="text-lg font-bold text-[#F1F5F9] tabular-nums">
                            {c.count.toLocaleString()}
                          </span>
                        )}
                        <span
                          className="text-[10px] tracking-wider font-semibold border rounded px-1.5 py-0.5"
                          style={{
                            color: basisColor(c.basis),
                            borderColor: `${basisColor(c.basis)}33`,
                            backgroundColor: `${basisColor(c.basis)}14`,
                          }}
                        >
                          {BASIS_STYLE[c.basis].label}
                        </span>
                      </div>
                      <p className="text-xs text-[#CBD5E1] mt-2 leading-relaxed">{c.who}</p>
                      <p className="text-xs text-[#CBD5E1] mt-3 border-l-2 border-[#38BDF8]/50 pl-3 leading-relaxed">
                        {c.why}
                      </p>
                      <ol className="mt-3 space-y-1.5">
                        {c.questions.map((q, i) => (
                          <li key={i} className="flex gap-2 text-xs text-[#CBD5E1] leading-relaxed">
                            <span className="text-[#8194B0] tabular-nums shrink-0">{i + 1}.</span>
                            <span>{q}</span>
                          </li>
                        ))}
                      </ol>
                      {c.where && (
                        <p className="text-[11px] text-[#8194B0] mt-3 leading-relaxed">{c.where}</p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-[#8194B0] mt-4 leading-relaxed">{cl.note}</p>
              </>
            ) : (
              <p className="text-xs text-[#CBD5E1] leading-relaxed">{cl.unavailable}</p>
            )}
          </Card>
        );
      })()}

      {/* Document warnings */}
      {(!x.documentCheck?.appearsComplete ||
        x.documentCheck?.appearsScanned ||
        (x.documentCheck?.warnings?.length ?? 0) > 0) && (
        <section id="warnings" className="border border-amber-500/40 bg-amber-500/10 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-300 mb-1">Document check</p>
          <ul className="text-sm text-amber-200/90 list-disc pl-5 space-y-1">
            {!x.documentCheck.appearsComplete && (
              <li>The document may be incomplete or truncated — verify core Items are present.</li>
            )}
            {x.documentCheck.appearsScanned && (
              <li>This looks like a scanned PDF; extraction accuracy may be lower.</li>
            )}
            {x.documentCheck.warnings?.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
          <p className="text-xs text-[#8194B0] mt-2">Items found: {x.documentCheck.itemsFound?.join(", ") || "—"}</p>
        </section>
      )}

      {/* Risk summary — reframed to "N things to verify" (shared component).
          The full reasons stay below as paid detail; findings render at full
          strength further down. No bare red "HIGH" on the summary. */}
      <DiligenceModule readout={{ ...verify, risk: s.riskLevel }} />
      <section id="risks" className="border border-[#27344F] bg-[#0B1220] rounded-xl px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8194B0]">
          What drove the count
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-[#CBD5E1]">
          {s.riskReasons.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-[#8194B0]">
          Computed from disclosed assumptions (DSCR, rent share, payback, cohort survival) — a to-do
          list to verify before you sign, not a statement of fact about the franchisor.
        </p>
      </section>

      {/* Financial Condition — code-graded severity from Item 21 / Exhibit F,
          not the franchisor's boilerplate. Suppressed when the read is LOW. */}
      {fc && fcSeverity !== "LOW" && (() => {
        const sev = ({
          HIGH: { color: "#F87171", label: "High concern", cls: "border-red-500/40 bg-red-500/10" },
          MEDIUM: { color: "#FBBF24", label: "Worth a closer look", cls: "border-amber-500/40 bg-amber-500/10" },
          LOW: { color: "#34D399", label: "No distress signals", cls: "border-[#34D399]/40 bg-[#34D399]/10" },
          INSUFFICIENT_DATA: { color: "#8194B0", label: "Not enough data", cls: "border-[#27344F] bg-[#16223B]" },
        } as const)[fcSeverity ?? "INSUFFICIENT_DATA"];
        return (
          <section id="condition" className={`border rounded-xl p-6 ${sev.cls}`}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: sev.color }}>
                Financial Condition of the Franchisor
              </h3>
              <span
                className="text-[10px] font-bold uppercase px-2 py-0.5 rounded whitespace-nowrap"
                style={{ color: sev.color, background: sev.color + "1A", border: `1px solid ${sev.color}55` }}
              >
                {sev.label}
              </span>
            </div>

            <p className="mt-3 text-sm font-medium text-[#F1F5F9] leading-relaxed">{fc.headline}</p>

            {fcContext && (
              <div className="mt-3 rounded-lg border border-[#60A5FA]/40 bg-[#60A5FA]/10 px-3 py-2">
                <p className="text-xs text-[#CBD5E1] leading-relaxed">{fcContext}</p>
              </div>
            )}

            {(fc.aggravators.length > 0 || fc.mitigants.length > 0) && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fc.aggravators.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase text-red-300/80 mb-1">Weighing against</p>
                    <ul className="space-y-1">
                      {fc.aggravators.map((a, i) => (
                        <li key={i} className="text-[11px] text-[#CBD5E1] flex gap-1.5">
                          <span className="text-red-400">▼</span>
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {fc.mitigants.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase text-[#34D399]/80 mb-1">In its favor</p>
                    <ul className="space-y-1">
                      {fc.mitigants.map((m, i) => (
                        <li key={i} className="text-[11px] text-[#CBD5E1] flex gap-1.5">
                          <span className="text-[#34D399]">▲</span>
                          <span>{m}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {fc.body.length > 0 && (
              <>
                <button
                  onClick={() => setFcOpen((o) => !o)}
                  className="mt-4 text-xs font-semibold text-[#38BDF8] hover:underline"
                >
                  {fcOpen ? "Hide detail ▲" : "Tell me more ▼"}
                </button>
                {fcOpen && (
                  <div className="mt-2 space-y-2">
                    {fc.body.map((p, i) => (
                      <p key={i} className="text-xs text-[#CBD5E1] leading-relaxed">
                        {p}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}

            <p className="mt-3 text-[10px] text-[#8194B0] leading-relaxed border-t border-[#27344F]/60 pt-2">
              {fc.evidenceNote}
            </p>
          </section>
        );
      })()}

      {/* Leadership. Structural — see lib/sections.ts. 2 of 83 records carry no
          leadership block; those get the frame rather than a hole. */}
      {(x.leadership?.length ?? 0) === 0 ? (
        <Frame id="leadership" />
      ) : (
        <Card title="Franchisor Leadership">
          <div className="space-y-3">
            {x.leadership.map((m, i) => (
              <div key={i}>
                <p className="text-sm font-semibold">
                  {m.name} <span className="text-[#8194B0] font-normal">· {m.role}</span>
                </p>
                <p className="text-xs text-[#CBD5E1]">{m.background}</p>
                {m.whyItMatters && <p className="text-xs text-[#38BDF8] mt-0.5">Why it matters: {m.whyItMatters}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* System scale & turnover.
          Four bare counts with no denominator was the old card: "9 closed" reads
          one way on 1,100 units and another on 40, and the page left that
          division to the reader. lib/churn.ts does it, on outlets open at the
          START of the year — see that module for why the year-end headline count
          is the wrong base. Nothing here is newly extracted; it is arithmetic
          over figures every record already carries, so it lands on reports
          already sold without re-minting one of them. */}
      {(() => {
        const ch = analyzeChurn(x.systemScale);
        const tierColor =
          ch.tier === "High" ? "#F59E0B" : ch.tier === "Medium" ? "#F5B847" : "#34D399";
        return (
          <Card id="scale" title={<>System Scale &amp; Turnover <Src s={x.systemScale?.sourcePage} /></>}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat
                label="Total units"
                value={x.systemScale?.totalUnits?.toLocaleString() ?? "Not disclosed"}
                tone={x.systemScale?.totalUnits == null ? "muted" : undefined}
                sub={x.systemScale?.totalUnits != null ? "at year end" : undefined}
              />
              <Stat
                label="Opened (yr)"
                value={x.systemScale?.openedLastYear?.toLocaleString() ?? "Not disclosed"}
                tone={x.systemScale?.openedLastYear == null ? "muted" : undefined}
              />
              <Stat
                label="Closed (yr)"
                value={x.systemScale?.closedLastYear?.toLocaleString() ?? "Not disclosed"}
                tone={x.systemScale?.closedLastYear == null ? "muted" : "warn"}
                sub={ch.closed ? `${ch.closed.pct}% of starting units` : undefined}
              />
              <Stat
                label="Changed hands (yr)"
                value={x.systemScale?.transfersLastYear?.toLocaleString() ?? "Not disclosed"}
                tone={x.systemScale?.transfersLastYear == null ? "muted" : undefined}
                sub={ch.transfers ? `${ch.transfers.pct}% of starting units` : undefined}
              />
            </div>

            <div className="mt-5 border-t border-[#27344F] pt-4">
              {ch.computable && ch.ownerTurnover ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[11px] uppercase font-bold text-[#8194B0]">Owner turnover</span>
                    <span className="text-lg font-bold text-[#F1F5F9] tabular-nums">{ch.ownerTurnover.pct}%</span>
                    <span
                      className="text-[10px] tracking-wider font-semibold border rounded px-1.5 py-0.5"
                      style={{
                        color: basisColor(ch.basis),
                        borderColor: `${basisColor(ch.basis)}33`,
                        backgroundColor: `${basisColor(ch.basis)}14`,
                      }}
                    >
                      {BASIS_STYLE[ch.basis].label}
                    </span>
                    {ch.tier && (
                      <span
                        className="text-[10px] tracking-wider font-semibold border rounded px-1.5 py-0.5"
                        style={{ color: tierColor, borderColor: `${tierColor}44` }}
                      >
                        {ch.tier.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#CBD5E1] mt-2 leading-relaxed">{ch.headline}</p>
                  {ch.tell && (
                    <p className="text-xs text-[#CBD5E1] mt-3 border-l-2 border-[#38BDF8]/50 pl-3 leading-relaxed">
                      {ch.tell}
                    </p>
                  )}
                  {ch.baseNote && (
                    <p className="text-[11px] text-[#8194B0] mt-3 leading-relaxed">{ch.baseNote}</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-[#CBD5E1] leading-relaxed">{ch.unavailable}</p>
              )}
              <p className="text-[11px] text-[#8194B0] mt-3 leading-relaxed">{ch.question}</p>
            </div>
          </Card>
        );
      })()}

      {/* LEAVING — Item 17.

          Placement is deliberate and sits at #13 of 16: its output is questions
          and the question section renders directly below it, and both of its
          derived numbers are read against Item 20, which renders directly above
          it. It lands after the money sections because its job is to interrupt
          someone who has already absorbed the numbers.

          NEVER ABSENT as of 2026-08-06. Records extracted before exitTerms
          existed — which is all 83 of them — used to drop the card and the nav
          entry silently, so the module shipped and no buyer ever saw it and
          nothing in the build said so. It renders as a frame instead. */}
      {!leaving.available ? (
        <Frame id="leaving" />
      ) : (
        <Card
          id="leaving"
          title={<>Leaving &mdash; Renewal, Exit &amp; Transfer <Src s={leaving.sourcePage} /></>}
        >
          <p className="text-xs text-[#CBD5E1] leading-relaxed">
            Item 17 is a table every franchisor is required to publish, and it is in the
            document you are already holding. Nothing here is hidden. It is also the table
            that gets read last, if at all, because it is the only one entirely about the
            end. Below is what yours says, counted rather than characterised.
          </p>

          <div className="mt-5 space-y-5">
            {leaving.blocks.map((b) => (
              <div key={b.n} className="border-t border-[#27344F] pt-4">
                <p className="text-[11px] uppercase font-bold tracking-wider text-[#8194B0]">
                  <span className="text-[#38BDF8]">{b.n}</span>&nbsp;&nbsp;{b.title}
                </p>

                <div className="mt-3 space-y-2">
                  {b.rows.map((r, i) => (
                    <div key={i}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 text-[#CBD5E1]">{r.label}</span>
                        <span
                          className={`shrink-0 text-right font-medium ${
                            r.unstated ? "text-xs text-[#8194B0]" : "text-[#F1F5F9]"
                          }`}
                        >
                          {r.value}
                        </span>
                      </div>
                      {r.sub && (
                        <p className="text-[10px] text-[#8194B0] mt-0.5 leading-snug">{r.sub}</p>
                      )}
                    </div>
                  ))}
                </div>

                {b.n === "02" && leaving.exitColumn && (
                  <div className="mt-4 rounded-lg border border-[#34D399]/30 bg-[#34D399]/[0.06] px-3 py-3">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-[#8194B0]">
                      The exit column
                    </p>
                    <p className="text-2xl font-bold text-[#F1F5F9] tabular-nums mt-1">
                      {leaving.exitColumn.franchisorGrounds}
                      {leaving.exitColumn.openEnded ? "+" : ""}{" "}
                      <span className="text-sm font-semibold text-[#8194B0]">vs</span>{" "}
                      {leaving.exitColumn.franchiseeGrounds}
                    </p>
                    <p className="text-[11px] text-[#8194B0] mt-1 leading-relaxed">
                      Grounds this table gives the franchisor to end the agreement, against the
                      grounds it gives you.
                      {leaving.exitColumn.openEnded
                        ? ` The franchisor figure is a floor, not a total — the list ends "and others".`
                        : ""}{" "}
                      This is a count of one document. It is not a comparison against other
                      brands, and it is not a judgment about either number.
                    </p>
                  </div>
                )}

                {b.callouts.map((c, i) => {
                  const tone = c.tone === "amber" ? "#F5B847" : "#38BDF8";
                  return (
                    <div
                      key={i}
                      className="mt-4 rounded-lg border px-3 py-3"
                      style={{ borderColor: `${tone}4D`, backgroundColor: `${tone}0F` }}
                    >
                      <p
                        className="text-[10px] uppercase font-bold tracking-wider"
                        style={{ color: tone }}
                      >
                        {c.title}
                      </p>
                      <p className="text-[11px] text-[#CBD5E1] mt-1 leading-relaxed">{c.body}</p>
                    </div>
                  );
                })}

                <div className="mt-4 border-l-2 border-[#38BDF8]/50 pl-3">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-[#8194B0]">
                    Ask
                  </p>
                  <ul className="mt-1 space-y-1">
                    {b.questions.map((q, i) => (
                      <li key={i} className="text-[11px] text-[#CBD5E1] leading-relaxed">
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-[#8194B0] mt-5 border-t border-[#27344F] pt-4 leading-relaxed">
            {leaving.disclaimer}
          </p>
        </Card>
      )}

      {/* Operational risks */}
      {tripwires.length > 0 && (
        <Card title="Operational Tripwires">
          <div className="space-y-3">
            {tripwires.map((r, i) => (
              <div key={i} className="border border-[#27344F] rounded-lg p-3">
                <p className="text-sm font-semibold">
                  {r.title}{" "}
                  <span
                    className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                      r.severity === "high"
                        ? "bg-red-500/20 text-red-300"
                        : r.severity === "medium"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-[#27344F] text-[#8194B0]"
                    }`}
                  >
                    {r.severity}
                  </span>
                </p>
                <p className="text-xs text-[#CBD5E1] mt-1">{r.description}</p>
                <Src s={r.source} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Disclaimer */}
      <p className="text-[11px] text-[#8194B0] leading-relaxed border-t border-[#27344F] pt-4">
        This report is generated from the uploaded document for informational purposes only and is not legal,
        financial, or investment advice. Figures are extracted by an AI model and may contain errors — verify
        every number against the source FDD before making any decision.
      </p>

    </div>
  );
}

/* ---- small presentational helpers ---- */

function RentOverrideEditor({
  baseline,
  draft,
  setDraft,
  onCommit,
  onCancel,
}: {
  baseline: { mid: number; basis: string };
  draft: string;
  setDraft: (v: string) => void;
  onCommit: (v: number) => void;
  onCancel: () => void;
}) {
  const parse = (s: string) => Number(s.replace(/[^0-9]/g, ""));
  const commit = () => {
    const v = parse(draft);
    if (v > 0) onCommit(v);
  };
  const chip = (label: string, value: number) => (
    <button
      type="button"
      onClick={() => onCommit(value)}
      className="rounded-lg border border-[#27344F] px-2.5 py-1 text-[11px] font-bold text-[#8194B0] hover:border-[#3A496A] hover:text-[#CBD5E1]"
    >
      {label}
    </button>
  );
  return (
    <div className="mt-1 rounded-lg border border-[#F5B847]/30 bg-[#0B1220] p-3">
      <label className="block text-[11px] font-bold text-[#CBD5E1]">
        Your monthly rent ($200–$200,000)
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-[#27344F] bg-[#16223B] px-2.5 py-1.5 focus-within:border-[#F5B847]/60">
          <span className="text-sm font-bold text-[#F5B847]">$</span>
          <input
            inputMode="numeric"
            value={draft}
            onChange={(e) => {
              const d = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
              setDraft(d ? Number(d).toLocaleString("en-US") : "");
            }}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className="w-24 bg-transparent text-sm font-bold text-[#F5B847] outline-none"
            aria-label="Your monthly rent"
          />
          <span className="text-[10px] text-[#8194B0]">/mo</span>
        </div>
        <button
          type="button"
          onClick={commit}
          className="rounded-lg bg-[#F5B847] px-3 py-1.5 text-[12px] font-extrabold text-[#0B1220]"
        >
          Apply
        </button>
        {chip("+25%", Math.round(baseline.mid * 1.25))}
        {chip("+50%", Math.round(baseline.mid * 1.5))}
        <button type="button" onClick={onCancel} className="text-[11px] font-bold text-[#8194B0] hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  red,
  green,
}: {
  label: ReactNode;
  value: string;
  bold?: boolean;
  red?: boolean;
  green?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={`text-sm ${bold ? "font-bold text-[#F1F5F9]" : "text-[#CBD5E1]"}`}>{label}</span>
      <span
        className={`${bold ? "text-lg font-bold" : "text-sm font-medium"} ${
          red ? "text-red-400" : green ? "text-[#34D399]" : "text-[#F1F5F9]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** A recurring-fee line. Shows "{n}%" when the FDD discloses a rate; when it
 *  doesn't, shows the fee name with a plain-language note instead of a bare
 *  dash. The decision lives in lib/fees.ts (recurringFeeDisplays) and is
 *  golden-tested — this component only renders it. */
function FeeRow({ label, d }: { label: string; d: { pct: string | null; note: string | null } }) {
  if (d.pct != null) return <Row label={label} value={d.pct} />;
  return (
    <div>
      <span className="text-sm text-[#CBD5E1]">{label}</span>
      {d.note && <p className="text-xs text-[#8194B0] mt-0.5 leading-snug">{d.note}</p>}
    </div>
  );
}

/**
 * A labelled figure.
 *
 * Two rules here.
 *
 * `muted` exists because a figure that does not exist gets WORDS, not a zero
 * and not a dash. "Not disclosed" is longer than "—", so it drops a type size
 * and loses the bold — it should read as an absence, not compete with the
 * figures beside it.
 *
 * `warn` replaces the old `bad` on the closure count. Red is spoken for by
 * warnings in this product, and a closure count is a disclosure, not a verdict:
 * painting it red editorialises a number the franchisor published.
 */
function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn" | "muted";
  sub?: string;
}) {
  const color =
    tone === "bad"
      ? "text-red-400"
      : tone === "warn"
        ? "text-[#F59E0B]"
        : tone === "good"
          ? "text-[#34D399]"
          : tone === "muted"
            ? "text-[#8194B0]"
            : "text-[#F1F5F9]";
  return (
    <div>
      <p className="text-[11px] uppercase font-bold text-[#8194B0]">{label}</p>
      <p className={`${tone === "muted" ? "text-sm font-semibold" : "text-lg font-bold"} ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-[#8194B0] mt-0.5 leading-snug">{sub}</p>}
    </div>
  );
}

function CostGroup({
  title,
  items,
}: {
  title: string;
  items: { category: string; low: number | null; high: number | null; notes: string }[];
}) {
  if (items.length === 0) return null;
  const usdLocal = (n: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  return (
    <div className="mb-4">
      <p className="text-xs font-bold uppercase text-[#8194B0] mb-2">{title}</p>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          /* min-w-0 on the label, shrink-0 on the figure: a long Item 7 category
             ("Initial Marketing Expenditure and Local Advertising (90 days)") wraps,
             and the dollars stay on one line. It was the other way round. */
          <div key={i} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 text-[#CBD5E1]">{it.category}</span>
            <span className="shrink-0 whitespace-nowrap tabular-nums text-[#F1F5F9] font-medium">
              {range(usdLocal(it.low), usdLocal(it.high))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
