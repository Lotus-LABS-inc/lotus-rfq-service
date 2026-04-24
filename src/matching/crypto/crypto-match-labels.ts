import type { ContractFamily } from "../matching-types.js";
import type { PairMatchLabel, StructuralMatchOutcome } from "../match-labels.js";

export const cryptoTargetVenueValues = ["POLYMARKET", "LIMITLESS", "OPINION", "PREDICT"] as const;
export type CryptoTargetVenue = typeof cryptoTargetVenueValues[number];

export const cryptoTrackedAsset = "BTC";
export const cryptoScopedAssetValues = ["BTC", "ETH", "SOL"] as const;
export type CryptoTrackedAsset = typeof cryptoScopedAssetValues[number];
export const defaultCryptoTrackedAssets = [cryptoTrackedAsset] as const;

export const cryptoContractFamilyValues = [
  "SAME_DAY_DIRECTIONAL",
  "FIRST_TO_THRESHOLD_BY_DATE",
  "FDV_THRESHOLD_AFTER_LAUNCH",
  "TOKEN_LAUNCH_BY_DATE",
  "THRESHOLD_BY_DATE",
  "ATH_BY_DATE",
  "PRICE_AT_CLOSE",
  "UP_DOWN_BUCKET",
  "PRICE_RANGE_BUCKET",
  "GENERIC_DIRECTIONAL"
] as const satisfies readonly ContractFamily[];
export type CryptoContractFamily = typeof cryptoContractFamilyValues[number];

export const cryptoComparatorValues = [
  "ABOVE",
  "BELOW",
  "AT_OR_ABOVE",
  "AT_OR_BELOW",
  "UP",
  "DOWN",
  "YES_NO_DIRECTIONAL"
] as const;
export type CryptoComparator = typeof cryptoComparatorValues[number];

export const cryptoBucketGranularityValues = ["MINUTE", "HOUR", "DAY", "MONTH"] as const;
export type CryptoBucketGranularity = typeof cryptoBucketGranularityValues[number];

export const cryptoObservationTypeValues = [
  "INTRADAY_HIT",
  "END_OF_PERIOD_CLOSE",
  "ANY_TIME_BEFORE",
  "ONE_DAY_AFTER_LAUNCH",
  "SAME_DAY_DIRECTIONAL",
  "BUCKETED_PRICE_RANGE"
] as const;
export type CryptoObservationType = typeof cryptoObservationTypeValues[number];

export const cryptoStructuralContractClassValues = [
  "FIRST_TO_THRESHOLD_BINARY",
  "FDV_THRESHOLD_ONE_DAY_AFTER_LAUNCH",
  "TOKEN_LAUNCH_DATE_BINARY",
  "THRESHOLD_ANY_TIME_BEFORE_DATE",
  "THRESHOLD_FIXED_TIME",
  "ATH_ANY_TIME_BEFORE_DATE",
  "DAILY_DIRECTIONAL_CLOSE",
  "POINT_IN_TIME_DIRECTIONAL_CLOSE",
  "PRICE_AT_CLOSE_POINT",
  "UP_DOWN_BUCKET",
  "PRICE_RANGE_BUCKET"
] as const;
export type CryptoStructuralContractClass = typeof cryptoStructuralContractClassValues[number];

export const cryptoPrefilterRejectionReasonValues = [
  "ASSET_MISMATCH",
  "FAMILY_MISMATCH",
  "OBSERVATION_TYPE_MISMATCH",
  "BUCKET_GRANULARITY_MISMATCH",
  "DATE_BOUNDARY_MISMATCH",
  "CUTOFF_MISMATCH",
  "COMPARATOR_MISMATCH",
  "THRESHOLD_STRUCTURE_MISMATCH",
  "NON_TARGET_ASSET",
  "BAD_CRYPTO_ROW"
] as const;
export type CryptoPrefilterRejectionReason = typeof cryptoPrefilterRejectionReasonValues[number];

export type CryptoPairMatchLabel = PairMatchLabel;
export type CryptoStructuralMatchOutcome = StructuralMatchOutcome;

export const cryptoAllowedVenuePairs = new Set([
  "LIMITLESS|OPINION",
  "LIMITLESS|POLYMARKET",
  "OPINION|POLYMARKET",
  "POLYMARKET|PREDICT"
]);

export const buildCryptoVenuePairKey = (leftVenue: CryptoTargetVenue, rightVenue: CryptoTargetVenue): string =>
  leftVenue.localeCompare(rightVenue) <= 0 ? `${leftVenue}|${rightVenue}` : `${rightVenue}|${leftVenue}`;
