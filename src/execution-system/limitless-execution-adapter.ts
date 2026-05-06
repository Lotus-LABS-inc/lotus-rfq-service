import {
  Client,
  HttpClient,
  OrderType,
  Side,
  type OrderResponse
} from "@limitless-exchange/sdk";
import { verifyTypedData } from "@ethersproject/wallet";
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
export type LimitlessExecutionMode =
  | "disabled"
  | "backend_signer"
  | "delegated_partner_server_wallet"
  | "user_signed_backend_relay";

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
  executionSigningModel: "BACKEND_SIGNER" | "DELEGATED_BACKEND_SIGNER" | "USER_SIGNED_BACKEND_RELAY";
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
  getOrderStatus?(orderId: string, onBehalfOf?: number | undefined): Promise<unknown>;
  getFillState?(orderId: string, onBehalfOf?: number | undefined): Promise<VenueFillState>;
  getSettlementState?(orderId: string, onBehalfOf?: number | undefined): Promise<VenueSettlementState>;
}

export interface LimitlessUserSignedRelayClient {
  submitSignedOrder(input: {
    onBehalfOf: number;
    ownerId: number;
    signedPayload: Record<string, unknown>;
  }): Promise<unknown>;
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
  const partnerMode = executionMode === "delegated_partner_server_wallet" || executionMode === "user_signed_backend_relay";
  const missingEnv = partnerMode
    ? limitlessDelegatedExecutionRequiredEnvKeys.filter((key) => key === "LIMITLESS_PARTNER_ACCOUNT_ENABLED"
      ? env[key] !== "true"
      : !nonEmpty(env[key]))
    : limitlessExecutionRequiredEnvKeys.filter((key) => !nonEmpty(env[key]));
  const missingDryRunEnv = limitlessExecutionDryRunRequiredEnvKeys.filter((key) => !nonEmpty(env[key]));
  const featureFlagSelected = executionMode === "backend_signer" ||
    executionMode === "delegated_partner_server_wallet" ||
    executionMode === "user_signed_backend_relay";
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
    executionSigningModel: executionMode === "user_signed_backend_relay"
      ? "USER_SIGNED_BACKEND_RELAY"
      : executionMode === "delegated_partner_server_wallet"
        ? "DELEGATED_BACKEND_SIGNER"
        : "BACKEND_SIGNER",
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
      cancel: (orderId, onBehalfOf) => client.delegatedOrders.cancelOnBehalfOf(orderId, requireDelegatedProfileId(onBehalfOf)),
      getOrderStatus: (orderId, onBehalfOf) => fetchLimitlessOrderStatusBatch(
        createLimitlessHttpClient({
          baseUrl,
          hmacTokenId: tokenId,
          hmacSecret: secret,
          onBehalfOf: requireDelegatedProfileId(onBehalfOf)
        }),
        orderId
      )
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
  const statusHttpClient = createLimitlessHttpClient({
    baseUrl,
    apiKey
  });
  const orderClient = client.newOrderClient(privateKey);
  return {
    createOrder: (input) => orderClient.createOrder(input),
    cancel: (orderId) => orderClient.cancel(orderId),
    getOrderStatus: (orderId) => fetchLimitlessOrderStatusBatch(statusHttpClient, orderId)
  };
};

const createLimitlessUserSignedRelayClient = (config: LimitlessExecutionAdapterConfig): LimitlessUserSignedRelayClient => {
  const baseUrl = config.baseUrl;
  const tokenId = config.hmacTokenId;
  const secret = config.hmacSecret;
  if (!nonEmpty(baseUrl) || config.partnerAccountEnabled !== true || !nonEmpty(tokenId) || !nonEmpty(secret)) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_ENV_INCOMPLETE",
      "Limitless user-signed relay requires LIMITLESS_BASE_URL, LIMITLESS_PARTNER_ACCOUNT_ENABLED=true, LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID, and LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET."
    );
  }
  const httpClient = createLimitlessHttpClient({
    baseUrl,
    hmacTokenId: tokenId,
    hmacSecret: secret
  });
  return {
    submitSignedOrder: (input) => httpClient.post("/orders", {
      ...input.signedPayload,
      onBehalfOf: input.onBehalfOf,
      ownerId: input.ownerId
    })
  };
};

const parseExecutionMode = (value: string | undefined): LimitlessExecutionMode =>
  value === "backend_signer" || value === "delegated_partner_server_wallet" || value === "user_signed_backend_relay"
    ? value
    : "disabled";

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

const createLimitlessHttpClient = (input: {
  baseUrl: string;
  apiKey?: string | undefined;
  hmacTokenId?: string | undefined;
  hmacSecret?: string | undefined;
  onBehalfOf?: number | undefined;
}): HttpClient => new HttpClient({
  baseURL: input.baseUrl,
  ...(input.hmacTokenId && input.hmacSecret
    ? {
        hmacCredentials: {
          tokenId: input.hmacTokenId,
          secret: input.hmacSecret
        }
      }
    : {}),
  ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  ...(input.onBehalfOf ? { additionalHeaders: { "x-on-behalf-of": String(input.onBehalfOf) } } : {})
});

const fetchLimitlessOrderStatusBatch = async (
  httpClient: HttpClient,
  orderId: string
): Promise<unknown> => {
  const response = await httpClient.post("/orders/status/batch", {
    items: [{ orderId }]
  });
  const results = Array.isArray(asRecord(response).results) ? asRecord(response).results as unknown[] : [];
  return results[0] ?? {
    status: "not_found",
    orderId,
    error: "Limitless order status batch response did not include a result."
  };
};

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const stringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const booleanValue = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const nestedRecord = (root: Record<string, unknown>, ...path: string[]): Record<string, unknown> => {
  let current: Record<string, unknown> = root;
  for (const key of path) {
    current = asRecord(current[key]);
  }
  return current;
};

const selectLimitlessOrderStatusData = (payload: unknown): {
  result: Record<string, unknown>;
  data: Record<string, unknown>;
  execution: Record<string, unknown>;
  makerMatches: unknown[];
} => {
  const result = asRecord(payload);
  const data = asRecord(result.data);
  const nestedOrder = asRecord(data.order);
  const execution = Object.keys(asRecord(nestedOrder.execution)).length > 0
    ? asRecord(nestedOrder.execution)
    : asRecord(data.execution);
  const makerMatches = asArray(data.makerMatches).length > 0
    ? asArray(data.makerMatches)
    : asArray(nestedOrder.makerMatches);
  return { result, data, execution, makerMatches };
};

const settlementStatusFromLimitless = (value: unknown): string =>
  `${value ?? ""}`.trim().toUpperCase();

const finalSettlementStatuses = new Set([
  "MINED",
  "SETTLED",
  "SETTLEMENT_VERIFIED",
  "COMPLETED",
  "CONFIRMED",
  "FINALIZED"
]);

const failedSettlementStatuses = new Set([
  "FAILED",
  "REJECTED",
  "REVERTED",
  "ERROR"
]);

const cancelledOrderStatuses = new Set([
  "CANCELLED",
  "CANCELED"
]);

const decimalFromSixDecimals = (value: unknown): string | null => {
  const raw = stringOrNull(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : null);
  if (!raw) {
    return null;
  }
  if (raw.includes(".")) {
    return raw;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const padded = raw.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "") || "0";
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

const sumMatchedSize = (matches: unknown[]): string | null => {
  const total = matches.reduce<number>((sum, match) => {
    const record = asRecord(match);
    const normalized = decimalFromSixDecimals(record.matchedSize ?? record.size ?? record.amount);
    return normalized ? sum + Number(normalized) : sum;
  }, 0);
  return total > 0 ? String(total) : null;
};

const filledSizeFromLimitlessStatus = (payload: unknown): string => {
  const { execution, makerMatches } = selectLimitlessOrderStatusData(payload);
  return sumMatchedSize(makerMatches)
    ?? decimalFromSixDecimals(nestedRecord(execution, "totalsRaw").contractsNet)
    ?? decimalFromSixDecimals(nestedRecord(execution, "totalsRaw").contractsGross)
    ?? decimalFromSixDecimals(execution.matchedSize)
    ?? "0";
};

const priceFromLimitlessStatus = (payload: unknown): number => {
  const { data, execution } = selectLimitlessOrderStatusData(payload);
  const order = nestedRecord(data, "order", "order");
  const value = execution.price ?? order.price ?? data.price;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const hasLimitlessFillEvidence = (payload: unknown): boolean => {
  const { execution, makerMatches } = selectLimitlessOrderStatusData(payload);
  const matched = booleanValue(execution.matched) === true;
  return matched && (
    makerMatches.length > 0
    || stringOrNull(execution.tradeEventId) !== null
    || stringOrNull(execution.txHash) !== null
    || Number(filledSizeFromLimitlessStatus(payload)) > 0
  );
};

export const mapLimitlessOrderStatusToFillState = (payload: unknown): VenueFillState => {
  const { result, execution } = selectLimitlessOrderStatusData(payload);
  const resultStatus = settlementStatusFromLimitless(result.status);
  const executionStatus = settlementStatusFromLimitless(execution.settlementStatus ?? execution.status);
  if (cancelledOrderStatuses.has(resultStatus) || cancelledOrderStatuses.has(executionStatus)) {
    return { status: "CANCELLED", filledSize: "0", averagePrice: 0, offchainFilled: false };
  }
  if (failedSettlementStatuses.has(resultStatus) || failedSettlementStatuses.has(executionStatus)) {
    return { status: "FAILED", filledSize: "0", averagePrice: 0, offchainFilled: false };
  }
  if (hasLimitlessFillEvidence(payload)) {
    return {
      status: "FILLED",
      filledSize: filledSizeFromLimitlessStatus(payload),
      averagePrice: priceFromLimitlessStatus(payload),
      offchainFilled: false
    };
  }
  return {
    status: "OPEN",
    filledSize: "0",
    averagePrice: 0,
    offchainFilled: false
  };
};

export const mapLimitlessOrderStatusToSettlementState = (
  payload: unknown,
  input: { orderId: string; delegatedProfileId?: number | undefined }
): VenueSettlementState => {
  const { result, execution, makerMatches } = selectLimitlessOrderStatusData(payload);
  const resultStatus = settlementStatusFromLimitless(result.status);
  const settlementStatus = settlementStatusFromLimitless(execution.settlementStatus ?? execution.status);
  const fillEvidenceVerified = hasLimitlessFillEvidence(payload);
  const settlementEvidenceVerified = fillEvidenceVerified && finalSettlementStatuses.has(settlementStatus);
  const evidence = {
    source: "limitless_order_status_batch",
    orderId: input.orderId,
    delegatedProfileScoped: input.delegatedProfileId !== undefined,
    delegatedProfileIdConfigured: input.delegatedProfileId !== undefined,
    resultStatus: resultStatus || null,
    executionMatched: booleanValue(execution.matched),
    settlementStatus: settlementStatus || null,
    tradeEventId: stringOrNull(execution.tradeEventId),
    txHash: stringOrNull(execution.txHash),
    makerMatchesCount: makerMatches.length,
    fillEvidenceVerified,
    settlementEvidenceVerified
  };
  if (settlementEvidenceVerified) {
    return { status: "SETTLEMENT_VERIFIED", evidence };
  }
  if (failedSettlementStatuses.has(resultStatus) || failedSettlementStatuses.has(settlementStatus)) {
    return { status: "SETTLEMENT_UNKNOWN", evidence };
  }
  return { status: "SETTLEMENT_PENDING", evidence };
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

const normalizeAddress = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed.toLowerCase() : null;
};

const normalizeSignature = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{130}$/.test(trimmed) ? trimmed : null;
};

const verifyLimitlessTypedSignature = (
  signedPayload: Record<string, unknown>,
  signature: string,
  expectedSigner: string
): void => {
  const typedData = asRecord(firstPresent(signedPayload.typedData, signedPayload.eip712, signedPayload.eip712TypedData));
  const domain = asRecord(typedData.domain);
  const types = asRecord(typedData.types);
  const message = asRecord(firstPresent(typedData.message, typedData.value));
  if (Object.keys(domain).length === 0 || Object.keys(types).length === 0 || Object.keys(message).length === 0) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_RELAY_TYPED_DATA_REQUIRED",
      "Limitless user-signed relay requires the EIP-712 typed data used for the user signature."
    );
  }
  const { EIP712Domain: _ignored, ...primaryTypes } = types;
  try {
    const recovered = verifyTypedData(domain, primaryTypes as never, message, signature).toLowerCase();
    if (recovered !== expectedSigner) {
      throw new LimitlessExecutionNotConfiguredError(
        "LIMITLESS_RELAY_SIGNATURE_SIGNER_MISMATCH",
        "Limitless EIP-712 signature does not recover to the linked Turnkey wallet."
      );
    }
  } catch (error) {
    if (error instanceof LimitlessExecutionNotConfiguredError) {
      throw error;
    }
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_RELAY_SIGNATURE_INVALID",
      "Limitless EIP-712 signature could not be verified."
    );
  }
};

const normalizeOrderSide = (value: unknown): Side =>
  String(value).toLowerCase().includes("sell") || value === Side.SELL || value === 1 ? Side.SELL : Side.BUY;

const nestedValue = (root: Record<string, unknown>, ...path: string[]): unknown =>
  path.reduce<unknown>((current, key) => asRecord(current)[key], root);

const firstPresent = (...values: unknown[]): unknown =>
  values.find((value) => value !== undefined && value !== null);

const assertEqualString = (left: unknown, right: unknown, reasonCode: string, message: string): void => {
  if (String(left) !== String(right)) {
    throw new LimitlessExecutionNotConfiguredError(reasonCode, message);
  }
};

const assertEqualNumber = (left: unknown, right: unknown, reasonCode: string, message: string): void => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber) || Math.abs(leftNumber - rightNumber) > 0.00000001) {
    throw new LimitlessExecutionNotConfiguredError(reasonCode, message);
  }
};

const parsePreparedExpiry = (payload: Record<string, unknown>): number => {
  const value = payload.expiresAt;
  const parsed = typeof value === "string" ? Date.parse(value) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= Date.now()) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_PREPARED_ORDER_EXPIRED",
      "Limitless prepared user-signed relay order is expired."
    );
  }
  return parsed;
};

const validateLimitlessUserSignedRelayPayload = (
  preparedPayload: Record<string, unknown>
): {
  onBehalfOf: number;
  ownerId: number;
  signedPayload: Record<string, unknown>;
} => {
  parsePreparedExpiry(preparedPayload);
  const relayPayload = asRecord(preparedPayload.relayPayload);
  const expectedBinding = asRecord(relayPayload.expectedBinding);
  const signedPayload = asRecord(relayPayload.signedPayload);
  const signedOrder = asRecord(firstPresent(signedPayload.order, signedPayload.data, signedPayload.args, signedPayload));
  const signer = normalizeAddress(firstPresent(signedPayload.signer, signedPayload.signerAddress, signedPayload.account, signedPayload.owner, signedOrder.signer, signedOrder.maker));
  const expectedSigner = normalizeAddress(firstPresent(expectedBinding.signerAddress, expectedBinding.walletAddress, expectedBinding.venueAccountAddress));
  const expectedAccount = normalizeAddress(firstPresent(expectedBinding.venueAccountAddress, expectedBinding.walletAddress, expectedBinding.account));
  const signedAccount = normalizeAddress(firstPresent(signedPayload.account, signedPayload.owner, signedPayload.maker, signedOrder.owner, signedOrder.maker, signedOrder.signer));
  const profileId = parseDelegatedProfileId(firstPresent(expectedBinding.venueAccountId, expectedBinding.profileId, expectedBinding.ownerId));

  if (!expectedSigner || !expectedAccount || profileId === undefined) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_RELAY_BINDING_REQUIRED",
      "Limitless user-signed relay requires expected signer address, account address, and profile id."
    );
  }
  if (!signer || signer !== expectedSigner) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_RELAY_SIGNER_MISMATCH",
      "Limitless signed order signer does not match the linked Turnkey wallet."
    );
  }
  if (!signedAccount || signedAccount !== expectedAccount) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_RELAY_ACCOUNT_MISMATCH",
      "Limitless signed order account does not match the linked Limitless account."
    );
  }
  const signature = normalizeSignature(firstPresent(signedPayload.signature, signedOrder.signature));
  if (!signature) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_RELAY_SIGNATURE_REQUIRED",
      "Limitless signed order relay requires a valid EVM signature."
    );
  }
  verifyLimitlessTypedSignature(signedPayload, signature, expectedSigner);

  assertEqualString(
    firstPresent(signedPayload.marketSlug, signedPayload.market, signedOrder.marketSlug, signedOrder.market),
    preparedPayload.marketSlug,
    "LIMITLESS_RELAY_MARKET_MISMATCH",
    "Limitless signed order market does not match the prepared route leg."
  );
  assertEqualString(
    firstPresent(signedPayload.tokenId, signedOrder.tokenId, nestedValue(signedOrder, "args", "tokenId")),
    preparedPayload.tokenId,
    "LIMITLESS_RELAY_TOKEN_MISMATCH",
    "Limitless signed order token does not match the prepared route leg."
  );
  if (normalizeOrderSide(firstPresent(signedPayload.side, signedOrder.side, nestedValue(signedOrder, "args", "side"))) !== normalizeOrderSide(preparedPayload.side)) {
    throw new LimitlessExecutionNotConfiguredError(
      "LIMITLESS_RELAY_SIDE_MISMATCH",
      "Limitless signed order side does not match the prepared route leg."
    );
  }
  assertEqualNumber(
    firstPresent(signedPayload.price, signedOrder.price, nestedValue(signedOrder, "args", "price")),
    preparedPayload.price,
    "LIMITLESS_RELAY_PRICE_MISMATCH",
    "Limitless signed order price does not match the prepared route leg."
  );
  assertEqualNumber(
    firstPresent(signedPayload.size, signedOrder.size, nestedValue(signedOrder, "args", "size")),
    preparedPayload.size,
    "LIMITLESS_RELAY_SIZE_MISMATCH",
    "Limitless signed order size does not match the prepared route leg."
  );
  return {
    onBehalfOf: profileId,
    ownerId: profileId,
    signedPayload
  };
};

export class LimitlessExecutionAdapter implements ExecutionVenueAdapter {
  public readonly venue = "LIMITLESS";
  private client: LimitlessOrderClient | undefined;
  private relayClient: LimitlessUserSignedRelayClient | undefined;

  public constructor(
    private readonly config: LimitlessExecutionAdapterConfig,
    client?: LimitlessOrderClient,
    relayClient?: LimitlessUserSignedRelayClient
  ) {
    this.client = client;
    this.relayClient = relayClient;
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

  private getRelayClient(): LimitlessUserSignedRelayClient {
    this.relayClient ??= createLimitlessUserSignedRelayClient(this.config);
    return this.relayClient;
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
    const preparedAt = new Date();
    const expiresAt = new Date(preparedAt.getTime() + 5 * 60 * 1000);
    return {
      venue: this.venue,
      clientOrderId: leg.executionLegId,
      payload: {
        ...(status.executionMode === "user_signed_backend_relay"
          ? {
              relayMode: "USER_SIGNED_BACKEND_RELAY",
              signingRequired: true,
              backendMayRelaySignedPayload: true,
              backendMaySign: false,
              orderCreatePath: "/orders",
              preparedAt: preparedAt.toISOString(),
              expiresAt: expiresAt.toISOString()
            }
          : {}),
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
    if (status.executionMode === "user_signed_backend_relay") {
      const relayInput = validateLimitlessUserSignedRelayPayload(payload);
      const response = await this.getRelayClient().submitSignedOrder(relayInput);
      const responseRecord = asRecord(response);
      const orderRecord = asRecord(firstPresent(responseRecord.order, responseRecord.data, responseRecord));
      const venueOrderId = firstPresent(orderRecord.id, orderRecord.orderId, responseRecord.orderId);
      return {
        venueOrderId: String(venueOrderId ?? order.clientOrderId),
        status: "SUBMITTED",
        filledSize: "0",
        averagePrice: Number(firstPresent(orderRecord.price, payload.price, 0))
      };
    }
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
    const orderStatus = await this.client?.getOrderStatus?.(venueOrderId, profileId);
    if (orderStatus) {
      return mapLimitlessOrderStatusToFillState(orderStatus);
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
    const orderStatus = await this.client?.getOrderStatus?.(fillOrOrderId, profileId);
    if (orderStatus) {
      return mapLimitlessOrderStatusToSettlementState(orderStatus, {
        orderId: fillOrOrderId,
        delegatedProfileId: profileId
      });
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
