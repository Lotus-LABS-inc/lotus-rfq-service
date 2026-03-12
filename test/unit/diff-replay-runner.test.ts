import { describe, expect, it, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import { DiffReplayRunner } from "../../src/core/replay/diff-replay-runner.js";
import { ResolutionPairComparator } from "../../src/core/rfq-engine/resolution-pair-comparator.js";
import { ResolutionRiskScoringEngine } from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import { CostModel } from "../../src/core/sor/cost-model.js";
import { Splitter } from "../../src/core/sor/splitter.js";
import { replayClearingPhase2B } from "../../src/core/replay/evaluators/clearing-phase2b-replay-evaluator.js";
import type { ReplayDecisionType } from "../../src/core/replay/replay.types.js";

const makeQueryResult = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
});

const makeEnvelopeRow = (
    decisionType: ReplayDecisionType,
    inputSnapshot: Record<string, unknown>,
    decisionTrace: Record<string, unknown>,
    outputSnapshot: Record<string, unknown>
) => ({
    id: "envelope-1",
    decision_type: decisionType,
    entity_id: "entity-1",
    correlation_id: "corr-1",
    config_version: "cfg-v1",
    engine_version: "eng-v1",
    feature_flags: {},
    input_snapshot: inputSnapshot,
    decision_trace: decisionTrace,
    output_snapshot: outputSnapshot,
    created_at: new Date("2026-03-11T12:00:00.000Z")
});

type RunnerOverrides = Partial<{
    configRegistry: ConstructorParameters<typeof DiffReplayRunner>[0]["configRegistry"];
    engineRegistry: ConstructorParameters<typeof DiffReplayRunner>[0]["engineRegistry"];
}>;

const makeRunner = (
    row: ReturnType<typeof makeEnvelopeRow>,
    overrides?: RunnerOverrides
) =>
    new DiffReplayRunner({
        pool: {
            query: vi.fn(async () => makeQueryResult([row]))
        } as unknown as Pool,
        resolutionPairComparator: new ResolutionPairComparator(),
        costModel: new CostModel(),
        splitter: new Splitter(),
        overlapGraphBuilder: {
            build: vi.fn((vectors) => ({
                nodes: vectors.map((vector: any) => ({
                    entityId: vector.entityId,
                    userId: vector.userId,
                    compatibilityBucket: vector.compatibilityBucket,
                    vector: vector.vector,
                    legCount: vector.legCount,
                    grossAbsSize: vector.grossAbsSize,
                    ...(vector.resolutionProfileId !== undefined ? { resolutionProfileId: vector.resolutionProfileId } : {})
                })),
                edges: []
            }))
        },
        candidateGroupEnumerator: {
            enumerate: vi.fn((_graph, _config) => [{
                participantIds: ["entity-a", "entity-b"],
                uniqueLegs: ["m1:o1"],
                estimatedCompressionScore: "1",
                residualAfterNetting: [],
                exactnessScore: "1"
            }])
        },
        clearingCompressionScorer: {
            score: vi.fn(() => ({
                compressionScore: "1",
                preNetAbsExposure: "2",
                postNetAbsResidual: "0",
                residualVectorByParticipant: {},
                rankingPenalty: "0",
                finalScore: "1",
                tieBreak: {
                    smallestResidual: "0",
                    oldestParticipantAt: "2026-03-11T00:00:00.000Z",
                    participantCount: 2
                }
            }))
        },
        ...(overrides?.configRegistry ? { configRegistry: overrides.configRegistry } : {}),
        ...(overrides?.engineRegistry ? { engineRegistry: overrides.engineRegistry } : {})
    });

const assessmentInputSnapshot = {
    canonicalEventId: "event-1",
    orderedProfileIds: ["profile-a", "profile-b"],
    profiles: [
        {
            id: "profile-a",
            venue: "venue-a",
            venueMarketId: "mkt-a",
            canonicalEventId: "event-1",
            oracleType: "manual",
            oracleName: "oracle-a",
            resolutionAuthorityType: "committee",
            primaryResolutionText: "Will event happen",
            supplementalRulesText: "same rules",
            disputeWindowHours: "24",
            settlementLagHours: "12",
            marketType: "binary",
            outcomeSchema: { yes: 1, no: 0 },
            hasAmbiguousTimeBoundary: false,
            hasAmbiguousJurisdictionBoundary: false,
            hasAmbiguousSourceReference: false,
            historicalDivergenceRate: "0.001",
            metadata: {},
            createdAt: "2026-03-11T00:00:00.000Z",
            updatedAt: "2026-03-11T00:00:00.000Z"
        },
        {
            id: "profile-b",
            venue: "venue-b",
            venueMarketId: "mkt-b",
            canonicalEventId: "event-1",
            oracleType: "manual",
            oracleName: "oracle-b",
            resolutionAuthorityType: "committee",
            primaryResolutionText: "Will event happen",
            supplementalRulesText: "same rules",
            disputeWindowHours: "24",
            settlementLagHours: "12",
            marketType: "binary",
            outcomeSchema: { yes: 1, no: 0 },
            hasAmbiguousTimeBoundary: false,
            hasAmbiguousJurisdictionBoundary: false,
            hasAmbiguousSourceReference: false,
            historicalDivergenceRate: "0.001",
            metadata: {},
            createdAt: "2026-03-11T00:00:00.000Z",
            updatedAt: "2026-03-11T00:00:00.000Z"
        }
    ],
    scoringVersion: "resolution-risk-v1"
};

const defaultAssessmentOutput = {
    assessment: new ResolutionRiskScoringEngine().score({
        canonicalEventId: "event-1",
        marketAProfileId: "profile-a",
        marketBProfileId: "profile-b",
        factorComparison: new ResolutionPairComparator().compare(
            assessmentInputSnapshot.profiles[0] as any,
            assessmentInputSnapshot.profiles[1] as any
        ),
        version: "resolution-risk-v1"
    })
};

describe("DiffReplayRunner", () => {
    it("returns MATCH when the same effective versions are replayed", async () => {
        const runner = makeRunner(
            makeEnvelopeRow("RESOLUTION_RISK_ASSESSMENT", assessmentInputSnapshot, {}, defaultAssessmentOutput)
        );

        const result = await runner.run("envelope-1", { configVersion: "cfg-v1" });
        expect(result.status).toBe("MATCH");
    });

    it("returns DIFF for changed scoring weight", async () => {
        const runner = makeRunner(
            makeEnvelopeRow("RESOLUTION_RISK_ASSESSMENT", assessmentInputSnapshot, {}, defaultAssessmentOutput),
            {
                configRegistry: {
                    RESOLUTION_RISK_ASSESSMENT: {
                        "cfg-v2": {
                            config: {
                                weights: {
                                    oracleMismatch: "0.9",
                                    ruleMismatch: "0.02",
                                    wordingAmbiguity: "0.02",
                                    disputeWindowMismatch: "0.02",
                                    settlementLagMismatch: "0.01",
                                    structuralMismatch: "0.01",
                                    historicalDivergence: "0.02"
                                }
                            }
                        }
                    }
                }
            }
        );

        const result = await runner.run("envelope-1", { configVersion: "cfg-v2" });
        expect(result.status).toBe("DIFF");
        expect(result.diffSummary?.changedEquivalenceClass).not.toBeNull();
    });

    it("returns DIFF for changed resolution-risk thresholds", async () => {
        const runner = makeRunner(
            makeEnvelopeRow("RESOLUTION_RISK_ASSESSMENT", assessmentInputSnapshot, {}, defaultAssessmentOutput),
            {
                configRegistry: {
                    RESOLUTION_RISK_ASSESSMENT: {
                        "cfg-thresholds": {
                            config: {
                                thresholds: {
                                    safeEquivalentMaxRisk: "0.05",
                                    cautionMaxRisk: "0.10",
                                    highRiskMaxRisk: "0.20",
                                    doNotPoolMinRisk: "0.20",
                                    safeEquivalentMinConfidence: "0.70",
                                    lowConfidenceThreshold: "0.50"
                                }
                            }
                        }
                    }
                }
            }
        );

        const result = await runner.run("envelope-1", { configVersion: "cfg-thresholds" });
        expect(result.status).toBe("DIFF");
        expect(result.diffSummary?.changedEquivalenceClass).not.toBeNull();
    });

    it("returns DIFF for changed tie-break order", async () => {
        const inputSnapshot = {
            bucketId: "bucket-1",
            plannerConfig: { maxParticipants: 4, maxUniqueLegs: 6, stpMode: "CANCEL_NEWEST" },
            candidateSnapshots: [
                { entityId: "entity-a", userId: "user-a", compatibilityBucket: "bucket-1", vector: { "m1:o1": "1" }, legCount: 1, grossAbsSize: "1", registeredAt: "2026-03-11T00:00:00.000Z" },
                { entityId: "entity-b", userId: "user-b", compatibilityBucket: "bucket-1", vector: { "m1:o1": "-1" }, legCount: 1, grossAbsSize: "1", registeredAt: "2026-03-11T00:00:00.000Z" }
            ]
        };
        const defaultReplay = replayClearingPhase2B(
            inputSnapshot,
            { build: (vectors) => ({ nodes: vectors as any, edges: [] }) },
            { enumerate: () => [{
                participantIds: ["entity-a", "entity-b"],
                uniqueLegs: ["m1:o1"],
                estimatedCompressionScore: "1",
                residualAfterNetting: [],
                exactnessScore: "1"
            }] },
            { score: () => ({
                compressionScore: "1",
                preNetAbsExposure: "2",
                postNetAbsResidual: "0",
                residualVectorByParticipant: {},
                rankingPenalty: "0",
                finalScore: "1",
                tieBreak: {
                    smallestResidual: "0",
                    oldestParticipantAt: "2026-03-11T00:00:00.000Z",
                    participantCount: 2
                }
            }) }
        );

        const runner = makeRunner(
            makeEnvelopeRow("CLEARING_PHASE2B", inputSnapshot, {}, defaultReplay),
            {
                engineRegistry: {
                    CLEARING_PHASE2B: {
                        "eng-v2": {
                        evaluate: async () => ({
                            selectedPlan: {
                                ...(defaultReplay.selectedPlan as Record<string, unknown>),
                                participantLockOrder: ["entity-b", "entity-a"]
                            }
                        })
                    }
                }
            }
            }
        );

        const result = await runner.run("envelope-1", { engineVersion: "eng-v2" });
        expect(result.status).toBe("DIFF");
        expect(result.diffSummary?.changedRanking.length).toBeGreaterThan(0);
    });

    it("fails closed on unsupported version", async () => {
        const runner = makeRunner(
            makeEnvelopeRow("RESOLUTION_RISK_ASSESSMENT", assessmentInputSnapshot, {}, defaultAssessmentOutput)
        );
        const result = await runner.run("envelope-1", { configVersion: "cfg-missing" });
        expect(result.status).toBe("ERROR");
        expect(result.diffSummary?.reason).toBe("unsupported_replay_version");
    });

    it("fails closed on malformed envelope", async () => {
        const runner = makeRunner(makeEnvelopeRow("RFQ_GROUPING", { orderedCandidateProfiles: "bad" as unknown as never[], orderedAssessments: [] }, {}, { grouping: {} }));
        const result = await runner.run("envelope-1", { engineVersion: "eng-v1" });
        expect(result.status).toBe("ERROR");
    });

    it("fails closed when no override is supplied", async () => {
        const runner = makeRunner(
            makeEnvelopeRow("RESOLUTION_RISK_ASSESSMENT", assessmentInputSnapshot, {}, defaultAssessmentOutput)
        );
        const result = await runner.run("envelope-1", {});
        expect(result.status).toBe("ERROR");
        expect(result.diffSummary?.reason).toBe("invalid_diff_replay_request");
    });
});
