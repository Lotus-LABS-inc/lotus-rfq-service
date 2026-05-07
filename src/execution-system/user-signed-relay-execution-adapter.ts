import type { ExecutionLegV0 } from "./types.js";
import {
  buildPredictOauthOrderClientFromEnv,
  type PredictOauthCreateOrderPayload,
  type PredictOauthOrderStatus
} from "../integrations/predict/predict-oauth-order-client.js";
import { PredictClient } from "../integrations/predict/predict-client.js";
import type {
  ExecutionVenueAdapter,
  NormalizedVenueError,
  PreparedVenueOrder,
  VenueFillState,
  VenueSettlementState,
  VenueSubmitResult
} from "./venue-adapter.js";

export type UserSignedRelayVenue = "OPINION" | "PREDICT_FUN";
export type UserSignedRelayAdapterName = "OpinionExecutionAdapter" | "PredictFunExecutionAdapter";
export type UserSignedRelayExecutionMode = "disabled" | "user_signed_backend_relay";
export type UserSignedRelayReadiness = "NOT_CONFIGURED" | "LIVE_DISABLED" | "LIVE_READY";

export interface UserSignedRelayExecutionAdapterConfig {
  venue: UserSignedRelayVenue;
  adapter: UserSignedRelayAdapterName;
  executionMode?: UserSignedRelayExecutionMode | undefined;
  baseUrl?: string | undefined;
  baseUrlEnvKey?: string | undefined;
  apiKey?: string | undefined;
  apiKeyEnvKey?: string | undefined;
  executionSubmitMode?: "direct" | "relay" | undefined;
  executionRelayUrl?: string | undefined;
  executionRelaySecret?: string | undefined;
  liveExecutionEnabled: boolean;
  orderCreatePath: string;
  docsUrl: string;
  now?: (() => Date) | undefined;
  predictOauthOrderClient?: PredictOauthOrderRelayClient | undefined;
  predictOrderMetadataClient?: PredictOrderMetadataClient | undefined;
  predictJwtProvider?: PredictJwtProvider | undefined;
}

export interface PredictOauthOrderRelayClient {
  configured(): boolean;
  createOauthOrder(payload: PredictOauthCreateOrderPayload, jwt?: string | undefined): Promise<{ orderId: string; orderHash: string }>;
  getOrderByHash(orderHash: string): Promise<PredictOauthOrderStatus>;
  cancelOrder?(orderHash: string): Promise<{ cancelled: boolean }>;
}

export interface PredictOrderMetadataClient {
  getMarketById(marketId: string): Promise<Record<string, unknown>>;
  getMarketStatistics(marketId: string): Promise<Record<string, unknown>>;
}

export interface PredictJwtProvider {
  getPredictFunJwt(userId: string): string | null;
}

export interface UserSignedRelayExecutionAdapterEnvStatus {
  adapter: UserSignedRelayAdapterName;
  venue: UserSignedRelayVenue;
  executionSigningModel: "USER_SIGNED_BACKEND_RELAY";
  liveExecutionEnabled: boolean;
  featureFlagSelected: boolean;
  readinessState: UserSignedRelayReadiness;
  requiredEnvPresent: boolean;
  missingEnv: readonly string[];
  dryRunRequiredEnvPresent: boolean;
  missingDryRunEnv: readonly string[];
  credentialsServerSideOnly: true;
  liveSubmissionStatus: "NOT_CONFIGURED" | "LIVE_DISABLED" | "LIVE_READY";
  relayImplementationStatus: "PREPARE_ONLY" | "SIGNED_RELAY_IMPLEMENTED";
}

export class UserSignedRelayExecutionNotConfiguredError extends Error {
  public constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = "UserSignedRelayExecutionNotConfiguredError";
  }
}

export interface UserSignedRelayPreparedBinding {
  userId: string;
  signerAddress: string;
  venueAccountId?: string | null | undefined;
  venueAccountAddress: string;
}

export interface UserSignedRelaySubmitPayload {
  expectedBinding: UserSignedRelayPreparedBinding;
  signedPayload: PredictOauthCreateOrderPayload;
}

const nonEmpty = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseSize = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new UserSignedRelayExecutionNotConfiguredError(
      "USER_SIGNED_RELAY_INVALID_ORDER_SIZE",
      "User-signed relay order size must be positive."
    );
  }
  return parsed;
};

const parsePrice = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new UserSignedRelayExecutionNotConfiguredError(
      "USER_SIGNED_RELAY_INVALID_ORDER_PRICE",
      "User-signed relay order price must be between 0 and 1."
    );
  }
  return value;
};

const readinessFromEnv = (input: {
  featureFlagSelected: boolean;
  liveExecutionEnabled: boolean;
  missingEnv: readonly string[];
  missingDryRunEnv: readonly string[];
}): UserSignedRelayReadiness => {
  if (!input.featureFlagSelected || input.missingDryRunEnv.length > 0) {
    return "NOT_CONFIGURED";
  }
  if (!input.liveExecutionEnabled) {
    return "LIVE_DISABLED";
  }
  return input.missingEnv.length === 0 ? "LIVE_READY" : "NOT_CONFIGURED";
};

const relayImplementationStatusForVenue = (
  venue: UserSignedRelayVenue
): UserSignedRelayExecutionAdapterEnvStatus["relayImplementationStatus"] =>
  venue === "PREDICT_FUN" ? "SIGNED_RELAY_IMPLEMENTED" : "PREPARE_ONLY";

const statusFromConfig = (config: {
  adapter: UserSignedRelayAdapterName;
  venue: UserSignedRelayVenue;
  executionMode?: UserSignedRelayExecutionMode | undefined;
  baseUrl?: string | undefined;
  baseUrlEnvKey?: string | undefined;
  apiKey?: string | undefined;
  apiKeyEnvKey?: string | undefined;
  executionSubmitMode?: "direct" | "relay" | undefined;
  executionRelayUrl?: string | undefined;
  executionRelaySecret?: string | undefined;
  liveExecutionEnabled: boolean;
}): UserSignedRelayExecutionAdapterEnvStatus => {
  const baseUrlEnvKey = config.baseUrlEnvKey ?? `${config.venue}_EXECUTION_BASE_URL`;
  const apiKeyEnvKey = config.apiKeyEnvKey ?? `${config.venue}_EXECUTION_API_KEY`;
  const relaySelected = config.executionSubmitMode === "relay";
  const missingEnv = relaySelected
    ? [
        ...(!nonEmpty(config.executionRelayUrl) ? [`${config.venue}_EXECUTION_RELAY_URL`] : []),
        ...(!nonEmpty(config.executionRelaySecret) ? [`${config.venue}_EXECUTION_RELAY_SECRET`] : [])
      ]
    : [
        ...(!nonEmpty(config.baseUrl) ? [baseUrlEnvKey] : []),
        ...(!nonEmpty(config.apiKey) ? [apiKeyEnvKey] : [])
      ];
  const missingDryRunEnv = !nonEmpty(config.baseUrl) ? [baseUrlEnvKey] : [];
  const featureFlagSelected = config.executionMode === "user_signed_backend_relay";
  const readinessState = readinessFromEnv({
    featureFlagSelected,
    liveExecutionEnabled: config.liveExecutionEnabled,
    missingEnv,
    missingDryRunEnv
  });
  return {
    adapter: config.adapter,
    venue: config.venue,
    executionSigningModel: "USER_SIGNED_BACKEND_RELAY",
    liveExecutionEnabled: config.liveExecutionEnabled,
    featureFlagSelected,
    readinessState,
    requiredEnvPresent: missingEnv.length === 0,
    missingEnv,
    dryRunRequiredEnvPresent: missingDryRunEnv.length === 0,
    missingDryRunEnv,
    credentialsServerSideOnly: true,
    liveSubmissionStatus: readinessState === "LIVE_READY"
      ? "LIVE_READY"
      : !config.liveExecutionEnabled
        ? "LIVE_DISABLED"
        : "NOT_CONFIGURED",
    relayImplementationStatus: relayImplementationStatusForVenue(config.venue)
  };
};

export const getOpinionExecutionAdapterEnvStatus = (
  env: NodeJS.ProcessEnv = process.env
): UserSignedRelayExecutionAdapterEnvStatus =>
  statusFromConfig({
    adapter: "OpinionExecutionAdapter",
    venue: "OPINION",
    executionMode: env.OPINION_EXECUTION_MODE === "user_signed_backend_relay"
      ? "user_signed_backend_relay"
      : "disabled",
    baseUrl: env.OPINION_CLOB_BASE_URL,
    baseUrlEnvKey: "OPINION_CLOB_BASE_URL",
    apiKey: env.OPINION_API_KEY,
    apiKeyEnvKey: "OPINION_API_KEY",
    liveExecutionEnabled: env.OPINION_LIVE_EXECUTION_ENABLED === "true"
  });

export const getPredictFunExecutionAdapterEnvStatus = (
  env: NodeJS.ProcessEnv = process.env
): UserSignedRelayExecutionAdapterEnvStatus =>
  statusFromConfig({
    adapter: "PredictFunExecutionAdapter",
    venue: "PREDICT_FUN",
    executionMode: env.PREDICT_FUN_EXECUTION_MODE === "user_signed_backend_relay"
      ? "user_signed_backend_relay"
      : "disabled",
    baseUrl: env.PREDICT_MAINNET_BASE_URL,
    baseUrlEnvKey: "PREDICT_MAINNET_BASE_URL",
    apiKey: env.PREDICT_API_KEY,
    apiKeyEnvKey: "PREDICT_API_KEY",
    executionSubmitMode: env.PREDICT_FUN_EXECUTION_SUBMIT_MODE === "relay" ? "relay" : "direct",
    executionRelayUrl: env.PREDICT_FUN_EXECUTION_RELAY_URL,
    executionRelaySecret: env.PREDICT_FUN_EXECUTION_RELAY_SECRET,
    liveExecutionEnabled: env.PREDICT_FUN_LIVE_EXECUTION_ENABLED === "true"
  });

export const buildOpinionExecutionAdapterConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): UserSignedRelayExecutionAdapterConfig => ({
  venue: "OPINION",
  adapter: "OpinionExecutionAdapter",
  executionMode: env.OPINION_EXECUTION_MODE === "user_signed_backend_relay" ? "user_signed_backend_relay" : "disabled",
  baseUrl: env.OPINION_CLOB_BASE_URL,
  baseUrlEnvKey: "OPINION_CLOB_BASE_URL",
  apiKey: env.OPINION_API_KEY,
  apiKeyEnvKey: "OPINION_API_KEY",
  liveExecutionEnabled: env.OPINION_LIVE_EXECUTION_ENABLED === "true",
  orderCreatePath: env.OPINION_EXECUTION_ORDER_CREATE_PATH ?? "/builder/orders",
  docsUrl: "https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode"
});

export const buildPredictFunExecutionAdapterConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): UserSignedRelayExecutionAdapterConfig => ({
  venue: "PREDICT_FUN",
  adapter: "PredictFunExecutionAdapter",
  executionMode: env.PREDICT_FUN_EXECUTION_MODE === "user_signed_backend_relay" ? "user_signed_backend_relay" : "disabled",
  baseUrl: env.PREDICT_MAINNET_BASE_URL,
  baseUrlEnvKey: "PREDICT_MAINNET_BASE_URL",
  apiKey: env.PREDICT_API_KEY,
  apiKeyEnvKey: "PREDICT_API_KEY",
  executionSubmitMode: env.PREDICT_FUN_EXECUTION_SUBMIT_MODE === "relay" ? "relay" : "direct",
  executionRelayUrl: env.PREDICT_FUN_EXECUTION_RELAY_URL,
  executionRelaySecret: env.PREDICT_FUN_EXECUTION_RELAY_SECRET,
  liveExecutionEnabled: env.PREDICT_FUN_LIVE_EXECUTION_ENABLED === "true",
  orderCreatePath: "/v1/orders",
  docsUrl: "https://dev.predict.fun/create-an-order-32534694e0",
  predictOauthOrderClient: buildPredictOauthOrderClientFromEnv(env),
  predictOrderMetadataClient: new PredictClient({
    environment: "mainnet",
    ...(env.PREDICT_MAINNET_BASE_URL ? { baseUrl: env.PREDICT_MAINNET_BASE_URL } : {}),
    ...(env.PREDICT_API_KEY ? { apiKey: env.PREDICT_API_KEY } : {})
  })
});

export class UserSignedRelayExecutionAdapter implements ExecutionVenueAdapter {
  public readonly venue: UserSignedRelayVenue;
  private readonly now: () => Date;
  private readonly predictOauthOrderClient: PredictOauthOrderRelayClient | undefined;
  private readonly predictOrderMetadataClient: PredictOrderMetadataClient | undefined;
  private readonly predictJwtProvider: PredictJwtProvider | undefined;
  private lastOrderStatus: PredictOauthOrderStatus | null = null;
  private readonly expectedBindingByOrderHash = new Map<string, UserSignedRelayPreparedBinding>();

  public constructor(private readonly config: UserSignedRelayExecutionAdapterConfig) {
    this.venue = config.venue;
    this.now = config.now ?? (() => new Date());
    this.predictOauthOrderClient = config.predictOauthOrderClient;
    this.predictOrderMetadataClient = config.predictOrderMetadataClient;
    this.predictJwtProvider = config.predictJwtProvider;
  }

  public status(): UserSignedRelayExecutionAdapterEnvStatus {
    return statusFromConfig(this.config);
  }

  public async prepareOrder(leg: ExecutionLegV0): Promise<PreparedVenueOrder> {
    const status = this.status();
    if (!status.featureFlagSelected || !status.dryRunRequiredEnvPresent) {
      throw new UserSignedRelayExecutionNotConfiguredError(
        "USER_SIGNED_RELAY_NOT_CONFIGURED",
        `${this.venue} user-signed relay is not configured for order preparation.`
      );
    }
    const size = parseSize(leg.size);
    const price = parsePrice(leg.price);
    const preparedAt = this.now();
    const expiresAt = new Date(preparedAt.getTime() + 5 * 60_000);
    const backendMayRelaySignedPayload = this.venue === "PREDICT_FUN" &&
      status.relayImplementationStatus === "SIGNED_RELAY_IMPLEMENTED";
    const resolvedPredictOrder = this.venue === "PREDICT_FUN"
      ? await this.resolvePredictOrderIdentifiers(leg.venueMarketId, leg.venueOutcomeId)
      : {
          venueMarketId: leg.venueMarketId,
          venueOutcomeId: leg.venueOutcomeId
        };
    const predictOrderMetadata = this.venue === "PREDICT_FUN"
      ? await this.resolvePredictOrderMetadata(resolvedPredictOrder.venueMarketId)
      : null;
    return {
      venue: this.venue,
      clientOrderId: leg.executionLegId,
      payload: {
        relayMode: "USER_SIGNED_BACKEND_RELAY",
        adapter: this.config.adapter,
        venue: this.venue,
        venueMarketId: resolvedPredictOrder.venueMarketId,
        venueOutcomeId: resolvedPredictOrder.venueOutcomeId,
        side: leg.side,
        size,
        price,
        preparedAt: preparedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        expectedOrder: {
          venueMarketId: resolvedPredictOrder.venueMarketId,
          venueOutcomeId: resolvedPredictOrder.venueOutcomeId,
          side: leg.side,
          size,
          price
        },
        orderCreatePath: this.config.orderCreatePath,
        signingRequired: true,
        backendMayRelaySignedPayload,
        backendMaySign: false,
        docsUrl: this.config.docsUrl,
        metadata: {
          readinessState: status.readinessState,
          relayImplementationStatus: status.relayImplementationStatus,
          credentialsServerSideOnly: true
        },
        ...(predictOrderMetadata ? { predictOrderMetadata } : {})
      }
    };
  }

  public async submitOrder(order: PreparedVenueOrder): Promise<VenueSubmitResult> {
    if (this.venue === "PREDICT_FUN") {
      return this.submitPredictFunSignedOrder(order);
    }
    throw new UserSignedRelayExecutionNotConfiguredError(
      "USER_SIGNED_RELAY_SUBMIT_NOT_IMPLEMENTED",
      `${this.venue} backend relay submit is not implemented. User-signed payload relay must stay fail-closed until cancel/fill/status and settlement evidence are reviewed.`
    );
  }

  public async fetchFillState(venueOrderId: string): Promise<VenueFillState> {
    if (this.venue === "PREDICT_FUN" && this.predictOauthOrderClient?.configured()) {
      try {
        const status = await this.predictOauthOrderClient.getOrderByHash(venueOrderId);
        this.lastOrderStatus = status;
        return mapPredictOrderStatusToFillState(status);
      } catch {
        return {
          status: "OPEN",
          filledSize: "0",
          averagePrice: 0,
          offchainFilled: false
        };
      }
    }
    return {
      status: "OPEN",
      filledSize: "0",
      averagePrice: 0,
      offchainFilled: false
    };
  }

  public async fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState> {
    if (this.venue === "PREDICT_FUN" && this.predictOauthOrderClient?.configured()) {
      try {
        const status = await this.predictOauthOrderClient.getOrderByHash(fillOrOrderId);
        this.lastOrderStatus = status;
        return mapPredictOrderStatusToSettlementState(status, this.expectedBindingByOrderHash.get(fillOrOrderId));
      } catch {
        return {
          status: "SETTLEMENT_UNKNOWN",
          evidence: {
            source: "predict_fun_user_signed_relay_adapter",
            fillOrOrderId,
            settlementEvidenceSupported: true,
            reason: "predict_status_read_failed"
          }
        };
      }
    }
    return {
      status: "SETTLEMENT_PENDING",
      evidence: {
        source: `${this.venue.toLowerCase()}_user_signed_relay_adapter`,
        fillOrOrderId,
        settlementEvidenceSupported: false,
        ...(this.lastOrderStatus && this.lastOrderStatus.orderHash === fillOrOrderId
          ? {
              orderStatus: this.lastOrderStatus.status,
              remainingSize: this.lastOrderStatus.remainingSize
            }
          : {})
      }
    };
  }

  public async cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }> {
    if (this.venue === "PREDICT_FUN" && this.predictOauthOrderClient?.configured()) {
      if (!this.predictOauthOrderClient.cancelOrder) {
        throw new UserSignedRelayExecutionNotConfiguredError(
          "PREDICT_FUN_CANCEL_NOT_IMPLEMENTED",
          "Predict.fun cancel is reserved but not implemented until official signed cancel semantics are confirmed."
        );
      }
      return this.predictOauthOrderClient.cancelOrder(venueOrderId);
    }
    return { cancelled: false };
  }

  public normalizeVenueError(error: unknown): NormalizedVenueError {
    if (error instanceof UserSignedRelayExecutionNotConfiguredError) {
      return {
        code: error.reasonCode,
        message: error.message,
        retryable: false
      };
    }
    return {
      code: `${this.venue}_USER_SIGNED_RELAY_ERROR`,
      message: error instanceof Error ? error.message : `Unknown ${this.venue} user-signed relay error.`,
      retryable: false
    };
  }

  private async submitPredictFunSignedOrder(order: PreparedVenueOrder): Promise<VenueSubmitResult> {
    const status = this.status();
    if (!status.liveExecutionEnabled) {
      throw new UserSignedRelayExecutionNotConfiguredError(
        "USER_SIGNED_RELAY_LIVE_DISABLED",
        "PREDICT_FUN_LIVE_EXECUTION_ENABLED is false; signed Predict.fun relay submit is disabled."
      );
    }
    if (status.readinessState !== "LIVE_READY") {
      throw new UserSignedRelayExecutionNotConfiguredError(
        "USER_SIGNED_RELAY_ENV_INCOMPLETE",
        `Predict.fun signed relay env is incomplete: ${status.missingEnv.join(", ")}.`
      );
    }
    if (!this.predictOauthOrderClient?.configured()) {
      throw new UserSignedRelayExecutionNotConfiguredError(
        "PREDICT_FUN_RELAY_CLIENT_NOT_CONFIGURED",
        "Predict.fun order client is not configured."
      );
    }
    const relayPayload = parseRelaySubmitPayload(order.payload);
    const predictJwt = this.predictJwtProvider?.getPredictFunJwt(relayPayload.expectedBinding.userId);
    if (!predictJwt) {
      throw new UserSignedRelayExecutionNotConfiguredError(
        "PREDICT_FUN_JWT_NOT_AVAILABLE",
        "Predict.fun requires a fresh user auth JWT for live order submit. Refresh the Predict.fun venue setup signature, then retry the live submit."
      );
    }
    validatePreparedOrderExpiry(order.payload, this.now());
    validatePredictSignedPayloadMatchesPreparedOrder(order.payload, relayPayload);
    if (status.relayImplementationStatus !== "SIGNED_RELAY_IMPLEMENTED") {
      throw new UserSignedRelayExecutionNotConfiguredError(
        "PREDICT_FUN_OAUTH_ORDER_SCHEMA_NOT_IMPLEMENTED",
        "Predict.fun live relay is disabled until Lotus builds the venue's full create-order payload schema with timestamp, hash, salt, amounts, expiration, nonce, fee, signature type, and venue-verified signing semantics."
      );
    }
    const result = await this.predictOauthOrderClient.createOauthOrder(relayPayload.signedPayload, predictJwt);
    this.expectedBindingByOrderHash.set(result.orderHash, relayPayload.expectedBinding);
    return {
      venueOrderId: result.orderHash,
      fillId: result.orderId,
      status: "SUBMITTED",
      filledSize: "0",
      averagePrice: numberPayloadField(order.payload, "price") ?? 0
    };
  }

  private async resolvePredictOrderMetadata(venueMarketId: string): Promise<Record<string, unknown> | null> {
    if (!this.predictOrderMetadataClient) {
      return null;
    }
    const [market, stats] = await Promise.all([
      this.predictOrderMetadataClient.getMarketById(venueMarketId).catch(() => ({})),
      this.predictOrderMetadataClient.getMarketStatistics(venueMarketId).catch(() => ({}))
    ]);
    return {
      chainId: numericStringField(market, "chainId") ?? numericStringField(market, "chain_id") ?? "56",
      feeRateBps: numericStringField(stats, "feeRateBps") ??
        numericStringField(stats, "fee_rate_bps") ??
        numericStringField(market, "feeRateBps") ??
        numericStringField(market, "fee_rate_bps") ??
        "0",
      isNegRisk: booleanField(market, "isNegRisk") ??
        booleanField(market, "is_neg_risk") ??
        booleanField(market, "negRisk") ??
        false,
      isYieldBearing: booleanField(market, "isYieldBearing") ??
        booleanField(market, "is_yield_bearing") ??
        booleanField(market, "yieldBearing") ??
        false
    };
  }

  private async resolvePredictOrderIdentifiers(
    venueMarketId: string,
    venueOutcomeId?: string | undefined
  ): Promise<{ venueMarketId: string; venueOutcomeId?: string | undefined }> {
    const executableMarketId = stripPredictSharedCoreMarketId(venueMarketId);
    if (venueOutcomeId && /^\d+$/.test(venueOutcomeId.trim())) {
      return { venueMarketId: executableMarketId, venueOutcomeId: venueOutcomeId.trim() };
    }
    const label = normalizePredictOutcomeLabel(venueOutcomeId);
    if (!label || !this.predictOrderMetadataClient) {
      return { venueMarketId: executableMarketId, ...(venueOutcomeId ? { venueOutcomeId } : {}) };
    }
    const market = await this.predictOrderMetadataClient.getMarketById(executableMarketId).catch(() => null);
    const token = resolvePredictTokenFromMarketDetail(market, label);
    return {
      venueMarketId: executableMarketId,
      venueOutcomeId: token ?? venueOutcomeId
    };
  }
}

export class OpinionExecutionAdapter extends UserSignedRelayExecutionAdapter {
  public constructor(config: Omit<UserSignedRelayExecutionAdapterConfig, "venue" | "adapter">) {
    super({ ...config, venue: "OPINION", adapter: "OpinionExecutionAdapter" });
  }
}

export class PredictFunExecutionAdapter extends UserSignedRelayExecutionAdapter {
  public constructor(config: Omit<UserSignedRelayExecutionAdapterConfig, "venue" | "adapter">) {
    super({ ...config, venue: "PREDICT_FUN", adapter: "PredictFunExecutionAdapter" });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isEvmAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);

const isEvmSignature = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{130}$/.test(value);

const equalsAddress = (left: string | null | undefined, right: string | null | undefined): boolean =>
  typeof left === "string" &&
  typeof right === "string" &&
  left.toLowerCase() === right.toLowerCase();

const stringPayloadField = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const numberPayloadField = (payload: Record<string, unknown>, key: string): number | null => {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const numericStringField = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const stripPredictSharedCoreMarketId = (venueMarketId: string): string => {
  const trimmed = venueMarketId.trim();
  if (!trimmed.startsWith("PREDICT:")) {
    return trimmed;
  }
  const [, executableId] = trimmed.split(":");
  return executableId && executableId.length > 0 ? executableId : trimmed;
};

const normalizePredictOutcomeLabel = (value: unknown): "YES" | "NO" | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "YES") return "YES";
  if (normalized === "NO") return "NO";
  return null;
};

const resolvePredictTokenFromMarketDetail = (
  market: unknown,
  label: "YES" | "NO"
): string | null => {
  const outcomes = isRecord(market) && Array.isArray(market.outcomes) ? market.outcomes : [];
  const matches = outcomes.flatMap((outcome) => {
    if (!isRecord(outcome)) {
      return [];
    }
    const outcomeLabel = firstPayloadString(outcome.label, outcome.name, outcome.title, outcome.outcomeType, outcome.outcome_type);
    const token = firstPayloadString(outcome.tokenId, outcome.token_id, outcome.onChainId, outcome.on_chain_id, outcome.id, outcome.indexSet);
    return normalizePredictOutcomeLabel(outcomeLabel) === label && token && /^\d+$/.test(token) ? [token] : [];
  });
  return matches.length === 1 ? matches[0]! : null;
};

const firstPayloadString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
};

const numericStringPayloadField = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
};

const integerPayloadField = (payload: Record<string, unknown>, key: string): number | null => {
  const value = payload[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
};

const decimalToWeiString = (value: string): string => {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return "";
  }
  const [whole = "0", fractional = ""] = normalized.split(".");
  const paddedFractional = `${fractional.slice(0, 18)}${"0".repeat(Math.max(18 - fractional.length, 0))}`;
  return String(BigInt(whole) * 10n ** 18n + BigInt(paddedFractional));
};

const booleanField = (payload: Record<string, unknown>, key: string): boolean | null => {
  const value = payload[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
};

const parseRelaySubmitPayload = (payload: Record<string, unknown>): UserSignedRelaySubmitPayload => {
  const expectedBinding = payload.expectedBinding;
  const signedPayload = payload.signedPayload;
  if (!isRecord(expectedBinding) || !isRecord(signedPayload)) {
    throw new UserSignedRelayExecutionNotConfiguredError(
      "USER_SIGNED_RELAY_SIGNED_PAYLOAD_REQUIRED",
      "Predict.fun signed relay submit requires expectedBinding and signedPayload."
    );
  }
  const userId = stringPayloadField(expectedBinding, "userId");
  const signerAddress = stringPayloadField(expectedBinding, "signerAddress");
  const venueAccountAddress = stringPayloadField(expectedBinding, "venueAccountAddress");
  const venueAccountId = stringPayloadField(expectedBinding, "venueAccountId");
  if (!userId || !isEvmAddress(signerAddress) || !isEvmAddress(venueAccountAddress)) {
    throw new UserSignedRelayExecutionNotConfiguredError(
      "USER_SIGNED_RELAY_BINDING_INVALID",
      "Predict.fun expected binding must include userId, signerAddress, and venueAccountAddress."
    );
  }
  if (!isEvmAddress(signedPayload.signer) || !isEvmAddress(signedPayload.account) || !isEvmSignature(signedPayload.signature) || !isRecord(signedPayload.data)) {
    throw new UserSignedRelayExecutionNotConfiguredError(
      "USER_SIGNED_RELAY_SIGNED_PAYLOAD_INVALID",
      "Predict.fun signed payload must include signer, account, signature, and data."
    );
  }
  return {
    expectedBinding: {
      userId,
      signerAddress,
      ...(venueAccountId ? { venueAccountId } : {}),
      venueAccountAddress
    },
    signedPayload: {
      signer: signedPayload.signer,
      account: signedPayload.account,
      signature: signedPayload.signature,
      data: signedPayload.data
    }
  };
};

const validatePreparedOrderExpiry = (payload: Record<string, unknown>, now: Date): void => {
  const expiresAt = stringPayloadField(payload, "expiresAt");
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) {
    throw new UserSignedRelayExecutionNotConfiguredError(
      "USER_SIGNED_RELAY_PREPARED_ORDER_EXPIRED",
      "Predict.fun prepared order is expired or missing expiresAt."
    );
  }
};

const validatePredictSignedPayloadMatchesPreparedOrder = (
  payload: Record<string, unknown>,
  relay: UserSignedRelaySubmitPayload
): void => {
  if (!equalsAddress(relay.signedPayload.signer, relay.expectedBinding.signerAddress)) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_SIGNER_MISMATCH", "Predict.fun signer does not match the active Turnkey EVM wallet.");
  }
  if (!equalsAddress(relay.signedPayload.account, relay.expectedBinding.venueAccountAddress)) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_ACCOUNT_MISMATCH", "Predict.fun account does not match the active venue account binding.");
  }
  const order = isRecord(relay.signedPayload.data.order) ? relay.signedPayload.data.order : null;
  if (!order) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_ORDER_MISSING", "Predict.fun signed payload is missing data.order.");
  }
  const timestamp = integerPayloadField(relay.signedPayload.data, "timestamp");
  if (timestamp === null || timestamp <= 0) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_TIMESTAMP_MISSING", "Predict.fun signed payload is missing data.timestamp.");
  }
  const orderHash = stringPayloadField(order, "hash");
  if (!orderHash || !/^0x[a-fA-F0-9]{64}$/.test(orderHash)) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_ORDER_HASH_MISSING", "Predict.fun signed payload is missing data.order.hash.");
  }
  if (!equalsAddress(stringPayloadField(order, "maker"), relay.expectedBinding.venueAccountAddress) ||
      !equalsAddress(stringPayloadField(order, "signer"), relay.expectedBinding.venueAccountAddress)) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_ORDER_ACCOUNT_MISMATCH", "Predict.fun signed order maker/signer must match the linked Predict account.");
  }
  const expectedOutcomeId = stringPayloadField(payload, "venueOutcomeId");
  const signedTokenId = stringPayloadField(order, "tokenId");
  if (!expectedOutcomeId || signedTokenId !== expectedOutcomeId) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_OUTCOME_MISMATCH", "Predict.fun signed order tokenId does not match the prepared outcome.");
  }
  const expectedSide = stringPayloadField(payload, "side");
  const signedSide = numberPayloadField(order, "side");
  if (!expectedSide || signedSide === null || ((expectedSide === "buy" && signedSide !== 0) || (expectedSide === "sell" && signedSide !== 1))) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_SIDE_MISMATCH", "Predict.fun signed order side does not match the prepared side.");
  }
  const expectedPrice = numberPayloadField(payload, "price");
  const signedPriceWei = numericStringPayloadField(relay.signedPayload.data, "pricePerShare");
  if (expectedPrice === null || signedPriceWei === null || decimalToWeiString(String(expectedPrice)) !== signedPriceWei) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_PRICE_MISMATCH", "Predict.fun signed order price does not match the prepared price.");
  }
  const expectedSize = numberPayloadField(payload, "size");
  const signedQuantityWei = expectedSide === "sell"
    ? numericStringPayloadField(order, "makerAmount")
    : numericStringPayloadField(order, "takerAmount");
  if (expectedSize === null || signedQuantityWei === null || decimalToWeiString(String(expectedSize)) !== signedQuantityWei) {
    throw new UserSignedRelayExecutionNotConfiguredError("USER_SIGNED_RELAY_SIZE_MISMATCH", "Predict.fun signed order size does not match the prepared size.");
  }
};

const mapPredictOrderStatusToFillState = (status: PredictOauthOrderStatus): VenueFillState => {
  const normalized = `${status.status ?? ""}`.trim().toUpperCase();
  const size = status.size ?? "0";
  const remainingSize = Number(status.remainingSize ?? "0");
  const filledSize = Number.isFinite(remainingSize) && Number.isFinite(Number(size))
    ? String(Math.max(Number(size) - remainingSize, 0))
    : "0";
  const averagePrice = Number(status.price ?? 0);
  if (["FILLED", "MATCHED", "SETTLED", "COMPLETED"].includes(normalized)) {
    return { status: "FILLED", filledSize: size, averagePrice: Number.isFinite(averagePrice) ? averagePrice : 0, offchainFilled: true };
  }
  if (["PARTIAL", "PARTIALLY_FILLED", "PARTIAL_FILL"].includes(normalized)) {
    return { status: "PARTIAL_FILL", filledSize, averagePrice: Number.isFinite(averagePrice) ? averagePrice : 0, offchainFilled: true };
  }
  if (["CANCELLED", "CANCELED"].includes(normalized)) {
    return { status: "CANCELLED", filledSize, averagePrice: Number.isFinite(averagePrice) ? averagePrice : 0, offchainFilled: false };
  }
  if (["FAILED", "REJECTED"].includes(normalized)) {
    return { status: "FAILED", filledSize, averagePrice: Number.isFinite(averagePrice) ? averagePrice : 0, offchainFilled: false };
  }
  return { status: "OPEN", filledSize: "0", averagePrice: Number.isFinite(averagePrice) ? averagePrice : 0, offchainFilled: false };
};

export const mapPredictOrderStatusToSettlementState = (
  status: PredictOauthOrderStatus,
  expectedBinding?: UserSignedRelayPreparedBinding | undefined
): VenueSettlementState => {
  const normalized = `${status.status ?? ""}`.trim().toUpperCase();
  const remainingSize = Number(status.remainingSize ?? Number.NaN);
  const accountMatches = expectedBinding
    ? predictStatusAccountMatches(status.raw, expectedBinding.venueAccountAddress)
    : false;
  const baseEvidence = {
    source: "predict_fun_user_signed_relay_adapter",
    fillOrOrderId: status.orderHash,
    settlementEvidenceSupported: true,
    orderStatus: status.status,
    remainingSize: status.remainingSize,
    accountEvidenceMatched: accountMatches,
    expectedBindingPresent: Boolean(expectedBinding)
  };

  if (["FAILED", "REJECTED", "CANCELLED", "CANCELED"].includes(normalized)) {
    return {
      status: "SETTLEMENT_UNKNOWN",
      evidence: {
        ...baseEvidence,
        reason: "predict_order_failed_or_cancelled"
      }
    };
  }

  if (["SETTLED", "COMPLETED"].includes(normalized)) {
    if (Number.isFinite(remainingSize) && remainingSize === 0 && accountMatches) {
      return {
        status: "SETTLEMENT_VERIFIED",
        evidence: {
          ...baseEvidence,
          finalityEvidence: "predict_final_status_zero_remaining_matching_account"
        }
      };
    }
    return {
      status: "SETTLEMENT_PENDING",
      evidence: {
        ...baseEvidence,
        reason: !expectedBinding
          ? "missing_expected_binding"
          : !accountMatches
            ? "account_evidence_missing_or_mismatched"
            : "remaining_size_not_zero"
      }
    };
  }

  return {
    status: "SETTLEMENT_PENDING",
    evidence: {
      ...baseEvidence,
      reason: ["FILLED", "MATCHED"].includes(normalized)
        ? "fill_seen_waiting_for_final_settlement_status"
        : "predict_order_not_final"
    }
  };
};

const predictStatusAccountMatches = (raw: Record<string, unknown>, expectedAccount: string): boolean =>
  collectPredictStatusAccountCandidates(raw).some((candidate) => equalsAddress(candidate, expectedAccount));

const collectPredictStatusAccountCandidates = (value: unknown): string[] => {
  if (!isRecord(value)) {
    return [];
  }
  const directKeys = ["account", "maker", "signer", "owner", "wallet", "walletAddress", "venueAccountAddress"];
  const direct = directKeys
    .map((key) => stringPayloadField(value, key))
    .filter((entry): entry is string => Boolean(entry));
  const nested = ["order", "data", "payload"]
    .flatMap((key) => collectPredictStatusAccountCandidates(value[key]));
  return [...direct, ...nested];
};
