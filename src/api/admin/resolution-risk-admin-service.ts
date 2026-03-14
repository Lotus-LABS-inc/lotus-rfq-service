import type { Logger } from "pino";
import type { Pool } from "pg";

import type { RedisClient } from "../../db/redis.js";
import {
    ResolutionRiskAssessmentServiceError,
    type IResolutionRiskAssessmentService,
} from "../../core/rfq-engine/resolution-risk-assessment-service.js";
import { isResolutionRiskKillSwitchActive } from "../../core/rfq-engine/resolution-risk-runtime-controls.js";
import type {
    NormalizedResolutionProfile,
    ResolutionRiskAssessment,
} from "../../core/rfq-engine/resolution-risk.types.js";

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

interface ResolutionAssessmentRow {
    id: string;
    canonical_event_id: string;
    market_a_profile_id: string;
    market_b_profile_id: string;
    risk_score: string;
    confidence_score: string;
    equivalence_class: ResolutionRiskAssessment["equivalenceClass"];
    factor_breakdown: Record<string, unknown>;
    reasons: readonly string[];
    version: string;
    computed_at: Date;
    liquidity_cost: string | null;
    max_settlement_delay_hours: string | null;
}

export interface ResolutionRiskFreshness {
    profileCount: number;
    expectedPairCount: number;
    persistedPairCount: number;
    lastComputedAt: Date | null;
    latestProfileUpdatedAt: Date | null;
    isComplete: boolean;
    isStale: boolean;
    hasMixedVersions: boolean;
}

export interface ResolutionRiskCanonicalInspection {
    canonicalEventId: string;
    profiles: readonly NormalizedResolutionProfile[];
    assessments: readonly ResolutionRiskAssessment[];
    scoringVersion: string;
    freshness: ResolutionRiskFreshness;
}

export interface ResolutionRiskProfileRecomputeResult {
    profileId: string;
    canonicalEventId: string;
    version: string;
    assessmentCount: number;
    lastComputedAt: Date | null;
}

export interface ResolutionRiskCanonicalRecomputeResult {
    canonicalEventId: string;
    version: string;
    assessmentCount: number;
    lastComputedAt: Date | null;
}

export class ResolutionRiskAdminProfileNotFoundError extends Error {
    public constructor(profileId: string) {
        super(`Resolution risk profile ${profileId} not found.`);
        this.name = "ResolutionRiskAdminProfileNotFoundError";
    }
}

export class ResolutionRiskKillSwitchActiveError extends Error {
    public readonly code = "kill_switch_active";

    public constructor() {
        super("Resolution risk recomputation is disabled by kill switch.");
        this.name = "ResolutionRiskKillSwitchActiveError";
    }
}

export interface ResolutionRiskAdminServiceDeps {
    pool: Pool;
    redis: RedisClient;
    assessmentService: IResolutionRiskAssessmentService;
    logger: Pick<Logger, "info" | "warn" | "error">;
    version: string;
}

export class ResolutionRiskAdminService {
    private readonly pool: Pool;
    private readonly redis: RedisClient;
    private readonly assessmentService: IResolutionRiskAssessmentService;
    private readonly logger: Pick<Logger, "info" | "warn" | "error">;
    private readonly version: string;

    public constructor(deps: ResolutionRiskAdminServiceDeps) {
        this.pool = deps.pool;
        this.redis = deps.redis;
        this.assessmentService = deps.assessmentService;
        this.logger = deps.logger;
        this.version = deps.version;
    }

    public async getCanonicalInspection(eventId: string): Promise<ResolutionRiskCanonicalInspection> {
        const profiles = await this.loadProfilesForCanonicalEvent(eventId);
        const assessmentRows = await this.loadAssessmentRowsForCanonicalEvent(eventId);
        const assessments = this.selectEffectiveAssessments(assessmentRows);
        const versions = [...new Set(assessmentRows.map((assessment) => assessment.version))];
        const lastComputedAt = assessmentRows.reduce<Date | null>(
            (current, assessment) => (current === null || assessment.computedAt > current ? assessment.computedAt : current),
            null,
        );
        const latestProfileUpdatedAt = profiles.reduce<Date | null>(
            (current, profile) => (current === null || profile.updatedAt > current ? profile.updatedAt : current),
            null,
        );
        const expectedPairCount = profiles.length < 2 ? 0 : (profiles.length * (profiles.length - 1)) / 2;
        const persistedPairCount = new Set(
            assessments.map((assessment) => `${assessment.marketAProfileId}|${assessment.marketBProfileId}`),
        ).size;
        const isComplete = profiles.length >= 2 && persistedPairCount === expectedPairCount;
        const isStale = !isComplete || lastComputedAt === null || (latestProfileUpdatedAt !== null && lastComputedAt < latestProfileUpdatedAt);

        return {
            canonicalEventId: eventId,
            profiles,
            assessments,
            scoringVersion: versions.length === 0 ? this.version : versions.length === 1 ? versions[0]! : "mixed",
            freshness: {
                profileCount: profiles.length,
                expectedPairCount,
                persistedPairCount,
                lastComputedAt,
                latestProfileUpdatedAt,
                isComplete,
                isStale,
                hasMixedVersions: versions.length > 1,
            },
        };
    }

    public async recomputeProfileAssessments(input: {
        profileId: string;
        requestedBy: string;
    }): Promise<ResolutionRiskProfileRecomputeResult> {
        await this.ensureKillSwitchInactive({ target: input.profileId, requestedBy: input.requestedBy, mode: "profile" });

        const profile = await this.loadProfileById(input.profileId);
        if (!profile) {
            throw new ResolutionRiskAdminProfileNotFoundError(input.profileId);
        }

        try {
            const assessments = await this.assessmentService.recomputeProfileAssessments(input.profileId);
            const result = {
                profileId: input.profileId,
                canonicalEventId: profile.canonicalEventId,
                version: this.version,
                assessmentCount: assessments.length,
                lastComputedAt: this.findLastComputedAt(assessments),
            };

            this.logger.info(
                {
                    requestedBy: input.requestedBy,
                    profileId: input.profileId,
                    canonicalEventId: profile.canonicalEventId,
                    version: this.version,
                    assessmentCount: assessments.length,
                },
                "Recomputed resolution risk assessments for profile canonical event.",
            );

            return result;
        } catch (error) {
            this.logger.error(
                {
                    err: error,
                    requestedBy: input.requestedBy,
                    profileId: input.profileId,
                    canonicalEventId: profile.canonicalEventId,
                    version: this.version,
                },
                "Failed to recompute resolution risk assessments for profile.",
            );
            throw this.mapServiceError(error, input.profileId);
        }
    }

    public async recomputeCanonicalAssessments(input: {
        canonicalEventId: string;
        requestedBy: string;
    }): Promise<ResolutionRiskCanonicalRecomputeResult> {
        await this.ensureKillSwitchInactive({ target: input.canonicalEventId, requestedBy: input.requestedBy, mode: "canonical" });

        try {
            const assessments = await this.assessmentService.buildAssessmentsForCanonicalEvent(input.canonicalEventId);
            const result = {
                canonicalEventId: input.canonicalEventId,
                version: this.version,
                assessmentCount: assessments.length,
                lastComputedAt: this.findLastComputedAt(assessments),
            };

            this.logger.info(
                {
                    requestedBy: input.requestedBy,
                    canonicalEventId: input.canonicalEventId,
                    version: this.version,
                    assessmentCount: assessments.length,
                },
                "Recomputed resolution risk assessments for canonical event.",
            );

            return result;
        } catch (error) {
            this.logger.error(
                {
                    err: error,
                    requestedBy: input.requestedBy,
                    canonicalEventId: input.canonicalEventId,
                    version: this.version,
                },
                "Failed to recompute resolution risk assessments for canonical event.",
            );
            throw this.mapServiceError(error, input.canonicalEventId);
        }
    }

    private async ensureKillSwitchInactive(input: {
        target: string;
        requestedBy: string;
        mode: "profile" | "canonical";
    }): Promise<void> {
        const active = await isResolutionRiskKillSwitchActive(this.redis);
        if (!active) {
            return;
        }

        this.logger.warn(
            {
                requestedBy: input.requestedBy,
                target: input.target,
                mode: input.mode,
                version: this.version,
            },
            "Blocked resolution risk recomputation because kill switch is active.",
        );
        throw new ResolutionRiskKillSwitchActiveError();
    }

    private async loadProfilesForCanonicalEvent(eventId: string): Promise<readonly NormalizedResolutionProfile[]> {
        const result = await this.pool.query<ResolutionProfileRow>(
            `SELECT *
               FROM resolution_profiles
              WHERE canonical_event_id = $1
              ORDER BY id ASC`,
            [eventId],
        );

        return result.rows.map(mapProfileRow);
    }

    private async loadProfileById(profileId: string): Promise<NormalizedResolutionProfile | null> {
        const result = await this.pool.query<ResolutionProfileRow>(
            `SELECT *
               FROM resolution_profiles
              WHERE id = $1
              LIMIT 1`,
            [profileId],
        );

        return result.rowCount === 0 ? null : mapProfileRow(result.rows[0]!);
    }

    private async loadAssessmentRowsForCanonicalEvent(eventId: string): Promise<readonly ResolutionRiskAssessment[]> {
        const result = await this.pool.query<ResolutionAssessmentRow>(
            `SELECT *
               FROM resolution_risk_assessments
              WHERE canonical_event_id = $1
              ORDER BY market_a_profile_id ASC, market_b_profile_id ASC, computed_at DESC, version DESC`,
            [eventId],
        );

        return result.rows.map(mapAssessmentRow);
    }

    private selectEffectiveAssessments(assessments: readonly ResolutionRiskAssessment[]): readonly ResolutionRiskAssessment[] {
        const selected = new Map<string, ResolutionRiskAssessment>();

        for (const assessment of assessments) {
            const key = `${assessment.marketAProfileId}|${assessment.marketBProfileId}`;
            if (!selected.has(key)) {
                selected.set(key, assessment);
            }
        }

        return [...selected.values()].sort(
            (left, right) =>
                left.marketAProfileId.localeCompare(right.marketAProfileId) ||
                left.marketBProfileId.localeCompare(right.marketBProfileId),
        );
    }

    private findLastComputedAt(assessments: readonly ResolutionRiskAssessment[]): Date | null {
        return assessments.reduce<Date | null>(
            (current, assessment) =>
                current === null || assessment.computedAt > current ? assessment.computedAt : current,
            null,
        );
    }

    private mapServiceError(error: unknown, fallbackProfileId: string): Error {
        if (error instanceof ResolutionRiskAdminProfileNotFoundError || error instanceof ResolutionRiskKillSwitchActiveError) {
            return error;
        }

        if (error instanceof ResolutionRiskAssessmentServiceError) {
            if (error.code === "profile_not_found") {
                return new ResolutionRiskAdminProfileNotFoundError(fallbackProfileId);
            }
        }

        return error instanceof Error ? error : new Error("resolution_risk_admin_error");
    }
}

const mapProfileRow = (row: ResolutionProfileRow): NormalizedResolutionProfile => ({
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
    updatedAt: new Date(row.updated_at),
});

const mapAssessmentRow = (row: ResolutionAssessmentRow): ResolutionRiskAssessment => ({
    id: row.id,
    canonicalEventId: row.canonical_event_id,
    marketAProfileId: row.market_a_profile_id,
    marketBProfileId: row.market_b_profile_id,
    riskScore: row.risk_score,
    confidenceScore: row.confidence_score,
    equivalenceClass: row.equivalence_class,
    factorBreakdown: row.factor_breakdown,
    reasons: row.reasons,
    version: row.version,
    computedAt: new Date(row.computed_at),
    liquidityCost: row.liquidity_cost ?? undefined,
    maxSettlementDelayHours: row.max_settlement_delay_hours ? Number(row.max_settlement_delay_hours) : undefined
});
