import { parseOpinionMarketList } from "./opinion-schemas.js";
import { normalizeOpinionMarketRecord } from "./opinion-market-adapter.js";
import type { OpinionNormalizedMarket } from "./opinion-types.js";

export interface OpinionCurrentDiscoveryClientConfig {
  apiKey: string | null;
  apiKeys?: readonly string[];
  baseUrl?: string;
  fallbackBaseUrl?: string | null;
  pageSize?: number;
  maxPages?: number;
  requestTimeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export interface OpinionCurrentDiscoveryResult {
  status: "SUCCESS" | "EMPTY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";
  rows: readonly OpinionNormalizedMarket[];
  primaryDiscoveryPath: string;
  fallbackDiscoveryPathUsed: string | null;
  primaryPathFailure: string | null;
  warnings: readonly string[];
  scannedRowCount?: number;
}

export interface OpinionCurrentTargetedDiscoveryInput {
  metadataVersion: string;
  matcher: (market: OpinionNormalizedMarket) => boolean;
  maxPages?: number;
  pageSize?: number;
}

const DEFAULT_PRIMARY_BASE_URL = "https://proxy.opinion.trade:8443/openapi";
const DEFAULT_FALLBACK_BASE_URL = "https://openapi.opinion.trade/openapi";
const PRIMARY_DISCOVERY_PATH = "opinion_clob_sdk_active_markets";
const FALLBACK_DISCOVERY_PATH = "opinion_openapi_market_list";

const isActivatedMarket = (market: OpinionNormalizedMarket): boolean =>
  market.status?.toUpperCase() === "ACTIVATED" || market.statusCode === 2;

const normalizeBaseUrl = (baseUrl: string): string => (baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

const toErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientDiscoveryError = (error: unknown): boolean => {
  if (error instanceof Error && error.name === "AbortError") return true;
  const message = toErrorMessage(error).toLowerCase();
  if (
    message.includes("timeout")
    || message.includes("aborted")
    || message.includes("network")
    || message.includes("fetch failed")
    || message.includes("socket")
    || message.includes("econnreset")
    || message.includes("etimedout")
  ) {
    return true;
  }
  const status = message.match(/\bhttp\s+(\d{3})\b/);
  if (!status) return false;
  const code = Number(status[1]);
  return code === 408 || code === 429 || code >= 500;
};

const retryDelayMs = (attempt: number, baseDelayMs: number, maxDelayMs: number): number => {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential * 0.25)));
  return exponential + jitter;
};

const uniqueStrings = (values: readonly (string | null | undefined)[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

export class OpinionCurrentDiscoveryClient {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly config: OpinionCurrentDiscoveryClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public async listCurrentMarkets(metadataVersion: string): Promise<OpinionCurrentDiscoveryResult> {
    return this.listMarketsInternal({
      metadataVersion,
      matcher: null
    });
  }

  public async listTargetedMarkets(input: OpinionCurrentTargetedDiscoveryInput): Promise<OpinionCurrentDiscoveryResult> {
    return this.listMarketsInternal({
      metadataVersion: input.metadataVersion,
      matcher: input.matcher,
      ...(input.maxPages !== undefined ? { maxPages: input.maxPages } : {}),
      ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {})
    });
  }

  private async listMarketsInternal(input: {
    metadataVersion: string;
    matcher: ((market: OpinionNormalizedMarket) => boolean) | null;
    maxPages?: number;
    pageSize?: number;
  }): Promise<OpinionCurrentDiscoveryResult> {
    const apiKeys = uniqueStrings([
      ...(this.config.apiKeys ?? []),
      this.config.apiKey
    ]);

    if (apiKeys.length === 0) {
      return {
        status: "NOT_CONFIGURED",
        rows: [],
        primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
        fallbackDiscoveryPathUsed: null,
        primaryPathFailure: null,
        warnings: ["OPINION_API_KEY missing"],
        scannedRowCount: 0
      };
    }

    const fallbackBaseUrl = this.config.fallbackBaseUrl
      ?? process.env.OPINION_OPENAPI_BASE_URL
      ?? DEFAULT_FALLBACK_BASE_URL;
    const warnings: string[] = [];
    let primaryPathFailure: string | null = null;
    let fallbackDiscoveryPathUsed: string | null = null;

    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
      const apiKey = apiKeys[keyIndex]!;
      try {
        const primary = await this.fetchMarketsFromBase(
          this.config.baseUrl ?? process.env.OPINION_CLOB_BASE_URL ?? DEFAULT_PRIMARY_BASE_URL,
          apiKey,
          input.metadataVersion,
          input.maxPages,
          input.pageSize
        );
        const rows = input.matcher ? primary.rows.filter(input.matcher) : primary.rows;
        return {
          status: rows.length > 0
            ? (primary.warnings.length > 0 ? "DEGRADED" : "SUCCESS")
            : "EMPTY",
          rows,
          primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
          fallbackDiscoveryPathUsed: null,
          primaryPathFailure: null,
          warnings: [
            ...warnings,
            ...primary.warnings
          ],
          scannedRowCount: primary.rows.length
        };
      } catch (primaryError) {
        const primaryMessage = toErrorMessage(primaryError);
        primaryPathFailure ??= primaryMessage;
        warnings.push(`Primary discovery path failed for key ${keyIndex + 1}: ${primaryMessage}`);
      }

      if (!fallbackBaseUrl) {
        continue;
      }

      try {
        const fallback = await this.fetchMarketsFromBase(
          fallbackBaseUrl,
          apiKey,
          input.metadataVersion,
          input.maxPages,
          input.pageSize
        );
        const rows = input.matcher ? fallback.rows.filter(input.matcher) : fallback.rows;
        fallbackDiscoveryPathUsed = FALLBACK_DISCOVERY_PATH;
        return {
          status: rows.length > 0 ? "DEGRADED" : "EMPTY",
          rows,
          primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
          fallbackDiscoveryPathUsed: FALLBACK_DISCOVERY_PATH,
          primaryPathFailure,
          warnings: [
            ...warnings,
            ...fallback.warnings
          ],
          scannedRowCount: fallback.rows.length
        };
      } catch (fallbackError) {
        fallbackDiscoveryPathUsed = FALLBACK_DISCOVERY_PATH;
        warnings.push(`Fallback discovery path failed for key ${keyIndex + 1}: ${toErrorMessage(fallbackError)}`);
      }
    }

    return {
      status: "UNAVAILABLE",
      rows: [],
      primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
      fallbackDiscoveryPathUsed,
      primaryPathFailure,
      warnings,
      scannedRowCount: 0
    };
  }

  private async fetchMarketsFromBase(
    baseUrl: string,
    apiKey: string,
    metadataVersion: string,
    overrideMaxPages?: number,
    overridePageSize?: number
  ): Promise<{ rows: readonly OpinionNormalizedMarket[]; warnings: readonly string[] }> {
    const rows = new Map<string, OpinionNormalizedMarket>();
    const warnings: string[] = [];
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const pageSize = overridePageSize ?? this.config.pageSize ?? 20;
    const maxPages = overrideMaxPages ?? this.config.maxPages ?? 20;
    const requestTimeoutMs = this.config.requestTimeoutMs ?? 10_000;
    const retryAttempts = Math.max(1, Math.floor(this.config.retryAttempts ?? (Number(process.env.OPINION_DISCOVERY_RETRY_ATTEMPTS) || 3)));
    const retryBaseDelayMs = Math.max(50, Math.floor(this.config.retryBaseDelayMs ?? (Number(process.env.OPINION_DISCOVERY_RETRY_BASE_MS) || 500)));
    const retryMaxDelayMs = Math.max(retryBaseDelayMs, Math.floor(this.config.retryMaxDelayMs ?? (Number(process.env.OPINION_DISCOVERY_RETRY_MAX_MS) || 2_500)));

    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL("market", normalizedBaseUrl);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("status", "activated");
      url.searchParams.set("marketType", "2");

      try {
        const response = await this.fetchPageWithRetry(url, apiKey, {
          requestTimeoutMs,
          retryAttempts,
          retryBaseDelayMs,
          retryMaxDelayMs
        });
        if (!response.ok) {
          throw new Error(`Opinion current discovery failed with HTTP ${response.status}.`);
        }
        const payload = await response.json();

        const parsed = parseOpinionMarketList(payload);
        const markets = parsed.map((market) => normalizeOpinionMarketRecord(
          typeof market === "object" && market !== null ? market as Record<string, unknown> : {},
          metadataVersion
        ));
        for (const market of markets.filter(isActivatedMarket)) {
          rows.set(market.venueMarketId, market);
        }

        if (markets.length === 0 || markets.length < pageSize) {
          break;
        }
      } catch (error) {
        const message = `Opinion current discovery page ${page} failed for ${normalizedBaseUrl}: ${toErrorMessage(error)}`;
        if (rows.size === 0) {
          throw new Error(message);
        }
        warnings.push(message);
        break;
      }
    }

    return { rows: [...rows.values()], warnings };
  }

  private async fetchPageWithRetry(
    url: URL,
    apiKey: string,
    options: {
      requestTimeoutMs: number;
      retryAttempts: number;
      retryBaseDelayMs: number;
      retryMaxDelayMs: number;
    }
  ): Promise<Response> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= options.retryAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          headers: {
            apikey: apiKey
          },
          signal: AbortSignal.timeout(options.requestTimeoutMs)
        });
        if (response.ok || !isTransientDiscoveryError(new Error(`HTTP ${response.status}`)) || attempt === options.retryAttempts) {
          return response;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
        if (!isTransientDiscoveryError(error) || attempt === options.retryAttempts) {
          throw error;
        }
      }
      await sleep(retryDelayMs(attempt, options.retryBaseDelayMs, options.retryMaxDelayMs));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Opinion discovery request failed."));
  }
}
