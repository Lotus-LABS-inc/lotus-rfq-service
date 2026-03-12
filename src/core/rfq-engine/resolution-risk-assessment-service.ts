import type { Pool } from "pg";
import type { Logger } from "pino";
import type { IResolutionPairComparator } from "./resolution-pair-comparator.js";
import type { IResolutionRiskScoringEngine } from "./resolution-risk-scoring-engine.js";
import type { IReplayDecisionCaptureService } from "../replay/replay-decision-capture-service.js";
import type { ReplayCaptureConfig } from "../replay/replay.types.js";
import { ResolutionRiskSnapshotBuilder } from "../replay/builders/resolution-risk-snapshot-builder.js";
import type {
    NormalizedResolutionProfile,
    ResolutionRiskAssessment,
    ResolutionRiskAssessmentMetricsHooks,
    ResolutionRiskAssessmentPair,
    ResolutionRiskAssessmentServiceConfig
} from "./resolution-risk.types.js";

type ServiceErrorCode =
    | "profile_not_found"
    | "canonical_event_not_found"
    | "cross_event_pair_not_allowed"
    | "invalid_pair_ordering"
    | "assessment_persistence_failed";

interface ResolutionRiskAssessmentRow {
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
}

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

export class ResolutionRiskAssessmentServiceError extends Error {
    public readonly code: ServiceErrorCode;

    public constructor(code: ServiceErrorCode) {
        super(code);
        this.name = "ResolutionRiskAssessmentServiceError";
        this.code = code;
    }
}

export interface IResolutionRiskAssessmentService {
    buildAssessmentsForCanonicalEvent(canonicalEventId: string): Promise<readonly ResolutionRiskAssessment[]>;
    comparePair(profileAId: string, profileBId: string): Promise<ResolutionRiskAssessment>;
    recomputeProfileAssessments(profileId: string): Promise<readonly ResolutionRiskAssessment[]>;
}

interface ResolutionRiskAssessmentServiceDeps {
    pool: Pool;
    comparator: IResolutionPairComparator;
    scoringEngine: IResolutionRiskScoringEngine;
    logger: Pick<Logger, "info" | "warn" | "error">;
    metricsHooks?: ResolutionRiskAssessmentMetricsHooks;
    config: ResolutionRiskAssessmentServiceConfig;
    replayDecisionCaptureService?: IReplayDecisionCaptureService;
    replayCaptureConfig?: ReplayCaptureConfig;
}

export class ResolutionRiskAssessmentService implements IResolutionRiskAssessmentService {
    private readonly pool: Pool;
    private readonly comparator: IResolutionPairComparator;
    private readonly scoringEngine: IResolutionRiskScoringEngine;
    private readonly logger: Pick<Logger, "info" | "warn" | "error">;
    private readonly metricsHooks: ResolutionRiskAssessmentMetricsHooks | undefined;
    private readonly version: string;
    private readonly replayDecisionCaptureService: IReplayDecisionCaptureService | undefined;
    private readonly replayCaptureConfig: ReplayCaptureConfig | undefined;
    private readonly replaySnapshotBuilder = new ResolutionRiskSnapshotBuilder();

    public constructor(deps: ResolutionRiskAssessmentServiceDeps) {
        this.pool = deps.pool;
        this.comparator = deps.comparator;
        this.scoringEngine = deps.scoringEngine;
        this.logger = deps.logger;
        this.metricsHooks = deps.metricsHooks;
        this.version = deps.config.version;
        this.replayDecisionCaptureService = deps.replayDecisionCaptureService;
        this.replayCaptureConfig = deps.replayCaptureConfig;
    }

    public async buildAssessmentsForCanonicalEvent(canonicalEventId: string): Promise<readonly ResolutionRiskAssessment[]> {
        this.logger.info({ canonicalEventId, version: this.version }, "Building resolution risk assessments for canonical event.");

        const profiles = await this.loadProfilesForCanonicalEvent(canonicalEventId);
        if (profiles.length === 0) {
            this.logger.warn({ canonicalEventId, version: this.version }, "No resolution profiles found for canonical event.");
            return [];
        }

        if (profiles.length === 1) {
            this.logger.warn({ canonicalEventId, version: this.version }, "Only one resolution profile found for canonical event.");
            return [];
        }

        const assessments = await this.buildForProfiles(canonicalEventId, profiles);
        this.logger.info(
            { canonicalEventId, version: this.version, assessmentCount: assessments.length },
            "Completed resolution risk assessment build for canonical event."
        );
        return assessments;
    }

    public async comparePair(profileAId: string, profileBId: string): Promise<ResolutionRiskAssessment> {
        const pair = this.canonicalizePair(profileAId, profileBId);
        const profiles = await this.loadProfilesByIds([pair.marketAProfileId, pair.marketBProfileId]);

        if (profiles.length !== 2) {
            throw new ResolutionRiskAssessmentServiceError("profile_not_found");
        }

        const [profileA, profileB] = this.orderProfilesForPair(profiles, pair);
        if (profileA.canonicalEventId !== profileB.canonicalEventId) {
            throw new ResolutionRiskAssessmentServiceError("cross_event_pair_not_allowed");
        }

        return this.compareScoreAndPersist(profileA, profileB);
    }

    public async recomputeProfileAssessments(profileId: string): Promise<readonly ResolutionRiskAssessment[]> {
        const profile = await this.loadProfileById(profileId);
        if (!profile) {
            throw new ResolutionRiskAssessmentServiceError("profile_not_found");
        }

        this.logger.info(
            { profileId, canonicalEventId: profile.canonicalEventId, version: this.version },
            "Recomputing resolution risk assessments for canonical event."
        );

        const profiles = await this.loadProfilesForCanonicalEvent(profile.canonicalEventId);
        if (profiles.length === 0) {
            throw new ResolutionRiskAssessmentServiceError("canonical_event_not_found");
        }

        const assessments = profiles.length < 2
            ? []
            : await this.buildForProfiles(profile.canonicalEventId, profiles);

        this.metricsHooks?.onAssessmentRecomputed?.({
            canonicalEventId: profile.canonicalEventId,
            profileId,
            assessmentCount: assessments.length,
            version: this.version
        });

        this.logger.info(
            {
                profileId,
                canonicalEventId: profile.canonicalEventId,
                version: this.version,
                assessmentCount: assessments.length
            },
            "Completed resolution risk assessment recompute for canonical event."
        );

        return assessments;
    }

    private async buildForProfiles(
        canonicalEventId: string,
        profiles: readonly NormalizedResolutionProfile[]
    ): Promise<readonly ResolutionRiskAssessment[]> {
        const pairs = this.generatePairs(profiles);
        const assessments: ResolutionRiskAssessment[] = [];

        for (const pair of pairs) {
            assessments.push(await this.compareScoreAndPersist(pair.profileA, pair.profileB));
        }

        return assessments.sort((left, right) =>
            left.marketAProfileId.localeCompare(right.marketAProfileId) ||
            left.marketBProfileId.localeCompare(right.marketBProfileId)
        );
    }

    private async compareScoreAndPersist(
        profileA: NormalizedResolutionProfile,
        profileB: NormalizedResolutionProfile
    ): Promise<ResolutionRiskAssessment> {
        try {
            const factorComparison = this.comparator.compare(profileA, profileB);
            const scored = this.scoringEngine.score({
                canonicalEventId: profileA.canonicalEventId,
                marketAProfileId: profileA.id,
                marketBProfileId: profileB.id,
                factorComparison,
                version: this.version
            });

            if (this.replayDecisionCaptureService && this.replayCaptureConfig) {
                await this.replayDecisionCaptureService.capture({
                    config: this.replayCaptureConfig,
                    buildEnvelope: (metadata) =>
                        this.replaySnapshotBuilder.build({
                            ...metadata,
                            correlationId: `${profileA.canonicalEventId}:${profileA.id}:${profileB.id}:${this.version}`,
                            canonicalEventId: profileA.canonicalEventId,
                            profileA: profileA as unknown as Record<string, unknown>,
                            profileB: profileB as unknown as Record<string, unknown>,
                            factorComparison: factorComparison as unknown as Record<string, unknown>,
                            scoredAssessment: scored as unknown as Record<string, unknown>,
                            scoringWeights: this.scoringEngine.getReplayWeights() as unknown as Record<string, unknown>,
                            confidenceInputs: this.scoringEngine.buildReplayConfidenceInputs(factorComparison),
                            equivalenceThresholds: this.scoringEngine.getReplayThresholds() as unknown as Record<string, unknown>
                        })
                });
            }

            this.metricsHooks?.onAssessmentBuilt?.({
                canonicalEventId: scored.canonicalEventId,
                marketAProfileId: scored.marketAProfileId,
                marketBProfileId: scored.marketBProfileId,
                equivalenceClass: scored.equivalenceClass,
                riskScore: scored.riskScore,
                confidenceScore: scored.confidenceScore,
                version: scored.version
            });

            const assessment = await this.upsertAssessment(scored);

            this.metricsHooks?.onAssessmentPersisted?.({
                canonicalEventId: assessment.canonicalEventId,
                marketAProfileId: assessment.marketAProfileId,
                marketBProfileId: assessment.marketBProfileId,
                equivalenceClass: assessment.equivalenceClass,
                riskScore: assessment.riskScore,
                confidenceScore: assessment.confidenceScore,
                version: assessment.version
            });

            this.logger.info(
                {
                    canonicalEventId: assessment.canonicalEventId,
                    marketAProfileId: assessment.marketAProfileId,
                    marketBProfileId: assessment.marketBProfileId,
                    version: assessment.version
                },
                "Persisted resolution risk assessment pair."
            );

            return assessment;
        } catch (error) {
            const errorCode = error instanceof Error ? error.message : "unknown_error";
            this.metricsHooks?.onAssessmentFailed?.({
                canonicalEventId: profileA.canonicalEventId,
                marketAProfileId: profileA.id,
                marketBProfileId: profileB.id,
                version: this.version,
                errorCode
            });

            this.logger.error(
                {
                    err: error,
                    canonicalEventId: profileA.canonicalEventId,
                    marketAProfileId: profileA.id,
                    marketBProfileId: profileB.id,
                    version: this.version
                },
                "Failed to compare, score, or persist resolution risk assessment pair."
            );
            throw error;
        }
    }

    private canonicalizePair(profileAId: string, profileBId: string): ResolutionRiskAssessmentPair {
        if (profileAId.trim().length === 0 || profileBId.trim().length === 0 || profileAId === profileBId) {
            throw new ResolutionRiskAssessmentServiceError("invalid_pair_ordering");
        }

        return profileAId.localeCompare(profileBId) <= 0
            ? { marketAProfileId: profileAId, marketBProfileId: profileBId }
            : { marketAProfileId: profileBId, marketBProfileId: profileAId };
    }

    private orderProfilesForPair(
        profiles: readonly NormalizedResolutionProfile[],
        pair: ResolutionRiskAssessmentPair
    ): [NormalizedResolutionProfile, NormalizedResolutionProfile] {
        const profileA = profiles.find((profile) => profile.id === pair.marketAProfileId);
        const profileB = profiles.find((profile) => profile.id === pair.marketBProfileId);

        if (!profileA || !profileB) {
            throw new ResolutionRiskAssessmentServiceError("profile_not_found");
        }

        return [profileA, profileB];
    }

    private generatePairs(
        profiles: readonly NormalizedResolutionProfile[]
    ): ReadonlyArray<{ profileA: NormalizedResolutionProfile; profileB: NormalizedResolutionProfile }> {
        const ordered = [...profiles].sort((left, right) => left.id.localeCompare(right.id));
        const pairs: Array<{ profileA: NormalizedResolutionProfile; profileB: NormalizedResolutionProfile }> = [];

        for (let index = 0; index < ordered.length; index += 1) {
            for (let cursor = index + 1; cursor < ordered.length; cursor += 1) {
                pairs.push({ profileA: ordered[index]!, profileB: ordered[cursor]! });
            }
        }

        return pairs;
    }

    private async loadProfilesForCanonicalEvent(canonicalEventId: string): Promise<readonly NormalizedResolutionProfile[]> {
        const result = await this.pool.query<ResolutionProfileRow>(
            `SELECT *
               FROM resolution_profiles
              WHERE canonical_event_id = $1
              ORDER BY id ASC`,
            [canonicalEventId]
        );

        return result.rows.map((row) => this.mapProfileRow(row));
    }

    private async loadProfilesByIds(profileIds: readonly string[]): Promise<readonly NormalizedResolutionProfile[]> {
        const result = await this.pool.query<ResolutionProfileRow>(
            `SELECT *
               FROM resolution_profiles
              WHERE id = ANY($1::uuid[])
              ORDER BY id ASC`,
            [profileIds]
        );

        return result.rows.map((row) => this.mapProfileRow(row));
    }

    private async loadProfileById(profileId: string): Promise<NormalizedResolutionProfile | null> {
        const result = await this.pool.query<ResolutionProfileRow>(
            `SELECT *
               FROM resolution_profiles
              WHERE id = $1`,
            [profileId]
        );

        return result.rowCount === 0 ? null : this.mapProfileRow(result.rows[0]!);
    }

    private async upsertAssessment(
        scored: ReturnType<IResolutionRiskScoringEngine["score"]>
    ): Promise<ResolutionRiskAssessment> {
        try {
            const result = await this.pool.query<ResolutionRiskAssessmentRow>(
                `INSERT INTO resolution_risk_assessments
                    (canonical_event_id, market_a_profile_id, market_b_profile_id, risk_score, confidence_score, equivalence_class, factor_breakdown, reasons, version)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
                 ON CONFLICT (canonical_event_id, market_a_profile_id, market_b_profile_id, version)
                 DO UPDATE
                     SET risk_score = EXCLUDED.risk_score,
                         confidence_score = EXCLUDED.confidence_score,
                         equivalence_class = EXCLUDED.equivalence_class,
                         factor_breakdown = EXCLUDED.factor_breakdown,
                         reasons = EXCLUDED.reasons,
                         computed_at = now()
                 RETURNING *`,
                [
                    scored.canonicalEventId,
                    scored.marketAProfileId,
                    scored.marketBProfileId,
                    scored.riskScore,
                    scored.confidenceScore,
                    scored.equivalenceClass,
                    JSON.stringify(scored.factorBreakdown),
                    JSON.stringify(scored.reasons),
                    scored.version
                ]
            );

            return this.mapAssessmentRow(result.rows[0]!);
        } catch (error) {
            throw new ResolutionRiskAssessmentServiceError("assessment_persistence_failed");
        }
    }

    private mapProfileRow(row: ResolutionProfileRow): NormalizedResolutionProfile {
        return {
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
        };
    }

    private mapAssessmentRow(row: ResolutionRiskAssessmentRow): ResolutionRiskAssessment {
        return {
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
            computedAt: new Date(row.computed_at)
        };
    }
}
