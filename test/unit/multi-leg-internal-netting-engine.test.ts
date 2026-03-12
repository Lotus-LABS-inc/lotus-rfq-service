import Decimal from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pino } from "pino";

import * as aggregationModule from "../../src/core/combo-engine/combo-netting-exposure-aggregation.js";
import { MultiLegInternalNettingEngine } from "../../src/core/combo-engine/multi-leg-internal-netting-engine.js";
import type { MultiLegInternalNettingInput } from "../../src/core/combo-engine/types.js";
import { createPerformanceGuardrailConfig } from "../../src/guardrails/guardrail-config.js";

const logger = pino({ level: "silent" });

interface AuthoritativeComboLegRow {
  id: string;
  combo_rfq_id: string;
  canonical_market_id: string;
  canonical_outcome_id: string;
  side: "buy" | "sell";
  size: string;
  remaining_size: string;
  price_hint: string | null;
  metadata: Record<string, unknown> | null;
}

interface AuthoritativeComboRow {
  id: string;
  user_id: string;
  state: string;
  legs: AuthoritativeComboLegRow[];
}

const createCombo = (
  id: string,
  userId: string,
  legs: Array<{
    id: string;
    marketId: string;
    outcomeId: string;
    side: "buy" | "sell";
    size: string;
    remaining: string;
    priceHint?: string;
    metadata?: Record<string, unknown>;
  }>,
  state: string = "OPEN"
): AuthoritativeComboRow => ({
  id,
  user_id: userId,
  state,
  legs: legs.map((leg) => ({
    id: leg.id,
    combo_rfq_id: id,
    canonical_market_id: leg.marketId,
    canonical_outcome_id: leg.outcomeId,
    side: leg.side,
    size: leg.size,
    remaining_size: leg.remaining,
    price_hint: leg.priceHint ?? null,
    metadata: leg.metadata ?? null
  }))
});

const toInput = (combo: AuthoritativeComboRow): MultiLegInternalNettingInput => ({
  id: combo.id,
  userId: combo.user_id,
  ...(combo.state ? { state: combo.state as NonNullable<MultiLegInternalNettingInput["state"]> } : {}),
  legs: combo.legs.map((leg) => ({
    id: leg.id,
    canonicalMarketId: leg.canonical_market_id,
    canonicalOutcomeId: leg.canonical_outcome_id,
    side: leg.side,
    remainingSize: leg.remaining_size,
    ...(leg.price_hint !== null ? { priceHint: leg.price_hint } : {})
  }))
});

describe("MultiLegInternalNettingEngine", () => {
  const candidateRegistry = {
    findCandidateCombos: vi.fn<() => Promise<readonly string[]>>(),
    registerComboCandidate: vi.fn<() => Promise<{ comboId: string; registeredKeys: readonly string[] }>>(),
    unregisterComboCandidate: vi.fn<() => Promise<{ comboId: string; removedFromKeys: readonly string[]; removed: boolean }>>()
  };
  const compatibilityEngine = {
    evaluate: vi.fn()
  };
  const resourceLocker = {
    acquireLocks: vi.fn(),
    releaseLocks: vi.fn(),
    comboLockId: vi.fn((comboId: string) => `lock:combo:${comboId}`),
    comboLegLockId: vi.fn((legId: string) => `lock:combo-leg:${legId}`)
  };
  const pool = {
    connect: vi.fn()
  };

  let engine: MultiLegInternalNettingEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new MultiLegInternalNettingEngine(
      pool as never,
      candidateRegistry,
      compatibilityEngine as never,
      resourceLocker as never,
      logger
    );
  });

  it("skips incompatible candidates without taking locks", async () => {
    const incoming = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "10", remaining: "10", priceHint: "0.6" }
    ]);
    const candidate = createCombo("candidate", "user-b", [
      { id: "cand-leg-1", marketId: "m2", outcomeId: "o2", side: "sell", size: "10", remaining: "10", priceHint: "0.5" }
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate"]);
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: false,
      reason: "no_compatible_overlap",
      matchedLegPairs: [],
      maxNettableSize: "0"
    });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (typeof comboId !== "string") {
        return null;
      }

      if (comboId === "incoming") {
        return incoming;
      }

      if (comboId === "candidate") {
        return candidate;
      }

      return null;
    });

    const result = await engine.attemptNet(toInput(incoming));

    expect(result).toEqual({
      nettedSize: "0",
      residualLegs: [
        {
          id: "in-leg-1",
          canonicalMarketId: "m1",
          canonicalOutcomeId: "o1",
          side: "buy",
          remainingSize: "10",
          priceHint: "0.6"
        }
      ],
      residualRemaining: true,
      nettingGroupIds: [],
      eventsWritten: 0
    });
    expect(resourceLocker.acquireLocks).not.toHaveBeenCalled();
  });

  it("returns residual legs after partial internal netting", async () => {
    const incoming = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "10", remaining: "10", priceHint: "0.6" }
    ]);
    const incomingAfterNet = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "10", remaining: "7", priceHint: "0.6" }
    ], "PARTIALLY_EXECUTED");
    const candidate = createCombo("candidate", "user-b", [
      { id: "cand-leg-1", marketId: "m1", outcomeId: "o1", side: "sell", size: "3", remaining: "3", priceHint: "0.55" }
    ]);

    const comboStore = new Map<string, AuthoritativeComboRow>([
      ["incoming", incoming],
      ["candidate", candidate]
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate"]);
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-leg-1",
          candidateLegId: "cand-leg-1",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "3"
        }
      ],
      maxNettableSize: "3"
    });
    resourceLocker.acquireLocks.mockResolvedValue({ lockKeys: ["lock:combo:incoming"], ownerId: "owner-1" });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) =>
      typeof comboId === "string" ? comboStore.get(comboId) ?? null : null
    );
    vi.spyOn(engine as never, "executeNettingTransaction").mockImplementation(async () => {
      comboStore.set("incoming", incomingAfterNet);
      comboStore.set("candidate", createCombo("candidate", "user-b", [
        { id: "cand-leg-1", marketId: "m1", outcomeId: "o1", side: "sell", size: "3", remaining: "0", priceHint: "0.55" }
      ], "EXECUTED"));

      return {
        nettingGroupId: "group-1",
        nettedSize: new Decimal(3),
        eventsWritten: 1,
        incomingResidualLegs: [],
        exhaustedComboIds: ["candidate"]
      };
    });

    const result = await engine.attemptNet(toInput(incoming));

    expect(result.nettedSize).toBe("3");
    expect(result.residualRemaining).toBe(true);
    expect(result.residualLegs).toEqual([
      {
        id: "in-leg-1",
        canonicalMarketId: "m1",
        canonicalOutcomeId: "o1",
        side: "buy",
        remainingSize: "7",
        priceHint: "0.6"
      }
    ]);
    expect(result.nettingGroupIds).toEqual(["group-1"]);
    expect(result.eventsWritten).toBe(1);
    expect(resourceLocker.releaseLocks).toHaveBeenCalledTimes(1);
    expect(candidateRegistry.unregisterComboCandidate).toHaveBeenCalledWith("candidate");
  });

  it("allows SAFE_EQUIVALENT cross-profile candidates for internal netting", async () => {
    const eligibilityService = {
      isSafeForCrossVenueNetting: vi.fn().mockResolvedValue(true)
    };
    engine = new MultiLegInternalNettingEngine(
      pool as never,
      candidateRegistry,
      compatibilityEngine as never,
      resourceLocker as never,
      logger,
      eligibilityService as never
    );

    const incoming = createCombo("incoming", "user-a", [
      {
        id: "in-leg-1",
        marketId: "m1",
        outcomeId: "o1",
        side: "buy",
        size: "10",
        remaining: "10",
        priceHint: "0.6",
        metadata: { resolution_profile_id: "profile-a" }
      }
    ]);
    const candidate = createCombo("candidate", "user-b", [
      {
        id: "cand-leg-1",
        marketId: "m1",
        outcomeId: "o1",
        side: "sell",
        size: "10",
        remaining: "10",
        priceHint: "0.55",
        metadata: { resolution_profile_id: "profile-b" }
      }
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate"]);
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-leg-1",
          candidateLegId: "cand-leg-1",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "5"
        }
      ],
      maxNettableSize: "5"
    });
    resourceLocker.acquireLocks.mockResolvedValue({ lockKeys: ["lock:combo:incoming"], ownerId: "owner-1" });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (comboId === "incoming") return incoming;
      if (comboId === "candidate") return candidate;
      return null;
    });
    vi.spyOn(engine as never, "executeNettingTransaction").mockResolvedValue({
      nettingGroupId: "group-1",
      nettedSize: new Decimal(5),
      eventsWritten: 1,
      incomingResidualLegs: [],
      exhaustedComboIds: []
    });

    await engine.attemptNet(toInput(incoming));

    expect(eligibilityService.isSafeForCrossVenueNetting).toHaveBeenCalledWith(
      "profile-a",
      "profile-b",
      { stableKey: "incoming" }
    );
    expect(resourceLocker.acquireLocks).toHaveBeenCalledTimes(1);
  });

  it("excludes non-safe cross-profile candidates before lock acquisition", async () => {
    const eligibilityService = {
      isSafeForCrossVenueNetting: vi.fn().mockResolvedValue(false)
    };
    engine = new MultiLegInternalNettingEngine(
      pool as never,
      candidateRegistry,
      compatibilityEngine as never,
      resourceLocker as never,
      logger,
      eligibilityService as never
    );

    const incoming = createCombo("incoming", "user-a", [
      {
        id: "in-leg-1",
        marketId: "m1",
        outcomeId: "o1",
        side: "buy",
        size: "10",
        remaining: "10",
        priceHint: "0.6",
        metadata: { resolution_profile_id: "profile-a" }
      }
    ]);
    const candidate = createCombo("candidate", "user-b", [
      {
        id: "cand-leg-1",
        marketId: "m1",
        outcomeId: "o1",
        side: "sell",
        size: "10",
        remaining: "10",
        priceHint: "0.55",
        metadata: { resolution_profile_id: "profile-b" }
      }
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate"]);
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-leg-1",
          candidateLegId: "cand-leg-1",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "5"
        }
      ],
      maxNettableSize: "5"
    });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (comboId === "incoming") return incoming;
      if (comboId === "candidate") return candidate;
      return null;
    });

    const result = await engine.attemptNet(toInput(incoming));

    expect(eligibilityService.isSafeForCrossVenueNetting).toHaveBeenCalledWith(
      "profile-a",
      "profile-b",
      { stableKey: "incoming" }
    );
    expect(resourceLocker.acquireLocks).not.toHaveBeenCalled();
    expect(result.nettedSize).toBe("0");
  });

  it("skips Phase 2A before transaction when degraded to DISABLE_PHASE2A_AND_2B", async () => {
    engine = new MultiLegInternalNettingEngine(
      pool as never,
      candidateRegistry,
      compatibilityEngine as never,
      resourceLocker as never,
      logger,
      undefined,
      undefined,
      undefined,
      createPerformanceGuardrailConfig({
        version: "guardrails-v1",
        maxSorPlanningLatencyMs: 100,
        maxNettingPlanningLatencyMs: 1,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 100,
        maxGraphEdges: 100,
        maxCandidateGroups: 100,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 100,
        degradationPolicyVersion: "v1"
      }),
      {
        evaluate: vi.fn(() => ({
          violated: true,
          violations: [
            {
              type: "PLANNER_LATENCY_BUDGET_EXCEEDED",
              actual: 5,
              threshold: 1,
              reason: "planner latency exceeded budget"
            }
          ],
          suggestedDegradation: "DISABLE_PHASE2A_AND_2B"
        }))
      } as never,
      {
        getEffectiveExecutionMode: vi.fn(async () => ({
          mode: "DISABLE_PHASE2A_AND_2B",
          reason: "PLANNER_LATENCY_BUDGET_EXCEEDED",
          source: "guardrail",
          violations: []
        }))
      } as never,
      {
        getReplayWriteFailures: () => 0
      },
      {
        getCurrentLockWaitMs: () => 0
      }
    );

    const incoming = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "10", remaining: "10", priceHint: "0.6" }
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate"]);
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (comboId === "incoming") {
        return incoming;
      }
      return null;
    });
    const executeSpy = vi.spyOn(engine as never, "executeNettingTransaction");

    const result = await engine.attemptNet(toInput(incoming));

    expect(result.nettedSize).toBe("0");
    expect(result.residualRemaining).toBe(true);
    expect(resourceLocker.acquireLocks).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("keeps Phase 2A observational only when guardrails are resolved in SHADOW mode", async () => {
    engine = new MultiLegInternalNettingEngine(
      pool as never,
      candidateRegistry,
      compatibilityEngine as never,
      resourceLocker as never,
      logger,
      undefined,
      undefined,
      undefined,
      createPerformanceGuardrailConfig({
        version: "guardrails-v1",
        maxSorPlanningLatencyMs: 100,
        maxNettingPlanningLatencyMs: 1,
        maxClearingPlanningLatencyMs: 100,
        maxBucketEntityCount: 100,
        maxGraphEdges: 100,
        maxCandidateGroups: 100,
        maxLockWaitMs: 100,
        maxLockHoldMs: 100,
        maxReplayWriteFailuresBeforeDegrade: 100,
        degradationPolicyVersion: "v1"
      }),
      {
        evaluate: vi.fn(() => ({
          violated: true,
          violations: [
            {
              type: "PLANNER_LATENCY_BUDGET_EXCEEDED",
              actual: 5,
              threshold: 1,
              reason: "planner latency exceeded budget"
            }
          ],
          suggestedDegradation: "DISABLE_PHASE2A_AND_2B"
        }))
      } as never,
      {
        getEffectiveExecutionMode: vi.fn(async () => ({
          mode: "DISABLE_PHASE2A_AND_2B",
          reason: "PLANNER_LATENCY_BUDGET_EXCEEDED",
          source: "guardrail",
          violations: []
        }))
      } as never,
      {
        getReplayWriteFailures: () => 0
      },
      {
        getCurrentLockWaitMs: () => 0
      },
      "netting-phase2a-main",
      "SHADOW"
    );

    const incoming = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "10", remaining: "10", priceHint: "0.6" }
    ]);
    const candidate = createCombo("candidate", "user-b", [
      { id: "cand-leg-1", marketId: "m1", outcomeId: "o1", side: "sell", size: "10", remaining: "10", priceHint: "0.55" }
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate"]);
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-leg-1",
          candidateLegId: "cand-leg-1",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "5"
        }
      ],
      maxNettableSize: "5"
    });
    resourceLocker.acquireLocks.mockResolvedValue({ lockKeys: ["lock:combo:incoming"], ownerId: "owner-1" });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (comboId === "incoming") {
        return incoming;
      }
      if (comboId === "candidate") {
        return candidate;
      }
      return null;
    });
    const executeSpy = vi.spyOn(engine as never, "executeNettingTransaction").mockResolvedValue({
      nettingGroupId: "group-1",
      nettedSize: new Decimal(5),
      eventsWritten: 1,
      incomingResidualLegs: [],
      exhaustedComboIds: []
    });

    const result = await engine.attemptNet(toInput(incoming));

    expect(result.nettedSize).toBe("5");
    expect(resourceLocker.acquireLocks).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it("treats replayed candidate attempts as no-op", async () => {
    const incoming = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "5", remaining: "5", priceHint: "0.7" }
    ]);
    const candidate = createCombo("candidate", "user-b", [
      { id: "cand-leg-1", marketId: "m1", outcomeId: "o1", side: "sell", size: "5", remaining: "5", priceHint: "0.6" }
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate"]);
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-leg-1",
          candidateLegId: "cand-leg-1",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "5"
        }
      ],
      maxNettableSize: "5"
    });
    resourceLocker.acquireLocks.mockResolvedValue({ lockKeys: ["lock:combo:incoming"], ownerId: "owner-1" });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (typeof comboId !== "string") {
        return null;
      }

      if (comboId === "incoming") {
        return incoming;
      }
      if (comboId === "candidate") {
        return candidate;
      }
      return null;
    });
    vi.spyOn(engine as never, "executeNettingTransaction").mockResolvedValue(null);

    const result = await engine.attemptNet(toInput(incoming));

    expect(result.nettedSize).toBe("0");
    expect(result.nettingGroupIds).toEqual([]);
    expect(result.eventsWritten).toBe(0);
    expect(resourceLocker.releaseLocks).toHaveBeenCalledTimes(1);
  });

  it("stops iterating when incoming residual reaches zero", async () => {
    const incoming = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "4", remaining: "4", priceHint: "0.7" }
    ]);
    const incomingSettled = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "4", remaining: "0", priceHint: "0.7" }
    ], "EXECUTED");
    const candidateOne = createCombo("candidate-1", "user-b", [
      { id: "cand-leg-1", marketId: "m1", outcomeId: "o1", side: "sell", size: "4", remaining: "4", priceHint: "0.6" }
    ]);
    const candidateTwo = createCombo("candidate-2", "user-c", [
      { id: "cand-leg-2", marketId: "m1", outcomeId: "o1", side: "sell", size: "4", remaining: "4", priceHint: "0.6" }
    ]);

    const comboStore = new Map<string, AuthoritativeComboRow>([
      ["incoming", incoming],
      ["candidate-1", candidateOne],
      ["candidate-2", candidateTwo]
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate-1", "candidate-2"]);
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-leg-1",
          candidateLegId: "cand-leg-1",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "4"
        }
      ],
      maxNettableSize: "4"
    });
    resourceLocker.acquireLocks.mockResolvedValue({ lockKeys: ["lock:combo:incoming"], ownerId: "owner-1" });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) =>
      typeof comboId === "string" ? comboStore.get(comboId) ?? null : null
    );
    vi.spyOn(engine as never, "executeNettingTransaction").mockImplementation(async () => {
      comboStore.set("incoming", incomingSettled);
      return {
        nettingGroupId: "group-1",
        nettedSize: new Decimal(4),
        eventsWritten: 1,
        incomingResidualLegs: [],
        exhaustedComboIds: ["incoming", "candidate-1"]
      };
    });

    const result = await engine.attemptNet(toInput(incoming));

    expect(result.residualRemaining).toBe(false);
    expect(result.residualLegs).toEqual([]);
    expect(compatibilityEngine.evaluate).toHaveBeenCalledTimes(1);
  });

  it("swallows Redis registry refresh failures after committed netting", async () => {
    const incoming = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "6", remaining: "6", priceHint: "0.6" }
    ]);
    const incomingAfterNet = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "6", remaining: "2", priceHint: "0.6" }
    ], "PARTIALLY_EXECUTED");
    const candidate = createCombo("candidate", "user-b", [
      { id: "cand-leg-1", marketId: "m1", outcomeId: "o1", side: "sell", size: "4", remaining: "4", priceHint: "0.55" }
    ]);

    const comboStore = new Map<string, AuthoritativeComboRow>([
      ["incoming", incoming],
      ["candidate", candidate]
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate"]);
    candidateRegistry.unregisterComboCandidate.mockRejectedValue(new Error("redis unavailable"));
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-leg-1",
          candidateLegId: "cand-leg-1",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "4"
        }
      ],
      maxNettableSize: "4"
    });
    resourceLocker.acquireLocks.mockResolvedValue({ lockKeys: ["lock:combo:incoming"], ownerId: "owner-1" });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) =>
      typeof comboId === "string" ? comboStore.get(comboId) ?? null : null
    );
    vi.spyOn(engine as never, "executeNettingTransaction").mockImplementation(async () => {
      comboStore.set("incoming", incomingAfterNet);
      return {
        nettingGroupId: "group-1",
        nettedSize: new Decimal(4),
        eventsWritten: 1,
        incomingResidualLegs: [],
        exhaustedComboIds: ["candidate"]
      };
    });

    const result = await engine.attemptNet(toInput(incoming));

    expect(result.nettedSize).toBe("4");
    expect(result.residualRemaining).toBe(true);
    expect(result.nettingGroupIds).toEqual(["group-1"]);
  });

  it("releases locks and rethrows when transaction fails", async () => {
    const incoming = createCombo("incoming", "user-a", [
      { id: "in-leg-1", marketId: "m1", outcomeId: "o1", side: "buy", size: "5", remaining: "5", priceHint: "0.7" }
    ]);
    const candidate = createCombo("candidate", "user-b", [
      { id: "cand-leg-1", marketId: "m1", outcomeId: "o1", side: "sell", size: "5", remaining: "5", priceHint: "0.6" }
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["candidate"]);
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "in-leg-1",
          candidateLegId: "cand-leg-1",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "5"
        }
      ],
      maxNettableSize: "5"
    });
    resourceLocker.acquireLocks.mockResolvedValue({ lockKeys: ["lock:combo:incoming"], ownerId: "owner-1" });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (typeof comboId !== "string") {
        return null;
      }

      if (comboId === "incoming") {
        return incoming;
      }
      if (comboId === "candidate") {
        return candidate;
      }
      return null;
    });
    vi.spyOn(engine as never, "executeNettingTransaction").mockRejectedValue(new Error("db failed"));

    await expect(engine.attemptNet(toInput(incoming))).rejects.toThrow("db failed");
    expect(resourceLocker.releaseLocks).toHaveBeenCalledTimes(1);
  });

  it("registers locks in deterministic order for same combo pair attempts", async () => {
    const incoming = createCombo("combo-b", "user-a", [
      { id: "leg-b", marketId: "m1", outcomeId: "o1", side: "buy", size: "5", remaining: "5", priceHint: "0.7" }
    ]);
    const candidate = createCombo("combo-a", "user-b", [
      { id: "leg-a", marketId: "m1", outcomeId: "o1", side: "sell", size: "5", remaining: "5", priceHint: "0.6" }
    ]);

    candidateRegistry.findCandidateCombos.mockResolvedValue(["combo-a"]);
    compatibilityEngine.evaluate.mockReturnValue({
      compatible: true,
      matchedLegPairs: [
        {
          incomingLegId: "leg-b",
          candidateLegId: "leg-a",
          marketId: "m1",
          outcomeId: "o1",
          matchedSize: "5"
        }
      ],
      maxNettableSize: "5"
    });
    resourceLocker.acquireLocks.mockResolvedValue({ lockKeys: ["lock:combo:combo-a"], ownerId: "owner-1" });
    vi.spyOn(engine as never, "loadCombo").mockImplementation(async (comboId: unknown) => {
      if (comboId === "combo-b") return incoming;
      if (comboId === "combo-a") return candidate;
      return null;
    });
    vi.spyOn(engine as never, "executeNettingTransaction").mockResolvedValue(null);

    await engine.attemptNet(toInput(incoming));

    expect(resourceLocker.acquireLocks).toHaveBeenCalledWith([
      "lock:combo-leg:leg-a",
      "lock:combo-leg:leg-b",
      "lock:combo:combo-a",
      "lock:combo:combo-b"
    ]);
  });

  it("retries safely after rollback on partial failure", async () => {
    const enginePrivate = engine as unknown as {
      registerNettingAttempt: (
        client: { query: ReturnType<typeof vi.fn> },
        attemptId: string,
        incomingComboId: string,
        matchedComboId: string
      ) => Promise<boolean>;
      registerExposureIdempotency: (
        client: { query: ReturnType<typeof vi.fn> },
        attemptId: string
      ) => Promise<boolean>;
    };

    const attemptClient = {
      query: vi.fn()
    };
    attemptClient.query
      .mockResolvedValueOnce({ rows: [{ attempt_id: "attempt-1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "11111111-1111-1111-1111-111111111111" }] });

    await expect(enginePrivate.registerNettingAttempt(attemptClient, "attempt-1", "incoming", "candidate")).resolves.toBe(true);
    await expect(enginePrivate.registerExposureIdempotency(attemptClient, "attempt-1")).resolves.toBe(true);
  });

  it("treats duplicate request replay as no-op once attempt id already exists", async () => {
    const enginePrivate = engine as unknown as {
      registerNettingAttempt: (
        client: { query: ReturnType<typeof vi.fn> },
        attemptId: string,
        incomingComboId: string,
        matchedComboId: string
      ) => Promise<boolean>;
    };
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    };

    await expect(enginePrivate.registerNettingAttempt(client, "attempt-1", "incoming", "candidate")).resolves.toBe(false);
  });

  it("builds exposure aggregates through the shared aggregation helper", () => {
    const aggregationSpy = vi.spyOn(aggregationModule, "aggregateNettingExposureDeltas");
    const enginePrivate = engine as unknown as {
      buildExposureAggregates: (
        matchedPairs: Array<{
          incomingLeg: AuthoritativeComboLegRow;
          candidateLeg: AuthoritativeComboLegRow;
          nettableSize: string;
          price: string;
        }>,
        nettableSize: InstanceType<typeof Decimal>
      ) => { userA: { maxLossDelta: string }; userB: { maxLossDelta: string } };
    };

    const result = enginePrivate.buildExposureAggregates(
      [
        {
          incomingLeg: {
            id: "in-leg-1",
            combo_rfq_id: "incoming",
            canonical_market_id: "m1",
            canonical_outcome_id: "o1",
            side: "buy",
            size: "5",
            remaining_size: "5",
            price_hint: "0.6",
            metadata: null
          },
          candidateLeg: {
            id: "cand-leg-1",
            combo_rfq_id: "candidate",
            canonical_market_id: "m1",
            canonical_outcome_id: "o1",
            side: "sell",
            size: "5",
            remaining_size: "5",
            price_hint: "0.55",
            metadata: null
          },
          nettableSize: "5",
          price: "0.55"
        }
      ],
      new Decimal(5)
    );

    expect(aggregationSpy).toHaveBeenCalledTimes(1);
    expect(result.userA.maxLossDelta).toBe("2.75");
    expect(result.userB.maxLossDelta).toBe("2.25");
  });

  it("applies grouped exposure updates and journals aggregated payloads", async () => {
    const enginePrivate = engine as unknown as {
      applyExposureAggregates: (
        client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> },
        incomingUserId: string,
        candidateUserId: string,
        aggregates: {
          userA: { maxLossDelta: string; maxGainDelta: string; perLeg: Array<Record<string, string>> };
          userB: { maxLossDelta: string; maxGainDelta: string; perLeg: Array<Record<string, string>> };
        },
        nettingGroupId: string,
        attemptId: string,
        incomingComboId: string,
        matchedComboId: string
      ) => Promise<void>;
    };
    const client = {
      query: vi.fn(),
      release: vi.fn()
    };

    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, gross_notional::text, net_notional::text")) {
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO exposure (user_id, canonical_market_id, side, gross_notional, net_notional)")) {
        const id = client.query.mock.calls.filter(([statement]) =>
          typeof statement === "string" &&
          statement.includes("INSERT INTO exposure (user_id, canonical_market_id, side, gross_notional, net_notional)")
        ).length === 1
          ? "exp-1"
          : "exp-2";
        return { rows: [{ id }] };
      }

      return { rows: [] };
    });

    await enginePrivate.applyExposureAggregates(
      client,
      "user-a",
      "user-b",
      {
        userA: {
          maxLossDelta: "4",
          maxGainDelta: "6",
          perLeg: [
            {
              legId: "in-leg-1",
              marketId: "m1",
              outcomeId: "o1",
              side: "buy",
              price: "0.4",
              matchedSize: "5",
              maxLossDelta: "2",
              maxGainDelta: "3"
            },
            {
              legId: "in-leg-2",
              marketId: "m1",
              outcomeId: "o2",
              side: "buy",
              price: "0.4",
              matchedSize: "5",
              maxLossDelta: "2",
              maxGainDelta: "3"
            }
          ]
        },
        userB: {
          maxLossDelta: "6",
          maxGainDelta: "4",
          perLeg: [
            {
              legId: "cand-leg-1",
              marketId: "m1",
              outcomeId: "o1",
              side: "sell",
              price: "0.4",
              matchedSize: "5",
              maxLossDelta: "3",
              maxGainDelta: "2"
            },
            {
              legId: "cand-leg-2",
              marketId: "m1",
              outcomeId: "o2",
              side: "sell",
              price: "0.4",
              matchedSize: "5",
              maxLossDelta: "3",
              maxGainDelta: "2"
            }
          ]
        }
      },
      "group-1",
      "attempt-1",
      "incoming-combo",
      "candidate-combo"
    );

    const insertExposureCalls = client.query.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("INSERT INTO exposure (user_id, canonical_market_id, side, gross_notional, net_notional)")
    );
    expect(insertExposureCalls).toHaveLength(2);
    expect(insertExposureCalls[0]?.[1]).toEqual(["user-a", "m1", "buy", "4", "2"]);
    expect(insertExposureCalls[1]?.[1]).toEqual(["user-b", "m1", "sell", "6", "-2"]);

    const journalCalls = client.query.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("INSERT INTO exposure_journal")
    );
    expect(journalCalls).toHaveLength(2);

    const incomingPayload = JSON.parse(String(journalCalls[0]?.[1]?.[8]));
    expect(incomingPayload).toMatchObject({
      incomingComboId: "incoming-combo",
      matchedComboId: "candidate-combo",
      attemptId: "attempt-1",
      userRole: "userA",
      marketId: "m1",
      side: "buy",
      aggregateMaxLossDelta: "4",
      aggregateMaxGainDelta: "6",
      groupedMaxLossDelta: "4",
      groupedMaxGainDelta: "6"
    });
    expect(incomingPayload.perLeg).toHaveLength(2);
  });
});
