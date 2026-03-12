import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClearingRoundPlanner } from "../../src/core/combo-engine/clearing-round-planner.js";
import type {
  CandidateGroup,
  CandidateGroupResidual,
  ClearingCompressionScore,
  OverlapGraph,
  ScorableResidualVector
} from "../../src/core/combo-engine/types.js";
import type { IPhase2BCandidateRegistry } from "../../src/core/combo-engine/phase2b-candidate-registry.js";
import type { IOverlapGraphBuilder } from "../../src/core/combo-engine/overlap-graph-builder.js";
import type { ICandidateGroupEnumerator } from "../../src/core/combo-engine/candidate-group-enumerator.js";
import type { IClearingCompressionScorer } from "../../src/core/combo-engine/clearing-compression-scorer.js";
import type { IResolutionRiskEligibilityService } from "../../src/core/rfq-engine/resolution-risk-eligibility-service.js";
import { createPerformanceGuardrailConfig } from "../../src/guardrails/guardrail-config.js";

const makeVector = (
  entityId: string,
  registeredAt: string,
  compatibilityBucket = "bucket-1",
  resolutionProfileId?: string | null
) => ({
  entityId,
  userId: `user-${entityId}`,
  compatibilityBucket,
  vector: { "m1:o1": entityId === "a" ? "2" : "-2" },
  legCount: 1,
  grossAbsSize: "2",
  registeredAt,
  ...(resolutionProfileId !== undefined ? { resolutionProfileId } : {})
});

const makeGroup = (
  participantIds: readonly string[],
  residuals: CandidateGroup["residualAfterNetting"] = []
) => ({
  participantIds,
  uniqueLegs: ["m1:o1"],
  estimatedCompressionScore: "1",
  residualAfterNetting: residuals,
  exactnessScore: residuals.length === 0 ? "1" : "0.5"
} satisfies CandidateGroup);

const makeScore = (overrides: Partial<ClearingCompressionScore> = {}): ClearingCompressionScore => ({
  compressionScore: overrides.compressionScore ?? "4",
  preNetAbsExposure: overrides.preNetAbsExposure ?? "4",
  postNetAbsResidual: overrides.postNetAbsResidual ?? "0",
  residualVectorByParticipant: overrides.residualVectorByParticipant ?? {},
  rankingPenalty: overrides.rankingPenalty ?? "1",
  finalScore: overrides.finalScore ?? "3",
  tieBreak: overrides.tieBreak ?? {
    smallestResidual: overrides.postNetAbsResidual ?? "0",
    oldestParticipantAt: "2026-03-10T09:00:00.000Z",
    participantCount: 2
  }
});

describe("ClearingRoundPlanner", () => {
  let candidateRegistry: IPhase2BCandidateRegistry;
  let overlapGraphBuilder: IOverlapGraphBuilder;
  let candidateGroupEnumerator: ICandidateGroupEnumerator;
  let clearingCompressionScorer: IClearingCompressionScorer;
  let planner: ClearingRoundPlanner;

  beforeEach(() => {
    candidateRegistry = {
      registerEntity: vi.fn(),
      unregisterEntity: vi.fn(),
      listBucketEntities: vi.fn(),
      getEntitySnapshot: vi.fn()
    };

    overlapGraphBuilder = {
      build: vi.fn()
    };

    candidateGroupEnumerator = {
      enumerate: vi.fn()
    };

    clearingCompressionScorer = {
      score: vi.fn()
    };
    planner = new ClearingRoundPlanner(
      candidateRegistry,
      overlapGraphBuilder,
      candidateGroupEnumerator,
      clearingCompressionScorer
    );
  });

  it("returns deterministic output for the same input set", async () => {
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["b", "a"],
      nextCursor: null
    });
    vi.mocked(candidateRegistry.getEntitySnapshot).mockImplementation(async (entityId: string) => {
      if (entityId === "b") {
        return makeVector("b", "2026-03-10T09:05:00.000Z");
      }
      if (entityId === "a") {
        return makeVector("a", "2026-03-10T09:00:00.000Z");
      }
      return null;
    });

    const graph: OverlapGraph = {
      nodes: [],
      edges: []
    };
    vi.mocked(overlapGraphBuilder.build).mockReturnValue(graph);

    const selectedGroup = makeGroup(["a", "b"]);
    vi.mocked(candidateGroupEnumerator.enumerate).mockReturnValue([selectedGroup]);
    vi.mocked(clearingCompressionScorer.score).mockReturnValue(
      makeScore({
        residualVectorByParticipant: {
          a: { entityId: "a", vector: { "m1:o1": "2" } },
          b: { entityId: "b", vector: { "m1:o1": "-2" } }
        }
      })
    );

    const first = await planner.plan("bucket-1");
    const second = await planner.plan("bucket-1");

    expect(first).toEqual(second);
    expect(first?.participantLockOrder).toEqual(["a", "b"]);
  });

  it("returns null when bucket is empty", async () => {
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: [],
      nextCursor: null
    });

    await expect(planner.plan("bucket-1")).resolves.toBeNull();
  });

  it("returns null when no valid group exists", async () => {
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["a"],
      nextCursor: null
    });
    vi.mocked(candidateRegistry.getEntitySnapshot).mockResolvedValue(
      makeVector("a", "2026-03-10T09:00:00.000Z")
    );
    vi.mocked(overlapGraphBuilder.build).mockReturnValue({ nodes: [], edges: [] });
    vi.mocked(candidateGroupEnumerator.enumerate).mockReturnValue([]);

    await expect(planner.plan("bucket-1")).resolves.toBeNull();
  });

  it("chooses the higher-score group and applies tie-breaks deterministically", async () => {
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["a", "b", "c"],
      nextCursor: null
    });
    vi.mocked(candidateRegistry.getEntitySnapshot)
      .mockResolvedValueOnce(makeVector("a", "2026-03-10T09:00:00.000Z"))
      .mockResolvedValueOnce(makeVector("b", "2026-03-10T09:10:00.000Z"))
      .mockResolvedValueOnce(makeVector("c", "2026-03-10T09:20:00.000Z"));
    vi.mocked(overlapGraphBuilder.build).mockReturnValue({ nodes: [], edges: [] });

    const bestGroup = makeGroup(["a", "b"]);
    const worseGroup = makeGroup(["a", "c"], [{ key: "m2:o2", signedResidual: "1" }]);
    vi.mocked(candidateGroupEnumerator.enumerate).mockReturnValue([worseGroup, bestGroup]);

    vi.mocked(clearingCompressionScorer.score)
      .mockImplementation((group) =>
        group.participantIds.join("|") === "a|b"
          ? makeScore({
              finalScore: "5",
              postNetAbsResidual: "0",
              residualVectorByParticipant: {
                a: { entityId: "a", vector: { "m1:o1": "2" } },
                b: { entityId: "b", vector: { "m1:o1": "-2" } }
              }
            })
          : makeScore({
              finalScore: "4",
              postNetAbsResidual: "1",
              residualVectorByParticipant: {
                a: { entityId: "a", vector: { "m1:o1": "2" } },
                c: { entityId: "c", vector: { "m1:o1": "-1", "m2:o2": "1" } }
              },
              tieBreak: {
                smallestResidual: "1",
                oldestParticipantAt: "2026-03-10T09:00:00.000Z",
                participantCount: 2
              }
            })
      );

    const plan = await planner.plan("bucket-1");

    expect(plan?.selectedGroup.participantIds).toEqual(["a", "b"]);
    expect(plan?.participantLockOrder).toEqual(["a", "b"]);
  });

  it("fails closed when hydrated snapshots disagree on compatibility bucket", async () => {
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["a", "b"],
      nextCursor: null
    });
    vi.mocked(candidateRegistry.getEntitySnapshot)
      .mockResolvedValueOnce(makeVector("a", "2026-03-10T09:00:00.000Z", "bucket-1"))
      .mockResolvedValueOnce(makeVector("b", "2026-03-10T09:10:00.000Z", "bucket-2"));

    await expect(planner.plan("bucket-1")).rejects.toThrow("compatibility_bucket_mismatch");
  });

  it("fails closed when a listed entity snapshot is missing", async () => {
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["a"],
      nextCursor: null
    });
    vi.mocked(candidateRegistry.getEntitySnapshot).mockResolvedValue(null);

    await expect(planner.plan("bucket-1")).rejects.toThrow("missing_entity_snapshot:a");
  });

  it("fails closed when snapshot hydration throws", async () => {
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["a"],
      nextCursor: null
    });
    vi.mocked(candidateRegistry.getEntitySnapshot).mockRejectedValue(new Error("malformed_entity_snapshot"));

    await expect(planner.plan("bucket-1")).rejects.toThrow("malformed_entity_snapshot");
  });

  it("excludes mixed groups with a non-safe cross-profile pair", async () => {
    const resolutionRiskEligibilityService: IResolutionRiskEligibilityService = {
      isSafeForInternalPooling: vi.fn(),
      isSafeForCrossVenueNetting: vi.fn().mockResolvedValue(false)
    };
    planner = new ClearingRoundPlanner(
      candidateRegistry,
      overlapGraphBuilder,
      candidateGroupEnumerator,
      clearingCompressionScorer,
      resolutionRiskEligibilityService
    );
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["a", "b"],
      nextCursor: null
    });
    vi.mocked(candidateRegistry.getEntitySnapshot)
      .mockResolvedValueOnce(makeVector("a", "2026-03-10T09:00:00.000Z", "bucket-1", "profile-a"))
      .mockResolvedValueOnce(makeVector("b", "2026-03-10T09:10:00.000Z", "bucket-1", "profile-b"));
    vi.mocked(overlapGraphBuilder.build).mockReturnValue({ nodes: [], edges: [] });
    vi.mocked(candidateGroupEnumerator.enumerate).mockReturnValue([makeGroup(["a", "b"])]);

    const result = await planner.plan("bucket-1");

    expect(result).toBeNull();
    expect(resolutionRiskEligibilityService.isSafeForCrossVenueNetting).toHaveBeenCalledWith(
      "profile-a",
      "profile-b",
      { stableKey: "bucket-1" }
    );
    expect(clearingCompressionScorer.score).not.toHaveBeenCalled();
  });

  it("allows all-SAFE_EQUIVALENT cross-profile groups", async () => {
    const resolutionRiskEligibilityService: IResolutionRiskEligibilityService = {
      isSafeForInternalPooling: vi.fn(),
      isSafeForCrossVenueNetting: vi.fn().mockResolvedValue(true)
    };
    planner = new ClearingRoundPlanner(
      candidateRegistry,
      overlapGraphBuilder,
      candidateGroupEnumerator,
      clearingCompressionScorer,
      resolutionRiskEligibilityService
    );
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["a", "b"],
      nextCursor: null
    });
    vi.mocked(candidateRegistry.getEntitySnapshot)
      .mockResolvedValueOnce(makeVector("a", "2026-03-10T09:00:00.000Z", "bucket-1", "profile-a"))
      .mockResolvedValueOnce(makeVector("b", "2026-03-10T09:10:00.000Z", "bucket-1", "profile-b"));
    vi.mocked(overlapGraphBuilder.build).mockReturnValue({ nodes: [], edges: [] });
    vi.mocked(candidateGroupEnumerator.enumerate).mockReturnValue([makeGroup(["a", "b"])]);
    vi.mocked(clearingCompressionScorer.score).mockReturnValue(
      makeScore({
        residualVectorByParticipant: {
          a: { entityId: "a", vector: { "m1:o1": "2" } },
          b: { entityId: "b", vector: { "m1:o1": "-2" } }
        }
      })
    );

    const result = await planner.plan("bucket-1");

    expect(result?.selectedGroup.participantIds).toEqual(["a", "b"]);
    expect(resolutionRiskEligibilityService.isSafeForCrossVenueNetting).toHaveBeenCalledWith(
      "profile-a",
      "profile-b",
      { stableKey: "bucket-1" }
    );
  });

  it("returns null before graph build when DISABLE_PHASE2B guardrails trigger", async () => {
    planner = new ClearingRoundPlanner(
      candidateRegistry,
      overlapGraphBuilder,
      candidateGroupEnumerator,
      clearingCompressionScorer,
      undefined,
      undefined,
      undefined,
      createPerformanceGuardrailConfig({
        version: "guardrails-v1",
        maxSorPlanningLatencyMs: 100,
        maxNettingPlanningLatencyMs: 100,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 1,
        maxGraphEdges: 10,
        maxCandidateGroups: 10,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 10,
        degradationPolicyVersion: "degradation-v1"
      }),
      {
        evaluate: vi.fn().mockReturnValue({
          violated: true,
          violations: [
            {
              type: "BUCKET_TOO_LARGE",
              actual: 2,
              threshold: 1,
              reason: "bucket entity count exceeded threshold"
            }
          ],
          suggestedDegradation: "DISABLE_PHASE2B"
        })
      } as never,
      {
        getEffectiveExecutionMode: vi.fn().mockResolvedValue({
          mode: "DISABLE_PHASE2B",
          reason: "BUCKET_TOO_LARGE",
          source: "guardrail"
        })
      } as never,
      {
        getReplayWriteFailures: vi.fn().mockResolvedValue(0)
      },
      "clearing-phase2b-test",
      {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    );
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["a", "b"],
      nextCursor: null
    });

    const result = await planner.plan("bucket-1");

    expect(result).toBeNull();
    expect(candidateRegistry.getEntitySnapshot).not.toHaveBeenCalled();
    expect(overlapGraphBuilder.build).not.toHaveBeenCalled();
  });

  it("keeps Phase 2B observational only when guardrails are resolved in SHADOW mode", async () => {
    planner = new ClearingRoundPlanner(
      candidateRegistry,
      overlapGraphBuilder,
      candidateGroupEnumerator,
      clearingCompressionScorer,
      undefined,
      undefined,
      undefined,
      createPerformanceGuardrailConfig({
        version: "guardrails-v1",
        maxSorPlanningLatencyMs: 100,
        maxNettingPlanningLatencyMs: 100,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 1,
        maxGraphEdges: 10,
        maxCandidateGroups: 10,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 10,
        degradationPolicyVersion: "degradation-v1"
      }),
      {
        evaluate: vi.fn().mockReturnValue({
          violated: true,
          violations: [
            {
              type: "BUCKET_TOO_LARGE",
              actual: 2,
              threshold: 1,
              reason: "bucket entity count exceeded threshold"
            }
          ],
          suggestedDegradation: "DISABLE_PHASE2B"
        })
      } as never,
      {
        getEffectiveExecutionMode: vi.fn().mockResolvedValue({
          mode: "DISABLE_PHASE2B",
          reason: "BUCKET_TOO_LARGE",
          source: "guardrail"
        })
      } as never,
      {
        getReplayWriteFailures: vi.fn().mockResolvedValue(0)
      },
      "clearing-phase2b-test",
      {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      "SHADOW"
    );
    vi.mocked(candidateRegistry.listBucketEntities).mockResolvedValue({
      entityIds: ["a", "b"],
      nextCursor: null
    });
    vi.mocked(candidateRegistry.getEntitySnapshot)
      .mockResolvedValueOnce(makeVector("a", "2026-03-10T09:00:00.000Z"))
      .mockResolvedValueOnce(makeVector("b", "2026-03-10T09:10:00.000Z"));
    vi.mocked(overlapGraphBuilder.build).mockReturnValue({ nodes: [], edges: [] });
    vi.mocked(candidateGroupEnumerator.enumerate).mockReturnValue([makeGroup(["a", "b"])]);
    vi.mocked(clearingCompressionScorer.score).mockReturnValue(
      makeScore({
        residualVectorByParticipant: {
          a: { entityId: "a", vector: { "m1:o1": "2" } },
          b: { entityId: "b", vector: { "m1:o1": "-2" } }
        }
      })
    );

    const result = await planner.plan("bucket-1");

    expect(result?.selectedGroup.participantIds).toEqual(["a", "b"]);
    expect(candidateRegistry.getEntitySnapshot).toHaveBeenCalledTimes(2);
    expect(overlapGraphBuilder.build).toHaveBeenCalledTimes(1);
  });
});
