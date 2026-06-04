import { OpinionClient, OpinionClientError } from "./opinion-client.js";

type OpinionOrderbookLogger = {
  warn?: (context: Record<string, unknown>, message: string) => void;
};

export const OPINION_ORDERBOOK_API_KEY_ENV_NAMES = [
  "OPINION_API_KEY",
  "OPINION_BUILDER_API_KEY",
  "OPINION_BUILDER_SERVICE_API_KEY",
  "OPINION_BUILDER_API"
] as const;

export const resolveOpinionOrderbookApiKeys = (env: NodeJS.ProcessEnv): readonly string[] =>
  uniqueStrings(OPINION_ORDERBOOK_API_KEY_ENV_NAMES.map((name) => env[name]));

export const createOpinionOrderbookClient = (input: {
  baseUrl: string;
  apiKeys: readonly string[];
  requestTimeoutMs: number;
  logger?: OpinionOrderbookLogger | undefined;
}): Pick<OpinionClient, "getTokenOrderbook"> => {
  const clients = input.apiKeys.map((apiKey) => new OpinionClient({
    baseUrl: input.baseUrl,
    apiKey,
    requestTimeoutMs: input.requestTimeoutMs,
    maxRetries: 0
  }));
  return {
    async getTokenOrderbook(request) {
      let lastError: unknown = null;
      for (let index = 0; index < clients.length; index += 1) {
        const client = clients[index]!;
        try {
          return await client.getTokenOrderbook(request);
        } catch (error) {
          lastError = error;
          if (!isOpinionAuthError(error) || index === clients.length - 1) {
            throw error;
          }
          input.logger?.warn?.(
            { venue: "OPINION", keyIndex: index },
            "Opinion orderbook API key rejected; retrying with next configured key."
          );
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Opinion token orderbook request failed.");
    }
  };
};

const isOpinionAuthError = (error: unknown): boolean =>
  error instanceof OpinionClientError && (error.status === 401 || error.status === 403);

const uniqueStrings = (values: readonly (string | undefined)[]): string[] => {
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
