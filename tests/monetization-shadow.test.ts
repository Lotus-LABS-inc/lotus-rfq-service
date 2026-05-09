import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
  AccountingUpdateService,
  ApprovedLaneExecutionGate,
  ExecutionFeeService,
  ExecutionPreflightService,
  ExecutionSystemOrchestrator,
  ExecutionVenueAdapterRegistry,
  FallbackPolicyService,
  GhostFillProtectionService,
  InMemoryExecutionAuditSink,
  SettlementVerificationService,
  StaticLaneAuthorityResolver,
  TestExecutionAdapter,
  getMonetizationPolicyFromEnv,
  zeroFees,
  type ExecutionLaneAuthoritySnapshot,
  type ExecutionRequestV0,
  type MonetizationPolicy
} from "../src/execution-system/index.js";
import {
  MonetizationIdempotencyConflictError,
  MonetizationRepository,
  type FeeLedgerInput
} from "../src/repositories/monetization.repository.js";

const shadowPolicy: MonetizationPolicy = getMonetizationPolicyFromEnv({
  MONETIZATION_MODE: "SHADOW",
  MONETIZATION_POLICY_VERSION: "lotus-fees-v1",
  MONETIZATION_DEFAULT_CURRENCY: "USDC",
  MONETIZATION_PRICE_IMPROVEMENT_SHARE_BPS: "3000",
  MONETIZATION_EXECUTION_FEE_BPS: "0",
  MONETIZATION_FAST_LANE_FEE_BPS: "500",
  MONETIZATION_GHOST_FILL_PROTECTION_FEE_BPS: "500",
  MONETIZATION_MAX_TOTAL_FEE_BPS: "75",
  MONETIZATION_CAPTURE_MODE: "SHADOW"
});

const shadowPlusBuilderPolicy: MonetizationPolicy = getMonetizationPolicyFromEnv({
  MONETIZATION_MODE: "SHADOW",
  MONETIZATION_POLICY_VERSION: "lotus-fees-v1",
  MONETIZATION_DEFAULT_CURRENCY: "USDC",
  MONETIZATION_PRICE_IMPROVEMENT_SHARE_BPS: "3000",
  MONETIZATION_EXECUTION_FEE_BPS: "0",
  MONETIZATION_FAST_LANE_FEE_BPS: "500",
  MONETIZATION_GHOST_FILL_PROTECTION_FEE_BPS: "500",
  MONETIZATION_MAX_TOTAL_FEE_BPS: "75",
  MONETIZATION_CAPTURE_MODE: "SHADOW_PLUS_BUILDER_FEE"
});

const lane: ExecutionLaneAuthoritySnapshot = {
  laneId: "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
  laneState: "OPERATOR_APPROVED_SANDBOX",
  topicKey: "CRYPTO|ATH_BY_DATE|BTC",
  venueSet: ["LIMITLESS", "POLYMARKET"],
  candidateSet: ["2026-05-31"],
  ruleState: "EXACT_SAFE"
};

const request = (patch: Partial<ExecutionRequestV0> = {}): ExecutionRequestV0 => ({
  executionId: "00000000-0000-0000-0000-000000000001",
  rfqId: "rfq-1",
  userId: "user-1",
  canonicalTopicKey: lane.topicKey,
  candidateId: "2026-05-31",
  side: "buy",
  size: "1000",
  selectedLaneId: lane.laneId,
  venuePath: ["POLYMARKET"],
  executionMode: "SINGLE_VENUE",
  approvedScopeHash: "scope-hash-1",
  maxSlippage: 0.01,
  fastLaneEnabled: true,
  ghostFillProtectionEnabled: true,
  expectedPrice: 1.02,
  expectedFees: zeroFees(),
  idempotencyKey: "idem-1",
  createdAt: "2026-04-28T00:00:00.000Z",
  metadata: { quoteId: "quote-1" },
  ...patch
});

const scopeBinding = {
  scopeKind: "CRYPTO_LANE" as const,
  scopeId: lane.laneId,
  topicKey: lane.topicKey,
  laneType: "SINGLE" as const,
  venueSet: lane.venueSet,
  candidateSet: lane.candidateSet,
  canonicalMarketId: "canonical-market-1"
};

const buildGate = (approvedLane: ExecutionLaneAuthoritySnapshot = lane) =>
  new ApprovedLaneExecutionGate(new StaticLaneAuthorityResolver(new Map([[approvedLane.laneId, approvedLane]])));

const buildPreflight = (
  gate: ApprovedLaneExecutionGate,
  overrides: Partial<ConstructorParameters<typeof ExecutionPreflightService>[0]> = {}
) =>
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

const buildOrchestrator = (input: {
  adapter?: TestExecutionAdapter;
  preflight?: ExecutionPreflightService;
  ledger: FeeLedgerInput[];
  policy?: MonetizationPolicy;
  polymarketBuilderCodeConfigured?: boolean;
}) => {
  const adapters = new ExecutionVenueAdapterRegistry();
  adapters.register(input.adapter ?? new TestExecutionAdapter("POLYMARKET", { fillPrice: 1 }));
  return new ExecutionSystemOrchestrator({
    preflight: input.preflight ?? buildPreflight(buildGate()),
    adapters,
    settlement: new SettlementVerificationService(adapters, { timeoutMs: 1, pollIntervalMs: 1, maxAttempts: 1 }),
    ghostFill: new GhostFillProtectionService(),
    fallback: new FallbackPolicyService(buildGate()),
    accounting: new AccountingUpdateService(),
    fees: new ExecutionFeeService({ policy: input.policy ?? shadowPolicy, futureSettlementFee: 0 }),
    monetization: {
      policy: input.policy ?? shadowPolicy,
      repository: {
        upsertPolicy: async () => "policy-1",
        createLedgerEntry: async (entry) => {
          input.ledger.push(entry);
          return `ledger-${input.ledger.length}`;
        }
      },
      ...(input.polymarketBuilderCodeConfigured !== undefined
        ? { polymarketBuilderCodeConfigured: input.polymarketBuilderCodeConfigured }
        : {})
    },
    audit: new InMemoryExecutionAuditSink(),
    now: () => new Date("2026-04-28T00:00:00.000Z")
  });
};

describe("monetization policy", () => {
  it("defaults to DISABLED", () => {
    expect(getMonetizationPolicyFromEnv({})).toMatchObject({
      mode: "DISABLED",
      policyVersion: "lotus-fees-v1",
      currency: "USDC",
      priceImprovementShareBps: 3000,
      executionFeeBps: 0,
      fastLaneFeeBps: 500,
      ghostFillProtectionFeeBps: 500,
      maxTotalFeeBps: 75,
      captureMode: "DISABLED"
    });
  });

  it("parses the agreed shadow policy", () => {
    expect(shadowPolicy).toEqual({
      mode: "SHADOW",
      policyVersion: "lotus-fees-v1",
      currency: "USDC",
      priceImprovementShareBps: 3000,
      executionFeeBps: 0,
      fastLaneFeeBps: 500,
      ghostFillProtectionFeeBps: 500,
      maxTotalFeeBps: 75,
      captureMode: "SHADOW"
    });
  });

  it("supports private beta shadow plus builder fee mode", () => {
    expect(shadowPlusBuilderPolicy).toMatchObject({
      mode: "SHADOW",
      captureMode: "SHADOW_PLUS_BUILDER_FEE"
    });
  });
});

describe("monetization fee math", () => {
  const fees = new ExecutionFeeService({ policy: shadowPolicy, futureSettlementFee: 0 });

  it("caps a $1,000 notional, $20 improvement, fast lane and ghost-fill protected fee at $7.50", () => {
    const summary = fees.realized({ request: request(), realizedPrice: 1 });
    expect(summary.priceImprovementFee).toBeCloseTo(6, 10);
    expect(summary.fastLaneFee).toBeCloseTo(1, 10);
    expect(summary.ghostFillProtectionFee).toBeCloseTo(1, 10);
    expect(summary.executionFee).toBe(0);
    expect(summary.totalLotusFee).toBe(7.5);
    expect(summary.notionalCap).toBe(7.5);
    expect(summary.capApplied).toBe(true);
  });

  it("calculates $4.00 on $1,000 notional with $10 improvement", () => {
    const summary = fees.realized({ request: request({ expectedPrice: 1.01 }), realizedPrice: 1 });
    expect(summary.totalLotusFee).toBeCloseTo(4, 10);
    expect(summary.capApplied).toBe(false);
  });

  it("charges zero price-improvement fee when there is no positive improvement", () => {
    const summary = fees.realized({ request: request({ expectedPrice: 0.99 }), realizedPrice: 1 });
    expect(summary.priceImprovementFee).toBe(0);
    expect(summary.totalLotusFee).toBe(0);
  });

  it("keeps the base execution fee at zero and always enforces the 75 bps notional cap", () => {
    const summary = fees.realized({ request: request({ expectedPrice: 2 }), realizedPrice: 1 });
    expect(summary.executionFee).toBe(0);
    expect(summary.totalLotusFee).toBe(7.5);
    expect(summary.totalLotusFee).toBeLessThanOrEqual(summary.notionalCap ?? Number.POSITIVE_INFINITY);
  });
});

describe("monetization shadow ledger writes", () => {
  it("writes SHADOW_ONLY only after settlement verification", async () => {
    const ledger: FeeLedgerInput[] = [];
    const output = await buildOrchestrator({ ledger }).execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("COMPLETED");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      status: "SHADOW_ONLY",
      revenueSource: "SHADOW_PRICE_IMPROVEMENT",
      settlementStatus: "SETTLEMENT_VERIFIED",
      feePolicyVersion: "lotus-fees-v1",
      quoteId: "quote-1"
    });
  });

  it("fails closed when builder-fee mode requires Polymarket builderCode and it is missing", async () => {
    const ledger: FeeLedgerInput[] = [];
    const output = await buildOrchestrator({
      ledger,
      policy: shadowPlusBuilderPolicy,
      polymarketBuilderCodeConfigured: false
    }).execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(ledger).toHaveLength(0);
  });

  it("counts Polymarket builder fees only when settlement evidence confirms the amount", async () => {
    const ledger: FeeLedgerInput[] = [];
    const output = await buildOrchestrator({
      ledger,
      policy: shadowPlusBuilderPolicy,
      polymarketBuilderCodeConfigured: true,
      adapter: new TestExecutionAdapter("POLYMARKET", {
        fillPrice: 1,
        settlementEvidence: { builderFeeAmount: "0.25" }
      })
    }).execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("COMPLETED");
    expect(ledger.map((entry) => entry.status)).toEqual(["SHADOW_ONLY", "COLLECTED_BUILDER_FEE"]);
    expect(ledger[1]).toMatchObject({
      revenueSource: "POLYMARKET_BUILDER_FEE",
      actualBuilderFeeCollected: "0.25000000"
    });
    expect(output.result.fees.actualBuilderFeesCollected).toBe(0.25);
    expect(output.result.receipt?.fees.userFeeDisclosureLabel).toBe("Lotus builder fee collected by venue where supported.");
  });

  it("does not count builder fees as collected when venue evidence lacks builder fee amount or rate", async () => {
    const ledger: FeeLedgerInput[] = [];
    const output = await buildOrchestrator({
      ledger,
      policy: shadowPlusBuilderPolicy,
      polymarketBuilderCodeConfigured: true
    }).execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("COMPLETED");
    expect(ledger.map((entry) => entry.status)).toEqual(["SHADOW_ONLY"]);
    expect(output.result.fees.actualBuilderFeesCollected).toBe(0);
    expect(output.result.receipt?.fees.userFeeDisclosureLabel).toBe("Estimated Lotus improvement share, not collected.");
  });

  it("keeps non-builder venue routes shadow-only", async () => {
    const ledger: FeeLedgerInput[] = [];
    const output = await buildOrchestrator({
      ledger,
      policy: shadowPlusBuilderPolicy,
      polymarketBuilderCodeConfigured: false,
      adapter: new TestExecutionAdapter("LIMITLESS", { fillPrice: 1 })
    }).execute(request({
      venuePath: ["LIMITLESS"],
      executionMode: "SINGLE_VENUE"
    }), { scopeBinding });
    expect(output.result.finalState).toBe("COMPLETED");
    expect(ledger.map((entry) => entry.status)).toEqual(["SHADOW_ONLY"]);
    expect(ledger[0]?.revenueSource).toBe("SHADOW_PRICE_IMPROVEMENT");
  });

  it("does not write a realized fee when preflight fails", async () => {
    const ledger: FeeLedgerInput[] = [];
    const output = await buildOrchestrator({
      ledger,
      preflight: buildPreflight(buildGate(), { funding: { hasFunding: async () => false } })
    }).execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(ledger).toHaveLength(0);
  });

  it("does not write a realized fee while a partial fill is pending", async () => {
    const ledger: FeeLedgerInput[] = [];
    const output = await buildOrchestrator({
      ledger,
      adapter: new TestExecutionAdapter("POLYMARKET", { fillStatus: "PARTIAL_FILL" })
    }).execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("PARTIAL_FILL");
    expect(ledger).toHaveLength(0);
  });

  it("does not write a realized fee for suspected ghost fills", async () => {
    const ledger: FeeLedgerInput[] = [];
    const output = await buildOrchestrator({
      ledger,
      adapter: new TestExecutionAdapter("POLYMARKET", {
        settlementStatus: "SETTLEMENT_PENDING",
        offchainFilled: true
      })
    }).execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(output.result.ghostFillStatus).toBe("SUSPECTED");
    expect(ledger).toHaveLength(0);
  });

  it("does not write a realized fee for confirmed ghost fills", async () => {
    const ledger: FeeLedgerInput[] = [];
    const output = await buildOrchestrator({
      ledger,
      adapter: new TestExecutionAdapter("POLYMARKET", {
        settlementStatus: "GHOST_FILL_CONFIRMED"
      })
    }).execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(output.result.ghostFillStatus).toBe("CONFIRMED");
    expect(ledger).toHaveLength(0);
  });
});

describe("monetization repository idempotency", () => {
  it("reuses a ledger idempotency key when the amount matches", async () => {
    const repository = new MonetizationRepository({
      query: async (sql: string) => {
        if (sql.includes("SELECT id, amount")) {
          return { rows: [{ id: "ledger-1", amount: "7.50000000" }] };
        }
        throw new Error("insert should not be called");
      }
    } as never);
    await expect(repository.createLedgerEntry({
      idempotencyKey: "same-key",
      executionId: "00000000-0000-0000-0000-000000000001",
      rfqId: "rfq-1",
      quoteId: "quote-1",
      userId: "user-1",
      feePolicyVersion: "lotus-fees-v1",
      feeType: "LOTUS_TOTAL",
      status: "REALIZED_SHADOW",
      amount: "7.5",
      currency: "USDC"
    })).resolves.toBe("ledger-1");
  });

  it("fails closed when a ledger idempotency key is reused with a different amount", async () => {
    const repository = new MonetizationRepository({
      query: async (sql: string) => {
        if (sql.includes("SELECT id, amount")) {
          return { rows: [{ id: "ledger-1", amount: "7.5" }] };
        }
        throw new Error("insert should not be called");
      }
    } as never);
    await expect(repository.createLedgerEntry({
      idempotencyKey: "same-key",
      executionId: "00000000-0000-0000-0000-000000000001",
      rfqId: "rfq-1",
      quoteId: "quote-1",
      userId: "user-1",
      feePolicyVersion: "lotus-fees-v1",
      feeType: "LOTUS_TOTAL",
      status: "REALIZED_SHADOW",
      amount: "7.49",
      currency: "USDC"
    })).rejects.toBeInstanceOf(MonetizationIdempotencyConflictError);
  });
});

describe("monetization shadow report safety", () => {
  it("keeps report artifacts limited to safe shadow fee data", async () => {
    const source = await readFile("scripts/reports/report-monetization-shadow.ts", "utf8");
    expect(source).toContain("No API keys, private keys, auth headers, wallet secrets");
    expect(source).toContain("noSettlementDeduction");
    expect(source).toContain("noWalletMovement");
    expect([...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]).sort()).toEqual([
      "ADMIN_API_BASE_URL",
      "ADMIN_SMOKE_BASE_URL",
      "ADMIN_SMOKE_EMAIL",
      "ADMIN_SMOKE_JWT",
      "ADMIN_SMOKE_LOGIN_KEY",
      "DATABASE_URL",
      "LOTUS_BACKEND_URL",
      "REPORT_DB_CONNECT_TIMEOUT_MS",
      "SUPABASE_DB_URL",
      "TEST_DATABASE_URL"
    ]);
  });
});
