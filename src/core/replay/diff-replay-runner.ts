import type { Pool, QueryResult } from "pg";

import type { IOverlapGraphBuilder } from "../combo-engine/overlap-graph-builder.js";
import type { ICandidateGroupEnumerator } from "../combo-engine/candidate-group-enumerator.js";
import type { IClearingCompressionScorer } from "../combo-engine/clearing-compression-scorer.js";
import type { IResolutionPairComparator } from "../rfq-engine/resolution-pair-comparator.js";
import {
    DEFAULT_RESOLUTION_RISK_SCORING_CONFIG,
    ResolutionRiskScoringEngine,
    type ResolutionRiskScoringConfig
} from "../rfq-engine/resolution-risk-scoring-engine.js";
import type { ICostModel, ISplitter } from "../sor/types.js";
import {
    buildDiffSummary,
    compareReplaySnapshots,
    normalizeForReplayComparison
} from "./exact-replay-runner.js";
import { replayClearingPhase2B } from "./evaluators/clearing-phase2b-replay-evaluator.js";
import { replayInternalCross } from "./evaluators/internal-cross-replay-evaluator.js";
import { replayNettingPhase2A } from "./evaluators/netting-phase2a-replay-evaluator.js";
import { replayResolutionRiskAssessment } from "./evaluators/resolution-risk-assessment-replay-evaluator.js";
import { replayRFQGrouping } from "./evaluators/rfq-grouping-replay-evaluator.js";
import { replaySORPlan } from "./evaluators/sor-plan-replay-evaluator.js";
import { asObject, ReplayEvaluationError } from "./evaluators/shared.js";
import type {
    DiffReplayResult,
    DiffReplaySummary,
    ReplayConfigRegistry,
    ReplayDecisionType,
    ReplayEngineRegistry,
    ReplayEnvelope,
    ReplayVersionedEvaluatorBundle
} from "./replay.types.js";

type DiffReplayRunnerErrorCode =
    | "replay_envelope_not_found"
    | "invalid_diff_replay_request"
    | "unsupported_decision_type"
    | "unsupported_replay_version"
    | "invalid_replay_envelope"
    | "replay_execution_failed"
    | "replay_comparison_failed";

interface ReplayEnvelopeRow {
    id: string;
    decision_type: string;
    entity_id: string;
    correlation_id: string;
    config_version: string;
    engine_version: string;
    feature_flags: Record<string, unknown>;
    input_snapshot: Record<string, unknown>;
    decision_trace: Record<string, unknown>;
    output_snapshot: Record<string, unknown>;
    created_at: Date;
}

export class DiffReplayRunnerError extends Error {
    public readonly code: DiffReplayRunnerErrorCode;

    public constructor(code: DiffReplayRunnerErrorCode, message: string) {
        super(message);
        this.name = "DiffReplayRunnerError";
        this.code = code;
    }
}

export interface IDiffReplayRunner {
    run(
        replayEnvelopeId: string,
        options: { configVersion?: string; engineVersion?: string }
    ): Promise<DiffReplayResult>;
}

interface DiffReplayRunnerDeps {
    pool: Pool;
    resolutionPairComparator: IResolutionPairComparator;
    costModel: ICostModel;
    splitter: ISplitter;
    overlapGraphBuilder: IOverlapGraphBuilder;
    candidateGroupEnumerator: ICandidateGroupEnumerator;
    clearingCompressionScorer: IClearingCompressionScorer;
    configRegistry?: ReplayConfigRegistry;
    engineRegistry?: ReplayEngineRegistry;
}

const mapRow = (row: ReplayEnvelopeRow): ReplayEnvelope => ({
    id: row.id,
    decisionType: row.decision_type as ReplayDecisionType,
    entityId: row.entity_id,
    correlationId: row.correlation_id,
    configVersion: row.config_version,
    engineVersion: row.engine_version,
    featureFlags: row.feature_flags,
    inputSnapshot: row.input_snapshot,
    decisionTrace: row.decision_trace,
    outputSnapshot: row.output_snapshot,
    createdAt: new Date(row.created_at)
});

export class DiffReplayRunner implements IDiffReplayRunner {
    private readonly pool: Pool;
    private readonly resolutionPairComparator: IResolutionPairComparator;
    private readonly costModel: ICostModel;
    private readonly splitter: ISplitter;
    private readonly overlapGraphBuilder: IOverlapGraphBuilder;
    private readonly candidateGroupEnumerator: ICandidateGroupEnumerator;
    private readonly clearingCompressionScorer: IClearingCompressionScorer;
    private readonly configRegistry: ReplayConfigRegistry;
    private readonly engineRegistry: ReplayEngineRegistry;

    public constructor(deps: DiffReplayRunnerDeps) {
        this.pool = deps.pool;
        this.resolutionPairComparator = deps.resolutionPairComparator;
        this.costModel = deps.costModel;
        this.splitter = deps.splitter;
        this.overlapGraphBuilder = deps.overlapGraphBuilder;
        this.candidateGroupEnumerator = deps.candidateGroupEnumerator;
        this.clearingCompressionScorer = deps.clearingCompressionScorer;
        this.configRegistry = deps.configRegistry ?? {};
        this.engineRegistry = deps.engineRegistry ?? {};
    }

    public async run(
        replayEnvelopeId: string,
        options: { configVersion?: string; engineVersion?: string }
    ): Promise<DiffReplayResult> {
        if (!options.configVersion && !options.engineVersion) {
            return this.errorResult("invalid_diff_replay_request", null, null, null, null, null, null);
        }

        try {
            const envelope = await this.loadEnvelope(replayEnvelopeId);
            const replayConfigVersion = options.configVersion ?? envelope.configVersion;
            const replayEngineVersion = options.engineVersion ?? envelope.engineVersion;
            const replayOutput = await this.dispatchReplay(envelope, replayConfigVersion, replayEngineVersion);
            const originalComparable = this.expectedComparableSnapshot(envelope);
            const replayComparable = this.actualComparableSnapshot(envelope.decisionType, replayOutput);

            if (compareReplaySnapshots(originalComparable, replayComparable)) {
                return {
                    status: "MATCH",
                    originalOutput: envelope.outputSnapshot,
                    replayOutput,
                    diffSummary: null,
                    originalConfigVersion: envelope.configVersion,
                    originalEngineVersion: envelope.engineVersion,
                    replayConfigVersion,
                    replayEngineVersion
                };
            }

            return {
                status: "DIFF",
                originalOutput: envelope.outputSnapshot,
                replayOutput,
                diffSummary: this.classifyDiff(envelope.decisionType, originalComparable, replayComparable),
                originalConfigVersion: envelope.configVersion,
                originalEngineVersion: envelope.engineVersion,
                replayConfigVersion,
                replayEngineVersion
            };
        } catch (error) {
            if (error instanceof DiffReplayRunnerError) {
                return this.errorResult(error.code, null, null, null, null, null, null);
            }
            if (error instanceof ReplayEvaluationError) {
                return this.errorResult(error.code === "invalid_replay_envelope" ? "invalid_replay_envelope" : "replay_execution_failed", null, null, null, null, null, null);
            }
            return this.errorResult("replay_execution_failed", null, null, null, null, null, null);
        }
    }

    private errorResult(
        code: DiffReplayRunnerErrorCode,
        originalOutput: Record<string, unknown> | null,
        replayOutput: Record<string, unknown> | null,
        originalConfigVersion: string | null,
        originalEngineVersion: string | null,
        replayConfigVersion: string | null,
        replayEngineVersion: string | null
    ): DiffReplayResult {
        return {
            status: "ERROR",
            originalOutput,
            replayOutput,
            diffSummary: {
                decisionType: "RFQ_GROUPING",
                diffCount: 0,
                changedRouteChoices: [],
                changedRanking: [],
                changedClearingSelection: [],
                changedPenaltiesOrGates: [],
                changedEquivalenceClass: null,
                fieldDiffs: [],
                reason: code
            },
            originalConfigVersion,
            originalEngineVersion,
            replayConfigVersion,
            replayEngineVersion
        };
    }

    private async loadEnvelope(replayEnvelopeId: string): Promise<ReplayEnvelope> {
        const result: QueryResult<ReplayEnvelopeRow> = await this.pool.query(
            `SELECT
                id,
                decision_type,
                entity_id,
                correlation_id,
                config_version,
                engine_version,
                feature_flags,
                input_snapshot,
                decision_trace,
                output_snapshot,
                created_at
             FROM replay_envelopes
             WHERE id = $1`,
            [replayEnvelopeId]
        );
        const row = result.rows[0];
        if (!row) {
            throw new DiffReplayRunnerError("replay_envelope_not_found", "Replay envelope not found.");
        }
        return mapRow(row);
    }

    private async dispatchReplay(
        envelope: ReplayEnvelope,
        replayConfigVersion: string,
        replayEngineVersion: string
    ): Promise<Record<string, unknown>> {
        const inputSnapshot = asObject(envelope.inputSnapshot, "replayEnvelope.inputSnapshot");
        const decisionTrace = asObject(envelope.decisionTrace, "replayEnvelope.decisionTrace");
        const configBundle = this.resolveBundle(this.configRegistry, envelope.decisionType, envelope.configVersion, replayConfigVersion, "config");
        const engineBundle = this.resolveBundle(this.engineRegistry, envelope.decisionType, envelope.engineVersion, replayEngineVersion, "engine");
        const bundle = { ...configBundle, ...engineBundle };

        if (bundle.evaluate) {
            return await bundle.evaluate(inputSnapshot, decisionTrace);
        }

        switch (envelope.decisionType) {
            case "RESOLUTION_RISK_ASSESSMENT": {
                const scoringConfig = this.readScoringConfig(bundle.config);
                return replayResolutionRiskAssessment(
                    inputSnapshot,
                    this.resolutionPairComparator,
                    new ResolutionRiskScoringEngine(scoringConfig)
                );
            }
            case "RFQ_GROUPING":
                return replayRFQGrouping(inputSnapshot);
            case "SOR_PLAN":
                return replaySORPlan(inputSnapshot, this.costModel, this.splitter);
            case "INTERNAL_CROSS":
                return replayInternalCross(inputSnapshot, decisionTrace);
            case "NETTING_PHASE2A":
                return replayNettingPhase2A(inputSnapshot, decisionTrace);
            case "CLEARING_PHASE2B":
                return replayClearingPhase2B(
                    inputSnapshot,
                    this.overlapGraphBuilder,
                    this.candidateGroupEnumerator,
                    this.clearingCompressionScorer
                );
            default:
                throw new DiffReplayRunnerError("unsupported_decision_type", `Unsupported decision type: ${envelope.decisionType}`);
        }
    }

    private resolveBundle(
        registry: ReplayConfigRegistry | ReplayEngineRegistry,
        decisionType: ReplayDecisionType,
        originalVersion: string,
        requestedVersion: string,
        kind: "config" | "engine"
    ): ReplayVersionedEvaluatorBundle {
        if (requestedVersion === originalVersion) {
            return {};
        }
        const bundle = registry[decisionType]?.[requestedVersion];
        if (!bundle) {
            throw new DiffReplayRunnerError("unsupported_replay_version", `Unsupported ${kind} replay version for ${decisionType}: ${requestedVersion}`);
        }
        return bundle;
    }

    private readScoringConfig(value: Record<string, unknown> | undefined): Partial<ResolutionRiskScoringConfig> {
        if (!value) {
            return DEFAULT_RESOLUTION_RISK_SCORING_CONFIG;
        }
        return value as unknown as Partial<ResolutionRiskScoringConfig>;
    }

    private expectedComparableSnapshot(envelope: ReplayEnvelope): Record<string, unknown> {
        switch (envelope.decisionType) {
            case "RESOLUTION_RISK_ASSESSMENT":
                return {
                    assessment: this.projectResolutionRiskAssessment(asObject(envelope.outputSnapshot, "outputSnapshot").assessment)
                };
            case "SOR_PLAN":
                return {
                    decisionTrace: {
                        scoredCandidates: asObject(envelope.decisionTrace, "decisionTrace").scoredCandidates ?? [],
                        allocations: asObject(envelope.decisionTrace, "decisionTrace").allocations ?? []
                    },
                    buildResult: this.projectSorBuildResult(envelope.outputSnapshot)
                };
            case "NETTING_PHASE2A":
                return {
                    result: this.projectNettingResult(envelope.outputSnapshot)
                };
            case "CLEARING_PHASE2B":
                return {
                    selectedPlan: asObject(envelope.outputSnapshot, "outputSnapshot").selectedPlan ?? null
                };
            default:
                return envelope.outputSnapshot;
        }
    }

    private actualComparableSnapshot(decisionType: ReplayDecisionType, replayOutput: Record<string, unknown>): Record<string, unknown> {
        switch (decisionType) {
            case "RESOLUTION_RISK_ASSESSMENT":
                return {
                    assessment: this.projectResolutionRiskAssessment(asObject(replayOutput, "replayOutput").assessment)
                };
            case "SOR_PLAN":
                return {
                    decisionTrace: asObject(replayOutput.decisionTrace, "replayOutput.decisionTrace"),
                    buildResult: this.projectSorBuildResult(replayOutput.buildResult)
                };
            case "NETTING_PHASE2A":
                return {
                    result: this.projectNettingResult(replayOutput)
                };
            case "CLEARING_PHASE2B":
                return {
                    selectedPlan: asObject(replayOutput, "replayOutput").selectedPlan ?? null
                };
            default:
                return replayOutput;
        }
    }

    private projectResolutionRiskAssessment(value: unknown): Record<string, unknown> {
        const assessment = asObject(value, "resolutionRisk.assessment");
        return {
            canonicalEventId: assessment.canonicalEventId ?? null,
            canonicalMarketId: assessment.canonicalMarketId ?? null,
            marketAProfileId: assessment.marketAProfileId ?? null,
            marketBProfileId: assessment.marketBProfileId ?? null,
            riskScore: assessment.riskScore ?? null,
            confidenceScore: assessment.confidenceScore ?? null,
            equivalenceClass: assessment.equivalenceClass ?? null,
            factorBreakdown: assessment.factorBreakdown ?? {},
            reasons: assessment.reasons ?? [],
            version: assessment.version ?? null,
            liquidityCost: assessment.liquidityCost ?? null,
            maxSettlementDelayHours: assessment.maxSettlementDelayHours ?? null
        };
    }

    private projectSorBuildResult(value: unknown): Record<string, unknown> {
        const outer = asObject(value, "sor.buildResult");
        const raw = outer.buildResult !== undefined ? asObject(outer.buildResult, "sor.buildResult.buildResult") : outer;
        if (raw.kind === "plan_created") {
            return {
                kind: raw.kind,
                crossingFilledSize: raw.crossingFilledSize ?? null,
                remainingSize: raw.remainingSize ?? null
            };
        }
        if (raw.kind === "internal_filled") {
            return {
                kind: raw.kind,
                filledSize: raw.filledSize ?? null
            };
        }
        return raw;
    }

    private projectNettingResult(value: unknown): Record<string, unknown> {
        const outer = asObject(value, "netting.result");
        const raw = outer.result !== undefined ? asObject(outer.result, "netting.result.result") : outer;
        const residualLegs = Array.isArray(raw.residualLegs) ? raw.residualLegs : [];

        return {
            nettedSize: raw.nettedSize ?? "0",
            residualLegs,
            residualRemaining: raw.residualRemaining ?? residualLegs.length > 0
        };
    }

    private classifyDiff(
        decisionType: ReplayDecisionType,
        originalOutput: Record<string, unknown>,
        replayOutput: Record<string, unknown>
    ): DiffReplaySummary {
        const raw = buildDiffSummary(originalOutput, replayOutput);
        const fieldDiffs = raw.diffs.map((entry) => ({
            path: entry.path,
            original: entry.expected,
            replayed: entry.actual
        }));

        const changedRouteChoices: Record<string, unknown>[] = [];
        const changedRanking: Record<string, unknown>[] = [];
        const changedClearingSelection: Record<string, unknown>[] = [];
        const changedPenaltiesOrGates: Record<string, unknown>[] = [];

        const summary: DiffReplaySummary = {
            decisionType,
            diffCount: raw.diffCount,
            changedRouteChoices,
            changedRanking,
            changedClearingSelection,
            changedPenaltiesOrGates,
            changedEquivalenceClass: null,
            fieldDiffs
        };

        switch (decisionType) {
            case "RESOLUTION_RISK_ASSESSMENT": {
                const originalAssessment = asObject(asObject(originalOutput, "originalOutput").assessment, "originalOutput.assessment");
                const replayAssessment = asObject(asObject(replayOutput, "replayOutput").assessment, "replayOutput.assessment");
                if (originalAssessment.equivalenceClass !== replayAssessment.equivalenceClass) {
                    summary.changedEquivalenceClass = {
                        from: originalAssessment.equivalenceClass,
                        to: replayAssessment.equivalenceClass
                    };
                }
                break;
            }
            case "RFQ_GROUPING": {
                const originalGrouping = asObject(asObject(originalOutput, "originalOutput").grouping, "originalOutput.grouping");
                const replayGrouping = asObject(asObject(replayOutput, "replayOutput").grouping, "replayOutput.grouping");
                if (!compareReplaySnapshots(originalGrouping.safePools ?? [], replayGrouping.safePools ?? [])) {
                    changedRouteChoices.push({ field: "safePools", from: originalGrouping.safePools ?? [], to: replayGrouping.safePools ?? [] });
                }
                if (!compareReplaySnapshots(originalGrouping.cautionLanes ?? [], replayGrouping.cautionLanes ?? [])) {
                    changedRouteChoices.push({ field: "cautionLanes", from: originalGrouping.cautionLanes ?? [], to: replayGrouping.cautionLanes ?? [] });
                }
                if (!compareReplaySnapshots(originalGrouping.blockedProfiles ?? [], replayGrouping.blockedProfiles ?? [])) {
                    changedPenaltiesOrGates.push({ field: "blockedProfiles", from: originalGrouping.blockedProfiles ?? [], to: replayGrouping.blockedProfiles ?? [] });
                }
                break;
            }
            case "SOR_PLAN": {
                const originalTrace = asObject(asObject(originalOutput, "originalOutput").decisionTrace, "originalOutput.decisionTrace");
                const replayTrace = asObject(asObject(replayOutput, "replayOutput").decisionTrace, "replayOutput.decisionTrace");
                const originalScores = (originalTrace.scoredCandidates ?? []) as unknown[];
                const replayScores = (replayTrace.scoredCandidates ?? []) as unknown[];
                const originalOrder = originalScores.map((entry) => asObject(entry, "originalTrace.scoredCandidates[]").candidateId);
                const replayOrder = replayScores.map((entry) => asObject(entry, "replayTrace.scoredCandidates[]").candidateId);
                if (!compareReplaySnapshots(originalOrder, replayOrder)) {
                    changedRanking.push({ from: originalOrder, to: replayOrder });
                }
                const originalAllocations = originalTrace.allocations ?? [];
                const replayAllocations = replayTrace.allocations ?? [];
                if (!compareReplaySnapshots(originalAllocations, replayAllocations)) {
                    changedRouteChoices.push({ field: "allocations", from: originalAllocations, to: replayAllocations });
                }
                const originalPenalty = originalScores.map((entry) => asObject(entry, "originalTrace.scoredCandidates[]").breakdown).map((entry) => asObject(entry, "breakdown").resolutionRiskPenalty ?? 0);
                const replayPenalty = replayScores.map((entry) => asObject(entry, "replayTrace.scoredCandidates[]").breakdown).map((entry) => asObject(entry, "breakdown").resolutionRiskPenalty ?? 0);
                if (!compareReplaySnapshots(originalPenalty, replayPenalty)) {
                    changedPenaltiesOrGates.push({ field: "resolutionRiskPenalty", from: originalPenalty, to: replayPenalty });
                }
                break;
            }
            case "CLEARING_PHASE2B": {
                const originalPlan = asObject(originalOutput, "originalOutput").selectedPlan ? asObject(asObject(originalOutput, "originalOutput").selectedPlan, "originalOutput.selectedPlan") : null;
                const replayPlan = asObject(replayOutput, "replayOutput").selectedPlan ? asObject(asObject(replayOutput, "replayOutput").selectedPlan, "replayOutput.selectedPlan") : null;
                if (!compareReplaySnapshots(originalPlan?.selectedGroup ?? null, replayPlan?.selectedGroup ?? null)) {
                    changedClearingSelection.push({
                        from: originalPlan?.selectedGroup ?? null,
                        to: replayPlan?.selectedGroup ?? null
                    });
                }
                if (!compareReplaySnapshots(originalPlan?.participantLockOrder ?? [], replayPlan?.participantLockOrder ?? [])) {
                    changedRanking.push({
                        field: "participantLockOrder",
                        from: originalPlan?.participantLockOrder ?? [],
                        to: replayPlan?.participantLockOrder ?? []
                    });
                }
                break;
            }
            default:
                break;
        }

        return summary;
    }
}
