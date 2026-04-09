import { buildStableTextId, canonicalizeJsonRecord, normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { ContractFamilyClassification, MatchingMarketRecord, StructuralFingerprint } from "../matching-types.js";
import type { CryptoContractFamily } from "./crypto-match-labels.js";
import {
  buildCryptoDeterministicHash,
  extractCryptoRangeMetadata,
  inferCryptoBinaryStructure,
  inferCryptoBucketGranularity,
  inferCryptoObservationType,
  inferCryptoStructuralContractClass,
  normalizeCryptoAsset,
  normalizeCryptoComparator,
  normalizeCryptoCutoff,
  normalizeCryptoDateKey,
  normalizeCryptoThreshold
} from "./crypto-normalization.js";

const FINGERPRINT_VERSION = "crypto-structural-fingerprint-v1";

const getFamily = (classification: ContractFamilyClassification): CryptoContractFamily =>
  classification.family as CryptoContractFamily;

const resolveThreshold = (market: MatchingMarketRecord, family: CryptoContractFamily): string | null =>
  family === "THRESHOLD_BY_DATE" || family === "PRICE_RANGE_BUCKET" || family === "UP_DOWN_BUCKET"
    ? normalizeCryptoThreshold(market)
    : null;

export const buildCryptoStructuralFingerprint = (
  market: MatchingMarketRecord,
  classification: ContractFamilyClassification
): StructuralFingerprint => {
  const family = getFamily(classification);
  const asset = normalizeCryptoAsset(market);
  const comparator = normalizeCryptoComparator(market);
  const threshold = resolveThreshold(market, family);
  const dateKey = normalizeCryptoDateKey(market);
  const cutoff = normalizeCryptoCutoff(market, family);
  const bucketGranularity = inferCryptoBucketGranularity(market);
  const observationType = inferCryptoObservationType(market, family);
  const structuralContractClass = inferCryptoStructuralContractClass(family, observationType, bucketGranularity);
  const rangeBucketMetadata = extractCryptoRangeMetadata(market);
  const fingerprint = canonicalizeJsonRecord({
    venue: market.venue,
    venueMarketId: market.venueMarketId,
    asset,
    family,
    comparator,
    threshold,
    thresholdUnit: "USD",
    dateKey,
    cutoffTimestamp: cutoff?.cutoffTimestamp ?? null,
    timezoneNormalizedCutoffKey: cutoff?.timezoneNormalizedCutoffKey ?? null,
    bucketGranularity,
    observationType,
    binaryStructure: inferCryptoBinaryStructure(market),
    rangeBucketMetadata,
    structuralContractClass
  });
  const unresolvedDimensions = Object.entries(fingerprint)
    .filter(([, value]) => value === null || value === "")
    .map(([key]) => key);

  return {
    interpretedContractId: market.interpretedContractId,
    fingerprintHash: buildStableTextId("cryptofp_", buildCryptoDeterministicHash(fingerprint)),
    fingerprint,
    normalizedValues: canonicalizeJsonRecord({
      normalizedTitle: normalizeFreeText(market.title),
      normalizedRules: normalizeFreeText(market.rulesText ?? ""),
      normalizedAsset: asset,
      normalizedDateKey: dateKey
    }),
    unresolvedDimensions,
    provenance: canonicalizeJsonRecord({
      classifierVersion: classification.classifierVersion,
      familyRuleIds: classification.ruleIds,
      fingerprintVersion: FINGERPRINT_VERSION
    }),
    fingerprintVersion: FINGERPRINT_VERSION
  };
};
