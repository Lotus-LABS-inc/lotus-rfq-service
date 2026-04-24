import { getCryptoThresholdByDateAssetConfig } from "./crypto-threshold-by-date-assets.js";
import {
  buildCryptoThresholdByDateFamilyArtifacts,
  type CryptoThresholdByDateComparabilityTopicSummary,
  type CryptoThresholdByDateExtractedRow,
  type CryptoThresholdByDateFoundationArtifacts,
  type CryptoThresholdByDateNormalizedTopicRow,
  type CryptoThresholdByDateRuleCompatibilityClass,
  type CryptoThresholdByDateVenue
} from "./crypto-threshold-by-date-shared.js";

export type CryptoEthThresholdByDateVenue = CryptoThresholdByDateVenue;
export type CryptoEthThresholdByDateRuleCompatibilityClass = CryptoThresholdByDateRuleCompatibilityClass;
export type CryptoEthThresholdByDateExtractedRow = CryptoThresholdByDateExtractedRow;
export type CryptoEthThresholdByDateNormalizedTopicRow = CryptoThresholdByDateNormalizedTopicRow;
export type CryptoEthThresholdByDateComparabilityTopicSummary = CryptoThresholdByDateComparabilityTopicSummary;
export type CryptoEthThresholdByDateFoundationArtifacts = CryptoThresholdByDateFoundationArtifacts;

const config = getCryptoThresholdByDateAssetConfig("ETH");

export const buildCryptoEthThresholdByDateFamilyArtifacts = (
  rows: readonly CryptoEthThresholdByDateExtractedRow[]
): CryptoEthThresholdByDateFoundationArtifacts => buildCryptoThresholdByDateFamilyArtifacts(config, rows);
