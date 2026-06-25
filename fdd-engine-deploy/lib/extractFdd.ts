// fdd-engine-deploy/lib/extractFdd.ts
//
// Provider failover for FDD extraction. The engine must not have a single point
// of failure on one model vendor — when the primary is unavailable (e.g. Gemini
// 503 "high demand" spikes) we automatically fail over to the other provider.
//
// - Primary is selectable at runtime: EXTRACTION_PRIMARY = "gemini" (default) or
//   "claude". During a provider outage, flip the env var to skip the dead vendor
//   entirely — no code change, no waiting on retries.
// - Failover triggers on ANY primary error. The cost of one extra attempt on a
//   genuinely-bad PDF is small; the cost of NOT trying the healthy provider when
//   we could have served the customer is a lost sale. Resilience wins.
// - Returns which provider served the result so the pipeline/logs can see when a
//   fallback happened (a signal to check on the primary).

import { ExtractedFDD } from "./schema";
import { extractFddFromFile } from "./gemini";
import { extractFddWithClaude } from "./claude";

export type ExtractionProvider = "gemini" | "claude";

type Extractor = (bytes: ArrayBuffer, mimeType: string) => Promise<ExtractedFDD>;

const EXTRACTORS: Record<ExtractionProvider, Extractor> = {
  gemini: extractFddFromFile,
  claude: extractFddWithClaude,
};

export interface ExtractionOutcome {
  result: ExtractedFDD;
  provider: ExtractionProvider;
  fellBack: boolean;
}

function resolvePrimary(): ExtractionProvider {
  return process.env.EXTRACTION_PRIMARY === "claude" ? "claude" : "gemini";
}

function msgOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "unknown error";
  }
}

export async function extractFdd(
  fileBytes: ArrayBuffer,
  mimeType: string,
): Promise<ExtractionOutcome> {
  const primary = resolvePrimary();
  const secondary: ExtractionProvider = primary === "gemini" ? "claude" : "gemini";

  try {
    const result = await EXTRACTORS[primary](fileBytes, mimeType);
    return { result, provider: primary, fellBack: false };
  } catch (primaryErr) {
    console.error(
      `[extract] primary provider "${primary}" failed — failing over to "${secondary}": ${msgOf(primaryErr)}`,
    );
    try {
      const result = await EXTRACTORS[secondary](fileBytes, mimeType);
      console.warn(`[extract] recovered via fallback provider "${secondary}".`);
      return { result, provider: secondary, fellBack: true };
    } catch (secondaryErr) {
      // Both providers are down or the document is genuinely unprocessable.
      console.error(
        `[extract] fallback provider "${secondary}" also failed: ${msgOf(secondaryErr)}`,
      );
      throw new Error(
        `Extraction failed on both providers (primary "${primary}": ${msgOf(primaryErr)}; ` +
          `fallback "${secondary}": ${msgOf(secondaryErr)}).`,
      );
    }
  }
}
