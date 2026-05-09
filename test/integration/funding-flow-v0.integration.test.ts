import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FundingReadinessAdminService } from "../../src/api/admin/funding-readiness-admin-service.js";
import { registerAdminFundingReadinessRoutes } from "../../src/api/admin/funding-readiness.routes.js";
import { registerFundingRoutes } from "../../src/api/routes/funding.js";
import { registerUserWithdrawalWalletRoutes } from "../../src/api/routes/user-withdrawal-wallets.js";
import { createAdminAuthMiddleware, createUserAuthMiddleware } from "../../src/api/user-auth-middleware.js";
import {
  FundingReadinessChecker,
  FundingService,
  type WithdrawalCompletionEvidenceChecker,
  type WithdrawalCompletionEvidenceResult
} from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote } from "../../src/core/funding/types.js";
import {
  ConfigurableVenueFundingReadinessChecker,
  PolymarketFundingReadinessChecker,
  type FundingBalanceReadClient,
  type PolymarketFundingBalanceReadClient
} from "../../src/core/funding/venue-readiness.js";
import {
  PredictFunWithdrawalAdapter,
  getPredictFunWithdrawalConfigFromEnv
} from "../../src/core/funding/predictfun-withdrawal-adapter.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";
import { UserWithdrawalWalletRepository } from "../../src/repositories/user-withdrawal-wallet.repository.js";
import {
  ApprovedLaneExecutionGate,
  ExecutionPreflightService,
  StaticLaneAuthorityResolver,
  type ExecutionLaneAuthoritySnapshot,
  type ExecutionRequestV0,
  zeroFees
} from "../../src/execution-system/index.js";
import type { ExecutionScopeBinding } from "../../src/execution-control/execution-scope-token.js";

loadDotenv({
  path: path.resolve(process.cwd(), ".env"),
  override: true
});

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);
const fundingEnv = {
  POLYMARKET_FUNDING_DESTINATION_ADDRESS: "0x1111111111111111111111111111111111111111",
  PREDICT_FUN_FUNDING_DESTINATION_ADDRESS: "0x6666666666666666666666666666666666666666"
} as NodeJS.ProcessEnv;
const withdrawalEnv = {
  ...fundingEnv,
  POLYMARKET_FUNDING_WITHDRAWALS_ENABLED: "true",
  PREDICT_FUN_FUNDING_WITHDRAWALS_ENABLED: "true"
} as NodeJS.ProcessEnv;

class MockLifiProvider implements LifiRouteProvider {
  public nextStatus: Awaited<ReturnType<LifiRouteProvider["status"]>> = {
    status: "DONE_COMPLETED",
    raw: { status: "DONE", substatus: "COMPLETED" }
  };

  public async quote(input: Parameters<LifiRouteProvider["quote"]>[0]): Promise<FundingRouteQuote> {
    return {
      provider: "LIFI",
      providerRouteId: "mock-route-1",
      sourceChain: input.fromChain,
      sourceToken: input.fromToken,
      sourceAmount: input.fromAmount,
      destinationChain: input.toChain,
      destinationToken: input.toToken,
      destinationAmountEstimate: input.fromAmount,
      estimatedFees: "0.25",
      estimatedTimeSeconds: 120,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      transactionRequest: {
        to: "0x2222222222222222222222222222222222222222",
        data: "0x1234",
        chainId: Number(input.toChain)
      },
      userSafeSummary: "Mock LI.FI route"
    };
  }

  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    return this.nextStatus;
  }
}

class MockPolymarketBalanceReadClient implements PolymarketFundingBalanceReadClient {
  public usableBalance = "0";

  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    return { usableBalance: this.usableBalance, raw: { source: "db-integration-test" } };
  }
}

class MockGenericBalanceReadClient implements FundingBalanceReadClient {
  public usableBalance = "0";

  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    return { usableBalance: this.usableBalance, raw: { source: "db-integration-test" } };
  }
}

class MockWithdrawalCompletionChecker implements WithdrawalCompletionEvidenceChecker {
  public result: WithdrawalCompletionEvidenceResult = {
    status: "UNKNOWN",
    venueReleased: false,
    destinationReceived: false,
    completed: false,
    reason: "MOCK_UNKNOWN",
    evidence: { source: "db-integration-test" }
  };

  public async check(): Promise<WithdrawalCompletionEvidenceResult> {
    return this.result;
  }
}

const lane: ExecutionLaneAuthoritySnapshot = {
  laneId: "CRYPTO_BTC_ATH_BY_DATE_SINGLE_POLYMARKET",
  laneState: "OPERATOR_APPROVED_SANDBOX",
  topicKey: "CRYPTO|ATH_BY_DATE|BTC",
  venueSet: ["POLYMARKET"],
  candidateSet: ["2026-05-31"],
  ruleState: "EXACT_SAFE"
};

const scopeBinding: ExecutionScopeBinding = {
  scopeKind: "CRYPTO_LANE",
  scopeId: lane.laneId,
  topicKey: lane.topicKey,
  laneType: "SINGLE",
  venueSet: lane.venueSet,
  candidateSet: lane.candidateSet,
  canonicalMarketId: "canonical-market-1"
};

const executionRequest = (userId: string, overrides: Partial<ExecutionRequestV0> = {}): ExecutionRequestV0 => ({
  executionId: `execution-${randomUUID()}`,
  rfqId: `rfq-${randomUUID()}`,
  userId,
  canonicalTopicKey: lane.topicKey,
  candidateId: "2026-05-31",
  side: "buy",
  size: "10",
  selectedLaneId: lane.laneId,
  venuePath: ["POLYMARKET"],
  executionMode: "SINGLE_VENUE",
  approvedScopeHash: "scope-hash",
  maxSlippage: 0.01,
  fastLaneEnabled: false,
  ghostFillProtectionEnabled: true,
  expectedPrice: 0.5,
  expectedFees: zeroFees(),
  idempotencyKey: `funding-preflight-${randomUUID()}`,
  createdAt: new Date().toISOString(),
  ...overrides
});

const buildPreflight = (checker: FundingReadinessChecker): ExecutionPreflightService =>
  new ExecutionPreflightService({
    laneGate: new ApprovedLaneExecutionGate(new StaticLaneAuthorityResolver(new Map([[lane.laneId, lane]]))),
    venueHealth: { isVenueHealthy: async () => true },
    marketState: {
      isMarketOpen: async () => true,
      isOutcomePresent: async () => true
    },
    liquidity: { hasLiquidity: async () => true },
    funding: checker,
    idempotency: { isAlreadyCompleted: async () => false },
    price: { isWithinSlippage: async () => true }
  });

const buildAdminFundingReadinessApp = async (repository: FundingRepository) => {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret" });
  await registerAdminFundingReadinessRoutes(app, createAdminAuthMiddleware(), {
    fundingReadinessAdminService: new FundingReadinessAdminService({
      repository,
      env: {
        FUNDING_VENUE_READINESS_CHECKS_ENABLED: "false",
        POLYMARKET_FUNDING_READINESS_ENABLED: "false",
        LIFI_API_KEY: "server-side-secret"
      }
    })
  });
  return app;
};

const buildUserFundingApp = async (fundingService: FundingService) => {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret" });
  await registerFundingRoutes(app, createUserAuthMiddleware(), {
    createIntent: (userId, request) => fundingService.createIntent(userId, request),
    getIntent: (userId, fundingIntentId) => fundingService.getIntent(userId, fundingIntentId),
    quoteIntent: (userId, fundingIntentId) => fundingService.quoteIntent(userId, fundingIntentId),
    submitRouteLeg: (userId, fundingIntentId, request) => fundingService.submitRouteLeg(userId, fundingIntentId, request),
    refreshIntentStatus: (userId, fundingIntentId) => fundingService.refreshIntentStatus(userId, fundingIntentId),
    listVenueCapabilities: async () => fundingService.listVenueCapabilities(),
    listVenueBalances: (userId) => fundingService.listVenueBalances(userId),
    listVenueActivations: async () => [],
    listFundingHistory: (userId, input) => fundingService.listFundingHistory(userId, input),
    createWithdrawalIntent: (userId, request) => fundingService.createWithdrawalIntent(userId, request),
    getWithdrawalIntent: (userId, withdrawalIntentId) => fundingService.getWithdrawalIntent(userId, withdrawalIntentId),
    quoteWithdrawalIntent: (userId, withdrawalIntentId) => fundingService.quoteWithdrawalIntent(userId, withdrawalIntentId),
    submitWithdrawalRouteLeg: (userId, withdrawalIntentId, request) =>
      fundingService.submitWithdrawalRouteLeg(userId, withdrawalIntentId, request),
    refreshWithdrawalStatus: (userId, withdrawalIntentId) => fundingService.refreshWithdrawalStatus(userId, withdrawalIntentId)
  });
  return app;
};

const buildUserWithdrawalWalletApp = async (repository: UserWithdrawalWalletRepository) => {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret" });
  await registerUserWithdrawalWalletRoutes(app, createUserAuthMiddleware(), {
    listWallets: (userId) => repository.listWallets(userId),
    upsertEvmWallet: (userId, request) => repository.upsertEvmWallet({
      userId,
      address: request.address,
      label: request.label ?? null
    })
  });
  return app;
};

const applyFundingMigration = async (pool: Pool): Promise<void> => {
  const sql = await readFile(
    path.resolve(process.cwd(), "sql", "migrations", "2026_04_25_create_funding_flow_v0_tables.sql"),
    "utf8"
  );
  await pool.query(sql);
  const withdrawalSql = await readFile(
    path.resolve(process.cwd(), "sql", "migrations", "2026_04_26_create_funding_withdrawal_v0_tables.sql"),
    "utf8"
  );
  await pool.query(withdrawalSql);
  const walletSql = await readFile(
    path.resolve(process.cwd(), "sql", "migrations", "2026_04_27_create_user_withdrawal_wallets.sql"),
    "utf8"
  );
  await pool.query(walletSql);
};

const clearFundingTables = async (pool: Pool): Promise<void> => {
  await pool.query(
    `TRUNCATE TABLE
      funding_withdrawal_audit_events,
      funding_withdrawal_reconciliation_records,
      funding_withdrawal_route_legs,
      funding_withdrawal_sources,
      funding_withdrawal_intents,
      funding_audit_events,
      funding_reconciliation_records,
      funding_route_legs,
      funding_targets,
      funding_intents,
      user_withdrawal_wallets
    RESTART IDENTITY CASCADE`
  );
};

describe.skipIf(!ENV_READY)("Funding flow v0 DB integration", () => {
  let pool: Pool;
  let repository: FundingRepository;
  let service: FundingService;
  let lifi: MockLifiProvider;
  let polymarketBalance: MockPolymarketBalanceReadClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    await applyFundingMigration(pool);
  });

  beforeEach(async () => {
    await clearFundingTables(pool);
    repository = new FundingRepository(pool);
    lifi = new MockLifiProvider();
    polymarketBalance = new MockPolymarketBalanceReadClient();
    service = new FundingService(
      repository,
      lifi,
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env: fundingEnv
      },
      new Map([[
        "POLYMARKET",
        new PolymarketFundingReadinessChecker(polymarketBalance, { enabled: true, env: fundingEnv })
      ]])
    );
  });

  afterAll(async () => {
    if (pool) {
      await clearFundingTables(pool);
      await pool.end();
    }
  });

  it("persists create -> quote -> submit -> destination received -> venue ready transitions with audit events", async () => {
    const userId = `funding-user-${randomUUID()}`;
    const created = await service.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "solana-wallet-address",
      idempotencyKey: `idem-${randomUUID()}`,
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    expect(created.intent.status).toBe("INTENT_CREATED");
    expect(created.targets).toHaveLength(1);

    const quoted = await service.quoteIntent(userId, created.intent.fundingIntentId);
    const leg = quoted.routeLegs[0]!;
    expect(quoted.intent.status).toBe("USER_SIGNATURE_REQUIRED");
    expect(leg.status).toBe("LEG_SIGNATURE_REQUIRED");
    expect(leg.routeQuote.transactionRequest).toMatchObject({ chainId: 137 });

    const txHash = `0x${"a".repeat(64)}`;
    const submitted = await service.submitRouteLeg(userId, created.intent.fundingIntentId, {
      routeLegId: leg.routeLegId,
      txHash
    });
    expect(submitted.intent.status).toBe("BRIDGING");
    expect(submitted.routeLegs[0]!.status).toBe("LEG_BRIDGE_PENDING");

    const destinationReceived = await service.refreshIntentStatus(userId, created.intent.fundingIntentId);
    expect(destinationReceived.intent.status).toBe("ROUTES_SUBMITTED");
    expect(destinationReceived.routeLegs[0]!.status).toBe("LEG_VENUE_CREDIT_PENDING");
    expect(destinationReceived.routeLegs[0]!.destinationStatus).toBe("CONFIRMED");
    expect(destinationReceived.routeLegs[0]!.venueCreditStatus).toBe("PENDING");
    expect(destinationReceived.reconciliations[0]).toMatchObject({
      destinationReceived: true,
      venueCreditConfirmed: false,
      readyToTrade: false
    });

    const readyFundingBeforeCredit = await service.hasReadyFundingForExecution(executionRequest(userId));
    expect(readyFundingBeforeCredit).toBe(false);

    polymarketBalance.usableBalance = "100";
    const ready = await service.verifyVenueReadiness(userId, created.intent.fundingIntentId, leg.routeLegId);
    expect(ready.intent.status).toBe("READY_TO_TRADE");
    expect(ready.routeLegs[0]!.status).toBe("LEG_READY_TO_TRADE");
    expect(ready.reconciliations[0]).toMatchObject({
      targetVenue: "POLYMARKET",
      destinationTxHash: txHash,
      destinationReceived: true,
      venueCreditConfirmed: true,
      readyToTrade: true
    });
    await expect(service.hasReadyFundingForExecution(executionRequest(userId))).resolves.toBe(true);

    const audit = await pool.query<{ event_type: string }>(
      `SELECT event_type
         FROM funding_audit_events
        WHERE funding_intent_id = $1::uuid
        ORDER BY created_at ASC`,
      [created.intent.fundingIntentId]
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      "FUNDING_INTENT_CREATED",
      "FUNDING_ROUTES_QUOTED",
      "FUNDING_USER_SIGNATURE_REQUIRED",
      "FUNDING_LEG_SUBMITTED",
      "FUNDING_LEG_BRIDGE_PENDING",
      "FUNDING_LEG_DESTINATION_RECEIVED",
      "FUNDING_LEG_VENUE_CREDIT_PENDING",
      "FUNDING_LEG_VENUE_CREDIT_PENDING",
      "FUNDING_LEG_READY_TO_TRADE",
      "FUNDING_READY_TO_TRADE"
    ]);
  });

  it("persists user-scoped EVM withdrawal wallets without exposing custody material", async () => {
    const walletRepository = new UserWithdrawalWalletRepository(pool);
    const app = await buildUserWithdrawalWalletApp(walletRepository);
    const userToken = app.jwt.sign({ userId: "wallet-user-1", role: "USER" });
    const otherToken = app.jwt.sign({ userId: "wallet-user-2", role: "USER" });

    const upsert = await app.inject({
      method: "PUT",
      url: "/user/withdrawal-wallets/evm",
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        address: "0x1111111111111111111111111111111111111111",
        label: "BSC USDT receiver"
      }
    });
    expect(upsert.statusCode).toBe(200);
    expect(upsert.json()).toMatchObject({
      wallet: {
        userId: "wallet-user-1",
        chainFamily: "EVM",
        address: "0x1111111111111111111111111111111111111111",
        verifiedAt: null
      }
    });
    await expect(walletRepository.hasEvmWithdrawalWallet(
      "wallet-user-1",
      "0x1111111111111111111111111111111111111111"
    )).resolves.toBe(true);

    const own = await app.inject({
      method: "GET",
      url: "/user/withdrawal-wallets",
      headers: { authorization: `Bearer ${userToken}` }
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().wallets).toHaveLength(1);
    expect(own.body).not.toContain("privateKey");
    expect(own.body).not.toContain("seedPhrase");
    expect(own.body).not.toContain("privySecret");
    expect(own.body).not.toContain("zeroDevSigner");

    const other = await app.inject({
      method: "GET",
      url: "/user/withdrawal-wallets",
      headers: { authorization: `Bearer ${otherToken}` }
    });
    expect(other.json()).toEqual({ wallets: [] });
    await app.close();
  });

  it("persists Polymarket READY_TO_TRADE only through status reconciliation flow", async () => {
    const userId = `funding-reconcile-${randomUUID()}`;
    const created = await service.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "solana-wallet-address",
      idempotencyKey: `reconcile-idem-${randomUUID()}`,
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    const quoted = await service.quoteIntent(userId, created.intent.fundingIntentId);
    const leg = quoted.routeLegs[0]!;
    const txHash = `0x${"c".repeat(64)}`;
    await service.submitRouteLeg(userId, created.intent.fundingIntentId, {
      routeLegId: leg.routeLegId,
      txHash
    });

    polymarketBalance.usableBalance = "100";
    const reconciled = await service.refreshIntentStatus(userId, created.intent.fundingIntentId);

    expect(reconciled.intent.status).toBe("READY_TO_TRADE");
    expect(reconciled.routeLegs[0]).toMatchObject({
      status: "LEG_READY_TO_TRADE",
      destinationStatus: "CONFIRMED",
      venueCreditStatus: "CONFIRMED"
    });
    expect(reconciled.reconciliations[0]).toMatchObject({
      targetVenue: "POLYMARKET",
      destinationTxHash: txHash,
      destinationReceived: true,
      venueCreditConfirmed: true,
      readyToTrade: true,
      notes: "POLYMARKET_USABLE_BALANCE_CONFIRMED"
    });

    const reconciliationRows = await pool.query<{
      ready_to_trade: boolean;
      venue_credit_confirmed: boolean;
      notes: string;
    }>(
      `SELECT ready_to_trade, venue_credit_confirmed, notes
         FROM funding_reconciliation_records
        WHERE funding_intent_id = $1::uuid
          AND route_leg_id = $2::uuid
        ORDER BY checked_at DESC`,
      [created.intent.fundingIntentId, leg.routeLegId]
    );
    expect(reconciliationRows.rows).toHaveLength(1);
    expect(reconciliationRows.rows[0]).toMatchObject({
      ready_to_trade: true,
      venue_credit_confirmed: true,
      notes: "POLYMARKET_USABLE_BALANCE_CONFIRMED"
    });

    const adminService = new FundingReadinessAdminService({
      repository,
      env: {
        FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true",
        POLYMARKET_FUNDING_READINESS_MODE: "LIVE_READ",
        POLYMARKET_FUNDING_BALANCE_URL: "https://operator.example/readiness"
      } as NodeJS.ProcessEnv
    });
    const rows = await adminService.listByIntent(created.intent.fundingIntentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fundingIntentId: created.intent.fundingIntentId,
      routeLegId: leg.routeLegId,
      readinessStatus: "READY_TO_TRADE",
      readyToTrade: true,
      checkerMode: "LIVE_READ",
      reasonNotReady: null
    });
    const serializedRows = JSON.stringify(rows);
    expect(serializedRows).not.toContain("db-integration-test");
    expect(serializedRows).not.toContain("transactionRequest");
    expect(serializedRows).not.toContain("authorization");
    expect(serializedRows).not.toContain("privateKey");

    const summary = await adminService.getSummary();
    expect(summary.readyToTrade).toBe(1);
    expect(summary.countsByReadinessStatus.READY_TO_TRADE).toBe(1);
    expect(summary.rows.find((row) => row.fundingIntentId === created.intent.fundingIntentId)).toMatchObject({
      readinessStatus: "READY_TO_TRADE",
      readyToTrade: true
    });

    const disabledPreflight = buildPreflight(new FundingReadinessChecker(service, false));
    await expect(disabledPreflight.evaluate({ request: executionRequest(userId), scopeBinding })).resolves.toMatchObject({ ok: true });
  });

  it("persists withdrawal create -> quote -> submit using venue-ready funding rows without mutating readiness", async () => {
    const userId = `withdrawal-user-${randomUUID()}`;
    const createdFunding = await service.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "solana-wallet-address",
      idempotencyKey: `funding-for-withdrawal-${randomUUID()}`,
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    const quotedFunding = await service.quoteIntent(userId, createdFunding.intent.fundingIntentId);
    await service.submitRouteLeg(userId, createdFunding.intent.fundingIntentId, {
      routeLegId: quotedFunding.routeLegs[0]!.routeLegId,
      txHash: `0x${"f".repeat(64)}`
    });
    polymarketBalance.usableBalance = "100";
    await service.refreshIntentStatus(userId, createdFunding.intent.fundingIntentId);

    const withdrawalService = new FundingService(repository, lifi, {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      venueReadinessChecksEnabled: false,
      env: withdrawalEnv
    });
    const balancesBefore = await withdrawalService.listVenueBalances(userId);
    expect(balancesBefore).toMatchObject([{
      venue: "POLYMARKET",
      token: "USDC",
      readyAmount: "100",
      pendingWithdrawalAmount: "0",
      availableAmount: "100"
    }]);

    const withdrawal = await withdrawalService.createWithdrawalIntent(userId, {
      token: "USDC",
      amount: "50",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: `withdrawal-${randomUUID()}`,
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    });
    expect(withdrawal.intent.status).toBe("WITHDRAWAL_CREATED");

    const quotedWithdrawal = await withdrawalService.quoteWithdrawalIntent(userId, withdrawal.intent.withdrawalIntentId);
    expect(quotedWithdrawal.intent.status).toBe("USER_SIGNATURE_REQUIRED");
    expect(quotedWithdrawal.routeLegs[0]).toMatchObject({
      sourceVenue: "POLYMARKET",
      routeProvider: "LOTUS_WITHDRAWAL_V0",
      status: "WITHDRAWAL_LEG_SIGNATURE_REQUIRED",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111"
    });
    expect(quotedWithdrawal.routeLegs[0]!.routeQuote.transactionRequest).toBeNull();
    expect(JSON.stringify(quotedWithdrawal)).not.toContain("authorization");
    expect(JSON.stringify(quotedWithdrawal)).not.toContain("privateKey");
    expect(JSON.stringify(quotedWithdrawal)).not.toContain("apiKey");

    const submitted = await withdrawalService.submitWithdrawalRouteLeg(userId, withdrawal.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quotedWithdrawal.routeLegs[0]!.withdrawalRouteLegId,
      txHash: `0x${"9".repeat(64)}`
    });
    expect(submitted.intent.status).toBe("WITHDRAWING");
    expect(submitted.routeLegs[0]).toMatchObject({
      status: "VENUE_RELEASE_PENDING",
      venueReleaseStatus: "PENDING"
    });

    const balancesAfter = await withdrawalService.listVenueBalances(userId);
    expect(balancesAfter[0]).toMatchObject({
      readyAmount: "100",
      pendingWithdrawalAmount: "50",
      availableAmount: "50"
    });
    await expect(withdrawalService.createWithdrawalIntent(userId, {
      token: "USDC",
      amount: "60",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: `withdrawal-over-reserve-${randomUUID()}`,
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    })).rejects.toMatchObject({ code: "WITHDRAWAL_SOURCE_BALANCE_INSUFFICIENT" });

    const readinessRows = await repository.listAdminReadinessRows({ fundingIntentId: createdFunding.intent.fundingIntentId });
    expect(readinessRows[0]).toMatchObject({
      readyToTrade: true
    });
    const fundingReconciliations = await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM funding_reconciliation_records WHERE funding_intent_id = $1::uuid",
      [createdFunding.intent.fundingIntentId]
    );
    expect(fundingReconciliations.rows[0]!.count).toBe("1");

    const withdrawalAudit = await pool.query<{ event_type: string }>(
      `SELECT event_type
         FROM funding_withdrawal_audit_events
        WHERE withdrawal_intent_id = $1::uuid
        ORDER BY created_at ASC`,
      [withdrawal.intent.withdrawalIntentId]
    );
    expect(withdrawalAudit.rows.map((row) => row.event_type)).toEqual([
      "WITHDRAWAL_INTENT_CREATED",
      "WITHDRAWAL_ROUTES_QUOTED",
      "WITHDRAWAL_USER_SIGNATURE_REQUIRED",
      "WITHDRAWAL_LEG_SUBMITTED"
    ]);
  });

  it("rehearses withdrawal UI/API flow against seeded venue-ready balances", async () => {
    const userId = `withdrawal-api-user-${randomUUID()}`;
    const createdFunding = await service.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "solana-wallet-address",
      idempotencyKey: `funding-for-withdrawal-api-${randomUUID()}`,
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    const quotedFunding = await service.quoteIntent(userId, createdFunding.intent.fundingIntentId);
    await service.submitRouteLeg(userId, createdFunding.intent.fundingIntentId, {
      routeLegId: quotedFunding.routeLegs[0]!.routeLegId,
      txHash: `0x${"8".repeat(64)}`
    });
    polymarketBalance.usableBalance = "100";
    await service.refreshIntentStatus(userId, createdFunding.intent.fundingIntentId);

    const withdrawalService = new FundingService(repository, lifi, {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      venueReadinessChecksEnabled: false,
      env: withdrawalEnv
    });
    const app = await buildUserFundingApp(withdrawalService);
    try {
      const token = app.jwt.sign({ userId, role: "USER" });
      const otherUserToken = app.jwt.sign({ userId: `other-${randomUUID()}`, role: "USER" });
      const headers = { authorization: `Bearer ${token}` };

      const balances = await app.inject({ method: "GET", url: "/funding/venue-balances", headers });
      expect(balances.statusCode).toBe(200);
      expect(balances.json()).toMatchObject({
        balances: [{
          venue: "POLYMARKET",
          token: "USDC",
          readyAmount: "100",
          pendingWithdrawalAmount: "0",
          availableAmount: "100"
        }]
      });

      const createdWithdrawal = await app.inject({
        method: "POST",
        url: "/funding/withdrawals",
        headers,
        payload: {
          token: "USDC",
          amount: "40",
          destinationChain: "POLYGON",
          destinationWalletAddress: "0x1111111111111111111111111111111111111111",
          idempotencyKey: `withdrawal-api-${randomUUID()}`,
          sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
        }
      });
      expect(createdWithdrawal.statusCode).toBe(201);
      const createdWithdrawalBody = createdWithdrawal.json() as { withdrawalIntentId: string; currentStatus: string };
      expect(createdWithdrawalBody.currentStatus).toBe("WITHDRAWAL_CREATED");

      const crossUserRead = await app.inject({
        method: "GET",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}`,
        headers: { authorization: `Bearer ${otherUserToken}` }
      });
      expect(crossUserRead.statusCode).toBe(403);

      const quotedWithdrawal = await app.inject({
        method: "POST",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}/quote`,
        headers
      });
      expect(quotedWithdrawal.statusCode).toBe(200);
      const quotedWithdrawalBody = quotedWithdrawal.json() as {
        currentStatus: string;
        routeLegs: Array<{ withdrawalRouteLegId: string; routeQuote: { transactionRequest: unknown } }>;
      };
      expect(quotedWithdrawalBody.currentStatus).toBe("USER_SIGNATURE_REQUIRED");
      expect(quotedWithdrawalBody.routeLegs[0]!.routeQuote.transactionRequest).toBeNull();

      const submittedWithdrawal = await app.inject({
        method: "POST",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}/submit`,
        headers,
        payload: {
          withdrawalRouteLegId: quotedWithdrawalBody.routeLegs[0]!.withdrawalRouteLegId,
          txHash: `0x${"7".repeat(64)}`
        }
      });
      expect(submittedWithdrawal.statusCode).toBe(202);
      expect(submittedWithdrawal.json()).toMatchObject({
        currentStatus: "WITHDRAWING",
        routeLegs: [{ status: "VENUE_RELEASE_PENDING", venueReleaseStatus: "PENDING" }]
      });

      const status = await app.inject({
        method: "GET",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}/status`,
        headers
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ currentStatus: "WITHDRAWING" });

      const balancesAfter = await app.inject({ method: "GET", url: "/funding/venue-balances", headers });
      expect(balancesAfter.statusCode).toBe(200);
      expect(balancesAfter.json()).toMatchObject({
        balances: [{
          venue: "POLYMARKET",
          token: "USDC",
          readyAmount: "100",
          pendingWithdrawalAmount: "40",
          availableAmount: "60"
        }]
      });

      const serialized = `${balances.body}${createdWithdrawal.body}${quotedWithdrawal.body}${submittedWithdrawal.body}${status.body}`;
      expect(serialized).not.toContain("authorization");
      expect(serialized).not.toContain("privateKey");
      expect(serialized).not.toContain("apiKey");
      expect(serialized).not.toContain("server-side-secret");
    } finally {
      await app.close();
    }
  });

  it("rehearses Predict.fun user-wallet withdrawal quote through API against seeded venue-ready balance", async () => {
    const userId = `withdrawal-predictfun-api-user-${randomUUID()}`;
    const predictBalance = new MockGenericBalanceReadClient();
    const predictEnv = {
      ...withdrawalEnv,
      PREDICT_FUN_WITHDRAWAL_ADAPTER_ENABLED: "true",
      PREDICT_FUN_WITHDRAWAL_ADAPTER_MODE: "USER_WALLET_DRY_RUN",
      PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      PREDICT_FUN_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.predict.fun/knowledge-base/wallets",
      PREDICT_FUN_FUNDING_PREFERRED_CHAIN: "BSC",
      PREDICT_FUN_FUNDING_PREFERRED_CHAIN_ID: "56",
      PREDICT_FUN_FUNDING_PREFERRED_TOKEN: "USDT"
    } as NodeJS.ProcessEnv;
    const predictFundingService = new FundingService(
      repository,
      lifi,
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env: predictEnv
      },
      new Map([[
        "PREDICT_FUN",
        new ConfigurableVenueFundingReadinessChecker("PREDICT_FUN", predictBalance, {
          enabled: true,
          env: predictEnv
        })
      ]])
    );
    const createdFunding = await predictFundingService.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDT",
      sourceAmount: "100",
      sourceWalletAddress: "solana-wallet-address",
      idempotencyKey: `funding-for-predictfun-withdrawal-api-${randomUUID()}`,
      targets: [{ targetVenue: "PREDICT_FUN", targetPercentage: 100 }]
    });
    const quotedFunding = await predictFundingService.quoteIntent(userId, createdFunding.intent.fundingIntentId);
    await predictFundingService.submitRouteLeg(userId, createdFunding.intent.fundingIntentId, {
      routeLegId: quotedFunding.routeLegs[0]!.routeLegId,
      txHash: `0x${"4".repeat(64)}`
    });
    predictBalance.usableBalance = "100";
    await predictFundingService.refreshIntentStatus(userId, createdFunding.intent.fundingIntentId);

    const withdrawalService = new FundingService(
      repository,
      lifi,
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: false,
        env: predictEnv
      },
      new Map(),
      null,
      null,
      null,
      new PredictFunWithdrawalAdapter(getPredictFunWithdrawalConfigFromEnv(predictEnv))
    );
    const app = await buildUserFundingApp(withdrawalService);
    try {
      const token = app.jwt.sign({ userId, role: "USER" });
      const headers = { authorization: `Bearer ${token}` };

      const createdWithdrawal = await app.inject({
        method: "POST",
        url: "/funding/withdrawals",
        headers,
        payload: {
          token: "USDT",
          amount: "40",
          destinationChain: "BSC",
          destinationWalletAddress: "0x1111111111111111111111111111111111111111",
          idempotencyKey: `withdrawal-predictfun-api-${randomUUID()}`,
          sources: [{ sourceVenue: "PREDICT_FUN", sourcePercentage: 100 }]
        }
      });
      expect(createdWithdrawal.statusCode).toBe(201);
      const createdWithdrawalBody = createdWithdrawal.json() as { withdrawalIntentId: string };

      const quotedWithdrawal = await app.inject({
        method: "POST",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}/quote`,
        headers
      });
      expect(quotedWithdrawal.statusCode).toBe(200);
      const quotedWithdrawalBody = quotedWithdrawal.json() as {
        currentStatus: string;
        routePreview: Record<string, unknown>;
        routeLegs: Array<{
          withdrawalRouteLegId: string;
          routeQuote: { transactionRequest: unknown; userSafeSummary: string };
          providerStatus: Record<string, unknown>;
        }>;
      };
      expect(quotedWithdrawalBody.currentStatus).toBe("USER_SIGNATURE_REQUIRED");
      expect(quotedWithdrawalBody.routeLegs[0]!.providerStatus).toMatchObject({
        provider: "PREDICT_FUN_USER_WALLET",
        mode: "USER_WALLET_DRY_RUN",
        walletModel: "PRIVY_ZERODEV",
        completionPersisted: false
      });
      expect(quotedWithdrawalBody.routeLegs[0]!.routeQuote.transactionRequest).toBeNull();
      expect(quotedWithdrawalBody.routePreview).toMatchObject({
        predictFunUserWallet: {
          provider: "PREDICT_FUN_USER_WALLET",
          mode: "USER_WALLET_DRY_RUN",
          walletModel: "PRIVY_ZERODEV",
          completionPersisted: false
        }
      });

      const submittedWithdrawal = await app.inject({
        method: "POST",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}/submit`,
        headers,
        payload: {
          withdrawalRouteLegId: quotedWithdrawalBody.routeLegs[0]!.withdrawalRouteLegId,
          txHash: `0x${"3".repeat(64)}`
        }
      });
      expect(submittedWithdrawal.statusCode).toBe(202);

      const status = await app.inject({
        method: "GET",
        url: `/funding/withdrawals/${createdWithdrawalBody.withdrawalIntentId}/status`,
        headers
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ currentStatus: "WITHDRAWING" });

      const serialized = `${quotedWithdrawal.body}${submittedWithdrawal.body}${status.body}`;
      expect(serialized).toContain("Lotus does not hold keys");
      expect(serialized).not.toContain("privateKey");
      expect(serialized).not.toContain("walletSeed");
      expect(serialized).not.toContain("privySecret");
      expect(serialized).not.toContain("zeroDevSigner");
      expect(serialized).not.toContain("authorization");
      expect(serialized).not.toContain("jwt");
      expect(serialized).not.toContain("rawProviderPayload");
    } finally {
      await app.close();
    }
  });

  it("persists withdrawal completion reconciliation from mocked exact evidence", async () => {
    const userId = `withdrawal-completion-${randomUUID()}`;
    const createdFunding = await service.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "solana-wallet-address",
      idempotencyKey: `funding-for-withdrawal-completion-${randomUUID()}`,
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    const quotedFunding = await service.quoteIntent(userId, createdFunding.intent.fundingIntentId);
    await service.submitRouteLeg(userId, createdFunding.intent.fundingIntentId, {
      routeLegId: quotedFunding.routeLegs[0]!.routeLegId,
      txHash: `0x${"6".repeat(64)}`
    });
    polymarketBalance.usableBalance = "100";
    await service.refreshIntentStatus(userId, createdFunding.intent.fundingIntentId);

    const completionChecker = new MockWithdrawalCompletionChecker();
    const withdrawalService = new FundingService(
      repository,
      lifi,
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: false,
        env: withdrawalEnv
      },
      new Map(),
      completionChecker
    );
    const withdrawal = await withdrawalService.createWithdrawalIntent(userId, {
      token: "USDC",
      amount: "40",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: `withdrawal-completion-${randomUUID()}`,
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    });
    const quotedWithdrawal = await withdrawalService.quoteWithdrawalIntent(userId, withdrawal.intent.withdrawalIntentId);
    const withdrawalTxHash = `0x${"5".repeat(64)}`;
    await withdrawalService.submitWithdrawalRouteLeg(userId, withdrawal.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quotedWithdrawal.routeLegs[0]!.withdrawalRouteLegId,
      txHash: withdrawalTxHash
    });

    completionChecker.result = {
      status: "VENUE_RELEASED",
      venueReleased: true,
      destinationReceived: false,
      completed: false,
      withdrawalTxHash,
      reason: "SANDBOX_VENUE_RELEASED",
      evidence: { source: "mock_completion_checker", rawProviderPayloadIncluded: false }
    };
    const released = await withdrawalService.refreshWithdrawalStatus(userId, withdrawal.intent.withdrawalIntentId);
    expect(released.intent.status).toBe("WITHDRAWING");
    expect(released.routeLegs[0]).toMatchObject({
      status: "DESTINATION_PENDING",
      venueReleaseStatus: "CONFIRMED",
      destinationStatus: "PENDING"
    });

    completionChecker.result = {
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      withdrawalTxHash,
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "40",
      reason: "SANDBOX_DESTINATION_CONFIRMED",
      evidence: { source: "mock_completion_checker", confirmationCount: 1 }
    };
    const completed = await withdrawalService.refreshWithdrawalStatus(userId, withdrawal.intent.withdrawalIntentId);
    expect(completed.intent.status).toBe("COMPLETED");
    expect(completed.routeLegs[0]).toMatchObject({
      status: "WITHDRAWAL_LEG_COMPLETED",
      venueReleaseStatus: "CONFIRMED",
      destinationStatus: "CONFIRMED"
    });
    expect(completed.reconciliations[0]).toMatchObject({
      sourceVenue: "POLYMARKET",
      withdrawalTxHash,
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      notes: "SANDBOX_DESTINATION_CONFIRMED"
    });

    const reconciliationRows = await pool.query<{
      venue_released: boolean;
      destination_received: boolean;
      completed: boolean;
      notes: string;
    }>(
      `SELECT venue_released, destination_received, completed, notes
         FROM funding_withdrawal_reconciliation_records
        WHERE withdrawal_intent_id = $1::uuid
        ORDER BY checked_at DESC`,
      [withdrawal.intent.withdrawalIntentId]
    );
    expect(reconciliationRows.rows).toHaveLength(2);
    expect(reconciliationRows.rows[0]).toMatchObject({
      venue_released: true,
      destination_received: true,
      completed: true,
      notes: "SANDBOX_DESTINATION_CONFIRMED"
    });

    const balancesAfterCompletion = await withdrawalService.listVenueBalances(userId);
    expect(balancesAfterCompletion[0]).toMatchObject({
      readyAmount: "100",
      pendingWithdrawalAmount: "40",
      availableAmount: "60"
    });

    const audit = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload
         FROM funding_withdrawal_audit_events
        WHERE withdrawal_intent_id = $1::uuid
        ORDER BY created_at ASC`,
      [withdrawal.intent.withdrawalIntentId]
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      "WITHDRAWAL_INTENT_CREATED",
      "WITHDRAWAL_ROUTES_QUOTED",
      "WITHDRAWAL_USER_SIGNATURE_REQUIRED",
      "WITHDRAWAL_LEG_SUBMITTED",
      "WITHDRAWAL_VENUE_RELEASED",
      "WITHDRAWAL_LEG_COMPLETED",
      "WITHDRAWAL_COMPLETED"
    ]);
    const serialized = JSON.stringify({ view: completed, audit: audit.rows });
    expect(serialized).not.toContain("0x1234");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("server-side-secret");
  });

  it("keeps execution funding enforcement disabled by default and blocks until exact venue funds are ready when enabled", async () => {
    const userId = `funding-user-${randomUUID()}`;
    const created = await service.createIntent(userId, {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "solana-wallet-address",
      idempotencyKey: `idem-${randomUUID()}`,
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    const quoted = await service.quoteIntent(userId, created.intent.fundingIntentId);
    const leg = quoted.routeLegs[0]!;
    await service.submitRouteLeg(userId, created.intent.fundingIntentId, {
      routeLegId: leg.routeLegId,
      txHash: `0x${"b".repeat(64)}`
    });
    await service.refreshIntentStatus(userId, created.intent.fundingIntentId);

    const request = executionRequest(userId);
    const disabledPreflight = buildPreflight(new FundingReadinessChecker(service, false));
    await expect(disabledPreflight.evaluate({ request, scopeBinding })).resolves.toMatchObject({ ok: true });

    const enabledPreflight = buildPreflight(new FundingReadinessChecker(service, true));
    await expect(enabledPreflight.evaluate({ request, scopeBinding })).resolves.toMatchObject({
      ok: false,
      code: "FUNDING_UNAVAILABLE"
    });

    polymarketBalance.usableBalance = "0";
    await service.verifyVenueReadiness(userId, created.intent.fundingIntentId, leg.routeLegId);
    await expect(enabledPreflight.evaluate({ request, scopeBinding })).resolves.toMatchObject({
      ok: false,
      code: "FUNDING_UNAVAILABLE"
    });

    polymarketBalance.usableBalance = "100";
    await service.verifyVenueReadiness(userId, created.intent.fundingIntentId, leg.routeLegId);
    await expect(enabledPreflight.evaluate({ request, scopeBinding })).resolves.toMatchObject({ ok: true });
  });

  it("serves admin funding readiness from real tables without mutating funding state", async () => {
    const createQuotedSubmittedIntent = async (label: string, targets = [{ targetVenue: "POLYMARKET" as const, targetPercentage: 100 }]) => {
      const userId = `admin-readiness-${label}-${randomUUID()}`;
      const created = await service.createIntent(userId, {
        sourceChain: "SOLANA",
        sourceToken: "USDC",
        sourceAmount: "100",
        sourceWalletAddress: `wallet-${label}`,
        idempotencyKey: `idem-${label}-${randomUUID()}`,
        targets
      });
      const quoted = await service.quoteIntent(userId, created.intent.fundingIntentId);
      for (const leg of quoted.routeLegs) {
        await service.submitRouteLeg(userId, created.intent.fundingIntentId, {
          routeLegId: leg.routeLegId,
          txHash: `0x${label.slice(0, 1).repeat(64)}`
        });
      }
      return {
        userId,
        fundingIntentId: created.intent.fundingIntentId,
        routeLegs: quoted.routeLegs
      };
    };

    const notConfirmed = await createQuotedSubmittedIntent("a");

    const pending = await createQuotedSubmittedIntent("b");
    await service.refreshIntentStatus(pending.userId, pending.fundingIntentId);

    const ready = await createQuotedSubmittedIntent("c");
    await service.refreshIntentStatus(ready.userId, ready.fundingIntentId);
    polymarketBalance.usableBalance = "100";
    await service.verifyVenueReadiness(ready.userId, ready.fundingIntentId, ready.routeLegs[0]!.routeLegId);

    const failed = await createQuotedSubmittedIntent("d");
    await repository.updateRouteLegProviderStatus({
      routeLegId: failed.routeLegs[0]!.routeLegId,
      status: "LEG_FAILED",
      bridgeStatus: "FAILED",
      destinationStatus: "FAILED",
      venueCreditStatus: "FAILED",
      providerStatus: { status: "FAILED" },
      errorReason: "Route failed in DB-backed readiness test."
    });
    await repository.updateIntentStatus(failed.fundingIntentId, "FAILED");
    await repository.appendAuditEvent({
      fundingIntentId: failed.fundingIntentId,
      routeLegId: failed.routeLegs[0]!.routeLegId,
      eventType: "FUNDING_LEG_FAILED",
      payload: { reason: "Route failed in DB-backed readiness test." }
    });

    const unknown = await createQuotedSubmittedIntent("e");
    await service.refreshIntentStatus(unknown.userId, unknown.fundingIntentId);
    await repository.updateRouteLegProviderStatus({
      routeLegId: unknown.routeLegs[0]!.routeLegId,
      status: "LEG_VENUE_CREDIT_PENDING",
      bridgeStatus: "DONE",
      destinationStatus: "CONFIRMED",
      venueCreditStatus: "UNKNOWN",
      providerStatus: { status: "DONE" },
      errorReason: null
    });
    await repository.createReconciliationRecord({
      fundingIntentId: unknown.fundingIntentId,
      routeLegId: unknown.routeLegs[0]!.routeLegId,
      targetVenue: "POLYMARKET",
      destinationTxHash: `0x${"e".repeat(64)}`,
      destinationReceived: true,
      venueCreditConfirmed: false,
      readyToTrade: false,
      notes: "Malformed LI.FI transactionRequest included API_KEY server-side-secret."
    });

    const split = await createQuotedSubmittedIntent("f", [
      { targetVenue: "POLYMARKET", targetPercentage: 50 },
      { targetVenue: "POLYMARKET", targetPercentage: 50 }
    ]);

    const snapshotFundingState = async (): Promise<string> => {
      const result = await pool.query<{ snapshot: string }>(
        `SELECT jsonb_build_object(
          'auditCount', (SELECT count(*)::int FROM funding_audit_events),
          'reconciliationCount', (SELECT count(*)::int FROM funding_reconciliation_records),
          'intentStatuses', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id::text, 'status', status) ORDER BY id::text), '[]'::jsonb)
              FROM funding_intents
          ),
          'legStatuses', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id', id::text,
              'status', status,
              'bridgeStatus', bridge_status,
              'destinationStatus', destination_status,
              'venueCreditStatus', venue_credit_status,
              'errorReason', error_reason
            ) ORDER BY id::text), '[]'::jsonb)
              FROM funding_route_legs
          ),
          'reconciliations', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id', id::text,
              'destinationReceived', destination_received,
              'venueCreditConfirmed', venue_credit_confirmed,
              'readyToTrade', ready_to_trade,
              'notes', notes
            ) ORDER BY id::text), '[]'::jsonb)
              FROM funding_reconciliation_records
          )
        )::text AS snapshot`
      );
      return result.rows[0]!.snapshot;
    };

    const beforeReads = await snapshotFundingState();
    const app = await buildAdminFundingReadinessApp(repository);
    const adminToken = app.jwt.sign({ userId: "admin-user", role: "ADMIN" });
    const headers = { authorization: `Bearer ${adminToken}` };

    const listResponse = await app.inject({ method: "GET", url: "/admin/funding/readiness", headers });
    expect(listResponse.statusCode).toBe(200);
    const rows = listResponse.json().readiness;
    expect(rows.length).toBeGreaterThanOrEqual(7);

    const byIntent = await app.inject({
      method: "GET",
      url: `/admin/funding/readiness/${split.fundingIntentId}`,
      headers
    });
    expect(byIntent.statusCode).toBe(200);
    expect(byIntent.json().readiness).toHaveLength(2);

    const byUser = await app.inject({
      method: "GET",
      url: `/admin/funding/readiness/user/${ready.userId}`,
      headers
    });
    expect(byUser.statusCode).toBe(200);
    expect(byUser.json().readiness).toHaveLength(1);
    expect(byUser.json().readiness[0]).toMatchObject({
      userId: ready.userId,
      readinessStatus: "READY_TO_TRADE",
      readyToTrade: true
    });

    const byVenue = await app.inject({
      method: "GET",
      url: "/admin/funding/readiness/venue/polymarket",
      headers
    });
    expect(byVenue.statusCode).toBe(200);
    expect(byVenue.json().readiness.length).toBeGreaterThanOrEqual(7);

    const summaryResponse = await app.inject({
      method: "GET",
      url: "/admin/funding/readiness/summary",
      headers
    });
    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json().summary).toMatchObject({
      totalFundingIntents: 6,
      totalRouteLegs: 7,
      readyToTrade: 1,
      venueCreditPending: 1,
      destinationNotConfirmed: 3,
      failed: 1,
      unknown: 1,
      splitCapableIntents: 1,
      partialReadyIntents: 0,
      countsByVenue: { POLYMARKET: 7 },
      countsByRouteProvider: { LIFI: 7 }
    });
    expect(summaryResponse.json().summary.blockedRows.failed).toHaveLength(1);
    expect(summaryResponse.json().summary.blockedRows.unknown).toHaveLength(1);

    const byFundingIntentId = (fundingIntentId: string) =>
      rows.find((row: { fundingIntentId: string }) => row.fundingIntentId === fundingIntentId);
    expect(byFundingIntentId(notConfirmed.fundingIntentId)).toMatchObject({
      readinessStatus: "DESTINATION_NOT_CONFIRMED",
      checkerMode: "DISABLED",
      readyToTrade: false
    });
    expect(byFundingIntentId(pending.fundingIntentId)).toMatchObject({
      readinessStatus: "VENUE_CREDIT_PENDING",
      readyToTrade: false
    });
    expect(byFundingIntentId(ready.fundingIntentId)).toMatchObject({
      readinessStatus: "READY_TO_TRADE",
      readyToTrade: true
    });
    expect(byFundingIntentId(failed.fundingIntentId)).toMatchObject({
      readinessStatus: "FAILED",
      readyToTrade: false
    });
    expect(byFundingIntentId(unknown.fundingIntentId)).toMatchObject({
      readinessStatus: "UNKNOWN",
      reasonNotReady: "Sensitive provider evidence was redacted.",
      readyToTrade: false
    });

    const serialized = listResponse.body;
    expect(serialized).toContain(`0x${"a".repeat(64)}`);
    expect(serialized).not.toContain("transactionRequest");
    expect(serialized).not.toContain("server-side-secret");
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("authorization");
    expect(summaryResponse.body).not.toContain("transactionRequest");
    expect(summaryResponse.body).not.toContain("server-side-secret");
    expect(summaryResponse.body).not.toContain("API_KEY");

    const afterReads = await snapshotFundingState();
    expect(afterReads).toBe(beforeReads);
    await app.close();
  });
});
