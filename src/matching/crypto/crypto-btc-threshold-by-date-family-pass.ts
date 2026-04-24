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

export type CryptoBtcThresholdByDateVenue = CryptoThresholdByDateVenue;
export type CryptoBtcThresholdByDateRuleCompatibilityClass = CryptoThresholdByDateRuleCompatibilityClass;
export type CryptoBtcThresholdByDateExtractedRow = CryptoThresholdByDateExtractedRow;
export type CryptoBtcThresholdByDateNormalizedTopicRow = CryptoThresholdByDateNormalizedTopicRow;
export type CryptoBtcThresholdByDateComparabilityTopicSummary = CryptoThresholdByDateComparabilityTopicSummary;
export type CryptoBtcThresholdByDateFoundationArtifacts = CryptoThresholdByDateFoundationArtifacts;

const config = getCryptoThresholdByDateAssetConfig("BTC");

export const buildCryptoBtcThresholdByDateFamilyArtifacts = (
  rows: readonly CryptoBtcThresholdByDateExtractedRow[]
): CryptoBtcThresholdByDateFoundationArtifacts => buildCryptoThresholdByDateFamilyArtifacts(config, rows);
