import type { IResolutionPairComparator } from "../../rfq-engine/resolution-pair-comparator.js";
import type { IResolutionRiskScoringEngine } from "../../rfq-engine/resolution-risk-scoring-engine.js";
import type { NormalizedResolutionProfile, ResolutionRiskScoringInput } from "../../rfq-engine/resolution-risk.types.js";
import { asArray, asObject, asString, ReplayEvaluationError } from "./shared.js";

const toDate = (value: unknown): Date => {
    if (value instanceof Date) {
        return value;
    }
    const text = asString(value, "profile.date");
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        throw new ReplayEvaluationError("invalid_replay_envelope", "profile date must be ISO-compatible.");
    }
    return date;
};

const toProfile = (value: unknown): NormalizedResolutionProfile => {
    const raw = asObject(value, "profile");
    return {
        id: asString(raw.id, "profile.id"),
        venue: asString(raw.venue, "profile.venue"),
        venueMarketId: asString(raw.venueMarketId, "profile.venueMarketId"),
        canonicalEventId: asString(raw.canonicalEventId, "profile.canonicalEventId"),
        canonicalMarketId: asString(raw.canonicalMarketId, "profile.canonicalMarketId"),
        oracleType: asString(raw.oracleType, "profile.oracleType"),
        oracleName: typeof raw.oracleName === "string" ? raw.oracleName : null,
        resolutionAuthorityType: asString(raw.resolutionAuthorityType, "profile.resolutionAuthorityType"),
        primaryResolutionText: asString(raw.primaryResolutionText, "profile.primaryResolutionText"),
        supplementalRulesText: typeof raw.supplementalRulesText === "string" ? raw.supplementalRulesText : null,
        disputeWindowHours: typeof raw.disputeWindowHours === "string" ? raw.disputeWindowHours : null,
        settlementLagHours: typeof raw.settlementLagHours === "string" ? raw.settlementLagHours : null,
        marketType: asString(raw.marketType, "profile.marketType"),
        outcomeSchema: asObject(raw.outcomeSchema, "profile.outcomeSchema"),
        hasAmbiguousTimeBoundary: Boolean(raw.hasAmbiguousTimeBoundary),
        hasAmbiguousJurisdictionBoundary: Boolean(raw.hasAmbiguousJurisdictionBoundary),
        hasAmbiguousSourceReference: Boolean(raw.hasAmbiguousSourceReference),
        historicalDivergenceRate: typeof raw.historicalDivergenceRate === "string" ? raw.historicalDivergenceRate : null,
        metadata: raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata as Record<string, unknown> : {},
        createdAt: toDate(raw.createdAt),
        updatedAt: toDate(raw.updatedAt)
    };
};

export const replayResolutionRiskAssessment = (
    inputSnapshot: Record<string, unknown>,
    comparator: IResolutionPairComparator,
    scoringEngine: IResolutionRiskScoringEngine
): Record<string, unknown> => {
    const profiles = asArray(inputSnapshot.profiles, "inputSnapshot.profiles");
    if (profiles.length !== 2) {
        throw new ReplayEvaluationError("invalid_replay_envelope", "Resolution risk replay requires exactly two profiles.");
    }

    const orderedProfileIds = asArray(inputSnapshot.orderedProfileIds, "inputSnapshot.orderedProfileIds").map((value, index) =>
        asString(value, `inputSnapshot.orderedProfileIds[${index}]`)
    );
    if (orderedProfileIds.length !== 2) {
        throw new ReplayEvaluationError("invalid_replay_envelope", "Resolution risk replay requires two ordered profile ids.");
    }

    const profileA = toProfile(profiles[0]);
    const profileB = toProfile(profiles[1]);
    if (profileA.id !== orderedProfileIds[0] || profileB.id !== orderedProfileIds[1]) {
        throw new ReplayEvaluationError("invalid_replay_envelope", "Resolution risk replay profile order mismatch.");
    }

    const factorComparison = comparator.compare(profileA, profileB);
    const scoringInput: ResolutionRiskScoringInput = {
        canonicalEventId: asString(inputSnapshot.canonicalEventId, "inputSnapshot.canonicalEventId"),
        profileA,
        profileB,
        factorComparison,
        version: asString(inputSnapshot.scoringVersion, "inputSnapshot.scoringVersion")
    };

    return {
        assessment: scoringEngine.score(scoringInput)
    };
};
