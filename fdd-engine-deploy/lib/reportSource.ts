/**
 * reportSource.ts — the glass-mode adapter.
 *
 * Turns a computed brand record (data/brands/<slug>.json → record.result, a
 * DiligenceResult) into the ReportSource that lib/reportShell.ts masks.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SERVER ONLY. NEVER import this from a client component.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The handoff put this function inside lib/reportShell.ts. It cannot live
 * there: ReportGlass.tsx is a client component that imports reportShell for
 * its types and PROVENANCE_LABEL, so an adapter in that file would drag
 * ladder.ts, ladderInput.ts, callList.ts, churn.ts and rentCorrection.ts into
 * the browser bundle. Nothing leaks on day one. But glass mode's whole defence
 * is that the client is never handed a module that CAN produce a figure, and
 * shipping buildCashLadder to the browser hands it exactly that. Structural
 * guarantees beat promises about who edits which file.
 *
 * ─── Two rules this file lives by ────────────────────────────────────────
 *
 * MAP, DO NOT WIDEN. If a value is not needed to produce a mask, do not read
 * it. Every figure below exists because the paid report renders that exact
 * line. There is no "might be useful later" field.
 *
 * REPRODUCE THE RENDER, DO NOT REDERIVE IT. The paid report's numbers are
 * computed AT RENDER TIME by DiligenceReport.tsx and CashLadder.tsx, not read
 * off the stored record. applyRentCorrection runs first; the ladder is built
 * with the live UI's default financing (finance the gap at 10.5% / 10yr). An
 * adapter that skipped either would size masks off numbers the buyer will
 * never see — and mask width is a claim about magnitude, so a wrong width is a
 * small lie told 83 times a page.
 *
 * Section ids are load-bearing. reportShell's tests, the telemetry lock_ids
 * and the renderer's section order all key off them. Rename nothing.
 */

import { applyRentCorrection } from "./rentCorrection";
import { buildLadderInput, resolvePercentageFees } from "./ladderInput";
import {
  buildCashLadder,
  maxSupportableLoan,
  DSCR_LENDER_FLOOR,
  type CashLadder,
  type Money,
} from "./ladder";
import { recurringFeeDisplays } from "./fees";
// exitTerms.ts imports ONLY a type from lib/schema.ts and pulls in no compute
// module, so this import costs nothing structurally. It is also the SAME
// producer the paid report calls (DiligenceReport.tsx line 349), which is the
// whole point: the teaser must never re-derive Item 17, or the two surfaces
// drift the first time a label law changes.
import { buildLeaving } from "./exitTerms";
import { analyzeChurn } from "./churn";
import { buildCallList } from "./callList";
import { computeVerify, verifyPhrase } from "./verify";
import { normalizeSeverity } from "./severity";
import { normalizeCitation } from "./citation";
import { sectionSpec, navAnchor, isUndisclosed } from "./sections";
import type { DiligenceResult } from "./types";
import type {
  Provenance,
  ReportSource,
  SourceBadge,
  SourceFigure,
  SourceSection,
  SourceValue,
  Unit,
} from "./reportShell";

/* ------------------------------------------------------------------ *
 * Small helpers. None of these decide anything.
 * ------------------------------------------------------------------ */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A Money range collapses to a scalar when the ends agree, and to null when
 *  either end is missing or infinite. Payback's high end is deliberately
 *  Infinity when the low cost case never repays — that is a sentence in the
 *  report, not a number, and it must not reach buildMask(). */
function moneyValue(m: Money | null | undefined): SourceValue {
  if (!m || !isNum(m.lo) || !isNum(m.hi)) return null;
  const lo = Math.round(m.lo * 100) / 100;
  const hi = Math.round(m.hi * 100) / 100;
  return lo === hi ? lo : [lo, hi];
}

/** A disclosed low/high pair from Item 7 line items. */
function pairValue(lo: number | null, hi: number | null): SourceValue {
  if (!isNum(lo) && !isNum(hi)) return null;
  const a = isNum(lo) ? lo : (hi as number);
  const b = isNum(hi) ? hi : (lo as number);
  return a === b ? a : [Math.min(a, b), Math.max(a, b)];
}

const fig = (
  label: string,
  value: SourceValue,
  unit: Unit,
  provenance: Provenance,
  extra: Partial<SourceFigure> = {},
): SourceFigure => ({ label, value, unit, provenance, ...extra });

/** Item/page citation.
 *
 *  This used to pass `sourcePage` straight through, on the assumption that the
 *  extractor writes a bare page number. It does not — it writes a complete
 *  citation ("Item 7, pp. 9-10"), so every glass line rendered "Item 7, p.
 *  Item 7, pp. 9-10", and one record leaked its masked unit counts through the
 *  parenthetical tail. See lib/citation.ts for the whole story; the parsing
 *  lives there because it is a producer-contract problem, not a display one. */
const cite = (item: number, page?: string | null) => normalizeCitation(item, page);

/** The four benchmark cost bands are the moat. They render fixed-width no
 *  matter what the config says, because their real width would let a reader
 *  reconstruct the band from the mask. Rung 4 (occupancy) joins them whenever
 *  rent came from the benchmark rather than the document. */
const METHOD_BAND_RUNGS = new Set(["cogs", "labor", "otherOpex"]);

/**
 * THE FRAME — a section rendered from the registry alone, with no record.
 *
 * Returned by a section function when the module has nothing to build from for
 * THIS brand, in place of the null it used to return. The card still appears,
 * in its normal slot, saying what the section covers and naming its topics; it
 * carries no figures, so the shell gives it no masks, no lock ids and no row
 * count, and it contributes nothing to the glass qualification floors.
 *
 * ALL COPY COMES FROM lib/sections.ts AND NONE OF IT IS DERIVED. That is the
 * point of routing through the registry rather than writing the strings here:
 * a frame renders for brands we have not extracted, so every word on it has to
 * be true with no record loaded. The registry holds `covers` to a hard no-numbers
 * rule for exactly this reason — see the comment on SectionSpec.covers.
 *
 * Throwing on an unknown id is intentional. A section function that frames an
 * id the registry does not carry would produce a card the parity test cannot
 * see and the paid report will never render.
 */
function frame(id: string): SourceSection {
  const spec = sectionSpec(id);
  if (!spec) {
    throw new Error(
      `frame("${id}") — no such section in lib/sections.ts. A section must be ` +
        `in the registry before either surface can render it.`,
    );
  }
  if (spec.absence !== "structural") {
    throw new Error(
      `frame("${id}") — section is marked absence:"${spec.absence}". Only ` +
        `"structural" sections may render as a frame; "suppressed" ones must ` +
        `stay absent. See lib/sections.ts.`,
    );
  }
  const anchor = navAnchor(spec.id);
  const s: SourceSection = {
    id: spec.id,
    title: spec.title,
    blurb: spec.covers,
    freeChips: [...spec.chips],
    figures: [],
    structural: true,
  };
  if (anchor) s.anchor = anchor;
  return s;
}

/**
 * THE UNDISCLOSED BLOCK — the franchisor said nothing, and that is the finding.
 *
 * The near-opposite of frame() despite the identical plumbing, and the reason
 * both exist. A frame is an apology for OUR pipeline and is styled to recede. An
 * undisclosed block is a FINDING about the filing and is styled to be read: it
 * is often the most decision-relevant sentence in the whole document, and on the
 * teaser it is the strongest possible argument that we actually read the thing.
 *
 * It carries no figures, so it takes the same inert path through the shell — no
 * masks, no lock ids, no row count, no contribution to the glass floors. What it
 * does carry is free prose, deliberately: there is nothing behind a paywall
 * here, so withholding any of it would be selling a lock over an empty box.
 *
 * The predicate lives in lib/sections.ts and is NOT re-tested here. See
 * isUndisclosed() — a renderer or adapter that reads `hasItem19` directly is how
 * the two surfaces drift apart.
 */
function undisclosedBlock(id: string): SourceSection {
  const spec = sectionSpec(id);
  if (!spec) {
    throw new Error(
      `undisclosedBlock("${id}") — no such section in lib/sections.ts. A ` +
        `section must be in the registry before either surface can render it.`,
    );
  }
  const u = spec.undisclosed;
  if (!u) {
    throw new Error(
      `undisclosedBlock("${id}") — section carries no \`undisclosed\` spec. ` +
        `A section may only claim the franchisor disclosed nothing when the ` +
        `extractor positively recorded that; see UndisclosedSpec in ` +
        `lib/sections.ts before adding one.`,
    );
  }
  const anchor = navAnchor(spec.id);
  const s: SourceSection = {
    id: spec.id,
    title: spec.title,
    figures: [],
    undisclosed: { heading: u.heading, body: u.body, nextStep: u.nextStep },
  };
  if (anchor) s.anchor = anchor;
  return s;
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

function whatItCosts(r: DiligenceResult): SourceSection {
  const it = r.extracted.item17;
  const c = cite(7, it?.sourcePage);

  // One-time build-out lines only. `recurring: true` rows are ongoing costs and
  // are already the subject of the fees section — listing them twice would
  // inflate the figure count with the same money counted in two places.
  const lines = (it?.lineItems ?? [])
    .filter((li) => !li.recurring)
    .map((li) =>
      fig(li.category, pairValue(li.low, li.high), "usd", "disclosed", { citation: c }),
    );

  const total = pairValue(it?.initialInvestmentLow ?? null, it?.initialInvestmentHigh ?? null);
  if (total !== null) {
    lines.push(
      fig("Total investment", total, "usd", "disclosed", {
        citation: c,
        lockId: "what-it-costs.total",
      }),
    );
  }

  return {
    id: "what-it-costs",
    title: "What it costs to open",
    anchor: "What it costs",
    blurb: `Item 7, as the franchisor states it. ${lines.length} line items.`,
    figures: lines,
  };
}

function buyerFit(r: DiligenceResult): SourceSection {
  const u = r.underwriting;
  const x = r.extracted;

  const figures: SourceFigure[] = [
    fig("Capital gap", isNum(u?.capitalGap) ? u.capitalGap : null, "usd", "derived", {
      lockId: "buyer-fit.gap",
    }),
    fig("Loan needed", u?.sbaLoanRequired ? 1 : 0, "text", "derived"),
    fig("Net worth requirement", isNum(x.requiredNetWorth) ? x.requiredNetWorth : null, "usd", "disclosed", {
      citation: cite(5),
    }),
    fig(
      "Liquid capital requirement",
      isNum(x.requiredLiquidCapital) ? x.requiredLiquidCapital : null,
      "usd",
      "disclosed",
      { citation: cite(5) },
    ),
    fig(
      "Margin after fees, rent and debt",
      isNum(u?.adjustedMonthlyNetCashFlow) ? u.adjustedMonthlyNetCashFlow : null,
      "usd_month",
      "derived",
    ),
  ];

  return {
    id: "buyer-fit",
    title: "Buyer-fit underwriting",
    anchor: "Buyer fit",
    blurb: "What the deal asks of you, against what you told us you have.",
    figures,
  };
}

function cashLadder(r: DiligenceResult, ladder: CashLadder): SourceSection {
  const figures = ladder.rungs.map((rung) => {
    const unit: Unit =
      rung.id === "dscr" ? "ratio" : rung.id === "payback" ? "years" : "usd_month";

    // Rung 4 is a method band only when the rent came from our benchmark. When
    // the FDD discloses rent, the band is not ours to protect.
    const isMethodBand =
      METHOD_BAND_RUNGS.has(rung.id) || (rung.id === "occupancy" && rung.basis === "benchmark");

    return fig(`${rung.n}. ${rung.label}`, moneyValue(rung.monthly), unit, provenanceOf(rung.basis), {
      note: rung.note,
      isMethodBand,
      lockId: `cash-ladder.${kebab(rung.id)}`,
    });
  });

  return {
    id: "cash-ladder",
    title: `The cash ladder — ${ladder.revenueLabel}`,
    anchor: "Cash ladder",
    blurb:
      `${ladder.rungs.length} rungs, monthly, from disclosed revenue down to what the ` +
      `operator actually keeps. Every rung is labelled with where its number came from.`,
    figures,
  };
}

function financing(r: DiligenceResult, ladder: CashLadder, plan: Plan): SourceSection {
  const ebitda = ladder.operatingEbitda;
  const annualEbitda = ladder.get("operatingEbitda")?.annual ?? null;
  const equityIn = plan.allCash
    ? plan.buildout
    : Math.max(0, plan.buildout - plan.loan);

  const roe: Money | null =
    annualEbitda && equityIn > 0
      ? { lo: (annualEbitda.lo / equityIn) * 100, hi: (annualEbitda.hi / equityIn) * 100 }
      : null;

  const supportable =
    ebitda && ebitda.hi > 0
      ? maxSupportableLoan(ebitda.hi, DSCR_LENDER_FLOOR, plan.rate, plan.term)
      : null;

  const figures: SourceFigure[] = [
    fig("Loan amount", plan.allCash ? 0 : plan.loan, "usd", "derived"),
    fig("Rate", plan.allCash ? null : plan.rate, "pct", "benchmark"),
    fig("Term", plan.allCash ? null : plan.term, "years", "benchmark"),
    fig("Monthly payment", ladder.monthlyDebtService ?? null, "usd_month", "derived"),
    fig("Cash you put in", equityIn, "usd", "derived"),
    fig("Cash after debt", moneyValue(ladder.cashAfterDebt), "usd_month", "derived"),
    fig("Return on your cash", moneyValue(roe), "pct", "derived"),
    fig("Debt-service coverage ratio", moneyValue(ladder.dscr), "ratio", "derived"),
    fig("What this unit could support", supportable, "usd", "derived"),
  ];

  return {
    id: "financing",
    title: "How you pay for it",
    anchor: "Financing",
    blurb: "The loan this unit would need, and whether the unit can carry it.",
    figures,
  };
}

function ongoingFees(r: DiligenceResult): SourceSection {
  const x = r.extracted;
  const c = cite(6);
  const figures: SourceFigure[] = [];

  // Percentage fees — resolvePercentageFees is the same call the ladder makes,
  // so the count here and rung 2 cannot disagree.
  const pct = resolvePercentageFees(x);
  for (const f of pct.fees) figures.push(fig(f.label, f.pct, "pct", "disclosed", { citation: c }));

  // A brand with no percentage royalty is a real disclosure, not a gap.
  // recurringFeeDisplays owns that sentence; we carry the label so the reader
  // sees the line exists even when the figure behind it is "0%".
  if (pct.fees.length === 0) {
    const d = recurringFeeDisplays(x);
    if (d.royalty.note) {
      figures.push(fig("Royalty", null, "pct", "disclosed", { note: d.royalty.note, citation: c }));
    }
  }

  for (const f of x.ongoingFees?.flatMonthlyFees ?? []) {
    if (!isNum(f.monthlyAmount)) continue;
    figures.push(fig(f.name, f.monthlyAmount, "usd_month", "disclosed", { citation: c }));
  }

  for (const h of x.hiddenCosts ?? []) {
    figures.push(
      fig(h.name, isNum(h.estimatedAnnualAmount) ? h.estimatedAnnualAmount : null, "usd_year", "disclosed", {
        citation: c,
      }),
    );
  }

  return {
    id: "ongoing-fees",
    title: "Ongoing fees and hidden costs",
    anchor: "Fees",
    blurb: `${figures.length} separate charges in the agreement. Most buyers find four.`,
    figures,
  };
}

function itemNineteen(r: DiligenceResult): SourceSection {
  /* Ahead of every figure, and routed through the registry rather than tested
     here. When the filing states there is no financial performance
     representation, the section's output IS that fact — building masks first
     and discarding them would leave a code path where a cohort figure could
     survive onto a card that says no figures exist. */
  if (isUndisclosed(r, "item-19")) return undisclosedBlock("item-19");

  const i19 = r.extracted.item19;
  const c = cite(19, i19?.sourcePage);
  const figures: SourceFigure[] = [];

  for (const co of i19?.cohorts ?? []) {
    if (!isNum(co.avgMonthlyRevenue)) continue;
    figures.push(fig(co.label, co.avgMonthlyRevenue, "usd_month", "disclosed", { citation: c }));
  }
  if (isNum(i19?.networkAverageMonthly)) {
    figures.push(fig("Network average", i19.networkAverageMonthly, "usd_month", "disclosed", { citation: c }));
  }
  if (isNum(i19?.unitsReported)) {
    figures.push(fig("Units reported", i19.unitsReported, "count", "disclosed", { citation: c }));
  }

  return {
    id: "item-19",
    title: "What units actually make",
    anchor: "Item 19",
    blurb: i19?.hasItem19
      ? "The franchisor's own numbers, and how wide the spread really is."
      : "This franchisor makes no financial performance representation.",
    figures,
  };
}

function documentCheck(r: DiligenceResult): SourceSection {
  const found = r.extracted.documentCheck?.itemsFound ?? [];
  return {
    id: "document-check",
    title: "What we found in the document",
    anchor: "Document",
    blurb: `${found.length} Items located and parsed. Every figure above cites one of them.`,
    freeChips: [...found],
    figures: [],
  };
}

function toVerify(r: DiligenceResult): SourceSection {
  const v = computeVerify(r.scoring?.riskReasons);
  return {
    id: "to-verify",
    title: "Before you commit",
    anchor: "To verify",
    blurb:
      `${v.verifyCount} things this document cannot settle, and how to settle them.`,
    // The AREA labels are free — they are a closed set of eight and they name a
    // topic, not a finding. The findings themselves are the paid half.
    freeChips: [...v.verifyItems],
    figures: [],
    maskedRows: v.verifyCount,
  };
}

function financialCondition(r: DiligenceResult): SourceSection | null {
  const fc = r.financialCondition;
  // normalizeSeverity, never fc.severity raw. Persisted severities are NOT
  // guaranteed to be in the union — the-back-nine and golftrk carry
  // 'INSUFFICIENT', which slipped past the === "INSUFFICIENT_DATA" test below
  // and advertised a "Franchisor financial condition" section whose blurb read
  // "0 findings from the audited statements" — a concern signal about a NAMED
  // FRANCHISOR derived from a token we failed to read.
  const sevKey = fc ? normalizeSeverity(fc.severity) : null;
  // The paid report suppresses this section entirely at LOW. A glass page that
  // advertises findings the report will not show is a refund.
  if (!fc || sevKey === "LOW" || sevKey === "INSUFFICIENT_DATA") return null;

  const rows = (fc.body?.length ?? 0) + (fc.aggravators?.length ?? 0) + (fc.mitigants?.length ?? 0);
  const sev = sevKey === "HIGH" ? "high" : "medium";

  return {
    id: "financial-condition",
    title: "Franchisor financial condition",
    blurb: `${rows} findings from the audited statements.`,
    severityCounts: { [sev]: 1 },
    figures: [],
    maskedRows: rows,
  };
}

function tripwires(r: DiligenceResult): SourceSection {
  // Same filter DiligenceReport applies: when the financial-condition section
  // renders, the boilerplate financial-condition risk is dropped so the same
  // concern is not reported twice in two voices.
  const fc = r.financialCondition ?? null;
  const rows = (r.extracted.operationalRisks ?? []).filter(
    (t) => !(fc && /financial condition/i.test(t.title)),
  );

  const counts: Record<string, number> = {};
  for (const t of rows) counts[t.severity] = (counts[t.severity] ?? 0) + 1;
  const high = counts.high ?? 0;

  return {
    id: "tripwires",
    title: "Operational tripwires",
    blurb:
      `${rows.length} clauses that change what you signed up for.` +
      (high > 0 ? ` ${high} ${high === 1 ? "is" : "are"} rated high.` : ""),
    severityCounts: counts,
    figures: [],
    maskedRows: rows.length,
  };
}

function systemScale(r: DiligenceResult): SourceSection {
  const ss = r.extracted.systemScale;
  const c = cite(20, ss?.sourcePage);
  const churn = analyzeChurn(ss);

  const figures: SourceFigure[] = [
    fig("Total units", isNum(ss?.totalUnits) ? ss.totalUnits : null, "count", "disclosed", { citation: c }),
    fig("Opened", isNum(ss?.openedLastYear) ? ss.openedLastYear : null, "count", "disclosed", { citation: c }),
    fig("Closed", isNum(ss?.closedLastYear) ? ss.closedLastYear : null, "count", "disclosed", { citation: c }),
    fig("Changed hands", isNum(ss?.transfersLastYear) ? ss.transfersLastYear : null, "count", "disclosed", {
      citation: c,
    }),
    fig("Owner turnover", churn.ownerTurnover?.pct ?? null, "pct", "derived", {
      note: churn.baseNote ?? undefined,
    }),
  ];

  const section: SourceSection = {
    id: "system-scale",
    title: "System scale and turnover",
    anchor: "System at a glance",
    blurb: "Item 20, year-end.",
    figures,
  };
  /* RULE 4's output, surfaced. analyzeChurn has been able to tell a buyer that
     Item 20's own table does not close since the start count became readable,
     and until now nothing consumed it — the check ran, found the contradiction
     on seniors-helping-seniors, and told no one. A check whose result is never
     read is not a check. It goes on the FREE surface deliberately: an outlet
     table that does not add up is worth the unlock by itself, and a buyer who
     has to pay to learn that it does not add up never will. */
  if (churn.unreconciled) section.finding = churn.unreconciled;
  return section;
}

function whoToCall(r: DiligenceResult): SourceSection {
  const x = r.extracted;
  const cl = buildCallList({
    totalUnits: x.systemScale?.totalUnits,
    closedLastYear: x.systemScale?.closedLastYear,
    transfersLastYear: x.systemScale?.transfersLastYear,
    item20Page: x.systemScale?.sourcePage,
    cohorts: x.item19?.cohorts,
    item19Page: x.item19?.sourcePage,
  });
  if (!cl.available) return frame("who-to-call");

  const questions = cl.cohorts.flatMap((c) => c.questions);
  if (questions.length === 0) return frame("who-to-call");

  // Exactly one question is free, and it is the first one — the cost-of-goods
  // question, which is the one a real operator answers and the one that proves
  // the rest are worth having.
  const [free, ...rest] = questions;

  return {
    id: "who-to-call",
    title: "Who to call, and what to ask",
    blurb:
      `${questions.length} questions, grouped for ` +
      `${cl.cohorts.map((c) => c.title.toLowerCase()).join(", ")}.`,
    freeChips: [free],
    figures: [],
    maskedRows: rest.length,
  };
}

/**
 * LEAVING — Item 17.
 *
 * Mirrors the paid report's card, and sits in the same place in the section
 * order for the same reason it does there: its counts are read against Item 20,
 * which renders directly above it, and its output is questions, which the call
 * list directly below it continues.
 *
 * ABSENCE IS ABSENCE. buildLeaving() reports unavailable for every record
 * extracted before exitTerms existed — which today is nearly all of them — and
 * for any record whose Item 17 did not read. This returns null on exactly that
 * signal, so the teaser drops the card AND its nav entry, the same as the
 * report. A glass card is a claim that something is behind it. There must never
 * be one over nothing.
 *
 * EVERY ROW IS MASKED AS TEXT WITH A NULL VALUE, NOT AS A NUMBER. Item 17 rows
 * are phrases — "2 successor terms, 5 years each", "Yes", a forum state — and a
 * text mask is fixed-width by construction, so no row here makes a claim about
 * magnitude that it cannot support.
 *
 * ROWS THE TABLE DOES NOT STATE ARE DROPPED, NOT MASKED. A mask is a promise
 * that a value is behind it; "Not stated in this table" is not a value, and
 * charging $199 to reveal a blank is the one move that would make the unlock
 * feel taken. This is also why the count in the blurb is of STATED terms only —
 * it is the number the buyer will actually find on the other side.
 *
 * The exit column's two counts stay out of the blurb entirely. They are the
 * most quotable thing in the section, they are derived rather than disclosed,
 * and they belong to the buyer, not to the teaser.
 */
function leaving(r: DiligenceResult): SourceSection {
  const lv = buildLeaving(r.extracted.exitTerms);
  // NOT null. Item 17 is part of the report for every brand; what varies is
  // whether we have read this brand's table yet. Today that is none of them,
  // which is precisely why the frame matters — the module shipped and the card
  // was invisible on all 83, and nothing in the build said so.
  if (!lv.available) return frame("leaving");

  const c = cite(17, lv.sourcePage);

  // The page citation rides on the first row only. The report prints it once,
  // on the card title; repeating it on eighteen consecutive lines would be a
  // different page, not a more honest one.
  const stated = lv.blocks.flatMap((b) => b.rows.filter((row) => !row.unstated));
  // A table that read but stated nothing is still an unread table to a buyer.
  if (stated.length === 0) return frame("leaving");

  const figures = stated.map((row, i) =>
    fig(row.label, null, "text", "disclosed", i === 0 ? { citation: c } : {}),
  );

  // row.sub is deliberately NOT carried through as a note. One of them prints
  // the non-curable default count inside its sentence, and that count is a
  // locked value on this very card. The free-text floor would not catch it —
  // it is far below 100 — so the guard here is not passing it at all.

  const questions = lv.blocks.reduce((n, b) => n + b.questions.length, 0);

  return {
    id: "leaving",
    title: "Leaving — renewal, exit and transfer",
    anchor: "Leaving",
    blurb:
      `Item 17, counted rather than characterised. ${figures.length} terms the table ` +
      `states, across how long you are in, how it ends, how you sell it and what ` +
      `happens after — plus the grounds it gives each side to end the agreement, and ` +
      `${questions} questions to take to a franchisee.`,
    // Structure is free. The four block titles tell a reader exactly what the
    // section covers, which is the argument for buying it.
    freeChips: lv.blocks.map((b) => b.title),
    figures,
    maskedRows: questions,
  };
}

function leadership(r: DiligenceResult): SourceSection {
  const people = r.extracted.leadership ?? [];
  if (people.length === 0) return frame("leadership");
  return {
    id: "leadership",
    title: "Who runs it",
    blurb: `${people.length} executives, with tenure and prior operating history.`,
    // Titles are free; who holds them and what they did before is the finding.
    freeChips: people.map((p) => p.role).filter(Boolean),
    figures: [],
    maskedRows: people.length,
  };
}

/* ------------------------------------------------------------------ *
 * Badges — the same three pills the report's condition strip renders.
 * Warnings first and warnings loudest. NEVER a fourth: three is a scan,
 * four is decoration a reader trains past by page three.
 * ------------------------------------------------------------------ */

function badges(r: DiligenceResult): SourceBadge[] {
  const out: SourceBadge[] = [];

  const warn = r.extracted.documentCheck?.warnings?.length ?? 0;
  if (warn > 0) {
    out.push({ label: `${warn} document ${warn === 1 ? "warning" : "warnings"}`, severity: "medium" });
  }

  const v = computeVerify(r.scoring?.riskReasons);
  // verifyPhrase(), NOT a template literal. This line shipped as a hardcoded
  // plural and a real brand rendered "1 things to verify" in the badge strip
  // of a page we were about to put paid traffic on. lib/verify.ts owns the
  // singular/plural and every other surface already calls it; this was the one
  // call site that re-typed the string. The drift lint now covers call sites
  // too — see lib/riskReframeDrift.test.ts.
  out.push({ label: verifyPhrase(v.verifyCount), severity: "medium" });

  const fc = r.financialCondition;
  // Raw fc.severity never reaches a comparison — see financialCondition() above.
  const fcSeverity = fc ? normalizeSeverity(fc.severity) : null;
  if (fcSeverity === "HIGH") {
    out.push({ label: "Franchisor financials: high concern", severity: "high" });
  } else if (fcSeverity === "MEDIUM") {
    out.push({ label: "Franchisor financials: moderate concern", severity: "medium" });
  }

  return out.slice(0, 3);
}

/* ------------------------------------------------------------------ *
 * The plan the ladder is built with.
 *
 * This is NOT buildLadderInput's own default. CashLadder.tsx seeds its state
 * with `loan = round(recommendedLoan)`, `rate = 10.5`, `term = 10`, and treats
 * `loan <= 0` as the all-cash posture rather than a zero-dollar loan. The glass
 * page must size its masks off the ladder the buyer will actually land on.
 * ------------------------------------------------------------------ */

interface Plan {
  loan: number;
  rate: number;
  term: number;
  buildout: number;
  allCash: boolean;
}

function defaultPlan(r: DiligenceResult): Plan {
  const loan = Math.round(r.underwriting?.recommendedLoan ?? 0);
  return {
    loan,
    rate: 10.5,
    term: 10,
    buildout: r.scoring?.buildoutMidpoint ?? 0,
    allCash: !(loan > 0),
  };
}

/* ------------------------------------------------------------------ */

/** Basis → Provenance. "buyer" cannot occur on a glass page — the buyer has
 *  not entered anything yet — but the ladder's type allows it, so it maps to
 *  inferred rather than crashing a page over a value that means "you told us". */
function provenanceOf(basis: string): Provenance {
  switch (basis) {
    case "disclosed":
      return "disclosed";
    case "derived":
      return "derived";
    case "benchmark":
      return "benchmark";
    default:
      return "inferred";
  }
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/* ------------------------------------------------------------------ *
 * The adapter.
 * ------------------------------------------------------------------ */

export function reportSourceFromComputed(record: {
  slug?: string;
  brandName?: string;
  result: DiligenceResult;
}): ReportSource {
  // Rent correction FIRST. Stored results were scored with rent silently $0
  // when averageRentMonthly was null; the report corrects that at render. An
  // adapter that skipped it would mask numbers the buyer never sees.
  const r = applyRentCorrection(record.result);

  const plan = defaultPlan(r);
  const ladder = buildCashLadder(
    buildLadderInput(r, {
      financing: plan.allCash ? null : { loan: plan.loan, ratePct: plan.rate, termYears: plan.term },
    }),
  );

  const brandName = record.brandName || r.extracted.brandName || "This brand";
  const brandSlug =
    record.slug || brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const sections = [
    whatItCosts(r),
    buyerFit(r),
    cashLadder(r, ladder),
    financing(r, ladder, plan),
    ongoingFees(r),
    itemNineteen(r),
    documentCheck(r),
    toVerify(r),
    financialCondition(r),
    tripwires(r),
    systemScale(r),
    // Same slot as the paid report: after Item 20, before the call list.
    leaving(r),
    whoToCall(r),
    leadership(r),
    // Only financialCondition() can be null now, and its null is a DECISION
    // rather than a gap — see absence:"suppressed" in lib/sections.ts. The
    // other three return a frame instead, so the section list has the same
    // shape for every brand and the nav stops depending on extraction luck.
  ].filter((s): s is SourceSection => s !== null);

  const it = r.extracted.item17;
  const capital = pairValue(it?.initialInvestmentLow ?? null, it?.initialInvestmentHigh ?? null);

  return {
    brandSlug,
    brandName,
    badges: badges(r),
    sections,
    // The ONE figure that crosses the gate: Item 7 verbatim, disclosed not
    // derived, and already on the current teaser. A scalar total is not a
    // range and the capital verdict needs two ends, so it is dropped rather
    // than faked. If anyone asks to "just also pass the royalty rate" — no.
    capitalRange: Array.isArray(capital) ? capital : undefined,
    ladderRungs: ladder.rungs.length,
  };
}
