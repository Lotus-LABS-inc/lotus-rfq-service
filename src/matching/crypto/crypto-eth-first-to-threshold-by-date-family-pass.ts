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

export type CryptoEthFirstToThresholdByDateVenue = CryptoFirstToThresholdByDateVenue;
export type CryptoEthFirstToThresholdRuleCompatibilityClass = CryptoFirstToThresholdRuleCompatibilityClass;
export type CryptoEthFirstToThresholdByDateExtractedRow = CryptoFirstToThresholdByDateExtractedRow;
export type CryptoEthFirstToThresholdByDateNormalizedTopicRow = CryptoFirstToThresholdByDateNormalizedTopicRow;
export type CryptoEthFirstToThresholdByDateComparabilityTopicSummary = CryptoFirstToThresholdComparabilityTopicSummary;
export type CryptoEthFirstToThresholdFoundationArtifacts = CryptoFirstToThresholdFoundationArtifacts;

const config = getCryptoFirstToThresholdByDateAssetConfig("ETH");

export const buildCryptoEthFirstToThresholdByDateFamilyArtifacts = (
  rows: readonly CryptoEthFirstToThresholdByDateExtractedRow[]
): CryptoEthFirstToThresholdFoundationArtifacts => buildCryptoFirstToThresholdByDateFamilyArtifacts(config, rows);
