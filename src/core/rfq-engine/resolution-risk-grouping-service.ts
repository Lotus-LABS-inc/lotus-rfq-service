import type { Pool } from "pg";
import type { Logger } from "pino";
import type { IResolutionRiskReadService } from "./resolution-risk-read-service.js";
import { pairKey } from "./resolution-risk-read-service.js";
import type {
    NormalizedResolutionProfile,
    ResolutionRiskAssessment,
    ResolutionRiskVenueGrouping
} from "./resolution-risk.types.js";
import {
    buildResolutionRiskPairs,
    computeResolutionRiskVenueGrouping
} from "./resolution-risk-grouping-core.js";

interface ResolutionProfileRow {
    id: string;
    venue: string;
    venue_market_id: string;
    canonical_event_id: string;
    canonical_market_id: string;
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
    groupProfilesForCanonicalEventWithTrace(canonicalEventId: string): Promise<ResolutionRiskGroupingTrace>;
}

export interface ResolutionRiskGroupingTrace {
    canonicalEventId: string;
    orderedProfiles: readonly NormalizedResolutionProfile[];
    orderedAssessments: readonly ResolutionRiskAssessment[];
    pairGenerationOrder: readonly string[];
    grouping: ResolutionRiskVenueGrouping;
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
        const trace = await this.groupProfilesForCanonicalEventWithTrace(canonicalEventId);
        return trace.grouping;
    }

    public async groupProfilesForCanonicalEventWithTrace(canonicalEventId: string): Promise<ResolutionRiskGroupingTrace> {
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
        const pairs = buildResolutionRiskPairs(orderedProfiles);
        const assessmentMap = await this.readService.getAssessmentsByProfilePairs(pairs);
        const grouping: ResolutionRiskVenueGrouping = computeResolutionRiskVenueGrouping(
            canonicalEventId,
            orderedProfiles,
            assessmentMap
        );

        this.logger.info(
            {
                canonicalEventId,
                safePoolCount: grouping.safePools.length,
                cautionLaneCount: grouping.cautionLanes.length,
                blockedProfileCount: grouping.blockedProfiles.length
            },
            "Computed deterministic resolution-risk venue grouping."
        );

        const orderedAssessments = [...assessmentMap.values()].sort((left, right) =>
            left.marketAProfileId.localeCompare(right.marketAProfileId) ||
            left.marketBProfileId.localeCompare(right.marketBProfileId)
        );

        return {
            canonicalEventId,
            orderedProfiles,
            orderedAssessments,
            pairGenerationOrder: pairs.map((pair) => pairKey(pair.profileAId, pair.profileBId)),
            grouping
        };
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
                canonicalMarketId: row.canonical_market_id,
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
}
