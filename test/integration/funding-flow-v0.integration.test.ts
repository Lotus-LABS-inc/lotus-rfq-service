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
import { createAdminAuthMiddleware } from "../../src/api/user-auth-middleware.js";
import { FundingReadinessChecker, FundingService } from "../../src/core/funding/funding-service.js";
import type { FundingRouteQuote } from "../../src/core/funding/types.js";
import {
  PolymarketFundingReadinessChecker,
  type PolymarketFundingBalanceReadClient
} from "../../src/core/funding/venue-readiness.js";
import type { LifiRouteProvider } from "../../src/integrations/lifi/lifi-client.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";
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
  POLYMARKET_FUNDING_DESTINATION_ADDRESS: "0x1111111111111111111111111111111111111111"
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

const applyFundingMigration = async (pool: Pool): Promise<void> => {
  const sql = await readFile(
    path.resolve(process.cwd(), "sql", "migrations", "2026_04_25_create_funding_flow_v0_tables.sql"),
    "utf8"
  );
  await pool.query(sql);
};

const clearFundingTables = async (pool: Pool): Promise<void> => {
  await pool.query(
    `TRUNCATE TABLE
      funding_audit_events,
      funding_reconciliation_records,
      funding_route_legs,
      funding_targets,
      funding_intents
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
