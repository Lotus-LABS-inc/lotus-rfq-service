import { buildStableTextId, normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { ContractFamilyClassification, MatchingMarketRecord } from "../matching-types.js";
import type { CryptoContractFamily } from "./crypto-match-labels.js";
import {
  normalizeCryptoAsset,
  normalizeCryptoDateKey
} from "./crypto-normalization.js";

const CLASSIFIER_VERSION = "crypto-family-classifier-v1";

const inferFamily = (market: MatchingMarketRecord): CryptoContractFamily => {
  const text = normalizeFreeText(`${market.title} ${market.rulesText ?? ""}`);
  if (/\bfdv\b.+\babove\b.+\bone day after launch\b/.test(text)) return "FDV_THRESHOLD_AFTER_LAUNCH";
  if (/\blaunch a token\b|\btoken\b.+\bby\b/.test(text)) return "TOKEN_LAUNCH_BY_DATE";
  if (/\bwill\b.+\bhit\b.+\bor\b.+\bfirst\b/.test(text)) return "FIRST_TO_THRESHOLD_BY_DATE";
  if (/\ball time high\b|\bath\b/.test(text)) return "ATH_BY_DATE";
  if ((/\bup or down\b|\bhigher or lower\b/.test(text)) && /\bhourly\b/.test(text)) return "GENERIC_DIRECTIONAL";
  if ((/\bup or down\b|\bhigher or lower\b/.test(text)) && /\b\d{1,2}:\d{2}\s*(utc|et)\b/.test(text)) return "GENERIC_DIRECTIONAL";
  if (/\bup or down\b|\bhigher or lower\b/.test(text)) return "SAME_DAY_DIRECTIONAL";
  if (/\bclose\b/.test(text) && !/\bup or down\b/.test(text)) return "PRICE_AT_CLOSE";
  if (/\bbetween\b|\brange\b/.test(text)) return "PRICE_RANGE_BUCKET";
  if (/\bbucket\b|\bband\b/.test(text)) return "UP_DOWN_BUCKET";
  if (/\$?\s*\d+(?:,\d{3})*(?:\.\d+)?(?:k|m|b)?/.test(text)) return "THRESHOLD_BY_DATE";
  return "GENERIC_DIRECTIONAL";
};

const buildConfidence = (market: MatchingMarketRecord, ambiguityFlags: readonly string[]): string => {
  const base = Number.parseFloat(market.confidenceScore);
  const score = Number.isFinite(base) ? Math.max(0.1, Math.min(1, base - ambiguityFlags.length * 0.1)) : 0.5;
  return score.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
};

const buildAmbiguityFlags = (input: {
  asset: string | null;
  dateKey: string | null;
  family: CryptoContractFamily;
  market: MatchingMarketRecord;
}): readonly string[] => {
  const flags: string[] = [];
  if (!input.asset) flags.push("missing_crypto_asset");
  if (!input.dateKey) flags.push("missing_time_boundary");
  if (
    input.market.venue !== "POLYMARKET"
    && input.market.venue !== "LIMITLESS"
    && input.market.venue !== "OPINION"
    && input.market.venue !== "PREDICT"
  ) {
    flags.push("unsupported_venue");
  }
  if (input.market.category !== "CRYPTO") flags.push("non_crypto_category");
  if (input.family === "GENERIC_DIRECTIONAL" && !/\bup or down\b|\bhigher or lower\b/i.test(input.market.title)) {
    flags.push("fallback_family_classification");
  }
  return flags;
};

export const classifyCryptoFamily = (market: MatchingMarketRecord): ContractFamilyClassification => {
  const family = inferFamily(market);
  const asset = normalizeCryptoAsset(market);
  const dateKey = normalizeCryptoDateKey(market);
  const ambiguityFlags = buildAmbiguityFlags({ asset, dateKey, family, market });
  const structuralLaneEligible = asset !== null && dateKey !== null && market.category === "CRYPTO";
  const sourceHygieneReasons = ambiguityFlags.filter((flag) =>
    flag === "missing_crypto_asset" || flag === "non_crypto_category" || flag === "unsupported_venue"
  );

  return {
    interpretedContractId: market.interpretedContractId,
    family,
    familyConfidence: buildConfidence(market, ambiguityFlags),
    classificationReasons: [
      `family:${family.toLowerCase()}`,
      asset ? `asset:${asset.toLowerCase()}` : "asset:missing",
      dateKey ? `date:${dateKey}` : "date:missing"
    ],
    ruleIds: [
      buildStableTextId("cryptofam_", `${CLASSIFIER_VERSION}|${market.interpretedContractId}|${family}`),
      `family:${family}`
    ],
    ambiguityFlags,
    weakStructureLane: !structuralLaneEligible,
    classifierVersion: CLASSIFIER_VERSION,
    metadata: {
      normalizedAsset: asset,
      normalizedDateKey: dateKey,
      structuralLaneEligible,
      sourceHygieneStatus: sourceHygieneReasons.length === 0 ? "PASS" : "REJECT",
      sourceHygieneReasons,
      cryptoOnlyLane: true
    }
  };
};
