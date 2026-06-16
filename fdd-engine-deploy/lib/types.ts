import { ExtractedFDD } from "./schema";
import { ScoringResult } from "./scoring";
import { UnderwritingResult, BuyerContext } from "./underwriting";

export interface DiligenceResult {
  extracted: ExtractedFDD;
  scoring: ScoringResult;
  underwriting: UnderwritingResult;
  buyer: BuyerContext;
}
