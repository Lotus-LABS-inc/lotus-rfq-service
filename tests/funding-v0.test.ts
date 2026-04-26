import { describe, expect, it } from "vitest";

import {
  aggregateFundingStatus,
  FundingError,
  validateCreateFundingIntentInput,
  type FundingIntent,
  type FundingReconciliationRecord,
  type FundingRouteLeg,
  type FundingRouteQuote,
  type FundingTarget
} from "../src/core/funding/types.js";
import { FundingReadinessChecker, FundingService, type FundingRepository } from "../src/core/funding/funding-service.js";
import { buildVenueCapabilityMatrix } from "../src/core/funding/venue-capabilities.js";
import {
  getLimitlessFundingReadinessConfigFromEnv,
  getPolymarketFundingReadinessConfigFromEnv,
  HttpPolymarketFundingBalanceReadClient,
  LimitlessFundingReadinessChecker,
  PolymarketFundingReadinessChecker,
  type LimitlessFundingBalanceReadClient,
  type PolymarketFundingBalanceReadClient
} from "../src/core/funding/venue-readiness.js";
import {
  normalizeLifiQuote,
  normalizeLifiStatus,
  type LifiRouteProvider
} from "../src/integrations/lifi/lifi-client.js";
import { zeroFees, type ExecutionRequestV0 } from "../src/execution-system/types.js";

const env = {
  POLYMARKET_FUNDING_DESTINATION_ADDRESS: "0x1111111111111111111111111111111111111111",
  LIMITLESS_FUNDING_DESTINATION_ADDRESS: "0x3333333333333333333333333333333333333333"
} as NodeJS.ProcessEnv;

const executionRequest = (): ExecutionRequestV0 => ({
  executionId: "execution-1",
  rfqId: "rfq-1",
  userId: "user-1",
  canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC",
  candidateId: "candidate-1",
  side: "buy",
  size: "10",
  selectedLaneId: "lane-1",
  venuePath: ["POLYMARKET"],
  executionMode: "SINGLE_VENUE",
  approvedScopeHash: "scope",
  maxSlippage: 0.01,
  fastLaneEnabled: false,
  ghostFillProtectionEnabled: true,
  expectedPrice: 0.5,
  expectedFees: zeroFees(),
  idempotencyKey: "execution-idem",
  createdAt: "2026-04-25T00:00:00.000Z"
});

class InMemoryFundingRepository implements FundingRepository {
  public intents = new Map<string, FundingIntent>();
  public targets = new Map<string, FundingTarget[]>();
  public legs = new Map<string, FundingRouteLeg[]>();
  public reconciliations = new Map<string, FundingReconciliationRecord[]>();
  public auditEvents: Array<{ fundingIntentId: string; routeLegId?: string | null; eventType: string; payload: Record<string, unknown> }> = [];
  public ready = false;
  private auditCounter = 0;

  public async findIntentById(id: string): Promise<FundingIntent | null> {
    return this.intents.get(id) ?? null;
  }

  public async findIntentByUserAndIdempotencyKey(userId: string, idempotencyKey: string): Promise<FundingIntent | null> {
    return [...this.intents.values()].find((intent) => intent.userId === userId && intent.idempotencyKey === idempotencyKey) ?? null;
  }

  public async createIntent(input: FundingIntent, targets: FundingTarget[]): Promise<FundingIntent> {
    this.intents.set(input.fundingIntentId, input);
    this.targets.set(input.fundingIntentId, targets);
    return input;
  }

  public async listTargets(fundingIntentId: string): Promise<FundingTarget[]> {
    return this.targets.get(fundingIntentId) ?? [];
  }

  public async listRouteLegs(fundingIntentId: string): Promise<FundingRouteLeg[]> {
    return this.legs.get(fundingIntentId) ?? [];
  }

  public async listReconciliations(fundingIntentId: string): Promise<FundingReconciliationRecord[]> {
    return this.reconciliations.get(fundingIntentId) ?? [];
  }

  public async replaceRouteLegs(fundingIntentId: string, routeLegs: FundingRouteLeg[]): Promise<void> {
    this.legs.set(fundingIntentId, routeLegs);
  }

  public async updateIntentStatus(fundingIntentId: string, status: FundingIntent["status"], patch: Record<string, unknown> = {}): Promise<void> {
    const intent = this.intents.get(fundingIntentId)!;
    this.intents.set(fundingIntentId, {
      ...intent,
      status,
      aggregateRouteQuote: (patch.aggregateRouteQuote as Record<string, unknown>) ?? intent.aggregateRouteQuote,
      totalEstimatedFees: typeof patch.totalEstimatedFees === "string" ? patch.totalEstimatedFees : intent.totalEstimatedFees,
      totalEstimatedTimeSeconds: typeof patch.totalEstimatedTimeSeconds === "number" ? patch.totalEstimatedTimeSeconds : intent.totalEstimatedTimeSeconds
    });
  }

  public async updateRouteLegSubmission(input: { routeLegId: string; txHash: string; status: FundingRouteLeg["status"] }): Promise<void> {
    for (const [intentId, legs] of this.legs.entries()) {
      this.legs.set(intentId, legs.map((leg) => leg.routeLegId === input.routeLegId ? {
        ...leg,
        status: input.status,
        txHashes: [...leg.txHashes, input.txHash],
        bridgeStatus: "PENDING"
      } : leg));
    }
  }

  public async updateRouteLegProviderStatus(input: {
    routeLegId: string;
    status: FundingRouteLeg["status"];
    bridgeStatus: string;
    destinationStatus: string;
    venueCreditStatus: string;
    providerStatus: Record<string, unknown>;
    errorReason?: string | null;
  }): Promise<void> {
    for (const [intentId, legs] of this.legs.entries()) {
      this.legs.set(intentId, legs.map((leg) => leg.routeLegId === input.routeLegId ? {
        ...leg,
        status: input.status,
        bridgeStatus: input.bridgeStatus,
        destinationStatus: input.destinationStatus,
        venueCreditStatus: input.venueCreditStatus,
        providerStatus: input.providerStatus,
        errorReason: input.errorReason ?? null
      } : leg));
    }
  }

  public async createReconciliationRecord(input: {
    fundingIntentId: string;
    routeLegId: string;
    targetVenue: FundingRouteLeg["targetVenue"];
    destinationTxHash?: string | null;
    destinationReceived: boolean;
    venueCreditConfirmed: boolean;
    readyToTrade: boolean;
    notes?: string;
  }): Promise<FundingReconciliationRecord> {
    const record: FundingReconciliationRecord = {
      reconciliationId: `reconciliation-${this.auditCounter + 1}`,
      fundingIntentId: input.fundingIntentId,
      routeLegId: input.routeLegId,
      targetVenue: input.targetVenue,
      destinationTxHash: input.destinationTxHash ?? null,
      destinationReceived: input.destinationReceived,
      venueCreditConfirmed: input.venueCreditConfirmed,
      readyToTrade: input.readyToTrade,
      checkedAt: new Date().toISOString(),
      notes: input.notes ?? ""
    };
    this.reconciliations.set(input.fundingIntentId, [...(this.reconciliations.get(input.fundingIntentId) ?? []), record]);
    return record;
  }

  public async appendAuditEvent(input: { fundingIntentId: string; routeLegId?: string | null; eventType: string; payload: Record<string, unknown> }): Promise<string> {
    this.auditCounter += 1;
    this.auditEvents.push(input);
    return `audit-${this.auditCounter}`;
  }

  public async hasReadyVenueBalance(): Promise<boolean> {
    return this.ready;
  }
}

class StubPolymarketBalanceReadClient implements PolymarketFundingBalanceReadClient {
  public usableBalance = "0";
  public shouldThrow = false;

  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    if (this.shouldThrow) {
      throw new Error("read unavailable");
    }
    return { usableBalance: this.usableBalance, raw: { source: "stub" } };
  }
}

class StubLimitlessBalanceReadClient implements LimitlessFundingBalanceReadClient {
  public usableBalance = "0";
  public shouldThrow = false;

  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    if (this.shouldThrow) {
      throw new Error("read unavailable");
    }
    return { usableBalance: this.usableBalance, raw: { source: "stub" } };
  }
}

class StubLifiProvider implements LifiRouteProvider {
  public async quote(input: Parameters<LifiRouteProvider["quote"]>[0]): Promise<FundingRouteQuote> {
    return {
      provider: "LIFI",
      providerRouteId: "quote-1",
      sourceChain: input.fromChain,
      sourceToken: input.fromToken,
      sourceAmount: input.fromAmount,
      destinationChain: input.toChain,
      destinationToken: input.toToken,
      destinationAmountEstimate: input.fromAmount,
      estimatedFees: "1",
      estimatedTimeSeconds: 120,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      transactionRequest: {
        to: "0x2222222222222222222222222222222222222222",
        data: "0x1234",
        chainId: Number(input.toChain)
      },
      userSafeSummary: "safe quote"
    };
  }

  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    return { status: "PENDING", raw: {} };
  }
}

class CompletedLifiProvider extends StubLifiProvider {
  public async status(): Promise<Awaited<ReturnType<LifiRouteProvider["status"]>>> {
    return { status: "DONE_COMPLETED", raw: { status: "DONE", substatus: "COMPLETED" } };
  }
}

describe("Funding v0 domain", () => {
  it("validates funding intent input and aggregate states", () => {
    expect(validateCreateFundingIntentInput({
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "wallet",
      idempotencyKey: "idem",
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    }).sourceToken).toBe("USDC");
    expect(aggregateFundingStatus(["LEG_READY_TO_TRADE", "LEG_BRIDGE_PENDING"])).toBe("PARTIALLY_READY_TO_TRADE");
    expect(aggregateFundingStatus(["LEG_FAILED"])).toBe("FAILED");
  });

  it("exposes frontend-safe venue capabilities without deposit secrets", () => {
    const matrix = buildVenueCapabilityMatrix({ env });
    expect(matrix.POLYMARKET.readinessStatus).toBe("READY");
    const repository = new InMemoryFundingRepository();
    const service = new FundingService(repository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env
    });
    expect(JSON.stringify(service.listVenueCapabilities())).not.toContain(env.POLYMARKET_FUNDING_DESTINATION_ADDRESS);
  });

  it("creates split-capable intents, quotes route legs, and blocks stale replay", async () => {
    const repository = new InMemoryFundingRepository();
    const service = new FundingService(repository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env
    });
    const created = await service.createIntent("user-1", {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "wallet",
      idempotencyKey: "idem",
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    const quoted = await service.quoteIntent("user-1", created.intent.fundingIntentId);
    expect(quoted.routeLegs).toHaveLength(1);
    expect(quoted.intent.status).toBe("USER_SIGNATURE_REQUIRED");
    const submitted = await service.submitRouteLeg("user-1", created.intent.fundingIntentId, {
      routeLegId: quoted.routeLegs[0]!.routeLegId,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    expect(submitted.routeLegs[0]!.status).toBe("LEG_BRIDGE_PENDING");
    await expect(service.submitRouteLeg("user-1", created.intent.fundingIntentId, {
      routeLegId: quoted.routeLegs[0]!.routeLegId,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })).rejects.toMatchObject({ code: "FUNDING_ROUTE_REPLAY_BLOCKED" });
  });

  it("fails closed when LI.FI quotes are disabled or split is invalid", async () => {
    const service = new FundingService(new InMemoryFundingRepository(), new StubLifiProvider(), {
      lifiQuotesEnabled: false,
      liveSubmitEnabled: false,
      env
    });
    await expect(service.createIntent("user-1", {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "wallet",
      idempotencyKey: "idem",
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 99 }]
    })).rejects.toBeInstanceOf(FundingError);
  });

  it("normalizes LI.FI quote/status safely and rejects destination drift", () => {
    const quote = normalizeLifiQuote({
      id: "route-1",
      action: {
        toChainId: 137,
        toToken: { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" }
      },
      estimate: {
        toAmount: "990",
        executionDuration: 120,
        feeCosts: [],
        gasCosts: []
      },
      transactionRequest: {
        to: "0xabc",
        data: "0x1234",
        authorization: "secret"
      }
    }, {
      fromChain: "SOLANA",
      toChain: "137",
      fromToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      toToken: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      fromAmount: "1000",
      fromAddress: "wallet",
      toAddress: "0x1111111111111111111111111111111111111111",
      targetVenue: "POLYMARKET"
    }, 60);
    expect(JSON.stringify(quote)).not.toContain("secret");
    expect(normalizeLifiStatus({ status: "DONE", substatus: "PARTIAL" })).toBe("DONE_PARTIAL");
    expect(() => normalizeLifiQuote({
      action: { toChainId: 10, toToken: { address: "0xwrong" } },
      estimate: {}
    }, {
      fromChain: "SOLANA",
      toChain: "137",
      fromToken: "source",
      toToken: "target",
      fromAmount: "1",
      fromAddress: "wallet",
      toAddress: "destination",
      targetVenue: "POLYMARKET"
    }, 60)).toThrow(FundingError);
  });

  it("gates execution preflight on exact ready funding when enabled", async () => {
    const repository = new InMemoryFundingRepository();
    const service = new FundingService(repository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env
    });
    const checker = new FundingReadinessChecker(service, true);
    await expect(checker.hasFunding({ request: executionRequest() })).resolves.toBe(false);
    repository.ready = true;
    await expect(checker.hasFunding({ request: executionRequest() })).resolves.toBe(true);
  });

  it("uses Polymarket readiness checker as the only authority for ready-to-trade", async () => {
    const repository = new InMemoryFundingRepository();
    const balanceClient = new StubPolymarketBalanceReadClient();
    const service = new FundingService(
      repository,
      new CompletedLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        venueReadinessChecksEnabled: true,
        env
      },
      new Map([[
        "POLYMARKET",
        new PolymarketFundingReadinessChecker(balanceClient, {
          enabled: true,
          env,
          now: () => new Date("2026-04-25T00:00:00.000Z")
        })
      ]])
    );
    const created = await service.createIntent("user-1", {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "wallet",
      idempotencyKey: "readiness-idem",
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    const quoted = await service.quoteIntent("user-1", created.intent.fundingIntentId);
    const routeLegId = quoted.routeLegs[0]!.routeLegId;
    await service.submitRouteLeg("user-1", created.intent.fundingIntentId, {
      routeLegId,
      txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    });

    balanceClient.usableBalance = "99.99";
    const pending = await service.refreshIntentStatus("user-1", created.intent.fundingIntentId);
    expect(pending.intent.status).toBe("ROUTES_SUBMITTED");
    expect(pending.routeLegs[0]!.status).toBe("LEG_VENUE_CREDIT_PENDING");
    expect(pending.reconciliations[0]).toMatchObject({
      destinationReceived: true,
      venueCreditConfirmed: false,
      readyToTrade: false
    });
    expect(repository.auditEvents.map((event) => event.eventType)).toContain("FUNDING_LEG_VENUE_CREDIT_PENDING");

    balanceClient.usableBalance = "100";
    const ready = await service.verifyVenueReadiness("user-1", created.intent.fundingIntentId, routeLegId);
    expect(ready.intent.status).toBe("READY_TO_TRADE");
    expect(ready.routeLegs[0]!.status).toBe("LEG_READY_TO_TRADE");
    expect(ready.reconciliations.at(-1)).toMatchObject({
      destinationReceived: true,
      venueCreditConfirmed: true,
      readyToTrade: true
    });
    expect(repository.auditEvents.map((event) => event.eventType)).toContain("FUNDING_READY_TO_TRADE");
  });

  it("keeps Polymarket readiness fail-closed when disabled or read response is unavailable", async () => {
    const balanceClient = new StubPolymarketBalanceReadClient();
    const disabledChecker = new PolymarketFundingReadinessChecker(balanceClient, {
      enabled: false,
      env,
      now: () => new Date("2026-04-25T00:00:00.000Z")
    });
    const leg = {
      routeLegId: "leg-1",
      fundingIntentId: "intent-1",
      fundingTargetId: "target-1",
      targetVenue: "POLYMARKET" as const,
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      destinationAmountEstimate: "100",
      routeProvider: "LIFI" as const,
      routeQuote: await new StubLifiProvider().quote({
        fromChain: "SOLANA",
        toChain: "137",
        fromToken: "source",
        toToken: "target",
        fromAmount: "100",
        fromAddress: "wallet",
        toAddress: "destination",
        targetVenue: "POLYMARKET"
      }),
      txHashes: ["0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"],
      providerStatus: {},
      bridgeStatus: "DONE",
      destinationStatus: "CONFIRMED",
      venueCreditStatus: "PENDING",
      status: "LEG_VENUE_CREDIT_PENDING" as const,
      errorReason: null,
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z"
    };
    const intent = {
      fundingIntentId: "intent-1",
      userId: "user-1",
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "wallet",
      status: "ROUTES_SUBMITTED" as const,
      idempotencyKey: "idem",
      aggregateRouteQuote: {},
      totalEstimatedFees: "0",
      totalEstimatedTimeSeconds: null,
      auditEventIds: [],
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z"
    };

    await expect(disabledChecker.check({ userId: "user-1", intent, leg, reconciliations: [] }))
      .resolves.toMatchObject({ status: "UNKNOWN", readyToTrade: false, reason: "POLYMARKET_FUNDING_READINESS_DISABLED" });

    balanceClient.shouldThrow = true;
    const enabledChecker = new PolymarketFundingReadinessChecker(balanceClient, {
      enabled: true,
      env,
      now: () => new Date("2026-04-25T00:00:00.000Z")
    });
    await expect(enabledChecker.check({ userId: "user-1", intent, leg, reconciliations: [] }))
      .resolves.toMatchObject({ status: "UNKNOWN", readyToTrade: false });

    balanceClient.shouldThrow = false;
    balanceClient.usableBalance = "not-a-number";
    await expect(enabledChecker.check({ userId: "user-1", intent, leg, reconciliations: [] }))
      .resolves.toMatchObject({ status: "UNKNOWN", readyToTrade: false, reason: "POLYMARKET_BALANCE_RESPONSE_MALFORMED" });
  });

  it("uses Limitless readiness checker as venue-specific authority", async () => {
    expect(buildVenueCapabilityMatrix({ env }).LIMITLESS.readinessStatus).toBe("READY");
    expect(getLimitlessFundingReadinessConfigFromEnv({} as NodeJS.ProcessEnv)).toMatchObject({
      enabled: false,
      mode: "DISABLED",
      configured: false
    });
    expect(getLimitlessFundingReadinessConfigFromEnv({
      LIMITLESS_FUNDING_READINESS_MODE: "LIVE_READ",
      LIMITLESS_FUNDING_BALANCE_URL: "https://operator.example/limitless-readiness",
      LIMITLESS_FUNDING_READ_AUTH_MODE: "BEARER"
    } as NodeJS.ProcessEnv)).toMatchObject({
      enabled: true,
      mode: "LIVE_READ",
      authMode: "BEARER",
      configured: true
    });

    const balanceClient = new StubLimitlessBalanceReadClient();
    const checker = new LimitlessFundingReadinessChecker(balanceClient, {
      mode: "STUB",
      env,
      now: () => new Date("2026-04-25T00:00:00.000Z")
    });
    const leg = {
      routeLegId: "limitless-leg-1",
      fundingIntentId: "limitless-intent-1",
      fundingTargetId: "limitless-target-1",
      targetVenue: "LIMITLESS" as const,
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "50",
      destinationChain: "BASE",
      destinationToken: "USDC",
      destinationAmountEstimate: "50",
      routeProvider: "LIFI" as const,
      routeQuote: await new StubLifiProvider().quote({
        fromChain: "SOLANA",
        toChain: "8453",
        fromToken: "source",
        toToken: "target",
        fromAmount: "50",
        fromAddress: "wallet",
        toAddress: "destination",
        targetVenue: "LIMITLESS"
      }),
      txHashes: ["0x1111111111111111111111111111111111111111111111111111111111111111"],
      providerStatus: {},
      bridgeStatus: "DONE",
      destinationStatus: "CONFIRMED",
      venueCreditStatus: "PENDING",
      status: "LEG_VENUE_CREDIT_PENDING" as const,
      errorReason: null,
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z"
    };
    const intent = {
      fundingIntentId: "limitless-intent-1",
      userId: "user-1",
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "50",
      sourceWalletAddress: "wallet",
      status: "ROUTES_SUBMITTED" as const,
      idempotencyKey: "limitless-idem",
      aggregateRouteQuote: {},
      totalEstimatedFees: "0",
      totalEstimatedTimeSeconds: null,
      auditEventIds: [],
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z"
    };

    balanceClient.usableBalance = "49.99";
    await expect(checker.check({ userId: "user-1", intent, leg, reconciliations: [] }))
      .resolves.toMatchObject({
        venue: "LIMITLESS",
        status: "VENUE_CREDIT_PENDING",
        readyToTrade: false,
        reason: "LIMITLESS_USABLE_BALANCE_BELOW_REQUIRED_AMOUNT"
      });

    balanceClient.usableBalance = "50";
    const ready = await checker.check({ userId: "user-1", intent, leg, reconciliations: [] });
    expect(ready).toMatchObject({
      venue: "LIMITLESS",
      status: "READY_TO_TRADE",
      readyToTrade: true,
      reason: "LIMITLESS_USABLE_BALANCE_CONFIRMED",
      evidence: {
        source: "limitless_funding_readiness",
        checkerMode: "STUB"
      }
    });
    expect(JSON.stringify(ready)).not.toContain("authorization");
    expect(JSON.stringify(ready)).not.toContain("privateKey");

    balanceClient.usableBalance = "not-a-number";
    await expect(checker.check({ userId: "user-1", intent, leg, reconciliations: [] }))
      .resolves.toMatchObject({ status: "UNKNOWN", readyToTrade: false, reason: "LIMITLESS_BALANCE_RESPONSE_MALFORMED" });
  });

  it("validates Polymarket operator readiness config and redacts live-read evidence", async () => {
    expect(getPolymarketFundingReadinessConfigFromEnv({} as NodeJS.ProcessEnv)).toMatchObject({
      enabled: false,
      mode: "DISABLED",
      configured: false
    });
    expect(getPolymarketFundingReadinessConfigFromEnv({
      POLYMARKET_FUNDING_READINESS_MODE: "LIVE_READ",
      POLYMARKET_FUNDING_BALANCE_URL: "https://operator.example/readiness",
      POLYMARKET_FUNDING_READ_AUTH_MODE: "BEARER",
      POLYMARKET_FUNDING_READ_TIMEOUT_MS: "9000",
      POLYMARKET_FUNDING_MIN_CONFIRMATIONS: "3"
    } as NodeJS.ProcessEnv)).toMatchObject({
      enabled: true,
      mode: "LIVE_READ",
      authMode: "BEARER",
      timeoutMs: 9000,
      minimumConfirmations: 3,
      configured: true
    });

    let observedAuthorization: string | null = null;
    const client = new HttpPolymarketFundingBalanceReadClient({
      balanceUrl: "https://operator.example/readiness",
      authMode: "BEARER",
      apiKey: "server-side-secret",
      fetchImpl: async (_url, init) => {
        observedAuthorization = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({
          usableBalance: "100",
          authorization: "server-side-secret",
          privateKey: "never-return-this"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const checker = new PolymarketFundingReadinessChecker(client, {
      mode: "LIVE_READ",
      balanceUrl: "https://operator.example/readiness",
      authMode: "BEARER",
      minimumConfirmations: 3,
      env,
      now: () => new Date("2026-04-25T00:00:00.000Z")
    });
    const leg = {
      routeLegId: "leg-live-read",
      fundingIntentId: "intent-live-read",
      fundingTargetId: "target-live-read",
      targetVenue: "POLYMARKET" as const,
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      destinationAmountEstimate: "100",
      routeProvider: "LIFI" as const,
      routeQuote: await new StubLifiProvider().quote({
        fromChain: "SOLANA",
        toChain: "137",
        fromToken: "source",
        toToken: "target",
        fromAmount: "100",
        fromAddress: "wallet",
        toAddress: "destination",
        targetVenue: "POLYMARKET"
      }),
      txHashes: ["0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"],
      providerStatus: {},
      bridgeStatus: "DONE",
      destinationStatus: "CONFIRMED",
      venueCreditStatus: "PENDING",
      status: "LEG_VENUE_CREDIT_PENDING" as const,
      errorReason: null,
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z"
    };
    const intent = {
      fundingIntentId: "intent-live-read",
      userId: "user-1",
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "wallet",
      status: "ROUTES_SUBMITTED" as const,
      idempotencyKey: "idem-live-read",
      aggregateRouteQuote: {},
      totalEstimatedFees: "0",
      totalEstimatedTimeSeconds: null,
      auditEventIds: [],
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z"
    };

    const result = await checker.check({ userId: "user-1", intent, leg, reconciliations: [] });
    expect(observedAuthorization).toBe("Bearer server-side-secret");
    expect(result).toMatchObject({
      status: "READY_TO_TRADE",
      readyToTrade: true,
      evidence: {
        source: "polymarket_funding_readiness",
        checkerMode: "LIVE_READ",
        authMode: "BEARER",
        minimumConfirmations: 3
      }
    });
    expect(JSON.stringify(result)).not.toContain("server-side-secret");
    expect(JSON.stringify(result)).not.toContain("privateKey");
    expect(JSON.stringify(result)).not.toContain("authorization");
  });
});
