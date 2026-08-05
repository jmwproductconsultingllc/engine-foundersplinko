/**
 * schema.ts
 * The single source of truth for what we extract from an FDD.
 *
 * KEY PRINCIPLE: Gemini ONLY extracts facts here (with provenance).
 * It does NOT score risk or make judgments — that happens in scoring.ts
 * and underwriting.ts, in deterministic code. That keeps results consistent,
 * explainable, and defensible.
 *
 * Every numeric figure has a matching `source` / `sourcePage` string so the
 * UI can show "(Item 19, p.37)" and a human can verify it.
 */

import { Type } from "@google/genai";
import type { FinancialConditionExtraction } from "./financialCondition";

export interface LeadershipMember {
  name: string;
  role: string;
  background: string;
  whyItMatters: string;
}

export interface Item19Cohort {
  /** e.g. "Top 10%", "Middle 60%", "Company Centers - Average", "Franchised - Low" */
  label: string;
  /** THE most important field. Company- and affiliate-owned outlets routinely
   *  gross ~2x franchised ones and must NEVER be presented as franchisee earnings.
   *  Five Iron's headline $3.0M is company-owned; its franchisees average $1.5M. */
  ownership?: "franchised" | "company" | "affiliate" | "mixed" | "unknown";
  /** how many outlets sit behind this figure (e.g. 2 = dangerously thin) */
  sampleSize?: number | null;
  /** what the number actually is — guards against reading profit, or pre-sale
   *  revenue (memberships sold before a unit opens), as ongoing operating revenue */
  revenueType?: "gross_sales" | "net_or_ebitda" | "pre_sale_only" | "other";
  avgMonthlyRevenue: number | null;
  /** Every monthly value for this tier, if the table breaks it out by month.
   *  We compute the true average from these in code — don't trust the model to
   *  pick the right summary column (it tends to grab a single month). */
  monthlyValues?: number[];
  /** If the figure is disclosed annually (e.g. Five Iron's $3.0M/yr), put the
   *  annual number here; code divides by 12 so the model never has to.
   *  For per-unit-revenue cohorts this is the AVERAGE (mean) annual revenue. */
  annualRevenue?: number | null;
  /** When a cohort discloses BOTH average and median of the same annual figure
   *  (e.g. Real Property Management: avg $4,552 AND median $4,256 revenue per
   *  managed unit), put the median here so a derivation can pair median-with-
   *  median instead of mixing an average numerator with a median denominator. */
  medianAnnualRevenue?: number | null;
  /** what this number is based on, e.g. "45 units open 6+ months, 3+ bays" */
  basis: string;
}

export interface RentDisclosure {
  /** the rent figure exactly as disclosed, no conversion */
  rawValue: number | null;
  /** the unit it was disclosed in — code normalizes to monthly */
  unit?:
    | "per_sqft_per_year"
    | "per_sqft_per_month"
    | "per_month"
    | "per_year"
    | "unknown";
  /** square footage, required to convert any per-sqft figure to dollars */
  squareFootage?: number | null;
  /** WARNING: an Item 7 line like "Lease Deposit and Rent - 3 Months" is a
   *  deposit-plus-a-few-months cash outlay, NOT monthly rent. Note the source so
   *  the two are never confused. */
  source: string;
}

export interface Item17LineItem {
  category: string;
  low: number | null;
  high: number | null;
  /** true = recurring/ongoing, false = one-time build-out */
  recurring: boolean;
  notes: string;
}

export interface FlatFee {
  name: string;
  monthlyAmount: number | null;
  /** e.g. "Item 6, p.41" */
  source: string;
}

/**
 * A single continuing fee charged as a PERCENTAGE OF SALES.
 *
 * Why this exists: ongoingFees carried exactly three named percentage slots
 * (royalty / brandFund / localAd). Real Item 6 tables routinely disclose more —
 * Noodles & Co. charges four (5% royalty + 1.75% national marketing + 1.0%
 * local + 1.25% technology = 9.00%) and the fourth had nowhere to live, so the
 * ladder's rung 2 silently understated the deal.
 *
 * This field is ADDITIVE and optional on purpose. Stored records that predate
 * it fall back to the three named slots (see lib/ladderInput.ts →
 * resolvePercentageFees), so no already-minted report's arithmetic moves.
 */
export interface PercentageFee {
  /** e.g. "Royalty", "National marketing fund", "Technology fee" */
  label: string;
  /** percent of gross sales, expressed as a whole number: 5 means 5% */
  pct: number;
  /** e.g. "Item 6, p.41" */
  source: string;
}

export interface HiddenCost {
  name: string;
  description: string;
  estimatedAnnualAmount: number | null;
  /** where in the doc this was buried, e.g. "Item 6, Section 10.5" */
  source: string;
}

export interface OperationalRisk {
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  source: string;
}

/** Industry/concept classification that drives the Insights benchmark layer.
 *  The model classifies into one of these; code supplies all benchmark numbers. */
export type ConceptType =
  | "food_beverage_full_service"
  | "food_beverage_qsr"
  | "experiential_entertainment"
  | "experiential_with_fb"
  | "fitness_studio"
  | "health_wellness"
  | "retail_product"
  | "home_trade_services"
  | "beauty_personal_care"
  | "education_childcare"
  | "other";

/**
 * ITEM 17 — RENEWAL, TERMINATION, TRANSFER AND DISPUTE RESOLUTION.
 *
 * Every field here is a count, a duration, or a short phrase lifted from the
 * Item 17 table. Nothing here is a judgment: the model never decides whether a
 * term is standard, unusual, harsh, favorable, enforceable or unenforceable.
 * Derivations (longest possible hold, franchisor-vs-franchisee ground counts)
 * happen in code, never in the model.
 *
 * A field the Item 17 table does not state is null and renders as
 * "Not stated in this table" — never as "None". Item 17 is a summary; absence
 * from the table is not absence from the franchise agreement.
 */
export interface CurableDefault {
  /** the category as the table words it, e.g. "Failure to pay money" */
  category: string;
  /** cure period in days; null when the table names a category with no period */
  cureDays: number | null;
}

export interface ExitTerms {
  /** 17(a) */
  initialTermYears: number | null;
  /** 17(b) — how many successor terms, and how long each is */
  successorTermCount: number | null;
  successorTermYears: number | null;
  /** 17(c) — does renewal require signing the THEN-CURRENT agreement? */
  renewalRequiresCurrentAgreement: boolean | null;
  /** 17(c) — the conditions as the table words them */
  renewalConditions: string | null;
  /** 17(c) — how the successor fee is expressed, verbatim-ish
   *  (e.g. "50% of then-current initial franchise fee plus training costs") */
  successorFeeBasis: string | null;
  /** 17(e) — true only if the table states the franchisor may terminate without cause */
  franchisorTerminationWithoutCause: boolean | null;
  /** 17(g) */
  curableDefaults: CurableDefault[];
  /** 17(h) — how many non-curable grounds the table actually names */
  nonCurableDefaultCount: number | null;
  /** 17(h) — true when the list ends "and others" or equivalent, i.e. the count is a floor */
  nonCurableOpenEnded: boolean | null;
  /** 17(d) — how many grounds the table gives the FRANCHISEE to terminate */
  franchiseeTerminationGrounds: number | null;
  /** 17(k)(l) */
  transferApprovalRequired: boolean | null;
  /** 17(m) — how many conditions the table lists for approval */
  transferConditionCount: number | null;
  /** 17(n) */
  rightOfFirstRefusal: boolean | null;
  rightOfFirstRefusalDays: number | null;
  /** 17(p) */
  deathTransferDays: number | null;
  estateApplicationDays: number | null;
  /** 17(q) — scope as worded; null when the table states none */
  inTermNonCompete: string | null;
  /** 17(r) — 0 and null are DIFFERENT and must never render identically */
  postTermNonCompeteYears: number | null;
  postTermNonCompeteMiles: number | null;
  /** 17(r) — what the radius is measured against, as worded */
  postTermNonCompeteScope: string | null;
  /** 17(u) */
  disputeResolution: string | null;
  /** 17(v) */
  forum: string | null;
  /** 17(w) */
  governingLaw: string | null;
  /** e.g. "Item 17, pp. 47-52" */
  sourcePage: string;
}

export interface ExtractedFDD {
  documentCheck: {
    appearsComplete: boolean;
    appearsScanned: boolean;
    /** which core items were actually found, e.g. ["Item 1","Item 7","Item 17","Item 19"] */
    itemsFound: string[];
    warnings: string[];
  };
  brandName: string;
  franchisorEntity: string;
  headquarters: string;
  brandBackground: string;
  leadership: LeadershipMember[];
  item19: {
    hasItem19: boolean;
    unitsReported: number | null;
    cohorts: Item19Cohort[];
    networkAverageMonthly: number | null;
    notes: string;
    sourcePage: string;
  };
  item17: {
    initialInvestmentLow: number | null;
    initialInvestmentHigh: number | null;
    lineItems: Item17LineItem[];
    sourcePage: string;
  };
  ongoingFees: {
    royaltyPct: number | null;
    brandFundPct: number | null;
    localAdPct: number | null;
    flatMonthlyFees: FlatFee[];
    /**
     * EVERY continuing percentage-of-sales fee in Item 6, including the three
     * named above. Optional: absent on records extracted before this field
     * existed, and lib/ladderInput.ts falls back to the named slots when it is.
     * When present it is authoritative — the named slots are deduped against it.
     */
    percentageFees?: PercentageFee[];
  };
  hiddenCosts: HiddenCost[];
  /** normalized monthly rent (computed in code from rentDetail) — what scoring uses */
  averageRentMonthly: number | null;
  /** raw rent disclosure (value + unit + sqft) so code can normalize and the
   *  report can show its work; handles $/sqft/yr vs $/mo vs the 3-month cash line */
  rentDetail?: RentDisclosure;
  requiredNetWorth: number | null;
  requiredLiquidCapital: number | null;
  systemScale: {
    totalUnits: number | null;
    /** Outlets open at the START of the last fiscal year — Item 20 Table 1.
     *  Optional: every record written before 2026-08-03 predates the field, and
     *  lib/churn.ts falls back to reconstructing it. Never sourced from Item 19. */
    unitsStartOfYear?: number | null;
    openedLastYear: number | null;
    closedLastYear: number | null;
    transfersLastYear: number | null;
    sourcePage: string;
  };
  operationalRisks: OperationalRisk[];
  /** AI-classified concept/industry — drives the Insights benchmark layer. */
  conceptType: ConceptType;
  /** one-line reason for the classification */
  conceptRationale?: string;
  /** operating model — drives the Insights labor adjustment */
  staffingModel: "staffed" | "lightly_staffed" | "automated";
  /** one-line reason for the staffing classification */
  staffingRationale?: string;
  /** RAW financial-condition facts (Item 21 / Exhibit F + Special Risks page).
   *  Severity grading happens in code (financialCondition.ts). Optional/nullable
   *  so a filing with no readable audited financials degrades cleanly rather than
   *  failing extraction. */
  financialCondition?: FinancialConditionExtraction;
  /** RAW Item 17 terms — counted, never characterized. Optional: absent on every
   *  record extracted before this field existed. The report's "Leaving" section
   *  and its nav entry are omitted entirely when it is missing, never rendered
   *  empty, and it is deliberately NOT in the top-level required[] below so that
   *  legacy blobs stay valid. */
  exitTerms?: ExitTerms;
}

/**
 * The response schema handed to Gemini so it returns strict JSON matching
 * ExtractedFDD. Numbers must be raw (no "$" or ","). Unknown = null.
 */
export const fddResponseSchema = {
  type: Type.OBJECT,
  properties: {
    documentCheck: {
      type: Type.OBJECT,
      properties: {
        appearsComplete: { type: Type.BOOLEAN },
        appearsScanned: { type: Type.BOOLEAN },
        itemsFound: { type: Type.ARRAY, items: { type: Type.STRING } },
        warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["appearsComplete", "appearsScanned", "itemsFound", "warnings"],
    },
    brandName: { type: Type.STRING },
    franchisorEntity: { type: Type.STRING },
    headquarters: { type: Type.STRING },
    brandBackground: { type: Type.STRING },
    leadership: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING },
          background: { type: Type.STRING },
          whyItMatters: { type: Type.STRING },
        },
        required: ["name", "role", "background", "whyItMatters"],
      },
    },
    item19: {
      type: Type.OBJECT,
      properties: {
        hasItem19: { type: Type.BOOLEAN },
        unitsReported: { type: Type.NUMBER, nullable: true },
        cohorts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              ownership: {
                type: Type.STRING,
                enum: ["franchised", "company", "affiliate", "mixed", "unknown"],
              },
              sampleSize: { type: Type.NUMBER, nullable: true },
              revenueType: {
                type: Type.STRING,
                enum: ["gross_sales", "net_or_ebitda", "pre_sale_only", "other"],
              },
              avgMonthlyRevenue: { type: Type.NUMBER, nullable: true },
              monthlyValues: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              annualRevenue: { type: Type.NUMBER, nullable: true },
              basis: { type: Type.STRING },
            },
            required: ["label", "ownership", "revenueType", "avgMonthlyRevenue", "basis"],
          },
        },
        networkAverageMonthly: { type: Type.NUMBER, nullable: true },
        notes: { type: Type.STRING },
        sourcePage: { type: Type.STRING },
      },
      required: ["hasItem19", "cohorts", "notes", "sourcePage"],
    },
    item17: {
      type: Type.OBJECT,
      properties: {
        initialInvestmentLow: { type: Type.NUMBER, nullable: true },
        initialInvestmentHigh: { type: Type.NUMBER, nullable: true },
        lineItems: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              low: { type: Type.NUMBER, nullable: true },
              high: { type: Type.NUMBER, nullable: true },
              recurring: { type: Type.BOOLEAN },
              notes: { type: Type.STRING },
            },
            required: ["category", "recurring", "notes"],
          },
        },
        sourcePage: { type: Type.STRING },
      },
      required: ["lineItems", "sourcePage"],
    },
    ongoingFees: {
      type: Type.OBJECT,
      properties: {
        royaltyPct: { type: Type.NUMBER, nullable: true },
        brandFundPct: { type: Type.NUMBER, nullable: true },
        localAdPct: { type: Type.NUMBER, nullable: true },
        flatMonthlyFees: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              monthlyAmount: { type: Type.NUMBER, nullable: true },
              source: { type: Type.STRING },
            },
            required: ["name", "source"],
          },
        },
        percentageFees: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              pct: { type: Type.NUMBER },
              source: { type: Type.STRING },
            },
            required: ["label", "pct", "source"],
          },
        },
      },
      required: ["flatMonthlyFees"],
    },
    hiddenCosts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          estimatedAnnualAmount: { type: Type.NUMBER, nullable: true },
          source: { type: Type.STRING },
        },
        required: ["name", "description", "source"],
      },
    },
    averageRentMonthly: { type: Type.NUMBER, nullable: true },
    rentDetail: {
      type: Type.OBJECT,
      properties: {
        rawValue: { type: Type.NUMBER, nullable: true },
        unit: {
          type: Type.STRING,
          enum: [
            "per_sqft_per_year",
            "per_sqft_per_month",
            "per_month",
            "per_year",
            "unknown",
          ],
        },
        squareFootage: { type: Type.NUMBER, nullable: true },
        source: { type: Type.STRING },
      },
      required: ["rawValue", "unit", "source"],
    },
    requiredNetWorth: { type: Type.NUMBER, nullable: true },
    requiredLiquidCapital: { type: Type.NUMBER, nullable: true },
    systemScale: {
      type: Type.OBJECT,
      properties: {
        totalUnits: { type: Type.NUMBER, nullable: true },
        unitsStartOfYear: { type: Type.NUMBER, nullable: true },
        openedLastYear: { type: Type.NUMBER, nullable: true },
        closedLastYear: { type: Type.NUMBER, nullable: true },
        transfersLastYear: { type: Type.NUMBER, nullable: true },
        sourcePage: { type: Type.STRING },
      },
      required: ["sourcePage"],
    },
    operationalRisks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
          source: { type: Type.STRING },
        },
        required: ["title", "description", "severity", "source"],
      },
    },
    conceptType: {
      type: Type.STRING,
      enum: [
        "food_beverage_full_service", "food_beverage_qsr",
        "experiential_entertainment", "experiential_with_fb",
        "fitness_studio", "health_wellness", "retail_product",
        "home_trade_services", "beauty_personal_care",
        "education_childcare", "other",
      ],
    },
    conceptRationale: { type: Type.STRING },
    staffingModel: {
      type: Type.STRING,
      enum: ["staffed", "lightly_staffed", "automated"],
    },
    staffingRationale: { type: Type.STRING },
    financialCondition: {
      type: Type.OBJECT,
      properties: {
        specialRiskPresent: { type: Type.BOOLEAN },
        auditorName: { type: Type.STRING, nullable: true },
        auditOpinion: {
          type: Type.STRING,
          enum: ["unmodified", "qualified", "adverse", "disclaimer", "unknown"],
        },
        goingConcernRaised: { type: Type.BOOLEAN },
        priorPeriodRestatement: { type: Type.BOOLEAN },
        parentName: { type: Type.STRING, nullable: true },
        parentGuaranteeOfPerformance: { type: Type.BOOLEAN },
        years: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              fiscalYearEnd: { type: Type.STRING, nullable: true },
              revenue: { type: Type.NUMBER, nullable: true },
              netIncome: { type: Type.NUMBER, nullable: true },
              totalAssets: { type: Type.NUMBER, nullable: true },
              totalLiabilities: { type: Type.NUMBER, nullable: true },
              cash: { type: Type.NUMBER, nullable: true },
              currentAssets: { type: Type.NUMBER, nullable: true },
              currentLiabilities: { type: Type.NUMBER, nullable: true },
              relatedPartyDebt: { type: Type.NUMBER, nullable: true },
              deferredRevenue: { type: Type.NUMBER, nullable: true },
              netWorth: { type: Type.NUMBER, nullable: true },
            },
            required: ["fiscalYearEnd"],
          },
        },
      },
      required: [
        "specialRiskPresent", "auditOpinion", "goingConcernRaised",
        "priorPeriodRestatement", "parentGuaranteeOfPerformance", "years",
      ],
    },
    exitTerms: {
      type: Type.OBJECT,
      properties: {
        initialTermYears: { type: Type.NUMBER, nullable: true },
        successorTermCount: { type: Type.NUMBER, nullable: true },
        successorTermYears: { type: Type.NUMBER, nullable: true },
        renewalRequiresCurrentAgreement: { type: Type.BOOLEAN, nullable: true },
        renewalConditions: { type: Type.STRING, nullable: true },
        successorFeeBasis: { type: Type.STRING, nullable: true },
        franchisorTerminationWithoutCause: { type: Type.BOOLEAN, nullable: true },
        curableDefaults: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              cureDays: { type: Type.NUMBER, nullable: true },
            },
            required: ["category"],
          },
        },
        nonCurableDefaultCount: { type: Type.NUMBER, nullable: true },
        nonCurableOpenEnded: { type: Type.BOOLEAN, nullable: true },
        franchiseeTerminationGrounds: { type: Type.NUMBER, nullable: true },
        transferApprovalRequired: { type: Type.BOOLEAN, nullable: true },
        transferConditionCount: { type: Type.NUMBER, nullable: true },
        rightOfFirstRefusal: { type: Type.BOOLEAN, nullable: true },
        rightOfFirstRefusalDays: { type: Type.NUMBER, nullable: true },
        deathTransferDays: { type: Type.NUMBER, nullable: true },
        estateApplicationDays: { type: Type.NUMBER, nullable: true },
        inTermNonCompete: { type: Type.STRING, nullable: true },
        postTermNonCompeteYears: { type: Type.NUMBER, nullable: true },
        postTermNonCompeteMiles: { type: Type.NUMBER, nullable: true },
        postTermNonCompeteScope: { type: Type.STRING, nullable: true },
        disputeResolution: { type: Type.STRING, nullable: true },
        forum: { type: Type.STRING, nullable: true },
        governingLaw: { type: Type.STRING, nullable: true },
        sourcePage: { type: Type.STRING },
      },
      required: ["curableDefaults", "sourcePage"],
    },
  },
  // exitTerms is intentionally NOT here: every persisted report predates it.
  required: [
    "documentCheck", "brandName", "franchisorEntity", "headquarters",
    "brandBackground", "leadership", "item19", "item17", "ongoingFees",
    "hiddenCosts", "systemScale", "operationalRisks", "conceptType",
    "staffingModel", "financialCondition",
  ],
};
