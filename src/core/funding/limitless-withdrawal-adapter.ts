import { createHmac } from "node:crypto";
import Decimal from "decimal.js";

export type LimitlessWithdrawalAdapterMode = "DISABLED" | "DRY_RUN_READ_STATUS";
export type LimitlessWithdrawalAuthMode = "NONE" | "API_KEY" | "HMAC";
export type LimitlessWithdrawalTimestampFormat = "ISO" | "UNIX_MS";
export type LimitlessWithdrawalStatus = "PENDING" | "VENUE_RELEASED" | "DESTINATION_RECEIVED" | "COMPLETED" | "FAILED" | "UNKNOWN";
export type LimitlessWithdrawalEvidenceConfidence = "EXACT" | "PARTIAL" | "AMBIGUOUS" | "FAILED";

export interface OperatorLimitlessWithdrawalConfig {
  enabled: boolean;
  mode: LimitlessWithdrawalAdapterMode;
  apiBaseUrl: string | null;
  authMode: LimitlessWithdrawalAuthMode;
  timeoutMs: number;
  dryRunOnly: boolean;
  configured: boolean;
}

export interface LimitlessWithdrawalQuote {
  provider: "LIMITLESS_SERVER_WALLET";
  providerQuoteId: string | null;
  sourceVenue: "LIMITLESS";
  destinationChain: string;
  destinationToken: string;
  destinationAddress: string;
  tokenAddress: string;
  amount: string;
  amountBaseUnit: string;
  estimatedFees: string;
  estimatedTimeSeconds: number | null;
  expiresAt: string;
  userSafeSummary: string;
}

export interface LimitlessWithdrawalUserAction {
  actionType: "LIMITLESS_SERVER_WALLET_WITHDRAWAL_REVIEW_ONLY";
  destinationChain: string;
  destinationToken: string;
  destinationAddress: string;
  amount: string;
  amountBaseUnit: string;
  warnings: string[];
}

export interface LimitlessWithdrawalRawStatus {
  status: LimitlessWithdrawalStatus;
  txHash: string | null;
  destinationChain: string | null;
  destinationToken: string | null;
  destinationAddress: string | null;
  amount: string | null;
  completedAt: string | null;
}

export interface LimitlessWithdrawalNormalizedEvidence {
  completed: boolean;
  venue: "LIMITLESS";
  sourceVenue: "LIMITLESS";
  userId?: string;
  venueUserRef?: string;
  withdrawalIntentId?: string;
  routeLegId?: string;
  destinationAddress: string | null;
  destinationChain: string | null;
  destinationToken: string | null;
  amount: string | null;
  txHash: string | null;
  completedAt: string | null;
  rawEvidenceRedacted: Record<string, unknown>;
  confidence: LimitlessWithdrawalEvidenceConfidence;
  rejectionReason: string | null;
}

export interface LimitlessWithdrawalExpectedScope {
  sourceVenue: "LIMITLESS";
  destinationAddress: string;
  destinationChain: string;
  destinationToken: string;
  amount: string;
  txHash?: string | null;
  withdrawalIntentId?: string | null;
  routeLegId?: string | null;
  userId?: string | null;
}

export interface LimitlessWithdrawalClient {
  fetchPortfolioHistory(input: { page: number; limit: number; txHash?: string | null }): Promise<unknown>;
}

export const getLimitlessWithdrawalConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorLimitlessWithdrawalConfig => {
  const enabled = env.LIMITLESS_WITHDRAWAL_ADAPTER_ENABLED === "true";
  const apiBaseUrl = env.LIMITLESS_WITHDRAWAL_ADAPTER_BASE_URL?.trim() || env.LIMITLESS_BASE_URL?.trim() || null;
  const authMode = parseAuthMode(env.LIMITLESS_WITHDRAWAL_ADAPTER_AUTH_MODE);
  const timeoutMs = positiveInt(env.LIMITLESS_WITHDRAWAL_ADAPTER_TIMEOUT_MS, 5_000);
  const dryRunOnly = env.LIMITLESS_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY !== "false";
  return {
    enabled,
    mode: enabled ? "DRY_RUN_READ_STATUS" : "DISABLED",
    apiBaseUrl,
    authMode,
    timeoutMs,
    dryRunOnly,
    configured: enabled && dryRunOnly && isValidHttpUrl(apiBaseUrl)
  };
};

export class LimitlessWithdrawalAdapter {
  private readonly now: () => Date;

  public constructor(
    private readonly client: LimitlessWithdrawalClient,
    private readonly config: OperatorLimitlessWithdrawalConfig,
    options: { now?: () => Date } = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public getWithdrawalCapabilities(): {
    venue: "LIMITLESS";
    supportsWithdrawal: boolean;
    withdrawalMode: "AUTO_RESOLUTION_ONLY";
    userSignedWithdrawalSupported: false;
    partnerManagedWithdrawal: {
      mode: "PARTNER_MANAGED_BACKEND";
      enabled: false;
      requiresHmacAuth: true;
      requiresWithdrawalScope: true;
      requiresCustodySecurityApproval: true;
    };
    supportsApiInitiatedWithdrawal: false;
    supportsUserBroadcastReference: false;
    requiresUserSignature: false;
    requiresVenueAuth: boolean;
    readinessStatus: "DISABLED" | "DRY_RUN_READY" | "NOT_CONFIGURED";
    notes: string[];
  } {
    return {
      venue: "LIMITLESS",
      supportsWithdrawal: false,
      withdrawalMode: "AUTO_RESOLUTION_ONLY",
      userSignedWithdrawalSupported: false,
      partnerManagedWithdrawal: {
        mode: "PARTNER_MANAGED_BACKEND",
        enabled: false,
        requiresHmacAuth: true,
        requiresWithdrawalScope: true,
        requiresCustodySecurityApproval: true
      },
      supportsApiInitiatedWithdrawal: false,
      supportsUserBroadcastReference: false,
      requiresUserSignature: false,
      requiresVenueAuth: this.config.authMode !== "NONE",
      readinessStatus: !this.config.enabled ? "DISABLED" : this.config.configured ? "DRY_RUN_READY" : "NOT_CONFIGURED",
      notes: [
        "EOA/user mode is AUTO_RESOLUTION_ONLY; normal user-signed withdrawal is not supported.",
        "Dry-run/read-status only. The documented server-wallet withdraw/redeem endpoints are not called.",
        "Partner-managed backend withdrawal requires a separate custody/security review and explicit operator approval."
      ]
    };
  }

  public async prepareWithdrawalQuote(input: {
    destinationChain: string;
    destinationToken: string;
    destinationAddress: string;
    amount: string;
    tokenAddress?: string | null;
  }): Promise<LimitlessWithdrawalQuote> {
    this.assertDryRunConfigured();
    assertPositiveAmount(input.amount);
    assertSafeString(input.destinationChain, "destinationChain");
    assertSafeString(input.destinationToken, "destinationToken");
    assertSafeString(input.destinationAddress, "destinationAddress");
    const expiresAt = new Date(this.now().getTime() + 60_000).toISOString();
    return {
      provider: "LIMITLESS_SERVER_WALLET",
      providerQuoteId: null,
      sourceVenue: "LIMITLESS",
      destinationChain: input.destinationChain,
      destinationToken: input.destinationToken,
      destinationAddress: input.destinationAddress,
      tokenAddress: input.tokenAddress?.trim() || BASE_USDC_TOKEN_ADDRESS,
      amount: input.amount,
      amountBaseUnit: amountToBaseUnit(input.amount, 6),
      estimatedFees: "0",
      estimatedTimeSeconds: null,
      expiresAt,
      userSafeSummary: "Limitless server-wallet withdrawal preview only. Lotus will not call the live withdraw endpoint, sign, broadcast, or move funds in dry-run mode."
    };
  }

  public prepareUserAction(input: LimitlessWithdrawalQuote): LimitlessWithdrawalUserAction {
    this.assertDryRunConfigured();
    return {
      actionType: "LIMITLESS_SERVER_WALLET_WITHDRAWAL_REVIEW_ONLY",
      destinationChain: input.destinationChain,
      destinationToken: input.destinationToken,
      destinationAddress: input.destinationAddress,
      amount: input.amount,
      amountBaseUnit: input.amountBaseUnit,
      warnings: [
        "Limitless withdrawals use the documented server-wallet withdrawal API.",
        "This dry run does not call the live withdrawal endpoint.",
        "Lotus does not sign, broadcast, custody, or move funds."
      ]
    };
  }

  public async fetchWithdrawalStatus(input: { txHash?: string | null }): Promise<LimitlessWithdrawalRawStatus> {
    this.assertDryRunConfigured();
    return normalizeStatus(await this.client.fetchPortfolioHistory({
      page: 1,
      limit: 25,
      ...(input.txHash ? { txHash: input.txHash } : {})
    }));
  }

  public normalizeWithdrawalEvidence(rawEvidence: unknown): LimitlessWithdrawalNormalizedEvidence {
    const raw = asRecord(rawEvidence);
    const status = normalizeStatus(raw);
    const completed = status.status === "COMPLETED" && Boolean(raw.completed);
    const userId = stringValue(raw.userId);
    const venueUserRef = stringValue(raw.venueUserRef) ?? stringValue(raw.profileId) ?? stringValue(raw.onBehalfOf);
    const withdrawalIntentId = stringValue(raw.withdrawalIntentId);
    const routeLegId = stringValue(raw.routeLegId) ?? stringValue(raw.withdrawalRouteLegId);
    const confidence: LimitlessWithdrawalEvidenceConfidence =
      completed ? "EXACT" :
        status.status === "FAILED" ? "FAILED" :
          status.status === "UNKNOWN" ? "AMBIGUOUS" :
            "PARTIAL";
    return {
      completed,
      venue: "LIMITLESS",
      sourceVenue: "LIMITLESS",
      ...(userId ? { userId } : {}),
      ...(venueUserRef ? { venueUserRef } : {}),
      ...(withdrawalIntentId ? { withdrawalIntentId } : {}),
      ...(routeLegId ? { routeLegId } : {}),
      destinationAddress: status.destinationAddress,
      destinationChain: status.destinationChain,
      destinationToken: status.destinationToken,
      amount: status.amount,
      txHash: status.txHash,
      completedAt: status.completedAt,
      rawEvidenceRedacted: redactRawEvidence(raw),
      confidence,
      rejectionReason: completed ? null : stringValue(raw.reason) ?? "LIMITLESS_WITHDRAWAL_NOT_COMPLETED"
    };
  }

  public validateCompletionEvidence(input: {
    evidence: LimitlessWithdrawalNormalizedEvidence;
    expectedScope: LimitlessWithdrawalExpectedScope;
  }): { valid: boolean; rejectionReason: string | null } {
    const { evidence, expectedScope } = input;
    if (expectedScope.sourceVenue !== "LIMITLESS" || evidence.sourceVenue !== "LIMITLESS") {
      return rejected("LIMITLESS_WITHDRAWAL_SOURCE_VENUE_MISMATCH");
    }
    if (!evidence.completed) {
      return rejected(evidence.rejectionReason ?? "LIMITLESS_WITHDRAWAL_COMPLETION_FLAG_MISSING");
    }
    if (!equalsIgnoreCase(evidence.destinationAddress, expectedScope.destinationAddress)) {
      return rejected("LIMITLESS_WITHDRAWAL_DESTINATION_ADDRESS_MISMATCH");
    }
    if (!equalsIgnoreCase(evidence.destinationChain, expectedScope.destinationChain)) {
      return rejected("LIMITLESS_WITHDRAWAL_DESTINATION_CHAIN_MISMATCH");
    }
    if (!equalsIgnoreCase(evidence.destinationToken, expectedScope.destinationToken)) {
      return rejected("LIMITLESS_WITHDRAWAL_DESTINATION_TOKEN_MISMATCH");
    }
    if (!amountAtLeast(evidence.amount, expectedScope.amount)) {
      return rejected("LIMITLESS_WITHDRAWAL_AMOUNT_INSUFFICIENT");
    }
    if (expectedScope.txHash && !equalsIgnoreCase(evidence.txHash, expectedScope.txHash)) {
      return rejected("LIMITLESS_WITHDRAWAL_TX_HASH_MISMATCH");
    }
    if (expectedScope.withdrawalIntentId && evidence.withdrawalIntentId && evidence.withdrawalIntentId !== expectedScope.withdrawalIntentId) {
      return rejected("LIMITLESS_WITHDRAWAL_INTENT_SCOPE_MISMATCH");
    }
    if (expectedScope.routeLegId && evidence.routeLegId && evidence.routeLegId !== expectedScope.routeLegId) {
      return rejected("LIMITLESS_WITHDRAWAL_ROUTE_LEG_SCOPE_MISMATCH");
    }
    if (expectedScope.userId && evidence.userId && evidence.userId !== expectedScope.userId) {
      return rejected("LIMITLESS_WITHDRAWAL_USER_SCOPE_MISMATCH");
    }
    return { valid: true, rejectionReason: null };
  }

  public normalizeWithdrawalError(error: unknown): { code: string; message: string } {
    return {
      code: error instanceof Error ? error.name : "LIMITLESS_WITHDRAWAL_ADAPTER_ERROR",
      message: "Limitless withdrawal adapter failed in dry-run/read-status mode."
    };
  }

  private assertDryRunConfigured(): void {
    if (!this.config.enabled) {
      throw new Error("LIMITLESS_WITHDRAWAL_ADAPTER_DISABLED");
    }
    if (!this.config.dryRunOnly) {
      throw new Error("LIMITLESS_WITHDRAWAL_DRY_RUN_ONLY_REQUIRED");
    }
  }
}

export class MockLimitlessWithdrawalClient implements LimitlessWithdrawalClient {
  public async fetchPortfolioHistory(): Promise<unknown> {
    return {
      data: [{
        type: "withdrawal",
        status: "COMPLETED",
        transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        destination: "0x2222222222222222222222222222222222222222",
        token: { symbol: "USDC", address: BASE_USDC_TOKEN_ADDRESS, decimals: 6 },
        amount: "40",
        completedAt: new Date().toISOString()
      }],
      totalCount: 1
    };
  }
}

export class HttpLimitlessWithdrawalClient implements LimitlessWithdrawalClient {
  public constructor(private readonly config: {
    apiBaseUrl: string;
    timeoutMs: number;
    authMode: LimitlessWithdrawalAuthMode;
    apiKey?: string | undefined;
    hmacSecret?: string | undefined;
    onBehalfOfProfileId?: string | undefined;
    historyPath?: string | undefined;
    historyQuery?: string | undefined;
    timestampFormat?: LimitlessWithdrawalTimestampFormat | undefined;
    fetchImpl?: typeof fetch | undefined;
    now?: () => Date;
  }) {}

  public async fetchPortfolioHistory(input: { page: number; limit: number; txHash?: string | null }): Promise<unknown> {
    const pathWithSearch = this.buildHistoryPathWithSearch(input);
    return this.fetchJson(pathWithSearch, { method: "GET" });
  }

  private buildHistoryPathWithSearch(input: { page: number; limit: number; txHash?: string | null }): string {
    const configuredPath = normalizePath(this.config.historyPath) ?? "/portfolio/history";
    const search = this.config.historyQuery?.trim()
      ? new URLSearchParams(this.config.historyQuery.trim().replace(/^\?/, ""))
      : new URLSearchParams({
        limit: String(input.limit)
      });
    if (input.txHash && !search.has("txHash") && !search.has("transactionHash")) {
      search.set("txHash", input.txHash);
    }
    const queryString = search.toString();
    return queryString ? `${configuredPath}?${queryString}` : configuredPath;
  }

  private async fetchJson(pathWithSearch: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const url = new URL(pathWithSearch, this.config.apiBaseUrl);
    try {
      const response = await (this.config.fetchImpl ?? fetch)(url, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...this.buildAuthHeaders(init.method ?? "GET", `${url.pathname}${url.search}`, typeof init.body === "string" ? init.body : "")
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new LimitlessWithdrawalHttpError(response.status, await safeReadRedactedErrorBody(response));
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildAuthHeaders(method: string, pathWithSearch: string, body: string): Record<string, string> {
    const onBehalfOf = this.config.onBehalfOfProfileId?.trim();
    if (this.config.authMode === "API_KEY" && this.config.apiKey) {
      return {
        "X-API-Key": this.config.apiKey,
        ...(onBehalfOf ? { "x-on-behalf-of": onBehalfOf } : {})
      };
    }
    if (this.config.authMode === "HMAC" && this.config.apiKey && this.config.hmacSecret) {
      const now = (this.config.now ?? (() => new Date()))();
      const timestamp = this.config.timestampFormat === "UNIX_MS" ? String(now.getTime()) : now.toISOString();
      const payload = `${timestamp}\n${method.toUpperCase()}\n${pathWithSearch}\n${body}`;
      return {
        "lmts-api-key": this.config.apiKey,
        "lmts-timestamp": timestamp,
        "lmts-signature": createHmac("sha256", decodeBase64Secret(this.config.hmacSecret)).update(payload).digest("base64"),
        ...(onBehalfOf ? { "x-on-behalf-of": onBehalfOf } : {})
      };
    }
    return onBehalfOf ? { "x-on-behalf-of": onBehalfOf } : {};
  }
}

export class LimitlessWithdrawalHttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly redactedBody: Record<string, unknown>
  ) {
    super(`LIMITLESS_WITHDRAWAL_HTTP_${statusCode}`);
    this.name = "LimitlessWithdrawalHttpError";
  }
}

export const normalizeStatus = (rawInput: unknown): LimitlessWithdrawalRawStatus => {
  const raw = asRecord(rawInput);
  const row = selectHistoryRow(raw);
  const status = normalizeLimitlessStatus(stringValue(row.status) ?? stringValue(raw.status));
  return {
    status,
    txHash: stringValue(row.transactionHash) ?? stringValue(row.txHash) ?? stringValue(raw.transactionHash) ?? stringValue(raw.txHash),
    destinationChain: stringValue(row.destinationChain) ?? stringValue(raw.destinationChain) ?? "BASE",
    destinationToken: stringValue(row.destinationToken) ?? stringValue(asRecord(row.token).symbol) ?? stringValue(raw.destinationToken) ?? "USDC",
    destinationAddress: stringValue(row.destination) ?? stringValue(row.destinationAddress) ?? stringValue(raw.destination) ?? stringValue(raw.destinationAddress),
    amount: stringValue(row.amount) ?? stringValue(row.collateralAmount) ?? baseUnitToAmount(stringValue(row.amountBaseUnit), 6),
    completedAt: stringValue(row.completedAt) ?? stringValue(row.updatedAt) ?? unixToIso(numberValue(row.blockTimestamp))
  };
};

const selectHistoryRow = (raw: Record<string, unknown>): Record<string, unknown> => {
  const rows = Array.isArray(raw.data) ? raw.data.map((row) => asRecord(row)) : [];
  return rows.find((row) => isWithdrawalLike(row)) ?? rows[0] ?? raw;
};

const isWithdrawalLike = (row: Record<string, unknown>): boolean => {
  const type = `${stringValue(row.type) ?? ""} ${stringValue(row.strategy) ?? ""}`.toLowerCase();
  return type.includes("withdraw");
};

const normalizeLimitlessStatus = (status: string | null): LimitlessWithdrawalStatus => {
  switch (status?.toUpperCase()) {
    case "PENDING":
    case "PROCESSING":
      return "PENDING";
    case "VENUE_RELEASED":
    case "RELEASED":
      return "VENUE_RELEASED";
    case "DESTINATION_RECEIVED":
      return "DESTINATION_RECEIVED";
    case "COMPLETED":
    case "SUCCESS":
    case "CONFIRMED":
      return "COMPLETED";
    case "FAILED":
    case "REJECTED":
    case "CANCELLED":
      return "FAILED";
    default:
      return "UNKNOWN";
  }
};

const redactRawEvidence = (raw: Record<string, unknown>): Record<string, unknown> => {
  const row = selectHistoryRow(raw);
  return {
    status: stringValue(row.status) ?? stringValue(raw.status),
    txHashPresent: Boolean(stringValue(row.transactionHash) ?? stringValue(row.txHash) ?? stringValue(raw.transactionHash) ?? stringValue(raw.txHash)),
    destinationAddressPresent: Boolean(stringValue(row.destination) ?? stringValue(row.destinationAddress) ?? stringValue(raw.destinationAddress)),
    destinationChain: stringValue(row.destinationChain) ?? stringValue(raw.destinationChain),
    destinationToken: stringValue(row.destinationToken) ?? stringValue(asRecord(row.token).symbol) ?? stringValue(raw.destinationToken),
    amount: stringValue(row.amount) ?? stringValue(row.collateralAmount),
    completedAt: stringValue(row.completedAt) ?? stringValue(row.updatedAt)
  };
};

const parseAuthMode = (value: string | undefined): LimitlessWithdrawalAuthMode => {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "HMAC") {
    return "HMAC";
  }
  if (normalized === "API_KEY" || normalized === "BEARER") {
    return "API_KEY";
  }
  return "NONE";
};

const normalizePath = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    return `${url.pathname}${url.search}`;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const decodeBase64Secret = (secret: string): Buffer => {
  const normalized = secret.trim();
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
};

const BASE_USDC_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const amountToBaseUnit = (amount: string, decimals: number): string =>
  new Decimal(amount).times(new Decimal(10).pow(decimals)).toFixed(0);

const baseUnitToAmount = (amount: string | null, decimals: number): string | null => {
  if (!amount) {
    return null;
  }
  try {
    return new Decimal(amount).div(new Decimal(10).pow(decimals)).toString();
  } catch {
    return null;
  }
};

const unixToIso = (value: number | null): string | null =>
  value ? new Date(value * 1_000).toISOString() : null;

const assertPositiveAmount = (amount: string): void => {
  if (!amountAtLeast(amount, "0") || new Decimal(amount).lessThanOrEqualTo(0)) {
    throw new Error("LIMITLESS_WITHDRAWAL_AMOUNT_INVALID");
  }
};

const assertSafeString = (value: string, field: string): void => {
  if (!value.trim()) {
    throw new Error(`LIMITLESS_WITHDRAWAL_${field.toUpperCase()}_INVALID`);
  }
};

const amountAtLeast = (observed: string | null, required: string): boolean => {
  if (!observed) {
    return false;
  }
  try {
    return new Decimal(observed).greaterThanOrEqualTo(new Decimal(required));
  } catch {
    return false;
  }
};

const equalsIgnoreCase = (left: string | null | undefined, right: string | null | undefined): boolean =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

const rejected = (rejectionReason: string): { valid: false; rejectionReason: string } => ({
  valid: false,
  rejectionReason
});

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() :
    typeof value === "number" && Number.isFinite(value) ? String(value) :
      null;

const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value :
    typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) :
      null;

const safeReadRedactedErrorBody = async (response: Response): Promise<Record<string, unknown>> => {
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      return redactProviderError(await response.json());
    }
    return redactProviderError({ message: await response.text() });
  } catch {
    return {};
  }
};

const redactProviderError = (rawInput: unknown): Record<string, unknown> => {
  const raw = asRecord(rawInput);
  const details = raw.details && typeof raw.details === "object" && !Array.isArray(raw.details)
    ? raw.details as Record<string, unknown>
    : null;
  return {
    code: stringValue(raw.code) ?? stringValue(raw.error) ?? stringValue(raw.name),
    message: truncate(stringValue(raw.message) ?? stringValue(raw.detail) ?? stringValue(raw.error_description)),
    status: stringValue(raw.status),
    detailsCode: stringValue(details?.code),
    detailsMessage: truncate(stringValue(details?.message))
  };
};

const truncate = (value: string | null): string | null =>
  value ? value.slice(0, 240) : null;

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const isValidHttpUrl = (value: string | null): boolean => {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};
