import { randomUUID } from "node:crypto";
import { ChainId, OrderBuilder, Side, SignatureType } from "@predictdotfun/sdk";
import { verifyTypedData } from "@ethersproject/wallet";
import { verifyTypedData as verifyTypedDataV6 } from "ethers";
import type { UserVenueAccount } from "../core/execution/user-venue-accounts.js";
import type { ExecutableRouteLeg, ExecutableRouteService, ExecutableTradeQuote } from "./executable-routing.js";
import type { ExecutionLegV0 } from "./types.js";
import type { ExecutionVenueAdapterRegistry, PreparedVenueOrder, VenueSubmitResult } from "./venue-adapter.js";

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
  public constructor(
    private readonly routes: ExecutableRouteService,
    private readonly adapters: ExecutionVenueAdapterRegistry,
    private readonly venueAccounts: SignedTradeBundleVenueAccountProvider,
    private readonly now: () => Date = () => new Date()
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
        return {
          executionId: quote.quoteId,
          status: "FAILED",
          dryRun: false,
          submittedLegs
        };
      }
    }

    return {
      executionId: quote.quoteId,
      status: input.dryRun === true ? "DRY_RUN_VERIFIED" : "SUBMITTED",
      dryRun: input.dryRun === true,
      submittedLegs
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
}

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
  const amounts = builder.getLimitOrderAmounts({
    side,
    pricePerShareWei: decimalToWei(String(price)),
    quantityWei: decimalToWei(String(size))
  });
  const order = builder.buildOrder("LIMIT", {
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
    strategy: "LIMIT",
    slippageBps: "0",
    isFillOrKill: false,
    isPostOnly: false,
    isMinAmountOut: false,
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
