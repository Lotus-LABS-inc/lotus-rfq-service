import type { Pool } from "pg";
import type { Logger } from "pino";
import type { IResolutionRiskReadService } from "./resolution-risk-read-service.js";
import { pairKey } from "./resolution-risk-read-service.js";
import type {
    NormalizedResolutionProfile,
    ResolutionEquivalenceClass,
    ResolutionRiskVenueGrouping
} from "./resolution-risk.types.js";

interface ResolutionProfileRow {
    id: string;
    venue: string;
    venue_market_id: string;
    canonical_event_id: string;
    oracle_type: string | null;
    oracle_name: string | null;
    resolution_authority_type: string | null;
    primary_resolution_text: string | null;
    supplemental_rules_text: string | null;
    dispute_window_hours: string | null;
    settlement_lag_hours: string | null;
    market_type: string | null;
    outcome_schema: Record<string, unknown> | null;
    has_ambiguous_time_boundary: boolean;
    has_ambiguous_jurisdiction_boundary: boolean;
    has_ambiguous_source_reference: boolean;
    historical_divergence_rate: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}

export class ResolutionRiskGroupingError extends Error {
    public readonly code:
        | "missing_resolution_profiles"
        | "invalid_profile_event"
        | "resolution_grouping_failed";

    public constructor(
        code:
            | "missing_resolution_profiles"
            | "invalid_profile_event"
            | "resolution_grouping_failed"
    ) {
        super(code);
        this.name = "ResolutionRiskGroupingError";
        this.code = code;
    }
}

export interface IResolutionRiskGroupingService {
    groupProfilesForCanonicalEvent(canonicalEventId: string): Promise<ResolutionRiskVenueGrouping>;
}

interface ResolutionRiskGroupingServiceDeps {
    pool: Pool;
    readService: IResolutionRiskReadService;
    logger: Pick<Logger, "info" | "warn" | "error">;
}

export class ResolutionRiskGroupingService implements IResolutionRiskGroupingService {
    private readonly pool: Pool;
    private readonly readService: IResolutionRiskReadService;
    private readonly logger: Pick<Logger, "info" | "warn" | "error">;

    public constructor(deps: ResolutionRiskGroupingServiceDeps) {
        this.pool = deps.pool;
        this.readService = deps.readService;
        this.logger = deps.logger;
    }

    public async groupProfilesForCanonicalEvent(canonicalEventId: string): Promise<ResolutionRiskVenueGrouping> {
        const profiles = await this.loadProfilesForCanonicalEvent(canonicalEventId);
        if (profiles.length === 0) {
            throw new ResolutionRiskGroupingError("missing_resolution_profiles");
        }

        for (const profile of profiles) {
            if (profile.canonicalEventId !== canonicalEventId) {
                throw new ResolutionRiskGroupingError("invalid_profile_event");
            }
        }

        const orderedProfiles = [...profiles].sort((left, right) => left.id.localeCompare(right.id));
        const assessmentMap = await this.readService.getAssessmentsByProfilePairs(
            this.generatePairs(orderedProfiles)
        );

        const cautionProfiles = new Set<string>();
        const blockedProfiles = new Set<string>();
        const reasonsByProfile = new Map<string, string[]>();
        const pairMatrixEntries: Array<[string, { equivalenceClass: ResolutionEquivalenceClass; reasons: readonly string[] }]> = [];

        for (let index = 0; index < orderedProfiles.length; index += 1) {
            for (let cursor = index + 1; cursor < orderedProfiles.length; cursor += 1) {
                const left = orderedProfiles[index]!;
                const right = orderedProfiles[cursor]!;
                const key = pairKey(left.id, right.id);
                const assessment = assessmentMap.get(key);

                if (!assessment) {
                    const reason = `pair:${key}: missing persisted resolution risk assessment; fail-closed for pooling`;
                    cautionProfiles.add(left.id);
                    cautionProfiles.add(right.id);
                    appendReason(reasonsByProfile, left.id, reason);
                    appendReason(reasonsByProfile, right.id, reason);
                    pairMatrixEntries.push([
                        key,
                        {
                            equivalenceClass: "DO_NOT_POOL",
                            reasons: [reason]
                        }
                    ]);
                    continue;
                }

                const prefixedReasons =
                    assessment.reasons.length > 0
                        ? assessment.reasons.map((reason) => `pair:${key}: ${reason}`)
                        : [`pair:${key}: ${assessment.equivalenceClass}`];

                pairMatrixEntries.push([
                    key,
                    {
                        equivalenceClass: assessment.equivalenceClass,
                        reasons: prefixedReasons
                    }
                ]);

                switch (assessment.equivalenceClass) {
                    case "SAFE_EQUIVALENT":
                        break;
                    case "CAUTION":
                        cautionProfiles.add(left.id);
                        cautionProfiles.add(right.id);
                        appendReasons(reasonsByProfile, left.id, prefixedReasons);
                        appendReasons(reasonsByProfile, right.id, prefixedReasons);
                        break;
                    case "HIGH_RISK":
                    case "DO_NOT_POOL":
                        blockedProfiles.add(left.id);
                        blockedProfiles.add(right.id);
                        appendReasons(reasonsByProfile, left.id, prefixedReasons);
                        appendReasons(reasonsByProfile, right.id, prefixedReasons);
                        break;
                }
            }
        }

        for (const blockedProfileId of blockedProfiles) {
            cautionProfiles.delete(blockedProfileId);
        }

        const safeCandidates = orderedProfiles
            .map((profile) => profile.id)
            .filter((profileId) => !blockedProfiles.has(profileId) && !cautionProfiles.has(profileId));

        const safePools = safeCandidates.length === 0 ? [] : [safeCandidates];
        const cautionLanes = [...cautionProfiles].sort((left, right) => left.localeCompare(right)).map((profileId) => [profileId]);
        const groupedReasons = Object.fromEntries(
            [...reasonsByProfile.entries()]
                .sort((left, right) => left[0].localeCompare(right[0]))
                .map(([profileId, reasons]) => [profileId, [...new Set(reasons)].sort((left, right) => left.localeCompare(right))])
        );

        const grouping: ResolutionRiskVenueGrouping = {
            canonicalEventId,
            safePools,
            cautionLanes,
            blockedProfiles: [...blockedProfiles].sort((left, right) => left.localeCompare(right)),
            reasonsByProfile: groupedReasons,
            pairMatrix: Object.fromEntries(
                pairMatrixEntries.sort((left, right) => left[0].localeCompare(right[0]))
            )
        };

        this.logger.info(
            {
                canonicalEventId,
                safePoolCount: grouping.safePools.length,
                cautionLaneCount: grouping.cautionLanes.length,
                blockedProfileCount: grouping.blockedProfiles.length
            },
            "Computed deterministic resolution-risk venue grouping."
        );

        return grouping;
    }

    private async loadProfilesForCanonicalEvent(canonicalEventId: string): Promise<readonly NormalizedResolutionProfile[]> {
        try {
            const result = await this.pool.query<ResolutionProfileRow>(
                `SELECT *
                   FROM resolution_profiles
                  WHERE canonical_event_id = $1
                  ORDER BY id ASC`,
                [canonicalEventId]
            );

            return result.rows.map((row) => ({
                id: row.id,
                venue: row.venue,
                venueMarketId: row.venue_market_id,
                canonicalEventId: row.canonical_event_id,
                oracleType: row.oracle_type,
                oracleName: row.oracle_name,
                resolutionAuthorityType: row.resolution_authority_type,
                primaryResolutionText: row.primary_resolution_text,
                supplementalRulesText: row.supplemental_rules_text,
                disputeWindowHours: row.dispute_window_hours,
                settlementLagHours: row.settlement_lag_hours,
                marketType: row.market_type,
                outcomeSchema: row.outcome_schema,
                hasAmbiguousTimeBoundary: row.has_ambiguous_time_boundary,
                hasAmbiguousJurisdictionBoundary: row.has_ambiguous_jurisdiction_boundary,
                hasAmbiguousSourceReference: row.has_ambiguous_source_reference,
                historicalDivergenceRate: row.historical_divergence_rate,
                metadata: row.metadata,
                createdAt: new Date(row.created_at),
                updatedAt: new Date(row.updated_at)
            }));
        } catch (error) {
            this.logger.error({ err: error, canonicalEventId }, "Failed to load resolution profiles for grouping.");
            throw new ResolutionRiskGroupingError("resolution_grouping_failed");
        }
    }

    private generatePairs(
        profiles: readonly NormalizedResolutionProfile[]
    ): ReadonlyArray<{ profileAId: string; profileBId: string }> {
        const pairs: Array<{ profileAId: string; profileBId: string }> = [];
        for (let index = 0; index < profiles.length; index += 1) {
            for (let cursor = index + 1; cursor < profiles.length; cursor += 1) {
                pairs.push({
                    profileAId: profiles[index]!.id,
                    profileBId: profiles[cursor]!.id
                });
            }
        }
        return pairs;
    }
}

const appendReason = (reasonsByProfile: Map<string, string[]>, profileId: string, reason: string): void => {
    const current = reasonsByProfile.get(profileId) ?? [];
    current.push(reason);
    reasonsByProfile.set(profileId, current);
};

const appendReasons = (reasonsByProfile: Map<string, string[]>, profileId: string, reasons: readonly string[]): void => {
    for (const reason of reasons) {
        appendReason(reasonsByProfile, profileId, reason);
    }
};
