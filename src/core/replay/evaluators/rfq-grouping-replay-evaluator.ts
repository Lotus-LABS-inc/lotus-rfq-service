import type { NormalizedResolutionProfile, ResolutionRiskAssessment, ResolutionRiskVenueGrouping } from "../../rfq-engine/resolution-risk.types.js";
import { computeResolutionRiskVenueGrouping } from "../../rfq-engine/resolution-risk-grouping-core.js";
import { asArray, asObject, asString, ReplayEvaluationError } from "./shared.js";

const toProfile = (value: unknown): NormalizedResolutionProfile => {
    const raw = asObject(value, "orderedProfile");
    return {
        id: asString(raw.id, "orderedProfile.id"),
        venue: typeof raw.venue === "string" ? raw.venue : "unknown",
        venueMarketId: typeof raw.venueMarketId === "string" ? raw.venueMarketId : "unknown",
        canonicalEventId: asString(raw.canonicalEventId, "orderedProfile.canonicalEventId"),
        canonicalMarketId: asString(raw.canonicalMarketId, "orderedProfile.canonicalMarketId"),
        oracleType: typeof raw.oracleType === "string" ? raw.oracleType : null,
        oracleName: typeof raw.oracleName === "string" ? raw.oracleName : null,
        resolutionAuthorityType: typeof raw.resolutionAuthorityType === "string" ? raw.resolutionAuthorityType : null,
        primaryResolutionText: typeof raw.primaryResolutionText === "string" ? raw.primaryResolutionText : null,
        supplementalRulesText: typeof raw.supplementalRulesText === "string" ? raw.supplementalRulesText : null,
        disputeWindowHours: typeof raw.disputeWindowHours === "string" ? raw.disputeWindowHours : null,
        settlementLagHours: typeof raw.settlementLagHours === "string" ? raw.settlementLagHours : null,
        marketType: typeof raw.marketType === "string" ? raw.marketType : null,
        outcomeSchema: raw.outcomeSchema && typeof raw.outcomeSchema === "object" && !Array.isArray(raw.outcomeSchema)
            ? raw.outcomeSchema as Record<string, unknown>
            : {},
        hasAmbiguousTimeBoundary: Boolean(raw.hasAmbiguousTimeBoundary),
        hasAmbiguousJurisdictionBoundary: Boolean(raw.hasAmbiguousJurisdictionBoundary),
        hasAmbiguousSourceReference: Boolean(raw.hasAmbiguousSourceReference),
        historicalDivergenceRate: typeof raw.historicalDivergenceRate === "string" ? raw.historicalDivergenceRate : null,
        metadata: raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata as Record<string, unknown> : {},
        createdAt: new Date(typeof raw.createdAt === "string" ? raw.createdAt : "1970-01-01T00:00:00.000Z"),
        updatedAt: new Date(typeof raw.updatedAt === "string" ? raw.updatedAt : "1970-01-01T00:00:00.000Z")
    };
};

const toAssessment = (value: unknown): ResolutionRiskAssessment => {
    const raw = asObject(value, "orderedAssessment");
    return {
        id: typeof raw.id === "string" ? raw.id : "replay-assessment",
        canonicalEventId: asString(raw.canonicalEventId, "orderedAssessment.canonicalEventId"),
        canonicalMarketId: asString(raw.canonicalMarketId, "orderedAssessment.canonicalMarketId"),
        marketAProfileId: asString(raw.marketAProfileId, "orderedAssessment.marketAProfileId"),
        marketBProfileId: asString(raw.marketBProfileId, "orderedAssessment.marketBProfileId"),
        riskScore: asString(raw.riskScore, "orderedAssessment.riskScore"),
        confidenceScore: asString(raw.confidenceScore, "orderedAssessment.confidenceScore"),
        equivalenceClass: asString(raw.equivalenceClass, "orderedAssessment.equivalenceClass") as ResolutionRiskAssessment["equivalenceClass"],
        factorBreakdown: raw.factorBreakdown && typeof raw.factorBreakdown === "object" && !Array.isArray(raw.factorBreakdown)
            ? raw.factorBreakdown as Record<string, unknown>
            : {},
        reasons: Array.isArray(raw.reasons) ? raw.reasons.map((reason, index) => asString(reason, `orderedAssessment.reasons[${index}]`)) : [],
        version: typeof raw.version === "string" ? raw.version : "replay",
        computedAt: new Date(typeof raw.computedAt === "string" ? raw.computedAt : "1970-01-01T00:00:00.000Z")
    };
};

export const replayRFQGrouping = (inputSnapshot: Record<string, unknown>): { grouping: ResolutionRiskVenueGrouping } => {
    const canonicalEventId = asString(inputSnapshot.canonicalEventId, "inputSnapshot.canonicalEventId");
    const orderedProfiles = asArray(inputSnapshot.orderedCandidateProfiles, "inputSnapshot.orderedCandidateProfiles").map(toProfile);
    const orderedAssessments = asArray(inputSnapshot.orderedAssessments, "inputSnapshot.orderedAssessments").map(toAssessment);

    const sortedIds = [...orderedProfiles.map((profile) => profile.id)].sort((left, right) => left.localeCompare(right));
    if (sortedIds.join("|") !== orderedProfiles.map((profile) => profile.id).join("|")) {
        throw new ReplayEvaluationError("invalid_replay_envelope", "RFQ grouping replay requires ordered profiles.");
    }

    const assessmentMap = new Map<string, ResolutionRiskAssessment>();
    for (const assessment of orderedAssessments) {
        const key = assessment.marketAProfileId.localeCompare(assessment.marketBProfileId) <= 0
            ? `${assessment.marketAProfileId}|${assessment.marketBProfileId}`
            : `${assessment.marketBProfileId}|${assessment.marketAProfileId}`;
        assessmentMap.set(key, assessment);
    }

    return {
        grouping: computeResolutionRiskVenueGrouping(canonicalEventId, orderedProfiles, assessmentMap)
    };
};
