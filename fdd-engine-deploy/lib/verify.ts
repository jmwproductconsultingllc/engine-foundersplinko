// lib/verify.ts — THE single source of the "N things to verify" derivation
// (Risk Reframe, Jul 23). Both the resolver (lib/brandFacts.ts → the teaser
// surfaces) and the paid report (components/DiligenceReport.tsx, which works off
// DiligenceResult, not BrandFacts) call THIS, so all four surfaces render the
// same count + items by construction. The build-time drift audit asserts it.
//
// Pure, no heavy imports — safe to pull into a client component's bundle.
//
// Gating discipline: the raw reason text can carry locked figures ("Above-market
// royalty at 8%"), so it NEVER ships. Only these curated category labels leave
// the server. Order = display priority.

const REASON_RULES: Array<[RegExp, string]> = [
  [/financial (distress|condition|weak)|net worth|solven|going concern|negative equity/i, "Franchisor financial condition"],
  [/royalt|above-?market|fee stack|\bfees?\b|brand fund|ad fund/i, "The fee stack"],
  [/tripwire|operational (risk|restriction)/i, "Operational tripwires"],
  [/item ?19|earnings|revenue|economics|no major stress|assessable|profit/i, "Item 19 earnings basis"],
  [/build-?out|investment|start-?up cost|cost to open/i, "Startup cost"],
  [/churn|closure|closed|unit (growth|decline|stability)|turnover/i, "Unit stability"],
  [/territor|encroach|exclusiv/i, "Territory rights"],
];

/** The closed label set — verifyItems can ONLY be one of these (test-enforced). */
export const VERIFY_LABELS = [
  "Franchisor financial condition",
  "The fee stack",
  "Operational tripwires",
  "Item 19 earnings basis",
  "Startup cost",
  "Unit stability",
  "Territory rights",
  "Disclosures to review",
] as const;

export function categorizeReason(text: string): string {
  for (const [re, label] of REASON_RULES) if (re.test(text)) return label;
  return "Disclosures to review";
}

/**
 * THE label-law phrase: always names the noun, never a naked number, singular
 * at 1 ("1 thing to verify" — emerald reassurance). Single source for every
 * surface; the shared component imports this, never re-implements it.
 */
export function verifyPhrase(count: number): string {
  const n = Math.max(1, Math.round(count));
  return `${n} ${n === 1 ? "thing" : "things"} to verify`;
}

export interface VerifyReadout {
  /** real count of things to verify (floored at 1 — a clean brand reads "1 thing",
   *  emerald reassurance, never "0"). NOT a fixed per-tier number. */
  verifyCount: number;
  /** top ≤3 buyer-facing labels — labels only, raw reason text never ships */
  verifyItems: string[];
}

/**
 * Derive the "N things to verify" readout from scoring.riskReasons. Single
 * source for every surface — teaser (via resolveBrandFacts) and paid report
 * (via DiligenceReport) both call this, so their count + items can't diverge.
 */
export function computeVerify(riskReasons: string[] | null | undefined): VerifyReadout {
  const reasons = Array.isArray(riskReasons) ? riskReasons : [];
  const verifyCount = Math.max(1, reasons.length);
  const seen = new Set<string>();
  const verifyItems: string[] = [];
  for (const r of reasons) {
    const label = categorizeReason(String(r));
    if (!seen.has(label)) {
      seen.add(label);
      verifyItems.push(label);
    }
    if (verifyItems.length >= 3) break;
  }
  return { verifyCount, verifyItems };
}
