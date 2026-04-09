import { normalizeFreeText } from "../canonical/canonicalization-types.js";
import type {
  ContractFamilyClassification,
  EmbeddingShortlistResult,
  MatchingMarketRecord
} from "./matching-types.js";

export interface EmbeddingCandidateGenerator {
  shortlist(input: {
    leftMarket: MatchingMarketRecord;
    rightMarket: MatchingMarketRecord;
    leftFamily: ContractFamilyClassification;
    rightFamily: ContractFamilyClassification;
  }): EmbeddingShortlistResult;
}

const tokenize = (value: string): readonly string[] =>
  normalizeFreeText(value)
    .split(" ")
    .filter((token, index, values) => token.length > 1 && values.indexOf(token) === index);

const jaccard = (left: readonly string[], right: readonly string[]): number => {
  const intersection = left.filter((token) => right.includes(token)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
};

export class TokenJaccardEmbeddingCandidateGenerator implements EmbeddingCandidateGenerator {
  public shortlist(input: {
    leftMarket: MatchingMarketRecord;
    rightMarket: MatchingMarketRecord;
    leftFamily: ContractFamilyClassification;
    rightFamily: ContractFamilyClassification;
  }): EmbeddingShortlistResult {
    const threshold = 0.72;
    const similarity = jaccard(
      tokenize(`${input.leftMarket.title} ${input.leftMarket.rulesText ?? ""}`),
      tokenize(`${input.rightMarket.title} ${input.rightMarket.rulesText ?? ""}`)
    );
    const sanityPassed =
      input.leftMarket.category === input.rightMarket.category
      && input.leftFamily.family === input.rightFamily.family;

    return {
      shortlisted: sanityPassed && similarity >= threshold,
      similarityScore: similarity.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""),
      shortlistThreshold: threshold.toFixed(2),
      shortlistReasons: sanityPassed ? ["event-lane-shortlist"] : ["family-domain-sanity-failed"],
      modelVersion: "token-jaccard-shortlist-v1"
    };
  }
}
