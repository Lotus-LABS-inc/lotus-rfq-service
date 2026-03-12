import type { Pool, QueryResult } from "pg";

import type { IOverlapGraphBuilder } from "../combo-engine/overlap-graph-builder.js";
import type { ICandidateGroupEnumerator } from "../combo-engine/candidate-group-enumerator.js";
import type { IClearingCompressionScorer } from "../combo-engine/clearing-compression-scorer.js";
import type { IResolutionPairComparator } from "../rfq-engine/resolution-pair-comparator.js";
import type { IResolutionRiskScoringEngine } from "../rfq-engine/resolution-risk-scoring-engine.js";
import type { ICostModel, ISplitter } from "../sor/types.js";
import type { ReplayDecisionType, ExactReplayDiffSummary, ExactReplayResult, ReplayEnvelope } from "./replay.types.js";
import { orderKeysDeterministically } from "./replay-envelope-writer.js";
import { replayResolutionRiskAssessment } from "./evaluators/resolution-risk-assessment-replay-evaluator.js";
import { replayRFQGrouping } from "./evaluators/rfq-grouping-replay-evaluator.js";
import { replaySORPlan } from "./evaluators/sor-plan-replay-evaluator.js";
import { replayInternalCross } from "./evaluators/internal-cross-replay-evaluator.js";
import { replayNettingPhase2A } from "./evaluators/netting-phase2a-replay-evaluator.js";
import { replayClearingPhase2B } from "./evaluators/clearing-phase2b-replay-evaluator.js";
import { asObject, ReplayEvaluationError } from "./evaluators/shared.js";

export type ExactReplayRunnerErrorCode =
    | "replay_envelope_not_found"
    | "unsupported_decision_type"
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

export class ExactReplayRunnerError extends Error {
    public readonly code: ExactReplayRunnerErrorCode;

    public constructor(code: ExactReplayRunnerErrorCode, message: string) {
        super(message);
        this.name = "ExactReplayRunnerError";
        this.code = code;
    }
}

export interface IExactReplayRunner {
    run(replayEnvelopeId: string): Promise<ExactReplayResult>;
}

export const normalizeForReplayComparison = (value: unknown): unknown => {
    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeForReplayComparison(entry));
    }

    if (value !== null && typeof value === "object") {
        const normalized = Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeForReplayComparison(entry)])
        );
        return orderKeysDeterministically(normalized);
    }

    return value;
};

const collectDiffs = (path: string, expected: unknown, actual: unknown, diffs: Array<{ path: string; expected: unknown; actual: unknown }>): void => {
    if (diffs.length >= 10) {
        return;
    }

    const normalizedExpected = normalizeForReplayComparison(expected);
    const normalizedActual = normalizeForReplayComparison(actual);

    if (JSON.stringify(normalizedExpected) === JSON.stringify(normalizedActual)) {
        return;
    }

    if (Array.isArray(normalizedExpected) && Array.isArray(normalizedActual)) {
        if (normalizedExpected.length !== normalizedActual.length) {
            diffs.push({ path, expected: normalizedExpected.length, actual: normalizedActual.length });
            return;
        }

        for (let index = 0; index < normalizedExpected.length; index += 1) {
            collectDiffs(`${path}[${index}]`, normalizedExpected[index], normalizedActual[index], diffs);
        }
        return;
    }

    if (
        normalizedExpected !== null &&
        normalizedActual !== null &&
        typeof normalizedExpected === "object" &&
        typeof normalizedActual === "object" &&
        !Array.isArray(normalizedExpected) &&
        !Array.isArray(normalizedActual)
    ) {
        const keys = new Set([
            ...Object.keys(normalizedExpected as Record<string, unknown>),
            ...Object.keys(normalizedActual as Record<string, unknown>)
        ]);
        for (const key of [...keys].sort((left, right) => left.localeCompare(right))) {
            collectDiffs(path.length === 0 ? key : `${path}.${key}`,
                (normalizedExpected as Record<string, unknown>)[key],
                (normalizedActual as Record<string, unknown>)[key],
                diffs);
        }
        return;
    }

    diffs.push({ path, expected: normalizedExpected, actual: normalizedActual });
};

export const buildDiffSummary = (expected: unknown, actual: unknown, reason?: string): ExactReplayDiffSummary => {
    const diffs: Array<{ path: string; expected: unknown; actual: unknown }> = [];
    collectDiffs("", expected, actual, diffs);
    return {
        ...(reason ? { reason } : {}),
        diffCount: diffs.length,
        diffs
    };
};

export const compareReplaySnapshots = (expected: unknown, actual: unknown): boolean =>
    JSON.stringify(normalizeForReplayComparison(expected)) === JSON.stringify(normalizeForReplayComparison(actual));

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

interface ExactReplayRunnerDeps {
    pool: Pool;
    resolutionPairComparator: IResolutionPairComparator;
    resolutionRiskScoringEngine: IResolutionRiskScoringEngine;
    costModel: ICostModel;
    splitter: ISplitter;
    overlapGraphBuilder: IOverlapGraphBuilder;
    candidateGroupEnumerator: ICandidateGroupEnumerator;
    clearingCompressionScorer: IClearingCompressionScorer;
}

export class ExactReplayRunner implements IExactReplayRunner {
    private readonly pool: Pool;
    private readonly resolutionPairComparator: IResolutionPairComparator;
    private readonly resolutionRiskScoringEngine: IResolutionRiskScoringEngine;
    private readonly costModel: ICostModel;
    private readonly splitter: ISplitter;
    private readonly overlapGraphBuilder: IOverlapGraphBuilder;
    private readonly candidateGroupEnumerator: ICandidateGroupEnumerator;
    private readonly clearingCompressionScorer: IClearingCompressionScorer;

    public constructor(deps: ExactReplayRunnerDeps) {
        this.pool = deps.pool;
        this.resolutionPairComparator = deps.resolutionPairComparator;
        this.resolutionRiskScoringEngine = deps.resolutionRiskScoringEngine;
        this.costModel = deps.costModel;
        this.splitter = deps.splitter;
        this.overlapGraphBuilder = deps.overlapGraphBuilder;
        this.candidateGroupEnumerator = deps.candidateGroupEnumerator;
        this.clearingCompressionScorer = deps.clearingCompressionScorer;
    }

    public async run(replayEnvelopeId: string): Promise<ExactReplayResult> {
        try {
            const envelope = await this.loadEnvelope(replayEnvelopeId);
            const replayOutput = await this.dispatchReplay(envelope);
            const expected = this.expectedComparableSnapshot(envelope);
            const actual = this.actualComparableSnapshot(envelope.decisionType, replayOutput);

            if (compareReplaySnapshots(expected, actual)) {
                return {
                    status: "MATCH",
                    diffSummary: null,
                    replayOutput
                };
            }

            return {
                status: "DIFF",
                diffSummary: buildDiffSummary(expected, actual),
                replayOutput
            };
        } catch (error) {
            if (error instanceof ExactReplayRunnerError) {
                return {
                    status: "ERROR",
                    diffSummary: buildDiffSummary({}, {}, error.code),
                    replayOutput: null
                };
            }

            if (error instanceof ReplayEvaluationError) {
                return {
                    status: "ERROR",
                    diffSummary: buildDiffSummary({}, {}, error.code),
                    replayOutput: null
                };
            }

            return {
                status: "ERROR",
                diffSummary: buildDiffSummary({}, {}, "replay_execution_failed"),
                replayOutput: null
            };
        }
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
            throw new ExactReplayRunnerError("replay_envelope_not_found", "Replay envelope not found.");
        }

        return mapRow(row);
    }

    private async dispatchReplay(envelope: ReplayEnvelope): Promise<Record<string, unknown>> {
        const inputSnapshot = asObject(envelope.inputSnapshot, "replayEnvelope.inputSnapshot");
        const decisionTrace = asObject(envelope.decisionTrace, "replayEnvelope.decisionTrace");

        switch (envelope.decisionType) {
            case "RESOLUTION_RISK_ASSESSMENT":
                return replayResolutionRiskAssessment(
                    inputSnapshot,
                    this.resolutionPairComparator,
                    this.resolutionRiskScoringEngine
                );
            case "RFQ_GROUPING":
                return replayRFQGrouping(inputSnapshot);
            case "SOR_PLAN": {
                const replayed = await replaySORPlan(inputSnapshot, this.costModel, this.splitter);
                return replayed;
            }
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
                throw new ExactReplayRunnerError("unsupported_decision_type", `Unsupported decision type: ${envelope.decisionType}`);
        }
    }

    private expectedComparableSnapshot(envelope: ReplayEnvelope): Record<string, unknown> {
        switch (envelope.decisionType) {
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
}
