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

export type CryptoSolThresholdByDateVenue = CryptoThresholdByDateVenue;
export type CryptoSolThresholdByDateRuleCompatibilityClass = CryptoThresholdByDateRuleCompatibilityClass;
export type CryptoSolThresholdByDateExtractedRow = CryptoThresholdByDateExtractedRow;
export type CryptoSolThresholdByDateNormalizedTopicRow = CryptoThresholdByDateNormalizedTopicRow;
export type CryptoSolThresholdByDateComparabilityTopicSummary = CryptoThresholdByDateComparabilityTopicSummary;
export type CryptoSolThresholdByDateFoundationArtifacts = CryptoThresholdByDateFoundationArtifacts;

const config = getCryptoThresholdByDateAssetConfig("SOL");

export const buildCryptoSolThresholdByDateFamilyArtifacts = (
  rows: readonly CryptoSolThresholdByDateExtractedRow[]
): CryptoSolThresholdByDateFoundationArtifacts => buildCryptoThresholdByDateFamilyArtifacts(config, rows);
