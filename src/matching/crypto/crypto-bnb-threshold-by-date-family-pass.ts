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

export type CryptoBnbThresholdByDateVenue = CryptoThresholdByDateVenue;
export type CryptoBnbThresholdByDateRuleCompatibilityClass = CryptoThresholdByDateRuleCompatibilityClass;
export type CryptoBnbThresholdByDateExtractedRow = CryptoThresholdByDateExtractedRow;
export type CryptoBnbThresholdByDateNormalizedTopicRow = CryptoThresholdByDateNormalizedTopicRow;
export type CryptoBnbThresholdByDateComparabilityTopicSummary = CryptoThresholdByDateComparabilityTopicSummary;
export type CryptoBnbThresholdByDateFoundationArtifacts = CryptoThresholdByDateFoundationArtifacts;

const config = getCryptoThresholdByDateAssetConfig("BNB");

export const buildCryptoBnbThresholdByDateFamilyArtifacts = (
  rows: readonly CryptoBnbThresholdByDateExtractedRow[]
): CryptoBnbThresholdByDateFoundationArtifacts => buildCryptoThresholdByDateFamilyArtifacts(config, rows);
