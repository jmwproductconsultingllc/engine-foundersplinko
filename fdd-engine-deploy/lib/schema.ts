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

export interface LeadershipMember {
  name: string;
  role: string;
  background: string;
  whyItMatters: string;
}

export interface Item19Cohort {
  /** e.g. "Top 10%", "Middle 60%", "Bottom 30%", "Network Average" */
  label: string;
  avgMonthlyRevenue: number | null;
  /** what this number is based on, e.g. "45 units open 6+ months, 3+ bays" */
  basis: string;
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
  };
  hiddenCosts: HiddenCost[];
  averageRentMonthly: number | null;
  requiredNetWorth: number | null;
  requiredLiquidCapital: number | null;
  systemScale: {
    totalUnits: number | null;
    openedLastYear: number | null;
    closedLastYear: number | null;
    transfersLastYear: number | null;
    sourcePage: string;
  };
  operationalRisks: OperationalRisk[];
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
              avgMonthlyRevenue: { type: Type.NUMBER, nullable: true },
              basis: { type: Type.STRING },
            },
            required: ["label", "avgMonthlyRevenue", "basis"],
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
    requiredNetWorth: { type: Type.NUMBER, nullable: true },
    requiredLiquidCapital: { type: Type.NUMBER, nullable: true },
    systemScale: {
      type: Type.OBJECT,
      properties: {
        totalUnits: { type: Type.NUMBER, nullable: true },
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
  },
  required: [
    "documentCheck", "brandName", "franchisorEntity", "headquarters",
    "brandBackground", "leadership", "item19", "item17", "ongoingFees",
    "hiddenCosts", "systemScale", "operationalRisks",
  ],
};
