import { describe, expect, it } from "vitest";

import {
  aggregateFundingStatus,
  aggregateWithdrawalStatus,
  FundingError,
  validateCreateWithdrawalIntentInput,
  validateCreateFundingIntentInput,
  type FundingIntent,
  type FundingReconciliationRecord,
  type FundingRouteLeg,
  type FundingRouteQuote,
  type FundingTarget,
  type FundingVenue,
  type VenueBalanceView,
  type WithdrawalAggregateState,
  type WithdrawalIntent,
  type WithdrawalLegState,
  type WithdrawalReconciliationRecord,
  type WithdrawalRouteLeg,
  type WithdrawalSource
} from "../src/core/funding/types.js";
import {
  FundingReadinessChecker,
  FundingService,
  type FundingRepository,
  type WithdrawalCompletionEvidenceChecker,
  type WithdrawalCompletionEvidenceResult,
  type WithdrawalCompletionPersistenceGate
} from "../src/core/funding/funding-service.js";
import { buildVenueCapabilityMatrix } from "../src/core/funding/venue-capabilities.js";
import {
  ConfigurableVenueFundingReadinessChecker,
  getFundingReadinessConfigFromEnv,
  getLimitlessFundingReadinessConfigFromEnv,
  getMyriadFundingReadinessConfigFromEnv,
  getOpinionFundingReadinessConfigFromEnv,
  getPredictFunFundingReadinessConfigFromEnv,
  getPolymarketFundingReadinessConfigFromEnv,
  HttpPolymarketFundingBalanceReadClient,
  LimitlessFundingReadinessChecker,
  PolymarketFundingReadinessChecker,
  type FundingBalanceReadClient,
  type LimitlessFundingBalanceReadClient,
  type PolymarketFundingBalanceReadClient
} from "../src/core/funding/venue-readiness.js";
import {
  buildPolymarketWithdrawalEvidenceCheckerFromEnv,
  getPolymarketWithdrawalEvidenceConfigFromEnv,
  HttpPolymarketWithdrawalEvidenceReadClient,
  PolymarketWithdrawalEvidenceChecker,
  type PolymarketWithdrawalEvidenceReadClient
} from "../src/core/funding/withdrawal-evidence.js";
import {
  MockPolymarketBridgeWithdrawalClient,
  PolymarketBridgeWithdrawalAdapter
} from "../src/core/funding/polymarket-bridge-withdrawal-adapter.js";
import {
  PredictFunWithdrawalAdapter,
  getPredictFunWithdrawalConfigFromEnv
} from "../src/core/funding/predictfun-withdrawal-adapter.js";
import {
  MyriadWalletWithdrawalAdapter,
  getMyriadWithdrawalConfigFromEnv
} from "../src/core/funding/myriad-withdrawal-adapter.js";
import {
  OpinionSafeWithdrawalAdapter,
  getOpinionWithdrawalConfigFromEnv
} from "../src/core/funding/opinion-withdrawal-adapter.js";
import {
  fromBaseUnitAmount,
  LifiRestClient,
  normalizeLifiQuote,
  normalizeLifiStatus,
  toBaseUnitAmount,
  toLifiChain,
  type LifiRouteProvider
} from "../src/integrations/lifi/lifi-client.js";
import type { UserWallet } from "../src/core/funding/user-wallets.js";
import { zeroFees, type ExecutionRequestV0 } from "../src/execution-system/types.js";

const env = {
  POLYMARKET_FUNDING_DESTINATION_ADDRESS: "0x1111111111111111111111111111111111111111",
  LIMITLESS_FUNDING_DESTINATION_ADDRESS: "0x3333333333333333333333333333333333333333",
  OPINION_FUNDING_DESTINATION_ADDRESS: "0x4444444444444444444444444444444444444444",
  MYRIAD_FUNDING_DESTINATION_ADDRESS: "0x5555555555555555555555555555555555555555",
  PREDICT_FUN_FUNDING_DESTINATION_ADDRESS: "0x6666666666666666666666666666666666666666"
} as NodeJS.ProcessEnv;

const withdrawalEnv = {
  ...env,
  POLYMARKET_FUNDING_WITHDRAWALS_ENABLED: "true",
  LIMITLESS_FUNDING_WITHDRAWALS_ENABLED: "true",
  OPINION_FUNDING_WITHDRAWALS_ENABLED: "true",
  PREDICT_FUN_FUNDING_WITHDRAWALS_ENABLED: "true",
  MYRIAD_FUNDING_WITHDRAWALS_ENABLED: "true"
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

const userWallet = (overrides: Partial<UserWallet>): UserWallet => ({
  walletId: "wallet-1",
  userId: "user-1",
  provider: "TURNKEY",
  providerSubOrgId: "suborg-1",
  providerWalletId: "turnkey-wallet-1",
  providerWalletAccountId: "account-1",
  chainFamily: "SOLANA",
  chain: "SOLANA",
  address: "So11111111111111111111111111111111111111111",
  purpose: "DEFAULT_FUNDING",
  venue: null,
  exportable: true,
  status: "ACTIVE",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  ...overrides
});

class InMemoryFundingRepository implements FundingRepository {
  public intents = new Map<string, FundingIntent>();
  public targets = new Map<string, FundingTarget[]>();
  public legs = new Map<string, FundingRouteLeg[]>();
  public reconciliations = new Map<string, FundingReconciliationRecord[]>();
  public withdrawalIntents = new Map<string, WithdrawalIntent>();
  public withdrawalSources = new Map<string, WithdrawalSource[]>();
  public withdrawalLegs = new Map<string, WithdrawalRouteLeg[]>();
  public withdrawalReconciliations = new Map<string, WithdrawalReconciliationRecord[]>();
  public auditEvents: Array<{ fundingIntentId: string; routeLegId?: string | null; eventType: string; payload: Record<string, unknown> }> = [];
  public withdrawalAuditEvents: Array<{ withdrawalIntentId: string; withdrawalRouteLegId?: string | null; eventType: string; payload: Record<string, unknown> }> = [];
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

  public async listVenueBalances(): Promise<VenueBalanceView[]> {
    return this.ready
      ? [{
        venue: "POLYMARKET",
        token: "USDC",
        readyAmount: "100",
        pendingWithdrawalAmount: "0",
        availableAmount: "100",
        updatedAt: new Date().toISOString()
      }, {
        venue: "POLYMARKET",
        token: "USDT",
        readyAmount: "100",
        pendingWithdrawalAmount: "0",
        availableAmount: "100",
        updatedAt: new Date().toISOString()
      }, {
        venue: "POLYMARKET",
        token: "USD1",
        readyAmount: "100",
        pendingWithdrawalAmount: "0",
        availableAmount: "100",
        updatedAt: new Date().toISOString()
      }, {
          venue: "PREDICT_FUN",
          token: "USDC",
          readyAmount: "100",
          pendingWithdrawalAmount: "0",
          availableAmount: "100",
          updatedAt: new Date().toISOString()
        }, {
          venue: "OPINION",
          token: "USDT",
          readyAmount: "100",
          pendingWithdrawalAmount: "0",
          availableAmount: "100",
          updatedAt: new Date().toISOString()
        }, {
          venue: "MYRIAD",
          token: "USD1",
          readyAmount: "100",
          pendingWithdrawalAmount: "0",
          availableAmount: "100",
          updatedAt: new Date().toISOString()
        }, {
          venue: "PREDICT_FUN",
          token: "USDT",
          readyAmount: "100",
          pendingWithdrawalAmount: "0",
          availableAmount: "100",
          updatedAt: new Date().toISOString()
        }]
      : [];
  }

  public async findWithdrawalIntentById(id: string): Promise<WithdrawalIntent | null> {
    return this.withdrawalIntents.get(id) ?? null;
  }

  public async findWithdrawalIntentByUserAndIdempotencyKey(userId: string, idempotencyKey: string): Promise<WithdrawalIntent | null> {
    return [...this.withdrawalIntents.values()].find((intent) => intent.userId === userId && intent.idempotencyKey === idempotencyKey) ?? null;
  }

  public async createWithdrawalIntent(input: WithdrawalIntent, sources: WithdrawalSource[]): Promise<WithdrawalIntent> {
    this.withdrawalIntents.set(input.withdrawalIntentId, input);
    this.withdrawalSources.set(input.withdrawalIntentId, sources);
    return input;
  }

  public async listWithdrawalSources(withdrawalIntentId: string): Promise<WithdrawalSource[]> {
    return this.withdrawalSources.get(withdrawalIntentId) ?? [];
  }

  public async listWithdrawalRouteLegs(withdrawalIntentId: string): Promise<WithdrawalRouteLeg[]> {
    return this.withdrawalLegs.get(withdrawalIntentId) ?? [];
  }

  public async listWithdrawalReconciliations(withdrawalIntentId: string): Promise<WithdrawalReconciliationRecord[]> {
    return this.withdrawalReconciliations.get(withdrawalIntentId) ?? [];
  }

  public async replaceWithdrawalRouteLegs(withdrawalIntentId: string, routeLegs: WithdrawalRouteLeg[]): Promise<void> {
    this.withdrawalLegs.set(withdrawalIntentId, routeLegs);
  }

  public async updateWithdrawalIntentStatus(withdrawalIntentId: string, status: WithdrawalAggregateState, patch: Record<string, unknown> = {}): Promise<void> {
    const intent = this.withdrawalIntents.get(withdrawalIntentId)!;
    this.withdrawalIntents.set(withdrawalIntentId, {
      ...intent,
      status,
      aggregateRouteQuote: (patch.aggregateRouteQuote as Record<string, unknown>) ?? intent.aggregateRouteQuote,
      totalEstimatedFees: typeof patch.totalEstimatedFees === "string" ? patch.totalEstimatedFees : intent.totalEstimatedFees,
      totalEstimatedTimeSeconds: typeof patch.totalEstimatedTimeSeconds === "number" ? patch.totalEstimatedTimeSeconds : intent.totalEstimatedTimeSeconds
    });
  }

  public async updateWithdrawalRouteLegSubmission(input: { withdrawalRouteLegId: string; txHash: string; status: WithdrawalLegState }): Promise<void> {
    for (const [intentId, legs] of this.withdrawalLegs.entries()) {
      this.withdrawalLegs.set(intentId, legs.map((leg) => leg.withdrawalRouteLegId === input.withdrawalRouteLegId ? {
        ...leg,
        status: input.status,
        txHashes: [...leg.txHashes, input.txHash],
        venueReleaseStatus: "PENDING"
      } : leg));
    }
  }

  public async updateWithdrawalRouteLegReconciliation(input: {
    withdrawalRouteLegId: string;
    status: WithdrawalLegState;
    venueReleaseStatus: string;
    destinationStatus: string;
    providerStatus: Record<string, unknown>;
    errorReason?: string | null;
  }): Promise<void> {
    for (const [intentId, legs] of this.withdrawalLegs.entries()) {
      this.withdrawalLegs.set(intentId, legs.map((leg) => leg.withdrawalRouteLegId === input.withdrawalRouteLegId ? {
        ...leg,
        status: input.status,
        venueReleaseStatus: input.venueReleaseStatus,
        destinationStatus: input.destinationStatus,
        providerStatus: input.providerStatus,
        errorReason: input.errorReason ?? null
      } : leg));
    }
  }

  public async createWithdrawalReconciliationRecord(input: {
    withdrawalIntentId: string;
    withdrawalRouteLegId: string;
    sourceVenue: FundingVenue;
    withdrawalTxHash?: string | null;
    venueReleased: boolean;
    destinationReceived: boolean;
    completed: boolean;
    notes?: string;
  }): Promise<WithdrawalReconciliationRecord> {
    const record: WithdrawalReconciliationRecord = {
      withdrawalReconciliationId: `withdrawal-reconciliation-${this.auditCounter + 1}`,
      withdrawalIntentId: input.withdrawalIntentId,
      withdrawalRouteLegId: input.withdrawalRouteLegId,
      sourceVenue: input.sourceVenue,
      withdrawalTxHash: input.withdrawalTxHash ?? null,
      venueReleased: input.venueReleased,
      destinationReceived: input.destinationReceived,
      completed: input.completed,
      checkedAt: new Date().toISOString(),
      notes: input.notes ?? ""
    };
    this.withdrawalReconciliations.set(input.withdrawalIntentId, [
      record,
      ...(this.withdrawalReconciliations.get(input.withdrawalIntentId) ?? [])
    ]);
    return record;
  }

  public async appendWithdrawalAuditEvent(input: { withdrawalIntentId: string; withdrawalRouteLegId?: string | null; eventType: string; payload: Record<string, unknown> }): Promise<string> {
    this.auditCounter += 1;
    this.withdrawalAuditEvents.push(input);
    return `withdrawal-audit-${this.auditCounter}`;
  }
}

class StubWithdrawalCompletionChecker implements WithdrawalCompletionEvidenceChecker {
  public result: WithdrawalCompletionEvidenceResult = {
    status: "UNKNOWN",
    venueReleased: false,
    destinationReceived: false,
    completed: false,
    reason: "STUB_UNKNOWN",
    evidence: { source: "stub" }
  };

  public async check(): Promise<WithdrawalCompletionEvidenceResult> {
    return this.result;
  }
}

class BlockingWithdrawalCompletionPersistenceGate implements WithdrawalCompletionPersistenceGate {
  public calls = 0;

  public async assertCanPersist(): Promise<void> {
    this.calls += 1;
    throw new FundingError("WITHDRAWAL_COMPLETION_PERSISTENCE_BLOCKED", "smoke artifact gate failed", 409);
  }
}

class StubPolymarketWithdrawalEvidenceReadClient implements PolymarketWithdrawalEvidenceReadClient {
  public raw: Record<string, unknown> = {};
  public shouldThrow = false;

  public async fetchEvidence(): Promise<Record<string, unknown>> {
    if (this.shouldThrow) {
      throw new Error("evidence unavailable");
    }
    return this.raw;
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

class StubFundingBalanceReadClient implements FundingBalanceReadClient {
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

  it("validates withdrawal intent input and aggregate states", () => {
    expect(validateCreateWithdrawalIntentInput({
      token: "USDC",
      amount: "100",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-idem",
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    }).token).toBe("USDC");
    expect(() => validateCreateWithdrawalIntentInput({
      token: "USDC",
      amount: "100",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-invalid-source",
      sources: [{ sourceVenue: "POLYMARKET", sourceAmount: "100", sourcePercentage: 100 }]
    })).toThrow();
    expect(aggregateWithdrawalStatus(["WITHDRAWAL_LEG_COMPLETED", "VENUE_RELEASE_PENDING"])).toBe("PARTIALLY_COMPLETED");
    expect(aggregateWithdrawalStatus(["WITHDRAWAL_LEG_FAILED"])).toBe("FAILED");
  });

  it("exposes frontend-safe venue capabilities without deposit secrets", () => {
    const matrix = buildVenueCapabilityMatrix({ env });
    expect(matrix.POLYMARKET.readinessStatus).toBe("READY");
    expect(matrix.OPINION.readinessStatus).toBe("READY");
    expect(matrix.MYRIAD.readinessStatus).toBe("READY");
    expect(matrix.PREDICT_FUN.readinessStatus).toBe("READY");
    expect(matrix.POLYMARKET).toMatchObject({
      withdrawalMode: "USER_SIGNED",
      userSignedWithdrawalSupported: true,
      partnerManagedWithdrawal: null
    });
    expect(matrix.OPINION).toMatchObject({
      withdrawalMode: "USER_SIGNED",
      userSignedWithdrawalSupported: true,
      partnerManagedWithdrawal: null
    });
    expect(matrix.MYRIAD).toMatchObject({
      withdrawalMode: "USER_SIGNED",
      userSignedWithdrawalSupported: true,
      partnerManagedWithdrawal: null
    });
    expect(matrix.PREDICT_FUN).toMatchObject({
      withdrawalMode: "USER_SIGNED",
      userSignedWithdrawalSupported: true,
      partnerManagedWithdrawal: null
    });
    expect(buildVenueCapabilityMatrix({ env: withdrawalEnv }).LIMITLESS).toMatchObject({
      supportsWithdrawal: false,
      withdrawalMode: "AUTO_RESOLUTION_ONLY",
      userSignedWithdrawalSupported: false,
      partnerManagedWithdrawal: {
        mode: "PARTNER_MANAGED_BACKEND",
        enabled: false,
        requiresHmacAuth: true,
        requiresWithdrawalScope: true,
        requiresCustodySecurityApproval: true
      }
    });
    expect(buildVenueCapabilityMatrix({ env: {} as NodeJS.ProcessEnv }).OPINION.readinessStatus).toBe("DISABLED");
    const predictFunBscUsdtMatrix = buildVenueCapabilityMatrix({
      env: {
        ...env,
        PREDICT_FUN_FUNDING_PREFERRED_CHAIN: "BSC",
        PREDICT_FUN_FUNDING_PREFERRED_CHAIN_ID: "56",
        PREDICT_FUN_FUNDING_PREFERRED_TOKEN: "USDT"
      } as NodeJS.ProcessEnv
    });
    expect(predictFunBscUsdtMatrix.PREDICT_FUN.preferredChain).toBe("BSC");
    expect(predictFunBscUsdtMatrix.PREDICT_FUN.preferredChainId).toBe(56);
    expect(predictFunBscUsdtMatrix.PREDICT_FUN.preferredToken).toBe("USDT");
    expect(predictFunBscUsdtMatrix.PREDICT_FUN.supportedTokens).toEqual(["USDT"]);
    const opinionBscUsdtMatrix = buildVenueCapabilityMatrix({
      env: {
        ...env,
        OPINION_FUNDING_PREFERRED_CHAIN: "BSC",
        OPINION_FUNDING_PREFERRED_CHAIN_ID: "56",
        OPINION_FUNDING_PREFERRED_TOKEN: "USDT"
      } as NodeJS.ProcessEnv
    });
    expect(opinionBscUsdtMatrix.OPINION.preferredChain).toBe("BSC");
    expect(opinionBscUsdtMatrix.OPINION.preferredChainId).toBe(56);
    expect(opinionBscUsdtMatrix.OPINION.preferredToken).toBe("USDT");
    expect(opinionBscUsdtMatrix.OPINION.supportedTokens).toEqual(["USDT"]);
    const myriadBscUsd1Matrix = buildVenueCapabilityMatrix({
      env: {
        ...env,
        MYRIAD_FUNDING_PREFERRED_CHAIN: "BSC",
        MYRIAD_FUNDING_PREFERRED_CHAIN_ID: "56",
        MYRIAD_FUNDING_PREFERRED_TOKEN: "USD1",
        MYRIAD_USD1_TOKEN_ADDRESS: "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d"
      } as NodeJS.ProcessEnv
    });
    expect(myriadBscUsd1Matrix.MYRIAD.preferredChain).toBe("BSC");
    expect(myriadBscUsd1Matrix.MYRIAD.preferredChainId).toBe(56);
    expect(myriadBscUsd1Matrix.MYRIAD.preferredToken).toBe("USD1");
    expect(myriadBscUsd1Matrix.MYRIAD.supportedTokens).toEqual(["USD1"]);
    const repository = new InMemoryFundingRepository();
    const service = new FundingService(repository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env
    });
    expect(JSON.stringify(service.listVenueCapabilities())).not.toContain(env.POLYMARKET_FUNDING_DESTINATION_ADDRESS);
    expect(JSON.stringify(service.listVenueCapabilities())).not.toContain(env.OPINION_FUNDING_DESTINATION_ADDRESS);
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

  it("resolves default Turnkey Solana source wallets without marking funds ready", async () => {
    const repository = new InMemoryFundingRepository();
    const solanaWallet = userWallet({
      walletId: "wallet-sol",
      userId: "user-1",
      chainFamily: "SOLANA",
      chain: "SOLANA",
      address: "So11111111111111111111111111111111111111111"
    });
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env
      },
      new Map(),
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      {
        resolveFundingSourceWallet: async (input) => input.userId === "user-1" ? solanaWallet : null,
        resolveUserTurnkeyEvmFundingWallet: async () => null
      }
    );
    const created = await service.createIntent("user-1", {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      idempotencyKey: "turnkey-source",
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    expect(created.intent.sourceWalletId).toBe("wallet-sol");
    expect(created.intent.sourceWalletAddress).toBe(solanaWallet.address);
    expect(repository.ready).toBe(false);
  });

  it("rejects missing Turnkey EVM target wallets when a venue opts into user wallet destinations", async () => {
    const repository = new InMemoryFundingRepository();
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: {
          ...env,
          POLYMARKET_FUNDING_DESTINATION_MODE: "USER_TURNKEY_EVM_WALLET"
        } as NodeJS.ProcessEnv
      },
      new Map(),
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      {
        resolveFundingSourceWallet: async () => null,
        resolveUserTurnkeyEvmFundingWallet: async () => null
      }
    );
    const created = await service.createIntent("user-1", {
      sourceChain: "SOLANA",
      sourceToken: "USDC",
      sourceAmount: "100",
      sourceWalletAddress: "So11111111111111111111111111111111111111111",
      idempotencyKey: "turnkey-target",
      targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
    });
    await expect(service.quoteIntent("user-1", created.intent.fundingIntentId))
      .rejects.toMatchObject({ code: "TARGET_WALLET_NOT_CONFIGURED" });
  });

  it("creates split-capable withdrawal intents, quotes route legs, and records user-broadcast tx hashes", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const service = new FundingService(repository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env: withdrawalEnv
    });
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "100",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-idem",
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    });
    expect(created.intent.status).toBe("WITHDRAWAL_CREATED");
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    expect(quoted.intent.status).toBe("USER_SIGNATURE_REQUIRED");
    expect(quoted.routeLegs[0]).toMatchObject({
      routeProvider: "LOTUS_WITHDRAWAL_V0",
      status: "WITHDRAWAL_LEG_SIGNATURE_REQUIRED"
    });
    expect(JSON.stringify(quoted)).not.toContain("authorization");
    expect(JSON.stringify(quoted)).not.toContain("privateKey");
    const submitted = await service.submitWithdrawalRouteLeg("user-1", created.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quoted.routeLegs[0]!.withdrawalRouteLegId,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    expect(submitted.intent.status).toBe("WITHDRAWING");
    expect(submitted.routeLegs[0]!.status).toBe("VENUE_RELEASE_PENDING");
    await expect(service.submitWithdrawalRouteLeg("user-1", created.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quoted.routeLegs[0]!.withdrawalRouteLegId,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })).rejects.toMatchObject({ code: "WITHDRAWAL_ROUTE_REPLAY_BLOCKED" });
  });

  it("reconciles withdrawal completion only from exact sanitized evidence", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const checker = new StubWithdrawalCompletionChecker();
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: withdrawalEnv
      },
      new Map(),
      checker
    );
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "40",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-completion-idem",
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    await service.submitWithdrawalRouteLeg("user-1", created.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quoted.routeLegs[0]!.withdrawalRouteLegId,
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    });

    checker.result = {
      status: "VENUE_RELEASED",
      venueReleased: true,
      destinationReceived: false,
      completed: false,
      withdrawalTxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      reason: "SANDBOX_VENUE_RELEASED",
      evidence: { source: "stub", rawProviderPayloadIncluded: false }
    };
    const releaseOnly = await service.refreshWithdrawalStatus("user-1", created.intent.withdrawalIntentId);
    expect(releaseOnly.intent.status).toBe("WITHDRAWING");
    expect(releaseOnly.routeLegs[0]).toMatchObject({
      status: "DESTINATION_PENDING",
      venueReleaseStatus: "CONFIRMED",
      destinationStatus: "PENDING"
    });
    expect(releaseOnly.reconciliations[0]).toMatchObject({
      venueReleased: true,
      destinationReceived: false,
      completed: false,
      notes: "SANDBOX_VENUE_RELEASED"
    });

    checker.result = {
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      withdrawalTxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "40",
      reason: "SANDBOX_DESTINATION_CONFIRMED",
      evidence: { source: "stub", confirmationCount: 1 }
    };
    const completed = await service.refreshWithdrawalStatus("user-1", created.intent.withdrawalIntentId);
    expect(completed.intent.status).toBe("COMPLETED");
    expect(completed.routeLegs[0]).toMatchObject({
      status: "WITHDRAWAL_LEG_COMPLETED",
      venueReleaseStatus: "CONFIRMED",
      destinationStatus: "CONFIRMED"
    });
    expect(completed.reconciliations[0]).toMatchObject({
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      notes: "SANDBOX_DESTINATION_CONFIRMED"
    });
    expect(repository.withdrawalAuditEvents.map((event) => event.eventType)).toContain("WITHDRAWAL_LEG_COMPLETED");
    expect(repository.withdrawalAuditEvents.map((event) => event.eventType)).toContain("WITHDRAWAL_COMPLETED");
  });

  it("fails withdrawal completion closed on mismatched destination evidence", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const checker = new StubWithdrawalCompletionChecker();
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: withdrawalEnv
      },
      new Map(),
      checker
    );
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "40",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-mismatch-idem",
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    await service.submitWithdrawalRouteLeg("user-1", created.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quoted.routeLegs[0]!.withdrawalRouteLegId,
      txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    });
    checker.result = {
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x2222222222222222222222222222222222222222",
      token: "USDC",
      amount: "40",
      reason: "DESTINATION_WALLET_MISMATCH",
      evidence: { source: "stub" }
    };
    const refreshed = await service.refreshWithdrawalStatus("user-1", created.intent.withdrawalIntentId);
    expect(refreshed.intent.status).toBe("PARTIALLY_FAILED");
    expect(refreshed.routeLegs[0]).toMatchObject({
      status: "WITHDRAWAL_LEG_RETRY_REQUIRED",
      errorReason: "DESTINATION_WALLET_MISMATCH"
    });
    expect(refreshed.reconciliations[0]).toMatchObject({
      venueReleased: true,
      destinationReceived: true,
      completed: false
    });
  });

  it("blocks completed withdrawal persistence when the smoke artifact gate fails", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const checker = new StubWithdrawalCompletionChecker();
    const gate = new BlockingWithdrawalCompletionPersistenceGate();
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: withdrawalEnv
      },
      new Map(),
      checker,
      gate
    );
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "40",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-completion-gate-idem",
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    await service.submitWithdrawalRouteLeg("user-1", created.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quoted.routeLegs[0]!.withdrawalRouteLegId,
      txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    });
    checker.result = {
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      withdrawalTxHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "40",
      reason: "SANDBOX_DESTINATION_CONFIRMED",
      evidence: { source: "stub", confirmationCount: 1 }
    };

    await expect(service.refreshWithdrawalStatus("user-1", created.intent.withdrawalIntentId)).rejects.toMatchObject({
      code: "WITHDRAWAL_COMPLETION_PERSISTENCE_BLOCKED"
    });
    expect(gate.calls).toBe(1);
    expect(repository.withdrawalReconciliations.get(created.intent.withdrawalIntentId)).toBeUndefined();
    expect((await service.getWithdrawalIntent("user-1", created.intent.withdrawalIntentId)).routeLegs[0]).toMatchObject({
      status: "VENUE_RELEASE_PENDING",
      venueReleaseStatus: "PENDING",
      destinationStatus: "NOT_CONFIRMED"
    });
  });

  it("uses Polymarket withdrawal evidence checker as read-only completion evidence", async () => {
    const client = new StubPolymarketWithdrawalEvidenceReadClient();
    const checker = new PolymarketWithdrawalEvidenceChecker(client, {
      mode: "STUB",
      minimumConfirmations: 2,
      now: () => new Date("2026-04-26T00:00:00.000Z")
    });
    const intent = {
      withdrawalIntentId: "withdrawal-intent-1",
      userId: "user-1",
      token: "USDC",
      amount: "40",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      status: "WITHDRAWING" as const,
      idempotencyKey: "withdraw-idem",
      aggregateRouteQuote: {},
      totalEstimatedFees: "0",
      totalEstimatedTimeSeconds: null,
      auditEventIds: [],
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    };
    const leg = {
      withdrawalRouteLegId: "withdrawal-leg-1",
      withdrawalIntentId: "withdrawal-intent-1",
      withdrawalSourceId: "withdrawal-source-1",
      sourceVenue: "POLYMARKET" as const,
      sourceToken: "USDC",
      sourceAmount: "40",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      destinationAmountEstimate: "40",
      routeProvider: "LOTUS_WITHDRAWAL_V0" as const,
      routeQuote: {
        provider: "LOTUS_WITHDRAWAL_V0" as const,
        providerRouteId: "withdrawal-source-1",
        sourceVenue: "POLYMARKET" as const,
        sourceToken: "USDC",
        sourceAmount: "40",
        destinationChain: "POLYGON",
        destinationWalletAddress: "0x1111111111111111111111111111111111111111",
        destinationAmountEstimate: "40",
        estimatedFees: "0",
        estimatedTimeSeconds: null,
        expiresAt: "2026-04-26T00:01:00.000Z",
        transactionRequest: null,
        userSafeSummary: "safe"
      },
      txHashes: ["0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"],
      providerStatus: {},
      venueReleaseStatus: "PENDING",
      destinationStatus: "PENDING",
      status: "VENUE_RELEASE_PENDING" as const,
      errorReason: null,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    };

    client.raw = {
      sourceVenue: "POLYMARKET",
      withdrawalTxHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      status: "VENUE_RELEASED",
      venueReleased: true,
      destinationReceived: false,
      confirmations: 1,
      reason: "POLYMARKET_WITHDRAWAL_RELEASED"
    };
    await expect(checker.check({ userId: "user-1", intent, leg, reconciliations: [] })).resolves.toMatchObject({
      status: "VENUE_RELEASED",
      venueReleased: true,
      destinationReceived: false,
      completed: false,
      reason: "POLYMARKET_WITHDRAWAL_RELEASED"
    });

    client.raw = {
      sourceVenue: "POLYMARKET",
      withdrawalTxHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "40",
      confirmations: 2,
      reason: "POLYMARKET_WITHDRAWAL_DESTINATION_CONFIRMED",
      authorization: "secret"
    };
    const completed = await checker.check({ userId: "user-1", intent, leg, reconciliations: [] });
    expect(completed).toMatchObject({
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "40"
    });
    expect(JSON.stringify(completed)).not.toContain("secret");

    client.raw = {
      sourceVenue: "POLYMARKET",
      withdrawalTxHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: false,
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "40",
      confirmations: 2
    };
    await expect(checker.check({ userId: "user-1", intent, leg, reconciliations: [] })).resolves.toMatchObject({
      status: "DESTINATION_RECEIVED",
      completed: false,
      reason: "POLYMARKET_WITHDRAWAL_COMPLETION_FLAG_MISSING"
    });

    client.raw = {
      sourceVenue: "POLYMARKET",
      withdrawalTxHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      status: "UNKNOWN",
      venueReleased: true,
      destinationReceived: false,
      completed: false,
      confirmations: 2,
      recoveryReviewRequired: true,
      recoveryReason: "POLYMARKET_BRIDGE_COMPLETED_AGGREGATE_WITHOUT_EXACT_DESTINATION_SCOPE",
      bridgeAddress: "0x4a01ccfaa0014cd706313be5110a517e83104985",
      bridgeStatus: "COMPLETED",
      bridgeAmount: "2.400099",
      bridgeTxHash: "0xc66a4d429abb085f3d5a5fba2b2b6e05bcdfad1e1d11367efe84c00be9b08045",
      reason: "POLYMARKET_WITHDRAWAL_BRIDGE_AGGREGATE_COMPLETION_REVIEW_REQUIRED"
    };
    await expect(checker.check({ userId: "user-1", intent, leg, reconciliations: [] })).resolves.toMatchObject({
      status: "UNKNOWN",
      venueReleased: true,
      destinationReceived: false,
      completed: false,
      reason: "POLYMARKET_WITHDRAWAL_BRIDGE_AGGREGATE_COMPLETION_REVIEW_REQUIRED",
      evidence: {
        recoveryReviewRequired: true,
        recoveryReason: "POLYMARKET_BRIDGE_COMPLETED_AGGREGATE_WITHOUT_EXACT_DESTINATION_SCOPE",
        bridgeStatus: "COMPLETED",
        bridgeAmount: "2.400099"
      }
    });

    client.raw = {
      userId: "other-user",
      withdrawalIntentId: "withdrawal-intent-1",
      withdrawalRouteLegId: "withdrawal-leg-1",
      sourceVenue: "POLYMARKET",
      withdrawalTxHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "40",
      confirmations: 2
    };
    await expect(checker.check({ userId: "user-1", intent, leg, reconciliations: [] })).resolves.toMatchObject({
      status: "UNKNOWN",
      completed: false,
      reason: "POLYMARKET_WITHDRAWAL_EVIDENCE_SCOPE_MISMATCH"
    });

    client.raw = {
      sourceVenue: "POLYMARKET",
      withdrawalTxHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "40",
      confirmations: 2
    };
    await expect(checker.check({ userId: "user-1", intent, leg, reconciliations: [] })).resolves.toMatchObject({
      status: "UNKNOWN",
      completed: false,
      reason: "POLYMARKET_WITHDRAWAL_TX_HASH_MISMATCH"
    });

    const disabled = new PolymarketWithdrawalEvidenceChecker(client, {
      mode: "DISABLED",
      now: () => new Date("2026-04-26T00:00:00.000Z")
    });
    await expect(disabled.check({ userId: "user-1", intent, leg, reconciliations: [] })).resolves.toMatchObject({
      status: "UNKNOWN",
      completed: false,
      reason: "POLYMARKET_WITHDRAWAL_EVIDENCE_DISABLED"
    });
  });

  it("validates Polymarket withdrawal evidence config and HTTP client safely", async () => {
    expect(getPolymarketWithdrawalEvidenceConfigFromEnv({} as NodeJS.ProcessEnv)).toMatchObject({
      enabled: false,
      mode: "DISABLED",
      configured: false,
      minimumConfirmations: 1
    });
    expect(getPolymarketWithdrawalEvidenceConfigFromEnv({
      POLYMARKET_WITHDRAWAL_EVIDENCE_MODE: "LIVE_READ",
      POLYMARKET_WITHDRAWAL_EVIDENCE_URL: "https://operator.example/withdrawal-evidence",
      POLYMARKET_WITHDRAWAL_EVIDENCE_AUTH_MODE: "BEARER",
      POLYMARKET_WITHDRAWAL_EVIDENCE_TIMEOUT_MS: "9000",
      POLYMARKET_WITHDRAWAL_MIN_CONFIRMATIONS: "3"
    } as NodeJS.ProcessEnv)).toMatchObject({
      enabled: true,
      mode: "LIVE_READ",
      evidenceUrl: "https://operator.example/withdrawal-evidence",
      authMode: "BEARER",
      timeoutMs: 9000,
      minimumConfirmations: 3,
      configured: true
    });
    expect(buildPolymarketWithdrawalEvidenceCheckerFromEnv({} as NodeJS.ProcessEnv)).toBeNull();

    let capturedAuthorization = "";
    const client = new HttpPolymarketWithdrawalEvidenceReadClient({
      evidenceUrl: "https://operator.example/withdrawal-evidence",
      authMode: "BEARER",
      apiKey: "server-side-secret",
      fetchImpl: async (input, init) => {
        capturedAuthorization = (init?.headers as Record<string, string>).authorization ?? "";
        const url = new URL(String(input));
        expect(url.searchParams.get("withdrawalTxHash")).toBe("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        return new Response(JSON.stringify({
          sourceVenue: "POLYMARKET",
          withdrawalTxHash: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          status: "COMPLETED",
          venueReleased: true,
          destinationReceived: true,
          destinationChain: "POLYGON",
          destinationWalletAddress: "0x1111111111111111111111111111111111111111",
          token: "USDC",
          amount: "1",
          confirmations: 3
        }), { status: 200 });
      }
    });
    const raw = await client.fetchEvidence({
      userId: "user-1",
      withdrawalIntentId: "withdrawal-1",
      withdrawalRouteLegId: "leg-1",
      sourceVenue: "POLYMARKET",
      withdrawalTxHash: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    });
    expect(raw).toMatchObject({ sourceVenue: "POLYMARKET", status: "COMPLETED" });
    expect(capturedAuthorization).toBe("Bearer server-side-secret");
  });

  it("fails withdrawal quote closed without venue withdrawal capability or ready balance", async () => {
    const noCapability = new FundingService(new InMemoryFundingRepository(), new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env
    });
    await expect(noCapability.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "100",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-no-capability",
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    })).rejects.toMatchObject({ code: "WITHDRAWAL_CAPABILITY_DISABLED" });

    const repository = new InMemoryFundingRepository();
    repository.ready = false;
    const insufficient = new FundingService(repository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env: withdrawalEnv
    });
    await expect(insufficient.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "100",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-no-balance",
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    })).rejects.toMatchObject({ code: "WITHDRAWAL_SOURCE_BALANCE_INSUFFICIENT" });

    const limitlessRepository = new InMemoryFundingRepository();
    limitlessRepository.ready = true;
    const limitless = new FundingService(limitlessRepository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env: withdrawalEnv
    });
    await expect(limitless.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "100",
      destinationChain: "BASE",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-limitless-auto-resolution-only",
      sources: [{ sourceVenue: "LIMITLESS", sourcePercentage: 100 }]
    })).rejects.toMatchObject({ code: "WITHDRAWAL_CAPABILITY_DISABLED" });

    const duplicateVenueRepository = new InMemoryFundingRepository();
    duplicateVenueRepository.ready = true;
    const duplicateVenue = new FundingService(duplicateVenueRepository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env: withdrawalEnv
    });
    await expect(duplicateVenue.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "100",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-duplicate-source",
      sources: [
        { sourceVenue: "POLYMARKET", sourcePercentage: 50 },
        { sourceVenue: "POLYMARKET", sourcePercentage: 50 }
      ]
    })).rejects.toMatchObject({ code: "TARGET_SPLIT_INVALID" });
  });

  it("uses Polymarket Bridge sandbox metadata only when explicitly enabled", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const bridgeAdapter = new PolymarketBridgeWithdrawalAdapter(
      new MockPolymarketBridgeWithdrawalClient(),
      {
        enabled: true,
        mode: "DRY_RUN",
        apiBaseUrl: "https://bridge.operator.example",
        authMode: "NONE",
        timeoutMs: 5000,
        dryRunOnly: true,
        configured: true
      },
      { now: () => new Date("2026-04-26T00:00:00.000Z") }
    );
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: withdrawalEnv
      },
      new Map(),
      null,
      null,
      bridgeAdapter
    );

    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "40",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-bridge-sandbox",
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    const serializedQuote = JSON.stringify(quoted);

    expect(quoted.routeLegs[0]!.routeProvider).toBe("LOTUS_WITHDRAWAL_V0");
    expect(quoted.routeLegs[0]!.providerStatus).toMatchObject({
      provider: "POLYMARKET_BRIDGE",
      mode: "SANDBOX_DRY_RUN",
      bridgeAddressPresent: true,
      status: "PENDING",
      completionPersisted: false
    });
    expect(quoted.intent.aggregateRouteQuote).toMatchObject({
      polymarketBridge: {
        provider: "POLYMARKET_BRIDGE",
        mode: "SANDBOX_DRY_RUN",
        bridgeAddressPresent: true,
        completionPersisted: false
      }
    });
    expect(serializedQuote).toContain("Lotus does not sign");
    expect(serializedQuote).not.toContain("authorization");
    expect(serializedQuote).not.toContain("server-side-secret");

    const submitted = await service.submitWithdrawalRouteLeg("user-1", created.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quoted.routeLegs[0]!.withdrawalRouteLegId,
      txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    });
    expect(submitted.routeLegs[0]!.status).toBe("VENUE_RELEASE_PENDING");

    const refreshed = await service.refreshWithdrawalStatus("user-1", created.intent.withdrawalIntentId);
    expect(refreshed.routeLegs[0]!.status).toBe("VENUE_RELEASE_PENDING");
    expect(refreshed.routeLegs[0]!.providerStatus).toMatchObject({
      provider: "POLYMARKET_BRIDGE",
      mode: "SANDBOX_DRY_RUN",
      status: "COMPLETED",
      completionPersisted: false
    });
    expect(refreshed.reconciliations).toEqual([]);
  });

  it("keeps default withdrawal quote behavior when Bridge sandbox is not wired", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const service = new FundingService(repository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env: withdrawalEnv
    });
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "40",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-default-v0",
      sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    expect(quoted.routeLegs[0]!.providerStatus).toEqual({});
    expect(quoted.intent.aggregateRouteQuote).not.toHaveProperty("polymarketBridge");
  });

  it("keeps default withdrawal quote behavior when Predict.fun adapter is not wired", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const service = new FundingService(repository, new StubLifiProvider(), {
      lifiQuotesEnabled: true,
      liveSubmitEnabled: false,
      env: withdrawalEnv
    });
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDC",
      amount: "40",
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-predictfun-default-v0",
      sources: [{ sourceVenue: "PREDICT_FUN", sourcePercentage: 100 }]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    expect(quoted.routeLegs[0]!.providerStatus).toEqual({});
    expect(quoted.intent.aggregateRouteQuote).not.toHaveProperty("predictFunUserWallet");
  });

  it("returns safe Predict.fun user-wallet metadata for single-source dry-run withdrawal quotes", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const predictEnv = {
      ...withdrawalEnv,
      PREDICT_FUN_WITHDRAWAL_ADAPTER_ENABLED: "true",
      PREDICT_FUN_WITHDRAWAL_ADAPTER_MODE: "USER_WALLET_DRY_RUN",
      PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      PREDICT_FUN_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.predict.fun/knowledge-base/wallets"
    } as NodeJS.ProcessEnv;
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: predictEnv
      },
      new Map(),
      null,
      null,
      null,
      new PredictFunWithdrawalAdapter(getPredictFunWithdrawalConfigFromEnv(predictEnv))
    );
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDT",
      amount: "40",
      destinationChain: "BSC",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-predictfun-user-wallet",
      sources: [{ sourceVenue: "PREDICT_FUN", sourcePercentage: 100 }]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    const serializedQuote = JSON.stringify(quoted);

    expect(quoted.routeLegs[0]!.providerStatus).toMatchObject({
      provider: "PREDICT_FUN_USER_WALLET",
      mode: "USER_WALLET_DRY_RUN",
      walletModel: "PRIVY_ZERODEV",
      completionPersisted: false,
      destinationWalletProfileRequired: true,
      evmWithdrawalWalletPresent: false,
      instructionsUrl: "https://docs.predict.fun/knowledge-base/wallets"
    });
    expect(quoted.intent.aggregateRouteQuote).toMatchObject({
      predictFunUserWallet: {
        provider: "PREDICT_FUN_USER_WALLET",
        mode: "USER_WALLET_DRY_RUN",
        walletModel: "PRIVY_ZERODEV",
        destinationWalletProfileRequired: true,
        evmWithdrawalWalletPresent: false,
        completionPersisted: false
      }
    });
    expect(quoted.routeLegs[0]!.routeQuote.transactionRequest).toBeNull();
    expect(serializedQuote).toContain("Add an EVM-compatible wallet to receive BSC USDT withdrawals.");
    expect(serializedQuote).toContain("Lotus does not hold keys");
    expect(serializedQuote).not.toContain("privateKey");
    expect(serializedQuote).not.toContain("walletSeed");
    expect(serializedQuote).not.toContain("privySecret");
    expect(serializedQuote).not.toContain("zeroDevSigner");
    expect(serializedQuote).not.toContain("authorization");
    expect(serializedQuote).not.toContain("jwt");
    expect(serializedQuote).not.toContain("rawProviderPayload");

    const submitted = await service.submitWithdrawalRouteLeg("user-1", created.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quoted.routeLegs[0]!.withdrawalRouteLegId,
      txHash: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    });
    expect(submitted.routeLegs[0]!.status).toBe("VENUE_RELEASE_PENDING");

    const refreshed = await service.refreshWithdrawalStatus("user-1", created.intent.withdrawalIntentId);
    expect(refreshed.routeLegs[0]!.status).toBe("VENUE_RELEASE_PENDING");
    expect(refreshed.reconciliations).toEqual([]);
  });

  it("does not silently use Predict.fun adapter for multi-source withdrawals", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const predictEnv = {
      ...withdrawalEnv,
      PREDICT_FUN_WITHDRAWAL_ADAPTER_ENABLED: "true",
      PREDICT_FUN_WITHDRAWAL_ADAPTER_MODE: "USER_WALLET_DRY_RUN",
      PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      PREDICT_FUN_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.predict.fun/knowledge-base/wallets"
    } as NodeJS.ProcessEnv;
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: predictEnv
      },
      new Map(),
      null,
      null,
      null,
      new PredictFunWithdrawalAdapter(getPredictFunWithdrawalConfigFromEnv(predictEnv))
    );
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDT",
      amount: "40",
      destinationChain: "BSC",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-predictfun-multi-source",
      sources: [
        { sourceVenue: "PREDICT_FUN", sourcePercentage: 50 },
        { sourceVenue: "POLYMARKET", sourcePercentage: 50 }
      ]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    expect(quoted.routeLegs.some((leg) => leg.providerStatus.provider === "PREDICT_FUN_USER_WALLET")).toBe(false);
    expect(quoted.intent.aggregateRouteQuote).not.toHaveProperty("predictFunUserWallet");
  });

  it("returns safe Myriad user-wallet instructions for single-source BSC USD1 withdrawals", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const myriadEnv = {
      ...withdrawalEnv,
      MYRIAD_WITHDRAWAL_ADAPTER_ENABLED: "true",
      MYRIAD_WITHDRAWAL_ADAPTER_MODE: "USER_WALLET_DRY_RUN",
      MYRIAD_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      MYRIAD_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.myriad.markets/deposit-and-withdraw"
    } as NodeJS.ProcessEnv;
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: myriadEnv
      },
      new Map(),
      null,
      null,
      null,
      null,
      null,
      new MyriadWalletWithdrawalAdapter(getMyriadWithdrawalConfigFromEnv(myriadEnv))
    );
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USD1",
      amount: "40",
      destinationChain: "BSC",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-myriad-user-wallet",
      sources: [{ sourceVenue: "MYRIAD", sourcePercentage: 100 }]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    const serializedQuote = JSON.stringify(quoted);

    expect(quoted.routeLegs[0]!.providerStatus).toMatchObject({
      provider: "MYRIAD_USER_WALLET",
      mode: "USER_WALLET_DRY_RUN",
      walletModel: "THIRDWEB",
      completionPersisted: false,
      instructionsUrl: "https://docs.myriad.markets/deposit-and-withdraw"
    });
    expect(quoted.intent.aggregateRouteQuote).toMatchObject({
      myriadUserWallet: {
        provider: "MYRIAD_USER_WALLET",
        mode: "USER_WALLET_DRY_RUN",
        walletModel: "THIRDWEB",
        destinationChain: "BSC",
        destinationToken: "USD1",
        completionPersisted: false
      }
    });
    expect(quoted.routeLegs[0]!.routeQuote.transactionRequest).toBeNull();
    expect(serializedQuote).toContain("Myriad/ThirdWeb wallet UI");
    expect(serializedQuote).toContain("Lotus does not hold keys");
    expect(serializedQuote).not.toContain("privateKey");
    expect(serializedQuote).not.toContain("walletSeed");
    expect(serializedQuote).not.toContain("thirdwebSigner");
    expect(serializedQuote).not.toContain("authorization");
    expect(serializedQuote).not.toContain("sessionToken");
    expect(serializedQuote).not.toContain("rawProviderPayload");

    const submitted = await service.submitWithdrawalRouteLeg("user-1", created.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quoted.routeLegs[0]!.withdrawalRouteLegId,
      txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    });
    expect(submitted.routeLegs[0]!.status).toBe("VENUE_RELEASE_PENDING");

    const refreshed = await service.refreshWithdrawalStatus("user-1", created.intent.withdrawalIntentId);
    expect(refreshed.routeLegs[0]!.status).toBe("VENUE_RELEASE_PENDING");
    expect(refreshed.reconciliations).toEqual([]);
  });

  it("does not silently use Myriad adapter for multi-source withdrawals", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const myriadEnv = {
      ...withdrawalEnv,
      MYRIAD_WITHDRAWAL_ADAPTER_ENABLED: "true",
      MYRIAD_WITHDRAWAL_ADAPTER_MODE: "USER_WALLET_DRY_RUN",
      MYRIAD_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      MYRIAD_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.myriad.markets/deposit-and-withdraw"
    } as NodeJS.ProcessEnv;
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: myriadEnv
      },
      new Map(),
      null,
      null,
      null,
      null,
      null,
      new MyriadWalletWithdrawalAdapter(getMyriadWithdrawalConfigFromEnv(myriadEnv))
    );
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USD1",
      amount: "40",
      destinationChain: "BSC",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-myriad-multi-source",
      sources: [
        { sourceVenue: "MYRIAD", sourcePercentage: 50 },
        { sourceVenue: "POLYMARKET", sourcePercentage: 50 }
      ]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    expect(quoted.routeLegs.some((leg) => leg.providerStatus.provider === "MYRIAD_USER_WALLET")).toBe(false);
    expect(quoted.intent.aggregateRouteQuote).not.toHaveProperty("myriadUserWallet");
  });

  it("returns safe Opinion Safe user-action instructions for single-source BSC USDT withdrawals", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const opinionEnv = {
      ...withdrawalEnv,
      OPINION_WITHDRAWAL_ADAPTER_ENABLED: "true",
      OPINION_WITHDRAWAL_ADAPTER_MODE: "USER_SAFE_DRY_RUN",
      OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      OPINION_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode/split-merge-redeem"
    } as NodeJS.ProcessEnv;
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: opinionEnv
      },
      new Map(),
      null,
      null,
      null,
      null,
      null,
      null,
      new OpinionSafeWithdrawalAdapter(getOpinionWithdrawalConfigFromEnv(opinionEnv))
    );
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDT",
      amount: "40",
      destinationChain: "BSC",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-opinion-safe-user-action",
      sources: [{ sourceVenue: "OPINION", sourcePercentage: 100 }]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    const serializedQuote = JSON.stringify(quoted);

    expect(quoted.routeLegs[0]!.providerStatus).toMatchObject({
      provider: "OPINION_SAFE_USER_ACTION",
      mode: "USER_SAFE_DRY_RUN",
      walletModel: "GNOSIS_SAFE_OR_USER_EOA",
      completionPersisted: false,
      instructionsUrl: "https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode/split-merge-redeem"
    });
    expect(quoted.intent.aggregateRouteQuote).toMatchObject({
      opinionSafeUserAction: {
        provider: "OPINION_SAFE_USER_ACTION",
        mode: "USER_SAFE_DRY_RUN",
        walletModel: "GNOSIS_SAFE_OR_USER_EOA",
        destinationChain: "BSC",
        destinationToken: "USDT",
        completionPersisted: false
      }
    });
    expect(quoted.routeLegs[0]!.routeQuote.transactionRequest).toBeNull();
    expect(serializedQuote).toContain("Opinion/Gnosis Safe/user wallet");
    expect(serializedQuote).toContain("Lotus does not hold keys");
    expect(serializedQuote).not.toContain("privateKey");
    expect(serializedQuote).not.toContain("walletSeed");
    expect(serializedQuote).not.toContain("safeOwnerKey");
    expect(serializedQuote).not.toContain("authorization");
    expect(serializedQuote).not.toContain("sessionToken");
    expect(serializedQuote).not.toContain("rawProviderPayload");

    const submitted = await service.submitWithdrawalRouteLeg("user-1", created.intent.withdrawalIntentId, {
      withdrawalRouteLegId: quoted.routeLegs[0]!.withdrawalRouteLegId,
      txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    });
    expect(submitted.routeLegs[0]!.status).toBe("VENUE_RELEASE_PENDING");

    const refreshed = await service.refreshWithdrawalStatus("user-1", created.intent.withdrawalIntentId);
    expect(refreshed.routeLegs[0]!.status).toBe("VENUE_RELEASE_PENDING");
    expect(refreshed.reconciliations).toEqual([]);
  });

  it("does not silently use Opinion adapter for multi-source withdrawals", async () => {
    const repository = new InMemoryFundingRepository();
    repository.ready = true;
    const opinionEnv = {
      ...withdrawalEnv,
      OPINION_WITHDRAWAL_ADAPTER_ENABLED: "true",
      OPINION_WITHDRAWAL_ADAPTER_MODE: "USER_SAFE_DRY_RUN",
      OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      OPINION_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode/split-merge-redeem"
    } as NodeJS.ProcessEnv;
    const service = new FundingService(
      repository,
      new StubLifiProvider(),
      {
        lifiQuotesEnabled: true,
        liveSubmitEnabled: false,
        env: opinionEnv
      },
      new Map(),
      null,
      null,
      null,
      null,
      null,
      null,
      new OpinionSafeWithdrawalAdapter(getOpinionWithdrawalConfigFromEnv(opinionEnv))
    );
    const created = await service.createWithdrawalIntent("user-1", {
      token: "USDT",
      amount: "40",
      destinationChain: "BSC",
      destinationWalletAddress: "0x1111111111111111111111111111111111111111",
      idempotencyKey: "withdraw-opinion-multi-source",
      sources: [
        { sourceVenue: "OPINION", sourcePercentage: 50 },
        { sourceVenue: "POLYMARKET", sourcePercentage: 50 }
      ]
    });
    const quoted = await service.quoteWithdrawalIntent("user-1", created.intent.withdrawalIntentId);
    expect(quoted.routeLegs.some((leg) => leg.providerStatus.provider === "OPINION_SAFE_USER_ACTION")).toBe(false);
    expect(quoted.intent.aggregateRouteQuote).not.toHaveProperty("opinionSafeUserAction");
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
    expect(quote.destinationAmountEstimate).toBe("0.00099");
    expect(normalizeLifiStatus({ status: "DONE", substatus: "PARTIAL" })).toBe("DONE_PARTIAL");
    expect(toLifiChain("SOLANA")).toBe("SOL");
    expect(toLifiChain("POLYGON")).toBe("137");
    expect(toLifiChain("BASE")).toBe("8453");
    expect(toBaseUnitAmount("1.25", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe("1250000");
    expect(fromBaseUnitAmount("991788", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174")).toBe("0.991788");
    expect(fromBaseUnitAmount("1991998", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe("1.991998");
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

  it("normalizes LI.FI status chain parameters before provider lookup", async () => {
    let requestedUrl: URL | null = null;
    const client = new LifiRestClient({
      baseUrl: "https://li.quest",
      timeoutMs: 1000,
      quoteTtlSeconds: 60,
      quotesEnabled: true
    }, (async (input) => {
      requestedUrl = new URL(String(input));
      return new Response(JSON.stringify({ status: "DONE", substatus: "COMPLETED" }), { status: 200 });
    }) as typeof fetch);

    await expect(client.status({
      txHash: "2gU42AjTDTBiSeN5xcF2S3kRayRC3W6AeqnbYv7U5ndhBeF27obhjLSPraxX4W9LodeWQ8LmyPRHKwKJcqAU6y3V",
      fromChain: "SOLANA",
      toChain: "BASE"
    })).resolves.toMatchObject({ status: "DONE_COMPLETED" });

    expect(requestedUrl?.searchParams.get("fromChain")).toBe("SOL");
    expect(requestedUrl?.searchParams.get("toChain")).toBe("8453");
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
      LIMITLESS_FUNDING_READ_AUTH_MODE: "BEARER",
      LIMITLESS_FUNDING_BALANCE_TOLERANCE: "0.000002"
    } as NodeJS.ProcessEnv)).toMatchObject({
      enabled: true,
      mode: "LIVE_READ",
      authMode: "BEARER",
      balanceTolerance: "0.000002",
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

    balanceClient.usableBalance = "49.999999";
    const dustReady = await checker.check({ userId: "user-1", intent, leg, reconciliations: [] });
    expect(dustReady).toMatchObject({
      venue: "LIMITLESS",
      status: "READY_TO_TRADE",
      readyToTrade: true,
      reason: "LIMITLESS_USABLE_BALANCE_CONFIRMED",
      evidence: {
        requiredAmount: "50",
        usableBalance: "49.999999",
        balanceTolerance: "0.000001",
        effectiveRequiredAmount: "49.999999"
      }
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

  it("uses the shared venue readiness checker for next venues", async () => {
    const venueConfigs = [
      ["OPINION", getOpinionFundingReadinessConfigFromEnv],
      ["MYRIAD", getMyriadFundingReadinessConfigFromEnv],
      ["PREDICT_FUN", getPredictFunFundingReadinessConfigFromEnv]
    ] as const;

    for (const [venue, readConfig] of venueConfigs) {
      expect(readConfig({} as NodeJS.ProcessEnv)).toMatchObject({
        enabled: false,
        mode: "DISABLED",
        configured: false
      });
      expect(getFundingReadinessConfigFromEnv(venue, {
        [`${venue}_FUNDING_READINESS_MODE`]: "LIVE_READ",
        [`${venue}_FUNDING_BALANCE_URL`]: `https://operator.example/${venue.toLowerCase()}-readiness`,
        [`${venue}_FUNDING_READ_AUTH_MODE`]: "BEARER"
      } as NodeJS.ProcessEnv)).toMatchObject({
        enabled: true,
        mode: "LIVE_READ",
        authMode: "BEARER",
        configured: true
      });

      const balanceClient = new StubFundingBalanceReadClient();
      const checker = new ConfigurableVenueFundingReadinessChecker(venue, balanceClient, {
        mode: "STUB",
        env,
        now: () => new Date("2026-04-25T00:00:00.000Z")
      });
      const intent = {
        fundingIntentId: `${venue.toLowerCase()}-intent-1`,
        userId: "user-1",
        sourceChain: "SOLANA",
        sourceToken: "USDC",
        sourceAmount: "25",
        sourceWalletAddress: "wallet",
        status: "ROUTES_SUBMITTED" as const,
        idempotencyKey: `${venue.toLowerCase()}-idem`,
        aggregateRouteQuote: {},
        totalEstimatedFees: "0",
        totalEstimatedTimeSeconds: null,
        auditEventIds: [],
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:00:00.000Z"
      };
      const leg = {
        routeLegId: `${venue.toLowerCase()}-leg-1`,
        fundingIntentId: intent.fundingIntentId,
        fundingTargetId: `${venue.toLowerCase()}-target-1`,
        targetVenue: venue as FundingVenue,
        sourceChain: "SOLANA",
        sourceToken: "USDC",
        sourceAmount: "25",
        destinationChain: "POLYGON",
        destinationToken: "USDC",
        destinationAmountEstimate: "25",
        routeProvider: "LIFI" as const,
        routeQuote: await new StubLifiProvider().quote({
          fromChain: "SOLANA",
          toChain: "137",
          fromToken: "source",
          toToken: "target",
          fromAmount: "25",
          fromAddress: "wallet",
          toAddress: "destination",
          targetVenue: venue
        }),
        txHashes: ["0x2222222222222222222222222222222222222222222222222222222222222222"],
        providerStatus: {},
        bridgeStatus: "DONE",
        destinationStatus: "CONFIRMED",
        venueCreditStatus: "PENDING",
        status: "LEG_VENUE_CREDIT_PENDING" as const,
        errorReason: null,
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:00:00.000Z"
      };

      balanceClient.usableBalance = "24.99";
      await expect(checker.check({ userId: "user-1", intent, leg, reconciliations: [] }))
        .resolves.toMatchObject({
          venue,
          status: "VENUE_CREDIT_PENDING",
          readyToTrade: false,
          reason: `${venue}_USABLE_BALANCE_BELOW_REQUIRED_AMOUNT`
        });

      balanceClient.usableBalance = "25";
      const ready = await checker.check({ userId: "user-1", intent, leg, reconciliations: [] });
      expect(ready).toMatchObject({
        venue,
        status: "READY_TO_TRADE",
        readyToTrade: true,
        reason: `${venue}_USABLE_BALANCE_CONFIRMED`,
        evidence: {
          source: `${venue.toLowerCase()}_funding_readiness`,
          checkerMode: "STUB"
        }
      });
      expect(JSON.stringify(ready)).not.toContain("authorization");
      expect(JSON.stringify(ready)).not.toContain("privateKey");

      balanceClient.usableBalance = "not-a-number";
      await expect(checker.check({ userId: "user-1", intent, leg, reconciliations: [] }))
        .resolves.toMatchObject({ status: "UNKNOWN", readyToTrade: false, reason: `${venue}_BALANCE_RESPONSE_MALFORMED` });
    }
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
