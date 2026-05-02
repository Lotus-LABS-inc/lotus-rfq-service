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

export const limitlessExecutionDryRunRequiredEnvKeys = [
  "LIMITLESS_BASE_URL"
] as const;

export type LimitlessExecutionRequiredEnvKey = (typeof limitlessExecutionRequiredEnvKeys)[number];
export type LimitlessExecutionDryRunRequiredEnvKey = (typeof limitlessExecutionDryRunRequiredEnvKeys)[number];

export type LimitlessExecutionReadiness =
  | "NOT_CONFIGURED"
  | "LIVE_DISABLED"
  | "LIVE_READY";

export interface LimitlessExecutionAdapterConfig {
  executionMode?: "disabled" | "backend_signer" | undefined;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  privateKey?: string | undefined;
  liveExecutionEnabled: boolean;
  settlementStateOverride?: SettlementStatusV0 | undefined;
  fillStateOverride?: VenueFillState["status"] | undefined;
}

export interface LimitlessExecutionAdapterEnvStatus {
  adapter: "LimitlessExecutionAdapter";
  venue: "LIMITLESS";
  executionSigningModel: "BACKEND_SIGNER";
  liveExecutionEnabled: boolean;
  featureFlagSelected: boolean;
  readinessState: LimitlessExecutionReadiness;
  requiredEnvPresent: boolean;
  missingEnv: readonly LimitlessExecutionRequiredEnvKey[];
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
  }): Promise<OrderResponse>;
  cancel(orderId: string): Promise<unknown>;
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
  const missingEnv = limitlessExecutionRequiredEnvKeys.filter((key) => !nonEmpty(env[key]));
  const missingDryRunEnv = limitlessExecutionDryRunRequiredEnvKeys.filter((key) => !nonEmpty(env[key]));
  const featureFlagSelected = env.LIMITLESS_EXECUTION_MODE === "backend_signer";
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
    executionSigningModel: "BACKEND_SIGNER",
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
  executionMode: env.LIMITLESS_EXECUTION_MODE === "backend_signer" ? "backend_signer" : "disabled",
  baseUrl: env.LIMITLESS_BASE_URL,
  apiKey: env.LIMITLESS_API_KEY,
  privateKey: env.LIMITLESS_EXECUTION_PRIVATE_KEY,
  liveExecutionEnabled: env.LIMITLESS_LIVE_EXECUTION_ENABLED === "true"
});

const createLimitlessOrderClient = (config: LimitlessExecutionAdapterConfig): LimitlessOrderClient => {
  const baseUrl = config.baseUrl;
  const apiKey = config.apiKey;
  const privateKey = config.privateKey;
  if (!nonEmpty(baseUrl) || !nonEmpty(apiKey) || !nonEmpty(privateKey)) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_ENV_INCOMPLETE",
      "Limitless live execution requires LIMITLESS_BASE_URL, LIMITLESS_API_KEY, and LIMITLESS_EXECUTION_PRIVATE_KEY."
    );
  }
  const client = new Client({
    baseURL: baseUrl,
    apiKey
  });
  return client.newOrderClient(privateKey);
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
        metadata: {
          adapter: "LimitlessExecutionAdapter",
          readinessState: status.readinessState,
          dryRun: true,
          executionSigningModel: "BACKEND_SIGNER"
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
    const response = await this.getClient().createOrder({
      marketSlug: payloadString(payload, "marketSlug"),
      tokenId: payloadString(payload, "tokenId"),
      side: payload.side === Side.SELL ? Side.SELL : Side.BUY,
      price,
      size,
      orderType: OrderType.GTC
    });
    const orderRecord = response.order;
    return {
      venueOrderId: String(orderRecord.id),
      status: "SUBMITTED",
      filledSize: "0",
      averagePrice: Number(orderRecord.price ?? payload.price ?? 0)
    };
  }

  public async fetchFillState(): Promise<VenueFillState> {
    return {
      status: this.config.fillStateOverride ?? "OPEN",
      filledSize: "0",
      averagePrice: 0,
      offchainFilled: false
    };
  }

  public async cancelOrder(venueOrderId: string): Promise<{ cancelled: boolean }> {
    await this.getClient().cancel(venueOrderId);
    return { cancelled: true };
  }

  public async fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState> {
    return {
      status: this.config.settlementStateOverride ?? "SETTLEMENT_PENDING",
      evidence: {
        source: "limitless_execution_adapter",
        fillOrOrderId,
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
