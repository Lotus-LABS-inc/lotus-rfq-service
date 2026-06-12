import { z } from "zod";
import { withLatencyStage } from "../../observability/latency.js";

const canonicalMarketPayloadSchema = z.object({
  id: z.string(),
  marketId: z.string().optional(),
  canonicalMarketIds: z.array(z.string()).optional(),
  status: z.string().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  canonicalEventId: z.string().uuid().optional(),
  canonical_event_id: z.string().uuid().optional(),
  canonicalFamily: z.string().optional(),
  canonical_family: z.string().optional(),
  category: z.string().optional(),
  marketLiquidity: z.union([z.string(), z.number()]).optional(),
  market_liquidity: z.union([z.string(), z.number()]).optional(),
  liquidity: z.union([z.string(), z.number()]).optional()
});

const canonicalMarketResponseSchema = z.union([
  canonicalMarketPayloadSchema,
  z.object({ market: canonicalMarketPayloadSchema.omit({ id: true }).extend({ id: z.string().optional() }) })
]);

export interface CanonicalMarket {
  id: string;
  status?: string;
  isActive: boolean;
  canonicalEventId?: string;
  canonicalFamily?: string;
  category?: string;
  marketLiquidity?: string | number;
}

export interface CanonicalMarketClient {
  fetchMarketById(marketId: string): Promise<CanonicalMarket>;
}

export interface CanonicalMarketClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class CanonicalMarketFetchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CanonicalMarketFetchError";
  }
}

const isMarketStatusActive = (status: string | undefined): boolean => {
  if (!status) {
    return false;
  }

  return status.toUpperCase() === "ACTIVE" || status.toUpperCase() === "OPEN";
};

export const createCanonicalMarketClient = (
  config: CanonicalMarketClientConfig
): CanonicalMarketClient => {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async fetchMarketById(marketId: string): Promise<CanonicalMarket> {
      const response = await withLatencyStage("canonical_market_fetch", {
        canonicalMarketId: marketId,
        external: true
      }, () => fetchImpl(`${config.baseUrl}/markets/${marketId}`, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      }));

      if (!response.ok) {
        throw new CanonicalMarketFetchError(
          `Failed to fetch canonical market ${marketId}. Status: ${response.status}.`
        );
      }

      const parsedResponse = canonicalMarketResponseSchema.parse(await response.json());
      const parsed = "market" in parsedResponse ? parsedResponse.market : parsedResponse;
      const isActive = parsed.isActive ?? parsed.active ?? isMarketStatusActive(parsed.status);
      const canonicalEventId = parsed.canonicalEventId ?? parsed.canonical_event_id;
      const id = parsed.id ?? parsed.marketId ?? parsed.canonicalMarketIds?.[0] ?? marketId;
      const canonicalFamily = parsed.canonicalFamily ?? parsed.canonical_family;
      const marketLiquidity = parsed.marketLiquidity ?? parsed.market_liquidity ?? parsed.liquidity;

      const market: CanonicalMarket = {
        id,
        ...(parsed.status ? { status: parsed.status } : {}),
        isActive
      };
      if (canonicalEventId) {
        market.canonicalEventId = canonicalEventId;
      }
      if (canonicalFamily) {
        market.canonicalFamily = canonicalFamily;
      }
      if (parsed.category) {
        market.category = parsed.category;
      }
      if (marketLiquidity !== undefined) {
        market.marketLiquidity = marketLiquidity;
      }
      return market;
    }
  };
};
