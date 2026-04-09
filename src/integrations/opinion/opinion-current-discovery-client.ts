import { parseOpinionMarketList } from "./opinion-schemas.js";
import { normalizeOpinionMarketRecord } from "./opinion-market-adapter.js";
import type { OpinionNormalizedMarket } from "./opinion-types.js";

export interface OpinionCurrentDiscoveryClientConfig {
  apiKey: string | null;
  baseUrl?: string;
  fallbackBaseUrl?: string | null;
  pageSize?: number;
  maxPages?: number;
  requestTimeoutMs?: number;
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
    if (!this.config.apiKey) {
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

    try {
      const scannedRows = await this.fetchMarketsFromBase(
        this.config.baseUrl ?? process.env.OPINION_CLOB_BASE_URL ?? DEFAULT_PRIMARY_BASE_URL,
        input.metadataVersion,
        input.maxPages,
        input.pageSize
      );
      const rows = input.matcher ? scannedRows.filter(input.matcher) : scannedRows;
      return {
        status: rows.length > 0 ? "SUCCESS" : "EMPTY",
        rows,
        primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
        fallbackDiscoveryPathUsed: null,
        primaryPathFailure: null,
        warnings: [],
        scannedRowCount: scannedRows.length
      };
    } catch (primaryError) {
      const fallbackBaseUrl = this.config.fallbackBaseUrl
        ?? process.env.OPINION_OPENAPI_BASE_URL
        ?? DEFAULT_FALLBACK_BASE_URL;

      if (!fallbackBaseUrl) {
        return {
          status: "UNAVAILABLE",
          rows: [],
          primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
          fallbackDiscoveryPathUsed: null,
          primaryPathFailure: toErrorMessage(primaryError),
          warnings: [toErrorMessage(primaryError)],
          scannedRowCount: 0
        };
      }

      try {
        const scannedRows = await this.fetchMarketsFromBase(
          fallbackBaseUrl,
          input.metadataVersion,
          input.maxPages,
          input.pageSize
        );
        const rows = input.matcher ? scannedRows.filter(input.matcher) : scannedRows;
        return {
          status: rows.length > 0 ? "DEGRADED" : "EMPTY",
          rows,
          primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
          fallbackDiscoveryPathUsed: FALLBACK_DISCOVERY_PATH,
          primaryPathFailure: toErrorMessage(primaryError),
          warnings: [`Primary discovery path failed: ${toErrorMessage(primaryError)}`],
          scannedRowCount: scannedRows.length
        };
      } catch (fallbackError) {
        return {
          status: "UNAVAILABLE",
          rows: [],
          primaryDiscoveryPath: PRIMARY_DISCOVERY_PATH,
          fallbackDiscoveryPathUsed: FALLBACK_DISCOVERY_PATH,
          primaryPathFailure: toErrorMessage(primaryError),
          warnings: [
            `Primary discovery path failed: ${toErrorMessage(primaryError)}`,
            `Fallback discovery path failed: ${toErrorMessage(fallbackError)}`
          ],
          scannedRowCount: 0
        };
      }
    }
  }

  private async fetchMarketsFromBase(
    baseUrl: string,
    metadataVersion: string,
    overrideMaxPages?: number,
    overridePageSize?: number
  ): Promise<readonly OpinionNormalizedMarket[]> {
    const rows = new Map<string, OpinionNormalizedMarket>();
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const pageSize = overridePageSize ?? this.config.pageSize ?? 20;
    const maxPages = overrideMaxPages ?? this.config.maxPages ?? 20;
    const requestTimeoutMs = this.config.requestTimeoutMs ?? 10_000;

    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL("market", normalizedBaseUrl);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(pageSize));

      const response = await this.fetchImpl(url, {
        headers: {
          apikey: this.config.apiKey!
        },
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`Opinion current discovery failed with HTTP ${response.status}.`);
      }

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
    }

    return [...rows.values()];
  }
}
