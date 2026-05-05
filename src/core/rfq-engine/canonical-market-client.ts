import { z } from "zod";

const canonicalMarketPayloadSchema = z.object({
  id: z.string(),
  marketId: z.string().optional(),
  canonicalMarketIds: z.array(z.string()).optional(),
  status: z.string().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  canonicalEventId: z.string().uuid().optional(),
  canonical_event_id: z.string().uuid().optional()
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
      const response = await fetchImpl(`${config.baseUrl}/markets/${marketId}`, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

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

      const market: CanonicalMarket = {
        id,
        ...(parsed.status ? { status: parsed.status } : {}),
        isActive
      };
      if (canonicalEventId) {
        market.canonicalEventId = canonicalEventId;
      }
      return market;
    }
  };
};
