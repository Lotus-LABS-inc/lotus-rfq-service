import {
  Client,
  OrderType,
  Side,
  type OrderResponse
} from "@limitless-exchange/sdk";
import type { ExecutionLegV0, SettlementStatusV0 } from "./types.js";
import type {
  ExecutionVenueAdapter,
  NormalizedVenueError,
  PreparedVenueOrder,
  VenueFillState,
  VenueSettlementState,
  VenueSubmitResult
} from "./venue-adapter.js";

export const limitlessExecutionRequiredEnvKeys = [
  "LIMITLESS_BASE_URL",
  "LIMITLESS_API_KEY",
  "LIMITLESS_EXECUTION_PRIVATE_KEY"
] as const;

export const limitlessDelegatedExecutionRequiredEnvKeys = [
  "LIMITLESS_BASE_URL",
  "LIMITLESS_PARTNER_ACCOUNT_ENABLED",
  "LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID",
  "LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET"
] as const;

export const limitlessExecutionDryRunRequiredEnvKeys = [
  "LIMITLESS_BASE_URL"
] as const;

export type LimitlessExecutionRequiredEnvKey = (typeof limitlessExecutionRequiredEnvKeys)[number];
export type LimitlessDelegatedExecutionRequiredEnvKey = (typeof limitlessDelegatedExecutionRequiredEnvKeys)[number];
export type LimitlessExecutionDryRunRequiredEnvKey = (typeof limitlessExecutionDryRunRequiredEnvKeys)[number];
export type LimitlessExecutionMode = "disabled" | "backend_signer" | "delegated_partner_server_wallet";

export type LimitlessExecutionReadiness =
  | "NOT_CONFIGURED"
  | "LIVE_DISABLED"
  | "LIVE_READY";

export interface LimitlessExecutionAdapterConfig {
  executionMode?: LimitlessExecutionMode | undefined;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  privateKey?: string | undefined;
  hmacTokenId?: string | undefined;
  hmacSecret?: string | undefined;
  partnerAccountEnabled?: boolean | undefined;
  delegatedProfileId?: string | undefined;
  liveExecutionEnabled: boolean;
  settlementStateOverride?: SettlementStatusV0 | undefined;
  fillStateOverride?: VenueFillState["status"] | undefined;
}

export interface LimitlessExecutionAdapterEnvStatus {
  adapter: "LimitlessExecutionAdapter";
  venue: "LIMITLESS";
  executionMode: LimitlessExecutionMode;
  executionSigningModel: "BACKEND_SIGNER" | "DELEGATED_BACKEND_SIGNER";
  liveExecutionEnabled: boolean;
  featureFlagSelected: boolean;
  readinessState: LimitlessExecutionReadiness;
  requiredEnvPresent: boolean;
  missingEnv: readonly (LimitlessExecutionRequiredEnvKey | LimitlessDelegatedExecutionRequiredEnvKey)[];
  dryRunRequiredEnvPresent: boolean;
  missingDryRunEnv: readonly LimitlessExecutionDryRunRequiredEnvKey[];
  credentialsServerSideOnly: true;
  liveSubmissionStatus: "NOT_CONFIGURED" | "LIVE_DISABLED" | "LIVE_READY";
}

export interface LimitlessOrderClient {
  createOrder(input: {
    marketSlug: string;
    tokenId: string;
    side: Side;
    price: number;
    size: number;
    orderType: OrderType;
    onBehalfOf?: number | undefined;
  }): Promise<OrderResponse>;
  cancel(orderId: string, onBehalfOf?: number | undefined): Promise<unknown>;
  getFillState?(orderId: string, onBehalfOf?: number | undefined): Promise<VenueFillState>;
  getSettlementState?(orderId: string, onBehalfOf?: number | undefined): Promise<VenueSettlementState>;
}

export class LimitlessExecutionNotConfiguredError extends Error {
  public constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = "LimitlessExecutionNotConfiguredError";
  }
}

const nonEmpty = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const getLimitlessExecutionAdapterEnvStatus = (
  env: NodeJS.ProcessEnv = process.env
): LimitlessExecutionAdapterEnvStatus => {
  const executionMode = parseExecutionMode(env.LIMITLESS_EXECUTION_MODE);
  const missingEnv = executionMode === "delegated_partner_server_wallet"
    ? limitlessDelegatedExecutionRequiredEnvKeys.filter((key) => key === "LIMITLESS_PARTNER_ACCOUNT_ENABLED"
      ? env[key] !== "true"
      : !nonEmpty(env[key]))
    : limitlessExecutionRequiredEnvKeys.filter((key) => !nonEmpty(env[key]));
  const missingDryRunEnv = limitlessExecutionDryRunRequiredEnvKeys.filter((key) => !nonEmpty(env[key]));
  const featureFlagSelected = executionMode === "backend_signer" || executionMode === "delegated_partner_server_wallet";
  const liveExecutionEnabled = env.LIMITLESS_LIVE_EXECUTION_ENABLED === "true";
  const requiredEnvPresent = missingEnv.length === 0;
  const dryRunRequiredEnvPresent = missingDryRunEnv.length === 0;
  const readinessState: LimitlessExecutionReadiness = !featureFlagSelected || !dryRunRequiredEnvPresent
    ? "NOT_CONFIGURED"
    : !liveExecutionEnabled
      ? "LIVE_DISABLED"
      : requiredEnvPresent
        ? "LIVE_READY"
        : "NOT_CONFIGURED";
  return {
    adapter: "LimitlessExecutionAdapter",
    venue: "LIMITLESS",
    executionMode,
    executionSigningModel: executionMode === "delegated_partner_server_wallet" ? "DELEGATED_BACKEND_SIGNER" : "BACKEND_SIGNER",
    liveExecutionEnabled,
    featureFlagSelected,
    readinessState,
    requiredEnvPresent,
    missingEnv,
    dryRunRequiredEnvPresent,
    missingDryRunEnv,
    credentialsServerSideOnly: true,
    liveSubmissionStatus: readinessState === "LIVE_READY"
      ? "LIVE_READY"
      : !liveExecutionEnabled
        ? "LIVE_DISABLED"
        : "NOT_CONFIGURED"
  };
};

export const buildLimitlessExecutionAdapterConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): LimitlessExecutionAdapterConfig => ({
  executionMode: parseExecutionMode(env.LIMITLESS_EXECUTION_MODE),
  baseUrl: env.LIMITLESS_BASE_URL,
  apiKey: env.LIMITLESS_API_KEY,
  privateKey: env.LIMITLESS_EXECUTION_PRIVATE_KEY,
  hmacTokenId: env.LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID ?? env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY,
  hmacSecret: env.LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET ?? env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET,
  partnerAccountEnabled: env.LIMITLESS_PARTNER_ACCOUNT_ENABLED === "true",
  delegatedProfileId: env.LIMITLESS_DELEGATED_PROFILE_ID ?? env.LIMITLESS_LIVE_SUBMIT_PROFILE_ID,
  liveExecutionEnabled: env.LIMITLESS_LIVE_EXECUTION_ENABLED === "true"
});

const createLimitlessOrderClient = (config: LimitlessExecutionAdapterConfig): LimitlessOrderClient => {
  const baseUrl = config.baseUrl;
  if (!nonEmpty(baseUrl)) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_ENV_INCOMPLETE",
      "Limitless live execution requires LIMITLESS_BASE_URL."
    );
  }
  if (config.executionMode === "delegated_partner_server_wallet") {
    const tokenId = config.hmacTokenId;
    const secret = config.hmacSecret;
    if (config.partnerAccountEnabled !== true || !nonEmpty(tokenId) || !nonEmpty(secret)) {
      throw new LimitlessExecutionNotConfiguredError(
        "LIMITLESS_ENV_INCOMPLETE",
        "Limitless delegated live execution requires LIMITLESS_PARTNER_ACCOUNT_ENABLED=true, LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID, and LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET."
      );
    }
    const client = new Client({
      baseURL: baseUrl,
      hmacCredentials: {
        tokenId,
        secret
      }
    });
    return {
      createOrder: (input) => client.delegatedOrders.createOrder({
        marketSlug: input.marketSlug,
        orderType: input.orderType,
        onBehalfOf: requireDelegatedProfileId(input.onBehalfOf),
        args: {
          tokenId: input.tokenId,
          side: input.side,
          size: input.size,
          price: input.price
        }
      }),
      cancel: (orderId, onBehalfOf) => client.delegatedOrders.cancelOnBehalfOf(orderId, requireDelegatedProfileId(onBehalfOf))
    };
  }
  const apiKey = config.apiKey;
  const privateKey = config.privateKey;
  if (!nonEmpty(apiKey) || !nonEmpty(privateKey)) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_ENV_INCOMPLETE",
      "Limitless live execution requires LIMITLESS_BASE_URL, LIMITLESS_API_KEY, and LIMITLESS_EXECUTION_PRIVATE_KEY."
    );
  }
  const client = new Client({
    baseURL: baseUrl,
    apiKey
  });
  const orderClient = client.newOrderClient(privateKey);
  return {
    createOrder: (input) => orderClient.createOrder(input),
    cancel: (orderId) => orderClient.cancel(orderId)
  };
};

const parseExecutionMode = (value: string | undefined): LimitlessExecutionMode =>
  value === "backend_signer" || value === "delegated_partner_server_wallet" ? value : "disabled";

const requireDelegatedProfileId = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_DELEGATED_PROFILE_REQUIRED",
      "Limitless delegated execution requires a positive delegated profile id."
    );
  }
  return value;
};

const parseSize = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new LimitlessExecutionNotConfiguredError("LIMITLESS_INVALID_ORDER_SIZE", "Limitless order size must be positive.");
  }
  return parsed;
};

const parsePrice = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new LimitlessExecutionNotConfiguredError("LIMITLESS_INVALID_ORDER_PRICE", "Limitless order price must be between 0 and 1.");
  }
  return value;
};

const mapSide = (side: ExecutionLegV0["side"]): Side =>
  side === "sell" ? Side.SELL : Side.BUY;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

const payloadString = (
  payload: Record<string, unknown>,
  key: "marketSlug" | "tokenId"
): string => {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_INVALID_PREPARED_ORDER",
      `Limitless prepared order is missing ${key}.`
    );
  }
  return value;
};

const parseDelegatedProfileId = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
};

export class LimitlessExecutionAdapter implements ExecutionVenueAdapter {
  public readonly venue = "LIMITLESS";
  private client: LimitlessOrderClient | undefined;

  public constructor(
    private readonly config: LimitlessExecutionAdapterConfig,
    client?: LimitlessOrderClient
  ) {
    this.client = client;
  }

  public status(): LimitlessExecutionAdapterEnvStatus {
    return getLimitlessExecutionAdapterEnvStatus({
      LIMITLESS_EXECUTION_MODE: this.config.executionMode,
      LIMITLESS_BASE_URL: this.config.baseUrl,
      LIMITLESS_API_KEY: this.config.apiKey,
      LIMITLESS_EXECUTION_PRIVATE_KEY: this.config.privateKey,
      LIMITLESS_PARTNER_ACCOUNT_ENABLED: String(this.config.partnerAccountEnabled === true),
      LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID: this.config.hmacTokenId,
      LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET: this.config.hmacSecret,
      LIMITLESS_LIVE_EXECUTION_ENABLED: String(this.config.liveExecutionEnabled)
    });
  }

  private getClient(): LimitlessOrderClient {
    this.client ??= createLimitlessOrderClient(this.config);
    return this.client;
  }

  public async prepareOrder(leg: ExecutionLegV0): Promise<PreparedVenueOrder> {
    const status = this.status();
    if (!status.dryRunRequiredEnvPresent) {
      throw new LimitlessExecutionNotConfiguredError(
        "LIMITLESS_NOT_CONFIGURED",
        `Limitless dry-run env is incomplete: ${status.missingDryRunEnv.join(", ")}.`
      );
    }
    const size = parseSize(leg.size);
    const price = parsePrice(leg.price);
    return {
      venue: this.venue,
      clientOrderId: leg.executionLegId,
      payload: {
        marketSlug: leg.venueMarketId,
        tokenId: leg.venueOutcomeId,
        side: mapSide(leg.side),
        size,
        price,
        orderType: OrderType.GTC,
        ...(status.executionMode === "delegated_partner_server_wallet" && this.config.delegatedProfileId
          ? { delegatedProfileId: this.config.delegatedProfileId }
          : {}),
        metadata: {
          adapter: "LimitlessExecutionAdapter",
          readinessState: status.readinessState,
          dryRun: true,
          executionSigningModel: status.executionSigningModel
        }
      }
    };
  }

  public async submitOrder(order: PreparedVenueOrder): Promise<VenueSubmitResult> {
    const status = this.status();
    if (!status.liveExecutionEnabled) {
      throw new LimitlessExecutionNotConfiguredError(
        "LIMITLESS_LIVE_EXECUTION_DISABLED",
        "LIMITLESS_LIVE_EXECUTION_ENABLED is false; dry-run orders cannot be submitted."
      );
    }
    if (status.readinessState !== "LIVE_READY") {
      throw new LimitlessExecutionNotConfiguredError(
        "LIMITLESS_ENV_INCOMPLETE",
        `Limitless live execution env is incomplete: ${status.missingEnv.join(", ")}.`
      );
    }
    const payload = asRecord(order.payload);
    const size = parseSize(String(payload.size ?? ""));
    const price = parsePrice(Number(payload.price));
    const onBehalfOf = status.executionMode === "delegated_partner_server_wallet"
      ? parseDelegatedProfileId(payload.delegatedProfileId ?? this.config.delegatedProfileId)
      : undefined;
    if (status.executionMode === "delegated_partner_server_wallet" && onBehalfOf === undefined) {
      throw new LimitlessExecutionNotConfiguredError(
        "LIMITLESS_DELEGATED_PROFILE_REQUIRED",
        "Limitless delegated execution requires a delegated profile id from the active server-wallet account binding."
      );
    }
    const response = await this.getClient().createOrder({
      marketSlug: payloadString(payload, "marketSlug"),
      tokenId: payloadString(payload, "tokenId"),
      side: payload.side === Side.SELL ? Side.SELL : Side.BUY,
      price,
      size,
      orderType: OrderType.GTC,
      onBehalfOf
    });
    const orderRecord = response.order;
    return {
      venueOrderId: String(orderRecord.id),
      status: "SUBMITTED",
      filledSize: "0",
      averagePrice: Number(orderRecord.price ?? payload.price ?? 0)
    };
  }

  public async fetchFillState(venueOrderId: string): Promise<VenueFillState> {
    const profileId = parseDelegatedProfileId(this.config.delegatedProfileId);
    const clientFillState = await this.client?.getFillState?.(venueOrderId, profileId);
    if (clientFillState) {
      return clientFillState;
    }
    return {
      status: this.config.fillStateOverride ?? "OPEN",
      filledSize: "0",
      averagePrice: 0,
      offchainFilled: false
    };
  }

  public async cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }> {
    const profileId = this.status().executionMode === "delegated_partner_server_wallet"
      ? parseDelegatedProfileId(this.config.delegatedProfileId)
      : undefined;
    await this.getClient().cancel(venueOrderId, profileId);
    return { cancelled: true };
  }

  public async fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState> {
    const profileId = parseDelegatedProfileId(this.config.delegatedProfileId);
    const clientSettlementState = await this.client?.getSettlementState?.(fillOrOrderId, profileId);
    if (clientSettlementState) {
      return clientSettlementState;
    }
    return {
      status: this.config.settlementStateOverride ?? "SETTLEMENT_PENDING",
      evidence: {
        source: "limitless_execution_adapter",
        fillOrOrderId,
        delegatedProfileScoped: this.status().executionMode === "delegated_partner_server_wallet",
        settlementEvidenceSupported: false
      }
    };
  }

  public normalizeVenueError(error: unknown): NormalizedVenueError {
    if (error instanceof LimitlessExecutionNotConfiguredError) {
      return {
        code: error.reasonCode === "LIMITLESS_LIVE_EXECUTION_DISABLED"
          ? "LIMITLESS_LIVE_EXECUTION_DISABLED"
          : "VENUE_EXECUTION_NOT_CONFIGURED",
        message: error.message,
        retryable: false
      };
    }
    return {
      code: "LIMITLESS_EXECUTION_ADAPTER_ERROR",
      message: error instanceof Error ? error.message : "Unknown Limitless execution adapter error.",
      retryable: false
    };
  }
}
