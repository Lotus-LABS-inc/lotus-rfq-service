import { FundingError, type FundingRouteQuote, type FundingRouteLeg, type FundingVenue } from "../../core/funding/types.js";

export interface LifiClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  quoteTtlSeconds: number;
  quotesEnabled: boolean;
}

export interface LifiQuoteRequest {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress: string;
  targetVenue: FundingVenue;
}

export interface LifiStatusRequest {
  txHash: string;
  fromChain: string;
  toChain: string;
  bridge?: string;
}

export type NormalizedLifiStatus =
  | "PENDING"
  | "DONE_COMPLETED"
  | "DONE_PARTIAL"
  | "DONE_REFUNDED"
  | "FAILED"
  | "NOT_FOUND"
  | "UNKNOWN";

export interface LifiRouteProvider {
  quote(input: LifiQuoteRequest): Promise<FundingRouteQuote>;
  status(input: LifiStatusRequest): Promise<{ status: NormalizedLifiStatus; raw: Record<string, unknown> }>;
}

export class LifiRestClient implements LifiRouteProvider {
  public constructor(private readonly config: LifiClientConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  public async quote(input: LifiQuoteRequest): Promise<FundingRouteQuote> {
    if (!this.config.quotesEnabled) {
      throw new FundingError("LIFI_QUOTES_DISABLED", "LI.FI funding quotes are disabled.", 503);
    }

    const url = new URL("/v1/quote", this.config.baseUrl);
    url.searchParams.set("fromChain", toLifiChain(input.fromChain));
    url.searchParams.set("toChain", toLifiChain(input.toChain));
    url.searchParams.set("fromToken", input.fromToken);
    url.searchParams.set("toToken", input.toToken);
    url.searchParams.set("fromAmount", toBaseUnitAmount(input.fromAmount, input.fromToken));
    url.searchParams.set("fromAddress", input.fromAddress);
    url.searchParams.set("toAddress", input.toAddress);

    const response = await this.fetchJson(url);
    return normalizeLifiQuote(response, input, this.config.quoteTtlSeconds);
  }

  public async status(input: LifiStatusRequest): Promise<{ status: NormalizedLifiStatus; raw: Record<string, unknown> }> {
    const url = new URL("/v1/status", this.config.baseUrl);
    url.searchParams.set("txHash", input.txHash);
    url.searchParams.set("fromChain", toLifiChain(input.fromChain));
    url.searchParams.set("toChain", toLifiChain(input.toChain));
    if (input.bridge) {
      url.searchParams.set("bridge", input.bridge);
    }
    const response = await this.fetchJson(url);
    return {
      status: normalizeLifiStatus(response),
      raw: redactProviderPayload(response)
    };
  }

  private async fetchJson(url: URL): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (this.config.apiKey) {
        headers["x-lifi-api-key"] = this.config.apiKey;
      }
      const response = await this.fetchImpl(url, { method: "GET", headers, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new FundingError("ROUTE_QUOTE_FAILED", safeProviderMessage(body, response.statusText), 502);
      }
      if (!isRecord(body)) {
        throw new FundingError("ROUTE_QUOTE_FAILED", "LI.FI returned an invalid response.", 502);
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const buildLifiClientConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): LifiClientConfig => ({
  baseUrl: env.LIFI_API_BASE_URL || "https://li.quest",
  ...(env.LIFI_API_KEY ? { apiKey: env.LIFI_API_KEY } : {}),
  timeoutMs: Number.parseInt(env.LIFI_QUOTE_TIMEOUT_MS || "10000", 10),
  quoteTtlSeconds: Number.parseInt(env.LIFI_QUOTE_TTL_SECONDS || "60", 10),
  quotesEnabled: env.FUNDING_LIFI_QUOTES_ENABLED === "true"
});

export const normalizeLifiQuote = (
  payload: Record<string, unknown>,
  input: LifiQuoteRequest,
  quoteTtlSeconds: number
): FundingRouteQuote => {
  const action = isRecord(payload.action) ? payload.action : {};
  const estimate = isRecord(payload.estimate) ? payload.estimate : {};
  const transactionRequest = isRecord(payload.transactionRequest) ? payload.transactionRequest : null;
  const rawToAmount = stringValue(estimate.toAmount) ?? stringValue(payload.toAmount) ?? "0";
  const toAmount = fromBaseUnitAmount(rawToAmount, input.toToken);
  const feeCosts = Array.isArray(estimate.feeCosts) ? estimate.feeCosts : [];
  const gasCosts = Array.isArray(estimate.gasCosts) ? estimate.gasCosts : [];
  const estimatedFees = String(feeCosts.length + gasCosts.length);
  const expiresAt = new Date(Date.now() + quoteTtlSeconds * 1000).toISOString();
  const destinationChain = stringValue(action.toChainId) ?? input.toChain;
  const destinationToken = stringValue(action.toToken?.address) ?? input.toToken;

  if (destinationChain !== input.toChain || destinationToken.toLowerCase() !== input.toToken.toLowerCase()) {
    throw new FundingError("ROUTE_DESTINATION_MISMATCH", "LI.FI quote destination does not match venue capability.", 502);
  }

  return {
    provider: "LIFI",
    providerRouteId: stringValue(payload.id) ?? stringValue(payload.tool) ?? null,
    sourceChain: input.fromChain,
    sourceToken: input.fromToken,
    sourceAmount: input.fromAmount,
    destinationChain: input.toChain,
    destinationToken: input.toToken,
    destinationAmountEstimate: toAmount,
    estimatedFees,
    estimatedTimeSeconds: numberValue(estimate.executionDuration),
    expiresAt,
    transactionRequest: transactionRequest ? safeTransactionRequest(transactionRequest) : null,
    userSafeSummary: `Route ${input.fromAmount} from ${input.fromChain} to ${input.targetVenue} via LI.FI.`
  };
};

export const toLifiChain = (chain: string): string => {
  const normalized = chain.trim().toUpperCase();
  if (normalized === "SOLANA") return "SOL";
  if (normalized === "POLYGON") return "137";
  if (normalized === "BSC" || normalized === "BNB" || normalized === "BNB_SMART_CHAIN") return "56";
  return chain;
};

export const toBaseUnitAmount = (amount: string, token: string): string => {
  const decimals = tokenDecimals(token);
  if (decimals === null) {
    return amount;
  }
  const [whole, fraction = ""] = amount.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const normalized = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "");
  return normalized.length > 0 ? normalized : "0";
};

export const fromBaseUnitAmount = (amount: string, token: string): string => {
  const decimals = tokenDecimals(token);
  if (decimals === null) {
    return amount;
  }
  const padded = amount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
};

export const normalizeLifiStatus = (payload: Record<string, unknown>): NormalizedLifiStatus => {
  const status = String(payload.status ?? "").toUpperCase();
  const substatus = String(payload.substatus ?? "").toUpperCase();
  if (status === "PENDING") return "PENDING";
  if (status === "NOT_FOUND") return "NOT_FOUND";
  if (status === "FAILED") return "FAILED";
  if (status === "DONE" && substatus === "PARTIAL") return "DONE_PARTIAL";
  if (status === "DONE" && substatus === "REFUNDED") return "DONE_REFUNDED";
  if (status === "DONE" || status === "COMPLETED") return "DONE_COMPLETED";
  return "UNKNOWN";
};

export const isQuoteExpired = (leg: Pick<FundingRouteLeg, "routeQuote">, now = new Date()): boolean =>
  new Date(leg.routeQuote.expiresAt).getTime() <= now.getTime();

const safeTransactionRequest = (value: Record<string, unknown>) => ({
  ...(typeof value.to === "string" ? { to: value.to } : {}),
  ...(typeof value.from === "string" ? { from: value.from } : {}),
  ...(typeof value.data === "string" ? { data: value.data } : {}),
  ...(typeof value.value === "string" || typeof value.value === "number" ? { value: String(value.value) } : {}),
  ...(typeof value.chainId === "number" ? { chainId: value.chainId } : {}),
  ...(typeof value.gasLimit === "string" || typeof value.gasLimit === "number" ? { gasLimit: String(value.gasLimit) } : {}),
  ...(typeof value.gasPrice === "string" || typeof value.gasPrice === "number" ? { gasPrice: String(value.gasPrice) } : {})
});

const redactProviderPayload = (value: Record<string, unknown>): Record<string, unknown> => {
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/key|secret|token|passphrase|authorization/i.test(key)) {
      redacted[key] = "[REDACTED]";
    } else if (isRecord(entry)) {
      redacted[key] = redactProviderPayload(entry);
    } else {
      redacted[key] = entry;
    }
  }
  return redacted;
};

const safeProviderMessage = (body: unknown, fallback: string): string => {
  if (isRecord(body) && typeof body.message === "string") {
    return body.message;
  }
  return fallback || "LI.FI request failed.";
};

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return null;
};

const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const tokenDecimals = (token: string): number | null => {
  const normalized = token.trim();
  if (/^(USDC|USDT|USD1)$/i.test(normalized)) {
    return 6;
  }
  if (normalized === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
    return 6;
  }
  if (/^0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174$/i.test(normalized)) {
    return 6;
  }
  return null;
};
