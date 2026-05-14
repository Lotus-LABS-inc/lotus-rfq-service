import Decimal from "decimal.js";

import type { FundingVenue } from "./types.js";
import type { FundingReadinessAuthMode } from "./venue-readiness.js";

export type PolymarketBridgeMode = "DISABLED" | "DRY_RUN";
export type PolymarketBridgeStatus = "PENDING" | "VENUE_RELEASED" | "DESTINATION_RECEIVED" | "COMPLETED" | "FAILED" | "UNKNOWN";
export type PolymarketBridgeEvidenceConfidence = "EXACT" | "PARTIAL" | "AMBIGUOUS" | "FAILED";

export interface OperatorPolymarketBridgeWithdrawalConfig {
  enabled: boolean;
  mode: PolymarketBridgeMode;
  apiBaseUrl: string | null;
  authMode: FundingReadinessAuthMode;
  timeoutMs: number;
  dryRunOnly: boolean;
  configured: boolean;
}

export interface PolymarketBridgeSupportedAsset {
  chain: string;
  chainId: string | null;
  token: string;
  tokenAddress: string | null;
  decimals: number | null;
  minCheckoutUsd: number | null;
  enabled: boolean;
}

export interface PolymarketBridgeDestinationAsset {
  chain: string;
  chainId: string;
  token: string;
  tokenAddress: string;
  decimals: number;
}

export interface PolymarketBridgeWithdrawalQuote {
  provider: "POLYMARKET_BRIDGE";
  providerQuoteId: string | null;
  sourceVenue: "POLYMARKET";
  fromChainId: string;
  fromTokenAddress: string;
  fromAmountBaseUnit: string;
  toChainId: string;
  toTokenAddress: string;
  destinationChain: string;
  destinationToken: string;
  destinationAddress: string;
  amount: string;
  estimatedFees: string;
  estimatedTimeSeconds: number | null;
  expiresAt: string;
  userSafeSummary: string;
}

export interface PolymarketBridgeUserAction {
  actionType: "USER_SEND_FROM_POLYMARKET_WALLET";
  bridgeAddress: string;
  destinationChain: string;
  destinationToken: string;
  destinationAddress: string;
  amount: string;
  expiresAt: string;
  warnings: string[];
}

export interface PolymarketBridgeRawStatus {
  status: PolymarketBridgeStatus;
  txHash: string | null;
  bridgeAddress: string | null;
  destinationChain: string | null;
  destinationToken: string | null;
  destinationAddress: string | null;
  amount: string | null;
  completedAt: string | null;
}

export interface PolymarketBridgeNormalizedEvidence {
  completed: boolean;
  venue: "POLYMARKET";
  sourceVenue: "POLYMARKET";
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
  confidence: PolymarketBridgeEvidenceConfidence;
  rejectionReason: string | null;
}

export interface PolymarketBridgeExpectedScope {
  sourceVenue: FundingVenue;
  destinationAddress: string;
  destinationChain: string;
  destinationToken: string;
  amount: string;
  txHash?: string | null;
  withdrawalIntentId?: string | null;
  routeLegId?: string | null;
  userId?: string | null;
}

export interface PolymarketBridgeEvidenceValidation {
  valid: boolean;
  rejectionReason: string | null;
}

export interface PolymarketBridgeWithdrawalClient {
  fetchSupportedAssets(): Promise<unknown>;
  fetchQuote(input: {
    destinationChain: string;
    destinationToken: string;
    destinationAddress: string;
    amount: string;
  }): Promise<unknown>;
  createWithdrawalAddress(input: PolymarketBridgeWithdrawalQuote): Promise<unknown>;
  fetchStatus(input: { txHash?: string | null; bridgeAddress?: string | null }): Promise<unknown>;
}

export interface PolymarketBridgeWithdrawalAdapterConfig {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export const getPolymarketBridgeWithdrawalConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorPolymarketBridgeWithdrawalConfig => {
  const enabled = env.POLYMARKET_BRIDGE_WITHDRAWALS_ENABLED === "true";
  const apiBaseUrl = env.POLYMARKET_BRIDGE_API_BASE_URL?.trim() || null;
  const authMode = env.POLYMARKET_BRIDGE_AUTH_MODE === "BEARER" ? "BEARER" : "NONE";
  const timeoutMs = positiveInt(env.POLYMARKET_BRIDGE_TIMEOUT_MS, 5_000);
  const dryRunOnly = env.POLYMARKET_BRIDGE_DRY_RUN_ONLY !== "false";
  return {
    enabled,
    mode: enabled ? "DRY_RUN" : "DISABLED",
    apiBaseUrl,
    authMode,
    timeoutMs,
    dryRunOnly,
    configured: enabled && isValidHttpUrl(apiBaseUrl) && dryRunOnly
  };
};

export class PolymarketBridgeWithdrawalAdapter {
  private readonly now: () => Date;

  public constructor(
    private readonly client: PolymarketBridgeWithdrawalClient,
    private readonly config: OperatorPolymarketBridgeWithdrawalConfig,
    options: PolymarketBridgeWithdrawalAdapterConfig = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public getWithdrawalCapabilities(): {
    venue: "POLYMARKET";
    supportsWithdrawal: boolean;
    supportsApiInitiatedWithdrawal: false;
    supportsUserBroadcastReference: true;
    requiresUserSignature: true;
    requiresVenueAuth: boolean;
    readinessStatus: "DISABLED" | "DRY_RUN_READY" | "NOT_CONFIGURED";
  } {
    return {
      venue: "POLYMARKET",
      supportsWithdrawal: this.config.enabled,
      supportsApiInitiatedWithdrawal: false,
      supportsUserBroadcastReference: true,
      requiresUserSignature: true,
      requiresVenueAuth: this.config.authMode === "BEARER",
      readinessStatus: !this.config.enabled ? "DISABLED" : this.config.configured ? "DRY_RUN_READY" : "NOT_CONFIGURED"
    };
  }

  public async getSupportedBridgeAssets(): Promise<PolymarketBridgeSupportedAsset[]> {
    this.assertDryRunConfigured();
    return normalizeSupportedAssets(await this.client.fetchSupportedAssets());
  }

  public async prepareWithdrawalQuote(input: {
    destinationChain: string;
    destinationToken: string;
    destinationAddress: string;
    amount: string;
  }): Promise<PolymarketBridgeWithdrawalQuote> {
    this.assertDryRunConfigured();
    assertPositiveAmount(input.amount);
    assertSafeString(input.destinationChain, "destinationChain");
    assertSafeString(input.destinationToken, "destinationToken");
    assertSafeString(input.destinationAddress, "destinationAddress");
    const destination = resolvePolymarketBridgeDestinationAsset(input.destinationChain, input.destinationToken);
    return normalizeQuote(await this.client.fetchQuote(input), input, this.now(), destination);
  }

  public async prepareUserAction(input: PolymarketBridgeWithdrawalQuote): Promise<PolymarketBridgeUserAction> {
    this.assertDryRunConfigured();
    const raw = await this.client.createWithdrawalAddress(input);
    return normalizeUserAction(raw, input);
  }

  public async fetchWithdrawalStatus(input: {
    txHash?: string | null;
    bridgeAddress?: string | null;
  }): Promise<PolymarketBridgeRawStatus> {
    this.assertDryRunConfigured();
    return normalizeStatus(await this.client.fetchStatus(input));
  }

  public normalizeWithdrawalEvidence(rawEvidence: unknown): PolymarketBridgeNormalizedEvidence {
    const raw = asRecord(rawEvidence);
    const status = normalizeStatus(raw);
    const completed = status.status === "COMPLETED" && Boolean(raw.completed);
    const userId = stringValue(raw.userId);
    const venueUserRef = stringValue(raw.venueUserRef);
    const withdrawalIntentId = stringValue(raw.withdrawalIntentId);
    const routeLegId = stringValue(raw.routeLegId) ?? stringValue(raw.withdrawalRouteLegId);
    const confidence: PolymarketBridgeEvidenceConfidence =
      completed ? "EXACT" :
        status.status === "FAILED" ? "FAILED" :
          status.status === "UNKNOWN" ? "AMBIGUOUS" :
            "PARTIAL";
    return {
      completed,
      venue: "POLYMARKET",
      sourceVenue: "POLYMARKET",
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
      rejectionReason: completed ? null : stringValue(raw.reason) ?? "POLYMARKET_BRIDGE_WITHDRAWAL_NOT_COMPLETED"
    };
  }

  public validateCompletionEvidence(input: {
    evidence: PolymarketBridgeNormalizedEvidence;
    expectedScope: PolymarketBridgeExpectedScope;
  }): PolymarketBridgeEvidenceValidation {
    const { evidence, expectedScope } = input;
    if (expectedScope.sourceVenue !== "POLYMARKET" || evidence.sourceVenue !== "POLYMARKET") {
      return rejected("POLYMARKET_BRIDGE_SOURCE_VENUE_MISMATCH");
    }
    if (!evidence.completed) {
      return rejected(evidence.rejectionReason ?? "POLYMARKET_BRIDGE_COMPLETION_FLAG_MISSING");
    }
    if (!equalsIgnoreCase(evidence.destinationAddress, expectedScope.destinationAddress)) {
      return rejected("POLYMARKET_BRIDGE_DESTINATION_ADDRESS_MISMATCH");
    }
    if (!equalsIgnoreCase(evidence.destinationChain, expectedScope.destinationChain)) {
      return rejected("POLYMARKET_BRIDGE_DESTINATION_CHAIN_MISMATCH");
    }
    if (!equalsIgnoreCase(evidence.destinationToken, expectedScope.destinationToken)) {
      return rejected("POLYMARKET_BRIDGE_DESTINATION_TOKEN_MISMATCH");
    }
    if (!amountAtLeast(evidence.amount, expectedScope.amount)) {
      return rejected("POLYMARKET_BRIDGE_AMOUNT_INSUFFICIENT");
    }
    if (expectedScope.txHash && !equalsIgnoreCase(evidence.txHash, expectedScope.txHash)) {
      return rejected("POLYMARKET_BRIDGE_TX_HASH_MISMATCH");
    }
    if (expectedScope.withdrawalIntentId && evidence.withdrawalIntentId && evidence.withdrawalIntentId !== expectedScope.withdrawalIntentId) {
      return rejected("POLYMARKET_BRIDGE_WITHDRAWAL_INTENT_SCOPE_MISMATCH");
    }
    if (expectedScope.routeLegId && evidence.routeLegId && evidence.routeLegId !== expectedScope.routeLegId) {
      return rejected("POLYMARKET_BRIDGE_ROUTE_LEG_SCOPE_MISMATCH");
    }
    if (expectedScope.userId && evidence.userId && evidence.userId !== expectedScope.userId) {
      return rejected("POLYMARKET_BRIDGE_USER_SCOPE_MISMATCH");
    }
    return { valid: true, rejectionReason: null };
  }

  public normalizeWithdrawalError(error: unknown): { code: string; message: string } {
    return {
      code: error instanceof Error ? error.name : "POLYMARKET_BRIDGE_WITHDRAWAL_ERROR",
      message: "Polymarket Bridge withdrawal adapter failed in dry-run mode."
    };
  }

  private assertDryRunConfigured(): void {
    if (!this.config.enabled) {
      throw new Error("POLYMARKET_BRIDGE_WITHDRAWALS_DISABLED");
    }
    if (!this.config.dryRunOnly) {
      throw new Error("POLYMARKET_BRIDGE_DRY_RUN_ONLY_REQUIRED");
    }
  }
}

export class MockPolymarketBridgeWithdrawalClient implements PolymarketBridgeWithdrawalClient {
  public async fetchSupportedAssets(): Promise<unknown> {
    return {
      assets: [
        { chain: "POLYGON", chainId: "137", token: "USDC", tokenAddress: POLYGON_USDC_TOKEN_ADDRESS, enabled: true },
        { chain: "BASE", chainId: "8453", token: "USDC", tokenAddress: BASE_USDC_TOKEN_ADDRESS, enabled: true }
      ]
    };
  }

  public async fetchQuote(input: {
    destinationChain: string;
    destinationToken: string;
    destinationAddress: string;
    amount: string;
  }): Promise<unknown> {
    const destination = resolvePolymarketBridgeDestinationAsset(input.destinationChain, input.destinationToken);
    return {
      quoteId: "mock-polymarket-bridge-quote",
      fromChainId: "137",
      fromTokenAddress: POLYMARKET_PUSD_TOKEN_ADDRESS,
      fromAmountBaseUnit: amountToBaseUnit(input.amount, 6),
      toChainId: destination.chainId,
      toTokenAddress: destination.tokenAddress,
      destinationChain: input.destinationChain,
      destinationToken: input.destinationToken,
      destinationAddress: input.destinationAddress,
      amount: input.amount,
      estimatedFees: "0.00",
      estimatedTimeSeconds: 600,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
  }

  public async createWithdrawalAddress(input: PolymarketBridgeWithdrawalQuote): Promise<unknown> {
    return {
      bridgeAddress: "0x2222222222222222222222222222222222222222",
      destinationChain: input.destinationChain,
      destinationToken: input.destinationToken,
      destinationAddress: input.destinationAddress,
      amount: input.amount,
      expiresAt: input.expiresAt
    };
  }

  public async fetchStatus(): Promise<unknown> {
    return {
      status: "COMPLETED",
      completed: true,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      bridgeAddress: "0x2222222222222222222222222222222222222222",
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40",
      completedAt: new Date().toISOString()
    };
  }
}

export class HttpPolymarketBridgeWithdrawalClient implements PolymarketBridgeWithdrawalClient {
  public constructor(private readonly config: {
    apiBaseUrl: string;
    timeoutMs: number;
    authMode: FundingReadinessAuthMode;
    apiKey?: string | undefined;
    fetchImpl?: typeof fetch | undefined;
  }) {}

  public async fetchSupportedAssets(): Promise<unknown> {
    return this.fetchJson("/supported-assets", { method: "GET" });
  }

  public async fetchQuote(input: {
    destinationChain: string;
    destinationToken: string;
    destinationAddress: string;
    amount: string;
  }): Promise<unknown> {
    return this.fetchJson("/quote", {
      method: "POST",
      body: JSON.stringify(toOfficialQuoteRequest(input))
    });
  }

  public async createWithdrawalAddress(input: PolymarketBridgeWithdrawalQuote): Promise<unknown> {
    return this.fetchJson("/withdraw", {
      method: "POST",
      body: JSON.stringify({
        address: POLYMARKET_WITHDRAWAL_SOURCE_WALLET_PLACEHOLDER,
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
        recipientAddr: input.destinationAddress
      })
    });
  }

  public async fetchStatus(input: { txHash?: string | null; bridgeAddress?: string | null }): Promise<unknown> {
    const reference = encodeURIComponent(input.bridgeAddress ?? input.txHash ?? "");
    if (!reference) {
      throw new Error("POLYMARKET_BRIDGE_STATUS_REFERENCE_REQUIRED");
    }
    return this.fetchJson(`/status/${reference}`, { method: "GET" });
  }

  private async fetchJson(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await (this.config.fetchImpl ?? fetch)(new URL(path, this.config.apiBaseUrl), {
        ...init,
        headers: {
          "content-type": "application/json",
          ...this.buildAuthHeader()
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`POLYMARKET_BRIDGE_HTTP_${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildAuthHeader(): Record<string, string> {
    if (this.config.authMode === "BEARER" && this.config.apiKey) {
      return { authorization: `Bearer ${this.config.apiKey}` };
    }
    return {};
  }
}

export const normalizeSupportedAssets = (rawInput: unknown): PolymarketBridgeSupportedAsset[] => {
  const raw = asRecord(rawInput);
  const assets = Array.isArray(raw.assets) ? raw.assets : Array.isArray(raw.supportedAssets) ? raw.supportedAssets : null;
  if (!assets) {
    throw new Error("POLYMARKET_BRIDGE_SUPPORTED_ASSETS_MALFORMED");
  }
  const normalized = assets.map((asset) => {
    const record = asRecord(asset);
    const tokenRecord = record.token && typeof record.token === "object" && !Array.isArray(record.token)
      ? record.token as Record<string, unknown>
      : null;
    const chain = stringValue(record.chain) ?? stringValue(record.chainName);
    const token = stringValue(record.token) ?? stringValue(record.symbol) ?? stringValue(tokenRecord?.symbol);
    if (!chain || !token) {
      throw new Error("POLYMARKET_BRIDGE_SUPPORTED_ASSET_MALFORMED");
    }
    return {
      chain,
      chainId: stringValue(record.chainId),
      token,
      tokenAddress: stringValue(record.tokenAddress) ?? stringValue(record.address) ?? stringValue(tokenRecord?.address),
      decimals: numberValue(record.decimals) ?? numberValue(tokenRecord?.decimals),
      minCheckoutUsd: numberValue(record.minCheckoutUsd),
      enabled: record.enabled !== false
    };
  });
  if (normalized.length === 0) {
    throw new Error("POLYMARKET_BRIDGE_SUPPORTED_ASSETS_EMPTY");
  }
  return normalized;
};

export const normalizeQuote = (
  rawInput: unknown,
  request: { destinationChain: string; destinationToken: string; destinationAddress: string; amount: string },
  now: Date,
  destination: PolymarketBridgeDestinationAsset = resolvePolymarketBridgeDestinationAsset(request.destinationChain, request.destinationToken)
): PolymarketBridgeWithdrawalQuote => {
  const raw = asRecord(rawInput);
  const expiresAt = stringValue(raw.expiresAt) ?? new Date(now.getTime() + 60_000).toISOString();
  return {
    provider: "POLYMARKET_BRIDGE",
    providerQuoteId: stringValue(raw.quoteId) ?? stringValue(raw.id),
    sourceVenue: "POLYMARKET",
    fromChainId: stringValue(raw.fromChainId) ?? "137",
    fromTokenAddress: stringValue(raw.fromTokenAddress) ?? POLYMARKET_PUSD_TOKEN_ADDRESS,
    fromAmountBaseUnit: stringValue(raw.fromAmountBaseUnit) ?? amountToBaseUnit(request.amount, 6),
    toChainId: stringValue(raw.toChainId) ?? destination.chainId,
    toTokenAddress: stringValue(raw.toTokenAddress) ?? destination.tokenAddress,
    destinationChain: stringValue(raw.destinationChain) ?? destination.chain,
    destinationToken: stringValue(raw.destinationToken) ?? destination.token,
    destinationAddress: stringValue(raw.destinationAddress) ?? request.destinationAddress,
    amount: stringValue(raw.amount) ?? request.amount,
    estimatedFees: stringValue(raw.estimatedFees) ?? "0",
    estimatedTimeSeconds: numberValue(raw.estimatedTimeSeconds),
    expiresAt,
    userSafeSummary: "User must complete the withdrawal action from their Polymarket wallet. Lotus will not sign or broadcast."
  };
};

export const normalizeUserAction = (
  rawInput: unknown,
  quote: PolymarketBridgeWithdrawalQuote
): PolymarketBridgeUserAction => {
  const raw = asRecord(rawInput);
  const addressRecord = raw.address && typeof raw.address === "object" && !Array.isArray(raw.address)
    ? raw.address as Record<string, unknown>
    : null;
  const bridgeAddress = stringValue(raw.bridgeAddress) ??
    stringValue(raw.address) ??
    stringValue(addressRecord?.evm) ??
    stringValue(addressRecord?.svm) ??
    stringValue(addressRecord?.btc);
  if (!bridgeAddress) {
    throw new Error("POLYMARKET_BRIDGE_USER_ACTION_ADDRESS_MISSING");
  }
  return {
    actionType: "USER_SEND_FROM_POLYMARKET_WALLET",
    bridgeAddress,
    destinationChain: stringValue(raw.destinationChain) ?? quote.destinationChain,
    destinationToken: stringValue(raw.destinationToken) ?? quote.destinationToken,
    destinationAddress: stringValue(raw.destinationAddress) ?? quote.destinationAddress,
    amount: stringValue(raw.amount) ?? quote.amount,
    expiresAt: stringValue(raw.expiresAt) ?? quote.expiresAt,
    warnings: [
      "User must send funds from their Polymarket wallet.",
      "Lotus does not sign, broadcast, custody, or move funds in this dry run."
    ]
  };
};

export const normalizeStatus = (rawInput: unknown): PolymarketBridgeRawStatus => {
  const raw = asRecord(rawInput);
  const transactions = Array.isArray(raw.transactions) ? raw.transactions : null;
  const transaction = transactions
    ? transactions.map((candidate) => asRecord(candidate)).find((candidate) => normalizeBridgeStatus(stringValue(candidate.status)) === "COMPLETED") ??
      transactions.map((candidate) => asRecord(candidate)).at(0) ??
      raw
    : raw;
  const status = normalizeBridgeStatus(stringValue(transaction.status));
  return {
    status,
    txHash: stringValue(transaction.txHash) ?? stringValue(transaction.transactionHash),
    bridgeAddress: stringValue(raw.bridgeAddress) ?? stringValue(raw.address),
    destinationChain: stringValue(transaction.destinationChain) ?? stringValue(transaction.toChainId),
    destinationToken: stringValue(transaction.destinationToken) ?? stringValue(transaction.toTokenAddress) ?? stringValue(transaction.token),
    destinationAddress: stringValue(transaction.destinationAddress) ?? stringValue(transaction.walletAddress),
    amount: stringValue(transaction.amount) ?? baseUnitToAmount(stringValue(transaction.fromAmountBaseUnit), 6),
    completedAt: stringValue(transaction.completedAt) ?? stringValue(transaction.observedAt) ?? msToIso(numberValue(transaction.createdTimeMs))
  };
};

const normalizeBridgeStatus = (status: string | null): PolymarketBridgeStatus => {
  switch (status?.toUpperCase()) {
    case "PENDING":
      return "PENDING";
    case "VENUE_RELEASED":
    case "RELEASED":
      return "VENUE_RELEASED";
    case "DESTINATION_RECEIVED":
    case "DONE":
      return "DESTINATION_RECEIVED";
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    default:
      return "UNKNOWN";
  }
};

const POLYMARKET_PUSD_TOKEN_ADDRESS = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const POLYGON_USDC_TOKEN_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const BASE_USDC_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const POLYMARKET_WITHDRAWAL_SOURCE_WALLET_PLACEHOLDER = "0x9156dd10bea4c8d7e2d591b633d1694b1d764756";

const toOfficialQuoteRequest = (input: {
  destinationChain: string;
  destinationToken: string;
  destinationAddress: string;
  amount: string;
}): Record<string, string> => {
  const destination = resolvePolymarketBridgeDestinationAsset(input.destinationChain, input.destinationToken);
  return {
    fromAmountBaseUnit: amountToBaseUnit(input.amount, 6),
    fromChainId: "137",
    fromTokenAddress: POLYMARKET_PUSD_TOKEN_ADDRESS,
    recipientAddress: input.destinationAddress,
    toChainId: destination.chainId,
    toTokenAddress: destination.tokenAddress
  };
};

export const resolvePolymarketBridgeDestinationAsset = (
  destinationChain: string,
  destinationToken: string
): PolymarketBridgeDestinationAsset => {
  const chain = normalizeDestinationChain(destinationChain);
  const token = destinationToken.trim().toUpperCase();
  if (token !== "USDC") {
    throw new Error("POLYMARKET_BRIDGE_DESTINATION_TOKEN_UNSUPPORTED");
  }
  if (chain === "POLYGON") {
    return {
      chain,
      chainId: "137",
      token,
      tokenAddress: POLYGON_USDC_TOKEN_ADDRESS,
      decimals: 6
    };
  }
  if (chain === "BASE") {
    return {
      chain,
      chainId: "8453",
      token,
      tokenAddress: BASE_USDC_TOKEN_ADDRESS,
      decimals: 6
    };
  }
  throw new Error("POLYMARKET_BRIDGE_DESTINATION_CHAIN_UNSUPPORTED");
};

export const polymarketBridgeAssetMatchesDestination = (
  asset: PolymarketBridgeSupportedAsset,
  destination: PolymarketBridgeDestinationAsset
): boolean => {
  if (!asset.enabled) {
    return false;
  }
  const assetChain = normalizeDestinationChain(asset.chainId ?? asset.chain);
  const assetToken = asset.token.trim().toUpperCase();
  const assetTokenAddress = asset.tokenAddress?.trim().toLowerCase();
  return assetChain === destination.chain &&
    assetToken === destination.token &&
    (!assetTokenAddress || assetTokenAddress === destination.tokenAddress.toLowerCase());
};

const normalizeDestinationChain = (value: string): "POLYGON" | "BASE" => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "POLYGON" || normalized === "MATIC" || normalized === "137") {
    return "POLYGON";
  }
  if (normalized === "BASE" || normalized === "8453") {
    return "BASE";
  }
  throw new Error("POLYMARKET_BRIDGE_DESTINATION_CHAIN_UNSUPPORTED");
};

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

const msToIso = (value: number | null): string | null =>
  value ? new Date(value).toISOString() : null;

const redactRawEvidence = (raw: Record<string, unknown>): Record<string, unknown> => ({
  status: stringValue(raw.status),
  txHashPresent: Boolean(stringValue(raw.txHash) ?? stringValue(raw.transactionHash)),
  bridgeAddressPresent: Boolean(stringValue(raw.bridgeAddress) ?? stringValue(raw.address)),
  destinationChain: stringValue(raw.destinationChain),
  destinationToken: stringValue(raw.destinationToken) ?? stringValue(raw.token),
  destinationAddressPresent: Boolean(stringValue(raw.destinationAddress) ?? stringValue(raw.walletAddress)),
  amount: stringValue(raw.amount),
  completedAt: stringValue(raw.completedAt) ?? stringValue(raw.observedAt)
});

const assertPositiveAmount = (amount: string): void => {
  if (!amountAtLeast(amount, "0") || new Decimal(amount).lessThanOrEqualTo(0)) {
    throw new Error("POLYMARKET_BRIDGE_AMOUNT_INVALID");
  }
};

const assertSafeString = (value: string, field: string): void => {
  if (!value.trim()) {
    throw new Error(`POLYMARKET_BRIDGE_${field.toUpperCase()}_INVALID`);
  }
};

const amountAtLeast = (observed: string | null, required: string): boolean => {
  if (!observed) {
    return false;
  }
  try {
    return Boolean(observed) && new Decimal(observed).greaterThanOrEqualTo(new Decimal(required));
  } catch {
    return false;
  }
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("POLYMARKET_BRIDGE_RESPONSE_MALFORMED");
  }
  return value as Record<string, unknown>;
};

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;

const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;

const equalsIgnoreCase = (left: string | null | undefined, right: string | null | undefined): boolean =>
  Boolean(left && right) && left!.toLowerCase() === right!.toLowerCase();

const rejected = (rejectionReason: string): PolymarketBridgeEvidenceValidation => ({
  valid: false,
  rejectionReason
});

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const isValidHttpUrl = (url: string | null): boolean => {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};
