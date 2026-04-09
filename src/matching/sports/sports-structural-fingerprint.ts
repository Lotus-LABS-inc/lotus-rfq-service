import { buildStableTextId, canonicalizeJsonRecord, normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { StructuralFingerprint, MatchingMarketRecord } from "../matching-types.js";
import type { SportsScopedDomain, SportsScopedFamily } from "./sports-match-labels.js";
import { extractSportsBoundary } from "./sports-normalization.js";
import type { SportsCompetitionContext } from "./sports-competition-context.js";
import type { SportsSubjectNormalization } from "./sports-subject-entity.js";

const FINGERPRINT_VERSION = "sports-structural-fingerprint-v1";

export const buildSportsStructuralFingerprint = (input: {
  market: MatchingMarketRecord;
  domain: SportsScopedDomain;
  family: SportsScopedFamily;
  competitionContext: SportsCompetitionContext;
  subjectNormalization: SportsSubjectNormalization;
}): StructuralFingerprint => {
  const boundary = extractSportsBoundary(input.market);
  const cutoffTimestamp = input.market.resolvesAt && input.market.resolvesAt.getUTCFullYear() > 1971
    ? input.market.resolvesAt.toISOString()
    : input.market.expiresAt?.toISOString() ?? null;
  const fingerprint = canonicalizeJsonRecord({
    venue: input.market.venue,
    venueMarketId: input.market.venueMarketId,
    domain: input.domain,
    family: input.family,
    sportOrEsport: input.competitionContext.sportOrEsport,
    competitionKey: input.competitionContext.competitionKey,
    competitionLabel: input.competitionContext.competitionLabel,
    competitionScope: input.competitionContext.competitionScope,
    stageOrRound: input.competitionContext.stageOrRound,
    subjectEntity: input.subjectNormalization.normalizedSubjectEntity,
    opponentEntity: input.subjectNormalization.normalizedOpponentEntity,
    matchupKey: input.subjectNormalization.matchupKey,
    dateKey: boundary.dateKey,
    scheduledBoundaryKey: boundary.scheduledBoundaryKey,
    cutoffTimestamp,
    timezoneNormalizedCutoffKey: boundary.scheduledBoundaryKey ?? cutoffTimestamp,
    binaryStructure: input.market.marketClass.toLowerCase(),
    outcomeMappingBasis: input.subjectNormalization.outcomeMappingBasis,
    sideAssignment: input.subjectNormalization.sideAssignment,
    winnerSemantics: "winner"
  });

  const unresolvedDimensions = Object.entries(fingerprint)
    .filter((entry) => entry[1] === null || entry[1] === "")
    .map(([key]) => key);

  return {
    interpretedContractId: input.market.interpretedContractId,
    fingerprintHash: buildStableTextId("sportsfp_", JSON.stringify(fingerprint)),
    fingerprint,
    normalizedValues: canonicalizeJsonRecord({
      title: normalizeFreeText(input.market.title),
      rules: normalizeFreeText(input.market.rulesText ?? "")
    }),
    unresolvedDimensions,
    provenance: canonicalizeJsonRecord({
      domain: input.domain,
      family: input.family,
      sourceMetadataVersion: input.market.sourceMetadataVersion
    }),
    fingerprintVersion: FINGERPRINT_VERSION
  };
};
