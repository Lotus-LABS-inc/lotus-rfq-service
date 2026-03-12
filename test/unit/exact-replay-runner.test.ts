import { describe, expect, it, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import { ExactReplayRunner, compareReplaySnapshots, normalizeForReplayComparison } from "../../src/core/replay/exact-replay-runner.js";
import { ResolutionPairComparator } from "../../src/core/rfq-engine/resolution-pair-comparator.js";
import { ResolutionRiskScoringEngine } from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import { CostModel } from "../../src/core/sor/cost-model.js";
import { Splitter } from "../../src/core/sor/splitter.js";
import { replayRFQGrouping } from "../../src/core/replay/evaluators/rfq-grouping-replay-evaluator.js";
import { replaySORPlan } from "../../src/core/replay/evaluators/sor-plan-replay-evaluator.js";
import { replayInternalCross } from "../../src/core/replay/evaluators/internal-cross-replay-evaluator.js";
import { replayNettingPhase2A } from "../../src/core/replay/evaluators/netting-phase2a-replay-evaluator.js";
import type { ReplayDecisionType } from "../../src/core/replay/replay.types.js";

const makeQueryResult = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
});

const makeEnvelopeRow = (decisionType: ReplayDecisionType, inputSnapshot: Record<string, unknown>, decisionTrace: Record<string, unknown>, outputSnapshot: Record<string, unknown>) => ({
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

const makeRunner = (row: ReturnType<typeof makeEnvelopeRow>) =>
    new ExactReplayRunner({
        pool: {
            query: vi.fn(async () => makeQueryResult([row]))
        } as unknown as Pool,
        resolutionPairComparator: new ResolutionPairComparator(),
        resolutionRiskScoringEngine: new ResolutionRiskScoringEngine(),
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
        }
    });

describe("ExactReplayRunner", () => {
    it("replays RESOLUTION_RISK_ASSESSMENT to MATCH", async () => {
        const inputSnapshot = {
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
                }
            ],
            scoringVersion: "resolution-risk-v1",
            scoringWeights: {}
        };
        const decisionTrace = {};
        const outputSnapshot = {
            assessment: new ResolutionRiskScoringEngine().score({
                canonicalEventId: "event-1",
                marketAProfileId: "profile-a",
                marketBProfileId: "profile-b",
                factorComparison: new ResolutionPairComparator().compare(inputSnapshot.profiles[0] as any, inputSnapshot.profiles[1] as any),
                version: "resolution-risk-v1"
            })
        };

        const result = await makeRunner(makeEnvelopeRow("RESOLUTION_RISK_ASSESSMENT", inputSnapshot, decisionTrace, outputSnapshot)).run("envelope-1");
        expect(result.status).toBe("MATCH");
    });

    it("replays RFQ_GROUPING to MATCH", async () => {
        const inputSnapshot = {
            canonicalEventId: "event-1",
            orderedCandidateProfiles: [
                { id: "profile-a", canonicalEventId: "event-1" },
                { id: "profile-b", canonicalEventId: "event-1" }
            ],
            orderedAssessments: [{
                id: "assessment-1",
                canonicalEventId: "event-1",
                marketAProfileId: "profile-a",
                marketBProfileId: "profile-b",
                riskScore: "0.1",
                confidenceScore: "0.9",
                equivalenceClass: "SAFE_EQUIVALENT",
                factorBreakdown: {},
                reasons: [],
                version: "v1",
                computedAt: "2026-03-11T00:00:00.000Z"
            }]
        };
        const outputSnapshot = replayRFQGrouping(inputSnapshot);
        const result = await makeRunner(makeEnvelopeRow("RFQ_GROUPING", inputSnapshot, {}, outputSnapshot)).run("envelope-1");
        expect(result.status).toBe("MATCH");
    });

    it("replays SOR_PLAN to MATCH on deterministic scoring and allocation", async () => {
        const inputSnapshot = {
            rfqId: "11111111-1111-4111-8111-111111111111",
            rfq: {
                rfqId: "11111111-1111-4111-8111-111111111111",
                idempotencyKey: "idem-1",
                canonicalMarketId: "market-1",
                takerId: "22222222-2222-4222-8222-222222222222",
                side: "buy",
                quantity: "10",
                stpMode: "CANCEL_NEWEST"
            },
            selectedQuote: {
                quoteId: "quote-1",
                price: 0.51,
                quantity: 10,
                feeBps: 0
            },
            policy: "BEST_EFFORT",
            routeCandidates: [
                {
                    id: "33333333-3333-4333-8333-333333333333",
                    leg_id: "44444444-4444-4444-8444-444444444444",
                    provider_type: "LP",
                    provider_id: "lp-a",
                    available_size: 10,
                    quoted_price: 0.51,
                    fees: {},
                    latency_ms: 10,
                    fill_prob: 0.9
                }
            ],
            resolutionRiskPairPolicies: [],
            buildResult: {
                kind: "plan_created",
                crossingFilledSize: "0",
                remainingSize: "10",
                plan: { id: "plan-1" }
            }
        };
        const sorReplay = await replaySORPlan(inputSnapshot, new CostModel(), new Splitter());
        const result = await makeRunner(makeEnvelopeRow("SOR_PLAN", inputSnapshot, sorReplay.decisionTrace as Record<string, unknown>, {
            buildResult: sorReplay.buildResult
        })).run("envelope-1");
        expect(result.status).toBe("MATCH");
    });

    it("replays INTERNAL_CROSS to MATCH from stored candidates", async () => {
        const inputSnapshot = {
            incomingOrder: { id: "order-1", size: "5" },
            orderedCandidates: [{ orderId: "maker-1" }, { orderId: "maker-2" }]
        };
        const decisionTrace = {
            makerIterationOrder: ["maker-1", "maker-2"],
            matchDecisions: [{ makerOrderId: "maker-1", matchedSize: "2" }]
        };
        const outputSnapshot = replayInternalCross(inputSnapshot, decisionTrace);
        const result = await makeRunner(makeEnvelopeRow("INTERNAL_CROSS", inputSnapshot, decisionTrace, outputSnapshot)).run("envelope-1");
        expect(result.status).toBe("MATCH");
    });

    it("replays NETTING_PHASE2A to MATCH from stored combo candidates", async () => {
        const inputSnapshot = {
            incomingCombo: {
                id: "combo-1",
                legs: [
                    { id: "leg-a", canonicalMarketId: "m1", canonicalOutcomeId: "o1", side: "buy", remainingSize: "5" }
                ]
            }
        };
        const decisionTrace = {
            matchedLegPairOrder: [{ incomingLegId: "leg-a", matchedSize: "2" }]
        };
        const outputSnapshot = replayNettingPhase2A(inputSnapshot, decisionTrace);
        const result = await makeRunner(makeEnvelopeRow("NETTING_PHASE2A", inputSnapshot, decisionTrace, outputSnapshot)).run("envelope-1");
        expect(result.status).toBe("MATCH");
    });

    it("replays CLEARING_PHASE2B to MATCH from stored planner inputs", async () => {
        const inputSnapshot = {
            bucketId: "bucket-1",
            plannerConfig: { maxParticipants: 4, maxUniqueLegs: 6, stpMode: "CANCEL_NEWEST" },
            candidateSnapshots: [
                { entityId: "entity-a", userId: "user-a", compatibilityBucket: "bucket-1", vector: { "m1:o1": "1" }, legCount: 1, grossAbsSize: "1", registeredAt: "2026-03-11T00:00:00.000Z" },
                { entityId: "entity-b", userId: "user-b", compatibilityBucket: "bucket-1", vector: { "m1:o1": "-1" }, legCount: 1, grossAbsSize: "1", registeredAt: "2026-03-11T00:00:00.000Z" }
            ]
        };
        const outputSnapshot = {
            selectedPlan: {
                compatibilityBucket: "bucket-1",
                selectedGroup: {
                    participantIds: ["entity-a", "entity-b"],
                    uniqueLegs: ["m1:o1"],
                    estimatedCompressionScore: "1",
                    residualAfterNetting: [],
                    exactnessScore: "1"
                },
                score: {
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
                },
                residuals: [],
                participantLockOrder: ["entity-a", "entity-b"]
            }
        };
        const result = await makeRunner(makeEnvelopeRow("CLEARING_PHASE2B", inputSnapshot, {}, outputSnapshot)).run("envelope-1");
        expect(result.status).toBe("MATCH");
    });

    it("returns ERROR for malformed envelopes", async () => {
        const result = await makeRunner(makeEnvelopeRow("RFQ_GROUPING", { canonicalEventId: "event-1", orderedCandidateProfiles: "bad" as unknown as Record<string, unknown>[], orderedAssessments: [] }, {}, { grouping: {} })).run("envelope-1");
        expect(result.status).toBe("ERROR");
    });

    it("returns ERROR for unsupported decision types", async () => {
        const result = await makeRunner(makeEnvelopeRow("RFQ_RANKING", {}, {}, {})).run("envelope-1");
        expect(result.status).toBe("ERROR");
    });

    it("returns DIFF for deliberate output mismatch", async () => {
        const inputSnapshot = {
            incomingOrder: { id: "order-1", size: "5" },
            orderedCandidates: [{ orderId: "maker-1" }]
        };
        const decisionTrace = {
            makerIterationOrder: ["maker-1"],
            matchDecisions: [{ makerOrderId: "maker-1", matchedSize: "2" }]
        };
        const outputSnapshot = { result: { filledSize: "1", remainingSize: "4" } };
        const result = await makeRunner(makeEnvelopeRow("INTERNAL_CROSS", inputSnapshot, decisionTrace, outputSnapshot)).run("envelope-1");
        expect(result.status).toBe("DIFF");
        expect(result.diffSummary?.diffCount).toBeGreaterThan(0);
    });

    it("comparison helpers are deterministic across repeated runs", () => {
        const left = { b: 2, a: [{ z: 1, a: 2 }] };
        const right = { a: [{ a: 2, z: 1 }], b: 2 };
        expect(compareReplaySnapshots(left, right)).toBe(true);
        expect(normalizeForReplayComparison(left)).toEqual(normalizeForReplayComparison(right));
    });

    it("replay helper preserves array order and deterministic grouping output", async () => {
        const grouping = replayRFQGrouping({
            canonicalEventId: "event-1",
            orderedCandidateProfiles: [
                { id: "profile-a", canonicalEventId: "event-1" },
                { id: "profile-b", canonicalEventId: "event-1" }
            ],
            orderedAssessments: []
        });
        expect(grouping.grouping.cautionLanes).toEqual([["profile-a"], ["profile-b"]]);

        const sor = await replaySORPlan({
            rfq: {
                rfqId: "11111111-1111-4111-8111-111111111111",
                idempotencyKey: "idem-1",
                canonicalMarketId: "market-1",
                takerId: "22222222-2222-4222-8222-222222222222",
                side: "buy",
                quantity: "5",
                stpMode: "CANCEL_NEWEST"
            },
            selectedQuote: { quoteId: "quote-1", price: 0.5, quantity: 5, feeBps: 0 },
            policy: "BEST_EFFORT",
            routeCandidates: [{
                id: "33333333-3333-4333-8333-333333333333",
                leg_id: "44444444-4444-4444-8444-444444444444",
                provider_type: "LP",
                provider_id: "lp-a",
                available_size: 5,
                quoted_price: 0.5,
                fees: {},
                latency_ms: 5,
                fill_prob: 1
            }],
            resolutionRiskPairPolicies: [],
            buildResult: { kind: "plan_created", crossingFilledSize: "0", remainingSize: "5" }
        }, new CostModel(), new Splitter());
        expect(Array.isArray((sor.decisionTrace as any).allocations)).toBe(true);

        const internalCross = replayInternalCross(
            { incomingOrder: { id: "order-1", size: "4" }, orderedCandidates: [{ orderId: "maker-1" }] },
            { makerIterationOrder: ["maker-1"], matchDecisions: [{ makerOrderId: "maker-1", matchedSize: "4" }] }
        );
        expect((internalCross.result as any).filledSize).toBe("4");
    });
});
