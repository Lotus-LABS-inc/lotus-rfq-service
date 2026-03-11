import { beforeEach, describe, expect, it, vi } from "vitest";
import { pino } from "pino";

import { MultiPartyClearingExecutor } from "../../src/core/combo-engine/multi-party-clearing-executor.js";
import type {
  CandidateGroup,
  ClearingRoundExecutionResult,
  ClearingRoundPlan,
  ScorableResidualVector
} from "../../src/core/combo-engine/types.js";

const logger = pino({ level: "silent" });

interface ExecutorPrivateMethods {
  allocateParticipantResiduals: (
    group: CandidateGroup,
    participants: readonly unknown[],
    groupResiduals: readonly { key: string; signedResidual: string }[]
  ) => Array<{
    entityId: string;
    residualVector: Record<string, string>;
    matchedVector: Record<string, string>;
  }>;
  executeTransaction: (
    compatibilityBucket: string,
    participantLockOrder: readonly string[],
    allocations: readonly unknown[],
    validatedPlan: {
      selectedGroup: CandidateGroup;
      score: ClearingRoundPlan["score"];
      residuals: readonly { key: string; signedResidual: string }[];
    },
    signatures: { participantSetHash: string; matchSignatureHash: string }
  ) => Promise<ClearingRoundExecutionResult>;
  refreshRegistryFromAuthoritativeState: (
    participantIds: readonly string[],
    compatibilityBucket: string
  ) => Promise<void>;
  applyExposureMutations: (
    client: unknown,
    clearingRoundId: string,
    legUpdates: readonly unknown[],
    signatures: { participantSetHash: string; matchSignatureHash: string },
    allocations: readonly unknown[]
  ) => Promise<void>;
}

const makeRoundPlan = (): ClearingRoundPlan => ({
  compatibilityBucket: "u|e|s|r",
  selectedGroup: {
    participantIds: ["combo-a", "combo-b"],
    uniqueLegs: ["m1:o1"],
    estimatedCompressionScore: "1",
    residualAfterNetting: [],
    exactnessScore: "1"
  },
  score: {
    compressionScore: "4",
    preNetAbsExposure: "4",
    postNetAbsResidual: "0",
    residualVectorByParticipant: {
      "combo-a": { entityId: "combo-a", vector: { "m1:o1": "2" } },
      "combo-b": { entityId: "combo-b", vector: { "m1:o1": "-2" } }
    },
    rankingPenalty: "1",
    finalScore: "3",
    tieBreak: {
      smallestResidual: "0",
      oldestParticipantAt: "2026-03-10T09:00:00.000Z",
      participantCount: 2
    }
  },
  residuals: [],
  participantLockOrder: ["combo-a", "combo-b"]
});

const makeVector = (
  entityId: string,
  userId: string,
  signed: string,
  createdAt: string
): ScorableResidualVector => ({
  entityId,
  userId,
  compatibilityBucket: "u|e|s|r",
  vector: { "m1:o1": signed },
  legCount: 1,
  grossAbsSize: signed.startsWith("-") ? signed.slice(1) : signed,
  createdAt
});

describe("MultiPartyClearingExecutor", () => {
  const pool = {
    connect: vi.fn(),
    query: vi.fn()
  };
  const residualVectorBuilder = {
    build: vi.fn()
  };
  const candidateRegistry = {
    registerEntity: vi.fn(),
    unregisterEntity: vi.fn(),
    listBucketEntities: vi.fn(),
    getEntitySnapshot: vi.fn()
  };
  const overlapGraphBuilder = {
    build: vi.fn()
  };
  const candidateGroupEnumerator = {
    enumerate: vi.fn()
  };
  const clearingCompressionScorer = {
    score: vi.fn()
  };
  const multiPartyExposureAggregator = {
    aggregate: vi.fn()
  };
  const resourceLocker = {
    acquireLocks: vi.fn(),
    releaseLocks: vi.fn(),
    comboLockId: vi.fn((comboId: string) => `lock:combo:${comboId}`)
  };

  let executor: MultiPartyClearingExecutor;
  let executorPrivate: ExecutorPrivateMethods;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new MultiPartyClearingExecutor(
      pool as never,
      residualVectorBuilder as never,
      candidateRegistry as never,
      overlapGraphBuilder as never,
      candidateGroupEnumerator as never,
      clearingCompressionScorer as never,
      multiPartyExposureAggregator as never,
      resourceLocker as never,
      logger
    );
    executorPrivate = executor as unknown as ExecutorPrivateMethods;
    resourceLocker.acquireLocks.mockResolvedValue({ lockKeys: ["lock:combo:combo-a"], ownerId: "owner-1" });
    resourceLocker.releaseLocks.mockResolvedValue(undefined);
    multiPartyExposureAggregator.aggregate.mockReturnValue({
      participantExposureDeltas: []
    });
  });

  it("acquires deterministic locks in ascending participant order", async () => {
    const roundPlan: ClearingRoundPlan = {
      ...makeRoundPlan(),
      selectedGroup: { ...makeRoundPlan().selectedGroup, participantIds: ["combo-b", "combo-a"] },
      participantLockOrder: ["combo-a", "combo-b"]
    };

    vi.spyOn(executor as never, "loadParticipants").mockResolvedValue([] as never);
    vi.spyOn(executor as never, "revalidateRoundPlan").mockReturnValue({
      compatibilityBucket: roundPlan.compatibilityBucket,
      selectedGroup: makeRoundPlan().selectedGroup,
      score: makeRoundPlan().score,
      residuals: []
    });
    vi.spyOn(executor as never, "buildMatchSignatures").mockReturnValue({
      participantSetHash: "set-hash",
      matchSignatureHash: "sig-hash"
    });
    vi.spyOn(executor as never, "allocateParticipantResiduals").mockReturnValue([]);
    vi.spyOn(executor as never, "executeTransaction").mockResolvedValue({
      replayed: false,
      applied: true,
      clearingRoundId: "round-1",
      compatibilityBucket: roundPlan.compatibilityBucket,
      participantSetHash: "set-hash",
      matchSignatureHash: "sig-hash",
      residuals: [],
      participantLockOrder: ["combo-a", "combo-b"],
      updatedParticipantIds: ["combo-a", "combo-b"],
      participants: [],
      eventCount: 1
    } satisfies ClearingRoundExecutionResult);
    vi.spyOn(executor as never, "refreshRegistryFromAuthoritativeState").mockResolvedValue(undefined);

    await executor.execute(roundPlan);

    expect(resourceLocker.acquireLocks).toHaveBeenCalledWith([
      "lock:combo:combo-a",
      "lock:combo:combo-b"
    ]);
    expect(resourceLocker.releaseLocks).toHaveBeenCalledTimes(1);
  });

  it("fails closed when authoritative revalidation invalidates the supplied round plan", async () => {
    vi.spyOn(executor as never, "loadParticipants").mockResolvedValue([] as never);
    vi.spyOn(executor as never, "revalidateRoundPlan").mockImplementation(() => {
      throw new Error("round_plan_invalidated");
    });

    await expect(executor.execute(makeRoundPlan())).rejects.toThrow("round_plan_invalidated");
    expect(resourceLocker.releaseLocks).toHaveBeenCalledTimes(1);
  });

  it("returns replay-safe no-op when a concurrent winner already committed before revalidation completes", async () => {
    vi.spyOn(executor as never, "loadParticipants").mockImplementation(() => {
      throw new Error("invalid_clearing_participant_state:combo-a:EXECUTED");
    });
    vi.spyOn(executor as never, "loadExistingRoundId").mockResolvedValue("existing-round");

    const result = await executor.execute(makeRoundPlan());

    expect(result).toMatchObject({
      replayed: true,
      applied: false,
      clearingRoundId: "existing-round"
    });
    expect(resourceLocker.releaseLocks).toHaveBeenCalledTimes(1);
  });

  it("allocates partial residual to oldest participants first", () => {
    const group: CandidateGroup = {
      participantIds: ["combo-a", "combo-b", "combo-c"],
      uniqueLegs: ["m1:o1"],
      estimatedCompressionScore: "0.5",
      residualAfterNetting: [{ key: "m1:o1", signedResidual: "1" }],
      exactnessScore: "0.5"
    };
    const participants = [
      {
        combo: {
          id: "combo-a",
          user_id: "user-a",
          state: "OPEN",
          created_at: new Date("2026-03-10T09:00:00.000Z"),
          legs: []
        },
        vector: makeVector("combo-a", "user-a", "2", "2026-03-10T09:00:00.000Z")
      },
      {
        combo: {
          id: "combo-b",
          user_id: "user-b",
          state: "OPEN",
          created_at: new Date("2026-03-10T09:05:00.000Z"),
          legs: []
        },
        vector: makeVector("combo-b", "user-b", "2", "2026-03-10T09:05:00.000Z")
      },
      {
        combo: {
          id: "combo-c",
          user_id: "user-c",
          state: "OPEN",
          created_at: new Date("2026-03-10T09:10:00.000Z"),
          legs: []
        },
        vector: makeVector("combo-c", "user-c", "-3", "2026-03-10T09:10:00.000Z")
      }
    ];

    const allocations = executorPrivate.allocateParticipantResiduals(group, participants, group.residualAfterNetting);

    expect(allocations.find((allocation: { entityId: string; residualVector: Record<string, string> }) => allocation.entityId === "combo-a")?.residualVector).toEqual({ "m1:o1": "1" });
    expect(allocations.find((allocation: { entityId: string; residualVector: Record<string, string> }) => allocation.entityId === "combo-b")?.residualVector).toEqual({});
    expect(allocations.find((allocation: { entityId: string; matchedVector: Record<string, string> }) => allocation.entityId === "combo-c")?.matchedVector).toEqual({ "m1:o1": "-3" });
  });

  it("rolls back safely on transaction failure", async () => {
    const client = {
      query: vi.fn(),
      release: vi.fn()
    };
    pool.connect.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: "round-1" }] }) // insert clearing_round
      .mockResolvedValueOnce({ rows: [{ id: "11111111-1111-1111-1111-111111111111" }] }) // exposure idempotency
      .mockResolvedValueOnce({}); // ROLLBACK

    vi.spyOn(executor as never, "loadParticipantsWithClient").mockResolvedValue([] as never);
    vi.spyOn(executor as never, "revalidateRoundPlan").mockReturnValue({
      compatibilityBucket: "u|e|s|r",
      selectedGroup: makeRoundPlan().selectedGroup,
      score: makeRoundPlan().score,
      residuals: []
    });
    vi.spyOn(executor as never, "allocateParticipantResiduals").mockReturnValue([]);
    vi.spyOn(executor as never, "buildMatchSignatures").mockReturnValue({
      participantSetHash: "set-hash",
      matchSignatureHash: "sig-hash"
    });
    vi.spyOn(executor as never, "insertRoundParticipants").mockRejectedValue(new Error("write_failed"));

    await expect(
      executorPrivate.executeTransaction(
        "u|e|s|r",
        ["combo-a", "combo-b"],
        [],
        {
          selectedGroup: makeRoundPlan().selectedGroup,
          score: makeRoundPlan().score,
          residuals: []
        },
        { participantSetHash: "set-hash", matchSignatureHash: "sig-hash" }
      )
    ).rejects.toThrow("write_failed");

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("returns replay-safe no-op when the clearing round already exists", async () => {
    const client = {
      query: vi.fn(),
      release: vi.fn()
    };
    pool.connect.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // insert clearing_round
      .mockResolvedValueOnce({}); // ROLLBACK
    pool.query.mockResolvedValue({ rows: [{ id: "existing-round" }] });
    vi.spyOn(executor as never, "loadParticipantsWithClient").mockResolvedValue([] as never);
    vi.spyOn(executor as never, "revalidateRoundPlan").mockReturnValue({
      compatibilityBucket: "u|e|s|r",
      selectedGroup: makeRoundPlan().selectedGroup,
      score: makeRoundPlan().score,
      residuals: []
    });
    vi.spyOn(executor as never, "allocateParticipantResiduals").mockReturnValue([]);
    vi.spyOn(executor as never, "buildMatchSignatures").mockReturnValue({
      participantSetHash: "set-hash",
      matchSignatureHash: "sig-hash"
    });

    const result = await executorPrivate.executeTransaction(
      "u|e|s|r",
      ["combo-a", "combo-b"],
      [],
      {
        selectedGroup: makeRoundPlan().selectedGroup,
        score: makeRoundPlan().score,
        residuals: []
      },
      { participantSetHash: "set-hash", matchSignatureHash: "sig-hash" }
    );

    expect(result).toMatchObject({
      replayed: true,
      applied: false,
      clearingRoundId: "existing-round"
    });
  });

  it("swallows Redis refresh failures after commit", async () => {
    candidateRegistry.unregisterEntity.mockRejectedValue(new Error("redis_down"));
    vi.spyOn(executor as never, "loadParticipants").mockResolvedValue([]);

    await expect(executorPrivate.refreshRegistryFromAuthoritativeState(["combo-a"], "u|e|s|r")).resolves.toBeUndefined();
  });

  it("delegates exposure math to the multi-party exposure aggregator", async () => {
    const client = {
      query: vi.fn(),
      release: vi.fn()
    };
    const allocations = [
      {
        entityId: "combo-a",
        userId: "user-a",
        createdAt: new Date("2026-03-10T09:00:00.000Z"),
        originalVector: { "m1:o1": "2" },
        matchedVector: { "m1:o1": "2" },
        residualVector: {},
        combo: {
          id: "combo-a",
          user_id: "user-a",
          state: "OPEN",
          created_at: new Date("2026-03-10T09:00:00.000Z"),
          legs: [
            {
              id: "leg-a",
              combo_rfq_id: "combo-a",
              canonical_market_id: "m1",
              canonical_outcome_id: "o1",
              side: "buy" as const,
              size: "2",
              remaining_size: "2",
              price_hint: "0.40",
              metadata: null
            }
          ]
        }
      },
      {
        entityId: "combo-b",
        userId: "user-b",
        createdAt: new Date("2026-03-10T09:01:00.000Z"),
        originalVector: { "m1:o1": "-2" },
        matchedVector: { "m1:o1": "-2" },
        residualVector: {},
        combo: {
          id: "combo-b",
          user_id: "user-b",
          state: "OPEN",
          created_at: new Date("2026-03-10T09:01:00.000Z"),
          legs: [
            {
              id: "leg-b",
              combo_rfq_id: "combo-b",
              canonical_market_id: "m1",
              canonical_outcome_id: "o1",
              side: "sell" as const,
              size: "2",
              remaining_size: "2",
              price_hint: "0.40",
              metadata: null
            }
          ]
        }
      }
    ];

    multiPartyExposureAggregator.aggregate.mockReturnValue({
      participantExposureDeltas: [
        {
          participantId: "combo-a",
          userId: "user-a",
          maxLossDelta: "0.8",
          maxGainDelta: "1.2",
          perLegDeltas: [
            {
              legId: "leg-a",
              marketId: "m1",
              outcomeId: "o1",
              side: "buy" as const,
              price: "0.40",
              matchedSize: "2",
              maxLossDelta: "0.8",
              maxGainDelta: "1.2"
            }
          ]
        },
        {
          participantId: "combo-b",
          userId: "user-b",
          maxLossDelta: "1.2",
          maxGainDelta: "0.8",
          perLegDeltas: [
            {
              legId: "leg-b",
              marketId: "m1",
              outcomeId: "o1",
              side: "sell" as const,
              price: "0.40",
              matchedSize: "2",
              maxLossDelta: "1.2",
              maxGainDelta: "0.8"
            }
          ]
        }
      ]
    });
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "exposure-a", gross_notional: "0", net_notional: "0" }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: "exposure-b", gross_notional: "0", net_notional: "0" }] })
      .mockResolvedValueOnce({});

    await executorPrivate.applyExposureMutations(
      client as never,
      "round-1",
      [
        {
          legId: "leg-a",
          entityId: "combo-a",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          clearedSize: "2",
          priceHint: "0.40"
        },
        {
          legId: "leg-b",
          entityId: "combo-b",
          marketId: "m1",
          outcomeId: "o1",
          side: "sell",
          clearedSize: "2",
          priceHint: "0.40"
        }
      ],
      { participantSetHash: "set-hash", matchSignatureHash: "sig-hash" },
      allocations as never
    );

    expect(multiPartyExposureAggregator.aggregate).toHaveBeenCalledWith({
      matchedLegAllocations: [
        {
          participantId: "combo-a",
          userId: "user-a",
          legId: "leg-a",
          marketId: "m1",
          outcomeId: "o1",
          side: "buy",
          price: "0.40",
          matchedSize: "2"
        },
        {
          participantId: "combo-b",
          userId: "user-b",
          legId: "leg-b",
          marketId: "m1",
          outcomeId: "o1",
          side: "sell",
          price: "0.40",
          matchedSize: "2"
        }
      ]
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO exposure_journal"),
      expect.arrayContaining(["combo-multi-party-clearing", "round-1"])
    );
  });
});
