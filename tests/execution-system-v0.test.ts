import { describe, expect, it } from "vitest";

import type { ExecutionScopeBinding } from "../src/execution-control/execution-scope-token.js";
import {
  AccountingUpdateService,
  ApprovedLaneExecutionGate,
  ExecutionFeeService,
  ExecutionPreflightService,
  ExecutionStateMachineV0,
  ExecutionStateTransitionError,
  ExecutionSystemOrchestrator,
  ExecutionVenueAdapterRegistry,
  FallbackPolicyService,
  GhostFillProtectionService,
  InMemoryExecutionAuditSink,
  SettlementVerificationService,
  StaticLaneAuthorityResolver,
  TestExecutionAdapter,
  validateExecutionRequest,
  zeroFees,
  type ExecutionLaneAuthoritySnapshot,
  type ExecutionRequestV0
} from "../src/execution-system/index.js";

const approvedLane: ExecutionLaneAuthoritySnapshot = {
  laneId: "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
  laneState: "OPERATOR_APPROVED_SANDBOX",
  topicKey: "CRYPTO|ATH_BY_DATE|BTC",
  venueSet: ["LIMITLESS", "POLYMARKET"],
  candidateSet: ["2026-05-31", "2026-06-30"],
  ruleState: "EXACT_SAFE"
};

const limitedProdLane: ExecutionLaneAuthoritySnapshot = {
  ...approvedLane,
  laneId: "CRYPTO_BTC_ATH_BY_DATE_SINGLE_POLYMARKET",
  laneState: "OPERATOR_APPROVED_LIMITED_PROD",
  venueSet: ["POLYMARKET"]
};

const scopeBinding: ExecutionScopeBinding = {
  scopeKind: "CRYPTO_LANE",
  scopeId: approvedLane.laneId,
  topicKey: approvedLane.topicKey,
  laneType: "PAIR",
  venueSet: approvedLane.venueSet,
  candidateSet: approvedLane.candidateSet,
  canonicalMarketId: "canonical-market-1"
};

const request = (patch: Partial<ExecutionRequestV0> = {}): ExecutionRequestV0 => ({
  executionId: "execution-1",
  rfqId: "rfq-1",
  userId: "user-1",
  canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC",
  candidateId: "2026-05-31",
  side: "buy",
  size: "1",
  selectedLaneId: approvedLane.laneId,
  venuePath: ["LIMITLESS", "POLYMARKET"],
  executionMode: "PAIR",
  approvedScopeHash: "scope-hash-1",
  maxSlippage: 0.01,
  fastLaneEnabled: false,
  ghostFillProtectionEnabled: true,
  expectedPrice: 0.5,
  expectedFees: zeroFees(),
  idempotencyKey: "idem-1",
  createdAt: "2026-04-24T00:00:00.000Z",
  executionScopeToken: "token-1",
  ...patch
});

const buildGate = (lanes: readonly ExecutionLaneAuthoritySnapshot[]) =>
  new ApprovedLaneExecutionGate(new StaticLaneAuthorityResolver(new Map(lanes.map((lane) => [lane.laneId, lane]))));

const buildPreflight = (gate: ApprovedLaneExecutionGate, overrides: Partial<ConstructorParameters<typeof ExecutionPreflightService>[0]> = {}) =>
  new ExecutionPreflightService({
    laneGate: gate,
    venueHealth: { isVenueHealthy: async () => true },
    marketState: {
      isMarketOpen: async () => true,
      isOutcomePresent: async () => true
    },
    liquidity: { hasLiquidity: async () => true },
    funding: { hasFunding: async () => true },
    idempotency: { isAlreadyCompleted: async () => false },
    price: { isWithinSlippage: async () => true },
    ...overrides
  });

describe("Execution System v0 domain", () => {
  it("validates execution requests and rejects requests without outcome or candidate", () => {
    expect(validateExecutionRequest(request()).executionId).toBe("execution-1");
    expect(() => validateExecutionRequest({
      ...request(),
      candidateId: undefined,
      canonicalOutcomeId: undefined
    })).toThrow();
  });

  it("enforces deterministic v0 state transitions", () => {
    const machine = new ExecutionStateMachineV0();
    machine.transitionTo("PREFLIGHT_CHECKING");
    machine.transitionTo("READY_TO_SUBMIT");
    expect(() => machine.transitionTo("COMPLETED")).toThrow(ExecutionStateTransitionError);
  });
});

describe("Approved lane enforcement", () => {
  it("allows sandbox and limited-prod operator-approved lanes", async () => {
    const gate = buildGate([approvedLane, limitedProdLane]);
    await expect(gate.evaluate({ request: request(), scopeBinding })).resolves.toMatchObject({ ok: true });
    await expect(gate.evaluate({
      request: request({
        selectedLaneId: limitedProdLane.laneId,
        venuePath: ["POLYMARKET"],
        executionMode: "SINGLE_VENUE"
      }),
      scopeBinding: { ...scopeBinding, scopeId: limitedProdLane.laneId, venueSet: ["POLYMARKET"] }
    })).resolves.toMatchObject({ ok: true });
  });

  it("blocks matcher-ready, review-required, held, rejected, scope mismatch, and missing token lanes", async () => {
    const gate = buildGate([
      { ...approvedLane, laneId: "matcher", laneState: "MATCHER_READY" },
      { ...approvedLane, laneId: "review", laneState: "OPERATOR_REVIEW_REQUIRED" },
      { ...approvedLane, laneId: "held", held: true },
      { ...approvedLane, laneId: "rejected", rejected: true },
      approvedLane
    ]);

    await expect(gate.evaluate({ request: request({ selectedLaneId: "matcher" }), scopeBinding: { ...scopeBinding, scopeId: "matcher" } }))
      .resolves.toMatchObject({ ok: false, code: "LANE_NOT_OPERATOR_APPROVED" });
    await expect(gate.evaluate({ request: request({ selectedLaneId: "review" }), scopeBinding: { ...scopeBinding, scopeId: "review" } }))
      .resolves.toMatchObject({ ok: false, code: "LANE_NOT_OPERATOR_APPROVED" });
    await expect(gate.evaluate({ request: request({ selectedLaneId: "held" }), scopeBinding: { ...scopeBinding, scopeId: "held" } }))
      .resolves.toMatchObject({ ok: false, code: "LANE_HELD_OR_REVOKED" });
    await expect(gate.evaluate({ request: request({ selectedLaneId: "rejected" }), scopeBinding: { ...scopeBinding, scopeId: "rejected" } }))
      .resolves.toMatchObject({ ok: false, code: "LANE_HELD_OR_REVOKED" });
    await expect(gate.evaluate({ request: request({ candidateId: "2026-07-31" }), scopeBinding }))
      .resolves.toMatchObject({ ok: false, code: "CANDIDATE_SCOPE_MISMATCH" });
    await expect(gate.evaluate({ request: request(), scopeBinding: null }))
      .resolves.toMatchObject({ ok: false, code: "SCOPE_TOKEN_REQUIRED" });
  });
});

describe("Preflight validation", () => {
  it("fails deterministically on major preflight checks", async () => {
    const gate = buildGate([approvedLane]);
    await expect(buildPreflight(gate, { venueHealth: { isVenueHealthy: async () => false } }).evaluate({ request: request(), scopeBinding }))
      .resolves.toMatchObject({ ok: false, code: "VENUE_PAUSED" });
    await expect(buildPreflight(gate, { marketState: { isMarketOpen: async () => false, isOutcomePresent: async () => true } }).evaluate({ request: request(), scopeBinding }))
      .resolves.toMatchObject({ ok: false, code: "MARKET_CLOSED" });
    await expect(buildPreflight(gate, { marketState: { isMarketOpen: async () => true, isOutcomePresent: async () => false } }).evaluate({ request: request(), scopeBinding }))
      .resolves.toMatchObject({ ok: false, code: "OUTCOME_NOT_PRESENT" });
    await expect(buildPreflight(gate, { price: { isWithinSlippage: async () => false } }).evaluate({ request: request(), scopeBinding }))
      .resolves.toMatchObject({ ok: false, code: "PRICE_OUTSIDE_SLIPPAGE" });
    await expect(buildPreflight(gate, { liquidity: { hasLiquidity: async () => false } }).evaluate({ request: request(), scopeBinding }))
      .resolves.toMatchObject({ ok: false, code: "LIQUIDITY_UNAVAILABLE" });
    await expect(buildPreflight(gate, { funding: { hasFunding: async () => false } }).evaluate({ request: request(), scopeBinding }))
      .resolves.toMatchObject({ ok: false, code: "FUNDING_UNAVAILABLE" });
    await expect(buildPreflight(gate, { idempotency: { isAlreadyCompleted: async () => true } }).evaluate({ request: request(), scopeBinding }))
      .resolves.toMatchObject({ ok: false, code: "IDEMPOTENCY_ALREADY_COMPLETED" });
  });
});

describe("Venue adapter, settlement, ghost-fill, fallback, accounting, and fees", () => {
  it("runs a settlement-verified multi-leg execution and emits receipt/audit state", async () => {
    const gate = buildGate([approvedLane]);
    const adapters = new ExecutionVenueAdapterRegistry();
    adapters.register(new TestExecutionAdapter("LIMITLESS"));
    adapters.register(new TestExecutionAdapter("POLYMARKET"));
    const audit = new InMemoryExecutionAuditSink();
    const orchestrator = new ExecutionSystemOrchestrator({
      preflight: buildPreflight(gate),
      adapters,
      settlement: new SettlementVerificationService(adapters, { timeoutMs: 10, pollIntervalMs: 1, maxAttempts: 1 }),
      ghostFill: new GhostFillProtectionService(),
      fallback: new FallbackPolicyService(gate),
      accounting: new AccountingUpdateService(),
      fees: new ExecutionFeeService({ priceImprovementShare: 0.5, fastLaneFee: 1, ghostFillProtectionFee: 2, futureSettlementFee: 0 }),
      audit,
      now: () => new Date("2026-04-24T00:00:00.000Z")
    });

    const output = await orchestrator.execute(request({ fastLaneEnabled: true }), { scopeBinding });
    expect(output.result.finalState).toBe("COMPLETED");
    expect(output.result.receipt).toBeDefined();
    expect(output.result.venueBreakdown).toHaveLength(2);
    expect(output.metadata.executionId).toBe("execution-1");
    expect(output.metadata.rfqId).toBe("rfq-1");
    expect(output.metadata.userId).toBe("user-1");
    expect(output.metadata.canonicalTopicKey).toBe("CRYPTO|ATH_BY_DATE|BTC");
    expect(output.metadata.candidateId).toBe("2026-05-31");
    expect(output.metadata.side).toBe("buy");
    expect(output.metadata.size).toBe("1");
    expect(output.metadata.selectedLaneId).toBe(approvedLane.laneId);
    expect(output.metadata.venuePath).toEqual(["LIMITLESS", "POLYMARKET"]);
    expect(output.metadata.executionMode).toBe("PAIR");
    expect(output.metadata.executionState).toBe("COMPLETED");
    expect(output.metadata.settlementState).toBe("SETTLEMENT_VERIFIED");
    expect(output.metadata.ghostFillState).toBe("CLEAR");
    expect(output.metadata.fallbackState).toBe("NOT_USED");
    expect(output.metadata.auditEventIds.length).toBeGreaterThan(0);
    expect(audit.events.map((event) => event.eventType)).toContain("SETTLEMENT_VERIFIED");
    expect(audit.events.map((event) => event.eventType)).toContain("USER_RECEIPT_EMITTED");
  });

  it("keeps partial fills pending without final accounting or receipt", async () => {
    const lane = { ...approvedLane, venueSet: ["POLYMARKET"] };
    const gate = buildGate([lane]);
    const adapters = new ExecutionVenueAdapterRegistry();
    adapters.register(new TestExecutionAdapter("POLYMARKET", { fillStatus: "PARTIAL_FILL" }));
    const audit = new InMemoryExecutionAuditSink();
    const orchestrator = new ExecutionSystemOrchestrator({
      preflight: buildPreflight(gate),
      adapters,
      settlement: new SettlementVerificationService(adapters, { timeoutMs: 10, pollIntervalMs: 1, maxAttempts: 1 }),
      ghostFill: new GhostFillProtectionService(),
      fallback: new FallbackPolicyService(gate),
      accounting: new AccountingUpdateService(),
      fees: new ExecutionFeeService(),
      audit
    });

    const output = await orchestrator.execute(
      request({ selectedLaneId: lane.laneId, venuePath: ["POLYMARKET"], executionMode: "SINGLE_VENUE" }),
      { scopeBinding: { ...scopeBinding, venueSet: ["POLYMARKET"] } }
    );
    expect(output.result.finalState).toBe("PARTIAL_FILL");
    expect(output.result.receipt).toBeUndefined();
    expect(audit.events.map((event) => event.eventType)).toContain("PARTIAL_FILL_RECEIVED");
    expect(audit.events.map((event) => event.eventType)).not.toContain("ACCOUNTING_UPDATED");
  });

  it("fails closed before adapter submission when preflight fails", async () => {
    const gate = buildGate([approvedLane]);
    const adapters = new ExecutionVenueAdapterRegistry();
    adapters.register(new TestExecutionAdapter("LIMITLESS"));
    adapters.register(new TestExecutionAdapter("POLYMARKET"));
    const orchestrator = new ExecutionSystemOrchestrator({
      preflight: buildPreflight(gate, { funding: { hasFunding: async () => false } }),
      adapters,
      settlement: new SettlementVerificationService(adapters),
      ghostFill: new GhostFillProtectionService(),
      fallback: new FallbackPolicyService(gate),
      accounting: new AccountingUpdateService(),
      fees: new ExecutionFeeService(),
      audit: new InMemoryExecutionAuditSink()
    });

    const output = await orchestrator.execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(output.result.filledSize).toBe("0");
  });

  it("fails closed on not-configured live venue adapters instead of faking execution", async () => {
    const gate = buildGate([approvedLane]);
    const adapters = new ExecutionVenueAdapterRegistry();
    const orchestrator = new ExecutionSystemOrchestrator({
      preflight: buildPreflight(gate),
      adapters,
      settlement: new SettlementVerificationService(adapters),
      ghostFill: new GhostFillProtectionService(),
      fallback: new FallbackPolicyService(gate),
      accounting: new AccountingUpdateService(),
      fees: new ExecutionFeeService(),
      audit: new InMemoryExecutionAuditSink()
    });

    const output = await orchestrator.execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(output.metadata.legs[0]?.errorCode).toBe("VENUE_EXECUTION_NOT_CONFIGURED");
  });

  it("classifies Polymarket off-chain fills without finality as ghost-fill suspected and fails closed without fallback", async () => {
    const lane = { ...approvedLane, venueSet: ["POLYMARKET"] };
    const gate = buildGate([lane]);
    const adapters = new ExecutionVenueAdapterRegistry();
    adapters.register(new TestExecutionAdapter("POLYMARKET", {
      settlementStatus: "SETTLEMENT_PENDING",
      offchainFilled: true
    }));
    const audit = new InMemoryExecutionAuditSink();
    const orchestrator = new ExecutionSystemOrchestrator({
      preflight: buildPreflight(gate),
      adapters,
      settlement: new SettlementVerificationService(adapters, { timeoutMs: 1, pollIntervalMs: 1, maxAttempts: 1 }),
      ghostFill: new GhostFillProtectionService(),
      fallback: new FallbackPolicyService(gate),
      accounting: new AccountingUpdateService(),
      fees: new ExecutionFeeService(),
      audit
    });

    const output = await orchestrator.execute(
      request({ selectedLaneId: lane.laneId, venuePath: ["POLYMARKET"], executionMode: "SINGLE_VENUE" }),
      { scopeBinding: { ...scopeBinding, venueSet: ["POLYMARKET"] } }
    );
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(output.result.ghostFillStatus).toBe("SUSPECTED");
    expect(audit.events.map((event) => event.eventType)).toContain("GHOST_FILL_SUSPECTED");
  });

  it("records approved fallback reroute state when ghost-fill protection has an approved fallback", async () => {
    const lane = { ...approvedLane, venueSet: ["POLYMARKET"] };
    const fallbackLane = { ...lane, laneId: "fallback-lane" };
    const gate = buildGate([lane, fallbackLane]);
    const adapters = new ExecutionVenueAdapterRegistry();
    adapters.register(new TestExecutionAdapter("POLYMARKET", {
      settlementStatus: "SETTLEMENT_PENDING",
      offchainFilled: true
    }));
    const audit = new InMemoryExecutionAuditSink();
    const orchestrator = new ExecutionSystemOrchestrator({
      preflight: buildPreflight(gate),
      adapters,
      settlement: new SettlementVerificationService(adapters, { timeoutMs: 1, pollIntervalMs: 1, maxAttempts: 1 }),
      ghostFill: new GhostFillProtectionService(),
      fallback: new FallbackPolicyService(gate),
      accounting: new AccountingUpdateService(),
      fees: new ExecutionFeeService(),
      audit
    });

    const output = await orchestrator.execute(
      request({
        selectedLaneId: lane.laneId,
        venuePath: ["POLYMARKET"],
        executionMode: "SINGLE_VENUE",
        fallbackLaneId: fallbackLane.laneId
      }),
      { scopeBinding: { ...scopeBinding, venueSet: ["POLYMARKET"] } }
    );
    expect(output.result.fallbackUsed).toBe(true);
    expect(output.metadata.fallbackState).toBe("REROUTED");
    expect(audit.events.map((event) => event.eventType)).toContain("REROUTE_COMPLETED");
  });

  it("keeps accounting venue-native and only builds updates for verified settlement", () => {
    const accounting = new AccountingUpdateService();
    const update = accounting.buildPostSettlementUpdate({
      executionId: "execution-1",
      userId: "user-1",
      canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC",
      candidateId: "2026-05-31",
      side: "buy",
      fees: zeroFees(),
      legs: [
        {
          executionLegId: "leg-1",
          parentExecutionId: "execution-1",
          venue: "POLYMARKET",
          venueMarketId: "market-1",
          venueOutcomeId: "outcome-1",
          side: "buy",
          size: "1",
          price: 0.5,
          status: "SETTLEMENT_VERIFIED",
          settlementStatus: "SETTLEMENT_VERIFIED"
        },
        {
          executionLegId: "leg-2",
          parentExecutionId: "execution-1",
          venue: "LIMITLESS",
          venueMarketId: "market-2",
          venueOutcomeId: "outcome-2",
          side: "buy",
          size: "1",
          price: 0.5,
          status: "FILLED_PENDING_SETTLEMENT",
          settlementStatus: "SETTLEMENT_PENDING"
        }
      ]
    });
    expect(update.records).toHaveLength(1);
    expect(update.positions.some((position) => position.venue === "UNIFIED_DISPLAY" && position.displayOnly)).toBe(true);
  });
});
