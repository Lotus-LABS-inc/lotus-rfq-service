import { buildStableTextId, canonicalizeJsonRecord, normalizeFreeText } from "../canonical/canonicalization-types.js";
import { parseStructuredProposition } from "../simulation/proposition-matching.js";
import type { ContractFamilyClassification, MatchingMarketRecord, StructuralFingerprint } from "./matching-types.js";

const FINGERPRINT_VERSION = "structural-fingerprint-v1";
const UP_DOWN_PATTERN = /\b(up|down)\b/i;
const RANGE_PATTERN = /\bbetween\b|\bfrom\b.+\bto\b/i;

const extractAssetSymbol = (title: string): string | null => {
  const normalized = normalizeFreeText(title);
  return normalized.includes("bitcoin") ? "BTC"
    : normalized.includes("ethereum") ? "ETH"
    : normalized.includes("solana") ? "SOL"
    : normalized.includes("dogecoin") ? "DOGE"
    : null;
};

const extractObservationType = (family: ContractFamilyClassification["family"], title: string): string | null =>
  family === "PRICE_AT_CLOSE" ? "close"
  : /\bby\b/i.test(title) ? "any-time-before"
  : family === "ATH_BY_DATE" ? "intraday-hit"
  : UP_DOWN_PATTERN.test(title) ? "end-of-period"
  : null;

const extractBucketGranularity = (title: string): string | null =>
  RANGE_PATTERN.test(title) ? "range"
  : /\bbucket\b/i.test(title) ? "bucket"
  : null;

const extractSubjectEntities = (title: string): readonly string[] => {
  const versus = title.split(/\bvs\.?\b|\bversus\b/i).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return versus.length >= 2 ? versus.slice(0, 2) : [];
};

const extractFingerprint = (
  market: MatchingMarketRecord,
  familyClassification: ContractFamilyClassification
): StructuralFingerprint => {
  const category =
    market.category === "POLITICS" ? "POLITICS"
    : market.category === "CRYPTO" ? "CRYPTO"
    : market.category === "SPORTS" ? "SPORTS"
    : market.category === "ESPORTS" ? "ESPORTS"
    : market.category === "POP_CULTURE" ? "CULTURE"
    : "OTHER";
  const parsed = parseStructuredProposition({
    category,
    title: market.title,
    rules: market.rulesText,
    boundaryReferenceAt: market.resolvesAt ?? market.expiresAt ?? market.publishedAt
  });
  const fingerprint = canonicalizeJsonRecord({
    venue: market.venue,
    category: market.category,
    family: familyClassification.family,
    asset: extractAssetSymbol(market.title),
    subject: parsed.subject.normalized,
    subjectEntities: extractSubjectEntities(market.title),
    competitionOrContext: parsed.competitionOrContext.normalized,
    comparator: parsed.actionOrCondition.normalized,
    threshold: parsed.threshold.normalized,
    date: parsed.deadlineOrSeason.normalized,
    cutoffTimestamp: (market.resolvesAt ?? market.expiresAt)?.toISOString() ?? null,
    bucketGranularity: extractBucketGranularity(market.title),
    observationType: extractObservationType(familyClassification.family, market.title),
    binaryStructure: market.marketClass === "BINARY" ? "binary" : market.marketClass.toLowerCase(),
    winnerSemantics: /winner|win/i.test(market.title) ? "winner" : null,
    timezoneBoundary: (market.resolvesAt ?? market.expiresAt)?.toISOString().slice(0, 10) ?? null
  });
  const unresolvedDimensions = Object.entries(fingerprint)
    .filter((entry) => entry[1] === null || entry[1] === "")
    .map(([key]) => key);

  return {
    interpretedContractId: market.interpretedContractId,
    fingerprintHash: buildStableTextId("structfp_", JSON.stringify(fingerprint)),
    fingerprint,
    normalizedValues: canonicalizeJsonRecord({
      title: normalizeFreeText(market.title),
      rules: normalizeFreeText(market.rulesText ?? "")
    }),
    unresolvedDimensions,
    provenance: canonicalizeJsonRecord({
      family: familyClassification.family,
      familyRuleIds: familyClassification.ruleIds,
      sourceMetadataVersion: market.sourceMetadataVersion
    }),
    fingerprintVersion: FINGERPRINT_VERSION
  };
};

export const buildStructuralFingerprint = extractFingerprint;
