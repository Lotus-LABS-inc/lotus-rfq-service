import { getCryptoAthByDateAssetConfig } from "./crypto-ath-by-date-assets.js";
import {
  buildCryptoAthByDateFamilyArtifacts,
  type CryptoAthByDateComparabilityTopicSummary,
  type CryptoAthByDateExtractedRow,
  type CryptoAthByDateFoundationArtifacts,
  type CryptoAthByDateNormalizedTopicRow,
  type CryptoAthByDateRuleCompatibilityClass,
  type CryptoAthByDateVenue
} from "./crypto-ath-by-date-shared.js";

export type CryptoBtcAthByDateVenue = CryptoAthByDateVenue;
export type CryptoBtcAthByDateRuleCompatibilityClass = CryptoAthByDateRuleCompatibilityClass;
export type CryptoBtcAthByDateExtractedRow = CryptoAthByDateExtractedRow;
export type CryptoBtcAthByDateNormalizedTopicRow = CryptoAthByDateNormalizedTopicRow;
export type CryptoBtcAthByDateComparabilityTopicSummary = CryptoAthByDateComparabilityTopicSummary;
export type CryptoBtcAthByDateFoundationArtifacts = CryptoAthByDateFoundationArtifacts;

const config = getCryptoAthByDateAssetConfig("BTC");

export const buildCryptoBtcAthByDateFamilyArtifacts = (
  rows: readonly CryptoBtcAthByDateExtractedRow[]
): CryptoBtcAthByDateFoundationArtifacts => buildCryptoAthByDateFamilyArtifacts(config, rows);
