export interface PolymarketDataApiClientConfig {
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface PolymarketDataApiActivity {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: string;
  size: number;
  usdcSize?: number | undefined;
  transactionHash?: string | undefined;
  price: number;
  asset: string;
  side: string;
  outcome?: string | undefined;
}

export interface PolymarketDataApiPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  curPrice?: number | undefined;
  outcome?: string | undefined;
}

export interface PolymarketActivityLookupInput {
  proxyWallet: string | null | undefined;
  conditionId?: string | null | undefined;
  assetId?: string | null | undefined;
  side?: string | null | undefined;
  transactionHash?: string | null | undefined;
  submittedAt?: string | null | undefined;
  limit?: number | undefined;
}

export class PolymarketDataApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(config: PolymarketDataApiClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://data-api.polymarket.com").replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public async listActivities(input: { proxyWallet: string; limit?: number | undefined }): Promise<PolymarketDataApiActivity[]> {
    const url = new URL(`${this.baseUrl}/activity`);
    url.searchParams.set("user", input.proxyWallet);
    url.searchParams.set("limit", String(input.limit ?? 100));
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      return [];
    }
    const payload = await response.json().catch(() => null) as unknown;
    return Array.isArray(payload) ? payload.filter(isPolymarketActivity) : [];
  }

  public async findTradeActivity(input: PolymarketActivityLookupInput): Promise<PolymarketDataApiActivity | null> {
    if (!isEvmAddressLike(input.proxyWallet)) {
      return null;
    }
    const activities = await this.listActivities({
      proxyWallet: input.proxyWallet!,
      limit: input.limit
    });
    const conditionId = normalizeHex(input.conditionId);
    const assetId = normalizeDecimalString(input.assetId);
    const side = input.side ? input.side.trim().toUpperCase() : null;
    const transactionHash = normalizeHex(input.transactionHash);
    const submittedAtMs = input.submittedAt ? Date.parse(input.submittedAt) : NaN;
    const candidates = activities.filter((activity) => {
      if (activity.type.toUpperCase() !== "TRADE") return false;
      if (conditionId && normalizeHex(activity.conditionId) !== conditionId) return false;
      if (assetId && normalizeDecimalString(activity.asset) !== assetId) return false;
      if (side && activity.side.toUpperCase() !== side) return false;
      return true;
    });
    if (transactionHash) {
      const exact = candidates.find((activity) => normalizeHex(activity.transactionHash) === transactionHash);
      if (exact) {
        return exact;
      }
    }
    if (Number.isFinite(submittedAtMs)) {
      const maxDistanceMs = 10 * 60 * 1000;
      const byDistance = candidates
        .map((activity) => ({
          activity,
          distanceMs: Math.abs((activity.timestamp * 1000) - submittedAtMs)
        }))
        .filter((candidate) => candidate.distanceMs <= maxDistanceMs)
        .sort((a, b) => a.distanceMs - b.distanceMs);
      return byDistance[0]?.activity ?? null;
    }
    return candidates[0] ?? null;
  }

  public async findPosition(input: {
    proxyWallet: string | null | undefined;
    conditionId?: string | null | undefined;
    assetId?: string | null | undefined;
  }): Promise<PolymarketDataApiPosition | null> {
    if (!isEvmAddressLike(input.proxyWallet)) {
      return null;
    }
    const url = new URL(`${this.baseUrl}/positions`);
    url.searchParams.set("user", input.proxyWallet!);
    url.searchParams.set("limit", "100");
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      return null;
    }
    const payload = await response.json().catch(() => null) as unknown;
    const positions = Array.isArray(payload) ? payload.filter(isPolymarketPosition) : [];
    const conditionId = normalizeHex(input.conditionId);
    const assetId = normalizeDecimalString(input.assetId);
    return positions.find((position) => {
      if (conditionId && normalizeHex(position.conditionId) !== conditionId) return false;
      if (assetId && normalizeDecimalString(position.asset) !== assetId) return false;
      return true;
    }) ?? null;
  }
}

export const normalizePolymarketDataApiSide = (side: string | null | undefined): string | null => {
  const normalized = side?.trim().toUpperCase();
  if (normalized === "BUY" || normalized === "SELL") {
    return normalized;
  }
  return null;
};

const isPolymarketActivity = (value: unknown): value is PolymarketDataApiActivity => {
  if (!isRecord(value)) return false;
  return typeof value.proxyWallet === "string" &&
    typeof value.timestamp === "number" &&
    typeof value.conditionId === "string" &&
    typeof value.type === "string" &&
    typeof value.size === "number" &&
    typeof value.price === "number" &&
    typeof value.asset === "string" &&
    typeof value.side === "string";
};

const isPolymarketPosition = (value: unknown): value is PolymarketDataApiPosition => {
  if (!isRecord(value)) return false;
  return typeof value.proxyWallet === "string" &&
    typeof value.asset === "string" &&
    typeof value.conditionId === "string" &&
    typeof value.size === "number" &&
    typeof value.avgPrice === "number";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isEvmAddressLike = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());

const normalizeHex = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;

const normalizeDecimalString = (value: unknown): string | null =>
  typeof value === "string" && /^\d+$/.test(value.trim()) ? value.trim() : null;
