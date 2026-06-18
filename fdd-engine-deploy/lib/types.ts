import { ExtractedFDD } from "./schema";
import { ScoringResult } from "./scoring";
import { UnderwritingResult, BuyerContext } from "./underwriting";
import { InsightsResult } from "./insights";

export interface DiligenceResult {
  extracted: ExtractedFDD;
  scoring: ScoringResult;
  underwriting: UnderwritingResult;
  buyer: BuyerContext;
  /** Franchise Edge · Insights — null when the feature is toggled off. */
  insights?: InsightsResult | null;
}
