import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import type { ExecutionRequestV0 } from "../../execution-system/types.js";
import type { LifiRouteProvider } from "../../integrations/lifi/lifi-client.js";
import { isQuoteExpired } from "../../integrations/lifi/lifi-client.js";
import {
  aggregateFundingStatus,
  aggregateWithdrawalStatus,
  FundingError,
  type CreateFundingIntentInput,
  type CreateWithdrawalIntentInput,
  type FundingAuditEventType,
  type FundingIntent,
  type FundingIntentView,
  type FundingLegState,
  type FundingReconciliationRecord,
  type FundingRouteLeg,
  type FundingRouteQuote,
  type FundingTarget,
  type FundingVenue,
  type VenueBalanceView,
  type VenueCapability,
  type WithdrawalAggregateState,
  type WithdrawalIntent,
  type WithdrawalIntentView,
  type WithdrawalLegState,
  type WithdrawalReconciliationRecord,
  type WithdrawalRouteLeg,
  type WithdrawalRouteQuote,
  type WithdrawalSource
} from "./types.js";
import { buildVenueCapabilityMatrix, getVenueDepositAddress, getVenueDepositAddressForChain, getVenueFundingDestinationMode } from "./venue-capabilities.js";
import type {
  VenueFundingReadinessChecker,
  VenueFundingReadinessResult
} from "./venue-readiness.js";
import type {
  PolymarketBridgeRawStatus,
  PolymarketBridgeWithdrawalAdapter,
  PolymarketBridgeWithdrawalQuote,
  PolymarketBridgeUserAction
} from "./polymarket-bridge-withdrawal-adapter.js";
import {
  buildPredictFunUserWalletProviderStatus,
  type PredictFunUserWalletAction,
  type PredictFunWithdrawalAdapter,
  type PredictFunWithdrawalQuote
} from "./predictfun-withdrawal-adapter.js";
import {
  buildMyriadUserWalletProviderStatus,
  type MyriadUserWalletAction,
  type MyriadWalletWithdrawalAdapter,
  type MyriadWithdrawalQuote
} from "./myriad-withdrawal-adapter.js";
import {
  buildOpinionSafeUserActionProviderStatus,
  type OpinionSafeUserAction,
  type OpinionSafeWithdrawalAdapter,
  type OpinionWithdrawalQuote
} from "./opinion-withdrawal-adapter.js";
import { UserWalletError, type UserWallet, type UserWalletService } from "./user-wallets.js";

export interface FundingRepository {
  findIntentById(id: string): Promise<FundingIntent | null>;
  findIntentByUserAndIdempotencyKey(userId: string, idempotencyKey: string): Promise<FundingIntent | null>;
  createIntent(input: FundingIntent, targets: FundingTarget[]): Promise<FundingIntent>;
  listTargets(fundingIntentId: string): Promise<FundingTarget[]>;
  listRouteLegs(fundingIntentId: string): Promise<FundingRouteLeg[]>;
  listReconciliations(fundingIntentId: string): Promise<FundingIntentView["reconciliations"]>;
  listFundingIntentsForReadinessWatch(input: {
    limit: number;
    staleAfterSeconds: number;
  }): Promise<Array<{ fundingIntentId: string; userId: string }>>;
  replaceRouteLegs(fundingIntentId: string, routeLegs: FundingRouteLeg[]): Promise<void>;
  updateIntentStatus(fundingIntentId: string, status: FundingIntent["status"], patch?: Record<string, unknown>): Promise<void>;
  updateRouteLegSubmission(input: { routeLegId: string; txHash: string; status: FundingLegState }): Promise<void>;
  updateRouteLegProviderStatus(input: {
    routeLegId: string;
    status: FundingLegState;
    bridgeStatus: string;
    destinationStatus: string;
    venueCreditStatus: string;
    providerStatus: Record<string, unknown>;
    errorReason?: string | null;
  }): Promise<void>;
  createReconciliationRecord(input: {
    fundingIntentId: string;
    routeLegId: string;
    targetVenue: FundingVenue;
    destinationTxHash?: string | null;
    destinationReceived: boolean;
    venueCreditConfirmed: boolean;
    readyToTrade: boolean;
    notes?: string;
  }): Promise<FundingReconciliationRecord>;
  appendAuditEvent(input: {
    fundingIntentId: string;
    routeLegId?: string | null;
    eventType: FundingAuditEventType;
    payload: Record<string, unknown>;
  }): Promise<string>;
  hasReadyVenueBalance(input: {
    userId: string;
    venue: string;
    token: string;
    amount: string;
  }): Promise<boolean>;
  listVenueBalances(userId: string): Promise<VenueBalanceView[]>;
  findWithdrawalIntentById(id: string): Promise<WithdrawalIntent | null>;
  findWithdrawalIntentByUserAndIdempotencyKey(userId: string, idempotencyKey: string): Promise<WithdrawalIntent | null>;
  createWithdrawalIntent(input: WithdrawalIntent, sources: WithdrawalSource[]): Promise<WithdrawalIntent>;
  listWithdrawalSources(withdrawalIntentId: string): Promise<WithdrawalSource[]>;
  listWithdrawalRouteLegs(withdrawalIntentId: string): Promise<WithdrawalRouteLeg[]>;
  listWithdrawalReconciliations(withdrawalIntentId: string): Promise<WithdrawalReconciliationRecord[]>;
  replaceWithdrawalRouteLegs(withdrawalIntentId: string, routeLegs: WithdrawalRouteLeg[]): Promise<void>;
  updateWithdrawalIntentStatus(withdrawalIntentId: string, status: WithdrawalAggregateState, patch?: Record<string, unknown>): Promise<void>;
  updateWithdrawalRouteLegSubmission(input: {
    withdrawalRouteLegId: string;
    txHash: string;
    status: WithdrawalLegState;
    venueReleaseStatus?: string;
    destinationStatus?: string;
  }): Promise<void>;
  updateWithdrawalRouteLegReconciliation(input: {
    withdrawalRouteLegId: string;
    status: WithdrawalLegState;
    venueReleaseStatus: string;
    destinationStatus: string;
    providerStatus: Record<string, unknown>;
    errorReason?: string | null;
  }): Promise<void>;
  createWithdrawalReconciliationRecord(input: {
    withdrawalIntentId: string;
    withdrawalRouteLegId: string;
    sourceVenue: FundingVenue;
    withdrawalTxHash?: string | null;
    venueReleased: boolean;
    destinationReceived: boolean;
    completed: boolean;
    notes?: string;
  }): Promise<WithdrawalReconciliationRecord>;
  appendWithdrawalAuditEvent(input: {
    withdrawalIntentId: string;
    withdrawalRouteLegId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<string>;
}

export interface FundingServiceConfig {
  lifiQuotesEnabled: boolean;
  liveSubmitEnabled: boolean;
  venueReadinessChecksEnabled?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface WithdrawalCompletionEvidenceResult {
  status: "UNKNOWN" | "VENUE_RELEASED" | "DESTINATION_RECEIVED" | "COMPLETED" | "FAILED";
  venueReleased: boolean;
  destinationReceived: boolean;
  completed: boolean;
  withdrawalTxHash?: string | null;
  destinationChain?: string | null;
  destinationWalletAddress?: string | null;
  token?: string | null;
  amount?: string | null;
  checkedAt?: string;
  reason: string;
  evidence?: Record<string, string | number | boolean | null>;
}

export interface WithdrawalCompletionEvidenceChecker {
  check(input: {
    userId: string;
    intent: WithdrawalIntent;
    leg: WithdrawalRouteLeg;
    reconciliations: WithdrawalReconciliationRecord[];
  }): Promise<WithdrawalCompletionEvidenceResult>;
}

export interface WithdrawalCompletionPersistenceGate {
  assertCanPersist(input: {
    userId: string;
    intent: WithdrawalIntent;
    leg: WithdrawalRouteLeg;
    result: WithdrawalCompletionEvidenceResult;
  }): Promise<void>;
}

export interface UserWithdrawalWalletReader {
  hasEvmWithdrawalWallet(userId: string, address?: string | null): Promise<boolean>;
}

export class FundingService {
  public constructor(
    private readonly repository: FundingRepository,
    private readonly lifi: LifiRouteProvider,
    private readonly config: FundingServiceConfig,
    private readonly venueReadinessCheckers: ReadonlyMap<FundingVenue, VenueFundingReadinessChecker> = new Map(),
    private readonly withdrawalCompletionChecker: WithdrawalCompletionEvidenceChecker | null = null,
    private readonly withdrawalCompletionPersistenceGate: WithdrawalCompletionPersistenceGate | null = null,
    private readonly polymarketBridgeWithdrawalAdapter: PolymarketBridgeWithdrawalAdapter | null = null,
    private readonly predictFunWithdrawalAdapter: PredictFunWithdrawalAdapter | null = null,
    private readonly userWithdrawalWalletReader: UserWithdrawalWalletReader | null = null,
    private readonly myriadWithdrawalAdapter: MyriadWalletWithdrawalAdapter | null = null,
    private readonly opinionWithdrawalAdapter: OpinionSafeWithdrawalAdapter | null = null,
    private readonly userWalletService: Pick<UserWalletService, "resolveFundingSourceWallet" | "resolveUserTurnkeyEvmFundingWallet" | "resolveVenueTargetWallet"> | null = null
  ) {}

  public listVenueCapabilities(): VenueCapability[] {
    return Object.values(buildVenueCapabilityMatrix({ env: this.config.env })).map((capability) => ({
      ...capability,
      preferredTokenAddress: capability.preferredTokenAddress === "UNCONFIGURED" ? "UNCONFIGURED" : capability.preferredToken,
      sourceTokenAddressByChain: Object.fromEntries(
        Object.keys(capability.sourceTokenAddressByChain).map((chain) => [chain, capability.supportedTokens[0] ?? "UNCONFIGURED"])
      )
    }));
  }

  public async listVenueBalances(userId: string): Promise<VenueBalanceView[]> {
    return this.repository.listVenueBalances(userId);
  }

  public async createIntent(userId: string, input: CreateFundingIntentInput): Promise<FundingIntentView> {
    const existing = await this.repository.findIntentByUserAndIdempotencyKey(userId, input.idempotencyKey);
    if (existing) {
      return this.getIntent(userId, existing.fundingIntentId);
    }
    const sourceWallet = await this.resolveSourceWallet(userId, input);
    const sourceWalletAddress = sourceWallet?.address ?? input.sourceWalletAddress;
    if (!sourceWalletAddress) {
      throw new FundingError("SOURCE_WALLET_UNAVAILABLE", "Funding source wallet address is required.", 400);
    }
    const targets = this.buildTargets(input, randomUUID());
    const now = new Date().toISOString();
    const intent: FundingIntent = {
      fundingIntentId: targets.fundingIntentId,
      userId,
      sourceChain: input.sourceChain,
      sourceToken: input.sourceToken,
      sourceAmount: input.sourceAmount,
      sourceWalletAddress,
      sourceWalletId: sourceWallet?.walletId ?? input.sourceWalletId ?? null,
      status: "INTENT_CREATED",
      idempotencyKey: input.idempotencyKey,
      aggregateRouteQuote: {},
      totalEstimatedFees: "0",
      totalEstimatedTimeSeconds: null,
      auditEventIds: [],
      createdAt: now,
      updatedAt: now
    };
    const created = await this.repository.createIntent(intent, targets.targets);
    await this.repository.appendAuditEvent({
      fundingIntentId: created.fundingIntentId,
      eventType: "FUNDING_INTENT_CREATED",
      payload: {
        sourceChain: input.sourceChain,
        sourceToken: input.sourceToken,
        targetCount: input.targets.length,
        sourceWalletProvider: sourceWallet?.provider ?? "EXTERNAL"
      }
    });
    return this.getIntent(userId, created.fundingIntentId);
  }

  public async getIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView> {
    const intent = await this.repository.findIntentById(fundingIntentId);
    if (!intent) {
      throw new FundingError("FUNDING_INTENT_NOT_FOUND", "Funding intent was not found.", 404);
    }
    if (intent.userId !== userId) {
      throw new FundingError("FUNDING_INTENT_FORBIDDEN", "Funding intent does not belong to this user.", 403);
    }
    const [targets, routeLegs, reconciliations] = await Promise.all([
      this.repository.listTargets(fundingIntentId),
      this.repository.listRouteLegs(fundingIntentId),
      this.repository.listReconciliations(fundingIntentId)
    ]);
    return {
      intent,
      targets,
      routeLegs,
      reconciliations,
      userSafeMessage: userSafeFundingMessage(intent.status)
    };
  }

  public async quoteIntent(userId: string, fundingIntentId: string): Promise<FundingIntentView> {
    const view = await this.getIntent(userId, fundingIntentId);
    const matrix = buildVenueCapabilityMatrix({ env: this.config.env });
    const routeLegs: FundingRouteLeg[] = [];
    for (const target of view.targets) {
      const capability = matrix[target.targetVenue];
      this.assertCapabilityReady(capability, view.intent);
      const depositAddress = await this.resolveFundingDestinationAddress(userId, target.targetVenue, capability.preferredChain);
      if (!depositAddress) {
        throw new FundingError("TARGET_DESTINATION_NOT_CONFIGURED", `${target.targetVenue} funding destination is not configured.`, 409);
      }
      const sourceTokenAddress = capability.sourceTokenAddressByChain[view.intent.sourceChain];
      if (!sourceTokenAddress) {
        throw new FundingError("SOURCE_CHAIN_UNSUPPORTED", "Source chain is not supported for this venue.", 409);
      }
      const directQuote = buildDirectTransferQuote({
        intent: view.intent,
        target,
        capability,
        sourceTokenAddress,
        depositAddress,
        ...(this.config.env ? { env: this.config.env } : {})
      });
      const quote = directQuote ?? await this.quoteLifiRoute(view.intent, target, capability, sourceTokenAddress, depositAddress);
      routeLegs.push(buildRouteLeg(view.intent, target, quote));
    }
    await this.repository.replaceRouteLegs(fundingIntentId, routeLegs);
    await this.repository.updateIntentStatus(fundingIntentId, "USER_SIGNATURE_REQUIRED", {
      aggregateRouteQuote: summarizeQuotes(routeLegs),
      totalEstimatedFees: routeLegs.reduce((sum, leg) => sum.plus(leg.routeQuote.estimatedFees), new Decimal(0)).toString(),
      totalEstimatedTimeSeconds: Math.max(...routeLegs.map((leg) => leg.routeQuote.estimatedTimeSeconds ?? 0))
    });
    await this.repository.appendAuditEvent({
      fundingIntentId,
      eventType: "FUNDING_ROUTES_QUOTED",
      payload: { routeLegCount: routeLegs.length, providers: [...new Set(routeLegs.map((leg) => leg.routeProvider))] }
    });
    await this.repository.appendAuditEvent({
      fundingIntentId,
      eventType: "FUNDING_USER_SIGNATURE_REQUIRED",
      payload: { routeLegCount: routeLegs.length }
    });
    return this.getIntent(userId, fundingIntentId);
  }

  private async quoteLifiRoute(
    intent: FundingIntent,
    target: FundingTarget,
    capability: VenueCapability,
    sourceTokenAddress: string,
    depositAddress: string
  ): Promise<FundingRouteQuote> {
    if (!this.config.lifiQuotesEnabled) {
      throw new FundingError("LIFI_QUOTES_DISABLED", "LI.FI funding quotes are disabled.", 503);
    }
    return this.lifi.quote({
      fromChain: intent.sourceChain,
      toChain: String(capability.preferredChainId),
      fromToken: sourceTokenAddress,
      toToken: capability.preferredTokenAddress,
      fromAmount: target.targetAmount,
      fromAddress: intent.sourceWalletAddress,
      toAddress: depositAddress,
      targetVenue: target.targetVenue
    });
  }

  public async submitRouteLeg(userId: string, fundingIntentId: string, input: { routeLegId: string; txHash: string }): Promise<FundingIntentView> {
    const view = await this.getIntent(userId, fundingIntentId);
    const leg = view.routeLegs.find((candidate) => candidate.routeLegId === input.routeLegId);
    if (!leg) {
      throw new FundingError("FUNDING_INTENT_NOT_FOUND", "Funding route leg was not found.", 404);
    }
    if (isQuoteExpired(leg)) {
      throw new FundingError("ROUTE_QUOTE_STALE", "Funding quote is stale. Request a new quote before submitting.", 409);
    }
    if (leg.txHashes.includes(input.txHash)) {
      throw new FundingError("FUNDING_ROUTE_REPLAY_BLOCKED", "Funding route transaction hash was already recorded.", 409);
    }
    if (!/^([A-Za-z0-9]{32,}|0x[a-fA-F0-9]{64})$/.test(input.txHash)) {
      throw new FundingError("ROUTE_SUBMISSION_FAILED", "Funding transaction hash is invalid.", 400);
    }
    const submittedStatus: FundingLegState = leg.routeProvider === "DIRECT_TRANSFER" ? "LEG_VENUE_CREDIT_PENDING" : "LEG_BRIDGE_PENDING";
    await this.repository.updateRouteLegSubmission({ routeLegId: leg.routeLegId, txHash: input.txHash, status: submittedStatus });
    if (leg.routeProvider === "DIRECT_TRANSFER") {
      await this.repository.updateRouteLegProviderStatus({
        routeLegId: leg.routeLegId,
        status: "LEG_VENUE_CREDIT_PENDING",
        bridgeStatus: "NOT_APPLICABLE",
        destinationStatus: "PENDING",
        venueCreditStatus: "PENDING",
        providerStatus: {
          provider: "DIRECT_TRANSFER",
          txHash: input.txHash,
          destinationChain: leg.destinationChain,
          token: leg.destinationToken
        },
        errorReason: null
      });
    }
    const nextLegStates = view.routeLegs.map((candidate) =>
      candidate.routeLegId === leg.routeLegId ? submittedStatus : candidate.status
    );
    await this.repository.updateIntentStatus(fundingIntentId, aggregateFundingStatus(nextLegStates));
    await this.repository.appendAuditEvent({
      fundingIntentId,
      routeLegId: leg.routeLegId,
      eventType: "FUNDING_LEG_SUBMITTED",
      payload: { txHash: input.txHash, provider: leg.routeProvider }
    });
    if (leg.routeProvider === "DIRECT_TRANSFER") {
      await this.repository.appendAuditEvent({
        fundingIntentId,
        routeLegId: leg.routeLegId,
        eventType: "FUNDING_LEG_VENUE_CREDIT_PENDING",
        payload: { txHash: input.txHash, provider: leg.routeProvider }
      });
    } else {
      await this.repository.appendAuditEvent({
        fundingIntentId,
        routeLegId: leg.routeLegId,
        eventType: "FUNDING_LEG_BRIDGE_PENDING",
        payload: { txHash: input.txHash }
      });
    }
    return this.getIntent(userId, fundingIntentId);
  }

  public async refreshIntentStatus(userId: string, fundingIntentId: string): Promise<FundingIntentView> {
    const view = await this.getIntent(userId, fundingIntentId);
    const refreshedStates: FundingLegState[] = [];
    for (const leg of view.routeLegs) {
      const latestTxHash = leg.txHashes.at(-1);
      if (!latestTxHash || leg.status === "LEG_READY_TO_TRADE" || leg.status === "LEG_FAILED") {
        refreshedStates.push(leg.status);
        continue;
      }
      if (leg.routeProvider === "DIRECT_TRANSFER") {
        if (this.config.venueReadinessChecksEnabled) {
          const verified = await this.verifyVenueReadiness(userId, fundingIntentId, leg.routeLegId);
          refreshedStates.push(verified.routeLegs.find((candidate) => candidate.routeLegId === leg.routeLegId)?.status ?? leg.status);
        } else {
          refreshedStates.push(leg.status);
        }
        continue;
      }
      const provider = await this.lifi.status({
        txHash: latestTxHash,
        fromChain: leg.routeQuote.sourceChain,
        toChain: leg.routeQuote.destinationChain
      });
      const mapped = mapLifiStatusToFundingLeg(provider.status);
      await this.repository.updateRouteLegProviderStatus({
        routeLegId: leg.routeLegId,
        status: mapped.status,
        bridgeStatus: mapped.bridgeStatus,
        destinationStatus: mapped.destinationStatus,
        venueCreditStatus: mapped.venueCreditStatus,
        providerStatus: provider.raw,
        errorReason: mapped.errorReason
      });
      if (mapped.auditEvent) {
        await this.repository.appendAuditEvent({
          fundingIntentId,
          routeLegId: leg.routeLegId,
          eventType: mapped.auditEvent,
          payload: { txHash: latestTxHash, providerStatus: provider.status }
        });
      }
      if (mapped.status === "LEG_DESTINATION_RECEIVED" || mapped.status === "LEG_VENUE_CREDIT_PENDING") {
        await this.repository.appendAuditEvent({
          fundingIntentId,
          routeLegId: leg.routeLegId,
          eventType: "FUNDING_LEG_VENUE_CREDIT_PENDING",
          payload: { txHash: latestTxHash }
        });
        if (this.config.venueReadinessChecksEnabled) {
          const verified = await this.verifyVenueReadiness(userId, fundingIntentId, leg.routeLegId);
          refreshedStates.push(verified.routeLegs.find((candidate) => candidate.routeLegId === leg.routeLegId)?.status ?? mapped.status);
          continue;
        }
      }
      refreshedStates.push(mapped.status);
    }
    if (refreshedStates.length > 0) {
      await this.repository.updateIntentStatus(fundingIntentId, aggregateFundingStatus(refreshedStates));
    }
    return this.getIntent(userId, fundingIntentId);
  }

  public async verifyVenueReadiness(userId: string, fundingIntentId: string, routeLegId: string): Promise<FundingIntentView> {
    const view = await this.getIntent(userId, fundingIntentId);
    const leg = view.routeLegs.find((candidate) => candidate.routeLegId === routeLegId);
    if (!leg) {
      throw new FundingError("FUNDING_INTENT_NOT_FOUND", "Funding route leg was not found.", 404);
    }
    const checker = this.venueReadinessCheckers.get(leg.targetVenue);
    if (!checker) {
      return this.applyVenueReadinessResult(userId, fundingIntentId, leg, {
        venue: leg.targetVenue,
        status: leg.destinationStatus === "CONFIRMED" ? "VENUE_CREDIT_PENDING" : "UNKNOWN",
        destinationReceived: leg.destinationStatus === "CONFIRMED",
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        token: "USDC",
        checkedAt: new Date().toISOString(),
        reason: "VENUE_READINESS_CHECKER_NOT_CONFIGURED",
        evidence: { source: "funding_service" }
      });
    }
    const result = await checker.check({
      userId,
      intent: view.intent,
      leg,
      reconciliations: view.reconciliations
    });
    return this.applyVenueReadinessResult(userId, fundingIntentId, leg, result);
  }

  private async applyVenueReadinessResult(
    userId: string,
    fundingIntentId: string,
    leg: FundingRouteLeg,
    result: VenueFundingReadinessResult
  ): Promise<FundingIntentView> {
    const view = await this.getIntent(userId, fundingIntentId);

    await this.repository.createReconciliationRecord({
      fundingIntentId,
      routeLegId: leg.routeLegId,
      targetVenue: leg.targetVenue,
      destinationTxHash: leg.txHashes.at(-1) ?? null,
      destinationReceived: result.destinationReceived,
      venueCreditConfirmed: result.venueCreditConfirmed,
      readyToTrade: result.readyToTrade,
      notes: result.reason
    });

    const isReady = result.destinationReceived && result.venueCreditConfirmed && result.readyToTrade;
    const nextStatus: FundingLegState = isReady
      ? "LEG_READY_TO_TRADE"
      : result.status === "FAILED"
        ? "LEG_RETRY_REQUIRED"
        : "LEG_VENUE_CREDIT_PENDING";
    await this.repository.updateRouteLegProviderStatus({
      routeLegId: leg.routeLegId,
      status: nextStatus,
      bridgeStatus: result.destinationReceived ? "DONE" : leg.bridgeStatus,
      destinationStatus: result.destinationReceived ? "CONFIRMED" : leg.destinationStatus,
      venueCreditStatus: result.venueCreditConfirmed ? "CONFIRMED" : result.status === "UNKNOWN" ? "UNKNOWN" : "PENDING",
      providerStatus: leg.providerStatus,
      errorReason: result.status === "UNKNOWN" || result.status === "FAILED" ? result.reason : leg.errorReason
    });

    const nextAggregateStatus = aggregateFundingStatus(view.routeLegs.map((candidate) =>
      candidate.routeLegId === leg.routeLegId ? nextStatus : candidate.status
    ));
    await this.repository.updateIntentStatus(fundingIntentId, nextAggregateStatus);

    if (isReady) {
      await this.repository.appendAuditEvent({
        fundingIntentId,
        routeLegId: leg.routeLegId,
        eventType: "FUNDING_LEG_READY_TO_TRADE",
        payload: { targetVenue: leg.targetVenue }
      });
      await this.repository.appendAuditEvent({
        fundingIntentId,
        eventType: nextAggregateStatus === "READY_TO_TRADE" ? "FUNDING_READY_TO_TRADE" : "FUNDING_PARTIALLY_READY_TO_TRADE",
        payload: { status: nextAggregateStatus }
      });
    } else if (result.status === "FAILED" || result.status === "UNKNOWN") {
      await this.repository.appendAuditEvent({
        fundingIntentId,
        routeLegId: leg.routeLegId,
        eventType: "FUNDING_LEG_FAILED",
        payload: { status: result.status, reason: result.reason }
      });
    } else {
      await this.repository.appendAuditEvent({
        fundingIntentId,
        routeLegId: leg.routeLegId,
        eventType: "FUNDING_LEG_VENUE_CREDIT_PENDING",
        payload: { status: result.status, reason: result.reason }
      });
    }

    return this.getIntent(userId, fundingIntentId);
  }

  public async hasReadyFundingForExecution(request: ExecutionRequestV0): Promise<boolean> {
    for (const venue of request.venuePath) {
      const ready = await this.repository.hasReadyVenueBalance({
        userId: request.userId,
        venue,
        token: "USDC",
        amount: request.size
      });
      if (!ready) {
        return false;
      }
    }
    return true;
  }

  public async createWithdrawalIntent(userId: string, input: CreateWithdrawalIntentInput): Promise<WithdrawalIntentView> {
    this.assertWithdrawalDestination(input.destinationWalletAddress);
    const existing = await this.repository.findWithdrawalIntentByUserAndIdempotencyKey(userId, input.idempotencyKey);
    if (existing) {
      return this.getWithdrawalIntent(userId, existing.withdrawalIntentId);
    }
    const sources = await this.buildWithdrawalSources(userId, input, randomUUID());
    const now = new Date().toISOString();
    const intent: WithdrawalIntent = {
      withdrawalIntentId: sources.withdrawalIntentId,
      userId,
      token: input.token,
      amount: input.amount,
      destinationChain: input.destinationChain,
      destinationWalletAddress: input.destinationWalletAddress,
      status: "WITHDRAWAL_CREATED",
      idempotencyKey: input.idempotencyKey,
      aggregateRouteQuote: {},
      totalEstimatedFees: "0",
      totalEstimatedTimeSeconds: null,
      auditEventIds: [],
      createdAt: now,
      updatedAt: now
    };
    const created = await this.repository.createWithdrawalIntent(intent, sources.sources);
    await this.repository.appendWithdrawalAuditEvent({
      withdrawalIntentId: created.withdrawalIntentId,
      eventType: "WITHDRAWAL_INTENT_CREATED",
      payload: { token: input.token, amount: input.amount, sourceCount: input.sources.length }
    });
    return this.getWithdrawalIntent(userId, created.withdrawalIntentId);
  }

  public async getWithdrawalIntent(userId: string, withdrawalIntentId: string): Promise<WithdrawalIntentView> {
    const intent = await this.repository.findWithdrawalIntentById(withdrawalIntentId);
    if (!intent) {
      throw new FundingError("WITHDRAWAL_INTENT_NOT_FOUND", "Withdrawal intent was not found.", 404);
    }
    if (intent.userId !== userId) {
      throw new FundingError("WITHDRAWAL_INTENT_FORBIDDEN", "Withdrawal intent does not belong to this user.", 403);
    }
    const [sources, routeLegs, reconciliations] = await Promise.all([
      this.repository.listWithdrawalSources(withdrawalIntentId),
      this.repository.listWithdrawalRouteLegs(withdrawalIntentId),
      this.repository.listWithdrawalReconciliations(withdrawalIntentId)
    ]);
    return {
      intent,
      sources,
      routeLegs,
      reconciliations,
      userSafeMessage: userSafeWithdrawalMessage(intent.status)
    };
  }

  public async quoteWithdrawalIntent(userId: string, withdrawalIntentId: string): Promise<WithdrawalIntentView> {
    const view = await this.getWithdrawalIntent(userId, withdrawalIntentId);
    const matrix = buildVenueCapabilityMatrix({ env: this.config.env });
    const routeLegSets = await Promise.all(view.sources.map(async (source) => {
      const capability = matrix[source.sourceVenue];
      if (!capability?.supportsWithdrawal) {
        throw new FundingError("WITHDRAWAL_CAPABILITY_DISABLED", `${source.sourceVenue} withdrawals are not enabled.`, 409);
      }
      const hasBalance = await this.repository.hasReadyVenueBalance({
        userId,
        venue: source.sourceVenue,
        token: source.sourceToken,
        amount: source.sourceAmount
      });
      if (!hasBalance) {
        throw new FundingError("WITHDRAWAL_SOURCE_BALANCE_INSUFFICIENT", `${source.sourceVenue} venue-ready balance is insufficient.`, 409);
      }
      if (this.shouldUseVenueEvmBridgeBack(view, source)) {
        return this.buildVenueEvmBridgeBackWithdrawalRouteLegs(userId, view, source);
      }
      if (this.shouldUsePolymarketBridgeSandbox(view, source)) {
        return [await this.buildPolymarketBridgeWithdrawalRouteLeg(view.intent, source)];
      }
      if (this.shouldUseLimitlessBridgeBack(view, source)) {
        return [await this.buildLimitlessBridgeBackWithdrawalRouteLeg(userId, view.intent, source)];
      }
      if (source.sourceVenue === "LIMITLESS") {
        throw new FundingError(
          "WITHDRAWAL_CAPABILITY_DISABLED",
          "Limitless beta withdrawals require a single-source Base USDC bridge-back route to a Solana destination.",
          409
        );
      }
      if (this.shouldUsePredictFunUserWalletDryRun(view, source)) {
        return [await this.buildPredictFunWithdrawalRouteLeg(userId, view.intent, source)];
      }
      if (this.shouldUseMyriadUserWalletDryRun(view, source)) {
        return [await this.buildMyriadWithdrawalRouteLeg(view.intent, source)];
      }
      if (this.shouldUseOpinionSafeDryRun(view, source)) {
        return [await this.buildOpinionWithdrawalRouteLeg(view.intent, source)];
      }
      return [buildWithdrawalRouteLeg(view.intent, source)];
    }));
    const routeLegs = routeLegSets.flat();
    await this.repository.replaceWithdrawalRouteLegs(withdrawalIntentId, routeLegs);
    await this.repository.updateWithdrawalIntentStatus(withdrawalIntentId, "USER_SIGNATURE_REQUIRED", {
      aggregateRouteQuote: summarizeWithdrawalQuotes(routeLegs),
      totalEstimatedFees: routeLegs.reduce((sum, leg) => sum.plus(leg.routeQuote.estimatedFees), new Decimal(0)).toString(),
      totalEstimatedTimeSeconds: Math.max(...routeLegs.map((leg) => leg.routeQuote.estimatedTimeSeconds ?? 0))
    });
    await this.repository.appendWithdrawalAuditEvent({
      withdrawalIntentId,
      eventType: "WITHDRAWAL_ROUTES_QUOTED",
      payload: { routeLegCount: routeLegs.length, provider: "LOTUS_WITHDRAWAL_V0" }
    });
    await this.repository.appendWithdrawalAuditEvent({
      withdrawalIntentId,
      eventType: "WITHDRAWAL_USER_SIGNATURE_REQUIRED",
      payload: { routeLegCount: routeLegs.length }
    });
    return this.getWithdrawalIntent(userId, withdrawalIntentId);
  }

  public async submitWithdrawalRouteLeg(
    userId: string,
    withdrawalIntentId: string,
    input: { withdrawalRouteLegId: string; txHash: string }
  ): Promise<WithdrawalIntentView> {
    const view = await this.getWithdrawalIntent(userId, withdrawalIntentId);
    const leg = view.routeLegs.find((candidate) => candidate.withdrawalRouteLegId === input.withdrawalRouteLegId);
    if (!leg) {
      throw new FundingError("WITHDRAWAL_INTENT_NOT_FOUND", "Withdrawal route leg was not found.", 404);
    }
    if (isWithdrawalQuoteExpired(leg) && !allowsStaleWithdrawalSubmission(leg)) {
      throw new FundingError("WITHDRAWAL_ROUTE_STALE", "Withdrawal quote is stale. Request a new quote before submitting.", 409);
    }
    if (leg.txHashes.includes(input.txHash)) {
      throw new FundingError("WITHDRAWAL_ROUTE_REPLAY_BLOCKED", "Withdrawal route transaction hash was already recorded.", 409);
    }
    if (!/^([A-Za-z0-9]{32,}|0x[a-fA-F0-9]{64})$/.test(input.txHash)) {
      throw new FundingError("WITHDRAWAL_SUBMISSION_FAILED", "Withdrawal transaction hash is invalid.", 400);
    }
    const isLifiBridgeBack = isLifiBridgeBackWithdrawalLeg(leg);
    const submittedStatus: WithdrawalLegState = isLifiBridgeBack ? "DESTINATION_PENDING" : "VENUE_RELEASE_PENDING";
    await this.repository.updateWithdrawalRouteLegSubmission({
      withdrawalRouteLegId: leg.withdrawalRouteLegId,
      txHash: input.txHash,
      status: submittedStatus,
      ...(isLifiBridgeBack ? { venueReleaseStatus: "CONFIRMED", destinationStatus: "PENDING" } : {})
    });
    const nextLegStates = view.routeLegs.map((candidate) =>
      candidate.withdrawalRouteLegId === leg.withdrawalRouteLegId ? submittedStatus : candidate.status
    );
    await this.repository.updateWithdrawalIntentStatus(withdrawalIntentId, aggregateWithdrawalStatus(nextLegStates));
    await this.repository.appendWithdrawalAuditEvent({
      withdrawalIntentId,
      withdrawalRouteLegId: leg.withdrawalRouteLegId,
      eventType: "WITHDRAWAL_LEG_SUBMITTED",
      payload: { txHash: input.txHash, provider: "LOTUS_WITHDRAWAL_V0" }
    });
    return this.getWithdrawalIntent(userId, withdrawalIntentId);
  }

  public async refreshWithdrawalStatus(userId: string, withdrawalIntentId: string): Promise<WithdrawalIntentView> {
    const view = await this.getWithdrawalIntent(userId, withdrawalIntentId);
    await this.refreshPolymarketBridgeSandboxStatus(view);
    const hasLifiBridgeBackLeg = view.routeLegs.some((leg) => isLifiBridgeBackWithdrawalLeg(leg));
    if (!this.withdrawalCompletionChecker && !hasLifiBridgeBackLeg) {
      return this.getWithdrawalIntent(userId, withdrawalIntentId);
    }

    const refreshedStates: WithdrawalLegState[] = [];
    const autoCompletedLegIds = new Set<string>();
    for (const leg of view.routeLegs) {
      const latestTxHash = leg.txHashes.at(-1);
      if (!latestTxHash || leg.status === "WITHDRAWAL_LEG_COMPLETED" || leg.status === "WITHDRAWAL_LEG_FAILED") {
        refreshedStates.push(leg.status);
        continue;
      }
      if (!["VENUE_RELEASE_PENDING", "DESTINATION_PENDING", "DESTINATION_RECEIVED", "WITHDRAWAL_LEG_RETRY_REQUIRED"].includes(leg.status)) {
        refreshedStates.push(leg.status);
        continue;
      }
      if (!isLifiBridgeBackWithdrawalLeg(leg) && !this.withdrawalCompletionChecker) {
        refreshedStates.push(leg.status);
        continue;
      }
      const result = isLifiBridgeBackWithdrawalLeg(leg)
        ? await this.checkLifiBridgeBackStatus(view.intent, leg, latestTxHash)
        : await this.withdrawalCompletionChecker!.check({
            userId,
            intent: view.intent,
            leg,
            reconciliations: view.reconciliations
          });
      const nextStatus = this.mapWithdrawalCompletionResult(view.intent, leg, result);
      const completed = nextStatus === "WITHDRAWAL_LEG_COMPLETED";
      if (completed && this.withdrawalCompletionPersistenceGate) {
        await this.withdrawalCompletionPersistenceGate.assertCanPersist({
          userId,
          intent: view.intent,
          leg,
          result
        });
      }
      const venueReleased = completed || result.venueReleased;
      const destinationReceived = completed || result.destinationReceived;
      await this.repository.createWithdrawalReconciliationRecord({
        withdrawalIntentId,
        withdrawalRouteLegId: leg.withdrawalRouteLegId,
        sourceVenue: leg.sourceVenue,
        withdrawalTxHash: result.withdrawalTxHash ?? latestTxHash,
        venueReleased,
        destinationReceived,
        completed,
        notes: result.reason
      });
      await this.repository.updateWithdrawalRouteLegReconciliation({
        withdrawalRouteLegId: leg.withdrawalRouteLegId,
        status: nextStatus,
        venueReleaseStatus: venueReleased ? "CONFIRMED" : result.status === "UNKNOWN" ? "UNKNOWN" : "PENDING",
        destinationStatus: destinationReceived ? "CONFIRMED" : result.status === "UNKNOWN" ? "UNKNOWN" : "PENDING",
        providerStatus: {
          source: "withdrawal_completion_reconciliation",
          status: result.status,
          reason: result.reason,
          evidence: result.evidence ?? {}
        },
        errorReason: nextStatus === "WITHDRAWAL_LEG_RETRY_REQUIRED" || nextStatus === "WITHDRAWAL_LEG_FAILED"
          ? result.reason
          : null
      });
      await this.repository.appendWithdrawalAuditEvent({
        withdrawalIntentId,
        withdrawalRouteLegId: leg.withdrawalRouteLegId,
        eventType: completed
          ? "WITHDRAWAL_LEG_COMPLETED"
          : nextStatus === "DESTINATION_PENDING"
            ? "WITHDRAWAL_VENUE_RELEASED"
            : nextStatus === "DESTINATION_RECEIVED"
              ? "WITHDRAWAL_DESTINATION_RECEIVED"
              : "WITHDRAWAL_RECONCILIATION_FAILED",
        payload: {
          status: result.status,
          reason: result.reason,
          venueReleased,
          destinationReceived,
          completed,
          evidence: result.evidence ?? {}
        }
      });
      if (completed && isLifiBridgeBackWithdrawalLeg(leg)) {
        const completedSourceLegIds = await this.completeVenueEvmSourceLegsSatisfiedByBridgeBack({
          withdrawalIntentId,
          view,
          bridgeBackLeg: leg,
          bridgeBackTxHash: result.withdrawalTxHash ?? latestTxHash
        });
        for (const completedSourceLegId of completedSourceLegIds) {
          autoCompletedLegIds.add(completedSourceLegId);
        }
      }
      refreshedStates.push(nextStatus);
    }
    if (refreshedStates.length > 0) {
      const nextAggregateStatus = aggregateWithdrawalStatus(view.routeLegs.map((leg, index) =>
        autoCompletedLegIds.has(leg.withdrawalRouteLegId)
          ? "WITHDRAWAL_LEG_COMPLETED"
          : refreshedStates[index] ?? leg.status
      ));
      await this.repository.updateWithdrawalIntentStatus(withdrawalIntentId, nextAggregateStatus);
      if (nextAggregateStatus === "COMPLETED" || nextAggregateStatus === "PARTIALLY_COMPLETED") {
        await this.repository.appendWithdrawalAuditEvent({
          withdrawalIntentId,
          eventType: nextAggregateStatus === "COMPLETED" ? "WITHDRAWAL_COMPLETED" : "WITHDRAWAL_PARTIALLY_COMPLETED",
          payload: { status: nextAggregateStatus }
        });
      }
    }
    return this.getWithdrawalIntent(userId, withdrawalIntentId);
  }

  private async completeVenueEvmSourceLegsSatisfiedByBridgeBack(input: {
    withdrawalIntentId: string;
    view: WithdrawalIntentView;
    bridgeBackLeg: WithdrawalRouteLeg;
    bridgeBackTxHash: string;
  }): Promise<string[]> {
    if (
      input.bridgeBackLeg.providerStatus.provider !== "LIFI"
      || input.bridgeBackLeg.providerStatus.mode !== "VENUE_EVM_BRIDGE_BACK"
    ) {
      return [];
    }
    const sourceLegs = input.view.routeLegs.filter((candidate) =>
      candidate.withdrawalRouteLegId !== input.bridgeBackLeg.withdrawalRouteLegId
      && candidate.withdrawalSourceId === input.bridgeBackLeg.withdrawalSourceId
      && candidate.sourceVenue === input.bridgeBackLeg.sourceVenue
      && candidate.status !== "WITHDRAWAL_LEG_COMPLETED"
      && candidate.status !== "WITHDRAWAL_LEG_FAILED"
      && candidate.providerStatus.bridgeBackPlanned === true
      && equalsIgnoreCase(stringOrNull(candidate.providerStatus.finalDestinationChain), input.view.intent.destinationChain)
      && equalsIgnoreCase(stringOrNull(candidate.providerStatus.finalDestinationWalletAddress), input.view.intent.destinationWalletAddress)
    );
    const completedLegIds: string[] = [];
    for (const sourceLeg of sourceLegs) {
      await this.repository.createWithdrawalReconciliationRecord({
        withdrawalIntentId: input.withdrawalIntentId,
        withdrawalRouteLegId: sourceLeg.withdrawalRouteLegId,
        sourceVenue: sourceLeg.sourceVenue,
        withdrawalTxHash: input.bridgeBackTxHash,
        venueReleased: true,
        destinationReceived: true,
        completed: true,
        notes: "VENUE_EVM_SOURCE_WALLET_EXIT_CONFIRMED_BY_BRIDGE_BACK"
      });
      await this.repository.updateWithdrawalRouteLegReconciliation({
        withdrawalRouteLegId: sourceLeg.withdrawalRouteLegId,
        status: "WITHDRAWAL_LEG_COMPLETED",
        venueReleaseStatus: "CONFIRMED",
        destinationStatus: "CONFIRMED",
        providerStatus: {
          ...sourceLeg.providerStatus,
          source: "venue_evm_bridge_back_completion",
          status: "COMPLETED",
          reason: "VENUE_EVM_SOURCE_WALLET_EXIT_CONFIRMED_BY_BRIDGE_BACK",
          bridgeBackWithdrawalRouteLegId: input.bridgeBackLeg.withdrawalRouteLegId
        },
        errorReason: null
      });
      await this.repository.appendWithdrawalAuditEvent({
        withdrawalIntentId: input.withdrawalIntentId,
        withdrawalRouteLegId: sourceLeg.withdrawalRouteLegId,
        eventType: "WITHDRAWAL_LEG_COMPLETED",
        payload: {
          status: "COMPLETED",
          reason: "VENUE_EVM_SOURCE_WALLET_EXIT_CONFIRMED_BY_BRIDGE_BACK",
          bridgeBackWithdrawalRouteLegId: input.bridgeBackLeg.withdrawalRouteLegId
        }
      });
      completedLegIds.push(sourceLeg.withdrawalRouteLegId);
    }
    return completedLegIds;
  }

  private shouldUsePolymarketBridgeSandbox(view: WithdrawalIntentView, source: WithdrawalSource): boolean {
    if (!this.polymarketBridgeWithdrawalAdapter || view.sources.length !== 1 || source.sourceVenue !== "POLYMARKET") {
      return false;
    }
    const capabilities = this.polymarketBridgeWithdrawalAdapter.getWithdrawalCapabilities();
    return capabilities.supportsWithdrawal && capabilities.readinessStatus === "DRY_RUN_READY";
  }

  private async checkLifiBridgeBackStatus(
    intent: WithdrawalIntent,
    leg: WithdrawalRouteLeg,
    latestTxHash: string
  ): Promise<WithdrawalCompletionEvidenceResult> {
    const sourceChain = typeof leg.providerStatus.sourceChain === "string" ? leg.providerStatus.sourceChain : "BASE";
    const destinationChain = typeof leg.providerStatus.destinationChain === "string"
      ? leg.providerStatus.destinationChain
      : intent.destinationChain;
    try {
      const { status, raw } = await this.lifi.status({
        txHash: latestTxHash,
        fromChain: sourceChain,
        toChain: destinationChain
      });
      const receiving = isRecord(raw.receiving) ? raw.receiving : {};
      const receivingToken = isRecord(receiving.token) ? receiving.token : {};
      const destinationTxHash = typeof receiving.txHash === "string" ? receiving.txHash : null;
      const receivedAmount = typeof receiving.amount === "string" ? receiving.amount : null;
      const receivedTokenDecimals = typeof receivingToken.decimals === "number" ? receivingToken.decimals : 6;
      const tokenSymbol = typeof receivingToken.symbol === "string" ? receivingToken.symbol : leg.sourceToken;
      const observedFromAddress = firstString(raw.fromAddress, raw.senderAddress, raw.sendingAddress);
      const observedToAddress = firstString(raw.toAddress, raw.receiverAddress, raw.recipientAddress);
      const expectedSourceWalletAddress = stringOrNull(leg.providerStatus.sourceWalletAddress);
      const sourceWalletMatches = expectedSourceWalletAddress !== null
        && observedFromAddress !== null
        && equalsIgnoreCase(observedFromAddress, expectedSourceWalletAddress);
      const destinationWalletMatches = observedToAddress !== null
        && equalsIgnoreCase(observedToAddress, intent.destinationWalletAddress);
      const completed = status === "DONE_COMPLETED";
      const destinationReceived = completed || status === "DONE_PARTIAL";
      const failed = status === "FAILED" || status === "DONE_REFUNDED";
      if (!failed && (completed || destinationReceived) && (!sourceWalletMatches || !destinationWalletMatches)) {
        return {
          status: "UNKNOWN",
          venueReleased: true,
          destinationReceived: false,
          completed: false,
          withdrawalTxHash: latestTxHash,
          destinationChain: intent.destinationChain,
          destinationWalletAddress: observedToAddress,
          token: tokenSymbol,
          amount: receivedAmount ? fromBaseUnits(receivedAmount, receivedTokenDecimals) : null,
          reason: "LIFI_BRIDGE_OWNERSHIP_UNVERIFIED",
          evidence: {
            source: "lifi_status",
            status,
            sourceChain,
            destinationChain,
            withdrawalTxHash: latestTxHash,
            destinationTxHash,
            expectedSourceWalletAddress,
            observedFromAddress,
            expectedDestinationWalletAddress: intent.destinationWalletAddress,
            observedToAddress,
            lifiExplorerLink: typeof raw.lifiExplorerLink === "string" ? raw.lifiExplorerLink : null
          }
        };
      }
      return {
        status: failed ? "FAILED" : completed ? "COMPLETED" : destinationReceived ? "DESTINATION_RECEIVED" : "UNKNOWN",
        venueReleased: true,
        destinationReceived,
        completed,
        withdrawalTxHash: latestTxHash,
        destinationChain: intent.destinationChain,
        destinationWalletAddress: observedToAddress,
        token: tokenSymbol,
        amount: receivedAmount ? fromBaseUnits(receivedAmount, receivedTokenDecimals) : null,
        reason: failed
          ? `LIFI_${status}`
          : completed
            ? "LIFI_BRIDGE_COMPLETED"
            : destinationReceived
              ? "LIFI_BRIDGE_DESTINATION_RECEIVED"
              : `LIFI_${status}`,
        evidence: {
          source: "lifi_status",
          status,
          sourceChain,
          destinationChain,
          withdrawalTxHash: latestTxHash,
          destinationTxHash,
          expectedSourceWalletAddress,
          observedFromAddress,
          expectedDestinationWalletAddress: intent.destinationWalletAddress,
          observedToAddress,
          lifiExplorerLink: typeof raw.lifiExplorerLink === "string" ? raw.lifiExplorerLink : null
        }
      };
    } catch (error) {
      return {
        status: "UNKNOWN",
        venueReleased: true,
        destinationReceived: false,
        completed: false,
        withdrawalTxHash: latestTxHash,
        destinationChain: intent.destinationChain,
        destinationWalletAddress: intent.destinationWalletAddress,
        token: leg.sourceToken,
        amount: null,
        reason: error instanceof Error ? `LIFI_STATUS_UNAVAILABLE: ${error.message}` : "LIFI_STATUS_UNAVAILABLE",
        evidence: {
          source: "lifi_status",
          status: "UNKNOWN",
          sourceChain,
          destinationChain,
          withdrawalTxHash: latestTxHash
        }
      };
    }
  }

  private shouldUseLimitlessBridgeBack(view: WithdrawalIntentView, source: WithdrawalSource): boolean {
    return this.config.env?.LIMITLESS_WITHDRAWAL_BRIDGE_BACK_ENABLED === "true"
      && view.sources.length === 1
      && source.sourceVenue === "LIMITLESS"
      && equalsIgnoreCase(source.sourceToken, "USDC")
      && normalizeFundingChain(view.intent.destinationChain) === "SOLANA";
  }

  private shouldUseVenueEvmBridgeBack(view: WithdrawalIntentView, source: WithdrawalSource): boolean {
    if (view.sources.length !== 1 || source.sourceVenue === "LIMITLESS") {
      return false;
    }
    return this.config.env?.[`${source.sourceVenue}_WITHDRAWAL_BRIDGE_BACK_ENABLED`] === "true"
      && normalizeFundingChain(view.intent.destinationChain) === "SOLANA";
  }

  private shouldUsePredictFunUserWalletDryRun(view: WithdrawalIntentView, source: WithdrawalSource): boolean {
    if (!this.predictFunWithdrawalAdapter || view.sources.length !== 1 || source.sourceVenue !== "PREDICT_FUN") {
      return false;
    }
    const capabilities = this.predictFunWithdrawalAdapter.getWithdrawalCapabilities();
    return capabilities.supportsWithdrawal && capabilities.readinessStatus === "DRY_RUN_READY";
  }

  private shouldUseMyriadUserWalletDryRun(view: WithdrawalIntentView, source: WithdrawalSource): boolean {
    if (!this.myriadWithdrawalAdapter || view.sources.length !== 1 || source.sourceVenue !== "MYRIAD") {
      return false;
    }
    const capabilities = this.myriadWithdrawalAdapter.getWithdrawalCapabilities();
    return capabilities.supportsWithdrawal && capabilities.readinessStatus === "DRY_RUN_READY";
  }

  private shouldUseOpinionSafeDryRun(view: WithdrawalIntentView, source: WithdrawalSource): boolean {
    if (!this.opinionWithdrawalAdapter || view.sources.length !== 1 || source.sourceVenue !== "OPINION") {
      return false;
    }
    const capabilities = this.opinionWithdrawalAdapter.getWithdrawalCapabilities();
    return capabilities.supportsWithdrawal && capabilities.readinessStatus === "DRY_RUN_READY";
  }

  private async buildPolymarketBridgeWithdrawalRouteLeg(
    intent: WithdrawalIntent,
    source: WithdrawalSource
  ): Promise<WithdrawalRouteLeg> {
    if (!this.polymarketBridgeWithdrawalAdapter) {
      return buildWithdrawalRouteLeg(intent, source);
    }
    try {
      const supportedAssets = await this.polymarketBridgeWithdrawalAdapter.getSupportedBridgeAssets();
      const quote = await this.polymarketBridgeWithdrawalAdapter.prepareWithdrawalQuote({
        destinationChain: intent.destinationChain,
        destinationToken: intent.token,
        destinationAddress: intent.destinationWalletAddress,
        amount: source.sourceAmount
      });
      const userAction = await this.polymarketBridgeWithdrawalAdapter.prepareUserAction(quote);
      return buildPolymarketBridgeWithdrawalRouteLeg(intent, source, quote, userAction, supportedAssets.length);
    } catch (error) {
      const normalized = this.polymarketBridgeWithdrawalAdapter.normalizeWithdrawalError(error);
      throw new FundingError(
        "WITHDRAWAL_PROVIDER_UNAVAILABLE",
        `Polymarket Bridge sandbox quote failed closed: ${normalized.message}`,
        503
      );
    }
  }

  private async buildLimitlessBridgeBackWithdrawalRouteLeg(
    userId: string,
    intent: WithdrawalIntent,
    source: WithdrawalSource
  ): Promise<WithdrawalRouteLeg> {
    const sourceWallet = await this.userWalletService?.resolveUserTurnkeyEvmFundingWallet(userId);
    if (!sourceWallet || sourceWallet.chainFamily !== "EVM" || sourceWallet.status !== "ACTIVE") {
      throw new FundingError("SOURCE_WALLET_UNAVAILABLE", "Limitless bridge-back requires an active user-controlled EVM wallet.", 409);
    }
    const fromChain = this.config.env?.LIMITLESS_WITHDRAWAL_BRIDGE_BACK_SOURCE_CHAIN ?? "BASE";
    const fromToken = this.config.env?.LIMITLESS_WITHDRAWAL_BRIDGE_BACK_SOURCE_TOKEN_ADDRESS
      ?? this.config.env?.LIMITLESS_USDC_TOKEN_ADDRESS
      ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const toToken = this.config.env?.LIMITLESS_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_ADDRESS
      ?? this.config.env?.SOLANA_USDC_TOKEN_ADDRESS
      ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const quote = await this.lifi.quote({
      fromChain,
      toChain: "SOLANA",
      fromToken,
      toToken,
      fromAmount: source.sourceAmount,
      fromAddress: sourceWallet.address,
      toAddress: intent.destinationWalletAddress,
      targetVenue: "LIMITLESS"
    });
    return buildLimitlessBridgeBackWithdrawalRouteLeg(intent, source, quote, sourceWallet.address);
  }

  private async buildVenueEvmBridgeBackWithdrawalRouteLegs(
    userId: string,
    view: WithdrawalIntentView,
    source: WithdrawalSource
  ): Promise<WithdrawalRouteLeg[]> {
    const bridgePlan = await this.resolveVenueEvmBridgeBackPlan(userId, view.intent, source);
    const firstHopIntent: WithdrawalIntent = {
      ...view.intent,
      token: bridgePlan.sourceTokenSymbol,
      destinationChain: bridgePlan.sourceChain,
      destinationWalletAddress: bridgePlan.sourceWalletAddress
    };
    const firstHopLeg = await this.buildSingleVenueWithdrawalRouteLeg(userId, view, firstHopIntent, source);
    const quote = await this.lifi.quote({
      fromChain: bridgePlan.sourceChain,
      toChain: "SOLANA",
      fromToken: bridgePlan.sourceTokenAddress,
      toToken: bridgePlan.destinationTokenAddress,
      fromAmount: source.sourceAmount,
      fromAddress: bridgePlan.sourceWalletAddress,
      toAddress: view.intent.destinationWalletAddress,
      targetVenue: source.sourceVenue
    });
    return [
      withVenueBridgeBackMetadata(firstHopLeg, {
        finalDestinationChain: view.intent.destinationChain,
        finalDestinationWalletAddress: view.intent.destinationWalletAddress
      }),
      buildVenueEvmBridgeBackWithdrawalRouteLeg({
        intent: view.intent,
        source,
        bridgeQuote: quote,
        sourceWalletAddress: bridgePlan.sourceWalletAddress,
        sourceWalletProvider: bridgePlan.sourceWalletProvider,
        sourceChain: bridgePlan.sourceChain,
        sourceTokenSymbol: bridgePlan.sourceTokenSymbol,
        destinationTokenSymbol: bridgePlan.destinationTokenSymbol
      })
    ];
  }

  private async buildSingleVenueWithdrawalRouteLeg(
    userId: string,
    view: WithdrawalIntentView,
    intent: WithdrawalIntent,
    source: WithdrawalSource
  ): Promise<WithdrawalRouteLeg> {
    if (this.shouldUsePolymarketBridgeSandbox({ ...view, intent }, source)) {
      return this.buildPolymarketBridgeWithdrawalRouteLeg(intent, source);
    }
    if (this.shouldUsePredictFunUserWalletDryRun(view, source)) {
      return this.buildPredictFunWithdrawalRouteLeg(userId, intent, source);
    }
    if (this.shouldUseMyriadUserWalletDryRun(view, source)) {
      return this.buildMyriadWithdrawalRouteLeg(intent, source);
    }
    if (this.shouldUseOpinionSafeDryRun(view, source)) {
      return this.buildOpinionWithdrawalRouteLeg(intent, source);
    }
    return buildWithdrawalRouteLeg(intent, source);
  }

  private async resolveVenueEvmBridgeBackPlan(
    userId: string,
    intent: WithdrawalIntent,
    source: WithdrawalSource
  ): Promise<{
    sourceChain: string;
    sourceTokenSymbol: string;
    sourceTokenAddress: string;
    sourceWalletAddress: string;
    sourceWalletProvider: "TURNKEY" | "EXTERNAL_EVM";
    destinationTokenSymbol: string;
    destinationTokenAddress: string;
  }> {
    const externalSourceWalletAddress = this.config.env?.[`${source.sourceVenue}_WITHDRAWAL_BRIDGE_BACK_SOURCE_WALLET_ADDRESS`]?.trim();
    let sourceWalletAddress: string;
    let sourceWalletProvider: "TURNKEY" | "EXTERNAL_EVM";
    if (externalSourceWalletAddress) {
      if (!isEvmAddress(externalSourceWalletAddress)) {
        throw new FundingError(
          "SOURCE_WALLET_UNAVAILABLE",
          `${source.sourceVenue} bridge-back source wallet address must be an EVM address.`,
          409
        );
      }
      sourceWalletAddress = externalSourceWalletAddress;
      sourceWalletProvider = "EXTERNAL_EVM";
    } else {
      const sourceWallet = await this.userWalletService?.resolveUserTurnkeyEvmFundingWallet(userId);
      if (!sourceWallet || sourceWallet.chainFamily !== "EVM" || sourceWallet.status !== "ACTIVE") {
        throw new FundingError("SOURCE_WALLET_UNAVAILABLE", `${source.sourceVenue} bridge-back requires an active user-controlled EVM wallet.`, 409);
      }
      sourceWalletAddress = sourceWallet.address;
      sourceWalletProvider = "TURNKEY";
    }
    const sourceChain = this.config.env?.[`${source.sourceVenue}_WITHDRAWAL_BRIDGE_BACK_SOURCE_CHAIN`]
      ?? defaultWithdrawalBridgeBackSourceChain(source.sourceVenue);
    const sourceTokenSymbol = source.sourceToken.toUpperCase();
    const sourceTokenAddress = this.config.env?.[`${source.sourceVenue}_WITHDRAWAL_BRIDGE_BACK_SOURCE_TOKEN_ADDRESS`]
      ?? defaultWithdrawalBridgeBackSourceTokenAddress(source.sourceVenue, sourceTokenSymbol);
    const destinationTokenSymbol = this.config.env?.[`${source.sourceVenue}_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_SYMBOL`]
      ?? defaultWithdrawalBridgeBackDestinationTokenSymbol(sourceTokenSymbol);
    const destinationTokenAddress = this.config.env?.[`${source.sourceVenue}_WITHDRAWAL_BRIDGE_BACK_DESTINATION_TOKEN_ADDRESS`]
      ?? this.config.env?.[`SOLANA_${destinationTokenSymbol}_TOKEN_ADDRESS`]
      ?? defaultSolanaTokenAddress(destinationTokenSymbol);
    if (!sourceChain || !sourceTokenAddress || !destinationTokenAddress) {
      throw new FundingError(
        "WITHDRAWAL_CAPABILITY_DISABLED",
        `${source.sourceVenue} bridge-back is enabled but source/destination token mapping is not configured.`,
        409
      );
    }
    if (!isSolanaAddress(intent.destinationWalletAddress)) {
      throw new FundingError("WITHDRAWAL_DESTINATION_INVALID", "Bridge-back withdrawals require a Solana destination wallet.", 400);
    }
    return {
      sourceChain,
      sourceTokenSymbol,
      sourceTokenAddress,
      sourceWalletAddress,
      sourceWalletProvider,
      destinationTokenSymbol,
      destinationTokenAddress
    };
  }

  private async buildPredictFunWithdrawalRouteLeg(
    userId: string,
    intent: WithdrawalIntent,
    source: WithdrawalSource
  ): Promise<WithdrawalRouteLeg> {
    if (!this.predictFunWithdrawalAdapter) {
      return buildWithdrawalRouteLeg(intent, source);
    }
    try {
      const quote = await this.predictFunWithdrawalAdapter.prepareWithdrawalQuote({
        destinationChain: intent.destinationChain,
        destinationToken: intent.token,
        destinationAddress: intent.destinationWalletAddress,
        amount: source.sourceAmount
      });
      const userAction = await this.predictFunWithdrawalAdapter.prepareUserAction(quote);
      const evmWithdrawalWalletPresent = await this.userWithdrawalWalletReader?.hasEvmWithdrawalWallet(
        userId,
        intent.destinationWalletAddress
      ) ?? false;
      return buildPredictFunWithdrawalRouteLeg(intent, source, quote, userAction, evmWithdrawalWalletPresent);
    } catch (error) {
      const normalized = this.predictFunWithdrawalAdapter.normalizeWithdrawalError(error);
      throw new FundingError(
        "WITHDRAWAL_PROVIDER_UNAVAILABLE",
        `Predict.fun user-wallet dry-run quote failed closed: ${normalized.message}`,
        503
      );
    }
  }

  private async buildMyriadWithdrawalRouteLeg(
    intent: WithdrawalIntent,
    source: WithdrawalSource
  ): Promise<WithdrawalRouteLeg> {
    if (!this.myriadWithdrawalAdapter) {
      return buildWithdrawalRouteLeg(intent, source);
    }
    try {
      const quote = await this.myriadWithdrawalAdapter.prepareWithdrawalQuote({
        destinationChain: intent.destinationChain,
        destinationToken: intent.token,
        destinationAddress: intent.destinationWalletAddress,
        amount: source.sourceAmount
      });
      const userAction = await this.myriadWithdrawalAdapter.prepareUserAction(quote);
      return buildMyriadWithdrawalRouteLeg(intent, source, quote, userAction);
    } catch (error) {
      const normalized = this.myriadWithdrawalAdapter.normalizeWithdrawalError(error);
      throw new FundingError(
        "WITHDRAWAL_PROVIDER_UNAVAILABLE",
        `Myriad user-wallet dry-run quote failed closed: ${normalized.message}`,
        503
      );
    }
  }

  private async buildOpinionWithdrawalRouteLeg(
    intent: WithdrawalIntent,
    source: WithdrawalSource
  ): Promise<WithdrawalRouteLeg> {
    if (!this.opinionWithdrawalAdapter) {
      return buildWithdrawalRouteLeg(intent, source);
    }
    try {
      const quote = await this.opinionWithdrawalAdapter.prepareWithdrawalQuote({
        destinationChain: intent.destinationChain,
        destinationToken: intent.token,
        destinationAddress: intent.destinationWalletAddress,
        amount: source.sourceAmount
      });
      const userAction = await this.opinionWithdrawalAdapter.prepareUserAction(quote);
      return buildOpinionWithdrawalRouteLeg(intent, source, quote, userAction);
    } catch (error) {
      const normalized = this.opinionWithdrawalAdapter.normalizeWithdrawalError(error);
      throw new FundingError(
        "WITHDRAWAL_PROVIDER_UNAVAILABLE",
        `Opinion Safe dry-run quote failed closed: ${normalized.message}`,
        503
      );
    }
  }

  private async refreshPolymarketBridgeSandboxStatus(view: WithdrawalIntentView): Promise<void> {
    if (!this.polymarketBridgeWithdrawalAdapter) {
      return;
    }
    for (const leg of view.routeLegs) {
      const providerStatus = leg.providerStatus;
      if (providerStatus.provider !== "POLYMARKET_BRIDGE" || providerStatus.mode !== "SANDBOX_DRY_RUN") {
        continue;
      }
      const bridgeAddress = typeof providerStatus.bridgeAddress === "string" ? providerStatus.bridgeAddress : null;
      const latestTxHash = leg.txHashes.at(-1) ?? null;
      if (!bridgeAddress && !latestTxHash) {
        continue;
      }
      try {
        const status = await this.polymarketBridgeWithdrawalAdapter.fetchWithdrawalStatus({
          bridgeAddress,
          txHash: latestTxHash
        });
        await this.repository.updateWithdrawalRouteLegReconciliation({
          withdrawalRouteLegId: leg.withdrawalRouteLegId,
          status: leg.status,
          venueReleaseStatus: leg.venueReleaseStatus,
          destinationStatus: leg.destinationStatus,
          providerStatus: buildPolymarketBridgeProviderStatus({
            quote: null,
            userAction: null,
            supportedAssetsChecked: null,
            status,
            existingProviderStatus: providerStatus
          }),
          errorReason: null
        });
      } catch (error) {
        const normalized = this.polymarketBridgeWithdrawalAdapter.normalizeWithdrawalError(error);
        await this.repository.updateWithdrawalRouteLegReconciliation({
          withdrawalRouteLegId: leg.withdrawalRouteLegId,
          status: leg.status,
          venueReleaseStatus: leg.venueReleaseStatus,
          destinationStatus: leg.destinationStatus,
          providerStatus: {
            ...providerStatus,
            status: "UNKNOWN",
            completionPersisted: false,
            warnings: [
              "Polymarket Bridge sandbox status could not be refreshed.",
              "Dry-run status is not withdrawal completion evidence."
            ],
            error: normalized
          },
          errorReason: null
        });
      }
    }
  }

  private mapWithdrawalCompletionResult(
    intent: WithdrawalIntent,
    leg: WithdrawalRouteLeg,
    result: WithdrawalCompletionEvidenceResult
  ): WithdrawalLegState {
    if (result.status === "FAILED") {
      return "WITHDRAWAL_LEG_FAILED";
    }
    if (result.status === "UNKNOWN") {
      return "WITHDRAWAL_LEG_RETRY_REQUIRED";
    }
    if (!result.venueReleased) {
      return "VENUE_RELEASE_PENDING";
    }
    if (!result.destinationReceived) {
      return "DESTINATION_PENDING";
    }
      const observedAmount = toDecimalOrNull(result.amount);
      const expectedToken = expectedWithdrawalResultToken(leg);
      const amountMatches = observedAmount !== null
        && (
          observedAmount.gte(new Decimal(leg.destinationAmountEstimate))
          || (result.completed && isLifiBridgeBackWithdrawalLeg(leg) && observedAmount.gt(0))
        );
      const destinationMatches = equalsIgnoreCase(result.destinationWalletAddress, intent.destinationWalletAddress)
        && equalsIgnoreCase(result.destinationChain, intent.destinationChain)
        && equalsIgnoreCase(result.token, expectedToken)
        && amountMatches;
    if (!destinationMatches) {
      return "WITHDRAWAL_LEG_RETRY_REQUIRED";
    }
    return result.completed ? "WITHDRAWAL_LEG_COMPLETED" : "DESTINATION_RECEIVED";
  }

  private buildTargets(input: CreateFundingIntentInput, fundingIntentId: string): { fundingIntentId: string; targets: FundingTarget[] } {
    const matrix = buildVenueCapabilityMatrix({ env: this.config.env });
    const now = new Date().toISOString();
    validateSplit(input);
    const targets = input.targets.map((target): FundingTarget => {
      const capability = matrix[target.targetVenue];
      const targetAmount = target.targetAmount ?? new Decimal(input.sourceAmount).times(target.targetPercentage ?? 0).div(100).toString();
      return {
        fundingTargetId: randomUUID(),
        fundingIntentId,
        targetVenue: target.targetVenue,
        targetChain: capability.preferredChain,
        targetToken: capability.preferredToken,
        targetAmount,
        targetPercentage: target.targetPercentage ?? null,
        venueCapabilitySnapshot: capability,
        status: "LEG_CREATED",
        createdAt: now,
        updatedAt: now
      };
    });
    return { fundingIntentId, targets };
  }

  private async buildWithdrawalSources(
    userId: string,
    input: CreateWithdrawalIntentInput,
    withdrawalIntentId: string
  ): Promise<{ withdrawalIntentId: string; sources: WithdrawalSource[] }> {
    validateWithdrawalSplit(input);
    const matrix = buildVenueCapabilityMatrix({ env: this.config.env });
    const now = new Date().toISOString();
    const sources: WithdrawalSource[] = [];
    for (const source of input.sources) {
      const capability = matrix[source.sourceVenue];
      if (!capability?.supportsWithdrawal) {
        throw new FundingError("WITHDRAWAL_CAPABILITY_DISABLED", `${source.sourceVenue} withdrawals are not enabled.`, 409);
      }
      const sourceAmount = source.sourceAmount ?? new Decimal(input.amount).times(source.sourcePercentage ?? 0).div(100).toString();
      sources.push({
        withdrawalSourceId: randomUUID(),
        withdrawalIntentId,
        sourceVenue: source.sourceVenue,
        sourceToken: input.token,
        sourceAmount,
        sourcePercentage: source.sourcePercentage ?? null,
        venueCapabilitySnapshot: capability,
        status: "WITHDRAWAL_LEG_CREATED",
        createdAt: now,
        updatedAt: now
      });
    }
    const balances = await this.repository.listVenueBalances(userId);
    for (const source of sources) {
      const balance = balances.find((candidate) => candidate.venue === source.sourceVenue && candidate.token === source.sourceToken);
      if (!balance || new Decimal(balance.availableAmount).lt(source.sourceAmount)) {
        throw new FundingError("WITHDRAWAL_SOURCE_BALANCE_INSUFFICIENT", `${source.sourceVenue} venue-ready balance is insufficient.`, 409);
      }
    }
    return { withdrawalIntentId, sources };
  }

  private assertWithdrawalDestination(destinationWalletAddress: string): void {
    if (!/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,64})$/.test(destinationWalletAddress)) {
      throw new FundingError("WITHDRAWAL_DESTINATION_INVALID", "Withdrawal destination wallet address is invalid.", 400);
    }
  }

  private assertCapabilityReady(capability: VenueCapability | undefined, intent: FundingIntent): asserts capability is VenueCapability {
    if (!capability) {
      throw new FundingError("VENUE_CAPABILITY_UNKNOWN", "Venue capability is unknown.", 409);
    }
    if (capability.readinessStatus !== "READY") {
      throw new FundingError("VENUE_CAPABILITY_DISABLED", `${capability.venue} funding is not enabled.`, 409);
    }
    if (!capability.supportedChains.includes(intent.sourceChain)) {
      throw new FundingError("SOURCE_CHAIN_UNSUPPORTED", "Source chain is not supported for this venue.", 409);
    }
    if (!capability.supportedTokens.includes(intent.sourceToken)) {
      throw new FundingError("SOURCE_TOKEN_UNSUPPORTED", "Source token is not supported for this venue.", 409);
    }
  }

  private async resolveSourceWallet(userId: string, input: CreateFundingIntentInput): Promise<UserWallet | null> {
    if (!this.userWalletService) {
      if (input.sourceWalletId) {
        throw new FundingError("SOURCE_WALLET_UNAVAILABLE", "Stored funding source wallets are not configured.", 503);
      }
      return null;
    }
    try {
      return await this.userWalletService.resolveFundingSourceWallet({
        userId,
        sourceChain: input.sourceChain,
        sourceWalletId: input.sourceWalletId ?? null
      });
    } catch (error) {
      if (error instanceof UserWalletError) {
        if (error.code === "USER_WALLET_NOT_FOUND") {
          throw new FundingError("SOURCE_WALLET_NOT_FOUND", error.message, 404);
        }
        if (error.code === "USER_WALLET_FORBIDDEN") {
          throw new FundingError("SOURCE_WALLET_FORBIDDEN", error.message, 403);
        }
        if (error.code === "USER_WALLET_UNAVAILABLE") {
          throw new FundingError("SOURCE_WALLET_UNAVAILABLE", error.message, 409);
        }
      }
      throw error;
    }
  }

  private async resolveFundingDestinationAddress(userId: string, venue: FundingVenue, destinationChain: string): Promise<string | null> {
    const mode = getVenueFundingDestinationMode(venue, this.config.env);
    if (mode === "VENUE_DEPOSIT_ENV") {
      return getVenueDepositAddressForChain(venue, destinationChain, this.config.env) ?? getVenueDepositAddress(venue, this.config.env);
    }
    if (mode === "USER_VENUE_DEPOSIT_WALLET") {
      const wallet = await this.userWalletService?.resolveVenueTargetWallet(userId, venue);
      if (!wallet || wallet.chainFamily !== "EVM") {
        throw new FundingError("TARGET_WALLET_NOT_CONFIGURED", `${venue} requires an active user-specific venue deposit wallet.`, 409);
      }
      return wallet.address;
    }
    const wallet = await this.userWalletService?.resolveUserTurnkeyEvmFundingWallet(userId);
    if (!wallet || wallet.provider !== "TURNKEY" || wallet.chainFamily !== "EVM" || !wallet.exportable) {
      throw new FundingError("TARGET_WALLET_NOT_CONFIGURED", `${venue} requires an active exportable Turnkey EVM wallet.`, 409);
    }
    return wallet.address;
  }
}

export class FundingReadinessChecker {
  public constructor(private readonly service: Pick<FundingService, "hasReadyFundingForExecution">, private readonly enabled: boolean) {}

  public async hasFunding(input: { request: ExecutionRequestV0 }): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }
    return this.service.hasReadyFundingForExecution(input.request);
  }
}

const validateSplit = (input: CreateFundingIntentInput): void => {
  const percentages = input.targets.map((target) => target.targetPercentage).filter((value): value is number => typeof value === "number");
  if (percentages.length > 0 && percentages.length !== input.targets.length) {
    throw new FundingError("TARGET_SPLIT_INVALID", "Use either percentages for all targets or explicit amounts for all targets.", 400);
  }
  if (percentages.length > 0) {
    const total = percentages.reduce((sum, value) => sum.plus(value), new Decimal(0));
    if (!total.eq(100)) {
      throw new FundingError("TARGET_SPLIT_INVALID", "Funding target percentages must sum to 100.", 400);
    }
  } else {
    const total = input.targets.reduce((sum, target) => sum.plus(target.targetAmount ?? "0"), new Decimal(0));
    if (!total.eq(input.sourceAmount)) {
      throw new FundingError("TARGET_SPLIT_INVALID", "Funding target amounts must match source amount.", 400);
    }
  }
};

const validateWithdrawalSplit = (input: CreateWithdrawalIntentInput): void => {
  const uniqueVenues = new Set(input.sources.map((source) => source.sourceVenue));
  if (uniqueVenues.size !== input.sources.length) {
    throw new FundingError("TARGET_SPLIT_INVALID", "Withdrawal sources must use each venue at most once.", 400);
  }
  const percentages = input.sources.map((source) => source.sourcePercentage).filter((value): value is number => typeof value === "number");
  if (percentages.length > 0 && percentages.length !== input.sources.length) {
    throw new FundingError("TARGET_SPLIT_INVALID", "Use either percentages for all withdrawal sources or explicit amounts for all sources.", 400);
  }
  if (percentages.length > 0) {
    const total = percentages.reduce((sum, value) => sum.plus(value), new Decimal(0));
    if (!total.eq(100)) {
      throw new FundingError("TARGET_SPLIT_INVALID", "Withdrawal source percentages must sum to 100.", 400);
    }
  } else {
    const total = input.sources.reduce((sum, source) => sum.plus(source.sourceAmount ?? "0"), new Decimal(0));
    if (!total.eq(input.amount)) {
      throw new FundingError("TARGET_SPLIT_INVALID", "Withdrawal source amounts must match withdrawal amount.", 400);
    }
  }
};

const buildDirectTransferQuote = (input: {
  intent: FundingIntent;
  target: FundingTarget;
  capability: VenueCapability;
  sourceTokenAddress: string;
  depositAddress: string;
  env?: NodeJS.ProcessEnv;
}): FundingRouteQuote | null => {
  if (input.env?.FUNDING_DIRECT_TRANSFER_QUOTES_ENABLED === "false") {
    return null;
  }
  const sourceChainKey = normalizeFundingChain(input.intent.sourceChain);
  const destinationChainKey = normalizeFundingChain(input.capability.preferredChain);
  if (!isEvmChain(sourceChainKey, input.intent.sourceChain) || sourceChainKey !== destinationChainKey) {
    return null;
  }
  if (!isEvmAddress(input.intent.sourceWalletAddress) || !isEvmAddress(input.depositAddress) || !isEvmAddress(input.capability.preferredTokenAddress)) {
    return null;
  }
  if (!tokenMatches(input.intent.sourceToken, input.capability.preferredToken, input.sourceTokenAddress, input.capability.preferredTokenAddress)) {
    return null;
  }
  const decimals = directTransferTokenDecimals({
    chainKey: sourceChainKey,
    tokenSymbol: input.capability.preferredToken,
    tokenAddress: input.capability.preferredTokenAddress,
    ...(input.env ? { env: input.env } : {})
  });
  const atomicAmount = decimalToAtomicAmount(input.target.targetAmount, decimals);
  const expiresAt = new Date(Date.now() + directTransferQuoteTtlSeconds(input.env) * 1000).toISOString();
  return {
    provider: "DIRECT_TRANSFER",
    providerRouteId: `direct-${input.target.fundingTargetId}`,
    sourceChain: input.intent.sourceChain,
    sourceToken: input.sourceTokenAddress,
    sourceAmount: input.target.targetAmount,
    destinationChain: String(input.capability.preferredChainId),
    destinationToken: input.capability.preferredTokenAddress,
    destinationAmountEstimate: input.target.targetAmount,
    estimatedFees: "0",
    estimatedTimeSeconds: null,
    expiresAt,
    transactionRequest: {
      from: input.intent.sourceWalletAddress,
      to: input.capability.preferredTokenAddress,
      data: encodeErc20Transfer(input.depositAddress, atomicAmount),
      value: "0",
      chainId: input.capability.preferredChainId
    },
    userSafeSummary: `Direct transfer ${input.target.targetAmount} ${input.capability.preferredToken} on ${input.capability.preferredChain} to ${input.target.targetVenue}.`
  };
};

const buildRouteLeg = (intent: FundingIntent, target: FundingTarget, quote: FundingRouteQuote): FundingRouteLeg => {
  const now = new Date().toISOString();
  return {
    routeLegId: randomUUID(),
    fundingIntentId: intent.fundingIntentId,
    fundingTargetId: target.fundingTargetId,
    targetVenue: target.targetVenue,
    sourceChain: intent.sourceChain,
    sourceToken: intent.sourceToken,
    sourceAmount: target.targetAmount,
    destinationChain: target.targetChain,
    destinationToken: target.targetToken,
    destinationAmountEstimate: quote.destinationAmountEstimate,
    routeProvider: quote.provider,
    routeQuote: quote,
    txHashes: [],
    providerStatus: {},
    bridgeStatus: "NOT_SUBMITTED",
    destinationStatus: "NOT_CONFIRMED",
    venueCreditStatus: "NOT_CONFIRMED",
    status: "LEG_SIGNATURE_REQUIRED",
    errorReason: null,
    createdAt: now,
    updatedAt: now
  };
};

const summarizeQuotes = (routeLegs: readonly FundingRouteLeg[]): Record<string, unknown> => ({
  providers: [...new Set(routeLegs.map((leg) => leg.routeProvider))],
  routeLegCount: routeLegs.length,
  targetVenues: routeLegs.map((leg) => leg.targetVenue),
  totalEstimatedFees: routeLegs.reduce((sum, leg) => sum.plus(leg.routeQuote.estimatedFees), new Decimal(0)).toString()
});

const normalizeFundingChain = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "SOL" || normalized === "SOLANA" || normalized === "1151111081099710") {
    return "SOLANA";
  }
  if (normalized === "BSC" || normalized === "BNB_SMART_CHAIN" || normalized === "56") {
    return "BNB";
  }
  if (normalized === "ETHEREUM" || normalized === "ETH" || normalized === "1") {
    return "ETHEREUM";
  }
  if (normalized === "POLYGON" || normalized === "MATIC" || normalized === "137") {
    return "POLYGON";
  }
  if (normalized === "BASE" || normalized === "8453") {
    return "BASE";
  }
  return normalized;
};

const isEvmChain = (chainKey: string, rawChain: string): boolean =>
  ["BNB", "ETHEREUM", "POLYGON", "BASE"].includes(chainKey) || /^\d+$/.test(rawChain.trim());

const isEvmAddress = (value: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(value.trim());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fromBaseUnits = (amount: string, decimals: number): string => {
  const normalized = amount.replace(/^0+(?=\d)/, "") || "0";
  const padded = normalized.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

const tokenMatches = (
  requestedToken: string,
  preferredToken: string,
  sourceTokenAddress: string,
  preferredTokenAddress: string
): boolean => {
  const requested = requestedToken.trim();
  return requested.toUpperCase() === preferredToken.trim().toUpperCase()
    || requested.toLowerCase() === sourceTokenAddress.trim().toLowerCase()
    || requested.toLowerCase() === preferredTokenAddress.trim().toLowerCase();
};

const directTransferQuoteTtlSeconds = (env?: NodeJS.ProcessEnv): number => {
  const parsed = Number.parseInt(env?.FUNDING_DIRECT_TRANSFER_QUOTE_TTL_SECONDS ?? "300", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
};

const directTransferTokenDecimals = (input: {
  chainKey: string;
  tokenSymbol: string;
  tokenAddress: string;
  env?: NodeJS.ProcessEnv;
}): number => {
  const envKey = `${input.chainKey}_${input.tokenSymbol.toUpperCase()}_TOKEN_DECIMALS`;
  const parsed = Number.parseInt(input.env?.[envKey] ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 36) {
    return parsed;
  }
  if (input.chainKey === "BNB" && input.tokenSymbol.toUpperCase() === "USDT") {
    return 18;
  }
  if (/^0x55d398326f99059ff775485246999027b3197955$/i.test(input.tokenAddress)) {
    return 18;
  }
  if (/^(USDC|USDT|USD1)$/i.test(input.tokenSymbol)) {
    return 6;
  }
  return 18;
};

const decimalToAtomicAmount = (amount: string, decimals: number): string => {
  const parsed = new Decimal(amount);
  if (!parsed.isFinite() || parsed.lessThanOrEqualTo(0)) {
    throw new FundingError("ROUTE_QUOTE_FAILED", "Direct transfer amount is invalid.", 400);
  }
  return parsed.times(new Decimal(10).pow(decimals)).toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0);
};

const encodeErc20Transfer = (recipient: string, atomicAmount: string): string => {
  const address = recipient.trim().replace(/^0x/i, "").toLowerCase();
  const amountHex = BigInt(atomicAmount).toString(16);
  return `0xa9059cbb${address.padStart(64, "0")}${amountHex.padStart(64, "0")}`;
};

const buildWithdrawalRouteLeg = (intent: WithdrawalIntent, source: WithdrawalSource): WithdrawalRouteLeg => {
  const now = new Date().toISOString();
  const quote: WithdrawalRouteQuote = {
    provider: "LOTUS_WITHDRAWAL_V0",
    providerRouteId: `withdrawal-${source.withdrawalSourceId}`,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: source.sourceAmount,
    estimatedFees: "0",
    estimatedTimeSeconds: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    transactionRequest: null,
    userSafeSummary: `Prepare ${source.sourceAmount} ${source.sourceToken} withdrawal from ${source.sourceVenue}. Lotus does not sign or broadcast this transaction.`
  };
  return {
    withdrawalRouteLegId: randomUUID(),
    withdrawalIntentId: intent.withdrawalIntentId,
    withdrawalSourceId: source.withdrawalSourceId,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: source.sourceAmount,
    routeProvider: "LOTUS_WITHDRAWAL_V0",
    routeQuote: quote,
    txHashes: [],
    providerStatus: {},
    venueReleaseStatus: "NOT_SUBMITTED",
    destinationStatus: "NOT_CONFIRMED",
    status: "WITHDRAWAL_LEG_SIGNATURE_REQUIRED",
    errorReason: null,
    createdAt: now,
    updatedAt: now
  };
};

const buildPolymarketBridgeWithdrawalRouteLeg = (
  intent: WithdrawalIntent,
  source: WithdrawalSource,
  bridgeQuote: PolymarketBridgeWithdrawalQuote,
  userAction: PolymarketBridgeUserAction,
  supportedAssetCount: number
): WithdrawalRouteLeg => {
  const now = new Date().toISOString();
  const quote: WithdrawalRouteQuote = {
    provider: "LOTUS_WITHDRAWAL_V0",
    providerRouteId: bridgeQuote.providerQuoteId ?? `polymarket-bridge-${source.withdrawalSourceId}`,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: bridgeQuote.amount,
    estimatedFees: bridgeQuote.estimatedFees,
    estimatedTimeSeconds: bridgeQuote.estimatedTimeSeconds,
    expiresAt: bridgeQuote.expiresAt,
    transactionRequest: null,
    userSafeSummary: "Polymarket Bridge sandbox: user must send funds from their Polymarket wallet. Lotus does not sign, broadcast, custody, or move funds."
  };
  return {
    withdrawalRouteLegId: randomUUID(),
    withdrawalIntentId: intent.withdrawalIntentId,
    withdrawalSourceId: source.withdrawalSourceId,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: bridgeQuote.amount,
    routeProvider: "LOTUS_WITHDRAWAL_V0",
    routeQuote: quote,
    txHashes: [],
    providerStatus: buildPolymarketBridgeProviderStatus({
      quote: bridgeQuote,
      userAction,
      supportedAssetsChecked: supportedAssetCount,
      status: null
    }),
    venueReleaseStatus: "NOT_SUBMITTED",
    destinationStatus: "NOT_CONFIRMED",
    status: "WITHDRAWAL_LEG_SIGNATURE_REQUIRED",
    errorReason: null,
    createdAt: now,
    updatedAt: now
  };
};

const buildLimitlessBridgeBackWithdrawalRouteLeg = (
  intent: WithdrawalIntent,
  source: WithdrawalSource,
  bridgeQuote: FundingRouteQuote,
  sourceWalletAddress: string
): WithdrawalRouteLeg => {
  const now = new Date().toISOString();
  const quote: WithdrawalRouteQuote = {
    provider: "LOTUS_WITHDRAWAL_V0",
    providerRouteId: bridgeQuote.providerRouteId ?? `limitless-bridge-back-${source.withdrawalSourceId}`,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: bridgeQuote.destinationAmountEstimate,
    estimatedFees: bridgeQuote.estimatedFees,
    estimatedTimeSeconds: bridgeQuote.estimatedTimeSeconds,
    expiresAt: bridgeQuote.expiresAt,
    transactionRequest: bridgeQuote.transactionRequest,
    userSafeSummary: "Limitless bridge-back: user signs a Base USDC to Solana USDC bridge route. Lotus does not call Limitless partner withdrawals, sign, broadcast, custody, or move funds."
  };
  return {
    withdrawalRouteLegId: randomUUID(),
    withdrawalIntentId: intent.withdrawalIntentId,
    withdrawalSourceId: source.withdrawalSourceId,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: bridgeQuote.destinationAmountEstimate,
    routeProvider: "LOTUS_WITHDRAWAL_V0",
    routeQuote: quote,
    txHashes: [],
    providerStatus: {
      provider: "LIFI",
      mode: "LIMITLESS_BRIDGE_BACK",
      sourceChain: bridgeQuote.sourceChain,
      sourceToken: bridgeQuote.sourceToken,
      destinationChain: bridgeQuote.destinationChain,
      destinationToken: bridgeQuote.destinationToken,
      sourceWalletAddress,
      partnerManagedWithdrawalCalled: false,
      completionPersisted: false
    },
    venueReleaseStatus: "CONFIRMED",
    destinationStatus: "NOT_CONFIRMED",
    status: "WITHDRAWAL_LEG_SIGNATURE_REQUIRED",
    errorReason: null,
    createdAt: now,
    updatedAt: now
  };
};

const buildVenueEvmBridgeBackWithdrawalRouteLeg = (input: {
  intent: WithdrawalIntent;
  source: WithdrawalSource;
  bridgeQuote: FundingRouteQuote;
  sourceWalletAddress: string;
  sourceWalletProvider: "TURNKEY" | "EXTERNAL_EVM";
  sourceChain: string;
  sourceTokenSymbol: string;
  destinationTokenSymbol: string;
}): WithdrawalRouteLeg => {
  const now = new Date().toISOString();
  const quote: WithdrawalRouteQuote = {
    provider: "LOTUS_WITHDRAWAL_V0",
    providerRouteId: input.bridgeQuote.providerRouteId ?? `${input.source.sourceVenue.toLowerCase()}-bridge-back-${input.source.withdrawalSourceId}`,
    sourceVenue: input.source.sourceVenue,
    sourceToken: input.source.sourceToken,
    sourceAmount: input.source.sourceAmount,
    destinationChain: input.intent.destinationChain,
    destinationWalletAddress: input.intent.destinationWalletAddress,
    destinationAmountEstimate: input.bridgeQuote.destinationAmountEstimate,
    estimatedFees: input.bridgeQuote.estimatedFees,
    estimatedTimeSeconds: input.bridgeQuote.estimatedTimeSeconds,
    expiresAt: input.bridgeQuote.expiresAt,
    transactionRequest: input.bridgeQuote.transactionRequest,
    userSafeSummary: `${input.source.sourceVenue} bridge-back: after venue funds arrive in the user's EVM wallet, user signs a ${input.sourceChain} ${input.sourceTokenSymbol} to Solana ${input.destinationTokenSymbol} bridge route. Lotus does not sign, broadcast, custody, or move funds.`
  };
  return {
    withdrawalRouteLegId: randomUUID(),
    withdrawalIntentId: input.intent.withdrawalIntentId,
    withdrawalSourceId: input.source.withdrawalSourceId,
    sourceVenue: input.source.sourceVenue,
    sourceToken: input.source.sourceToken,
    sourceAmount: input.source.sourceAmount,
    destinationChain: input.intent.destinationChain,
    destinationWalletAddress: input.intent.destinationWalletAddress,
    destinationAmountEstimate: input.bridgeQuote.destinationAmountEstimate,
    routeProvider: "LOTUS_WITHDRAWAL_V0",
    routeQuote: quote,
    txHashes: [],
    providerStatus: {
      provider: "LIFI",
      mode: "VENUE_EVM_BRIDGE_BACK",
      sourceVenue: input.source.sourceVenue,
      sourceChain: input.bridgeQuote.sourceChain,
      sourceToken: input.bridgeQuote.sourceToken,
      sourceTokenSymbol: input.sourceTokenSymbol,
      destinationChain: input.bridgeQuote.destinationChain,
      destinationToken: input.bridgeQuote.destinationToken,
      destinationTokenSymbol: input.destinationTokenSymbol,
      sourceWalletAddress: input.sourceWalletAddress,
      sourceWalletProvider: input.sourceWalletProvider,
      requiresPriorVenueRelease: true,
      backendBroadcast: false,
      completionPersisted: false
    },
    venueReleaseStatus: "PENDING",
    destinationStatus: "NOT_CONFIRMED",
    status: "WITHDRAWAL_LEG_SIGNATURE_REQUIRED",
    errorReason: null,
    createdAt: now,
    updatedAt: now
  };
};

const withVenueBridgeBackMetadata = (
  leg: WithdrawalRouteLeg,
  input: { finalDestinationChain: string; finalDestinationWalletAddress: string }
): WithdrawalRouteLeg => ({
  ...leg,
  providerStatus: {
    ...leg.providerStatus,
    bridgeBackPlanned: true,
    finalDestinationChain: input.finalDestinationChain,
    finalDestinationWalletAddress: input.finalDestinationWalletAddress,
    backendBroadcast: false
  },
  routeQuote: {
    ...leg.routeQuote,
    userSafeSummary: `${leg.routeQuote.userSafeSummary} After this venue release is confirmed, Lotus has already prepared the user-signed bridge-back leg to the final Solana wallet.`
  }
});

const buildPredictFunWithdrawalRouteLeg = (
  intent: WithdrawalIntent,
  source: WithdrawalSource,
  predictQuote: PredictFunWithdrawalQuote,
  userAction: PredictFunUserWalletAction,
  evmWithdrawalWalletPresent: boolean
): WithdrawalRouteLeg => {
  const now = new Date().toISOString();
  const walletWarning = "Add an EVM-compatible wallet to receive BSC USDT withdrawals.";
  const userSafeSummary = evmWithdrawalWalletPresent
    ? "Predict.fun user-wallet dry run: user must complete withdrawal through Predict.fun, Privy, ZeroDev, or a user-controlled wallet. Lotus does not hold keys, sign, broadcast, custody, or move funds."
    : `Predict.fun user-wallet dry run: ${walletWarning} Lotus does not hold keys, sign, broadcast, custody, or move funds.`;
  const quote: WithdrawalRouteQuote = {
    provider: "LOTUS_WITHDRAWAL_V0",
    providerRouteId: `predictfun-user-wallet-${source.withdrawalSourceId}`,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: predictQuote.amount,
    estimatedFees: predictQuote.estimatedFees,
    estimatedTimeSeconds: predictQuote.estimatedTimeSeconds,
    expiresAt: predictQuote.expiresAt,
    transactionRequest: null,
    userSafeSummary
  };
  return {
    withdrawalRouteLegId: randomUUID(),
    withdrawalIntentId: intent.withdrawalIntentId,
    withdrawalSourceId: source.withdrawalSourceId,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: predictQuote.amount,
    routeProvider: "LOTUS_WITHDRAWAL_V0",
    routeQuote: quote,
    txHashes: [],
    providerStatus: buildPredictFunUserWalletProviderStatus({
      quote: predictQuote,
      userAction,
      evmWithdrawalWalletPresent
    }),
    venueReleaseStatus: "NOT_SUBMITTED",
    destinationStatus: "NOT_CONFIRMED",
    status: "WITHDRAWAL_LEG_SIGNATURE_REQUIRED",
    errorReason: null,
    createdAt: now,
    updatedAt: now
  };
};

const buildMyriadWithdrawalRouteLeg = (
  intent: WithdrawalIntent,
  source: WithdrawalSource,
  myriadQuote: MyriadWithdrawalQuote,
  userAction: MyriadUserWalletAction
): WithdrawalRouteLeg => {
  const now = new Date().toISOString();
  const quote: WithdrawalRouteQuote = {
    provider: "LOTUS_WITHDRAWAL_V0",
    providerRouteId: `myriad-user-wallet-${source.withdrawalSourceId}`,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: myriadQuote.amount,
    estimatedFees: myriadQuote.estimatedFees,
    estimatedTimeSeconds: myriadQuote.estimatedTimeSeconds,
    expiresAt: myriadQuote.expiresAt,
    transactionRequest: null,
    userSafeSummary: "Myriad user-wallet dry run: user must complete withdrawal through the Myriad/ThirdWeb wallet UI. Lotus does not hold keys, sign, broadcast, custody, or move funds."
  };
  return {
    withdrawalRouteLegId: randomUUID(),
    withdrawalIntentId: intent.withdrawalIntentId,
    withdrawalSourceId: source.withdrawalSourceId,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: myriadQuote.amount,
    routeProvider: "LOTUS_WITHDRAWAL_V0",
    routeQuote: quote,
    txHashes: [],
    providerStatus: buildMyriadUserWalletProviderStatus({
      quote: myriadQuote,
      userAction
    }),
    venueReleaseStatus: "NOT_SUBMITTED",
    destinationStatus: "NOT_CONFIRMED",
    status: "WITHDRAWAL_LEG_SIGNATURE_REQUIRED",
    errorReason: null,
    createdAt: now,
    updatedAt: now
  };
};

const buildOpinionWithdrawalRouteLeg = (
  intent: WithdrawalIntent,
  source: WithdrawalSource,
  opinionQuote: OpinionWithdrawalQuote,
  userAction: OpinionSafeUserAction
): WithdrawalRouteLeg => {
  const now = new Date().toISOString();
  const quote: WithdrawalRouteQuote = {
    provider: "LOTUS_WITHDRAWAL_V0",
    providerRouteId: `opinion-safe-user-action-${source.withdrawalSourceId}`,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: opinionQuote.amount,
    estimatedFees: opinionQuote.estimatedFees,
    estimatedTimeSeconds: opinionQuote.estimatedTimeSeconds,
    expiresAt: opinionQuote.expiresAt,
    transactionRequest: null,
    userSafeSummary: "Opinion Safe dry run: user must complete withdrawal through Opinion/Gnosis Safe/user wallet. Lotus does not hold keys, sign, broadcast, custody, or move funds."
  };
  return {
    withdrawalRouteLegId: randomUUID(),
    withdrawalIntentId: intent.withdrawalIntentId,
    withdrawalSourceId: source.withdrawalSourceId,
    sourceVenue: source.sourceVenue,
    sourceToken: source.sourceToken,
    sourceAmount: source.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationWalletAddress: intent.destinationWalletAddress,
    destinationAmountEstimate: opinionQuote.amount,
    routeProvider: "LOTUS_WITHDRAWAL_V0",
    routeQuote: quote,
    txHashes: [],
    providerStatus: buildOpinionSafeUserActionProviderStatus({
      quote: opinionQuote,
      userAction
    }),
    venueReleaseStatus: "NOT_SUBMITTED",
    destinationStatus: "NOT_CONFIRMED",
    status: "WITHDRAWAL_LEG_SIGNATURE_REQUIRED",
    errorReason: null,
    createdAt: now,
    updatedAt: now
  };
};

const buildPolymarketBridgeProviderStatus = (input: {
  quote: PolymarketBridgeWithdrawalQuote | null;
  userAction: PolymarketBridgeUserAction | null;
  supportedAssetsChecked: number | null;
  status: PolymarketBridgeRawStatus | null;
  existingProviderStatus?: Record<string, unknown>;
}): Record<string, unknown> => {
  const existing = input.existingProviderStatus ?? {};
  const bridgeAddress = input.userAction?.bridgeAddress ??
    input.status?.bridgeAddress ??
    (typeof existing.bridgeAddress === "string" ? existing.bridgeAddress : null);
  const warnings = [
    ...(Array.isArray(existing.warnings) ? existing.warnings.filter((warning): warning is string => typeof warning === "string") : []),
    ...(input.userAction?.warnings ?? []),
    "Polymarket Bridge sandbox status is not withdrawal completion evidence."
  ];
  return {
    ...existing,
    provider: "POLYMARKET_BRIDGE",
    mode: "SANDBOX_DRY_RUN",
    bridgeAddressPresent: Boolean(bridgeAddress),
    ...(bridgeAddress ? { bridgeAddress } : {}),
    status: input.status?.status ?? existing.status ?? "PENDING",
    completionPersisted: false,
    warnings: [...new Set(warnings)],
    supportedAssetsChecked: input.supportedAssetsChecked ?? existing.supportedAssetsChecked ?? null,
    ...(input.quote ? {
      quote: {
        provider: input.quote.provider,
        providerQuoteId: input.quote.providerQuoteId,
        destinationChain: input.quote.destinationChain,
        destinationToken: input.quote.destinationToken,
        destinationAddress: input.quote.destinationAddress,
        amount: input.quote.amount,
        estimatedFees: input.quote.estimatedFees,
        estimatedTimeSeconds: input.quote.estimatedTimeSeconds,
        expiresAt: input.quote.expiresAt
      }
    } : {}),
    ...(input.userAction ? {
      userAction: {
        actionType: input.userAction.actionType,
        bridgeAddress: input.userAction.bridgeAddress,
        destinationChain: input.userAction.destinationChain,
        destinationToken: input.userAction.destinationToken,
        destinationAddress: input.userAction.destinationAddress,
        amount: input.userAction.amount,
        expiresAt: input.userAction.expiresAt,
        warnings: input.userAction.warnings
      }
    } : {}),
    ...(input.status ? {
      statusSummary: {
        status: input.status.status,
        txHash: input.status.txHash,
        bridgeAddressPresent: Boolean(input.status.bridgeAddress),
        destinationChain: input.status.destinationChain,
        destinationToken: input.status.destinationToken,
        destinationAddress: input.status.destinationAddress,
        amount: input.status.amount,
        completedAt: input.status.completedAt
      }
    } : {})
  };
};

const summarizeWithdrawalQuotes = (routeLegs: readonly WithdrawalRouteLeg[]): Record<string, unknown> => ({
  provider: "LOTUS_WITHDRAWAL_V0",
  routeLegCount: routeLegs.length,
  sourceVenues: routeLegs.map((leg) => leg.sourceVenue),
  totalEstimatedFees: routeLegs.reduce((sum, leg) => sum.plus(leg.routeQuote.estimatedFees), new Decimal(0)).toString(),
  nonCustodial: true,
  backendBroadcast: false,
  ...summarizePolymarketBridgePreview(routeLegs),
  ...summarizeLimitlessBridgeBackPreview(routeLegs),
  ...summarizeVenueEvmBridgeBackPreview(routeLegs),
  ...summarizePredictFunUserWalletPreview(routeLegs),
  ...summarizeMyriadUserWalletPreview(routeLegs),
  ...summarizeOpinionSafeUserActionPreview(routeLegs)
});

const summarizePolymarketBridgePreview = (routeLegs: readonly WithdrawalRouteLeg[]): Record<string, unknown> => {
  const bridgeLeg = routeLegs.find((leg) => leg.providerStatus.provider === "POLYMARKET_BRIDGE");
  if (!bridgeLeg) {
    return {};
  }
  const status = bridgeLeg.providerStatus;
  const quote = status.quote && typeof status.quote === "object" && !Array.isArray(status.quote)
    ? status.quote as Record<string, unknown>
    : {};
  const userAction = status.userAction && typeof status.userAction === "object" && !Array.isArray(status.userAction)
    ? status.userAction as Record<string, unknown>
    : {};
  return {
    polymarketBridge: {
      provider: "POLYMARKET_BRIDGE",
      mode: "SANDBOX_DRY_RUN",
      bridgeAddressPresent: status.bridgeAddressPresent === true,
      bridgeAddress: typeof userAction.bridgeAddress === "string" ? userAction.bridgeAddress : undefined,
      destinationChain: quote.destinationChain ?? bridgeLeg.destinationChain,
      destinationToken: quote.destinationToken ?? bridgeLeg.sourceToken,
      destinationAddress: quote.destinationAddress ?? bridgeLeg.destinationWalletAddress,
      amount: quote.amount ?? bridgeLeg.destinationAmountEstimate,
      estimatedFees: quote.estimatedFees ?? bridgeLeg.routeQuote.estimatedFees,
      estimatedTimeSeconds: quote.estimatedTimeSeconds ?? bridgeLeg.routeQuote.estimatedTimeSeconds,
      expiresAt: quote.expiresAt ?? bridgeLeg.routeQuote.expiresAt,
      warnings: Array.isArray(status.warnings) ? status.warnings : [],
      completionPersisted: false
    }
  };
};

const summarizeLimitlessBridgeBackPreview = (routeLegs: readonly WithdrawalRouteLeg[]): Record<string, unknown> => {
  const limitlessLeg = routeLegs.find((leg) => leg.providerStatus.provider === "LIFI" && leg.providerStatus.mode === "LIMITLESS_BRIDGE_BACK");
  if (!limitlessLeg) {
    return {};
  }
  const status = limitlessLeg.providerStatus;
  return {
    limitlessBridgeBack: {
      provider: "LIFI",
      mode: "LIMITLESS_BRIDGE_BACK",
      sourceChain: status.sourceChain ?? "BASE",
      sourceToken: status.sourceToken ?? limitlessLeg.sourceToken,
      destinationChain: status.destinationChain ?? limitlessLeg.destinationChain,
      destinationToken: status.destinationToken ?? limitlessLeg.sourceToken,
      destinationAddress: limitlessLeg.destinationWalletAddress,
      amount: limitlessLeg.destinationAmountEstimate,
      estimatedFees: limitlessLeg.routeQuote.estimatedFees,
      estimatedTimeSeconds: limitlessLeg.routeQuote.estimatedTimeSeconds,
      expiresAt: limitlessLeg.routeQuote.expiresAt,
      partnerManagedWithdrawalCalled: false,
      completionPersisted: false
    }
  };
};

const summarizeVenueEvmBridgeBackPreview = (routeLegs: readonly WithdrawalRouteLeg[]): Record<string, unknown> => {
  const bridgeBackLegs = routeLegs.filter((leg) => leg.providerStatus.provider === "LIFI" && leg.providerStatus.mode === "VENUE_EVM_BRIDGE_BACK");
  if (bridgeBackLegs.length === 0) {
    return {};
  }
  return {
    venueEvmBridgeBack: bridgeBackLegs.map((leg) => {
      const status = leg.providerStatus;
      return {
        provider: "LIFI",
        mode: "VENUE_EVM_BRIDGE_BACK",
        sourceVenue: leg.sourceVenue,
        sourceChain: status.sourceChain ?? null,
        sourceToken: status.sourceToken ?? leg.sourceToken,
        sourceTokenSymbol: status.sourceTokenSymbol ?? leg.sourceToken,
        destinationChain: status.destinationChain ?? leg.destinationChain,
        destinationToken: status.destinationToken ?? leg.sourceToken,
        destinationTokenSymbol: status.destinationTokenSymbol ?? leg.sourceToken,
        destinationAddress: leg.destinationWalletAddress,
        amount: leg.destinationAmountEstimate,
        estimatedFees: leg.routeQuote.estimatedFees,
        estimatedTimeSeconds: leg.routeQuote.estimatedTimeSeconds,
        expiresAt: leg.routeQuote.expiresAt,
        requiresPriorVenueRelease: true,
        backendBroadcast: false,
        completionPersisted: false
      };
    })
  };
};

const summarizePredictFunUserWalletPreview = (routeLegs: readonly WithdrawalRouteLeg[]): Record<string, unknown> => {
  const predictLeg = routeLegs.find((leg) => leg.providerStatus.provider === "PREDICT_FUN_USER_WALLET");
  if (!predictLeg) {
    return {};
  }
  const status = predictLeg.providerStatus;
  const quote = status.quote && typeof status.quote === "object" && !Array.isArray(status.quote)
    ? status.quote as Record<string, unknown>
    : {};
  const userAction = status.userAction && typeof status.userAction === "object" && !Array.isArray(status.userAction)
    ? status.userAction as Record<string, unknown>
    : {};
  return {
    predictFunUserWallet: {
      provider: "PREDICT_FUN_USER_WALLET",
      mode: "USER_WALLET_DRY_RUN",
      walletModel: "PRIVY_ZERODEV",
      instructionsUrl: typeof status.instructionsUrl === "string" ? status.instructionsUrl : userAction.instructionsUrl,
      destinationWalletProfileRequired: status.destinationWalletProfileRequired === true,
      evmWithdrawalWalletPresent: status.evmWithdrawalWalletPresent === true,
      destinationChain: quote.destinationChain ?? predictLeg.destinationChain,
      destinationToken: quote.destinationToken ?? predictLeg.sourceToken,
      destinationAddress: quote.destinationAddress ?? predictLeg.destinationWalletAddress,
      amount: quote.amount ?? predictLeg.destinationAmountEstimate,
      estimatedFees: quote.estimatedFees ?? predictLeg.routeQuote.estimatedFees,
      estimatedTimeSeconds: quote.estimatedTimeSeconds ?? predictLeg.routeQuote.estimatedTimeSeconds,
      expiresAt: quote.expiresAt ?? predictLeg.routeQuote.expiresAt,
      warnings: Array.isArray(status.warnings) ? status.warnings : [],
      completionPersisted: false
    }
  };
};

const summarizeMyriadUserWalletPreview = (routeLegs: readonly WithdrawalRouteLeg[]): Record<string, unknown> => {
  const myriadLeg = routeLegs.find((leg) => leg.providerStatus.provider === "MYRIAD_USER_WALLET");
  if (!myriadLeg) {
    return {};
  }
  const status = myriadLeg.providerStatus;
  const quote = status.quote && typeof status.quote === "object" && !Array.isArray(status.quote)
    ? status.quote as Record<string, unknown>
    : {};
  const userAction = status.userAction && typeof status.userAction === "object" && !Array.isArray(status.userAction)
    ? status.userAction as Record<string, unknown>
    : {};
  return {
    myriadUserWallet: {
      provider: "MYRIAD_USER_WALLET",
      mode: "USER_WALLET_DRY_RUN",
      walletModel: "THIRDWEB",
      instructionsUrl: typeof status.instructionsUrl === "string" ? status.instructionsUrl : userAction.instructionsUrl,
      destinationChain: quote.destinationChain ?? myriadLeg.destinationChain,
      destinationToken: quote.destinationToken ?? myriadLeg.sourceToken,
      destinationAddress: quote.destinationAddress ?? myriadLeg.destinationWalletAddress,
      amount: quote.amount ?? myriadLeg.destinationAmountEstimate,
      estimatedFees: quote.estimatedFees ?? myriadLeg.routeQuote.estimatedFees,
      estimatedTimeSeconds: quote.estimatedTimeSeconds ?? myriadLeg.routeQuote.estimatedTimeSeconds,
      expiresAt: quote.expiresAt ?? myriadLeg.routeQuote.expiresAt,
      warnings: Array.isArray(status.warnings) ? status.warnings : [],
      completionPersisted: false
    }
  };
};

const summarizeOpinionSafeUserActionPreview = (routeLegs: readonly WithdrawalRouteLeg[]): Record<string, unknown> => {
  const opinionLeg = routeLegs.find((leg) => leg.providerStatus.provider === "OPINION_SAFE_USER_ACTION");
  if (!opinionLeg) {
    return {};
  }
  const status = opinionLeg.providerStatus;
  const quote = status.quote && typeof status.quote === "object" && !Array.isArray(status.quote)
    ? status.quote as Record<string, unknown>
    : {};
  const userAction = status.userAction && typeof status.userAction === "object" && !Array.isArray(status.userAction)
    ? status.userAction as Record<string, unknown>
    : {};
  return {
    opinionSafeUserAction: {
      provider: "OPINION_SAFE_USER_ACTION",
      mode: "USER_SAFE_DRY_RUN",
      walletModel: "GNOSIS_SAFE_OR_USER_EOA",
      instructionsUrl: typeof status.instructionsUrl === "string" ? status.instructionsUrl : userAction.instructionsUrl,
      destinationChain: quote.destinationChain ?? opinionLeg.destinationChain,
      destinationToken: quote.destinationToken ?? opinionLeg.sourceToken,
      destinationAddress: quote.destinationAddress ?? opinionLeg.destinationWalletAddress,
      amount: quote.amount ?? opinionLeg.destinationAmountEstimate,
      estimatedFees: quote.estimatedFees ?? opinionLeg.routeQuote.estimatedFees,
      estimatedTimeSeconds: quote.estimatedTimeSeconds ?? opinionLeg.routeQuote.estimatedTimeSeconds,
      expiresAt: quote.expiresAt ?? opinionLeg.routeQuote.expiresAt,
      warnings: Array.isArray(status.warnings) ? status.warnings : [],
      completionPersisted: false
    }
  };
};

const isWithdrawalQuoteExpired = (leg: WithdrawalRouteLeg): boolean => Date.parse(leg.routeQuote.expiresAt) <= Date.now();

const isLifiBridgeBackWithdrawalLeg = (leg: WithdrawalRouteLeg): boolean =>
  leg.providerStatus.provider === "LIFI"
    && (leg.providerStatus.mode === "LIMITLESS_BRIDGE_BACK" || leg.providerStatus.mode === "VENUE_EVM_BRIDGE_BACK");

const allowsStaleWithdrawalSubmission = (leg: WithdrawalRouteLeg): boolean =>
  leg.routeQuote.transactionRequest === null && !isLifiBridgeBackWithdrawalLeg(leg);

const expectedWithdrawalResultToken = (leg: WithdrawalRouteLeg): string => {
  const destinationTokenSymbol = leg.providerStatus.destinationTokenSymbol;
  return typeof destinationTokenSymbol === "string" ? destinationTokenSymbol : leg.sourceToken;
};

const defaultWithdrawalBridgeBackSourceChain = (venue: FundingVenue): string | null => {
  switch (venue) {
    case "POLYMARKET":
      return "POLYGON";
    case "OPINION":
    case "MYRIAD":
    case "PREDICT_FUN":
      return "BSC";
    case "LIMITLESS":
      return "BASE";
    default:
      return null;
  }
};

const defaultWithdrawalBridgeBackSourceTokenAddress = (venue: FundingVenue, tokenSymbol: string): string | null => {
  const normalized = tokenSymbol.toUpperCase();
  if (venue === "POLYMARKET" && normalized === "USDC") {
    return "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
  }
  if ((venue === "OPINION" || venue === "PREDICT_FUN") && normalized === "USDT") {
    return "0x55d398326f99059fF775485246999027B3197955";
  }
  if (venue === "MYRIAD" && normalized === "USD1") {
    return "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d";
  }
  return null;
};

const defaultWithdrawalBridgeBackDestinationTokenSymbol = (sourceTokenSymbol: string): string => {
  const normalized = sourceTokenSymbol.toUpperCase();
  return normalized === "USD1" ? "USDC" : normalized;
};

const defaultSolanaTokenAddress = (tokenSymbol: string): string | null => {
  switch (tokenSymbol.toUpperCase()) {
    case "USDC":
      return "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    case "USDT":
      return "Es9vMFrzaCERmJfrF4H2FYD4KCoNkYxWjBSGd3nccSvs";
    default:
      return null;
  }
};

const isSolanaAddress = (value: string): boolean =>
  /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(value.trim()) && !isEvmAddress(value);

const equalsIgnoreCase = (left: string | null | undefined, right: string | null | undefined): boolean =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

const stringOrNull = (value: unknown): string | null => typeof value === "string" ? value : null;

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
};

const toDecimalOrNull = (value: string | null | undefined) => {
  try {
    return typeof value === "string" ? new Decimal(value) : null;
  } catch {
    return null;
  }
};

const userSafeFundingMessage = (status: FundingIntent["status"]): string => {
  switch (status) {
    case "INTENT_CREATED":
      return "Funding intent created. Route quote is pending.";
    case "USER_SIGNATURE_REQUIRED":
    case "ROUTES_QUOTED":
      return "Funding route is ready for wallet review.";
    case "BRIDGING":
    case "ROUTES_SUBMITTED":
      return "Funding route is in progress.";
    case "PARTIALLY_READY_TO_TRADE":
      return "Some venue funds are ready to trade.";
    case "READY_TO_TRADE":
      return "Funds are ready to trade.";
    case "PARTIALLY_FAILED":
      return "Some funding legs need review or retry.";
    case "FAILED":
      return "Funding failed.";
    case "CANCELLED":
      return "Funding was cancelled.";
    default:
      return "Funding status is being updated.";
  }
};

const userSafeWithdrawalMessage = (status: WithdrawalIntent["status"]): string => {
  switch (status) {
    case "WITHDRAWAL_CREATED":
      return "Withdrawal intent created. Route preview is pending.";
    case "USER_SIGNATURE_REQUIRED":
    case "WITHDRAWAL_QUOTED":
      return "Withdrawal route is ready for wallet review.";
    case "WITHDRAWAL_SUBMITTED":
    case "WITHDRAWING":
    case "PARTIALLY_WITHDRAWING":
      return "Withdrawal is in progress.";
    case "PARTIALLY_COMPLETED":
      return "Some withdrawal legs are complete.";
    case "COMPLETED":
      return "Withdrawal is complete.";
    case "PARTIALLY_FAILED":
    case "RETRY_REQUIRED":
      return "Some withdrawal legs need review or retry.";
    case "FAILED":
      return "Withdrawal failed.";
    case "CANCELLED":
      return "Withdrawal was cancelled.";
    default:
      return "Withdrawal status is being updated.";
  }
};

const mapLifiStatusToFundingLeg = (status: Awaited<ReturnType<LifiRouteProvider["status"]>>["status"]): {
  status: FundingLegState;
  bridgeStatus: string;
  destinationStatus: string;
  venueCreditStatus: string;
  errorReason: string | null;
  auditEvent?: FundingAuditEventType;
} => {
  switch (status) {
    case "DONE_COMPLETED":
      return {
        status: "LEG_VENUE_CREDIT_PENDING",
        bridgeStatus: "DONE",
        destinationStatus: "CONFIRMED",
        venueCreditStatus: "PENDING",
        errorReason: null,
        auditEvent: "FUNDING_LEG_DESTINATION_RECEIVED"
      };
    case "DONE_PARTIAL":
    case "DONE_REFUNDED":
    case "FAILED":
      return {
        status: "LEG_RETRY_REQUIRED",
        bridgeStatus: "FAILED",
        destinationStatus: "NOT_CONFIRMED",
        venueCreditStatus: "NOT_CONFIRMED",
        errorReason: "ROUTE_PROVIDER_STATUS_UNTRUSTED",
        auditEvent: "FUNDING_LEG_FAILED"
      };
    case "PENDING":
      return {
        status: "LEG_BRIDGE_PENDING",
        bridgeStatus: "PENDING",
        destinationStatus: "NOT_CONFIRMED",
        venueCreditStatus: "NOT_CONFIRMED",
        errorReason: null
      };
    default:
      return {
        status: "LEG_RETRY_REQUIRED",
        bridgeStatus: "UNKNOWN",
        destinationStatus: "NOT_CONFIRMED",
        venueCreditStatus: "NOT_CONFIRMED",
        errorReason: "ROUTE_PROVIDER_STATUS_UNTRUSTED",
        auditEvent: "FUNDING_LEG_FAILED"
      };
  }
};
