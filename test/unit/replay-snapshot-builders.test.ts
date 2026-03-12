import { describe, expect, it } from "vitest";

import { stableJsonSerialize } from "../../src/core/replay/replay-envelope-writer.js";
import { ResolutionRiskSnapshotBuilder } from "../../src/core/replay/builders/resolution-risk-snapshot-builder.js";
import { RFQGroupingSnapshotBuilder } from "../../src/core/replay/builders/rfq-grouping-snapshot-builder.js";
import { SORSnapshotBuilder } from "../../src/core/replay/builders/sor-snapshot-builder.js";
import { InternalCrossSnapshotBuilder } from "../../src/core/replay/builders/internal-cross-snapshot-builder.js";
import { NettingPhase2ASnapshotBuilder } from "../../src/core/replay/builders/netting-phase2a-snapshot-builder.js";
import { ClearingPhase2BSnapshotBuilder } from "../../src/core/replay/builders/clearing-phase2b-snapshot-builder.js";

const baseMetadata = {
    correlationId: "corr-1",
    configVersion: "config-v1",
    engineVersion: "engine-v1",
    featureFlags: {
        beta: false,
        alpha: true
    }
} as const;

describe("Replay snapshot builders", () => {
    it("builds deterministic resolution risk assessment envelopes", () => {
        const builder = new ResolutionRiskSnapshotBuilder();
        const first = builder.build({
            ...baseMetadata,
            canonicalEventId: "event-1",
            profileA: {
                id: "profile-a",
                metadata: { zeta: 2, alpha: 1 }
            },
            profileB: {
                id: "profile-b",
                metadata: { beta: 2, alpha: 1 }
            },
            factorComparison: {
                oracleMismatch: { score: 0, confidence: 1 }
            },
            scoredAssessment: {
                marketAProfileId: "profile-a",
                marketBProfileId: "profile-b",
                version: "resolution-v1",
                riskScore: "0.1"
            },
            scoringWeights: {
                wordingAmbiguity: 0.16,
                oracleMismatch: 0.22
            },
            confidenceInputs: {
                metadataCompleteness: 1
            },
            equivalenceThresholds: {
                safe: 0.2
            }
        });

        const second = builder.build({
            ...baseMetadata,
            canonicalEventId: "event-1",
            profileA: {
                metadata: { alpha: 1, zeta: 2 },
                id: "profile-a"
            },
            profileB: {
                metadata: { alpha: 1, beta: 2 },
                id: "profile-b"
            },
            factorComparison: {
                oracleMismatch: { confidence: 1, score: 0 }
            },
            scoredAssessment: {
                riskScore: "0.1",
                version: "resolution-v1",
                marketBProfileId: "profile-b",
                marketAProfileId: "profile-a"
            },
            scoringWeights: {
                oracleMismatch: 0.22,
                wordingAmbiguity: 0.16
            },
            confidenceInputs: {
                metadataCompleteness: 1
            },
            equivalenceThresholds: {
                safe: 0.2
            }
        });

        expect(first.entityId).toBe("event-1:profile-a:profile-b");
        expect(stableJsonSerialize(first.inputSnapshot)).toBe(stableJsonSerialize(second.inputSnapshot));
        expect(stableJsonSerialize(first.decisionTrace)).toBe(stableJsonSerialize(second.decisionTrace));
        expect(stableJsonSerialize(first.outputSnapshot)).toBe(stableJsonSerialize(second.outputSnapshot));
    });

    it("captures RFQ grouping pair order and lane ordering", () => {
        const builder = new RFQGroupingSnapshotBuilder();
        const envelope = builder.build({
            ...baseMetadata,
            rfqId: "rfq-1",
            canonicalEventId: "event-1",
            orderedCandidateProfiles: [
                { id: "profile-a", venue: "A" },
                { id: "profile-b", venue: "B" }
            ],
            orderedAssessments: [
                { marketAProfileId: "profile-a", marketBProfileId: "profile-b", equivalenceClass: "SAFE_EQUIVALENT" }
            ],
            pairGenerationOrder: ["profile-a:profile-b"],
            grouping: {
                canonicalEventId: "event-1",
                safePools: [["profile-a", "profile-b"]],
                cautionLanes: [],
                blockedProfiles: [],
                reasonsByProfile: {},
                pairMatrix: {
                    "profile-a:profile-b": {
                        equivalenceClass: "SAFE_EQUIVALENT",
                        reasons: []
                    }
                }
            }
        });

        expect(envelope.decisionType).toBe("RFQ_GROUPING");
        expect(envelope.decisionTrace.pairGenerationOrder).toEqual(["profile-a:profile-b"]);
    });

    it("captures SOR candidate ordering and split tie-break inputs", () => {
        const builder = new SORSnapshotBuilder();
        const envelope = builder.build({
            ...baseMetadata,
            rfqId: "rfq-2",
            rfq: { rfqId: "rfq-2", metadata: { reservation_token: "rsv-1" } },
            selectedQuote: { quoteId: "quote-1", price: 0.51, quantity: 10 },
            policy: "BEST_EFFORT",
            routeCandidates: [
                { id: "cand-a", provider_id: "lp-a" },
                { id: "cand-b", provider_id: "lp-b" }
            ],
            scoredCandidates: [
                {
                    candidateId: "cand-a",
                    providerId: "lp-a",
                    effectiveUnitCost: 1,
                    totalExpectedCost: 2,
                    breakdown: { resolutionRiskPenalty: 0 }
                }
            ],
            allocations: [{ candidateId: "cand-a", roundedSize: 5 }],
            resolutionRiskPairPolicies: [{ pairKey: "cand-a:cand-b", mode: "penalty" }],
            candidateOrdering: ["cand-a", "cand-b"],
            splitEligibilityDecisions: [{ candidateId: "cand-a", allowed: true, reason: "eligible" }],
            buildResult: { kind: "plan_created", plan: { id: "plan-1" } }
        });

        expect(envelope.entityId).toBe("rfq-2");
        expect(envelope.decisionTrace.candidateOrdering).toEqual(["cand-a", "cand-b"]);
    });

    it("captures internal cross maker iteration and lock order", () => {
        const builder = new InternalCrossSnapshotBuilder();
        const envelope = builder.build({
            ...baseMetadata,
            incomingOrderId: "order-1",
            incomingOrder: { id: "order-1", resolution_profile_id: "profile-a" },
            orderedCandidates: [
                { orderId: "maker-1", remaining: "5" },
                { orderId: "maker-2", remaining: "4" }
            ],
            selfTradeChecks: [{ makerOrderId: "maker-1", selfTrade: false }],
            resolutionEligibilityDecisions: [{ leftProfileId: "profile-a", rightProfileId: "profile-a", allowed: true, reason: "same_profile" }],
            makerIterationOrder: ["maker-1", "maker-2"],
            lockOrder: ["lock:order:maker-1", "lock:order:order-1"],
            matchDecisions: [{ makerOrderId: "maker-1", matchedSize: "2" }],
            result: { filledSize: 2, remainingSize: 3, trades: [{ id: "trade-1" }] }
        });

        expect(envelope.decisionType).toBe("INTERNAL_CROSS");
        expect(envelope.decisionTrace.lockOrder).toEqual(["lock:order:maker-1", "lock:order:order-1"]);
    });

    it("captures netting candidate order, matched-leg order, and replay identifiers", () => {
        const builder = new NettingPhase2ASnapshotBuilder();
        const envelope = builder.build({
            ...baseMetadata,
            incomingComboId: "combo-1",
            incomingCombo: { id: "combo-1" },
            candidateCombos: [{ comboId: "combo-2", userId: "user-2", legs: [] }],
            candidateOrder: ["combo-2"],
            compatibilityInputs: [{ candidateId: "combo-2" }],
            matchedLegPairOrder: [{ incomingLegId: "leg-a", candidateLegId: "leg-b", marketId: "m1", outcomeId: "o1" }],
            resolutionEligibilityDecisions: [{ leftProfileId: "profile-a", rightProfileId: "profile-b", allowed: true, reason: "SAFE_EQUIVALENT" }],
            lockResourceIds: ["lock:combo:combo-1", "lock:combo:combo-2"],
            attemptSnapshots: [{ attemptId: "attempt-1" }],
            result: { nettedSize: "5", residualLegs: [], nettingGroupIds: ["group-1"], eventsWritten: 1 }
        });

        expect(envelope.entityId).toBe("combo-1");
        expect(envelope.decisionTrace.matchedLegPairOrder).toEqual([
            { candidateLegId: "leg-b", incomingLegId: "leg-a", marketId: "m1", outcomeId: "o1" }
        ]);
    });

    it("captures clearing graph ordering, score tuples, and participant lock order", () => {
        const builder = new ClearingPhase2BSnapshotBuilder();
        const envelope = builder.build({
            ...baseMetadata,
            bucketId: "bucket-1",
            plannerConfig: { maxParticipants: 4, maxUniqueLegs: 6 },
            candidateSnapshots: [{ entityId: "entity-a" }, { entityId: "entity-b" }],
            bucketEntityOrder: ["entity-a", "entity-b"],
            overlapGraph: { nodes: [{ entityId: "entity-a" }], edges: [] },
            enumeratedGroups: [{ participantIds: ["entity-a", "entity-b"] }],
            scoreSnapshots: [{ participantIds: ["entity-a", "entity-b"], score: { finalScore: "0.9" } }],
            resolutionEligibilityExclusions: [],
            selectedPlan: {
                compatibilityBucket: "bucket-1",
                selectedGroup: { participantIds: ["entity-a", "entity-b"] },
                score: { finalScore: "0.9" },
                residuals: [],
                participantLockOrder: ["entity-a", "entity-b"]
            }
        });

        expect(envelope.decisionType).toBe("CLEARING_PHASE2B");
        expect(envelope.entityId).toBe("bucket-1:entity-a|entity-b");
        expect(envelope.decisionTrace.participantLockOrder).toEqual(["entity-a", "entity-b"]);
    });

    it("fails closed when required tie-break inputs are missing", () => {
        const builder = new ClearingPhase2BSnapshotBuilder();

        expect(() =>
            builder.build({
                ...baseMetadata,
                bucketId: "bucket-1",
                plannerConfig: { maxParticipants: 4 },
                candidateSnapshots: [],
                bucketEntityOrder: [],
                overlapGraph: { nodes: [], edges: [] },
                enumeratedGroups: [],
                scoreSnapshots: [],
                resolutionEligibilityExclusions: [],
                selectedPlan: null
            })
        ).toThrow(/selectedPlan/);
    });
});
