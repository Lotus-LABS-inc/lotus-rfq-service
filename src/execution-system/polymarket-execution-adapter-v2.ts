import { createHash, createHmac } from "node:crypto";
import Decimal from "decimal.js";
import { Wallet } from "@ethersproject/wallet";
import {
  AssetType,
  Chain,
  ClobClient,
  COLLATERAL_TOKEN_DECIMALS,
  OrderType,
  Side,
  SignatureTypeV2,
  type ApiKeyCreds,
  type BalanceAllowanceResponse,
  type ClobClientOptions,
  type OpenOrder,
  type OrderResponse,
  type SignedOrder,
  type TickSize,
  type Trade
} from "@polymarket/clob-client-v2";
import type {
  ExecutionLegV0,
  SettlementStatusV0
} from "./types.js";
import type {
  ExecutionVenueAdapter,
  NormalizedVenueError,
  PreparedVenueOrder,
  VenueFillState,
  VenueSettlementState,
  VenueSubmitResult
} from "./venue-adapter.js";
import {
  createPolymarketRelayNonce,
  polymarketRelayHeaders,
  signPolymarketRelayRequest
} from "./polymarket-execution-relay-auth.js";
import { normalizeLiveVenueErrorMessage } from "./live-venue-error-normalizer.js";

export const polymarketV2RequiredEnvKeys = [
  "POLYMARKET_CLOB_HOST",
  "POLYMARKET_CHAIN_ID",
  "POLYMARKET_API_KEY",
  "POLYMARKET_API_SECRET",
  "POLYMARKET_API_PASSPHRASE",
  "POLYMARKET_BUILDER_CODE",
  "POLYMARKET_PRIVATE_KEY"
] as const;

export type PolymarketV2RequiredEnvKey = (typeof polymarketV2RequiredEnvKeys)[number];
export const polymarketV2DryRunRequiredEnvKeys = [
  "POLYMARKET_CLOB_HOST",
  "POLYMARKET_CHAIN_ID",
  "POLYMARKET_BUILDER_CODE"
] as const;
export type PolymarketV2DryRunRequiredEnvKey = (typeof polymarketV2DryRunRequiredEnvKeys)[number];
const polymarketV2LegacyEnvAliases = {
  POLYMARKET_CLOB_HOST: "POLY_CLOB_HOST",
  POLYMARKET_CHAIN_ID: "POLY_CHAIN_ID",
  POLYMARKET_API_KEY: "POLY_API_KEY",
  POLYMARKET_API_SECRET: "POLY_API_SECRET",
  POLYMARKET_API_PASSPHRASE: "POLY_API_PASSPHRASE",
  POLYMARKET_BUILDER_CODE: "POLY_BUILDER_CODE",
  POLYMARKET_PRIVATE_KEY: "POLY_PRIVATE_KEY"
} as const satisfies Record<PolymarketV2RequiredEnvKey, string>;
export type PolymarketExecutionAdapterV2Readiness =
  | "NOT_CONFIGURED"
  | "DRY_RUN_READY"
  | "LIVE_DISABLED"
  | "LIVE_READY";

export interface PolymarketExecutionAdapterV2Config {
  executionMode: string;
  liveExecutionEnabled: boolean;
  clobHost?: string | undefined;
  chainId?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
  apiPassphrase?: string | undefined;
  builderCode?: string | undefined;
  privateKey?: string | undefined;
  signatureType?: string | undefined;
  funderAddress?: string | undefined;
  tickSize?: TickSize | undefined;
  negRisk?: boolean | undefined;
  relayerHost?: string | undefined;
  relayerApiKey?: string | undefined;
  executionSubmitMode?: string | undefined;
  executionRelayUrl?: string | undefined;
  executionRelaySecret?: string | undefined;
  settlementStateOverride?: SettlementStatusV0 | undefined;
  fillStateOverride?: VenueFillState["status"] | undefined;
}

export interface PolymarketExecutionAdapterV2EnvStatus {
  adapter: "PolymarketExecutionAdapterV2";
  venue: "POLYMARKET";
  executionMode: string;
  featureFlagSelected: boolean;
  liveExecutionEnabled: boolean;
  readinessState: PolymarketExecutionAdapterV2Readiness;
  requiredEnvPresent: boolean;
  missingEnv: readonly string[];
  dryRunRequiredEnvPresent: boolean;
  missingDryRunEnv: readonly PolymarketV2DryRunRequiredEnvKey[];
  builderCodeConfigured: boolean;
  credentialsServerSideOnly: true;
  liveSubmissionStatus: "NOT_CONFIGURED" | "LIVE_DISABLED" | "ENV_INCOMPLETE" | "LIVE_READY" | "LIVE_CLIENT_DISABLED";
  submitMode: "direct" | "relay";
  relayConfigured: boolean;
}

export interface PolymarketSubmitBalanceReader {
  readUsableBalance(input: { userId: string }): Promise<{
    usableBalance: string;
    collateralBalance: string;
    collateralAllowance: string;
    usableBalanceSource: string;
    approvalSpenderSource: string;
  }>;
}

export class PolymarketExecutionNotConfiguredError extends Error {
  public constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = "PolymarketExecutionNotConfiguredError";
  }
}

const nonEmpty = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const redact = (value: string | undefined): string | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const trimmed = value.trim();
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const readPolymarketEnv = (env: NodeJS.ProcessEnv, key: PolymarketV2RequiredEnvKey): string | undefined =>
  env[key] ?? env[polymarketV2LegacyEnvAliases[key]];

const parseOptionalBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value.toLowerCase() === "true") {
    return true;
  }
  if (value.toLowerCase() === "false") {
    return false;
  }
  return undefined;
};

const parseTickSize = (value: string | undefined): TickSize | undefined => {
  if (value === "0.1" || value === "0.01" || value === "0.001" || value === "0.0001") {
    return value;
  }
  return undefined;
};

const parseSignatureType = (value: string | undefined): SignatureTypeV2 => {
  const normalized = `${value ?? "POLY_PROXY"}`.trim().toUpperCase();
  if (normalized === "EOA" || normalized === "0") {
    return SignatureTypeV2.EOA;
  }
  if (normalized === "POLY_GNOSIS_SAFE" || normalized === "GNOSIS_SAFE" || normalized === "2") {
    return SignatureTypeV2.POLY_GNOSIS_SAFE;
  }
  if (normalized === "POLY_1271" || normalized === "1271" || normalized === "3") {
    return SignatureTypeV2.POLY_1271;
  }
  return SignatureTypeV2.POLY_PROXY;
};

const signatureTypeForSignedOrder = (signedOrder: SignedOrder): SignatureTypeV2 | null => {
  const value = Number((signedOrder as unknown as Record<string, unknown>).signatureType);
  if (value === Number(SignatureTypeV2.EOA)) return SignatureTypeV2.EOA;
  if (value === Number(SignatureTypeV2.POLY_GNOSIS_SAFE)) return SignatureTypeV2.POLY_GNOSIS_SAFE;
  if (value === Number(SignatureTypeV2.POLY_1271)) return SignatureTypeV2.POLY_1271;
  if (value === Number(SignatureTypeV2.POLY_PROXY)) return SignatureTypeV2.POLY_PROXY;
  return null;
};

const parseChain = (value: string | undefined): Chain => {
  if (value === String(Chain.AMOY)) {
    return Chain.AMOY;
  }
  return Chain.POLYGON;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const getPolymarketExecutionAdapterV2EnvStatus = (
  env: NodeJS.ProcessEnv = process.env
): PolymarketExecutionAdapterV2EnvStatus => {
  const submitMode = env.POLYMARKET_EXECUTION_SUBMIT_MODE === "relay" ? "relay" : "direct";
  const relayEnvKeys = ["POLYMARKET_EXECUTION_RELAY_URL", "POLYMARKET_EXECUTION_RELAY_SECRET"] as const;
  const missingRelayEnv = relayEnvKeys.filter((key) => !nonEmpty(env[key]));
  const missingDirectEnv = polymarketV2RequiredEnvKeys.filter((key) => !nonEmpty(readPolymarketEnv(env, key)));
  const missingDryRunEnv = polymarketV2DryRunRequiredEnvKeys.filter((key) => !nonEmpty(readPolymarketEnv(env, key)));
  const liveExecutionEnabled = env.POLYMARKET_LIVE_EXECUTION_ENABLED === "true";
  const featureFlagSelected = env.POLYMARKET_EXECUTION_MODE === "v2";
  const missingEnv = submitMode === "relay" ? missingRelayEnv : missingDirectEnv;
  const requiredEnvPresent = missingEnv.length === 0;
  const dryRunRequiredEnvPresent = missingDryRunEnv.length === 0;
  const readinessState: PolymarketExecutionAdapterV2Readiness =
    !featureFlagSelected || !dryRunRequiredEnvPresent
      ? "NOT_CONFIGURED"
      : !liveExecutionEnabled
        ? "LIVE_DISABLED"
        : requiredEnvPresent
          ? "LIVE_READY"
          : "DRY_RUN_READY";
  return {
    adapter: "PolymarketExecutionAdapterV2",
    venue: "POLYMARKET",
    executionMode: env.POLYMARKET_EXECUTION_MODE ?? "disabled",
    featureFlagSelected,
    liveExecutionEnabled,
    readinessState,
    requiredEnvPresent,
    missingEnv,
    dryRunRequiredEnvPresent,
    missingDryRunEnv,
    builderCodeConfigured: nonEmpty(readPolymarketEnv(env, "POLYMARKET_BUILDER_CODE")),
    credentialsServerSideOnly: true,
    submitMode,
    relayConfigured: missingRelayEnv.length === 0,
    liveSubmissionStatus: readinessState === "NOT_CONFIGURED"
      ? "NOT_CONFIGURED"
      : !liveExecutionEnabled
        ? "LIVE_DISABLED"
      : !requiredEnvPresent
        ? "ENV_INCOMPLETE"
        : submitMode === "relay"
          ? "LIVE_READY"
          : "LIVE_CLIENT_DISABLED"
  };
};

export const buildPolymarketExecutionAdapterV2ConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): PolymarketExecutionAdapterV2Config => ({
  executionMode: env.POLYMARKET_EXECUTION_MODE ?? "disabled",
  liveExecutionEnabled: env.POLYMARKET_LIVE_EXECUTION_ENABLED === "true",
  clobHost: readPolymarketEnv(env, "POLYMARKET_CLOB_HOST"),
  chainId: readPolymarketEnv(env, "POLYMARKET_CHAIN_ID"),
  apiKey: readPolymarketEnv(env, "POLYMARKET_API_KEY"),
  apiSecret: readPolymarketEnv(env, "POLYMARKET_API_SECRET"),
  apiPassphrase: readPolymarketEnv(env, "POLYMARKET_API_PASSPHRASE"),
  builderCode: readPolymarketEnv(env, "POLYMARKET_BUILDER_CODE"),
  privateKey: readPolymarketEnv(env, "POLYMARKET_PRIVATE_KEY"),
  signatureType: env.POLYMARKET_SIGNATURE_TYPE ?? env.POLY_SIGNATURE_TYPE,
  funderAddress: env.POLYMARKET_FUNDER_ADDRESS ?? env.POLY_FUNDER_ADDRESS,
  tickSize: parseTickSize(env.POLYMARKET_TICK_SIZE ?? env.POLY_TICK_SIZE),
  negRisk: parseOptionalBoolean(env.POLYMARKET_NEG_RISK ?? env.POLY_NEG_RISK),
  relayerHost: env.POLYMARKET_RELAYER_HOST ?? env.POLY_RELAYER_HOST,
  relayerApiKey: env.POLYMARKET_RELAYER_API_KEY ?? env.POLY_RELAYER_API_KEY,
  executionSubmitMode: env.POLYMARKET_EXECUTION_SUBMIT_MODE,
  executionRelayUrl: env.POLYMARKET_EXECUTION_RELAY_URL,
  executionRelaySecret: env.POLYMARKET_EXECUTION_RELAY_SECRET
});

const assertLiveClientConfig = (config: PolymarketExecutionAdapterV2Config): void => {
  const missing: string[] = [];
  if (!nonEmpty(config.clobHost)) missing.push("POLYMARKET_CLOB_HOST");
  if (!nonEmpty(config.chainId)) missing.push("POLYMARKET_CHAIN_ID");
  if (!nonEmpty(config.apiKey)) missing.push("POLYMARKET_API_KEY");
  if (!nonEmpty(config.apiSecret)) missing.push("POLYMARKET_API_SECRET");
  if (!nonEmpty(config.apiPassphrase)) missing.push("POLYMARKET_API_PASSPHRASE");
  if (!nonEmpty(config.builderCode)) missing.push("POLYMARKET_BUILDER_CODE");
  if (!nonEmpty(config.privateKey)) missing.push("POLYMARKET_PRIVATE_KEY");
  if (!config.liveExecutionEnabled) missing.push("POLYMARKET_LIVE_EXECUTION_ENABLED");
  if (missing.length > 0) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_V2_LIVE_CLIENT_ENV_INCOMPLETE",
      `Polymarket V2 live client env is incomplete: ${missing.join(", ")}.`
    );
  }
};

export const createPolymarketClobV2SdkClient: PolymarketClobV2SdkFactory = (config) => {
  assertLiveClientConfig(config);
  const creds: ApiKeyCreds = {
    key: config.apiKey!,
    secret: config.apiSecret!,
    passphrase: config.apiPassphrase!
  };
  const options: ClobClientOptions = {
    host: config.clobHost!,
    chain: parseChain(config.chainId),
    signer: new Wallet(config.privateKey!),
    creds,
    signatureType: parseSignatureType(config.signatureType),
    builderConfig: { builderCode: config.builderCode! },
    retryOnError: false,
    throwOnError: true
  };
  if (nonEmpty(config.funderAddress)) {
    const funderAddress = config.funderAddress!;
    options.funderAddress = funderAddress;
  }
  return new ClobClient(options);
};

export interface PolymarketClobV2DryRunOrderInput {
  clientOrderId: string;
  venueMarketId: string;
  venueOutcomeId: string;
  side: "buy" | "sell";
  size: string;
  price: number;
}

export interface PolymarketClobV2DryRunOrderEnvelope {
  /**
   * Lotus-internal validation shape only. This is not Polymarket's raw V2 `/order`
   * request body; live submission must go through the CLOB V2 SDK path.
   */
  envelopeKind: "LOTUS_INTERNAL_DRY_RUN_SHAPE";
  lotusInternalRequest: {
    method: "POST";
    path: "/order";
    host: string;
    body: {
      market: string;
      token_id: string;
      side: "BUY" | "SELL";
      size: string;
      price: string;
      builder_code: string;
      chain_id: string;
      client_order_id: string;
    };
  };
  signing: {
    algorithm: "HMAC_SHA256_DRY_RUN";
    timestamp: string;
    bodyHash: string;
    preimageHash: string;
    signatureHash: string;
    apiKeyRef: string | null;
    passphraseRef: string | null;
    signatureVerifiedLocally: boolean;
  };
  validation: {
    dryRunOnly: true;
    submitAllowed: false;
    shapeValid: boolean;
    blockers: readonly string[];
  };
}

export interface PolymarketClobV2PreparedDryRunEnvelope {
  adapter: "PolymarketExecutionAdapterV2";
  dryRun: true;
  orderHash: string;
  orderDigest: string;
  marketId: string;
  outcomeId: string;
  side: "BUY" | "SELL";
  size: string;
  price: string;
  builderCode: string;
  chainId: string;
  clobHost: string;
  createdAt: string;
}

export interface PolymarketClobV2LiveClient {
  readonly mode: "disabled" | "live" | "relay";
  submitOrder(order: PreparedVenueOrder): Promise<VenueSubmitResult>;
  fetchFillState(venueOrderId: string): Promise<VenueFillState>;
  cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }>;
  fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState>;
}

export interface PolymarketClobV2SdkClient {
  createAndPostOrder(
    userOrder: {
      tokenID: string;
      price: number;
      size: number;
      side: Side;
      builderCode?: string;
    },
    options?: { tickSize?: TickSize; negRisk?: boolean },
    orderType?: OrderType
  ): Promise<unknown>;
  postOrder?(order: SignedOrder, orderType?: OrderType, postOnly?: boolean, deferExec?: boolean): Promise<unknown>;
  updateBalanceAllowance?(params: { asset_type: AssetType; token_id?: string }): Promise<unknown>;
  getBalanceAllowance?(params: { asset_type: AssetType; token_id?: string }): Promise<BalanceAllowanceResponse>;
  getOrder(orderId: string): Promise<OpenOrder | null>;
  getTrades(params?: { id?: string; maker_address?: string; market?: string; asset_id?: string }): Promise<Trade[]>;
  cancelOrder(payload: { orderID: string }): Promise<unknown>;
}

export type PolymarketClobV2SdkFactory = (config: PolymarketExecutionAdapterV2Config) => PolymarketClobV2SdkClient;

export class DisabledPolymarketClobV2LiveClient implements PolymarketClobV2LiveClient {
  public readonly mode = "disabled";
  public submitAttempts = 0;

  public async submitOrder(_order: PreparedVenueOrder): Promise<VenueSubmitResult> {
    this.submitAttempts += 1;
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_V2_LIVE_CLIENT_DISABLED",
      "Polymarket V2 live client is disabled; no network order submission is configured."
    );
  }

  public async fetchFillState(_venueOrderId: string): Promise<VenueFillState> {
    return {
      status: "FAILED",
      filledSize: "0",
      averagePrice: 0,
      offchainFilled: false
    };
  }

  public async cancelOrder(_venueOrderId: string): Promise<{ cancelled: boolean }> {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_V2_LIVE_CLIENT_DISABLED",
      "Polymarket V2 live client is disabled; cancel requests are not configured."
    );
  }

  public async fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState> {
    return {
      status: "DRY_RUN_ONLY",
      evidence: {
        source: "polymarket_v2_disabled_live_client",
        fillOrOrderId,
        dryRunOnly: true
      }
    };
  }
}

export class SdkPolymarketClobV2LiveClient implements PolymarketClobV2LiveClient {
  public readonly mode = "live";
  private readonly sdkClient: PolymarketClobV2SdkClient;
  private readonly sensitiveValues: readonly string[];

  public constructor(
    private readonly config: PolymarketExecutionAdapterV2Config,
    sdkFactory: PolymarketClobV2SdkFactory = createPolymarketClobV2SdkClient,
    private readonly balanceReader?: PolymarketSubmitBalanceReader | undefined
  ) {
    assertLiveClientConfig(config);
    this.sdkClient = sdkFactory(config);
    this.sensitiveValues = [
      config.apiKey,
      config.apiSecret,
      config.apiPassphrase,
      config.privateKey,
      config.builderCode
    ].filter((value): value is string => nonEmpty(value));
  }

  public async submitOrder(order: PreparedVenueOrder): Promise<VenueSubmitResult> {
    parsePreparedPolymarketPayload(order);
    const signedOrder = parseUserSignedPolymarketOrder(order);
    if (signedOrder) {
      const authPayload = parsePolymarketClobAuthPayload(order);
      const sdkClient = authPayload
        ? await this.createUserScopedSdkClient(authPayload, signedOrder)
        : this.sdkClient;
      const postOrder = sdkClient.postOrder?.bind(sdkClient);
      if (!postOrder) {
        throw new PolymarketExecutionNotConfiguredError(
          "POLYMARKET_SIGNED_ORDER_SUBMIT_UNAVAILABLE",
          "Polymarket CLOB signed-order submit is not available in the configured SDK client."
        );
      }
      const extraSensitiveValues = authPayload?.creds
        ? [authPayload.creds.key, authPayload.creds.secret, authPayload.creds.passphrase]
        : [];
      await this.assertSignedOrderHasSpendableBalanceAllowance(
        sdkClient,
        signedOrder,
        extraSensitiveValues,
        polymarketSubmitUserId(order),
        order
      );
      const response = await this.callSdkSafely(() => postOrder(signedOrder, OrderType.GTC), extraSensitiveValues);
      return mapPolymarketOrderResponse(response);
    }
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_USER_SIGNATURE_REQUIRED",
      "Polymarket live execution requires a user-signed CLOB order. Refresh the route and sign the order before submit."
    );
  }

  public async fetchFillState(venueOrderId: string): Promise<VenueFillState> {
    const order = await this.callSdkSafely(() => this.sdkClient.getOrder(venueOrderId));
    if (order) {
      return mapPolymarketOpenOrderToFillState(order);
    }
    const trades = await this.callSdkSafely(() => this.sdkClient.getTrades({ id: venueOrderId }));
    return mapPolymarketTradesToFillState(trades);
  }

  public async cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }> {
    const response = await this.callSdkSafely(() => this.sdkClient.cancelOrder({ orderID: venueOrderId }));
    return { cancelled: isPolymarketCancelSuccess(response) };
  }

  public async fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState> {
    const order = await this.callSdkSafely(() => this.sdkClient.getOrder(fillOrOrderId)).catch(() => null);
    const tradeId = order?.associate_trades?.[0] ?? fillOrOrderId;
    const trades = await this.callSdkSafely(() => this.sdkClient.getTrades({ id: tradeId }));
    const [trade] = trades;
    if (!trade) {
      return {
        status: "SETTLEMENT_PENDING",
        evidence: {
          source: "polymarket_v2_clob_sdk",
          fillOrOrderId,
          reason: "no_trade_found"
        }
      };
    }
    return mapPolymarketV2SettlementState({
      settlementStatus: trade.status,
      finalityStatus: trade.transaction_hash ? "verified" : trade.status,
      ...extractPolymarketBuilderFeeEvidence(trade)
    });
  }

  private async createUserScopedSdkClient(
    authPayload: PolymarketClobAuthPayload,
    signedOrder: SignedOrder
  ): Promise<PolymarketClobV2SdkClient> {
    const creds = authPayload.creds ?? await createOrDerivePolymarketApiKey(this.config, authPayload);
    authPayload.creds = creds;
    const options: ClobClientOptions = {
      host: this.config.clobHost!,
      chain: parseChain(this.config.chainId),
      signer: addressOnlySigner(authPayload.address),
      creds,
      signatureType: signatureTypeForSignedOrder(signedOrder) ?? parseSignatureType(this.config.signatureType),
      ...(authPayload.funderAddress ? { funderAddress: authPayload.funderAddress } : {}),
      builderConfig: { builderCode: this.config.builderCode! },
      retryOnError: false,
      throwOnError: true
    };
    return new ClobClient(options);
  }

  private async callSdkSafely<T>(operation: () => Promise<T>, extraSensitiveValues: readonly string[] = []): Promise<T> {
    const sensitiveValues = [...this.sensitiveValues, ...extraSensitiveValues].filter((value): value is string => nonEmpty(value));
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      originalError(...args.map((arg) => redactPolymarketSdkLog(arg, sensitiveValues)));
    };
    try {
      return await operation();
    } catch (error) {
      throw sanitizePolymarketSdkError(error, sensitiveValues);
    } finally {
      console.error = originalError;
    }
  }

  private async assertSignedOrderHasSpendableBalanceAllowance(
    sdkClient: PolymarketClobV2SdkClient,
    signedOrder: SignedOrder,
    extraSensitiveValues: readonly string[],
    userId: string | null,
    order: PreparedVenueOrder
  ): Promise<void> {
    const required = requiredBalanceAllowanceForSignedOrder(signedOrder);
    if (required?.assetType === AssetType.CONDITIONAL) {
      await this.assertSignedOrderHasSpendableConditionalTokens(sdkClient, {
        tokenId: required.tokenId!,
        requiredAtomic: required.requiredAtomic
      }, extraSensitiveValues);
      return;
    }
    const requiredAtomic = required?.requiredAtomic ?? null;
    if (requiredAtomic === null) {
      return;
    }
    const updateBalanceAllowance = sdkClient.updateBalanceAllowance?.bind(sdkClient);
    const getBalanceAllowance = sdkClient.getBalanceAllowance?.bind(sdkClient);
    if (!getBalanceAllowance) {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_CLOB_BALANCE_CHECK_UNAVAILABLE",
        "Polymarket CLOB balance readiness could not be checked before submit."
      );
    }
    let spendableAtomic = 0n;
    let balanceAtomic = 0n;
    let allowanceAtomic = 0n;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (updateBalanceAllowance) {
        await this.callSdkSafely(
          () => updateBalanceAllowance({ asset_type: AssetType.COLLATERAL }),
          extraSensitiveValues
        );
      }
      const response = await this.callSdkSafely(
        () => getBalanceAllowance({ asset_type: AssetType.COLLATERAL }),
        extraSensitiveValues
      );
      ({ spendableAtomic, balanceAtomic, allowanceAtomic } = collateralSpendableAtomicUnits(response));
      if (spendableAtomic >= requiredAtomic) {
        break;
      }
      if (attempt < 2 && updateBalanceAllowance) {
        await delay(500);
      }
    }
    if (spendableAtomic < requiredAtomic) {
      const fallback = await this.readVerifiedOnchainCollateralFallback(userId);
      if (fallback?.usableAtomic !== undefined && fallback.usableAtomic >= requiredAtomic) {
        return;
      }
      const attestation = parsePolymarketCollateralReadinessAttestation(order, requiredAtomic);
      if (attestation) {
        return;
      }
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_CLOB_COLLATERAL_NOT_READY",
        [
          "Polymarket CLOB collateral is not ready for this order.",
          `Spendable balance: ${formatCollateralAtomicUnits(spendableAtomic)} USDC.`,
          `Required: ${formatCollateralAtomicUnits(requiredAtomic)} USDC.`,
          `CLOB balance: ${formatCollateralAtomicUnits(balanceAtomic)} USDC.`,
          `CLOB allowance: ${formatCollateralAtomicUnits(allowanceAtomic)} USDC.`,
          "If funds were just bridged, activate/wrap/approve them before trading."
        ].join(" ")
      );
    }
  }

  private async readVerifiedOnchainCollateralFallback(userId: string | null): Promise<{
    usableAtomic: bigint;
    usableBalanceSource: string;
  } | null> {
    if (!userId || !this.balanceReader) {
      return null;
    }
    try {
      const balance = await this.balanceReader.readUsableBalance({ userId });
      if (balance.usableBalanceSource !== "ONCHAIN_CLOB_SPENDER_ALLOWANCE") {
        return null;
      }
      return {
        usableAtomic: collateralDecimalUnitsToAtomic(balance.usableBalance, "fallback usableBalance"),
        usableBalanceSource: balance.usableBalanceSource
      };
    } catch {
      return null;
    }
  }

  private async assertSignedOrderHasSpendableConditionalTokens(
    sdkClient: PolymarketClobV2SdkClient,
    required: { tokenId: string; requiredAtomic: bigint },
    extraSensitiveValues: readonly string[]
  ): Promise<void> {
    const updateBalanceAllowance = sdkClient.updateBalanceAllowance?.bind(sdkClient);
    const getBalanceAllowance = sdkClient.getBalanceAllowance?.bind(sdkClient);
    if (!getBalanceAllowance) {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_CLOB_BALANCE_CHECK_UNAVAILABLE",
        "Polymarket CLOB share readiness could not be checked before submit."
      );
    }
    let spendableAtomic = 0n;
    let balanceAtomic = 0n;
    let allowanceAtomic = 0n;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (updateBalanceAllowance) {
        await this.callSdkSafely(
          () => updateBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: required.tokenId }),
          extraSensitiveValues
        );
      }
      const response = await this.callSdkSafely(
        () => getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: required.tokenId }),
        extraSensitiveValues
      );
      ({ spendableAtomic, balanceAtomic, allowanceAtomic } = collateralSpendableAtomicUnits(response));
      if (spendableAtomic >= required.requiredAtomic) {
        break;
      }
      if (attempt < 2 && updateBalanceAllowance) {
        await delay(500);
      }
    }
    if (spendableAtomic < required.requiredAtomic) {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_CLOB_CONDITIONAL_TOKEN_NOT_READY",
        [
          "Polymarket outcome shares are not approved for selling.",
          `Spendable shares: ${formatCollateralAtomicUnits(spendableAtomic)}.`,
          `Required: ${formatCollateralAtomicUnits(required.requiredAtomic)}.`,
          `CLOB share balance: ${formatCollateralAtomicUnits(balanceAtomic)}.`,
          `CLOB share allowance: ${formatCollateralAtomicUnits(allowanceAtomic)}.`,
          "Approve Polymarket shares before selling this position."
        ].join(" ")
      );
    }
  }
}

export class RelayPolymarketClobV2LiveClient implements PolymarketClobV2LiveClient {
  public readonly mode = "relay";
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(config: {
    relayUrl: string;
    relaySecret: string;
    fetchImpl?: typeof fetch | undefined;
  }) {
    if (!nonEmpty(config.relayUrl) || !nonEmpty(config.relaySecret)) {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_V2_RELAY_ENV_INCOMPLETE",
        "Polymarket execution relay requires POLYMARKET_EXECUTION_RELAY_URL and POLYMARKET_EXECUTION_RELAY_SECRET."
      );
    }
    this.baseUrl = config.relayUrl.replace(/\/+$/, "");
    this.secret = config.relaySecret;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public submitOrder(order: PreparedVenueOrder): Promise<VenueSubmitResult> {
    return this.post<VenueSubmitResult>("/internal/polymarket/v2/submit-order", { order });
  }

  public fetchFillState(venueOrderId: string): Promise<VenueFillState> {
    return this.post<VenueFillState>("/internal/polymarket/v2/fill-state", { venueOrderId });
  }

  public cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }> {
    return this.post<{ cancelled: boolean }>("/internal/polymarket/v2/cancel-order", { venueOrderId });
  }

  public fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState> {
    return this.post<VenueSettlementState>("/internal/polymarket/v2/settlement-state", { fillOrOrderId });
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const timestamp = new Date().toISOString();
    const nonce = createPolymarketRelayNonce();
    const signature = signPolymarketRelayRequest(this.secret, {
      timestamp,
      nonce,
      method: "POST",
      path,
      body
    });
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [polymarketRelayHeaders.timestamp]: timestamp,
        [polymarketRelayHeaders.nonce]: nonce,
        [polymarketRelayHeaders.signature]: signature
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `Polymarket execution relay request failed with status ${response.status}.`;
      const normalized = normalizeLiveVenueErrorMessage(message, {
        venue: "POLYMARKET",
        fallbackCode: response.status === 401 || response.status === 403
          ? "POLYMARKET_V2_RELAY_UNAUTHORIZED"
          : "POLYMARKET_V2_RELAY_ERROR",
        fallbackMessage: message
      });
      throw new PolymarketExecutionNotConfiguredError(
        normalized.code,
        normalized.message
      );
    }
    return payload as T;
  }
}

export class PolymarketClobV2DryRunClient {
  public constructor(private readonly config: PolymarketExecutionAdapterV2Config) {}

  public buildOrderEnvelope(
    input: PolymarketClobV2DryRunOrderInput,
    options: { requireCredentials?: boolean } = {}
  ): PolymarketClobV2DryRunOrderEnvelope {
    const blockers = this.validateInput(input, options.requireCredentials ?? true);
    const body = {
      market: input.venueMarketId,
      token_id: input.venueOutcomeId,
      side: input.side === "buy" ? "BUY" as const : "SELL" as const,
      size: input.size,
      price: input.price.toFixed(4),
      builder_code: this.config.builderCode ?? "",
      chain_id: this.config.chainId ?? "",
      client_order_id: input.clientOrderId
    };
    const bodyJson = stableStringify(body);
    const timestamp = new Date(0).toISOString();
    const preimage = ["POST", "/order", timestamp, sha256Hex(bodyJson)].join("\n");
    const signature = createHmac("sha256", this.config.apiSecret ?? "").update(preimage).digest("hex");
    return {
      envelopeKind: "LOTUS_INTERNAL_DRY_RUN_SHAPE",
      lotusInternalRequest: {
        method: "POST",
        path: "/order",
        host: this.config.clobHost ?? "",
        body
      },
      signing: {
        algorithm: "HMAC_SHA256_DRY_RUN",
        timestamp,
        bodyHash: sha256Hex(bodyJson),
        preimageHash: sha256Hex(preimage),
        signatureHash: sha256Hex(signature),
        apiKeyRef: redact(this.config.apiKey),
        passphraseRef: redact(this.config.apiPassphrase),
        signatureVerifiedLocally: blockers.length === 0 && signature.length === 64
      },
      validation: {
        dryRunOnly: true,
        submitAllowed: false,
        shapeValid: blockers.length === 0,
        blockers
      }
    };
  }

  public buildPreparedDryRunEnvelope(
    input: PolymarketClobV2DryRunOrderInput,
    now: Date = new Date()
  ): PolymarketClobV2PreparedDryRunEnvelope & { blockers: readonly string[] } {
    const envelope = this.buildOrderEnvelope(input, { requireCredentials: false });
    return {
      adapter: "PolymarketExecutionAdapterV2",
      dryRun: true,
      orderHash: envelope.signing.bodyHash,
      orderDigest: envelope.signing.preimageHash,
      marketId: envelope.lotusInternalRequest.body.market,
      outcomeId: envelope.lotusInternalRequest.body.token_id,
      side: envelope.lotusInternalRequest.body.side,
      size: envelope.lotusInternalRequest.body.size,
      price: envelope.lotusInternalRequest.body.price,
      builderCode: envelope.lotusInternalRequest.body.builder_code,
      chainId: envelope.lotusInternalRequest.body.chain_id,
      clobHost: envelope.lotusInternalRequest.host,
      createdAt: now.toISOString(),
      blockers: envelope.validation.blockers
    };
  }

  private validateInput(input: PolymarketClobV2DryRunOrderInput, requireCredentials: boolean): string[] {
    const blockers: string[] = [];
    if (!nonEmpty(this.config.clobHost) || !this.config.clobHost!.startsWith("http")) {
      blockers.push("invalid_clob_host");
    }
    if (!nonEmpty(this.config.chainId) || !/^\d+$/.test(this.config.chainId!)) {
      blockers.push("invalid_chain_id");
    }
    if (requireCredentials && !nonEmpty(this.config.apiKey)) blockers.push("missing_api_key");
    if (requireCredentials && !nonEmpty(this.config.apiSecret)) blockers.push("missing_api_secret");
    if (requireCredentials && !nonEmpty(this.config.apiPassphrase)) blockers.push("missing_api_passphrase");
    if (!nonEmpty(this.config.builderCode)) blockers.push("missing_builder_code");
    if (!nonEmpty(input.clientOrderId)) blockers.push("missing_client_order_id");
    if (!nonEmpty(input.venueMarketId)) blockers.push("missing_market");
    if (!nonEmpty(input.venueOutcomeId)) blockers.push("missing_token_id");
    if (!/^\d+(\.\d+)?$/.test(input.size) || Number(input.size) <= 0) {
      blockers.push("invalid_size");
    }
    if (!Number.isFinite(input.price) || input.price <= 0) {
      blockers.push("invalid_price");
    }
    return blockers;
  }
}

export const mapPolymarketV2SettlementState = (input: {
  finalityStatus?: string | null;
  settlementStatus?: string | null;
  ghostFillSuspected?: boolean;
  ghostFillConfirmed?: boolean;
  builderFeeAmount?: string | number | null;
  builderFeeBps?: string | number | null;
}): VenueSettlementState => {
  const feeEvidence = {
    ...(input.builderFeeAmount !== undefined && input.builderFeeAmount !== null ? { builderFeeAmount: input.builderFeeAmount } : {}),
    ...(input.builderFeeBps !== undefined && input.builderFeeBps !== null ? { builderFeeBps: input.builderFeeBps } : {})
  };
  if (input.ghostFillConfirmed) {
    return {
      status: "GHOST_FILL_CONFIRMED",
      evidence: { source: "polymarket_v2", reason: "ghost_fill_confirmed", ...feeEvidence }
    };
  }
  if (input.ghostFillSuspected) {
    return {
      status: "GHOST_FILL_SUSPECTED",
      evidence: { source: "polymarket_v2", reason: "ghost_fill_suspected", ...feeEvidence }
    };
  }

  const normalized = `${input.finalityStatus ?? input.settlementStatus ?? ""}`.trim().toLowerCase();
  if (["verified", "settled", "final", "finalized", "confirmed"].includes(normalized)) {
    return { status: "SETTLEMENT_VERIFIED", evidence: { source: "polymarket_v2", finalityStatus: normalized, ...feeEvidence } };
  }
  if (["pending", "open", "submitted"].includes(normalized)) {
    return { status: "SETTLEMENT_PENDING", evidence: { source: "polymarket_v2", finalityStatus: normalized, ...feeEvidence } };
  }
  if (["timeout", "timed_out"].includes(normalized)) {
    return { status: "SETTLEMENT_TIMEOUT", evidence: { source: "polymarket_v2", finalityStatus: normalized, ...feeEvidence } };
  }
  return { status: "SETTLEMENT_UNKNOWN", evidence: { source: "polymarket_v2", finalityStatus: normalized || null, ...feeEvidence } };
};

const extractPolymarketBuilderFeeEvidence = (trade: Trade): {
  builderFeeAmount?: string | number;
  builderFeeBps?: string | number;
} => {
  const record = trade as unknown as Record<string, unknown>;
  const amount = record.builderFeeAmount ?? record.builder_fee_amount ?? record.builderFee ?? record.builder_fee;
  const bps = record.builderFeeBps ?? record.builder_fee_bps ?? record.builderFeeRateBps ?? record.builder_fee_rate_bps ?? record.tbf ?? record.mbf;
  return {
    ...(typeof amount === "string" || typeof amount === "number" ? { builderFeeAmount: amount } : {}),
    ...(typeof bps === "string" || typeof bps === "number" ? { builderFeeBps: bps } : {})
  };
};

const parsePreparedPolymarketPayload = (order: PreparedVenueOrder): {
  venueMarketId: string;
  venueOutcomeId: string;
  side: "buy" | "sell";
  size: string;
  price: number;
} => {
  const payload = order.payload;
  const venueMarketId = payload.venueMarketId;
  const venueOutcomeId = payload.venueOutcomeId;
  const side = payload.side;
  const size = payload.size;
  const price = payload.price;
  if (
    typeof venueMarketId !== "string"
    || typeof venueOutcomeId !== "string"
    || (side !== "buy" && side !== "sell")
    || typeof size !== "string"
    || typeof price !== "number"
    || !Number.isFinite(Number(size))
    || Number(size) <= 0
    || !Number.isFinite(price)
    || price <= 0
  ) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_V2_ORDER_PAYLOAD_INVALID",
      "Polymarket V2 prepared order payload is missing required submit fields."
    );
  }
  return { venueMarketId, venueOutcomeId, side, size, price };
};

const parseUserSignedPolymarketOrder = (order: PreparedVenueOrder): SignedOrder | null => {
  const signedPayload = isRecord(order.payload.signedPayload) ? order.payload.signedPayload : null;
  const data = signedPayload && isRecord(signedPayload.data) ? signedPayload.data : null;
  const orderPayload = data && isRecord(data.order) ? data.order : null;
  const signature = signedPayload && typeof signedPayload.signature === "string" ? signedPayload.signature : null;
  if (!orderPayload || !signature) {
    return null;
  }
  const requiredStringFields = ["maker", "signer", "tokenId", "makerAmount", "takerAmount", "timestamp", "metadata", "builder", "expiration"];
  const missing = requiredStringFields.filter((field) => typeof orderPayload[field] !== "string" && typeof orderPayload[field] !== "number");
  if (missing.length > 0) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_SIGNED_ORDER_INVALID",
      `Polymarket signed order is missing required fields: ${missing.join(", ")}.`
    );
  }
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_SIGNED_ORDER_SIGNATURE_INVALID",
      "Polymarket signed order is missing a valid EVM signature."
    );
  }
  const signatureType = Number(orderPayload.signatureType);
  const suffix = typeof data?.polymarketSignatureSuffix === "string" ? data.polymarketSignatureSuffix : null;
  const finalSignature = signatureType === Number(SignatureTypeV2.POLY_1271)
    ? appendPolymarket1271SignatureSuffix(signature, suffix)
    : signature;
  return {
    ...orderPayload,
    signature: finalSignature
  } as unknown as SignedOrder;
};

const parseNonNegativeAtomicUnits = (value: unknown, fieldName: string): bigint => {
  const normalized = typeof value === "number"
    ? value.toString()
    : typeof value === "bigint"
      ? value.toString()
      : typeof value === "string"
        ? value.trim()
        : "";
  if (normalized.length === 0) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_CLOB_BALANCE_PAYLOAD_INVALID",
      `Polymarket CLOB balance response included an invalid ${fieldName}.`
    );
  }
  try {
    const parsed = new Decimal(normalized);
    if (!parsed.isFinite() || parsed.isNegative()) {
      throw new Error("invalid atomic amount");
    }
    return BigInt(parsed.toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0));
  } catch {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_CLOB_BALANCE_PAYLOAD_INVALID",
      `Polymarket CLOB balance response included an invalid ${fieldName}.`
    );
  }
};

const collateralDecimalUnitsToAtomic = (value: string, fieldName: string): bigint => {
  try {
    const parsed = new Decimal(value.trim());
    if (!parsed.isFinite() || parsed.isNegative()) {
      throw new Error("invalid collateral amount");
    }
    return BigInt(
      parsed
        .times(new Decimal(10).pow(COLLATERAL_TOKEN_DECIMALS))
        .toDecimalPlaces(0, Decimal.ROUND_DOWN)
        .toFixed(0)
    );
  } catch {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_CLOB_BALANCE_PAYLOAD_INVALID",
      `Polymarket on-chain fallback response included an invalid ${fieldName}.`
    );
  }
};

const collateralAllowanceAtomicUnits = (response: BalanceAllowanceResponse): bigint => {
  if (nonEmpty(response.allowance)) {
    return parseNonNegativeAtomicUnits(response.allowance, "allowance");
  }
  const allowances = (response as unknown as { allowances?: unknown }).allowances;
  if (!allowances || typeof allowances !== "object" || Array.isArray(allowances)) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_CLOB_BALANCE_PAYLOAD_INVALID",
      "Polymarket CLOB balance response did not include an allowance."
    );
  }
  const parsedAllowances = Object.values(allowances).map((value) =>
    parseNonNegativeAtomicUnits(value, "allowance")
  );
  if (parsedAllowances.length === 0) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_CLOB_BALANCE_PAYLOAD_INVALID",
      "Polymarket CLOB balance response included an empty allowance set."
    );
  }
  return parsedAllowances.reduce((minimum, value) => value < minimum ? value : minimum);
};

const collateralSpendableAtomicUnits = (response: BalanceAllowanceResponse): {
  balanceAtomic: bigint;
  allowanceAtomic: bigint;
  spendableAtomic: bigint;
} => {
  const balanceAtomic = parseNonNegativeAtomicUnits(response.balance, "balance");
  const allowanceAtomic = collateralAllowanceAtomicUnits(response);
  return {
    balanceAtomic,
    allowanceAtomic,
    spendableAtomic: balanceAtomic < allowanceAtomic ? balanceAtomic : allowanceAtomic
  };
};

const requiredBalanceAllowanceForSignedOrder = (signedOrder: SignedOrder): {
  assetType: AssetType;
  tokenId?: string;
  requiredAtomic: bigint;
} | null => {
  const record = signedOrder as unknown as Record<string, unknown>;
  const side = `${record.side ?? ""}`.trim().toUpperCase();
  if (side === "BUY" || side === "0") {
    return {
      assetType: AssetType.COLLATERAL,
      requiredAtomic: parseNonNegativeAtomicUnits(record.makerAmount, "makerAmount")
    };
  }
  if (side === "SELL" || side === "1") {
    const tokenId = typeof record.tokenId === "string" && /^\d+$/.test(record.tokenId) ? record.tokenId : null;
    if (!tokenId) {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_SIGNED_ORDER_INVALID",
        "Polymarket signed sell order is missing tokenId for share allowance preflight."
      );
    }
    return {
      assetType: AssetType.CONDITIONAL,
      tokenId,
      requiredAtomic: parseNonNegativeAtomicUnits(record.makerAmount, "makerAmount")
    };
  }
  return null;
};

const formatCollateralAtomicUnits = (atomic: bigint): string => {
  const scale = 10n ** BigInt(COLLATERAL_TOKEN_DECIMALS);
  const whole = atomic / scale;
  const fraction = atomic % scale;
  const trimmedFraction = fraction.toString().padStart(COLLATERAL_TOKEN_DECIMALS, "0").replace(/0+$/, "");
  return trimmedFraction.length > 0 ? `${whole.toString()}.${trimmedFraction}` : whole.toString();
};

const parsePolymarketCollateralReadinessAttestation = (
  order: PreparedVenueOrder,
  requiredAtomic: bigint
): { usableBalanceSource: string; approvalSpenderSource: string } | null => {
  const attestation = isRecord(order.payload.polymarketCollateralReadinessAttestation)
    ? order.payload.polymarketCollateralReadinessAttestation
    : null;
  if (!attestation) {
    return null;
  }
  const kind = typeof attestation.kind === "string" ? attestation.kind : "";
  const source = typeof attestation.usableBalanceSource === "string" ? attestation.usableBalanceSource : "";
  const spenderSource = typeof attestation.approvalSpenderSource === "string" ? attestation.approvalSpenderSource : "";
  const attestedRequired = typeof attestation.requiredAtomic === "string" ? attestation.requiredAtomic.trim() : "";
  if (
    kind !== "POLYMARKET_CLOB_COLLATERAL_PREFLIGHT" ||
    !isPolymarketTradeReadyAttestationSource(source) ||
    spenderSource !== "CLOB_ALLOWANCE_MAP" ||
    !/^\d+$/.test(attestedRequired) ||
    BigInt(attestedRequired) !== requiredAtomic
  ) {
    return null;
  }
  return { usableBalanceSource: source, approvalSpenderSource: spenderSource };
};

const isPolymarketTradeReadyAttestationSource = (source: string): boolean =>
  source === "CLOB_COLLATERAL_ALLOWANCE" || source === "ONCHAIN_CLOB_SPENDER_ALLOWANCE";

interface PolymarketClobAuthPayload {
  address: string;
  signature: string;
  timestamp: number;
  nonce: number;
  funderAddress?: string | undefined;
  creds?: ApiKeyCreds | undefined;
}

const parsePolymarketClobAuthPayload = (order: PreparedVenueOrder): PolymarketClobAuthPayload | null => {
  const payload = isRecord(order.payload.polymarketClobAuth) ? order.payload.polymarketClobAuth : null;
  const data = payload && isRecord(payload.data) ? payload.data : {};
  const address = typeof data.address === "string"
    ? data.address
    : payload && typeof payload.signer === "string"
      ? payload.signer
      : null;
  const funderAddress = typeof data.funderAddress === "string"
    ? data.funderAddress
    : payload && typeof payload.account === "string"
      ? payload.account
      : undefined;
  const signature = payload && typeof payload.signature === "string" ? payload.signature : null;
  const timestamp = typeof data.timestamp === "number" ? data.timestamp : Number(data.timestamp);
  const nonce = typeof data.nonce === "number" ? data.nonce : Number(data.nonce ?? 0);
  if (!payload) {
    return null;
  }
  if (
    typeof address !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(address) ||
    !signature ||
    !/^0x[a-fA-F0-9]{130}$/.test(signature) ||
    !Number.isInteger(timestamp) ||
    timestamp <= 0 ||
    !Number.isInteger(nonce) ||
    nonce < 0
  ) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_CLOB_AUTH_PAYLOAD_INVALID",
      "Polymarket signed order is missing a valid Turnkey CLOB auth signature."
    );
  }
  return { address, signature, timestamp, nonce, funderAddress };
};

const polymarketSubmitUserId = (order: PreparedVenueOrder): string | null => {
  const binding = isRecord(order.payload.expectedBinding) ? order.payload.expectedBinding : null;
  const userId = binding && typeof binding.userId === "string" ? binding.userId.trim() : "";
  return userId.length > 0 ? userId : null;
};

const createOrDerivePolymarketApiKey = async (
  config: PolymarketExecutionAdapterV2Config,
  auth: PolymarketClobAuthPayload
): Promise<ApiKeyCreds> => {
  let deriveError: unknown = null;
  try {
    const derived = await requestPolymarketApiKey(config, auth, "derive");
    if (nonEmpty(derived.key) && nonEmpty(derived.secret) && nonEmpty(derived.passphrase)) {
      return derived;
    }
  } catch (error) {
    deriveError = error;
  }
  const created = await requestPolymarketApiKey(config, auth, "create").catch((createError: unknown) => {
    const message = createError instanceof Error
      ? createError.message
      : deriveError instanceof Error
        ? deriveError.message
        : "Polymarket CLOB API-key creation failed.";
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_USER_CLOB_API_KEY_UNAVAILABLE",
      message
    );
  });
  if (!nonEmpty(created.key) || !nonEmpty(created.secret) || !nonEmpty(created.passphrase)) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_USER_CLOB_API_KEY_INVALID",
      "Polymarket did not return usable user-scoped CLOB API credentials."
    );
  }
  return created;
};

const requestPolymarketApiKey = async (
  config: PolymarketExecutionAdapterV2Config,
  auth: PolymarketClobAuthPayload,
  mode: "create" | "derive"
): Promise<ApiKeyCreds> => {
  const host = config.clobHost?.replace(/\/+$/, "");
  if (!host) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_CLOB_HOST_MISSING",
      "Polymarket CLOB host is required before user CLOB credentials can be derived."
    );
  }
  const path = mode === "create" ? "/auth/api-key" : "/auth/derive-api-key";
  const response = await fetch(`${host}${path}`, {
    method: mode === "create" ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      POLY_ADDRESS: auth.address,
      POLY_SIGNATURE: auth.signature,
      POLY_TIMESTAMP: String(auth.timestamp),
      POLY_NONCE: String(auth.nonce)
    }
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `Polymarket CLOB API-key ${mode} failed with status ${response.status}.`;
    throw new PolymarketExecutionNotConfiguredError(
      response.status === 401 || response.status === 403
        ? "POLYMARKET_USER_CLOB_API_KEY_UNAUTHORIZED"
        : "POLYMARKET_USER_CLOB_API_KEY_ERROR",
      message
    );
  }
  const record = isRecord(payload) ? payload : {};
  const key = typeof record.apiKey === "string" ? record.apiKey : typeof record.key === "string" ? record.key : "";
  const secret = typeof record.secret === "string" ? record.secret : "";
  const passphrase = typeof record.passphrase === "string" ? record.passphrase : "";
  return { key, secret, passphrase };
};

const addressOnlySigner = (address: string): {
  getAddress(): Promise<string>;
  _signTypedData(): Promise<string>;
} => ({
  async getAddress() {
    return address;
  },
  async _signTypedData() {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_ADDRESS_ONLY_SIGNER_CANNOT_SIGN",
      "Polymarket address-only signer is only valid for L2 HMAC requests."
    );
  }
});

const appendPolymarket1271SignatureSuffix = (signature: string, suffix: string | null): string => {
  if (!suffix || !/^0x[a-fA-F0-9]+$/.test(suffix) || suffix.length <= 2) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_1271_SIGNATURE_SUFFIX_MISSING",
      "Polymarket POLY_1271 signed order is missing the required CLOB signature wrapper."
    );
  }
  return `0x${signature.slice(2)}${suffix.slice(2)}`;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const mapPolymarketOrderResponse = (response: unknown): VenueSubmitResult => {
  const record = isRecord(response) ? response : {};
  const orderID = record.orderID ?? record.orderId ?? record.id;
  const statusValue = `${record.status ?? ""}`.trim().toUpperCase();
  const takingAmount = record.takingAmount;
  const makingAmount = record.makingAmount;
  const filledSize = typeof takingAmount === "string" && takingAmount.length > 0
    ? takingAmount
    : typeof makingAmount === "string" && makingAmount.length > 0
      ? makingAmount
      : "0";
  const averagePrice = Number(record.price ?? 0);
  const result: VenueSubmitResult = {
    venueOrderId: typeof orderID === "string" && orderID.length > 0 ? orderID : `polymarket-order-${sha256Hex(stableStringify(response)).slice(0, 16)}`,
    status: statusValue === "MATCHED" || statusValue === "FILLED"
      ? "FILLED"
      : Number(filledSize) > 0
        ? "PARTIAL_FILL"
        : "SUBMITTED",
    filledSize,
    averagePrice: Number.isFinite(averagePrice) && averagePrice > 0 ? averagePrice : 0
  };
  const fillId = Array.isArray((record as Partial<OrderResponse>).transactionsHashes)
    ? (record as Partial<OrderResponse>).transactionsHashes?.[0]
    : undefined;
  if (fillId) {
    result.fillId = fillId;
  }
  return result;
};

const mapPolymarketOpenOrderToFillState = (order: OpenOrder): VenueFillState => {
  const status = `${order.status}`.trim().toLowerCase();
  const filledSize = order.size_matched || "0";
  return {
    status: status === "matched" || status === "filled"
      ? "FILLED"
      : status === "cancelled" || status === "canceled"
        ? "CANCELLED"
        : Number(filledSize) > 0
          ? "PARTIAL_FILL"
          : "OPEN",
    filledSize,
    averagePrice: Number(order.price) || 0,
    offchainFilled: Number(filledSize) > 0
  };
};

const mapPolymarketTradesToFillState = (trades: Trade[]): VenueFillState => {
  const filledTrades = trades.filter((trade) => Number(trade.size) > 0);
  if (filledTrades.length === 0) {
    return {
      status: "OPEN",
      filledSize: "0",
      averagePrice: 0,
      offchainFilled: false
    };
  }
  const filledSize = filledTrades.reduce((sum, trade) => sum + Number(trade.size), 0);
  const notional = filledTrades.reduce((sum, trade) => sum + Number(trade.size) * (Number(trade.price) || 0), 0);
  const confirmed = filledTrades.some((trade) => {
    const status = `${trade.status ?? ""}`.trim().toLowerCase();
    return status === "confirmed" || status === "matched" || status === "filled";
  });
  return {
    status: confirmed ? "FILLED" : "PARTIAL_FILL",
    filledSize: String(filledSize),
    averagePrice: filledSize > 0 ? notional / filledSize : 0,
    offchainFilled: true
  };
};

const isPolymarketCancelSuccess = (response: unknown): boolean => {
  if (typeof response === "boolean") {
    return response;
  }
  if (!isRecord(response)) {
    return false;
  }
  return response.success === true
    || response.cancelled === true
    || response.canceled === true
    || `${response.status ?? ""}`.toLowerCase() === "cancelled";
};

const redactStringValues = (value: string, sensitiveValues: readonly string[]): string => {
  let output = value;
  for (const secret of sensitiveValues) {
    output = output.split(secret).join("<redacted>");
  }
  return output
    .replace(/("POLY_SIGNATURE"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/("POLY_API_KEY"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/("POLY_PASSPHRASE"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/("signature"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/("owner"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/("builder"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/("builderCode"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/("builder_code"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/(\\?"POLY_SIGNATURE\\?"\s*:\s*\\?")[^"\\]+(\\?")/gi, "$1<redacted>$2")
    .replace(/(\\?"POLY_API_KEY\\?"\s*:\s*\\?")[^"\\]+(\\?")/gi, "$1<redacted>$2")
    .replace(/(\\?"POLY_PASSPHRASE\\?"\s*:\s*\\?")[^"\\]+(\\?")/gi, "$1<redacted>$2")
    .replace(/(\\?"signature\\?"\s*:\s*\\?")[^"\\]+(\\?")/gi, "$1<redacted>$2")
    .replace(/(\\?"owner\\?"\s*:\s*\\?")[^"\\]+(\\?")/gi, "$1<redacted>$2")
    .replace(/(\\?"builder\\?"\s*:\s*\\?")[^"\\]+(\\?")/gi, "$1<redacted>$2")
    .replace(/(\\?"builderCode\\?"\s*:\s*\\?")[^"\\]+(\\?")/gi, "$1<redacted>$2")
    .replace(/(\\?"builder_code\\?"\s*:\s*\\?")[^"\\]+(\\?")/gi, "$1<redacted>$2");
};

const redactPolymarketSdkLog = (value: unknown, sensitiveValues: readonly string[]): unknown => {
  if (typeof value === "string") {
    return redactStringValues(value, sensitiveValues);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactPolymarketSdkLog(entry, sensitiveValues));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /api[_-]?key|secret|passphrase|signature|private|builder/i.test(key)
          ? "<redacted>"
          : redactPolymarketSdkLog(entry, sensitiveValues)
      ])
    );
  }
  return value;
};

const sanitizePolymarketSdkError = (error: unknown, sensitiveValues: readonly string[]): Error => {
  const status = isRecord(error) && typeof error.status === "number" ? error.status : undefined;
  const rawMessage = error instanceof Error ? error.message : "Polymarket CLOB SDK error.";
  const message = redactStringValues(rawMessage, sensitiveValues);
  const normalized = normalizeLiveVenueErrorMessage(message, {
    venue: "POLYMARKET",
    fallbackCode: status === 401 ? "POLYMARKET_V2_UNAUTHORIZED" : "POLYMARKET_V2_SDK_ERROR",
    fallbackMessage: message
  });
  if (normalized.code !== (status === 401 ? "POLYMARKET_V2_UNAUTHORIZED" : "POLYMARKET_V2_SDK_ERROR")) {
    return new PolymarketExecutionNotConfiguredError(
      normalized.code,
      normalized.message
    );
  }
  const sanitized = new PolymarketExecutionNotConfiguredError(
    status === 401 ? "POLYMARKET_V2_UNAUTHORIZED" : "POLYMARKET_V2_SDK_ERROR",
    message
  );
  if (status !== undefined) {
    Object.assign(sanitized, { status });
  }
  return sanitized;
};

export const createPolymarketClobV2LiveClient = (
  config: PolymarketExecutionAdapterV2Config,
  sdkFactory?: PolymarketClobV2SdkFactory,
  balanceReader?: PolymarketSubmitBalanceReader | undefined
): PolymarketClobV2LiveClient => {
  try {
    if (config.executionSubmitMode === "relay") {
      return new RelayPolymarketClobV2LiveClient({
        relayUrl: config.executionRelayUrl ?? "",
        relaySecret: config.executionRelaySecret ?? ""
      });
    }
    return new SdkPolymarketClobV2LiveClient(config, sdkFactory, balanceReader);
  } catch {
    return new DisabledPolymarketClobV2LiveClient();
  }
};

export class PolymarketExecutionAdapterV2 implements ExecutionVenueAdapter {
  public readonly venue = "POLYMARKET";
  private readonly dryRunClient: PolymarketClobV2DryRunClient;
  private readonly now: () => Date;
  private readonly liveClient: PolymarketClobV2LiveClient;

  public constructor(
    private readonly config: PolymarketExecutionAdapterV2Config,
    liveClient?: PolymarketClobV2LiveClient,
    balanceReader?: PolymarketSubmitBalanceReader | undefined
  ) {
    this.liveClient = liveClient ?? createPolymarketClobV2LiveClient(config, undefined, balanceReader);
    this.dryRunClient = new PolymarketClobV2DryRunClient(config);
    this.now = () => new Date();
  }

  public status(): PolymarketExecutionAdapterV2EnvStatus {
    const envLike: NodeJS.ProcessEnv = {
      POLYMARKET_EXECUTION_MODE: this.config.executionMode,
      POLYMARKET_LIVE_EXECUTION_ENABLED: String(this.config.liveExecutionEnabled),
      POLYMARKET_CLOB_HOST: this.config.clobHost,
      POLYMARKET_CHAIN_ID: this.config.chainId,
      POLYMARKET_API_KEY: this.config.apiKey,
      POLYMARKET_API_SECRET: this.config.apiSecret,
      POLYMARKET_API_PASSPHRASE: this.config.apiPassphrase,
      POLYMARKET_BUILDER_CODE: this.config.builderCode,
      POLYMARKET_PRIVATE_KEY: this.config.privateKey
    };
    if (this.config.executionSubmitMode) {
      envLike.POLYMARKET_EXECUTION_SUBMIT_MODE = this.config.executionSubmitMode;
    }
    if (this.config.executionRelayUrl) {
      envLike.POLYMARKET_EXECUTION_RELAY_URL = this.config.executionRelayUrl;
    }
    if (this.config.executionRelaySecret) {
      envLike.POLYMARKET_EXECUTION_RELAY_SECRET = this.config.executionRelaySecret;
    }
    return getPolymarketExecutionAdapterV2EnvStatus(envLike);
  }

  public async prepareOrder(leg: ExecutionLegV0): Promise<PreparedVenueOrder> {
    this.assertPreparedPathConfigured();
    const dryRunOrder = this.dryRunClient.buildPreparedDryRunEnvelope({
      clientOrderId: leg.executionLegId,
      venueMarketId: leg.venueMarketId,
      venueOutcomeId: leg.venueOutcomeId,
      side: leg.side,
      size: leg.size,
      price: leg.price
    }, this.now());
    if (dryRunOrder.blockers.length > 0) {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_V2_DRY_RUN_ORDER_INVALID",
        `Polymarket V2 dry-run order shape is invalid: ${dryRunOrder.blockers.join(", ")}.`
      );
    }
    return {
      venue: this.venue,
      clientOrderId: leg.executionLegId,
      payload: {
        venueMarketId: leg.venueMarketId,
        venueOutcomeId: leg.venueOutcomeId,
        side: leg.side,
        size: leg.size,
        price: leg.price,
        metadata: {
          adapter: "PolymarketExecutionAdapterV2",
          readinessState: this.status().readinessState,
          clobV2DryRun: dryRunOrder
        }
      }
    };
  }

  public async submitOrder(order: PreparedVenueOrder): Promise<VenueSubmitResult> {
    const status = this.status();
    if (status.readinessState === "NOT_CONFIGURED") {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_V2_NOT_CONFIGURED",
        `Polymarket V2 adapter is not configured for dry-run: ${status.missingDryRunEnv.join(", ")}.`
      );
    }
    if (!status.liveExecutionEnabled) {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_LIVE_EXECUTION_DISABLED",
        "POLYMARKET_LIVE_EXECUTION_ENABLED is false; dry-run orders cannot be submitted."
      );
    }
    if (status.readinessState !== "LIVE_READY") {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_V2_ENV_INCOMPLETE",
        `Polymarket V2 live execution env is incomplete: ${status.missingEnv.join(", ")}.`
      );
    }
    return this.liveClient.submitOrder(order);
  }

  public async fetchFillState(venueOrderId: string): Promise<VenueFillState> {
    if (!venueOrderId) {
      return {
        status: this.config.fillStateOverride ?? "FAILED",
        filledSize: "0",
        averagePrice: 0,
        offchainFilled: false
      };
    }
    if (!this.config.fillStateOverride) {
      return this.liveClient.fetchFillState(venueOrderId);
    }
    return {
      status: this.config.fillStateOverride,
      filledSize: "0",
      averagePrice: 0,
      offchainFilled: false
    };
  }

  public async cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }> {
    return this.liveClient.cancelOrder(venueOrderId);
  }

  public async fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState> {
    if (this.config.settlementStateOverride) {
      return {
        status: this.config.settlementStateOverride,
        evidence: { source: "polymarket_v2_test_override", fillOrOrderId }
      };
    }
    return this.liveClient.fetchSettlementState(fillOrOrderId);
  }

  public normalizeVenueError(error: unknown): NormalizedVenueError {
    if (error instanceof PolymarketExecutionNotConfiguredError) {
      return {
        code: error.reasonCode === "POLYMARKET_V2_LIVE_CLIENT_DISABLED"
          ? "VENUE_EXECUTION_NOT_CONFIGURED"
          : error.reasonCode === "POLYMARKET_LIVE_EXECUTION_DISABLED"
            ? "POLYMARKET_LIVE_EXECUTION_DISABLED"
          : error.reasonCode,
        message: error.message,
        retryable: false
      };
    }
    return normalizeLiveVenueErrorMessage(error, {
      venue: "POLYMARKET",
      fallbackCode: "POLYMARKET_V2_ADAPTER_ERROR",
      fallbackMessage: "Unknown Polymarket V2 adapter error."
    });
  }

  private assertPreparedPathConfigured(): void {
    const status = this.status();
    if (!status.featureFlagSelected) {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_V2_MODE_NOT_SELECTED",
        "POLYMARKET_EXECUTION_MODE must be v2 before Polymarket V2 execution can prepare orders."
      );
    }
    if (!status.dryRunRequiredEnvPresent) {
      throw new PolymarketExecutionNotConfiguredError(
        "POLYMARKET_V2_NOT_CONFIGURED",
        `Polymarket V2 dry-run env is incomplete: ${status.missingDryRunEnv.join(", ")}.`
      );
    }
  }
}
