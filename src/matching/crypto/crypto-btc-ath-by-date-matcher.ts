import { getCryptoAthByDateAssetConfig } from "./crypto-ath-by-date-assets.js";
import {
  buildCryptoAthByDateMatcherMaterialization,
  type CryptoAthByDateMatcherMaterialization,
  type CryptoAthByDateComparabilityTopicSummary,
  type CryptoAthByDateNormalizedTopicRow,
  type CryptoAthByDatePairLane
} from "./crypto-ath-by-date-shared.js";

export type CryptoBtcAthByDatePairLane = CryptoAthByDatePairLane;
export type CryptoBtcAthByDateMatcherMaterialization = CryptoAthByDateMatcherMaterialization;

const config = getCryptoAthByDateAssetConfig("BTC");

export const buildCryptoBtcAthByDateMatcherMaterialization = (input: {
  normalizedTopics: readonly CryptoAthByDateNormalizedTopicRow[];
  comparabilitySummary: readonly CryptoAthByDateComparabilityTopicSummary[];
}): CryptoAthByDateMatcherMaterialization =>
  buildCryptoAthByDateMatcherMaterialization({
    config,
    normalizedTopics: input.normalizedTopics,
    comparabilitySummary: input.comparabilitySummary
  });

export const extractDateKey = (topicKey: string): string =>
  topicKey.startsWith(`${config.familyKey}|`) ? topicKey.slice(`${config.familyKey}|`.length) : topicKey;
