// lib/noHeadline.ts
//
// WHAT THE PAGE SAYS WHEN THERE IS NO NUMBER.
//
// lib/brandFacts.ts::moModelable withholds a headline whenever the cash ladder
// cannot model a unit from the filing. That stopped fourteen live pages from
// advertising a figure they could not stand behind — but an em-dash where the
// number was is more truthful, not more useful. AN ABSENCE IS NOT A PRODUCT.
//
// This module turns the absence into the finding. Every reason here is read off
// the record the extractor already produced — cohort ownership, sample sizes,
// the disclosure basis, the system's own unit count, and the franchisor's own
// note — so the page says something specific and checkable rather than "not
// disclosed" thirteen times.
//
// It is also the argument the product is built on, applied to our own output:
// roughly a quarter of franchise filings cannot support the per-unit figure the
// industry quotes anyway, and saying which — and why — is worth more than a
// number nobody can defend. Puddle Pool Services is the reference case: it
// headlined $139k/mo against a $102k build-out off ONE franchised outlet, while
// its own Item 19 says 42 of 43 were excluded for being open under a year.
//
// OWNERSHIP NOTE: the sub-unit detector lives here rather than in brandFacts so
// there is exactly one definition of "this figure is not per outlet." brandFacts
// imports it. Duplicating the regex would recreate the two-paths defect this
// whole change exists to close.

import type { Item19Cohort } from "./schema";

/** Item 19 figures disclosed per MANAGED sub-unit (per door, per property) are
 *  not per-franchise revenue. Generic "per unit" means per outlet and is fine;
 *  the signal requires a managed-denominator qualifier. */
export const SUBUNIT_RE =
  /per\s+property\s+unit|per\s+door\b|per\s+managed|per\s+unit\s+managed|unit\s+managed|revenue\s+per\s+(door|property|managed)/i;

export function isSubUnitBasis(c: Item19Cohort): boolean {
  return SUBUNIT_RE.test(`${c.label ?? ""} ${c.basis ?? ""}`);
}

export type NoHeadlineKind =
  /** The filing carries no financial performance representation at all. The
   *  franchisor is permitted to say nothing, and many do — Kona Ice at 1,933
   *  open units and Kumon at 1,710 both publish no Item 19 whatsoever. That is
   *  the single most useful thing a candidate can know about a brand and no
   *  broker leads with it. */
  | "no-item19"
  /** Franchised and company results are combined in one table, so franchisee
   *  performance cannot be separated from corporate performance. */
  | "ownership-mixed"
  /** One table is many times its siblings and divides back into line by its own
   *  franchisee count — a system total, not a unit. We do not divide it: a
   *  filing read wrong once is not a filing to guess at twice. */
  | "reported-together"
  /** Every cohort is company- or affiliate-owned. Corporate outlets routinely
   *  gross around twice a franchised one, so these are not franchisee earnings
   *  under any reading. */
  | "no-franchisee-data"
  /** Revenue is disclosed per managed sub-unit (per door, per property), which
   *  is a different denominator from per location. */
  | "not-per-outlet"
  /** The filing discloses a real franchised figure, but from so few outlets that
   *  it describes those outlets rather than the system. */
  | "too-few-reporting"
  /** The ladder cannot build and the record does not say why in a shape this
   *  module can classify. Still stated plainly — never dressed up as a number. */
  | "unexplained";

export interface NoHeadlineReason {
  kind: NoHeadlineKind;
  /** Card-sized, goes exactly where the figure used to sit. Must never read as
   *  a revenue number or as an apology. */
  short: string;
  /** One sentence for the brand page, above the Item 20 call list. */
  detail: string;
  /** The franchisor's own basis note, verbatim from the filing, when the
   *  extraction captured one. Attributed as the filing's words, never ours. */
  filingNote: string | null;
  /** Outlets behind the best franchised cohort. */
  reporting: number | null;
  /** Outlets in the system, for the "n of N" framing. */
  systemUnits: number | null;
}

const FRANCHISED = new Set(["franchised", "mixed"]);

function bestFranchisedSample(cohorts: Item19Cohort[]): number | null {
  const ns = cohorts
    .filter((c) => FRANCHISED.has(String(c.ownership ?? "")))
    .map((c) => c.sampleSize)
    .filter((n): n is number => typeof n === "number" && n > 0);
  return ns.length ? Math.max(...ns) : null;
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/**
 * Explain, from the record alone, why no per-outlet figure is published.
 *
 * Order matters: the checks run most-specific first, because a filing can be
 * several kinds of unusable at once and the most actionable reason is the one
 * the reader needs.
 */
export function explainNoHeadline(input: {
  cohorts: Item19Cohort[];
  hasItem19?: boolean | null;
  notes?: string | null;
  systemUnits?: number | null;
  unusableReason?: string | null;
}): NoHeadlineReason {
  const cohorts = Array.isArray(input.cohorts) ? input.cohorts : [];
  const systemUnits =
    typeof input.systemUnits === "number" && input.systemUnits > 0 ? input.systemUnits : null;
  const filingNote = input.notes?.trim() ? input.notes.trim() : null;
  const reporting = bestFranchisedSample(cohorts);

  const base = { filingNote, reporting, systemUnits };

  // 0. NO ITEM 19 AT ALL. Runs first because it is the most consequential thing
  //    a candidate can learn about a brand, and the one a broker never leads
  //    with. Five of the ninety-nine, including two of the largest systems in
  //    the library.
  if (input.hasItem19 === false || cohorts.length === 0) {
    return {
      ...base,
      kind: "no-item19",
      short: "No Item 19 disclosure",
      detail:
        (systemUnits != null
          ? `This franchisor operates ${plural(systemUnits, "outlet", "outlets")} and publishes no `
          : "This franchisor publishes no ") +
        "financial performance representation. Item 19 is optional, and declining it is a legal " +
        "choice rather than an oversight — but it means no figure in this report, or anywhere " +
        "else, can tell you what a unit earns. Item 20 is where you find out.",
    };
  }

  // 1. A SYSTEM TOTAL IS NOT A UNIT. The scorer already detected this and said
  //    so; repeating its judgement here keeps one source of truth.
  if (input.unusableReason && /together|system total/i.test(input.unusableReason)) {
    return {
      ...base,
      kind: "reported-together",
      short: "Outlets reported together",
      detail:
        "Item 19 reports outlets together rather than one at a time — one table is many times " +
        "its siblings and divides back into line by its own franchisee count. A per-outlet " +
        "figure cannot be read from it, and this report will not estimate one.",
    };
  }

  // 2. No franchisee anywhere in the disclosure.
  const hasFranchised = cohorts.some((c) => FRANCHISED.has(String(c.ownership ?? "")));
  if (cohorts.length > 0 && !hasFranchised) {
    const kinds = new Set(cohorts.map((c) => String(c.ownership ?? "unknown")));
    const whose =
      kinds.has("company") && kinds.has("affiliate")
        ? "company- and affiliate-owned"
        : kinds.has("company")
          ? "company-owned"
          : "affiliate-owned";
    return {
      ...base,
      kind: "no-franchisee-data",
      short: "No franchisee results disclosed",
      detail:
        `Every figure in Item 19 comes from ${whose} outlets. Corporate outlets routinely gross ` +
        "well above franchised ones, so these are not franchisee earnings and are not presented " +
        "as them.",
    };
  }

  // 2b. Franchised and corporate results in one table.
  if (cohorts.length > 0 && cohorts.every((c) => String(c.ownership ?? "") === "mixed")) {
    return {
      ...base,
      kind: "ownership-mixed",
      short: "Franchised and company results combined",
      detail:
        "Item 19 combines franchised and company-owned outlets in the same figures. Corporate " +
        "outlets routinely gross well above franchised ones, so a combined average is not what a " +
        "franchisee should expect and cannot be separated back out from what is disclosed.",
    };
  }

  // 3. A different denominator entirely.
  if (cohorts.some(isSubUnitBasis)) {
    return {
      ...base,
      kind: "not-per-outlet",
      short: "Disclosed per managed unit",
      detail:
        "Item 19 discloses revenue per managed unit — per door or per property — which is a " +
        "different denominator from per franchise location. A per-location figure exists only " +
        "as an estimate built on how many units a franchise manages, so it is not published here.",
    };
  }

  // 4. A real franchised figure, from too few outlets to describe the system.
  /* THRESHOLD, MEASURED NOT GUESSED. The first cut required <= 2 reporting
     outlets AND a system of >= 5, which missed Golf Envy (1 of 3), Property
     Sellwise (1 of 2) and The Original Rainbow Cone (3 of 27) — all three
     plainly too thin to describe a system. The rule is now: a handful of
     outlets, or a tenth of the system, whichever catches it. */
  const thin =
    reporting != null &&
    (reporting <= 3 || (systemUnits != null && reporting / systemUnits <= 0.1));
  if (thin && reporting != null) {
    return {
      ...base,
      kind: "too-few-reporting",
      short:
        systemUnits != null
          ? `${plural(reporting, "outlet", "outlets")} of ${systemUnits.toLocaleString("en-US")} reported`
          : `${plural(reporting, "outlet", "outlets")} reported`,
      detail:
        `Item 19 reports ${plural(reporting, "outlet", "outlets")}` +
        (systemUnits != null ? ` out of ${plural(systemUnits, "outlet", "outlets")} in the system` : "") +
        ". That describes those outlets, not what a new franchisee should expect, so no system " +
        "figure is published.",
    };
  }

  return {
    ...base,
    kind: "unexplained",
    short: "Not enough disclosed to model a unit",
    detail:
      "Item 19 does not support a per-outlet figure this report can stand behind, so none is " +
      "published. The filing's own basis note is below.",
  };
}
