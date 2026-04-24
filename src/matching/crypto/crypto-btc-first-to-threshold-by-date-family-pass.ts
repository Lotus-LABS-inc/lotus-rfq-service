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

export type CryptoBtcFirstToThresholdByDateVenue = CryptoFirstToThresholdByDateVenue;
export type CryptoBtcFirstToThresholdRuleCompatibilityClass = CryptoFirstToThresholdRuleCompatibilityClass;
export type CryptoBtcFirstToThresholdByDateExtractedRow = CryptoFirstToThresholdByDateExtractedRow;
export type CryptoBtcFirstToThresholdByDateNormalizedTopicRow = CryptoFirstToThresholdByDateNormalizedTopicRow;
export type CryptoBtcFirstToThresholdByDateComparabilityTopicSummary = CryptoFirstToThresholdComparabilityTopicSummary;
export type CryptoBtcFirstToThresholdFoundationArtifacts = CryptoFirstToThresholdFoundationArtifacts;

const config = getCryptoFirstToThresholdByDateAssetConfig("BTC");

export const buildCryptoBtcFirstToThresholdByDateFamilyArtifacts = (
  rows: readonly CryptoBtcFirstToThresholdByDateExtractedRow[]
): CryptoBtcFirstToThresholdFoundationArtifacts => buildCryptoFirstToThresholdByDateFamilyArtifacts(config, rows);
