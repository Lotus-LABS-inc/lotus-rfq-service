import { getCryptoFirstToThresholdByDateAssetConfig } from "./crypto-first-to-threshold-by-date-assets.js";
import {
  buildCryptoFirstToThresholdByDateFamilyArtifacts,
  type CryptoFirstToThresholdComparabilityTopicSummary,
  type CryptoFirstToThresholdByDateExtractedRow,
  type CryptoFirstToThresholdFoundationArtifacts,
  type CryptoFirstToThresholdByDateNormalizedTopicRow,
  type CryptoFirstToThresholdRuleCompatibilityClass,
  type CryptoFirstToThresholdByDateVenue
} from "./crypto-first-to-threshold-by-date-shared.js";

export type CryptoSolFirstToThresholdByDateVenue = CryptoFirstToThresholdByDateVenue;
export type CryptoSolFirstToThresholdRuleCompatibilityClass = CryptoFirstToThresholdRuleCompatibilityClass;
export type CryptoSolFirstToThresholdByDateExtractedRow = CryptoFirstToThresholdByDateExtractedRow;
export type CryptoSolFirstToThresholdByDateNormalizedTopicRow = CryptoFirstToThresholdByDateNormalizedTopicRow;
export type CryptoSolFirstToThresholdByDateComparabilityTopicSummary = CryptoFirstToThresholdComparabilityTopicSummary;
export type CryptoSolFirstToThresholdFoundationArtifacts = CryptoFirstToThresholdFoundationArtifacts;

const config = getCryptoFirstToThresholdByDateAssetConfig("SOL");

export const buildCryptoSolFirstToThresholdByDateFamilyArtifacts = (
  rows: readonly CryptoSolFirstToThresholdByDateExtractedRow[]
): CryptoSolFirstToThresholdFoundationArtifacts => buildCryptoFirstToThresholdByDateFamilyArtifacts(config, rows);
