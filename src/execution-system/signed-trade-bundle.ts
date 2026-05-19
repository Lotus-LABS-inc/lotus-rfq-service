import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import {
  Chain as PolymarketChain,
  ClobClient as PolymarketClobClient,
  Side as PolymarketSide,
  SignatureTypeV2 as PolymarketSignatureType,
  type TickSize as PolymarketTickSize
} from "@polymarket/clob-client-v2";
import {
  getContractAddress as getLimitlessContractAddress,
  OrderBuilder as LimitlessOrderBuilder,
  OrderType as LimitlessOrderType,
  Side as LimitlessSide,
  type UnsignedOrder as LimitlessUnsignedOrder
} from "@limitless-exchange/sdk";
import { AddressesByChainId, ChainId, OrderBuilder, Side as PredictSide, SignatureType } from "@predictdotfun/sdk";
import { verifyTypedData } from "@ethersproject/wallet";
import { verifyTypedData as verifyTypedDataV6 } from "ethers";
import type { UserVenueAccount } from "../core/execution/user-venue-accounts.js";
import type { ExecutableRouteLeg, ExecutableRouteService, ExecutableTradeQuote } from "./executable-routing.js";
import type { ExecutionLegV0 } from "./types.js";
import type { ExecutionVenueAdapterRegistry, PreparedVenueOrder, VenueFillState, VenueSettlementState, VenueSubmitResult } from "./venue-adapter.js";

export type TradeSignatureKind = "EIP712" | "MESSAGE";

export interface TradeSignatureRequest {
  legIndex: number;
  venue: string;
  requestType?: string | undefined;
  signer: string;
  account: string;
  kind: TradeSignatureKind;
  expiresAt: string;
  message?: string | undefined;
  typedData?: Record<string, unknown> | undefined;
  signedPayloadHint: Record<string, unknown>;
}

export interface PreparedTradeSignatureBundle {
  quoteId: string;
  expiresAt: string;
  signatureRequests: TradeSignatureRequest[];
}

export interface SignedTradeLegPayload {
  legIndex: number;
  venue: string;
  requestType?: string | undefined;
  signedPayload: Record<string, unknown>;
}

export interface SignedTradeBundleSubmitResult {
  executionId: string;
  status: "DRY_RUN_VERIFIED" | "SUBMITTED" | "PARTIAL" | "FAILED";
  dryRun: boolean;
  submittedLegs: Array<{
    legIndex: number;
    venue: string;
    status: string;
    venueOrderId?: string | undefined;
    reasonCode?: string | undefined;
    reason?: string | undefined;
    fillState?: VenueFillState | undefined;
  }>;
}

export interface SignedTradeExecutionStatus {
  executionId: string;
  userId: string;
  status: "DRY_RUN_VERIFIED" | "SUBMITTED" | "PARTIAL" | "FILLED" | "FAILED";
  dryRun: boolean;
  submittedAt: string;
  updatedAt: string;
  route?: ExecutableTradeQuote | undefined;
  watcherMetadata?: SignedTradeWatcherMetadata | undefined;
  submittedLegs: Array<{
    legIndex: number;
    venue: string;
    status: string;
    venueOrderId?: string | undefined;
    reasonCode?: string | undefined;
    reason?: string | undefined;
    fillState?: VenueFillState | undefined;
    settlementState?: VenueSettlementState | undefined;
    lastStatusCheckedAt?: string | undefined;
    lastSettlementCheckedAt?: string | undefined;
    lastWatcherError?: string | undefined;
  }>;
}

export interface SignedTradeWatcherMetadata {
  lastStatusCheckedAt?: string | undefined;
  lastSettlementCheckedAt?: string | undefined;
  lastWatcherError?: string | undefined;
  nextCheckAfter?: string | undefined;
}

export interface SignedTradeExecutionStatusRepository {
  saveExecutionStatus(status: SignedTradeExecutionStatus): Promise<void>;
  findExecutionStatus(input: { userId: string; executionId: string }): Promise<SignedTradeExecutionStatus | null>;
}

export interface SignedTradePositionRecorder {
  recordFilledLeg(input: {
    executionId: string;
    userId: string;
    legIndex: number;
    venueOrderId: string;
    route: ExecutableTradeQuote;
    routeLeg: ExecutableRouteLeg;
    fillState: VenueFillState;
  }): Promise<void>;
  reconcileFailedSell?(input: {
    executionId: string;
    userId: string;
    legIndex: number;
    venue: string;
    reason: string;
    route: ExecutableTradeQuote;
    routeLeg: ExecutableRouteLeg;
  }): Promise<void>;
}

export interface LiveSubmitVenueReadiness {
  venue: string;
  status: "fresh" | "stale" | "blocked";
  checkedAt: string;
  blockers: string[];
  account: {
    walletAddress: string | null;
    venueAccountAddress: string | null;
    ownerAddress: string | null;
  };
  collateral: {
    requiredNotional: string | null;
    balance: string | null;
    allowance: string | null;
    tokenSymbol: string | null;
    tokenAddress: string | null;
    spenderAddress: string | null;
    chainId: number | null;
    approvalMethod?: "CLOB_PUSD_APPROVAL" | "ERC20_APPROVE" | "ERC1155_SET_APPROVAL_FOR_ALL" | undefined;
    usableBalance?: string | null | undefined;
    usableBalanceSource?: string | null | undefined;
    approvalSpenderSource?: string | null | undefined;
  };
}

export interface LiveSubmitReadinessSnapshot {
  quoteId: string;
  generatedAt: string;
  expiresAt: string;
  status: "fresh" | "stale" | "blocked";
  blockers: string[];
  venues: LiveSubmitVenueReadiness[];
}

export interface SignedTradeBundleVenueAccountProvider {
  getAccount(userId: string, venue: string): Promise<UserVenueAccount | null>;
  getPredictFunJwt?(userId: string): string | null;
}

export interface SignedTradeBundlePolymarketBalanceReader {
  readUsableBalance(input: { userId: string }): Promise<{
    usableBalance: string;
    collateralBalance: string;
    collateralAllowance: string;
    usableBalanceSource: string;
    approvalSpenderSource: string;
  }>;
  readConditionalTokenApproval(input: { userId: string; tokenId: string }): Promise<{
    tokenId: string;
    tokenBalance: string;
    tokenAllowance: string;
  }>;
}

export class SignedTradeBundleError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 409
  ) {
    super(message);
    this.name = "SignedTradeBundleError";
  }
}

export class SignedTradeBundleService {
  private readonly executionStatuses = new Map<string, SignedTradeExecutionStatus>();

  public constructor(
    private readonly routes: ExecutableRouteService,
    private readonly adapters: ExecutionVenueAdapterRegistry,
    private readonly venueAccounts: SignedTradeBundleVenueAccountProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly statusRepository?: SignedTradeExecutionStatusRepository | undefined,
    private readonly positionRecorder?: SignedTradePositionRecorder | undefined,
    private readonly polymarketBalanceReader?: SignedTradeBundlePolymarketBalanceReader | undefined
  ) {}

  public async prepare(input: { userId: string; quoteId: string }): Promise<PreparedTradeSignatureBundle> {
    const quote = await this.requireFreshQuote(input.userId, input.quoteId);
    const requestGroups = await Promise.all(quote.legs.map(async (leg, index) => {
      if (!leg.requiresUserSignature) {
        return [];
      }
      const executionLeg = this.toExecutionLeg(quote, leg, index);
      const prepared = await this.adapters.get(leg.venue).prepareOrder(executionLeg);
      const binding = await this.expectedBinding(quote.userId, leg.venue);
      return this.toSignatureRequest(index, prepared, binding);
    }));
    return {
      quoteId: quote.quoteId,
      expiresAt: quote.expiresAt,
      signatureRequests: requestGroups.flat()
    };
  }

  public async submit(input: {
    userId: string;
    quoteId: string;
    signedLegs: readonly SignedTradeLegPayload[];
    dryRun?: boolean | undefined;
  }): Promise<SignedTradeBundleSubmitResult> {
    const quote = await this.requireFreshQuote(input.userId, input.quoteId);
    let liveReadiness: LiveSubmitReadinessSnapshot | null = null;
    if (input.dryRun !== true) {
      liveReadiness = await this.getLiveReadiness({ userId: input.userId, quoteId: input.quoteId });
      if (liveReadiness.status !== "fresh") {
        throw new SignedTradeBundleError(
          "LIVE_SUBMIT_READINESS_BLOCKED",
          liveReadiness.blockers[0] ?? "Live submit readiness is blocked or stale."
        );
      }
    }
    const signedByLeg = new Map<string, SignedTradeLegPayload[]>();
    for (const leg of input.signedLegs) {
      const key = `${leg.legIndex}:${leg.venue.toUpperCase()}`;
      signedByLeg.set(key, [...signedByLeg.get(key) ?? [], leg]);
    }
    const submittedLegs: SignedTradeBundleSubmitResult["submittedLegs"] = [];

    for (const [index, leg] of quote.legs.entries()) {
      const executionLeg = this.toExecutionLeg(quote, leg, index);
      const adapter = this.adapters.get(leg.venue);
      const prepared = await adapter.prepareOrder(executionLeg);
      let order = prepared;
      if (leg.requiresUserSignature) {
        const signedPayloads = signedByLeg.get(`${index}:${leg.venue.toUpperCase()}`) ?? [];
        const signed = this.selectSignedPayload(prepared, signedPayloads);
        if (!signed) {
          throw new SignedTradeBundleError(
            "SIGNED_TRADE_LEG_MISSING",
            `${leg.venue} leg ${index + 1} requires a user signature.`
          );
        }
        const binding = await this.expectedBinding(quote.userId, leg.venue);
        const signedPayload = prepared.venue.toUpperCase() === "POLYMARKET"
          ? {
              ...signed.signedPayload,
              relatedSignedPayloads: signedPayloads
                .map((payload) => payload.signedPayload)
                .filter((payload) => payload !== signed.signedPayload)
            }
          : signed.signedPayload;
        this.verifySignedPayload(prepared, binding, signedPayload);
        order = this.attachSignedPayload(prepared, binding, signedPayload);
      }
      order = this.attachLiveReadinessAttestation(order, quote, leg, index, liveReadiness?.venues[index] ?? null);
      if (input.dryRun === true) {
        submittedLegs.push({ legIndex: index, venue: leg.venue, status: "DRY_RUN_VERIFIED" });
        continue;
      }
      try {
        const submitted = await adapter.submitOrder(order);
        submittedLegs.push(this.toSubmittedLeg(index, leg.venue, submitted, leg));
      } catch (error) {
        const normalized = adapter.normalizeVenueError(error);
        submittedLegs.push({
          legIndex: index,
          venue: leg.venue,
          status: "FAILED",
          reasonCode: normalized.code,
          reason: normalized.message
        });
        const result: SignedTradeBundleSubmitResult = {
          executionId: quote.quoteId,
          status: "FAILED",
          dryRun: false,
          submittedLegs
        };
        await this.recordExecutionStatus(input.userId, result, quote);
        return result;
      }
    }

    const result: SignedTradeBundleSubmitResult = {
      executionId: quote.quoteId,
      status: input.dryRun === true ? "DRY_RUN_VERIFIED" : "SUBMITTED",
      dryRun: input.dryRun === true,
      submittedLegs
    };
    await this.recordExecutionStatus(input.userId, result, quote);
    return result;
  }

  public async getExecutionStatus(input: { userId: string; executionId: string }): Promise<SignedTradeExecutionStatus | null> {
    const stored = this.executionStatuses.get(statusKey(input.userId, input.executionId)) ??
      await this.statusRepository?.findExecutionStatus(input) ??
      null;
    if (!stored) {
      return null;
    }
    if (stored.dryRun) {
      return stored;
    }
    const next = await this.refreshStoredExecutionStatus(stored);
    await this.saveExecutionStatus(next);
    await this.recordFilledPositions(next);
    return next;
  }

  public async refreshStoredExecutionStatus(
    stored: SignedTradeExecutionStatus,
    options: { settlementIntervalMs?: number | undefined } = {}
  ): Promise<SignedTradeExecutionStatus> {
    if (stored.dryRun) {
      return stored;
    }
    const checkedAt = this.now().toISOString();
    const submittedLegs = await Promise.all(stored.submittedLegs.map(async (leg) => {
      if (!leg.venueOrderId || leg.status === "FAILED") {
        return leg;
      }
      const routeLeg = stored.route?.legs[leg.legIndex];
      if (leg.status === "FILLED" && !leg.fillState && routeLeg) {
        return {
          ...leg,
          fillState: inferredFilledLegState(routeLeg),
          lastStatusCheckedAt: checkedAt,
          lastWatcherError: undefined
        };
      }
      try {
        const adapter = this.adapters.get(leg.venue);
        const fillState = await adapter.fetchFillState(leg.venueOrderId);
        const effectiveFillState = leg.status === "FILLED" && fillState.status === "OPEN" && routeLeg
          ? inferredFilledLegState(routeLeg)
          : fillState;
        const settlementIntervalMs = options.settlementIntervalMs ?? 0;
        const lastSettlementCheckedAt = leg.lastSettlementCheckedAt ? Date.parse(leg.lastSettlementCheckedAt) : 0;
        const settlementCheckDue = !lastSettlementCheckedAt ||
          this.now().getTime() - lastSettlementCheckedAt >= settlementIntervalMs;
        const shouldRefreshSettlement = settlementCheckDue &&
          (effectiveFillState.status === "FILLED" || leg.settlementState?.status === "SETTLEMENT_PENDING");
        const settlementState = shouldRefreshSettlement
          ? await adapter.fetchSettlementState(leg.venueOrderId)
          : leg.settlementState;
        return {
          ...leg,
          fillState: effectiveFillState,
          ...(settlementState ? { settlementState } : {}),
          status: effectiveFillState.status,
          lastStatusCheckedAt: checkedAt,
          ...(shouldRefreshSettlement ? { lastSettlementCheckedAt: checkedAt } : {}),
          lastWatcherError: undefined
        };
      } catch (error) {
        return {
          ...leg,
          lastStatusCheckedAt: checkedAt,
          lastWatcherError: error instanceof Error ? error.message : "Venue status lookup failed."
        };
      }
    }));
    return {
      ...stored,
      updatedAt: checkedAt,
      status: summarizeStoredExecutionStatus(submittedLegs),
      watcherMetadata: {
        ...stored.watcherMetadata,
        lastStatusCheckedAt: checkedAt,
        nextCheckAfter: new Date(this.now().getTime() + 1_000).toISOString(),
        lastWatcherError: submittedLegs.find((leg) => leg.lastWatcherError)?.lastWatcherError
      },
      submittedLegs
    };
  }

  public async recordFilledPositionsForStatus(status: SignedTradeExecutionStatus): Promise<void> {
    await this.recordFilledPositions(status);
  }

  public async getLiveReadiness(input: { userId: string; quoteId: string }): Promise<LiveSubmitReadinessSnapshot> {
    const quote = await this.requireFreshQuote(input.userId, input.quoteId);
    const generatedAt = this.now().toISOString();
    const venues = await Promise.all(quote.legs.map((leg, index) => this.liveReadinessForLeg(quote, leg, index, generatedAt)));
    const blockers = venues.flatMap((venue) => venue.blockers.map((blocker) => `${venue.venue}: ${blocker}`));
    const hasBlocked = venues.some((venue) => venue.status === "blocked");
    const hasStale = venues.some((venue) => venue.status === "stale");
    return {
      quoteId: quote.quoteId,
      generatedAt,
      expiresAt: quote.expiresAt,
      status: hasBlocked ? "blocked" : hasStale ? "stale" : "fresh",
      blockers,
      venues
    };
  }

  private async requireFreshQuote(userId: string, quoteId: string): Promise<ExecutableTradeQuote> {
    const quote = await this.routes.getQuote(userId, quoteId);
    if (!quote) {
      throw new SignedTradeBundleError(
        "EXECUTION_QUOTE_NOT_FOUND",
        "Execution quote was not found or has expired.",
        404
      );
    }
    if (Date.parse(quote.expiresAt) <= this.now().getTime()) {
      throw new SignedTradeBundleError(
        "EXECUTION_QUOTE_EXPIRED",
        "Execution quote has expired. Refresh the route before signing."
      );
    }
    return quote;
  }

  private toExecutionLeg(quote: ExecutableTradeQuote, leg: ExecutableRouteLeg, index: number): ExecutionLegV0 {
    return {
      executionLegId: `${quote.quoteId}-leg-${index + 1}-${randomUUID()}`,
      parentExecutionId: quote.quoteId,
      venue: leg.venue,
      venueMarketId: leg.venueMarketId ?? quote.marketId,
      venueOutcomeId: leg.venueOutcomeId ?? quote.outcomeId,
      side: quote.side,
      size: leg.size,
      price: leg.price,
      status: "CREATED",
      settlementStatus: "SETTLEMENT_PENDING",
      ...(leg.metadata ? { metadata: { ...leg.metadata } } : {})
    };
  }

  private async liveReadinessForLeg(
    quote: ExecutableTradeQuote,
    leg: ExecutableRouteLeg,
    index: number,
    checkedAt: string
  ): Promise<LiveSubmitVenueReadiness> {
    const binding = await this.expectedBinding(quote.userId, leg.venue, false);
    const requiredNotional = requiredUsdNotional(quote.side, leg);
    const base: LiveSubmitVenueReadiness = {
      venue: leg.venue,
      status: "fresh",
      checkedAt,
      blockers: [],
      account: {
        walletAddress: binding.signerAddress,
        venueAccountAddress: binding.venueAccountAddress,
        ownerAddress: binding.venueAccountAddress
      },
      collateral: {
        requiredNotional,
        balance: null,
        allowance: null,
        tokenSymbol: null,
        tokenAddress: null,
        spenderAddress: null,
        chainId: null
      }
    };
    if (leg.venue.toUpperCase() === "LIMITLESS" && !isPositiveIntegerString(binding.profileId ?? binding.venueAccountId)) {
      return {
        ...base,
        status: "blocked",
        blockers: ["Limitless profile link is required before live submit. Open Portfolio and complete Limitless account activation."]
      };
    }
    if (leg.venue.toUpperCase() === "LIMITLESS" && quote.side === "buy") {
      return this.limitlessCollateralReadiness(base, binding.venueAccountAddress, requiredNotional, leg);
    }
    if (leg.venue.toUpperCase() === "LIMITLESS" && quote.side === "sell") {
      return this.limitlessConditionalTokenReadiness(base, binding.venueAccountAddress, leg);
    }
    if (leg.venue.toUpperCase() === "POLYMARKET" && quote.side === "buy") {
      return this.polymarketCollateralReadiness(base, quote.userId, requiredNotional);
    }
    if (leg.venue.toUpperCase() === "POLYMARKET" && quote.side === "sell") {
      return this.polymarketConditionalTokenReadiness(base, quote.userId, leg);
    }
    if (leg.venue.toUpperCase() === "PREDICT_FUN" && quote.side === "sell") {
      const executionLeg = this.toExecutionLeg(quote, leg, index);
      const prepared = await this.adapters.get(leg.venue).prepareOrder(executionLeg);
      return this.predictFunConditionalTokenReadiness(base, binding.venueAccountAddress, leg, recordField(prepared.payload, "predictOrderMetadata") ?? {});
    }
    if (leg.venue.toUpperCase() !== "PREDICT_FUN" || quote.side !== "buy") {
      return base;
    }
    const executionLeg = this.toExecutionLeg(quote, leg, index);
    const prepared = await this.adapters.get(leg.venue).prepareOrder(executionLeg);
    const readiness = await this.predictFunCollateralReadiness(base, binding.venueAccountAddress, requiredNotional, recordField(prepared.payload, "predictOrderMetadata") ?? {});
    if (readiness.status === "fresh" && !this.venueAccounts.getPredictFunJwt?.(quote.userId)) {
      return {
        ...readiness,
        status: "blocked",
        blockers: ["Predict.fun requires a fresh user auth JWT for live order submit. Refresh the Predict.fun venue setup signature, then retry the live submit."]
      };
    }
    return readiness;
  }

  private async polymarketCollateralReadiness(
    base: LiveSubmitVenueReadiness,
    userId: string,
    requiredNotional: string | null
  ): Promise<LiveSubmitVenueReadiness> {
    const next: LiveSubmitVenueReadiness = {
      ...base,
      collateral: {
        ...base.collateral,
        tokenSymbol: "pUSD",
        chainId: parsePositiveInteger(this.env.POLYMARKET_CHAIN_ID) ?? 137,
        approvalMethod: "CLOB_PUSD_APPROVAL"
      }
    };
    const configBlockers = [
      !this.polymarketBalanceReader ? "Polymarket CLOB balance reader is not configured." : null,
      !requiredNotional ? "Polymarket live preflight could not derive required collateral." : null
    ].filter((blocker): blocker is string => Boolean(blocker));
    if (configBlockers.length > 0 || !this.polymarketBalanceReader || !requiredNotional) {
      return { ...next, status: "blocked", blockers: configBlockers };
    }
    try {
      const balance = await this.polymarketBalanceReader.readUsableBalance({ userId });
      const clobConfirmed = isPolymarketTradeReadySource(balance.usableBalanceSource);
      const collateralBlockers = [
        !clobConfirmed && balance.usableBalanceSource === "ONCHAIN_CLOB_SPENDER_ALLOWANCE"
          ? "Polymarket pUSD approval is confirmed on-chain, but Polymarket CLOB spendable collateral has not synced yet. Lotus refreshed CLOB readiness; retry after sync confirms."
          : null,
        compareDecimalStrings(balance.collateralBalance, requiredNotional) < 0
          ? "Polymarket CLOB collateral balance is below the order amount. Activate or fund Polymarket before trading."
          : null,
        compareDecimalStrings(balance.collateralAllowance, requiredNotional) < 0
          ? "Polymarket CLOB collateral allowance is below the order amount. Activate Polymarket funds to approve trading spenders."
          : null,
        compareDecimalStrings(balance.usableBalance, requiredNotional) < 0
          ? `Polymarket CLOB collateral is not ready for this order. Spendable balance: ${balance.usableBalance} pUSD. Required: ${requiredNotional} pUSD.`
          : null
      ].filter((blocker): blocker is string => Boolean(blocker));
      return {
        ...next,
        status: collateralBlockers.length > 0 ? "blocked" : "fresh",
        blockers: collateralBlockers,
        collateral: {
          ...next.collateral,
          requiredNotional,
          balance: balance.collateralBalance,
          allowance: balance.collateralAllowance,
          usableBalance: balance.usableBalance,
          usableBalanceSource: balance.usableBalanceSource,
          approvalSpenderSource: balance.approvalSpenderSource
        }
      };
    } catch {
      return {
        ...next,
        status: "stale",
        blockers: ["Polymarket CLOB collateral balance/allowance read is unavailable."]
      };
    }
  }

  private async polymarketConditionalTokenReadiness(
    base: LiveSubmitVenueReadiness,
    userId: string,
    leg: ExecutableRouteLeg
  ): Promise<LiveSubmitVenueReadiness> {
    const next: LiveSubmitVenueReadiness = {
      ...base,
      collateral: {
        ...base.collateral,
        requiredNotional: leg.size,
        tokenSymbol: "Polymarket shares",
        chainId: parsePositiveInteger(this.env.POLYMARKET_CHAIN_ID) ?? 137,
        approvalMethod: "ERC1155_SET_APPROVAL_FOR_ALL"
      }
    };
    const configBlockers = [
      !this.polymarketBalanceReader ? "Polymarket CLOB balance reader is not configured." : null,
      !leg.venueOutcomeId ? "Polymarket sell preflight could not derive the conditional token id." : null
    ].filter((blocker): blocker is string => Boolean(blocker));
    if (configBlockers.length > 0 || !this.polymarketBalanceReader || !leg.venueOutcomeId) {
      return { ...next, status: "blocked", blockers: configBlockers };
    }
    try {
      const approval = await this.polymarketBalanceReader.readConditionalTokenApproval({
        userId,
        tokenId: leg.venueOutcomeId
      });
      const blockers = [
        compareDecimalStrings(approval.tokenBalance, leg.size) < 0
          ? `Polymarket share balance is below the sell amount. Sellable balance: ${approval.tokenBalance} shares.`
          : null,
        compareDecimalStrings(approval.tokenAllowance, leg.size) < 0
          ? "Polymarket conditional-token allowance is not ready. Activate Polymarket shares before selling."
          : null
      ].filter((blocker): blocker is string => Boolean(blocker));
      return {
        ...next,
        status: blockers.length > 0 ? "blocked" : "fresh",
        blockers,
        collateral: {
          ...next.collateral,
          balance: approval.tokenBalance,
          allowance: approval.tokenAllowance
        }
      };
    } catch {
      return {
        ...next,
        status: "stale",
        blockers: ["Polymarket conditional-token balance/allowance read is unavailable."]
      };
    }
  }

  private async predictFunCollateralReadiness(
    base: LiveSubmitVenueReadiness,
    ownerAddress: string,
    requiredNotional: string | null,
    predictMetadata: Record<string, unknown>
  ): Promise<LiveSubmitVenueReadiness> {
    const chainId = parsePositiveInteger(this.env.PREDICT_FUN_BALANCE_ACTIVATION_CHAIN_ID) ??
      Number(numericStringField(predictMetadata, "chainId") ?? 56);
    const contractAddresses = predictAddressesForChain(chainId);
    const tokenAddress = this.env.PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_ADDRESS?.trim() ||
      this.env.PREDICT_FUN_OPS_FUNDING_BALANCE_TOKEN_ADDRESS?.trim() ||
      contractAddresses?.USDT ||
      "0x55d398326f99059fF775485246999027B3197955";
    const spenderAddress = this.env.PREDICT_FUN_BALANCE_ACTIVATION_SPENDER_ADDRESS?.trim() ||
      predictExchangeSpender(contractAddresses, predictMetadata) ||
      "";
    const rpcUrl = this.env.PREDICT_FUN_BALANCE_PREFLIGHT_RPC_URL?.trim() ||
      this.env.PREDICT_FUN_OPS_FUNDING_BALANCE_RPC_URL?.trim() ||
      (chainId === 97 ? "https://bsc-testnet-dataseed.bnbchain.org/" : "https://bsc-dataseed.bnbchain.org/");
    const decimals = parsePositiveInteger(this.env.PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_DECIMALS) ?? 18;
    const next: LiveSubmitVenueReadiness = {
      ...base,
      account: { ...base.account, ownerAddress },
      collateral: {
        ...base.collateral,
        tokenSymbol: this.env.PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_SYMBOL?.trim() || "USDT",
        tokenAddress: isEvmAddress(tokenAddress) ? tokenAddress : null,
        spenderAddress: isEvmAddress(spenderAddress) ? spenderAddress : null,
        chainId,
        approvalMethod: "ERC20_APPROVE"
      }
    };
    const configBlockers = [
      !isEvmAddress(ownerAddress) ? "Predict.fun live preflight owner account is missing or invalid." : null,
      !isEvmAddress(tokenAddress) ? "PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_ADDRESS is missing or invalid." : null,
      !isEvmAddress(spenderAddress) ? "Predict.fun exchange spender address could not be derived from SDK metadata." : null,
      !rpcUrl ? "Predict.fun live preflight RPC URL is required before live submit." : null,
      !requiredNotional ? "Predict.fun live preflight could not derive required notional." : null
    ].filter((blocker): blocker is string => Boolean(blocker));
    if (configBlockers.length > 0 || !requiredNotional || !isEvmAddress(tokenAddress) || !isEvmAddress(spenderAddress) || !rpcUrl) {
      return { ...next, status: "blocked", blockers: configBlockers };
    }
    try {
      const [balanceAtomic, allowanceAtomic] = await Promise.all([
        readErc20Value(rpcUrl, tokenAddress, encodeErc20BalanceOf(ownerAddress)),
        readErc20Value(rpcUrl, tokenAddress, encodeErc20Allowance(ownerAddress, spenderAddress))
      ]);
      const balance = formatBaseUnits(balanceAtomic, decimals);
      const allowance = formatBaseUnits(allowanceAtomic, decimals);
      const blockers = [
        compareDecimalStrings(balance, requiredNotional) < 0
          ? "Predict.fun collateral balance is below the total bid amount."
          : null,
        compareDecimalStrings(allowance, requiredNotional) < 0
          ? "Predict.fun collateral USDT allowance is less than the total bid amount."
          : null
      ].filter((blocker): blocker is string => Boolean(blocker));
      return {
        ...next,
        status: blockers.length > 0 ? "blocked" : "fresh",
        blockers,
        collateral: { ...next.collateral, balance, allowance }
      };
    } catch {
      return {
        ...next,
        status: "stale",
        blockers: ["Predict.fun collateral balance/allowance read is unavailable."]
      };
    }
  }

  private async limitlessCollateralReadiness(
    base: LiveSubmitVenueReadiness,
    ownerAddress: string,
    requiredNotional: string | null,
    leg: ExecutableRouteLeg
  ): Promise<LiveSubmitVenueReadiness> {
    const metadata = leg.metadata ?? {};
    const chainId = parsePositiveInteger(this.env.LIMITLESS_BALANCE_PREFLIGHT_CHAIN_ID) ??
      parsePositiveInteger(this.env.LIMITLESS_BALANCE_ACTIVATION_CHAIN_ID) ??
      parsePositiveInteger(this.env.LIMITLESS_FUNDING_PREFERRED_CHAIN_ID) ??
      8453;
    const tokenAddress = this.env.LIMITLESS_BALANCE_ACTIVATION_TOKEN_ADDRESS?.trim() ||
      this.env.LIMITLESS_USDC_TOKEN_ADDRESS?.trim() ||
      this.env.BASE_USDC_TOKEN_ADDRESS?.trim() ||
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const spenderAddress = this.env.LIMITLESS_BALANCE_ACTIVATION_SPENDER_ADDRESS?.trim() ||
      stringFromRecord(metadata, "limitlessExchangeAddress") ||
      stringFromRecord(metadata, "exchange") ||
      stringFromRecord(metadata, "venueExchange") ||
      "";
    const rpcUrl = this.env.LIMITLESS_BALANCE_PREFLIGHT_RPC_URL?.trim() ||
      this.env.BASE_RPC_URL?.trim() ||
      this.env.LIMITLESS_BASE_RPC_URL?.trim() ||
      "https://mainnet.base.org";
    const decimals = parsePositiveInteger(this.env.LIMITLESS_BALANCE_ACTIVATION_TOKEN_DECIMALS) ?? 6;
    const next: LiveSubmitVenueReadiness = {
      ...base,
      account: { ...base.account, ownerAddress },
      collateral: {
        ...base.collateral,
        tokenSymbol: this.env.LIMITLESS_BALANCE_ACTIVATION_TOKEN_SYMBOL?.trim() || "USDC",
        tokenAddress: isEvmAddress(tokenAddress) ? tokenAddress : null,
        spenderAddress: isEvmAddress(spenderAddress) ? spenderAddress : null,
        chainId,
        approvalMethod: "ERC20_APPROVE"
      }
    };
    const configBlockers = [
      !isEvmAddress(ownerAddress) ? "Limitless live preflight owner account is missing or invalid." : null,
      !isEvmAddress(tokenAddress) ? "LIMITLESS_BALANCE_ACTIVATION_TOKEN_ADDRESS is missing or invalid." : null,
      !isEvmAddress(spenderAddress) ? "Limitless market exchange spender address could not be derived from the live route." : null,
      !rpcUrl ? "Limitless live preflight RPC URL is required before live submit." : null,
      !requiredNotional ? "Limitless live preflight could not derive required notional." : null
    ].filter((blocker): blocker is string => Boolean(blocker));
    if (configBlockers.length > 0 || !requiredNotional || !isEvmAddress(tokenAddress) || !isEvmAddress(spenderAddress) || !rpcUrl) {
      return { ...next, status: "blocked", blockers: configBlockers };
    }
    try {
      const [balanceAtomic, allowanceAtomic] = await Promise.all([
        readErc20Value(rpcUrl, tokenAddress, encodeErc20BalanceOf(ownerAddress)),
        readErc20Value(rpcUrl, tokenAddress, encodeErc20Allowance(ownerAddress, spenderAddress))
      ]);
      const balance = formatBaseUnits(balanceAtomic, decimals);
      const allowance = formatBaseUnits(allowanceAtomic, decimals);
      const blockers = [
        compareDecimalStrings(balance, requiredNotional) < 0
          ? "Limitless collateral balance is below the total bid amount."
          : null,
        compareDecimalStrings(allowance, requiredNotional) < 0
          ? "Limitless collateral allowance is below the total bid amount. Approve Limitless collateral before trading."
          : null
      ].filter((blocker): blocker is string => Boolean(blocker));
      return {
        ...next,
        status: blockers.length > 0 ? "blocked" : "fresh",
        blockers,
        collateral: { ...next.collateral, balance, allowance }
      };
    } catch {
      return {
        ...next,
        status: "stale",
        blockers: ["Limitless collateral balance/allowance read is unavailable."]
      };
    }
  }

  private async predictFunConditionalTokenReadiness(
    base: LiveSubmitVenueReadiness,
    ownerAddress: string,
    leg: ExecutableRouteLeg,
    predictMetadata: Record<string, unknown>
  ): Promise<LiveSubmitVenueReadiness> {
    const chainId = parsePositiveInteger(this.env.PREDICT_FUN_BALANCE_ACTIVATION_CHAIN_ID) ??
      Number(numericStringField(predictMetadata, "chainId") ?? 56);
    const contractAddresses = predictAddressesForChain(chainId);
    const candidates = predictConditionalTokenCandidates(contractAddresses, predictMetadata, this.env);
    const rpcUrl = this.env.PREDICT_FUN_BALANCE_PREFLIGHT_RPC_URL?.trim() ||
      this.env.PREDICT_FUN_OPS_FUNDING_BALANCE_RPC_URL?.trim() ||
      (chainId === 97 ? "https://bsc-testnet-dataseed.bnbchain.org/" : "https://bsc-dataseed.bnbchain.org/");
    const decimals = parsePositiveInteger(this.env.PREDICT_FUN_CONDITIONAL_TOKEN_DECIMALS) ??
      parsePositiveInteger(this.env.PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_DECIMALS) ??
      18;
    const next: LiveSubmitVenueReadiness = {
      ...base,
      account: { ...base.account, ownerAddress },
      collateral: {
        ...base.collateral,
        requiredNotional: leg.size,
        tokenSymbol: "Predict.fun shares",
        tokenAddress: null,
        spenderAddress: null,
        chainId,
        approvalMethod: "ERC1155_SET_APPROVAL_FOR_ALL"
      }
    };
    const configBlockers = [
      !isEvmAddress(ownerAddress) ? "Predict.fun live preflight owner account is missing or invalid." : null,
      candidates.length === 0 ? "Predict.fun conditional-token contract address could not be derived from SDK metadata." : null,
      !rpcUrl ? "Predict.fun live preflight RPC URL is required before live submit." : null,
      !leg.venueOutcomeId ? "Predict.fun sell preflight could not derive the conditional token id." : null
    ].filter((blocker): blocker is string => Boolean(blocker));
    const tokenId = leg.venueOutcomeId;
    if (configBlockers.length > 0 || !rpcUrl || !tokenId) {
      return { ...next, status: "blocked", blockers: configBlockers };
    }
    try {
      const snapshots = await Promise.all(candidates.map(async (candidate) => {
        const [approved, balanceAtomic] = await Promise.all([
          readErc1155ApprovalForAll(rpcUrl, candidate.tokenAddress, ownerAddress, candidate.spenderAddress),
          readErc1155BalanceOf(rpcUrl, candidate.tokenAddress, ownerAddress, tokenId)
        ]);
        return {
          ...candidate,
          approved,
          balance: formatBaseUnits(balanceAtomic, decimals)
        };
      }));
      const selected = selectPredictConditionalSnapshot(snapshots, leg.size);
      const blockers = [
        selected.approved ? null : "Predict.fun exchange is not approved for selling. Approve Predict.fun shares before selling.",
        compareDecimalStrings(selected.balance, leg.size) < 0 ? `Predict.fun share balance is below the sell amount. Sellable balance: ${selected.balance} shares.` : null
      ].filter((blocker): blocker is string => Boolean(blocker));
      return {
        ...next,
        status: blockers.length > 0 ? "blocked" : "fresh",
        blockers,
        collateral: {
          ...next.collateral,
          tokenAddress: selected.tokenAddress,
          spenderAddress: selected.spenderAddress,
          balance: selected.balance,
          allowance: selected.approved ? "approved" : "0"
        }
      };
    } catch {
      return {
        ...next,
        status: "stale",
        blockers: ["Predict.fun conditional-token approval read is unavailable."]
      };
    }
  }

  private async limitlessConditionalTokenReadiness(
    base: LiveSubmitVenueReadiness,
    ownerAddress: string,
    leg: ExecutableRouteLeg
  ): Promise<LiveSubmitVenueReadiness> {
    const metadata = leg.metadata ?? {};
    const chainId = parsePositiveInteger(this.env.LIMITLESS_BALANCE_PREFLIGHT_CHAIN_ID) ??
      parsePositiveInteger(this.env.LIMITLESS_BALANCE_ACTIVATION_CHAIN_ID) ??
      parsePositiveInteger(this.env.LIMITLESS_FUNDING_PREFERRED_CHAIN_ID) ??
      8453;
    const tokenAddress = this.env.LIMITLESS_CONDITIONAL_TOKENS_ADDRESS?.trim() ||
      this.env.LIMITLESS_CTF_CONTRACT_ADDRESS?.trim() ||
      getLimitlessContractAddress("CTF", chainId);
    const spenderAddress = this.env.LIMITLESS_CONDITIONAL_TOKENS_SPENDER_ADDRESS?.trim() ||
      stringFromRecord(metadata, "limitlessExchangeAddress") ||
      stringFromRecord(metadata, "exchange") ||
      stringFromRecord(metadata, "venueExchange") ||
      "";
    const rpcUrl = this.env.LIMITLESS_BALANCE_PREFLIGHT_RPC_URL?.trim() ||
      this.env.BASE_RPC_URL?.trim() ||
      this.env.LIMITLESS_BASE_RPC_URL?.trim() ||
      "https://mainnet.base.org";
    const next: LiveSubmitVenueReadiness = {
      ...base,
      account: { ...base.account, ownerAddress },
      collateral: {
        ...base.collateral,
        requiredNotional: leg.size,
        tokenSymbol: "Limitless shares",
        tokenAddress: isEvmAddress(tokenAddress) ? tokenAddress : null,
        spenderAddress: isEvmAddress(spenderAddress) ? spenderAddress : null,
        chainId,
        approvalMethod: "ERC1155_SET_APPROVAL_FOR_ALL"
      }
    };
    const configBlockers = [
      !isEvmAddress(ownerAddress) ? "Limitless live preflight owner account is missing or invalid." : null,
      !isEvmAddress(tokenAddress) ? "LIMITLESS_CONDITIONAL_TOKENS_ADDRESS is missing or invalid." : null,
      !isEvmAddress(spenderAddress) ? "Limitless market exchange spender address could not be derived from the live route." : null,
      !rpcUrl ? "Limitless live preflight RPC URL is required before live submit." : null,
      !leg.venueOutcomeId ? "Limitless sell preflight could not derive the conditional token id." : null
    ].filter((blocker): blocker is string => Boolean(blocker));
    if (configBlockers.length > 0 || !isEvmAddress(tokenAddress) || !isEvmAddress(spenderAddress) || !rpcUrl) {
      return { ...next, status: "blocked", blockers: configBlockers };
    }
    try {
      const tokenId = leg.venueOutcomeId;
      if (!tokenId) {
        return { ...next, status: "blocked", blockers: ["Limitless sell preflight could not derive the conditional token id."] };
      }
      const [approved, balanceAtomic] = await Promise.all([
        readErc1155ApprovalForAll(rpcUrl, tokenAddress, ownerAddress, spenderAddress),
        readErc1155BalanceOf(rpcUrl, tokenAddress, ownerAddress, tokenId)
      ]);
      const decimals = parsePositiveInteger(this.env.LIMITLESS_CONDITIONAL_TOKEN_DECIMALS) ??
        parsePositiveInteger(this.env.LIMITLESS_BALANCE_ACTIVATION_TOKEN_DECIMALS) ??
        6;
      const balance = formatBaseUnits(balanceAtomic, decimals);
      const blockers = [
        approved ? null : "Limitless conditional-token allowance is not set. Approve Limitless shares before selling.",
        compareDecimalStrings(balance, leg.size) < 0 ? `Limitless share balance is below the sell amount. Sellable balance: ${balance} shares.` : null
      ].filter((blocker): blocker is string => Boolean(blocker));
      return {
        ...next,
        status: blockers.length > 0 ? "blocked" : "fresh",
        blockers,
        collateral: {
          ...next.collateral,
          balance,
          allowance: approved ? "approved" : "0"
        }
      };
    } catch {
      return {
        ...next,
        status: "stale",
        blockers: ["Limitless conditional-token approval read is unavailable."]
      };
    }
  }

  private async expectedBinding(userId: string, venue: string, requireLimitlessProfile = true): Promise<ExpectedBinding> {
    const account = await this.venueAccounts.getAccount(userId, venue);
    if (!account || account.status !== "ACTIVE") {
      throw new SignedTradeBundleError(
        "USER_VENUE_ACCOUNT_NOT_ACTIVE",
        `${venue} requires an active linked venue account before signing.`
      );
    }
    const normalizedVenue = venue.toUpperCase();
    const signerAddress = requireAddress(account.walletAddress, `${venue} wallet address`);
    const venueAccountAddress = normalizedVenue === "LIMITLESS"
      ? signerAddress
      : requireAddress(account.venueAccountAddress ?? account.walletAddress, `${venue} venue account address`);
    if (normalizedVenue === "LIMITLESS" && requireLimitlessProfile && !isPositiveIntegerString(account.venueAccountId)) {
      throw new SignedTradeBundleError(
        "LIMITLESS_PROFILE_SETUP_REQUIRED",
        "Limitless trading requires a linked Limitless profile. Open Portfolio and activate Limitless before signing this order."
      );
    }
    return {
      userId,
      signerAddress,
      venueAccountAddress,
      ...(account.venueAccountId ? { venueAccountId: account.venueAccountId, profileId: account.venueAccountId } : {})
    };
  }

  private async toSignatureRequest(
    legIndex: number,
    prepared: PreparedVenueOrder,
    binding: ExpectedBinding
  ): Promise<TradeSignatureRequest[]> {
    const payload = prepared.payload;
    if (prepared.venue.toUpperCase() === "LIMITLESS") {
      const limitlessOrder = buildLimitlessOrderPayload(payload, binding.signerAddress);
      return [{
        legIndex,
        venue: prepared.venue,
        requestType: "ORDER",
        signer: binding.signerAddress,
        account: binding.venueAccountAddress,
        kind: "EIP712",
        expiresAt: stringField(payload, "expiresAt") ?? new Date(this.now().getTime() + 60_000).toISOString(),
        typedData: limitlessOrder.typedData,
        signedPayloadHint: {
          signer: binding.signerAddress,
          account: binding.venueAccountAddress,
          data: {
            order: limitlessOrder.order,
            orderType: limitlessOrder.orderType,
            marketSlug: limitlessOrder.marketSlug,
            ownerId: binding.profileId ?? binding.venueAccountId
          },
          typedData: limitlessOrder.typedData
        }
      }];
    }
    if (prepared.venue.toUpperCase() === "POLYMARKET") {
      const polymarketOrder = await buildPolymarketOrderPayload(payload, binding, this.env);
      const authRequest = buildPolymarketClobAuthRequest(legIndex, prepared.venue, binding, this.env, this.now());
      const orderRequest: TradeSignatureRequest = {
        legIndex,
        venue: prepared.venue,
        requestType: "ORDER",
        signer: binding.signerAddress,
        account: binding.venueAccountAddress,
        kind: "EIP712",
        expiresAt: stringField(payload, "expiresAt") ?? new Date(this.now().getTime() + 60_000).toISOString(),
        typedData: polymarketOrder.typedData,
        signedPayloadHint: {
          purpose: "POLYMARKET_ORDER",
          signer: binding.signerAddress,
          account: binding.venueAccountAddress,
          data: polymarketOrder.data,
          typedData: polymarketOrder.typedData
        }
      };
      return [authRequest, orderRequest];
    }
    const predictOrder = buildPredictOrderPayload(payload, binding, this.now());
    return [{
      legIndex,
      venue: prepared.venue,
      requestType: "ORDER",
      signer: binding.signerAddress,
      account: binding.venueAccountAddress,
      kind: "EIP712",
      expiresAt: stringField(payload, "expiresAt") ?? new Date(this.now().getTime() + 60_000).toISOString(),
      typedData: predictOrder.typedData,
      signedPayloadHint: {
        signer: binding.signerAddress,
        account: binding.venueAccountAddress,
        data: predictOrder.data,
        typedData: predictOrder.typedData
      }
    }];
  }

  private attachSignedPayload(
    prepared: PreparedVenueOrder,
    binding: ExpectedBinding,
    signedPayload: Record<string, unknown>
  ): PreparedVenueOrder {
    if (prepared.venue.toUpperCase() === "LIMITLESS") {
      return {
        ...prepared,
        payload: {
          ...prepared.payload,
          relayPayload: {
            expectedBinding: binding,
            signedPayload
          }
        }
      };
    }
    if (prepared.venue.toUpperCase() === "POLYMARKET") {
      const authPayload = this.findSignedPayload(signedPayload, "POLYMARKET_CLOB_AUTH");
      return {
        ...prepared,
        payload: {
          ...prepared.payload,
          expectedBinding: binding,
          signedPayload,
          ...(authPayload ? { polymarketClobAuth: authPayload } : {})
        }
      };
    }
    return {
      ...prepared,
      payload: {
        ...prepared.payload,
        expectedBinding: binding,
        signedPayload
      }
    };
  }

  private attachLiveReadinessAttestation(
    prepared: PreparedVenueOrder,
    quote: ExecutableTradeQuote,
    leg: ExecutableRouteLeg,
    legIndex: number,
    readiness: LiveSubmitVenueReadiness | null
  ): PreparedVenueOrder {
    if (
      prepared.venue.toUpperCase() !== "POLYMARKET" ||
      quote.side !== "buy" ||
      readiness?.status !== "fresh" ||
      !isPolymarketTradeReadySource(readiness.collateral.usableBalanceSource)
    ) {
      return prepared;
    }
    const signedPayload = recordField(prepared.payload, "signedPayload");
    const data = signedPayload ? recordField(signedPayload, "data") : null;
    const order = data ? recordField(data, "order") : null;
    const requiredAtomic = order ? numericStringField(order, "makerAmount") : null;
    if (!requiredAtomic || !/^\d+$/.test(requiredAtomic)) {
      return prepared;
    }
    return {
      ...prepared,
      payload: {
        ...prepared.payload,
        polymarketCollateralReadinessAttestation: {
          kind: "POLYMARKET_CLOB_COLLATERAL_PREFLIGHT",
          quoteId: quote.quoteId,
          legIndex,
          venue: prepared.venue,
          checkedAt: readiness.checkedAt,
          requiredAtomic,
          requiredNotional: readiness.collateral.requiredNotional,
          usableBalance: readiness.collateral.usableBalance,
          usableBalanceSource: readiness.collateral.usableBalanceSource,
          approvalSpenderSource: readiness.collateral.approvalSpenderSource
        }
      }
    };
  }

  private selectSignedPayload(
    prepared: PreparedVenueOrder,
    signedPayloads: readonly SignedTradeLegPayload[]
  ): SignedTradeLegPayload | null {
    if (prepared.venue.toUpperCase() !== "POLYMARKET") {
      return signedPayloads[0] ?? null;
    }
    const order = signedPayloads.find((payload) =>
      payload.requestType === "ORDER" ||
      stringField(payload.signedPayload, "purpose") === "POLYMARKET_ORDER" ||
      Boolean(recordField(recordField(payload.signedPayload, "data") ?? {}, "order"))
    );
    return order ?? null;
  }

  private findSignedPayload(
    currentOrderPayload: Record<string, unknown>,
    purpose: string
  ): Record<string, unknown> | null {
    const related = Array.isArray(currentOrderPayload.relatedSignedPayloads)
      ? currentOrderPayload.relatedSignedPayloads
      : [];
    const match = related.find((entry) => {
      const record = isRecord(entry) ? entry : null;
      return record && stringField(record, "purpose") === purpose;
    });
    return isRecord(match) ? match : null;
  }

  private verifySignedPayload(
    prepared: PreparedVenueOrder,
    binding: ExpectedBinding,
    signedPayload: Record<string, unknown>
  ): void {
    const signer = stringField(signedPayload, "signer");
    const account = stringField(signedPayload, "account");
    const signature = stringField(signedPayload, "signature");
    if (!sameAddress(signer, binding.signerAddress)) {
      throw new SignedTradeBundleError("SIGNED_TRADE_SIGNER_MISMATCH", `${prepared.venue} signature signer does not match the linked Turnkey wallet.`);
    }
    if (!sameAddress(account, binding.venueAccountAddress)) {
      throw new SignedTradeBundleError("SIGNED_TRADE_ACCOUNT_MISMATCH", `${prepared.venue} signed account does not match the linked venue account.`);
    }
    if (!signature || !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
      throw new SignedTradeBundleError("SIGNED_TRADE_SIGNATURE_INVALID", `${prepared.venue} signed payload is missing a valid EVM signature.`);
    }
    if (prepared.venue.toUpperCase() === "LIMITLESS") {
      const typedData = recordField(signedPayload, "typedData");
      if (!typedData) {
        throw new SignedTradeBundleError("SIGNED_TRADE_TYPED_DATA_MISSING", "Limitless signed payload is missing EIP-712 typed data.");
      }
      const recovered = verifyTypedData(
        recordField(typedData, "domain") ?? {},
        recordField(typedData, "types") as never,
        recordField(typedData, "message") ?? {},
        signature
      ).toLowerCase();
      if (recovered !== binding.signerAddress.toLowerCase()) {
        throw new SignedTradeBundleError("SIGNED_TRADE_SIGNATURE_MISMATCH", "Limitless EIP-712 signature does not recover to the linked Turnkey wallet.");
      }
      return;
    }
    if (prepared.venue.toUpperCase() === "POLYMARKET") {
      const typedData = recordField(signedPayload, "typedData");
      if (!typedData) {
        throw new SignedTradeBundleError("SIGNED_TRADE_TYPED_DATA_MISSING", "Polymarket signed payload is missing CLOB EIP-712 typed data.");
      }
      const recovered = verifyTypedDataV6(
        recordField(typedData, "domain") ?? {},
        stripEip712Domain(recordField(typedData, "types") ?? {}) as never,
        recordField(typedData, "message") ?? {},
        signature
      ).toLowerCase();
      if (recovered !== binding.signerAddress.toLowerCase()) {
        throw new SignedTradeBundleError("SIGNED_TRADE_SIGNATURE_MISMATCH", "Polymarket CLOB signature does not recover to the linked Turnkey wallet.");
      }
      const data = recordField(signedPayload, "data");
      const order = data ? recordField(data, "order") : null;
      const typedMessage = recordField(typedData, "message") ?? {};
      if (!order) {
        throw new SignedTradeBundleError("SIGNED_TRADE_ORDER_MISSING", "Polymarket signed payload is missing data.order.");
      }
      if (!sameAddress(stringField(order, "maker"), binding.venueAccountAddress)) {
        throw new SignedTradeBundleError("SIGNED_TRADE_ACCOUNT_MISMATCH", "Polymarket signed order maker does not match the linked deposit wallet.");
      }
      const signatureType = Number(order.signatureType ?? typedMessage.signatureType ?? NaN);
      const expectedOrderSigner = signatureType === Number(PolymarketSignatureType.POLY_1271)
        ? binding.venueAccountAddress
        : binding.signerAddress;
      if (!sameAddress(stringField(order, "signer"), expectedOrderSigner)) {
        throw new SignedTradeBundleError(
          "SIGNED_TRADE_SIGNER_MISMATCH",
          signatureType === Number(PolymarketSignatureType.POLY_1271)
            ? "Polymarket POLY_1271 signed order signer must be the linked deposit wallet."
            : "Polymarket signed order signer does not match the linked Turnkey wallet."
        );
      }
      const typedOrderMessage = recordField(typedMessage, "contents") ?? typedMessage;
      if (
        String(order.tokenId ?? "") !== String(prepared.payload.venueOutcomeId ?? "") ||
        String(typedOrderMessage.tokenId ?? "") !== String(prepared.payload.venueOutcomeId ?? "")
      ) {
        throw new SignedTradeBundleError("SIGNED_TRADE_TOKEN_MISMATCH", "Polymarket signed order token does not match the prepared route.");
      }
      const authPayload = this.findSignedPayload(signedPayload, "POLYMARKET_CLOB_AUTH");
      if (!authPayload) {
        throw new SignedTradeBundleError(
          "POLYMARKET_CLOB_AUTH_SIGNATURE_MISSING",
          "Polymarket order submission requires a deposit-wallet CLOB auth signature before venue submit."
        );
      }
      this.verifyPolymarketClobAuthPayload(binding, authPayload);
      return;
    }
    if (prepared.venue.toUpperCase() === "PREDICT_FUN") {
      const typedData = recordField(signedPayload, "typedData");
      if (!typedData) {
        throw new SignedTradeBundleError("SIGNED_TRADE_TYPED_DATA_MISSING", "Predict.fun signed payload is missing EIP-712 typed data.");
      }
      const recovered = verifyTypedDataV6(
        recordField(typedData, "domain") ?? {},
        stripEip712Domain(recordField(typedData, "types") ?? {}) as never,
        recordField(typedData, "message") ?? {},
        signature
      ).toLowerCase();
      if (recovered !== binding.signerAddress.toLowerCase()) {
        throw new SignedTradeBundleError("SIGNED_TRADE_SIGNATURE_MISMATCH", "Predict.fun EIP-712 signature does not recover to the linked Turnkey wallet.");
      }
    }
    const data = recordField(signedPayload, "data");
    const order = data ? recordField(data, "order") : null;
    if (!order) {
      throw new SignedTradeBundleError("SIGNED_TRADE_ORDER_MISSING", `${prepared.venue} signed payload is missing data.order.`);
    }
  }

  private verifyPolymarketClobAuthPayload(binding: ExpectedBinding, signedPayload: Record<string, unknown>): void {
    const signer = stringField(signedPayload, "signer");
    const account = stringField(signedPayload, "account");
    const signature = stringField(signedPayload, "signature");
    const typedData = recordField(signedPayload, "typedData");
    if (!sameAddress(signer, binding.signerAddress)) {
      throw new SignedTradeBundleError("POLYMARKET_CLOB_AUTH_SIGNER_MISMATCH", "Polymarket CLOB auth signature signer does not match the linked Turnkey wallet.");
    }
    if (!sameAddress(account, binding.venueAccountAddress)) {
      throw new SignedTradeBundleError("POLYMARKET_CLOB_AUTH_ACCOUNT_MISMATCH", "Polymarket CLOB auth account does not match the linked deposit wallet.");
    }
    if (!signature || !/^0x[a-fA-F0-9]{130}$/.test(signature) || !typedData) {
      throw new SignedTradeBundleError("POLYMARKET_CLOB_AUTH_SIGNATURE_INVALID", "Polymarket CLOB auth payload is missing a valid EIP-712 signature.");
    }
    const message = recordField(typedData, "message") ?? {};
    if (!sameAddress(stringField(message, "address"), binding.signerAddress)) {
      throw new SignedTradeBundleError("POLYMARKET_CLOB_AUTH_ADDRESS_MISMATCH", "Polymarket CLOB auth message must target the linked Turnkey wallet.");
    }
    const recovered = verifyTypedDataV6(
      recordField(typedData, "domain") ?? {},
      stripEip712Domain(recordField(typedData, "types") ?? {}) as never,
      message,
      signature
    ).toLowerCase();
    if (recovered !== binding.signerAddress.toLowerCase()) {
      throw new SignedTradeBundleError("POLYMARKET_CLOB_AUTH_SIGNATURE_MISMATCH", "Polymarket CLOB auth signature does not recover to the linked Turnkey wallet.");
    }
  }

  private toSubmittedLeg(index: number, venue: string, submitted: VenueSubmitResult, routeLeg: ExecutableRouteLeg): SignedTradeBundleSubmitResult["submittedLegs"][number] {
    const normalizedFilledSize = submitted.status === "FILLED" ? routeLeg.size : submitted.filledSize;
    const filledSize = Number(normalizedFilledSize);
    const fillState = submitted.status === "FILLED" || submitted.status === "PARTIAL_FILL" || (Number.isFinite(filledSize) && filledSize > 0)
      ? {
          status: submitted.status === "SUBMITTED" ? "OPEN" : submitted.status,
          filledSize: normalizedFilledSize,
          averagePrice: submitted.averagePrice > 0 ? submitted.averagePrice : routeLeg.price,
          offchainFilled: submitted.status === "FILLED" || submitted.status === "PARTIAL_FILL" || filledSize > 0
        } satisfies VenueFillState
      : undefined;
    return {
      legIndex: index,
      venue,
      status: submitted.status,
      venueOrderId: submitted.venueOrderId,
      ...(fillState ? { fillState } : {})
    };
  }

  private async recordExecutionStatus(userId: string, result: SignedTradeBundleSubmitResult, route: ExecutableTradeQuote): Promise<void> {
    const now = this.now().toISOString();
    const status: SignedTradeExecutionStatus = {
      executionId: result.executionId,
      userId,
      status: result.status,
      dryRun: result.dryRun,
      submittedAt: now,
      updatedAt: now,
      route,
      submittedLegs: result.submittedLegs
    };
    await this.saveExecutionStatus(status);
    await this.recordFilledPositions(status);
    await this.recordFailedSellPositionCorrections(status);
  }

  private async saveExecutionStatus(status: SignedTradeExecutionStatus): Promise<void> {
    this.executionStatuses.set(statusKey(status.userId, status.executionId), status);
    await this.statusRepository?.saveExecutionStatus(status);
  }

  private async recordFilledPositions(status: SignedTradeExecutionStatus): Promise<void> {
    if (!this.positionRecorder || status.dryRun || !status.route) {
      return;
    }
    await Promise.all(status.submittedLegs.map(async (leg) => {
      if (leg.status !== "FILLED" || !leg.venueOrderId || !leg.fillState) {
        return;
      }
      const routeLeg = status.route!.legs[leg.legIndex];
      if (!routeLeg) {
        return;
      }
      await this.positionRecorder!.recordFilledLeg({
        executionId: status.executionId,
        userId: status.userId,
        legIndex: leg.legIndex,
        venueOrderId: leg.venueOrderId,
        route: status.route!,
        routeLeg,
        fillState: leg.fillState
      });
    }));
  }

  private async recordFailedSellPositionCorrections(status: SignedTradeExecutionStatus): Promise<void> {
    if (!this.positionRecorder?.reconcileFailedSell || status.dryRun || !status.route || status.route.side !== "sell") {
      return;
    }
    await Promise.all(status.submittedLegs.map(async (leg) => {
      if (leg.status !== "FAILED" || !leg.reason || !isInsufficientSellBalanceReason(leg.reason)) {
        return;
      }
      const routeLeg = status.route!.legs[leg.legIndex];
      if (!routeLeg) {
        return;
      }
      await this.positionRecorder!.reconcileFailedSell!({
        executionId: status.executionId,
        userId: status.userId,
        legIndex: leg.legIndex,
        venue: leg.venue,
        reason: leg.reason,
        route: status.route!,
        routeLeg
      });
    }));
  }
}

const statusKey = (userId: string, executionId: string): string => `${userId}:${executionId}`;

const isInsufficientSellBalanceReason = (reason: string): boolean =>
  /INSUFFICIENT\s+SHARES|INSUFFICIENT\s+CONDITIONAL\s+TOKEN\s+BALANCE|TOKEN\s+BALANCE\s+IS\s+LESS|BALANCE\s+IS\s+NOT\s+ENOUGH/i.test(reason);

const inferredFilledLegState = (routeLeg: ExecutableRouteLeg): VenueFillState => ({
  status: "FILLED",
  filledSize: routeLeg.size,
  averagePrice: routeLeg.price,
  offchainFilled: true
});

const summarizeStoredExecutionStatus = (legs: SignedTradeExecutionStatus["submittedLegs"]): SignedTradeExecutionStatus["status"] => {
  if (legs.some((leg) => leg.status === "FAILED")) {
    return "FAILED";
  }
  if (legs.length > 0 && legs.every((leg) => leg.status === "FILLED")) {
    return "FILLED";
  }
  if (legs.some((leg) => leg.status === "PARTIAL_FILL")) {
    return "PARTIAL";
  }
  return "SUBMITTED";
};

interface ExpectedBinding {
  userId: string;
  signerAddress: string;
  venueAccountAddress: string;
  venueAccountId?: string | undefined;
  profileId?: string | undefined;
}

const buildLimitlessOrderPayload = (
  payload: Record<string, unknown>,
  signerAddress: string
): {
  order: LimitlessUnsignedOrder;
  orderType: LimitlessOrderType;
  marketSlug: string;
  typedData: Record<string, unknown>;
} => {
  const tokenId = stringField(payload, "tokenId");
  const marketSlug = stringField(payload, "marketSlug");
  const size = numberField(payload, "size");
  const price = numberField(payload, "price");
  if (!tokenId || !marketSlug || size === null || price === null) {
    throw new SignedTradeBundleError("LIMITLESS_ORDER_PAYLOAD_INVALID", "Limitless signature preparation requires market slug, token id, price, and size.");
  }
  const exchange = stringField(payload, "exchange");
  if (!exchange) {
    throw new SignedTradeBundleError(
      "LIMITLESS_EXCHANGE_ADDRESS_MISSING",
      "Limitless signature preparation requires the market exchange address. Refresh the route before signing."
    );
  }
  const roundedSize = roundLimitlessOrderSize(size);
  const side = String(payload.side).toLowerCase().includes("sell") || payload.side === LimitlessSide.SELL
    ? LimitlessSide.SELL
    : LimitlessSide.BUY;
  const feeRateBps = numberField(payload, "feeRateBps") ?? 300;
  const builder = new LimitlessOrderBuilder(signerAddress, feeRateBps);
  const order = builder.buildOrder({
    tokenId,
    side,
    size: roundedSize,
    price
  });
  const domain = {
    name: "Limitless CTF Exchange",
    version: "1",
    chainId: 8453,
    verifyingContract: exchange
  };
  const types = {
    Order: [
      { name: "salt", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "signer", type: "address" },
      { name: "taker", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "makerAmount", type: "uint256" },
      { name: "takerAmount", type: "uint256" },
      { name: "expiration", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "feeRateBps", type: "uint256" },
      { name: "side", type: "uint8" },
      { name: "signatureType", type: "uint8" }
    ]
  };
  const message = {
    salt: order.salt,
    maker: order.maker,
    signer: order.signer,
    taker: order.taker,
    tokenId: order.tokenId,
    makerAmount: order.makerAmount,
    takerAmount: order.takerAmount,
    expiration: order.expiration,
    nonce: order.nonce,
    feeRateBps: order.feeRateBps,
    side: order.side,
    signatureType: order.signatureType
  };
  return {
    order,
    orderType: LimitlessOrderType.FOK,
    marketSlug,
    typedData: {
      domain,
      types,
      primaryType: "Order",
      message
    }
  };
};

const roundLimitlessOrderSize = (value: number): number => {
  const scaled = Math.floor((value + Number.EPSILON) * 1_000);
  if (scaled <= 0) {
    throw new SignedTradeBundleError(
      "LIMITLESS_ORDER_SIZE_TOO_SMALL",
      "Limitless order size is below the minimum 0.001 share precision."
    );
  }
  return Number((scaled / 1_000).toFixed(3));
};

const buildPredictOrderPayload = (
  payload: Record<string, unknown>,
  binding: ExpectedBinding,
  now: Date
): { typedData: Record<string, unknown>; data: Record<string, unknown> } => {
  const tokenId = stringField(payload, "venueOutcomeId");
  if (!tokenId) {
    throw new SignedTradeBundleError("PREDICT_FUN_TOKEN_ID_MISSING", "Predict.fun prepared order is missing venueOutcomeId.");
  }
  if (!/^\d+$/.test(tokenId)) {
    throw new SignedTradeBundleError(
      "PREDICT_FUN_TOKEN_ID_INVALID",
      "Predict.fun prepared order requires a numeric venueOutcomeId token id before it can be signed."
    );
  }
  const side = stringField(payload, "side") === "sell" ? PredictSide.SELL : PredictSide.BUY;
  const price = numberField(payload, "price");
  const size = numberField(payload, "size");
  if (price === null || price <= 0 || price >= 1 || size === null || size <= 0) {
    throw new SignedTradeBundleError("PREDICT_FUN_ORDER_PRICE_SIZE_INVALID", "Predict.fun prepared order has invalid price or size.");
  }
  const orderValueUsd = price * size;
  if (!Number.isFinite(orderValueUsd) || orderValueUsd < 0.9) {
    const minimumSize = Math.ceil((0.9 / price) * 1_000_000) / 1_000_000;
    throw new SignedTradeBundleError(
      "PREDICT_FUN_ORDER_VALUE_TOO_LOW",
      `Predict.fun order value must be at least 0.9 USD. Increase amount to at least ${minimumSize}.`
    );
  }
  const metadata = recordField(payload, "predictOrderMetadata") ?? {};
  const chainId = Number(numericStringField(metadata, "chainId") ?? 56);
  const builder = OrderBuilder.make(chainId === 97 ? ChainId.BnbTestnet : ChainId.BnbMainnet);
  const orderbook = predictMarketOrderbookFromMetadata(metadata);
  if (!orderbook) {
    throw new SignedTradeBundleError("PREDICT_FUN_MARKET_ORDERBOOK_MISSING", "Predict.fun MARKET order signing requires a fresh venue orderbook.");
  }
  const amounts = builder.getMarketOrderAmounts({
    side,
    quantityWei: decimalToWei(String(size)),
    slippageBps: BigInt(numericStringField(metadata, "slippageBps") ?? "0"),
    isMinAmountOut: booleanField(metadata, "isMinAmountOut") ?? false
  }, orderbook);
  const order = builder.buildOrder("MARKET", {
    maker: binding.venueAccountAddress,
    signer: binding.venueAccountAddress,
    side,
    tokenId,
    makerAmount: amounts.makerAmount,
    takerAmount: amounts.takerAmount,
    nonce: 0n,
    feeRateBps: BigInt(numericStringField(metadata, "feeRateBps") ?? "0"),
    signatureType: SignatureType.EOA
  });
  const typedData = builder.buildTypedData(order, {
    isNegRisk: booleanField(metadata, "isNegRisk") ?? false,
    isYieldBearing: booleanField(metadata, "isYieldBearing") ?? false
  }) as unknown as Record<string, unknown>;
  const hash = builder.buildTypedDataHash(typedData as never);
  const data = {
    timestamp: now.getTime(),
    pricePerShare: String(amounts.pricePerShare),
    strategy: "MARKET",
    slippageBps: "0",
    isFillOrKill: true,
    isPostOnly: false,
    isMinAmountOut: false,
    amount: String(amounts.amount),
    selfTradePrevention: "CANCEL_MAKER",
    order: {
      ...order,
      hash
    }
  };
  return { typedData, data };
};

const buildPolymarketClobAuthRequest = (
  legIndex: number,
  venue: string,
  binding: ExpectedBinding,
  env: NodeJS.ProcessEnv,
  now: Date
): TradeSignatureRequest => {
  const chainId = Number(parsePolymarketChain(polymarketEnv(env, "POLYMARKET_CHAIN_ID", "POLY_CHAIN_ID")));
  const timestamp = Math.floor(now.getTime() / 1_000);
  const nonce = 0;
  const typedData = {
    domain: {
      name: "ClobAuthDomain",
      version: "1",
      chainId
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }
      ],
      ClobAuth: [
        { name: "address", type: "address" },
        { name: "timestamp", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "message", type: "string" }
      ]
    },
    primaryType: "ClobAuth",
    message: {
      address: binding.signerAddress,
      timestamp: String(timestamp),
      nonce,
      message: "This message attests that I control the given wallet"
    }
  };
  return {
    legIndex,
    venue,
    requestType: "POLYMARKET_CLOB_AUTH",
    signer: binding.signerAddress,
    account: binding.venueAccountAddress,
    kind: "EIP712",
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    typedData,
    signedPayloadHint: {
      purpose: "POLYMARKET_CLOB_AUTH",
      signer: binding.signerAddress,
      account: binding.venueAccountAddress,
      data: {
        address: binding.signerAddress,
        timestamp,
        nonce,
        chainId,
        funderAddress: binding.venueAccountAddress
      },
      typedData
    }
  };
};

const buildPolymarketOrderPayload = async (
  payload: Record<string, unknown>,
  binding: ExpectedBinding,
  env: NodeJS.ProcessEnv
): Promise<{ typedData: Record<string, unknown>; data: Record<string, unknown> }> => {
  const tokenId = stringField(payload, "venueOutcomeId");
  const side = stringField(payload, "side");
  const price = numberField(payload, "price");
  const size = numberField(payload, "size");
  if (!tokenId || !/^\d+$/.test(tokenId)) {
    throw new SignedTradeBundleError("POLYMARKET_TOKEN_ID_MISSING", "Polymarket CLOB signing requires a numeric venueOutcomeId token id.");
  }
  if ((side !== "buy" && side !== "sell") || price === null || price <= 0 || price >= 1 || size === null || size <= 0) {
    throw new SignedTradeBundleError("POLYMARKET_ORDER_PRICE_SIZE_INVALID", "Polymarket prepared order has invalid side, price, or size.");
  }
  const host = polymarketEnv(env, "POLYMARKET_CLOB_HOST", "POLY_CLOB_HOST");
  const builderCode = polymarketEnv(env, "POLYMARKET_BUILDER_CODE", "POLY_BUILDER_CODE");
  if (!host || !builderCode) {
    throw new SignedTradeBundleError("POLYMARKET_SIGNING_ENV_INCOMPLETE", "Polymarket CLOB host and builder code are required before a user order can be signed.");
  }
  const signatureType = parsePolymarketSignatureType(env.POLYMARKET_SIGNATURE_TYPE ?? env.POLY_SIGNATURE_TYPE);
  const usesDepositWallet = !sameAddress(binding.signerAddress, binding.venueAccountAddress);
  if (usesDepositWallet && signatureType !== PolymarketSignatureType.POLY_1271) {
    throw new SignedTradeBundleError(
      "POLYMARKET_DEPOSIT_WALLET_SIGNATURE_TYPE_INVALID",
      "Polymarket deposit-wallet execution requires POLYMARKET_SIGNATURE_TYPE=POLY_1271."
    );
  }

  let capturedTypedData: Record<string, unknown> | null = null;
  const signer = {
    getAddress: async () => binding.signerAddress,
    _signTypedData: async (
      domain: Record<string, unknown>,
      types: Record<string, unknown>,
      value: Record<string, unknown>
    ) => {
      const primaryType = Object.prototype.hasOwnProperty.call(types, "TypedDataSign")
        ? "TypedDataSign"
        : "Order";
      capturedTypedData = {
        primaryType,
        domain,
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" }
          ],
          ...types
        },
        message: value
      };
      return "0x" + "11".repeat(65);
    }
  };

  const client = new PolymarketClobClient({
    host,
    chain: parsePolymarketChain(polymarketEnv(env, "POLYMARKET_CHAIN_ID", "POLY_CHAIN_ID")),
    signer,
    signatureType,
    funderAddress: binding.venueAccountAddress,
    builderConfig: { builderCode },
    retryOnError: false,
    throwOnError: true
  });
  const signedOrder = await client.createOrder({
    tokenID: tokenId,
    price,
    size,
    side: side === "buy" ? PolymarketSide.BUY : PolymarketSide.SELL,
    builderCode
  }, {
    ...(parsePolymarketTickSize(env.POLYMARKET_TICK_SIZE ?? env.POLY_TICK_SIZE)
      ? { tickSize: parsePolymarketTickSize(env.POLYMARKET_TICK_SIZE ?? env.POLY_TICK_SIZE)! }
      : {}),
    ...(parseOptionalEnvBoolean(env.POLYMARKET_NEG_RISK ?? env.POLY_NEG_RISK) !== undefined
      ? { negRisk: parseOptionalEnvBoolean(env.POLYMARKET_NEG_RISK ?? env.POLY_NEG_RISK)! }
      : {})
  });
  if (!capturedTypedData) {
    throw new SignedTradeBundleError("POLYMARKET_TYPED_DATA_NOT_CAPTURED", "Polymarket CLOB SDK did not produce typed data for signing.");
  }
  const { signature: dummySignature, ...orderWithoutSignature } = signedOrder as Record<string, unknown>;
  const polymarketSignatureSuffix = signatureType === PolymarketSignatureType.POLY_1271
    ? polymarket1271SignatureSuffix(dummySignature)
    : null;
  return {
    typedData: capturedTypedData,
    data: {
      order: orderWithoutSignature,
      orderType: "FOK",
      postOnly: false,
      deferExec: false,
      ...(polymarketSignatureSuffix ? { polymarketSignatureSuffix } : {})
    }
  };
};

const polymarket1271SignatureSuffix = (signature: unknown): string => {
  if (typeof signature !== "string" || !/^0x[a-fA-F0-9]+$/.test(signature)) {
    throw new SignedTradeBundleError("POLYMARKET_1271_SIGNATURE_INVALID", "Polymarket CLOB SDK did not produce a valid POLY_1271 signature template.");
  }
  if (signature.length <= 132) {
    throw new SignedTradeBundleError("POLYMARKET_1271_SIGNATURE_SUFFIX_MISSING", "Polymarket CLOB SDK did not produce the POLY_1271 wrapper suffix.");
  }
  return `0x${signature.slice(132)}`;
};

const requireAddress = (value: string | null | undefined, label: string): string => {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new SignedTradeBundleError("USER_VENUE_ACCOUNT_ADDRESS_INVALID", `${label} is missing or invalid.`);
  }
  return value;
};

const sameAddress = (left: string | null | undefined, right: string | null | undefined): boolean =>
  Boolean(left && right && left.toLowerCase() === right.toLowerCase());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (value: Record<string, unknown>, key: string): string | null =>
  typeof value[key] === "string" && value[key].trim().length > 0 ? value[key].trim() : null;

const recordField = (value: Record<string, unknown>, key: string): Record<string, unknown> | null =>
  typeof value[key] === "object" && value[key] !== null ? value[key] as Record<string, unknown> : null;

const numberField = (value: Record<string, unknown>, key: string): number | null => {
  const candidate = value[key];
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const numericStringField = (value: Record<string, unknown>, key: string): string | null => {
  const candidate = value[key];
  if (typeof candidate === "string" && candidate.trim().length > 0 && Number.isFinite(Number(candidate))) {
    return candidate.trim();
  }
  if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  return null;
};

const stringFromRecord = (value: Record<string, unknown>, key: string): string | null => {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
};

const booleanField = (value: Record<string, unknown>, key: string): boolean | null => {
  const candidate = value[key];
  if (typeof candidate === "boolean") return candidate;
  if (typeof candidate === "string") {
    const normalized = candidate.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
};

const predictMarketOrderbookFromMetadata = (metadata: Record<string, unknown>): {
  updateTimestampMs: number;
  asks: [number, number][];
  bids: [number, number][];
} | null => {
  const orderbook = recordField(metadata, "orderbook");
  if (!orderbook) {
    return null;
  }
  const asks = predictDepthLevels(orderbook.asks);
  const bids = predictDepthLevels(orderbook.bids);
  const updateTimestampMs = numberField(orderbook, "updateTimestampMs") ??
    numberField(orderbook, "update_timestamp_ms") ??
    Date.now();
  return asks.length > 0 && bids.length > 0 ? { updateTimestampMs, asks, bids } : null;
};

const predictDepthLevels = (value: unknown): [number, number][] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (Array.isArray(entry) && entry.length >= 2) {
      return depthLevel(entry[0], entry[1]);
    }
    const record = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
    return depthLevel(record.price ?? record.p, record.size ?? record.s ?? record.quantity);
  });
};

const depthLevel = (price: unknown, size: unknown): [number, number][] => {
  const parsedPrice = Number(price);
  const parsedSize = Number(size);
  return Number.isFinite(parsedPrice) && parsedPrice > 0 && parsedPrice < 1 && Number.isFinite(parsedSize) && parsedSize > 0
    ? [[parsedPrice, parsedSize]]
    : [];
};

const decimalToWei = (value: string): bigint => {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new SignedTradeBundleError("DECIMAL_TO_WEI_INVALID", "Predict.fun order amount contains an invalid decimal value.");
  }
  const [whole = "0", fractional = ""] = normalized.split(".");
  const paddedFractional = `${fractional.slice(0, 18)}${"0".repeat(Math.max(18 - fractional.length, 0))}`;
  return BigInt(whole) * 10n ** 18n + BigInt(paddedFractional);
};

const stripEip712Domain = (types: Record<string, unknown>): Record<string, unknown> => {
  const { EIP712Domain: _domain, ...rest } = types;
  return rest;
};

const polymarketEnv = (env: NodeJS.ProcessEnv, primary: string, alias: string): string | undefined => {
  const value = env[primary] ?? env[alias];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const parsePolymarketChain = (value: string | undefined): PolymarketChain =>
  value === String(PolymarketChain.AMOY) ? PolymarketChain.AMOY : PolymarketChain.POLYGON;

const parsePolymarketSignatureType = (value: string | undefined): PolymarketSignatureType => {
  const normalized = `${value ?? "POLY_PROXY"}`.trim().toUpperCase();
  if (normalized === "EOA" || normalized === "0") return PolymarketSignatureType.EOA;
  if (normalized === "POLY_GNOSIS_SAFE" || normalized === "GNOSIS_SAFE" || normalized === "2") {
    return PolymarketSignatureType.POLY_GNOSIS_SAFE;
  }
  if (normalized === "POLY_1271" || normalized === "1271" || normalized === "3") {
    return PolymarketSignatureType.POLY_1271;
  }
  return PolymarketSignatureType.POLY_PROXY;
};

const parsePolymarketTickSize = (value: string | undefined): PolymarketTickSize | undefined => {
  if (value === "0.1" || value === "0.01" || value === "0.001" || value === "0.0001") {
    return value;
  }
  return undefined;
};

const parseOptionalEnvBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return undefined;
};

const requiredUsdNotional = (side: string, leg: ExecutableRouteLeg): string | null => {
  if (side !== "buy") {
    return null;
  }
  const size = Number(leg.size);
  const price = Number(leg.price);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  const notional = multiplyDecimalStrings(leg.size, String(leg.price));
  if (leg.feeAmount === undefined || leg.feeAmount === null || leg.feeAmount <= 0) {
    return notional;
  }
  return addDecimalStrings(notional, String(leg.feeAmount));
};

const parsePositiveInteger = (value: string | undefined): number | null => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isPositiveIntegerString = (value: string | null | undefined): boolean =>
  typeof value === "string" && /^[1-9]\d*$/.test(value.trim());

const isEvmAddress = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);

const encodeErc20BalanceOf = (owner: string): string =>
  `0x70a08231${addressArgument(owner)}`;

const encodeErc20Allowance = (owner: string, spender: string): string =>
  `0xdd62ed3e${addressArgument(owner)}${addressArgument(spender)}`;

const encodeErc1155IsApprovedForAll = (owner: string, operator: string): string =>
  `0xe985e9c5${addressArgument(owner)}${addressArgument(operator)}`;

const encodeErc1155BalanceOf = (owner: string, tokenId: string): string =>
  `0x00fdd58e${addressArgument(owner)}${BigInt(tokenId).toString(16).padStart(64, "0")}`;

const addressArgument = (address: string): string =>
  address.toLowerCase().replace(/^0x/, "").padStart(64, "0");

const readErc20Value = async (rpcUrl: string, tokenAddress: string, data: string): Promise<bigint> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: tokenAddress, data }, "latest"]
    })
  });
  if (!response.ok) {
    throw new Error("erc20_read_http_failed");
  }
  const body = await response.json() as { result?: unknown; error?: unknown };
  if (body.error || typeof body.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(body.result)) {
    throw new Error("erc20_read_malformed");
  }
  return BigInt(body.result);
};

const readErc1155ApprovalForAll = async (
  rpcUrl: string,
  tokenAddress: string,
  owner: string,
  operator: string
): Promise<boolean> => {
  const value = await readErc20Value(rpcUrl, tokenAddress, encodeErc1155IsApprovedForAll(owner, operator));
  return value !== 0n;
};

const readErc1155BalanceOf = async (
  rpcUrl: string,
  tokenAddress: string,
  owner: string,
  tokenId: string
): Promise<bigint> =>
  readErc20Value(rpcUrl, tokenAddress, encodeErc1155BalanceOf(owner, tokenId));

const formatBaseUnits = (value: bigint, decimals: number): string => {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) {
    return whole.toString();
  }
  return trimDecimal(`${whole}.${fraction.toString().padStart(decimals, "0")}`);
};

const trimDecimal = (value: string): string =>
  value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

const decimalFromString = (value: string): InstanceType<typeof Decimal> => {
  const parsed = new Decimal(value.trim());
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new Error("Invalid non-negative decimal amount.");
  }
  return parsed;
};

const plainDecimalString = (value: InstanceType<typeof Decimal>): string =>
  trimDecimal(value.toFixed());

const compareDecimalStrings = (left: string, right: string): number => {
  return decimalFromString(left).cmp(decimalFromString(right));
};

const isPolymarketTradeReadySource = (source: string | null | undefined): boolean =>
  source === "CLOB_COLLATERAL_ALLOWANCE" || source === "USER_CLOB_SYNC_CONFIRMED";

const multiplyDecimalStrings = (left: string, right: string): string => {
  return plainDecimalString(decimalFromString(left).times(decimalFromString(right)));
};

const addDecimalStrings = (left: string, right: string): string => {
  return plainDecimalString(decimalFromString(left).plus(decimalFromString(right)));
};

const predictAddressesForChain = (chainId: number): Record<string, string> | null => {
  const addresses = (AddressesByChainId as Record<number, Record<string, string> | undefined>)[chainId];
  return addresses ?? null;
};

const predictExchangeSpender = (
  addresses: Record<string, string> | null,
  metadata: Record<string, unknown>
): string | null => {
  if (!addresses) {
    return null;
  }
  const isNegRisk = booleanField(metadata, "isNegRisk") === true;
  const isYieldBearing = booleanField(metadata, "isYieldBearing") === true;
  if (isYieldBearing && isNegRisk) return addresses.YIELD_BEARING_NEG_RISK_CTF_EXCHANGE ?? null;
  if (isYieldBearing) return addresses.YIELD_BEARING_CTF_EXCHANGE ?? null;
  if (isNegRisk) return addresses.NEG_RISK_CTF_EXCHANGE ?? null;
  return addresses.CTF_EXCHANGE ?? null;
};

const predictConditionalTokenAddress = (
  addresses: Record<string, string> | null,
  metadata: Record<string, unknown>
): string | null => {
  if (!addresses) {
    return null;
  }
  const isNegRisk = booleanField(metadata, "isNegRisk") === true;
  const isYieldBearing = booleanField(metadata, "isYieldBearing") === true;
  if (isYieldBearing && isNegRisk) return addresses.YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS ?? null;
  if (isYieldBearing) return addresses.YIELD_BEARING_CONDITIONAL_TOKENS ?? null;
  if (isNegRisk) return addresses.NEG_RISK_CONDITIONAL_TOKENS ?? null;
  return addresses.CONDITIONAL_TOKENS ?? null;
};

interface PredictConditionalTokenCandidate {
  tokenAddress: string;
  spenderAddress: string;
  label: string;
}

interface PredictConditionalTokenSnapshot extends PredictConditionalTokenCandidate {
  approved: boolean;
  balance: string;
}

const predictConditionalTokenCandidates = (
  addresses: Record<string, string> | null,
  metadata: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): PredictConditionalTokenCandidate[] => {
  const configuredToken = env.PREDICT_FUN_CONDITIONAL_TOKENS_ADDRESS?.trim();
  const configuredSpender = env.PREDICT_FUN_CONDITIONAL_TOKENS_SPENDER_ADDRESS?.trim() ||
    env.PREDICT_FUN_BALANCE_ACTIVATION_SPENDER_ADDRESS?.trim();
  const candidates: PredictConditionalTokenCandidate[] = [];
  const push = (tokenAddress: string | null | undefined, spenderAddress: string | null | undefined, label: string) => {
    if (!isEvmAddress(tokenAddress) || !isEvmAddress(spenderAddress)) {
      return;
    }
    if (candidates.some((candidate) =>
      sameAddress(candidate.tokenAddress, tokenAddress) && sameAddress(candidate.spenderAddress, spenderAddress)
    )) {
      return;
    }
    candidates.push({ tokenAddress, spenderAddress, label });
  };
  push(configuredToken, configuredSpender, "CONFIGURED");
  push(predictConditionalTokenAddress(addresses, metadata), predictExchangeSpender(addresses, metadata), "METADATA");
  push(addresses?.YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS, addresses?.YIELD_BEARING_NEG_RISK_CTF_EXCHANGE, "YIELD_BEARING_NEG_RISK");
  push(addresses?.YIELD_BEARING_CONDITIONAL_TOKENS, addresses?.YIELD_BEARING_CTF_EXCHANGE, "YIELD_BEARING");
  push(addresses?.NEG_RISK_CONDITIONAL_TOKENS, addresses?.NEG_RISK_CTF_EXCHANGE, "NEG_RISK");
  push(addresses?.CONDITIONAL_TOKENS, addresses?.CTF_EXCHANGE, "STANDARD");
  return candidates;
};

const selectPredictConditionalSnapshot = (
  snapshots: PredictConditionalTokenSnapshot[],
  requiredSize: string
): PredictConditionalTokenSnapshot => {
  if (snapshots.length === 0) {
    throw new SignedTradeBundleError(
      "PREDICT_FUN_CONDITIONAL_TOKEN_DISCOVERY_EMPTY",
      "Predict.fun conditional-token discovery did not return any token contracts."
    );
  }
  const enough = snapshots.find((snapshot) => compareDecimalStrings(snapshot.balance, requiredSize) >= 0);
  if (enough) {
    return enough;
  }
  return [...snapshots].sort((left, right) => compareDecimalStrings(right.balance, left.balance))[0]!;
};
