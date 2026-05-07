import { randomUUID } from "node:crypto";
import { AddressesByChainId, ChainId, OrderBuilder, Side, SignatureType } from "@predictdotfun/sdk";
import { verifyTypedData } from "@ethersproject/wallet";
import { verifyTypedData as verifyTypedDataV6 } from "ethers";
import type { UserVenueAccount } from "../core/execution/user-venue-accounts.js";
import type { ExecutableRouteLeg, ExecutableRouteService, ExecutableTradeQuote } from "./executable-routing.js";
import type { ExecutionLegV0 } from "./types.js";
import type { ExecutionVenueAdapterRegistry, PreparedVenueOrder, VenueFillState, VenueSubmitResult } from "./venue-adapter.js";

export type TradeSignatureKind = "EIP712" | "MESSAGE";

export interface TradeSignatureRequest {
  legIndex: number;
  venue: string;
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
    reason?: string | undefined;
  }>;
}

export interface SignedTradeExecutionStatus {
  executionId: string;
  userId: string;
  status: "DRY_RUN_VERIFIED" | "SUBMITTED" | "PARTIAL" | "FILLED" | "FAILED";
  dryRun: boolean;
  submittedAt: string;
  updatedAt: string;
  submittedLegs: Array<{
    legIndex: number;
    venue: string;
    status: string;
    venueOrderId?: string | undefined;
    reason?: string | undefined;
    fillState?: VenueFillState | undefined;
  }>;
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
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  public async prepare(input: { userId: string; quoteId: string }): Promise<PreparedTradeSignatureBundle> {
    const quote = await this.requireFreshQuote(input.userId, input.quoteId);
    const requests = await Promise.all(quote.legs.map(async (leg, index) => {
      if (!leg.requiresUserSignature) {
        return null;
      }
      const executionLeg = this.toExecutionLeg(quote, leg, index);
      const prepared = await this.adapters.get(leg.venue).prepareOrder(executionLeg);
      const binding = await this.expectedBinding(quote.userId, leg.venue);
      return this.toSignatureRequest(index, prepared, binding);
    }));
    return {
      quoteId: quote.quoteId,
      expiresAt: quote.expiresAt,
      signatureRequests: requests.filter((request): request is TradeSignatureRequest => request !== null)
    };
  }

  public async submit(input: {
    userId: string;
    quoteId: string;
    signedLegs: readonly SignedTradeLegPayload[];
    dryRun?: boolean | undefined;
  }): Promise<SignedTradeBundleSubmitResult> {
    const quote = await this.requireFreshQuote(input.userId, input.quoteId);
    if (input.dryRun !== true) {
      const readiness = await this.getLiveReadiness({ userId: input.userId, quoteId: input.quoteId });
      if (readiness.status !== "fresh") {
        throw new SignedTradeBundleError(
          "LIVE_SUBMIT_READINESS_BLOCKED",
          readiness.blockers[0] ?? "Live submit readiness is blocked or stale."
        );
      }
    }
    const signedByLeg = new Map(input.signedLegs.map((leg) => [`${leg.legIndex}:${leg.venue.toUpperCase()}`, leg]));
    const submittedLegs: SignedTradeBundleSubmitResult["submittedLegs"] = [];

    for (const [index, leg] of quote.legs.entries()) {
      const executionLeg = this.toExecutionLeg(quote, leg, index);
      const adapter = this.adapters.get(leg.venue);
      const prepared = await adapter.prepareOrder(executionLeg);
      let order = prepared;
      if (leg.requiresUserSignature) {
        const signed = signedByLeg.get(`${index}:${leg.venue.toUpperCase()}`);
        if (!signed) {
          throw new SignedTradeBundleError(
            "SIGNED_TRADE_LEG_MISSING",
            `${leg.venue} leg ${index + 1} requires a user signature.`
          );
        }
        const binding = await this.expectedBinding(quote.userId, leg.venue);
        this.verifySignedPayload(prepared, binding, signed.signedPayload);
        order = this.attachSignedPayload(prepared, binding, signed.signedPayload);
      }
      if (input.dryRun === true) {
        submittedLegs.push({ legIndex: index, venue: leg.venue, status: "DRY_RUN_VERIFIED" });
        continue;
      }
      try {
        const submitted = await adapter.submitOrder(order);
        submittedLegs.push(this.toSubmittedLeg(index, leg.venue, submitted));
      } catch (error) {
        const normalized = adapter.normalizeVenueError(error);
        submittedLegs.push({
          legIndex: index,
          venue: leg.venue,
          status: "FAILED",
          reason: normalized.message
        });
        const result: SignedTradeBundleSubmitResult = {
          executionId: quote.quoteId,
          status: "FAILED",
          dryRun: false,
          submittedLegs
        };
        this.recordExecutionStatus(input.userId, result);
        return result;
      }
    }

    const result: SignedTradeBundleSubmitResult = {
      executionId: quote.quoteId,
      status: input.dryRun === true ? "DRY_RUN_VERIFIED" : "SUBMITTED",
      dryRun: input.dryRun === true,
      submittedLegs
    };
    this.recordExecutionStatus(input.userId, result);
    return result;
  }

  public async getExecutionStatus(input: { userId: string; executionId: string }): Promise<SignedTradeExecutionStatus | null> {
    const stored = this.executionStatuses.get(statusKey(input.userId, input.executionId));
    if (!stored) {
      return null;
    }
    if (stored.dryRun) {
      return stored;
    }
    const submittedLegs = await Promise.all(stored.submittedLegs.map(async (leg) => {
      if (!leg.venueOrderId || leg.status === "FAILED") {
        return leg;
      }
      try {
        const fillState = await this.adapters.get(leg.venue).fetchFillState(leg.venueOrderId);
        return {
          ...leg,
          fillState,
          status: fillState.status
        };
      } catch (error) {
        return {
          ...leg,
          fillState: {
            status: "OPEN" as const,
            filledSize: "0",
            averagePrice: 0,
            offchainFilled: false
          },
          reason: error instanceof Error ? error.message : "Venue status lookup failed."
        };
      }
    }));
    const next: SignedTradeExecutionStatus = {
      ...stored,
      updatedAt: this.now().toISOString(),
      status: summarizeStoredExecutionStatus(submittedLegs),
      submittedLegs
    };
    this.executionStatuses.set(statusKey(input.userId, input.executionId), next);
    return next;
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
      settlementStatus: "SETTLEMENT_PENDING"
    };
  }

  private async liveReadinessForLeg(
    quote: ExecutableTradeQuote,
    leg: ExecutableRouteLeg,
    index: number,
    checkedAt: string
  ): Promise<LiveSubmitVenueReadiness> {
    const binding = await this.expectedBinding(quote.userId, leg.venue);
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
    if (leg.venue.toUpperCase() !== "PREDICT_FUN" || quote.side !== "buy") {
      return base;
    }
    const executionLeg = this.toExecutionLeg(quote, leg, index);
    const prepared = await this.adapters.get(leg.venue).prepareOrder(executionLeg);
    return this.predictFunCollateralReadiness(base, binding.venueAccountAddress, requiredNotional, recordField(prepared.payload, "predictOrderMetadata") ?? {});
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
        chainId
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

  private async expectedBinding(userId: string, venue: string): Promise<ExpectedBinding> {
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
    return {
      userId,
      signerAddress,
      venueAccountAddress,
      ...(account.venueAccountId ? { venueAccountId: account.venueAccountId, profileId: account.venueAccountId } : {})
    };
  }

  private toSignatureRequest(
    legIndex: number,
    prepared: PreparedVenueOrder,
    binding: ExpectedBinding
  ): TradeSignatureRequest {
    const payload = prepared.payload;
    if (prepared.venue.toUpperCase() === "LIMITLESS") {
      const typedData = buildLimitlessTypedData(payload, binding.signerAddress);
      return {
        legIndex,
        venue: prepared.venue,
        signer: binding.signerAddress,
        account: binding.venueAccountAddress,
        kind: "EIP712",
        expiresAt: stringField(payload, "expiresAt") ?? new Date(this.now().getTime() + 60_000).toISOString(),
        typedData,
        signedPayloadHint: {
          signer: binding.signerAddress,
          account: binding.venueAccountAddress,
          marketSlug: payload.marketSlug,
          tokenId: payload.tokenId,
          side: payload.side,
          size: payload.size,
          price: payload.price,
          typedData
        }
      };
    }
    const predictOrder = buildPredictOrderPayload(payload, binding, this.now());
    return {
      legIndex,
      venue: prepared.venue,
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
    };
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
    return {
      ...prepared,
      payload: {
        ...prepared.payload,
        expectedBinding: binding,
        signedPayload
      }
    };
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

  private toSubmittedLeg(index: number, venue: string, submitted: VenueSubmitResult): SignedTradeBundleSubmitResult["submittedLegs"][number] {
    return {
      legIndex: index,
      venue,
      status: submitted.status,
      venueOrderId: submitted.venueOrderId
    };
  }

  private recordExecutionStatus(userId: string, result: SignedTradeBundleSubmitResult): void {
    const now = this.now().toISOString();
    this.executionStatuses.set(statusKey(userId, result.executionId), {
      executionId: result.executionId,
      userId,
      status: result.status,
      dryRun: result.dryRun,
      submittedAt: now,
      updatedAt: now,
      submittedLegs: result.submittedLegs
    });
  }
}

const statusKey = (userId: string, executionId: string): string => `${userId}:${executionId}`;

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

const buildLimitlessTypedData = (
  payload: Record<string, unknown>,
  signerAddress: string
): Record<string, unknown> => ({
  domain: {
    name: "Limitless CTF Exchange",
    version: "1",
    chainId: 8453,
    verifyingContract: stringField(payload, "exchange") ?? "0x0000000000000000000000000000000000000001"
  },
  types: {
    Order: [
      { name: "marketSlug", type: "string" },
      { name: "tokenId", type: "string" },
      { name: "side", type: "string" },
      { name: "size", type: "string" },
      { name: "price", type: "string" },
      { name: "maker", type: "address" }
    ]
  },
  primaryType: "Order",
  message: {
    marketSlug: String(payload.marketSlug ?? ""),
    tokenId: String(payload.tokenId ?? ""),
    side: String(payload.side ?? ""),
    size: String(payload.size ?? ""),
    price: String(payload.price ?? ""),
    maker: signerAddress
  }
});

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
  const side = stringField(payload, "side") === "sell" ? Side.SELL : Side.BUY;
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
    isFillOrKill: false,
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

const requireAddress = (value: string | null | undefined, label: string): string => {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new SignedTradeBundleError("USER_VENUE_ACCOUNT_ADDRESS_INVALID", `${label} is missing or invalid.`);
  }
  return value;
};

const sameAddress = (left: string | null | undefined, right: string | null | undefined): boolean =>
  Boolean(left && right && left.toLowerCase() === right.toLowerCase());

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

const requiredUsdNotional = (side: string, leg: ExecutableRouteLeg): string | null => {
  if (side !== "buy") {
    return null;
  }
  const size = Number(leg.size);
  const price = Number(leg.price);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return multiplyDecimalStrings(leg.size, String(leg.price));
};

const parsePositiveInteger = (value: string | undefined): number | null => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isEvmAddress = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);

const encodeErc20BalanceOf = (owner: string): string =>
  `0x70a08231${addressArgument(owner)}`;

const encodeErc20Allowance = (owner: string, spender: string): string =>
  `0xdd62ed3e${addressArgument(owner)}${addressArgument(spender)}`;

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

const compareDecimalStrings = (left: string, right: string): number => {
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftAtomic = BigInt(leftWhole) * 10n ** BigInt(scale) + BigInt(leftFraction.padEnd(scale, "0") || "0");
  const rightAtomic = BigInt(rightWhole) * 10n ** BigInt(scale) + BigInt(rightFraction.padEnd(scale, "0") || "0");
  return leftAtomic === rightAtomic ? 0 : leftAtomic > rightAtomic ? 1 : -1;
};

const multiplyDecimalStrings = (left: string, right: string): string => {
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  const leftScale = leftFraction.length;
  const rightScale = rightFraction.length;
  const leftAtomic = BigInt(`${leftWhole}${leftFraction}`.replace(/^0+(?=\d)/, "") || "0");
  const rightAtomic = BigInt(`${rightWhole}${rightFraction}`.replace(/^0+(?=\d)/, "") || "0");
  const scale = leftScale + rightScale;
  const product = (leftAtomic * rightAtomic).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? product : product.slice(0, -scale);
  const fraction = scale === 0 ? "" : product.slice(-scale);
  return trimDecimal(fraction ? `${whole}.${fraction}` : whole);
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
