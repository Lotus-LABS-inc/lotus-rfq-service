import type { ExecutionLegV0 } from "./types.js";
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
  liveExecutionEnabled: boolean;
  orderCreatePath: string;
  docsUrl: string;
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
  relayImplementationStatus: "PREPARE_ONLY";
}

export class UserSignedRelayExecutionNotConfiguredError extends Error {
  public constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = "UserSignedRelayExecutionNotConfiguredError";
  }
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

const statusFromConfig = (config: {
  adapter: UserSignedRelayAdapterName;
  venue: UserSignedRelayVenue;
  executionMode?: UserSignedRelayExecutionMode | undefined;
  baseUrl?: string | undefined;
  baseUrlEnvKey?: string | undefined;
  apiKey?: string | undefined;
  apiKeyEnvKey?: string | undefined;
  liveExecutionEnabled: boolean;
}): UserSignedRelayExecutionAdapterEnvStatus => {
  const baseUrlEnvKey = config.baseUrlEnvKey ?? `${config.venue}_EXECUTION_BASE_URL`;
  const apiKeyEnvKey = config.apiKeyEnvKey ?? `${config.venue}_EXECUTION_API_KEY`;
  const missingEnv = [
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
    relayImplementationStatus: "PREPARE_ONLY"
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
  liveExecutionEnabled: env.PREDICT_FUN_LIVE_EXECUTION_ENABLED === "true",
  orderCreatePath: env.PREDICT_FUN_EXECUTION_ORDER_CREATE_PATH ?? "/v1/oauth/orders/create",
  docsUrl: "https://dev.predict.fun/create-an-order-for-a-oauth-connection-25326914e0"
});

export class UserSignedRelayExecutionAdapter implements ExecutionVenueAdapter {
  public readonly venue: UserSignedRelayVenue;

  public constructor(private readonly config: UserSignedRelayExecutionAdapterConfig) {
    this.venue = config.venue;
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
    return {
      venue: this.venue,
      clientOrderId: leg.executionLegId,
      payload: {
        relayMode: "USER_SIGNED_BACKEND_RELAY",
        adapter: this.config.adapter,
        venue: this.venue,
        venueMarketId: leg.venueMarketId,
        venueOutcomeId: leg.venueOutcomeId,
        side: leg.side,
        size,
        price,
        orderCreatePath: this.config.orderCreatePath,
        signingRequired: true,
        backendMayRelaySignedPayload: true,
        backendMaySign: false,
        docsUrl: this.config.docsUrl,
        metadata: {
          readinessState: status.readinessState,
          relayImplementationStatus: status.relayImplementationStatus,
          credentialsServerSideOnly: true
        }
      }
    };
  }

  public async submitOrder(): Promise<VenueSubmitResult> {
    throw new UserSignedRelayExecutionNotConfiguredError(
      "USER_SIGNED_RELAY_SUBMIT_NOT_IMPLEMENTED",
      `${this.venue} backend relay submit is not implemented. User-signed payload relay must stay fail-closed until cancel/fill/status and settlement evidence are reviewed.`
    );
  }

  public async fetchFillState(): Promise<VenueFillState> {
    return {
      status: "OPEN",
      filledSize: "0",
      averagePrice: 0,
      offchainFilled: false
    };
  }

  public async fetchSettlementState(fillOrOrderId: string): Promise<VenueSettlementState> {
    return {
      status: "SETTLEMENT_PENDING",
      evidence: {
        source: `${this.venue.toLowerCase()}_user_signed_relay_adapter`,
        fillOrOrderId,
        settlementEvidenceSupported: false
      }
    };
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
