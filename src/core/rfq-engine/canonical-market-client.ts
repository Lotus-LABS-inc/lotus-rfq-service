import { z } from "zod";

const canonicalMarketSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export interface CanonicalMarket {
  id: string;
  status?: string;
  isActive: boolean;
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

  return status.toUpperCase() === "ACTIVE";
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

      const parsed = canonicalMarketSchema.parse(await response.json());
      const isActive = parsed.isActive ?? parsed.active ?? isMarketStatusActive(parsed.status);

      return {
        id: parsed.id,
        ...(parsed.status ? { status: parsed.status } : {}),
        isActive
      };
    }
  };
};
