import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import type { ExecutionRequestV0 } from "../../execution-system/types.js";
import type { LifiRouteProvider } from "../../integrations/lifi/lifi-client.js";
import { isQuoteExpired } from "../../integrations/lifi/lifi-client.js";
import {
  aggregateFundingStatus,
  FundingError,
  type CreateFundingIntentInput,
  type FundingAuditEventType,
  type FundingIntent,
  type FundingIntentView,
  type FundingLegState,
  type FundingReconciliationRecord,
  type FundingRouteLeg,
  type FundingRouteQuote,
  type FundingTarget,
  type FundingVenue,
  type VenueCapability
} from "./types.js";
import { buildVenueCapabilityMatrix, getVenueDepositAddress } from "./venue-capabilities.js";
import type {
  VenueFundingReadinessChecker,
  VenueFundingReadinessResult
} from "./venue-readiness.js";

export interface FundingRepository {
  findIntentById(id: string): Promise<FundingIntent | null>;
  findIntentByUserAndIdempotencyKey(userId: string, idempotencyKey: string): Promise<FundingIntent | null>;
  createIntent(input: FundingIntent, targets: FundingTarget[]): Promise<FundingIntent>;
  listTargets(fundingIntentId: string): Promise<FundingTarget[]>;
  listRouteLegs(fundingIntentId: string): Promise<FundingRouteLeg[]>;
  listReconciliations(fundingIntentId: string): Promise<FundingIntentView["reconciliations"]>;
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
}

export interface FundingServiceConfig {
  lifiQuotesEnabled: boolean;
  liveSubmitEnabled: boolean;
  venueReadinessChecksEnabled?: boolean;
  env?: NodeJS.ProcessEnv;
}

export class FundingService {
  public constructor(
    private readonly repository: FundingRepository,
    private readonly lifi: LifiRouteProvider,
    private readonly config: FundingServiceConfig,
    private readonly venueReadinessCheckers: ReadonlyMap<FundingVenue, VenueFundingReadinessChecker> = new Map()
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

  public async createIntent(userId: string, input: CreateFundingIntentInput): Promise<FundingIntentView> {
    const existing = await this.repository.findIntentByUserAndIdempotencyKey(userId, input.idempotencyKey);
    if (existing) {
      return this.getIntent(userId, existing.fundingIntentId);
    }
    const targets = this.buildTargets(input, randomUUID());
    const now = new Date().toISOString();
    const intent: FundingIntent = {
      fundingIntentId: targets.fundingIntentId,
      userId,
      sourceChain: input.sourceChain,
      sourceToken: input.sourceToken,
      sourceAmount: input.sourceAmount,
      sourceWalletAddress: input.sourceWalletAddress,
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
      payload: { sourceChain: input.sourceChain, sourceToken: input.sourceToken, targetCount: input.targets.length }
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
    if (!this.config.lifiQuotesEnabled) {
      throw new FundingError("LIFI_QUOTES_DISABLED", "LI.FI funding quotes are disabled.", 503);
    }
    const view = await this.getIntent(userId, fundingIntentId);
    const matrix = buildVenueCapabilityMatrix({ env: this.config.env });
    const routeLegs: FundingRouteLeg[] = [];
    for (const target of view.targets) {
      const capability = matrix[target.targetVenue];
      this.assertCapabilityReady(capability, view.intent);
      const depositAddress = getVenueDepositAddress(target.targetVenue, this.config.env);
      if (!depositAddress) {
        throw new FundingError("TARGET_DESTINATION_NOT_CONFIGURED", `${target.targetVenue} funding destination is not configured.`, 409);
      }
      const sourceTokenAddress = capability.sourceTokenAddressByChain[view.intent.sourceChain];
      if (!sourceTokenAddress) {
        throw new FundingError("SOURCE_CHAIN_UNSUPPORTED", "Source chain is not supported for this venue.", 409);
      }
      const quote = await this.lifi.quote({
        fromChain: view.intent.sourceChain,
        toChain: String(capability.preferredChainId),
        fromToken: sourceTokenAddress,
        toToken: capability.preferredTokenAddress,
        fromAmount: target.targetAmount,
        fromAddress: view.intent.sourceWalletAddress,
        toAddress: depositAddress,
        targetVenue: target.targetVenue
      });
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
      payload: { routeLegCount: routeLegs.length, provider: "LIFI" }
    });
    await this.repository.appendAuditEvent({
      fundingIntentId,
      eventType: "FUNDING_USER_SIGNATURE_REQUIRED",
      payload: { routeLegCount: routeLegs.length }
    });
    return this.getIntent(userId, fundingIntentId);
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
    await this.repository.updateRouteLegSubmission({ routeLegId: leg.routeLegId, txHash: input.txHash, status: "LEG_BRIDGE_PENDING" });
    const nextLegStates = view.routeLegs.map((candidate) =>
      candidate.routeLegId === leg.routeLegId ? "LEG_BRIDGE_PENDING" : candidate.status
    );
    await this.repository.updateIntentStatus(fundingIntentId, aggregateFundingStatus(nextLegStates));
    await this.repository.appendAuditEvent({
      fundingIntentId,
      routeLegId: leg.routeLegId,
      eventType: "FUNDING_LEG_SUBMITTED",
      payload: { txHash: input.txHash, provider: "LIFI" }
    });
    await this.repository.appendAuditEvent({
      fundingIntentId,
      routeLegId: leg.routeLegId,
      eventType: "FUNDING_LEG_BRIDGE_PENDING",
      payload: { txHash: input.txHash }
    });
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
    routeProvider: "LIFI",
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
  provider: "LIFI",
  routeLegCount: routeLegs.length,
  targetVenues: routeLegs.map((leg) => leg.targetVenue),
  totalEstimatedFees: routeLegs.reduce((sum, leg) => sum.plus(leg.routeQuote.estimatedFees), new Decimal(0)).toString()
});

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
