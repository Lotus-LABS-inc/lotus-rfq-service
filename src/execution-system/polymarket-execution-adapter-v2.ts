import { createHash, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
  VenueOrderLookupContext,
  VenueSettlementState,
  VenueSubmitResult
} from "./venue-adapter.js";
import {
  createPolymarketRelayNonce,
  polymarketRelayHeaders,
  signPolymarketRelayRequest
} from "./polymarket-execution-relay-auth.js";
import { normalizeLiveVenueErrorMessage } from "./live-venue-error-normalizer.js";
import {
  PolymarketDataApiClient,
  normalizePolymarketDataApiSide,
  type PolymarketDataApiActivity
} from "../integrations/polymarket/polymarket-data-api-client.js";
import { withLatencyStageSync } from "../observability/latency.js";

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
  dataApiBaseUrl?: string | undefined;
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
  signatureType?: string | undefined;
  accountModel?: string | undefined;
  depositWalletEnabled?: boolean | undefined;
}

export interface PolymarketAdapterReadinessSnapshot {
  executionMode: string;
  liveExecutionEnabled: boolean;
  submitMode: "direct" | "relay";
  relayConfigured: boolean;
  requiredEnvPresent: boolean;
  dryRunRequiredEnvPresent: boolean;
  builderCodeConfigured: boolean;
  missingEnv: readonly string[];
  missingDryRunEnv: readonly PolymarketV2DryRunRequiredEnvKey[];
  signatureType?: string | undefined;
  accountModel?: string | undefined;
  depositWalletEnabled?: boolean | undefined;
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
  public constructor(
    public readonly reasonCode: string,
    message: string,
    public readonly diagnostics?: Record<string, unknown> | undefined
  ) {
    super(message);
    this.name = "PolymarketExecutionNotConfiguredError";
  }
}

const POLYMARKET_POSTORDER_REJECTION_DIAGNOSTIC_PATH =
  "artifacts/execution/polymarket-postorder-rejection-diagnostic.json";

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
  executionRelaySecret: env.POLYMARKET_EXECUTION_RELAY_SECRET,
  dataApiBaseUrl: env.POLYMARKET_DATA_API_BASE_URL
});

const polymarketConfigEnvLike = (config: PolymarketExecutionAdapterV2Config): NodeJS.ProcessEnv => {
  const envLike: NodeJS.ProcessEnv = {
    POLYMARKET_EXECUTION_MODE: config.executionMode,
    POLYMARKET_LIVE_EXECUTION_ENABLED: String(config.liveExecutionEnabled),
    POLYMARKET_CLOB_HOST: config.clobHost,
    POLYMARKET_CHAIN_ID: config.chainId,
    POLYMARKET_API_KEY: config.apiKey,
    POLYMARKET_API_SECRET: config.apiSecret,
    POLYMARKET_API_PASSPHRASE: config.apiPassphrase,
    POLYMARKET_BUILDER_CODE: config.builderCode,
    POLYMARKET_PRIVATE_KEY: config.privateKey
  };
  if (config.executionSubmitMode) {
    envLike.POLYMARKET_EXECUTION_SUBMIT_MODE = config.executionSubmitMode;
  }
  if (config.executionRelayUrl) {
    envLike.POLYMARKET_EXECUTION_RELAY_URL = config.executionRelayUrl;
  }
  if (config.executionRelaySecret) {
    envLike.POLYMARKET_EXECUTION_RELAY_SECRET = config.executionRelaySecret;
  }
  return envLike;
};

const normalizeConfiguredSignatureType = (value: string | undefined): string => {
  const parsed = parseSignatureType(value);
  if (parsed === SignatureTypeV2.EOA) return "EOA";
  if (parsed === SignatureTypeV2.POLY_GNOSIS_SAFE) return "POLY_GNOSIS_SAFE";
  if (parsed === SignatureTypeV2.POLY_1271) return "POLY_1271";
  return "POLY_PROXY";
};

const inferPolymarketAccountModel = (config: PolymarketExecutionAdapterV2Config): string => {
  if (nonEmpty(config.funderAddress)) {
    return "DEPOSIT_WALLET";
  }
  const signatureType = normalizeConfiguredSignatureType(config.signatureType);
  if (signatureType === "POLY_1271" || signatureType === "POLY_GNOSIS_SAFE") {
    return "CONTRACT_WALLET";
  }
  if (signatureType === "EOA") {
    return "EOA";
  }
  return "POLY_PROXY";
};

const buildPolymarketAdapterReadinessSnapshot = (
  config: PolymarketExecutionAdapterV2Config,
  status: PolymarketExecutionAdapterV2EnvStatus
): PolymarketAdapterReadinessSnapshot => {
  const signatureType = normalizeConfiguredSignatureType(config.signatureType);
  const depositWalletEnabled = nonEmpty(config.funderAddress);
  return {
    executionMode: status.executionMode,
    liveExecutionEnabled: status.liveExecutionEnabled,
    submitMode: status.submitMode,
    relayConfigured: status.relayConfigured,
    requiredEnvPresent: status.requiredEnvPresent,
    dryRunRequiredEnvPresent: status.dryRunRequiredEnvPresent,
    builderCodeConfigured: status.builderCodeConfigured,
    missingEnv: status.missingEnv,
    missingDryRunEnv: status.missingDryRunEnv,
    signatureType,
    accountModel: inferPolymarketAccountModel(config),
    depositWalletEnabled
  };
};

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
  fetchFillState(venueOrderId: string, context?: VenueOrderLookupContext): Promise<VenueFillState>;
  cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }>;
  fetchSettlementState(fillOrOrderId: string, context?: VenueOrderLookupContext): Promise<VenueSettlementState>;
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
  private readonly dataApiClient: PolymarketDataApiClient;

  public constructor(
    private readonly config: PolymarketExecutionAdapterV2Config,
    sdkFactory: PolymarketClobV2SdkFactory = createPolymarketClobV2SdkClient,
    private readonly balanceReader?: PolymarketSubmitBalanceReader | undefined,
    fetchImpl: typeof fetch = fetch
  ) {
    assertLiveClientConfig(config);
    this.sdkClient = sdkFactory(config);
    this.dataApiClient = new PolymarketDataApiClient({
      baseUrl: config.dataApiBaseUrl,
      fetchImpl
    });
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
      validatePolymarketSignedOrderShapeBeforeSubmit(order, signedOrder, this.config);
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
      const readinessEvidence = await this.assertSignedOrderHasSpendableBalanceAllowance(
        sdkClient,
        signedOrder,
        extraSensitiveValues,
        order
      );
      let response: unknown;
      try {
        response = await this.callSdkWithRedactedConsole(
          () => postOrder(signedOrder, OrderType.FOK),
          extraSensitiveValues
        );
      } catch (error) {
        throw await this.handlePostOrderRejection({
          error,
          order,
          signedOrder,
          authPayload,
          readinessEvidence,
          extraSensitiveValues
        });
      }
      const returnedFailure = buildPolymarketReturnedPostOrderFailure(response);
      if (returnedFailure) {
        throw await this.handlePostOrderRejection({
          error: returnedFailure,
          order,
          signedOrder,
          authPayload,
          readinessEvidence,
          extraSensitiveValues
        });
      }
      return mapPolymarketOrderResponse(response);
    }
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_USER_SIGNATURE_REQUIRED",
      "Polymarket live execution requires a user-signed CLOB order. Refresh the route and sign the order before submit."
    );
  }

  public async fetchFillState(venueOrderId: string, context?: VenueOrderLookupContext): Promise<VenueFillState> {
    const order = await this.callSdkSafely(() => this.sdkClient.getOrder(venueOrderId));
    if (order) {
      return mapPolymarketOpenOrderToFillState(order);
    }
    const trades = await this.callSdkSafely(() => this.sdkClient.getTrades({ id: venueOrderId }));
    const tradeState = mapPolymarketTradesToFillState(trades);
    if (tradeState.status !== "OPEN") {
      return tradeState;
    }
    const activity = await this.findDataApiTradeActivity(context, venueOrderId).catch(() => null);
    return activity ? mapPolymarketDataApiActivityToFillState(activity) : tradeState;
  }

  public async cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }> {
    const response = await this.callSdkSafely(() => this.sdkClient.cancelOrder({ orderID: venueOrderId }));
    return { cancelled: isPolymarketCancelSuccess(response) };
  }

  public async fetchSettlementState(fillOrOrderId: string, context?: VenueOrderLookupContext): Promise<VenueSettlementState> {
    const order = await this.callSdkSafely(() => this.sdkClient.getOrder(fillOrOrderId)).catch(() => null);
    const tradeId = order?.associate_trades?.[0] ?? fillOrOrderId;
    const trades = await this.callSdkSafely(() => this.sdkClient.getTrades({ id: tradeId }));
    const [trade] = trades;
    if (!trade) {
      const activity = await this.findDataApiTradeActivity(context, fillOrOrderId).catch(() => null);
      if (activity) {
        return mapPolymarketDataApiActivityToSettlementState(activity);
      }
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

  private async findDataApiTradeActivity(
    context: VenueOrderLookupContext | undefined,
    lookupId: string
  ): Promise<PolymarketDataApiActivity | null> {
    if (!context?.routeLeg?.venueMarketId || !context.routeLeg.venueOutcomeId) {
      return null;
    }
    const side = normalizePolymarketDataApiSide(context.route?.side);
    return await this.dataApiClient.findTradeActivity({
      proxyWallet: context.venueAccountAddress,
      conditionId: context.routeLeg.venueMarketId,
      assetId: context.routeLeg.venueOutcomeId,
      side,
      transactionHash: context.fillId ?? (isHexHash(lookupId) ? lookupId : null),
      submittedAt: context.submittedAt,
      limit: 100
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
    try {
      return await this.callSdkWithRedactedConsole(operation, extraSensitiveValues);
    } catch (error) {
      throw sanitizePolymarketSdkError(error, sensitiveValues);
    }
  }

  private async callSdkWithRedactedConsole<T>(
    operation: () => Promise<T>,
    extraSensitiveValues: readonly string[] = []
  ): Promise<T> {
    const sensitiveValues = [...this.sensitiveValues, ...extraSensitiveValues].filter((value): value is string => nonEmpty(value));
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      originalError(...args.map((arg) => redactPolymarketSdkLog(arg, sensitiveValues)));
    };
    try {
      return await operation();
    } finally {
      console.error = originalError;
    }
  }

  private async handlePostOrderRejection(input: {
    error: unknown;
    order: PreparedVenueOrder;
    signedOrder: SignedOrder;
    authPayload: PolymarketClobAuthPayload | null;
    readinessEvidence: PolymarketConfirmedReadinessEvidence | null;
    extraSensitiveValues: readonly string[];
  }): Promise<PolymarketExecutionNotConfiguredError> {
    const sensitiveValues = [...this.sensitiveValues, ...input.extraSensitiveValues]
      .filter((value): value is string => nonEmpty(value));
    const rawError = capturePolymarketRawPostOrderError(input.error, sensitiveValues);
    const classification = classifyPolymarketPostOrderRejection(
      rawError,
      Boolean(input.readinessEvidence)
    );
    const diagnostic = buildPolymarketPostOrderRejectionDiagnostic({
      config: this.config,
      order: input.order,
      signedOrder: input.signedOrder,
      authPayload: input.authPayload,
      readinessEvidence: input.readinessEvidence,
      rawError,
      classification
    });

    console.warn("[polymarket-postorder-rejection-diagnostic]", diagnostic);

    await writePolymarketPostOrderRejectionDiagnostic(diagnostic).catch((writeError: unknown) => {
      console.warn("[polymarket-postorder-diagnostic-write-failed]", {
        reason: redactStringValues(
          writeError instanceof Error ? writeError.message : String(writeError),
          sensitiveValues
        )
      });
    });

    if (input.readinessEvidence) {
      logPolymarketSubmitFailure({
        order: input.order,
        signedOrder: input.signedOrder,
        readinessEvidence: input.readinessEvidence,
        reasonCode: classification.code
      });
    }

    return new PolymarketExecutionNotConfiguredError(
      classification.code,
      classification.message,
      {
        diagnosticArtifact: POLYMARKET_POSTORDER_REJECTION_DIAGNOSTIC_PATH,
        rawVenueErrorCode: rawError.code ?? null,
        postOrderRejectionDiagnostic: diagnostic
      }
    );
  }

  private async assertSignedOrderHasSpendableBalanceAllowance(
    sdkClient: PolymarketClobV2SdkClient,
    signedOrder: SignedOrder,
    extraSensitiveValues: readonly string[],
    order: PreparedVenueOrder
  ): Promise<PolymarketConfirmedReadinessEvidence | null> {
    const required = requiredBalanceAllowanceForSignedOrder(signedOrder);
    if (required?.assetType === AssetType.CONDITIONAL) {
      await this.assertSignedOrderHasSpendableConditionalTokens(sdkClient, {
        tokenId: required.tokenId!,
        requiredAtomic: required.requiredAtomic
      }, extraSensitiveValues);
      return null;
    }
    const requiredAtomic = required?.requiredAtomic ?? null;
    if (requiredAtomic === null) {
      return null;
    }
    const userId = expectedBindingUserId(order);
    const attestation = parsePolymarketCollateralReadinessAttestation(order);
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
    const collateralParams = {
      asset_type: AssetType.COLLATERAL,
      signature_type: SignatureTypeV2.POLY_1271
    } as unknown as { asset_type: AssetType; token_id?: string };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (updateBalanceAllowance) {
        await this.callSdkSafely(
          () => updateBalanceAllowance(collateralParams),
          extraSensitiveValues
        );
      }
      const response = await this.callSdkSafely(
        () => getBalanceAllowance(collateralParams),
        extraSensitiveValues
      );
      ({ spendableAtomic, balanceAtomic, allowanceAtomic } = collateralSpendableAtomicUnits(response));
      if (spendableAtomic >= requiredAtomic) {
        return {
          source: "SDK_BALANCE_ALLOWANCE",
          requiredAtomic,
          sdkSpendableAtomic: spendableAtomic,
          sdkBalanceAtomic: balanceAtomic,
          sdkAllowanceAtomic: allowanceAtomic
        };
      }
      if (attempt < 2 && updateBalanceAllowance) {
        await delay(500);
      }
    }
    if (spendableAtomic < requiredAtomic) {
      const confirmedUserBalance = await this.readConfirmedUserClobSyncBalance(userId, requiredAtomic);
      const attestationEvidence = attestation && attestationCoversRequiredAtomic(attestation, requiredAtomic)
        ? attestation
        : null;
      const confirmedEvidence = confirmedUserBalance
        ? {
            source: "BACKEND_USER_CLOB_SYNC" as const,
            backendUsableAtomic: confirmedUserBalance.usableAtomic,
            usableBalanceSource: confirmedUserBalance.usableBalanceSource,
            approvalSpenderSource: confirmedUserBalance.approvalSpenderSource
          }
        : !userId && attestationEvidence
          ? {
              source: "SIGNED_BUNDLE_ATTESTATION" as const,
              backendUsableAtomic: attestationEvidence.usableAtomic,
              usableBalanceSource: attestationEvidence.usableBalanceSource,
              approvalSpenderSource: attestationEvidence.approvalSpenderSource,
              attestation: attestationEvidence
            }
          : null;
      if (
        !userId &&
        confirmedEvidence?.source === "SIGNED_BUNDLE_ATTESTATION" &&
        isPolymarketSubmitReadySource(confirmedEvidence.usableBalanceSource)
      ) {
        return {
          source: confirmedEvidence.source,
          requiredAtomic,
          sdkSpendableAtomic: spendableAtomic,
          sdkBalanceAtomic: balanceAtomic,
          sdkAllowanceAtomic: allowanceAtomic,
          backendUsableAtomic: confirmedEvidence.backendUsableAtomic,
          usableBalanceSource: confirmedEvidence.usableBalanceSource,
          approvalSpenderSource: confirmedEvidence.approvalSpenderSource,
          ...(confirmedEvidence.attestation ? { attestation: confirmedEvidence.attestation } : {})
        };
      }
      if (confirmedEvidence) {
        logPolymarketSubmitFailure({
          order,
          signedOrder,
          readinessEvidence: {
            source: confirmedEvidence.source,
            requiredAtomic,
            sdkSpendableAtomic: spendableAtomic,
            sdkBalanceAtomic: balanceAtomic,
            sdkAllowanceAtomic: allowanceAtomic,
            backendUsableAtomic: confirmedEvidence.backendUsableAtomic,
            usableBalanceSource: confirmedEvidence.usableBalanceSource,
            approvalSpenderSource: confirmedEvidence.approvalSpenderSource,
            ...(confirmedEvidence.attestation ? { attestation: confirmedEvidence.attestation } : {})
          },
          reasonCode: "POLYMARKET_CLOB_SYNC_PENDING_FOR_SUBMIT"
        });
        throw new PolymarketExecutionNotConfiguredError(
          "POLYMARKET_CLOB_SYNC_PENDING_FOR_SUBMIT",
          polymarketClobSyncPendingForSubmitMessage(
            spendableAtomic,
            requiredAtomic,
            balanceAtomic,
            allowanceAtomic
          )
        );
      }
      logPolymarketSubmitFailure({
        order,
        signedOrder,
        readinessEvidence: {
          source: "PRESUBMIT_BLOCKED",
          requiredAtomic,
          sdkSpendableAtomic: spendableAtomic,
          sdkBalanceAtomic: balanceAtomic,
          sdkAllowanceAtomic: allowanceAtomic,
          ...(attestation ? {
            backendUsableAtomic: attestation.usableAtomic,
            usableBalanceSource: attestation.usableBalanceSource,
            approvalSpenderSource: attestation.approvalSpenderSource,
            attestation
          } : {})
        },
        reasonCode: "POLYMARKET_CLOB_COLLATERAL_NOT_READY"
      });
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
    return null;
  }

  private async readConfirmedUserClobSyncBalance(
    userId: string | null,
    requiredAtomic: bigint
  ): Promise<{
    usableAtomic: bigint;
    usableBalanceSource: string;
    approvalSpenderSource: string;
  } | null> {
    if (!userId || !this.balanceReader) {
      return null;
    }
    try {
      const balance = await this.balanceReader.readUsableBalance({ userId });
      if (!isPolymarketReadinessEvidenceSource(balance.usableBalanceSource)) {
        return null;
      }
      const usableAtomic = parseCollateralDecimalToAtomicUnits(balance.usableBalance, "usableBalance");
      return usableAtomic >= requiredAtomic
        ? {
            usableAtomic,
            usableBalanceSource: balance.usableBalanceSource,
            approvalSpenderSource: balance.approvalSpenderSource
          }
        : null;
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
  private readonly config: PolymarketExecutionAdapterV2Config;

  public constructor(config: {
    relayUrl: string;
    relaySecret: string;
    fetchImpl?: typeof fetch | undefined;
    polymarketConfig?: PolymarketExecutionAdapterV2Config | undefined;
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
    this.config = config.polymarketConfig ?? {
      executionMode: "v2",
      liveExecutionEnabled: true,
      executionSubmitMode: "relay"
    };
  }

  public async submitOrder(order: PreparedVenueOrder): Promise<VenueSubmitResult> {
    const signedOrder = safeParseUserSignedPolymarketOrder(order);
    if (signedOrder) {
      validatePolymarketSignedOrderShapeBeforeSubmit(order, signedOrder, this.config);
    }
    return await this.post<VenueSubmitResult>("/internal/polymarket/v2/submit-order", { order });
  }

  public fetchFillState(venueOrderId: string, context?: VenueOrderLookupContext): Promise<VenueFillState> {
    return this.post<VenueFillState>("/internal/polymarket/v2/fill-state", { venueOrderId, context });
  }

  public cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }> {
    return this.post<{ cancelled: boolean }>("/internal/polymarket/v2/cancel-order", { venueOrderId });
  }

  public fetchSettlementState(fillOrOrderId: string, context?: VenueOrderLookupContext): Promise<VenueSettlementState> {
    return this.post<VenueSettlementState>("/internal/polymarket/v2/settlement-state", { fillOrOrderId, context });
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
      const relayCode = isRecord(payload) && typeof payload.code === "string" ? payload.code : null;
      const normalized = normalizeLiveVenueErrorMessage(message, {
        venue: "POLYMARKET",
        fallbackCode: response.status === 401 || response.status === 403
          ? "POLYMARKET_V2_RELAY_UNAUTHORIZED"
          : "POLYMARKET_V2_RELAY_ERROR",
        fallbackMessage: message
      });
      const forwardedPostOrderDiagnostic = extractForwardedPolymarketPostOrderDiagnostic(payload);
      if (path === "/internal/polymarket/v2/submit-order") {
        await this.captureRelayPostOrderRejection({
          body,
          payload,
          httpStatus: response.status,
          normalizedCode: normalized.code,
          normalizedMessage: normalized.message
        });
      }
      const relayDiagnosticCode = forwardedPostOrderDiagnostic &&
        typeof forwardedPostOrderDiagnostic.normalizedReasonCode === "string" &&
        isPolymarketPostOrderRejectionCode(forwardedPostOrderDiagnostic.normalizedReasonCode)
        ? forwardedPostOrderDiagnostic.normalizedReasonCode
        : null;
      const relayDiagnosticMessage = forwardedPostOrderDiagnostic &&
        typeof forwardedPostOrderDiagnostic.normalizedReason === "string"
        ? forwardedPostOrderDiagnostic.normalizedReason
        : null;
      const relayRawVenueErrorCode = forwardedPostOrderDiagnostic &&
        typeof forwardedPostOrderDiagnostic.rawVenueErrorCode === "string"
        ? forwardedPostOrderDiagnostic.rawVenueErrorCode
        : null;
      if (relayDiagnosticCode) {
        throw new PolymarketExecutionNotConfiguredError(
          relayDiagnosticCode,
          relayDiagnosticMessage ?? polymarketPostOrderRejectionMessages[relayDiagnosticCode],
          {
            diagnosticArtifact: POLYMARKET_POSTORDER_REJECTION_DIAGNOSTIC_PATH,
            rawVenueErrorCode: relayRawVenueErrorCode
          }
        );
      }
      if (
        path === "/internal/polymarket/v2/submit-order" &&
        (relayCode === "POLYMARKET_CLOB_COLLATERAL_NOT_READY" || normalized.code === "POLYMARKET_CLOB_COLLATERAL_NOT_READY") &&
        relaySubmitHasConfirmedReadinessAttestation(body)
      ) {
        throw new PolymarketExecutionNotConfiguredError(
          "POLYMARKET_CLOB_SYNC_REJECTED_BY_VENUE",
          "Polymarket rejected this order even though live CLOB collateral readiness was confirmed. Lotus will recheck readiness automatically; retry after Polymarket propagation completes."
        );
      }
      throw new PolymarketExecutionNotConfiguredError(
        normalized.code,
        normalized.message
      );
    }
    return payload as T;
  }

  private async captureRelayPostOrderRejection(input: {
    body: Record<string, unknown>;
    payload: unknown;
    httpStatus: number;
    normalizedCode: string;
    normalizedMessage: string;
  }): Promise<Record<string, unknown> | null> {
    const forwardedDiagnostic = extractForwardedPolymarketPostOrderDiagnostic(input.payload);
    const diagnostic = forwardedDiagnostic ?? this.buildRelayPostOrderRejectionDiagnostic(input);
    if (!diagnostic) {
      return null;
    }
    console.warn("[polymarket-postorder-rejection-diagnostic]", diagnostic);
    await writePolymarketPostOrderRejectionDiagnostic(diagnostic).catch((writeError: unknown) => {
      console.warn("[polymarket-postorder-diagnostic-write-failed]", {
        reason: redactStringValues(
          writeError instanceof Error ? writeError.message : String(writeError),
          [this.secret].filter((value): value is string => nonEmpty(value))
        )
      });
    });
    return diagnostic;
  }

  private buildRelayPostOrderRejectionDiagnostic(input: {
    body: Record<string, unknown>;
    payload: unknown;
    httpStatus: number;
    normalizedCode: string;
    normalizedMessage: string;
  }): Record<string, unknown> | null {
    const order = parseRelayPreparedPolymarketOrder(input.body);
    if (!order) {
      return null;
    }
    const sensitiveValues = [this.secret].filter((value): value is string => nonEmpty(value));
    const rawError = capturePolymarketRawPostOrderError({
      status: input.httpStatus,
      statusCode: input.httpStatus,
      body: input.payload,
      data: input.payload
    }, sensitiveValues);
    const hasConfirmedReadinessEvidence = relaySubmitHasConfirmedReadinessAttestation(input.body);
    const classification = classifyPolymarketPostOrderRejection(rawError, hasConfirmedReadinessEvidence);
    const signedOrder = safeParseUserSignedPolymarketOrder(order);
    if (!signedOrder) {
      return {
        quoteId: optionalString(order.payload.quoteId) ?? null,
        executionId: optionalString(order.payload.executionId)
          ?? optionalString(order.payload.parentExecutionId)
          ?? order.clientOrderId,
        submitTimestamp: new Date().toISOString(),
        httpStatus: input.httpStatus,
        polymarketApiStatus: rawError.polymarketApiStatus ?? null,
        rawVenueErrorCode: rawError.code ?? null,
        rawVenueErrorMessage: rawError.message ?? null,
        rawResponseBodyRedacted: rawError.body ?? null,
        normalizedReasonCode: input.normalizedCode,
        normalizedReason: input.normalizedMessage,
        relayDiagnosticOnly: true
      };
    }
    return buildPolymarketPostOrderRejectionDiagnostic({
      config: this.config,
      order,
      signedOrder,
      authPayload: safeParsePolymarketClobAuthPayload(order),
      readinessEvidence: null,
      rawError,
      classification
    });
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

const safeParseUserSignedPolymarketOrder = (order: PreparedVenueOrder): SignedOrder | null => {
  try {
    return parseUserSignedPolymarketOrder(order);
  } catch {
    return null;
  }
};

const validatePolymarketSignedOrderShapeBeforeSubmit = (
  order: PreparedVenueOrder,
  signedOrder: SignedOrder,
  config: PolymarketExecutionAdapterV2Config
): void => {
  const prepared = parsePreparedPolymarketPayload(order);
  const signedRecord = signedOrder as unknown as Record<string, unknown>;
  if (String(signedRecord.tokenId ?? "") !== prepared.venueOutcomeId) {
    throwPolymarketOrderParamsRejected();
  }
  const signedSide = normalizePolymarketSignedOrderSide(signedRecord.side);
  if (!signedSide || signedSide !== prepared.side) {
    throwPolymarketOrderParamsRejected();
  }
  const normalizedSignedSide = prepared.side;
  const orderMetadata = polymarketOrderExecutionMetadata(order);
  const tickSize = orderMetadata.tickSize ?? config.tickSize;
  if (!tickSize || !hasLotusPreparedPolymarketShape(order)) {
    validatePositivePolymarketSignedAmounts(signedRecord);
    return;
  }
  validatePolymarketTickAlignedAmounts(signedRecord, normalizedSignedSide, tickSize);
};

const hasLotusPreparedPolymarketShape = (order: PreparedVenueOrder): boolean => {
  const metadata = isRecord(order.payload.metadata) ? order.payload.metadata : null;
  return Boolean(metadata && isRecord(metadata.clobV2DryRun));
};

const polymarketOrderExecutionMetadata = (order: PreparedVenueOrder): {
  tickSize?: TickSize | undefined;
  negRisk?: boolean | undefined;
} => {
  const metadata = isRecord(order.payload.metadata) ? order.payload.metadata : {};
  const tickSize = parseTickSize(
    optionalString(metadata.polymarketTickSize)
      ?? optionalString(metadata.tickSize)
      ?? undefined
  );
  const negRisk = parseOptionalBooleanValue(metadata.polymarketNegRisk ?? metadata.negRisk);
  return {
    ...(tickSize ? { tickSize } : {}),
    ...(negRisk !== undefined ? { negRisk } : {})
  };
};

const validatePositivePolymarketSignedAmounts = (signedRecord: Record<string, unknown>): {
  makerAmount: bigint;
  takerAmount: bigint;
} => {
  const makerAmount = parseNonNegativeAtomicUnits(signedRecord.makerAmount, "makerAmount");
  const takerAmount = parseNonNegativeAtomicUnits(signedRecord.takerAmount, "takerAmount");
  if (makerAmount <= 0n || takerAmount <= 0n) {
    throwPolymarketOrderParamsRejected();
  }
  return { makerAmount, takerAmount };
};

const validatePolymarketTickAlignedAmounts = (
  signedRecord: Record<string, unknown>,
  signedSide: "buy" | "sell",
  tickSize: TickSize
): void => {
  const { makerAmount, takerAmount } = validatePositivePolymarketSignedAmounts(signedRecord);
  const collateralAtomic = signedSide === "buy" ? makerAmount : takerAmount;
  const shareAtomic = signedSide === "buy" ? takerAmount : makerAmount;
  const tickCount = new Decimal(collateralAtomic.toString())
    .div(new Decimal(shareAtomic.toString()))
    .div(new Decimal(tickSize));
  if (!tickCount.isInteger()) {
    throwPolymarketOrderParamsRejected();
  }
};

const normalizePolymarketSignedOrderSide = (value: unknown): "buy" | "sell" | null => {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "BUY" || normalized === "0") {
    return "buy";
  }
  if (normalized === "SELL" || normalized === "1") {
    return "sell";
  }
  return null;
};

const throwPolymarketOrderParamsRejected = (): never => {
  throw new PolymarketExecutionNotConfiguredError(
    "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED",
    "Price moved before execution. Refresh route and retry."
  );
};

const parseRelayPreparedPolymarketOrder = (body: Record<string, unknown>): PreparedVenueOrder | null => {
  const order = isRecord(body.order) ? body.order : null;
  if (
    !order ||
    order.venue !== "POLYMARKET" ||
    typeof order.clientOrderId !== "string" ||
    !isRecord(order.payload)
  ) {
    return null;
  }
  return {
    venue: "POLYMARKET",
    clientOrderId: order.clientOrderId,
    payload: order.payload
  };
};

const expectedBindingUserId = (order: PreparedVenueOrder): string | null => {
  const expectedBinding = isRecord(order.payload.expectedBinding) ? order.payload.expectedBinding : null;
  const userId = expectedBinding && typeof expectedBinding.userId === "string"
    ? expectedBinding.userId.trim()
    : "";
  return userId.length > 0 ? userId : null;
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

const parseCollateralDecimalToAtomicUnits = (value: unknown, fieldName: string): bigint => {
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
      `Polymarket CLOB balance fallback included an invalid ${fieldName}.`
    );
  }
  try {
    const parsed = new Decimal(normalized);
    if (!parsed.isFinite() || parsed.isNegative()) {
      throw new Error("invalid decimal amount");
    }
    return BigInt(parsed
      .times(new Decimal(10).pow(COLLATERAL_TOKEN_DECIMALS))
      .toDecimalPlaces(0, Decimal.ROUND_DOWN)
      .toFixed(0));
  } catch {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_CLOB_BALANCE_PAYLOAD_INVALID",
      `Polymarket CLOB balance fallback included an invalid ${fieldName}.`
    );
  }
};

const isPolymarketSubmitReadySource = (source: string | null | undefined): boolean =>
  source === "CLOB_COLLATERAL_ALLOWANCE" || source === "USER_CLOB_SYNC_CONFIRMED";

const isPolymarketReadinessEvidenceSource = (source: string | null | undefined): boolean =>
  isPolymarketSubmitReadySource(source);

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

interface PolymarketCollateralReadinessAttestation {
  quoteId: string | null;
  legIndex: number | null;
  checkedAt: string | null;
  requiredAtomic: bigint;
  requiredNotional: string | null;
  usableAtomic: bigint;
  usableBalance: string | null;
  usableBalanceSource: string;
  approvalSpenderSource: string | null;
  walletAddress: string | null;
  ownerAddress: string | null;
  venueAccountAddress: string | null;
}

interface PolymarketConfirmedReadinessEvidence {
  source: "SDK_BALANCE_ALLOWANCE" | "BACKEND_USER_CLOB_SYNC" | "SIGNED_BUNDLE_ATTESTATION" | "PRESUBMIT_BLOCKED";
  requiredAtomic: bigint;
  sdkSpendableAtomic: bigint;
  sdkBalanceAtomic: bigint;
  sdkAllowanceAtomic: bigint;
  backendUsableAtomic?: bigint | undefined;
  usableBalanceSource?: string | undefined;
  approvalSpenderSource?: string | null | undefined;
  attestation?: PolymarketCollateralReadinessAttestation | undefined;
}

const polymarketClobSyncPendingForSubmitMessage = (
  spendableAtomic: bigint,
  requiredAtomic: bigint,
  balanceAtomic: bigint,
  allowanceAtomic: bigint
): string => [
  "Polymarket CLOB sync is confirmed locally, but the same live CLOB submit client does not report enough spendable collateral yet.",
  "Lotus will keep checking readiness automatically; no new CLOB sync is required.",
  `Live spendable balance: ${formatCollateralAtomicUnits(spendableAtomic)} USDC.`,
  `Required: ${formatCollateralAtomicUnits(requiredAtomic)} USDC.`,
  `Live CLOB balance: ${formatCollateralAtomicUnits(balanceAtomic)} USDC.`,
  `Live CLOB allowance: ${formatCollateralAtomicUnits(allowanceAtomic)} USDC.`
].join(" ");

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const parseOptionalBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
};

const optionalNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePolymarketCollateralReadinessAttestation = (
  order: PreparedVenueOrder
): PolymarketCollateralReadinessAttestation | null => {
  const payload = isRecord(order.payload.polymarketCollateralReadinessAttestation)
    ? order.payload.polymarketCollateralReadinessAttestation
    : null;
  if (!payload || payload.kind !== "POLYMARKET_CLOB_COLLATERAL_PREFLIGHT") {
    return null;
  }
  const usableBalanceSource = optionalString(payload.usableBalanceSource);
  if (!usableBalanceSource || !isPolymarketReadinessEvidenceSource(usableBalanceSource)) {
    return null;
  }
  const usableBalance = optionalString(payload.usableBalance);
  if (!usableBalance) {
    return null;
  }
  try {
    return {
      quoteId: optionalString(payload.quoteId),
      legIndex: optionalNumber(payload.legIndex),
      checkedAt: optionalString(payload.checkedAt),
      requiredAtomic: parseNonNegativeAtomicUnits(payload.requiredAtomic, "readinessRequiredAtomic"),
      requiredNotional: optionalString(payload.requiredNotional),
      usableAtomic: parseCollateralDecimalToAtomicUnits(usableBalance, "readinessUsableBalance"),
      usableBalance,
      usableBalanceSource,
      approvalSpenderSource: optionalString(payload.approvalSpenderSource),
      walletAddress: optionalString(payload.walletAddress),
      ownerAddress: optionalString(payload.ownerAddress),
      venueAccountAddress: optionalString(payload.venueAccountAddress)
    };
  } catch {
    return null;
  }
};

const attestationCoversRequiredAtomic = (
  attestation: PolymarketCollateralReadinessAttestation,
  requiredAtomic: bigint
): boolean => {
  if (!isPolymarketReadinessEvidenceSource(attestation.usableBalanceSource)) {
    return false;
  }
  if (attestation.requiredAtomic < requiredAtomic || attestation.usableAtomic < requiredAtomic) {
    return false;
  }
  if (!attestation.checkedAt) {
    return false;
  }
  const checkedAtMs = Date.parse(attestation.checkedAt);
  if (!Number.isFinite(checkedAtMs)) {
    return false;
  }
  const now = Date.now();
  return checkedAtMs <= now + 30_000 && now - checkedAtMs <= 5 * 60_000;
};

const relaySubmitHasConfirmedReadinessAttestation = (body: Record<string, unknown>): boolean => {
  const order = isRecord(body.order) ? body.order : null;
  const payload = order && isRecord(order.payload) ? order.payload : null;
  if (!order || !payload) {
    return false;
  }
  const attestation = parsePolymarketCollateralReadinessAttestation({
    venue: "POLYMARKET",
    clientOrderId: typeof order.clientOrderId === "string" ? order.clientOrderId : "relay-submit",
    payload
  });
  return Boolean(attestation && attestationCoversRequiredAtomic(attestation, attestation.requiredAtomic));
};

const formatAtomicForLog = (value: bigint | undefined): string | undefined =>
  value === undefined ? undefined : value.toString();

const logPolymarketSubmitFailure = (input: {
  order: PreparedVenueOrder;
  signedOrder: SignedOrder;
  readinessEvidence: PolymarketConfirmedReadinessEvidence;
  reasonCode: string;
}): void => {
  const signedRecord = input.signedOrder as unknown as Record<string, unknown>;
  const expectedBinding = isRecord(input.order.payload.expectedBinding) ? input.order.payload.expectedBinding : {};
  console.warn("[polymarket-submit-failure]", {
    reasonCode: input.reasonCode,
    legIndex: typeof input.order.payload.legIndex === "number" ? input.order.payload.legIndex : input.readinessEvidence.attestation?.legIndex ?? null,
    maker: redact(optionalString(signedRecord.maker) ?? undefined),
    signer: redact(optionalString(signedRecord.signer) ?? undefined),
    expectedBindingUserId: redact(optionalString(expectedBinding.userId) ?? undefined),
    expectedBindingAccount: redact(optionalString(expectedBinding.account) ?? optionalString(expectedBinding.venueAccountAddress) ?? undefined),
    readinessSource: input.readinessEvidence.source,
    requiredAtomic: formatAtomicForLog(input.readinessEvidence.requiredAtomic),
    sdkSpendableAtomic: formatAtomicForLog(input.readinessEvidence.sdkSpendableAtomic),
    sdkBalanceAtomic: formatAtomicForLog(input.readinessEvidence.sdkBalanceAtomic),
    sdkAllowanceAtomic: formatAtomicForLog(input.readinessEvidence.sdkAllowanceAtomic),
    backendUsableAtomic: formatAtomicForLog(input.readinessEvidence.backendUsableAtomic),
    usableBalanceSource: input.readinessEvidence.usableBalanceSource,
    approvalSpenderSource: input.readinessEvidence.approvalSpenderSource,
    attestation: input.readinessEvidence.attestation
      ? {
          quoteId: input.readinessEvidence.attestation.quoteId,
          legIndex: input.readinessEvidence.attestation.legIndex,
          checkedAt: input.readinessEvidence.attestation.checkedAt,
          requiredAtomic: formatAtomicForLog(input.readinessEvidence.attestation.requiredAtomic),
          requiredNotional: input.readinessEvidence.attestation.requiredNotional,
          usableBalance: input.readinessEvidence.attestation.usableBalance,
          usableBalanceSource: input.readinessEvidence.attestation.usableBalanceSource,
          approvalSpenderSource: input.readinessEvidence.attestation.approvalSpenderSource,
          walletAddress: redact(input.readinessEvidence.attestation.walletAddress ?? undefined),
          ownerAddress: redact(input.readinessEvidence.attestation.ownerAddress ?? undefined),
          venueAccountAddress: redact(input.readinessEvidence.attestation.venueAccountAddress ?? undefined)
        }
      : undefined
  });
};

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

const safeParsePolymarketClobAuthPayload = (order: PreparedVenueOrder): PolymarketClobAuthPayload | null => {
  try {
    return parsePolymarketClobAuthPayload(order);
  } catch {
    return null;
  }
};

type PolymarketPostOrderRejectionCode =
  | "POLYMARKET_CLOB_SYNC_REJECTED_BY_VENUE"
  | "POLYMARKET_CLOB_COLLATERAL_NOT_READY"
  | "POLYMARKET_CLOB_SIGNATURE_REJECTED"
  | "POLYMARKET_CLOB_AUTH_REJECTED"
  | "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED"
  | "POLYMARKET_CLOB_MARKET_REJECTED"
  | "POLYMARKET_CLOB_UNKNOWN_REJECTED_BY_VENUE";

interface PolymarketRawPostOrderError {
  httpStatus?: number | undefined;
  polymarketApiStatus?: string | undefined;
  code?: string | undefined;
  message?: string | undefined;
  body?: unknown;
  searchText: string;
}

interface PolymarketPostOrderClassification {
  code: PolymarketPostOrderRejectionCode;
  message: string;
}

const polymarketPostOrderRejectionMessages = {
  POLYMARKET_CLOB_SYNC_REJECTED_BY_VENUE:
    "Polymarket rejected this order with a collateral or sync response even though live CLOB collateral readiness was confirmed. Lotus preserved the raw redacted venue evidence for debugging.",
  POLYMARKET_CLOB_COLLATERAL_NOT_READY:
    "Polymarket CLOB collateral is not ready for this order. Refresh balances, activate or approve Polymarket funds, then retry.",
  POLYMARKET_CLOB_SIGNATURE_REJECTED:
    "Polymarket rejected the signed CLOB order signature. Refresh the route and sign again.",
  POLYMARKET_CLOB_AUTH_REJECTED:
    "Polymarket rejected CLOB authentication for this submit. Refresh venue authentication and retry.",
  POLYMARKET_CLOB_ORDER_PARAMS_REJECTED:
    "Price moved before execution. Refresh route and retry.",
  POLYMARKET_CLOB_MARKET_REJECTED:
    "Polymarket rejected this market or outcome for live submit. Refresh the market route before retrying.",
  POLYMARKET_CLOB_UNKNOWN_REJECTED_BY_VENUE:
    "Polymarket rejected this order for an unknown venue reason. Raw redacted evidence was captured for debugging."
} as const satisfies Record<PolymarketPostOrderRejectionCode, string>;

const isPolymarketPostOrderRejectionCode = (value: string): value is PolymarketPostOrderRejectionCode =>
  Object.prototype.hasOwnProperty.call(polymarketPostOrderRejectionMessages, value);

const diagnosticSecretKeyPattern =
  /api[_-]?key|secret|passphrase|private[_-]?key|authorization|cookie|signature|poly_signature|auth|headers/i;
const diagnosticTokenKeyPattern = /token[_-]?id|asset[_-]?id|condition[_-]?id|outcome[_-]?id/i;
const fullDecimalTokenIdPattern = /^\d{24,}$/;

const hashRedactedValue = (value: string, redacted: string): { sha256: string; redacted: string } => ({
  sha256: sha256Hex(value),
  redacted
});

const sanitizeDiagnosticString = (value: string, sensitiveValues: readonly string[]): string =>
  redactStringValues(value, sensitiveValues)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/(authorization|cookie|api[_-]?key|secret|passphrase|private[_-]?key|signature|poly_signature)\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=<redacted>")
    .replace(/\b\d{24,}\b/g, (match) => `<token-id-redacted:${sha256Hex(match).slice(0, 12)}>`)
    .replace(/0x[a-fA-F0-9]{40}/g, (match) => `${match.slice(0, 6)}...${match.slice(-4)}`);

const redactDiagnosticValue = (
  value: unknown,
  sensitiveValues: readonly string[],
  key = ""
): unknown => {
  if (diagnosticSecretKeyPattern.test(key)) {
    return "<redacted>";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (diagnosticTokenKeyPattern.test(key) && fullDecimalTokenIdPattern.test(trimmed)) {
      return hashRedactedValue(trimmed, "<token-id-redacted>");
    }
    return sanitizeDiagnosticString(value, sensitiveValues);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticValue(entry, sensitiveValues, key));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => entryKey.toLowerCase() !== "stack")
        .map(([entryKey, entryValue]) => [
          entryKey,
          redactDiagnosticValue(entryValue, sensitiveValues, entryKey)
        ])
    );
  }
  return sanitizeDiagnosticString(String(value), sensitiveValues);
};

const diagnosticStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, (_key, entry) =>
      typeof entry === "bigint" ? entry.toString() : entry
    ) ?? "";
  } catch {
    return String(value);
  }
};

const omitDiagnosticSecretKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(omitDiagnosticSecretKeys);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => !diagnosticSecretKeyPattern.test(entryKey))
        .map(([entryKey, entryValue]) => [entryKey, omitDiagnosticSecretKeys(entryValue)])
    );
  }
  return value;
};

const firstRecord = (...values: unknown[]): Record<string, unknown> | null =>
  values.find((value): value is Record<string, unknown> => isRecord(value)) ?? null;

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
};

const firstNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const buildPolymarketReturnedPostOrderFailure = (response: unknown): Record<string, unknown> | null => {
  if (!isRecord(response)) {
    return null;
  }
  const apiStatus = `${response.status ?? response.status_code ?? response.state ?? ""}`.trim().toUpperCase();
  const successValue = response.success ?? response.ok;
  const failed =
    apiStatus === "FAILED" ||
    apiStatus === "FAILURE" ||
    apiStatus === "REJECTED" ||
    apiStatus === "ERROR" ||
    successValue === false;
  if (!failed) {
    return null;
  }
  return {
    status: firstNumber(response.httpStatus, response.http_status, response.statusCode),
    body: response,
    data: response,
    code: firstString(response.code, response.errorCode, response.reasonCode),
    message: firstString(
      response.message,
      response.error,
      response.errorMessage,
      response.reason,
      response.msg
    )
  };
};

const capturePolymarketRawPostOrderError = (
  error: unknown,
  sensitiveValues: readonly string[]
): PolymarketRawPostOrderError => {
  const errorRecord = isRecord(error) ? error : {};
  const response = firstRecord(errorRecord.response, errorRecord.res);
  const responseData = response?.data ?? response?.body;
  const body = responseData ?? errorRecord.body ?? errorRecord.data ?? {
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error),
    code: errorRecord.code,
    status: errorRecord.status ?? response?.status
  };
  const redactedBody = redactDiagnosticValue(body, sensitiveValues);
  const rawMessage = firstString(
    error instanceof Error ? error.message : undefined,
    isRecord(responseData) ? responseData.message ?? responseData.error : undefined,
    isRecord(responseData) ? responseData.errorMessage ?? responseData.reason ?? responseData.msg : undefined,
    isRecord(errorRecord.body) ? errorRecord.body.message ?? errorRecord.body.error : undefined,
    isRecord(errorRecord.body) ? errorRecord.body.errorMessage ?? errorRecord.body.reason ?? errorRecord.body.msg : undefined
  );
  const rawCode = firstString(
    errorRecord.code,
    errorRecord.errorCode,
    isRecord(responseData) ? responseData.code ?? responseData.errorCode : undefined,
    isRecord(responseData) ? responseData.reasonCode : undefined,
    isRecord(errorRecord.body) ? errorRecord.body.code ?? errorRecord.body.errorCode : undefined,
    isRecord(errorRecord.body) ? errorRecord.body.reasonCode : undefined
  );
  const httpStatus = firstNumber(errorRecord.status, errorRecord.statusCode, response?.status, response?.statusCode);
  const polymarketApiStatus = firstString(
    isRecord(responseData) ? responseData.status ?? responseData.status_code : undefined,
    isRecord(errorRecord.body) ? errorRecord.body.status ?? errorRecord.body.status_code : undefined
  );
  const code = rawCode ? sanitizeDiagnosticString(rawCode, sensitiveValues) : undefined;
  const message = rawMessage ? sanitizeDiagnosticString(rawMessage, sensitiveValues) : undefined;
  return {
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(polymarketApiStatus ? { polymarketApiStatus: sanitizeDiagnosticString(polymarketApiStatus, sensitiveValues) } : {}),
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    body: redactedBody,
    searchText: [
      rawCode,
      rawMessage,
      diagnosticStringify(omitDiagnosticSecretKeys(body)),
      httpStatus
    ].filter((value) => value !== undefined && value !== null).join(" ").toLowerCase()
  };
};

const classifyPolymarketPostOrderRejection = (
  rawError: PolymarketRawPostOrderError,
  hasConfirmedReadinessEvidence: boolean
): PolymarketPostOrderClassification => {
  const text = rawError.searchText;
  const collateralPattern = /balance|allowance|collateral|spendable|insufficient\s+(funds|balance)|not\s+enough|sync|funding/;
  const signaturePattern = /signature|signer|eip-?712|1271|invalid\s+sig|isvalidsignature/;
  const authPattern = /unauthorized|forbidden|api\s*key|hmac|credential|auth|401|403/;
  const orderParamsPattern = /invalid\s+order|maker\s*amount|taker\s*amount|tick\s*size|price|size|side|expiration|expired|fok|gtc|min(?:imum)?\s+size/;
  const marketPattern = /market|token\s*id|asset\s*id|closed|disabled|invalid\s+outcome|outcome/;
  const code: PolymarketPostOrderRejectionCode = collateralPattern.test(text)
    ? hasConfirmedReadinessEvidence
      ? "POLYMARKET_CLOB_SYNC_REJECTED_BY_VENUE"
      : "POLYMARKET_CLOB_COLLATERAL_NOT_READY"
    : signaturePattern.test(text)
      ? "POLYMARKET_CLOB_SIGNATURE_REJECTED"
      : authPattern.test(text)
        ? "POLYMARKET_CLOB_AUTH_REJECTED"
        : orderParamsPattern.test(text)
          ? "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED"
          : marketPattern.test(text)
            ? "POLYMARKET_CLOB_MARKET_REJECTED"
            : "POLYMARKET_CLOB_UNKNOWN_REJECTED_BY_VENUE";
  return {
    code,
    message: polymarketPostOrderRejectionMessages[code]
  };
};

const normalizeAddress = (value: string | null | undefined): string | null =>
  value && /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : null;

const equalsAddress = (left: string | null | undefined, right: string | null | undefined): boolean =>
  normalizeAddress(left) !== null && normalizeAddress(left) === normalizeAddress(right);

const signatureTypeLabel = (value: SignatureTypeV2 | number | null): string | null => {
  if (value === null) return null;
  if (Number(value) === Number(SignatureTypeV2.EOA)) return "EOA";
  if (Number(value) === Number(SignatureTypeV2.POLY_GNOSIS_SAFE)) return "POLY_GNOSIS_SAFE";
  if (Number(value) === Number(SignatureTypeV2.POLY_1271)) return "POLY_1271";
  if (Number(value) === Number(SignatureTypeV2.POLY_PROXY)) return "POLY_PROXY";
  return String(value);
};

const buildPolymarketPostOrderRejectionDiagnostic = (input: {
  config: PolymarketExecutionAdapterV2Config;
  order: PreparedVenueOrder;
  signedOrder: SignedOrder;
  authPayload: PolymarketClobAuthPayload | null;
  readinessEvidence: PolymarketConfirmedReadinessEvidence | null;
  rawError: PolymarketRawPostOrderError;
  classification: PolymarketPostOrderClassification;
}): Record<string, unknown> => {
  const signedRecord = input.signedOrder as unknown as Record<string, unknown>;
  const attestation = input.readinessEvidence?.attestation ?? parsePolymarketCollateralReadinessAttestation(input.order);
  const maker = optionalString(signedRecord.maker);
  const signer = optionalString(signedRecord.signer);
  const funder = input.authPayload?.funderAddress ?? input.config.funderAddress ?? attestation?.venueAccountAddress ?? null;
  const depositWallet = funder ?? attestation?.venueAccountAddress ?? attestation?.ownerAddress ?? maker;
  const required = requiredBalanceAllowanceForSignedOrder(input.signedOrder);
  const constructorSignatureType = signatureTypeForSignedOrder(input.signedOrder) ?? parseSignatureType(input.config.signatureType);
  const orderMetadata = polymarketOrderExecutionMetadata(input.order);
  return {
    quoteId: attestation?.quoteId ?? optionalString(input.order.payload.quoteId) ?? null,
    executionId: optionalString(input.order.payload.executionId)
      ?? optionalString(input.order.payload.parentExecutionId)
      ?? input.order.clientOrderId,
    submitTimestamp: new Date().toISOString(),
    httpStatus: input.rawError.httpStatus ?? null,
    polymarketApiStatus: input.rawError.polymarketApiStatus ?? null,
    rawVenueErrorCode: input.rawError.code ?? null,
    rawVenueErrorMessage: input.rawError.message ?? null,
    rawResponseBodyRedacted: input.rawError.body ?? null,
    normalizedReasonCode: input.classification.code,
    normalizedReason: input.classification.message,
    signedOrderSummary: {
      signatureType: signatureTypeLabel(signatureTypeForSignedOrder(input.signedOrder) ?? Number(signedRecord.signatureType)),
      makerEqualsDepositWallet: equalsAddress(maker, depositWallet),
      signerEqualsDepositWallet: equalsAddress(signer, depositWallet),
      funderEqualsDepositWallet: equalsAddress(funder, depositWallet),
      makerSignerFunderAllEqualDepositWallet:
        equalsAddress(maker, depositWallet) && equalsAddress(signer, depositWallet) && equalsAddress(funder, depositWallet),
      orderType: "FOK",
      side: signedRecord.side ?? null,
      makerAmountAtomic: optionalString(signedRecord.makerAmount) ?? null,
      takerAmountAtomic: optionalString(signedRecord.takerAmount) ?? null,
      tickSize: orderMetadata.tickSize ?? input.config.tickSize ?? null,
      negRisk: orderMetadata.negRisk ?? input.config.negRisk ?? null,
      builderConfigured: nonEmpty(input.config.builderCode) || !/^0x0+$/i.test(`${signedRecord.builder ?? ""}`)
    },
    readinessSummary: {
      readinessCode: input.readinessEvidence ? "POLYMARKET_CLOB_READY_FOR_SUBMIT" : null,
      usableBalanceSource: input.readinessEvidence?.usableBalanceSource
        ?? (input.readinessEvidence?.source === "SDK_BALANCE_ALLOWANCE" ? "SDK_BALANCE_ALLOWANCE" : null)
        ?? attestation?.usableBalanceSource
        ?? null,
      approvalSpenderSource: input.readinessEvidence?.approvalSpenderSource ?? attestation?.approvalSpenderSource ?? null,
      liveSubmitSpendableBalance: input.readinessEvidence
        ? formatCollateralAtomicUnits(input.readinessEvidence.sdkSpendableAtomic)
        : null,
      requiredAtomic: input.readinessEvidence?.requiredAtomic.toString()
        ?? required?.requiredAtomic.toString()
        ?? attestation?.requiredAtomic.toString()
        ?? null
    },
    clientConstructorSummary: {
      constructorSignatureType: signatureTypeLabel(constructorSignatureType),
      constructorFunderEqualsDepositWallet: equalsAddress(funder, depositWallet)
    }
  };
};

const extractForwardedPolymarketPostOrderDiagnostic = (payload: unknown): Record<string, unknown> | null => {
  const record = isRecord(payload) ? payload : null;
  const diagnostics = record && isRecord(record.diagnostics) ? record.diagnostics : null;
  const diagnostic = diagnostics && isRecord(diagnostics.postOrderRejectionDiagnostic)
    ? diagnostics.postOrderRejectionDiagnostic
    : null;
  if (!diagnostic) {
    return null;
  }
  return diagnostic;
};

const writePolymarketPostOrderRejectionDiagnostic = async (
  diagnostic: Record<string, unknown>
): Promise<void> => {
  await mkdir(dirname(POLYMARKET_POSTORDER_REJECTION_DIAGNOSTIC_PATH), { recursive: true });
  await writeFile(
    POLYMARKET_POSTORDER_REJECTION_DIAGNOSTIC_PATH,
    `${JSON.stringify(diagnostic, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value, 2)}\n`,
    "utf8"
  );
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

const firstNonEmptyString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
};

const mapPolymarketOrderResponse = (response: unknown): VenueSubmitResult => {
  const record = isRecord(response) ? response : {};
  const orderID = record.orderID ?? record.orderId ?? record.id;
  const statusValue = `${record.status ?? ""}`.trim().toUpperCase();
  const explicitFilledSize = firstNonEmptyString(
    record.filledSize,
    record.filledAmount,
    record.sizeMatched,
    record.size_matched,
    record.matchedAmount,
    record.matched_amount,
    record.takingAmount,
    record.makingAmount
  );
  const filledSize = explicitFilledSize ?? "0";
  const numericFilledSize = Number(filledSize);
  const averagePrice = Number(record.price ?? 0);
  const result: VenueSubmitResult = {
    venueOrderId: typeof orderID === "string" && orderID.length > 0 ? orderID : `polymarket-order-${sha256Hex(stableStringify(response)).slice(0, 16)}`,
    status: Number.isFinite(numericFilledSize) && numericFilledSize > 0
      ? (statusValue === "MATCHED" || statusValue === "FILLED" ? "FILLED" : "PARTIAL_FILL")
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

const mapPolymarketDataApiActivityToFillState = (activity: PolymarketDataApiActivity): VenueFillState => ({
  status: "FILLED",
  filledSize: String(activity.size),
  averagePrice: Number.isFinite(activity.price) ? activity.price : 0,
  offchainFilled: true
});

const mapPolymarketDataApiActivityToSettlementState = (activity: PolymarketDataApiActivity): VenueSettlementState => ({
  status: "SETTLEMENT_VERIFIED",
  evidence: {
    source: "polymarket_data_api_activity",
    transactionHash: activity.transactionHash ?? null,
    conditionId: activity.conditionId,
    assetIdHash: sha256Hex(activity.asset).slice(0, 16),
    timestamp: new Date(activity.timestamp * 1000).toISOString(),
    side: activity.side,
    size: String(activity.size),
    price: activity.price
  }
});

const isHexHash = (value: string): boolean =>
  /^0x[a-fA-F0-9]{64}$/.test(value);

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
        relaySecret: config.executionRelaySecret ?? "",
        polymarketConfig: config
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
  private readonly envStatus: PolymarketExecutionAdapterV2EnvStatus;
  private readonly readinessSnapshot: PolymarketAdapterReadinessSnapshot;

  public constructor(
    private readonly config: PolymarketExecutionAdapterV2Config,
    liveClient?: PolymarketClobV2LiveClient,
    balanceReader?: PolymarketSubmitBalanceReader | undefined
  ) {
    const envStatus = getPolymarketExecutionAdapterV2EnvStatus(polymarketConfigEnvLike(config));
    const readinessSnapshot = buildPolymarketAdapterReadinessSnapshot(config, envStatus);
    this.envStatus = {
      ...envStatus,
      signatureType: readinessSnapshot.signatureType,
      accountModel: readinessSnapshot.accountModel,
      depositWalletEnabled: readinessSnapshot.depositWalletEnabled
    };
    this.readinessSnapshot = readinessSnapshot;
    this.liveClient = liveClient ?? createPolymarketClobV2LiveClient(config, undefined, balanceReader);
    this.dryRunClient = new PolymarketClobV2DryRunClient(config);
    this.now = () => new Date();
  }

  public status(): PolymarketExecutionAdapterV2EnvStatus {
    return this.envStatus;
  }

  public configSnapshot(): PolymarketAdapterReadinessSnapshot {
    return this.readinessSnapshot;
  }

  public async prepareOrder(leg: ExecutionLegV0): Promise<PreparedVenueOrder> {
    const tags = {
      canonicalMarketId: leg.venueMarketId,
      venue: this.venue,
      executionMode: this.readinessSnapshot.executionMode,
      external: true
    } as const;
    try {
      withLatencyStageSync("polymarket_prepare_env_check", tags, () => {
        this.assertPreparedPathConfigured();
      });
      withLatencyStageSync("polymarket_prepare_account_binding", tags, () => ({
        signatureType: this.readinessSnapshot.signatureType,
        accountModel: this.readinessSnapshot.accountModel,
        depositWalletEnabled: this.readinessSnapshot.depositWalletEnabled
      }));
      const orderInput = withLatencyStageSync("polymarket_prepare_order_shape", tags, () => ({
        clientOrderId: leg.executionLegId,
        venueMarketId: leg.venueMarketId,
        venueOutcomeId: leg.venueOutcomeId,
        side: leg.side,
        size: leg.size,
        price: leg.price
      }));
      withLatencyStageSync("polymarket_prepare_builder_config", tags, () => {
        if (!this.readinessSnapshot.builderCodeConfigured) {
          throw new PolymarketExecutionNotConfiguredError(
            "POLYMARKET_V2_DRY_RUN_ORDER_INVALID",
            "Polymarket V2 dry-run order shape is invalid: missing_builder_code."
          );
        }
      });
      const dryRunOrder = withLatencyStageSync("polymarket_prepare_signature_payload", tags, () =>
        this.dryRunClient.buildPreparedDryRunEnvelope(orderInput, this.now()));
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
            ...(leg.metadata ?? {}),
            adapter: "PolymarketExecutionAdapterV2",
            readinessState: this.status().readinessState,
            clobV2DryRun: dryRunOrder
          }
        }
      };
    } catch (error) {
      withLatencyStageSync("polymarket_prepare_error_normalization", tags, () => {
        if (error instanceof PolymarketExecutionNotConfiguredError) {
          return this.normalizeVenueError(error);
        }
        return normalizeLiveVenueErrorMessage(error, {
          venue: "POLYMARKET",
          fallbackCode: "POLYMARKET_V2_ADAPTER_ERROR",
          fallbackMessage: "Unknown Polymarket V2 adapter error."
        });
      });
      throw error;
    }
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

  public async fetchFillState(venueOrderId: string, context?: VenueOrderLookupContext): Promise<VenueFillState> {
    if (!venueOrderId) {
      return {
        status: this.config.fillStateOverride ?? "FAILED",
        filledSize: "0",
        averagePrice: 0,
        offchainFilled: false
      };
    }
    if (!this.config.fillStateOverride) {
      return this.liveClient.fetchFillState(venueOrderId, context);
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

  public async fetchSettlementState(fillOrOrderId: string, context?: VenueOrderLookupContext): Promise<VenueSettlementState> {
    if (this.config.settlementStateOverride) {
      return {
        status: this.config.settlementStateOverride,
        evidence: { source: "polymarket_v2_test_override", fillOrOrderId }
      };
    }
    return this.liveClient.fetchSettlementState(fillOrOrderId, context);
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
    const status = this.envStatus;
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
