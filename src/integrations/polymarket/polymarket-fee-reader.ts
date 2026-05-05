export interface PolymarketFeeReader {
  getFeeRate(input: { conditionId: string }): Promise<number | null>;
}

export class PolymarketClobFeeReader implements PolymarketFeeReader {
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, { feeRate: number | null; expiresAt: number }>();

  public constructor(private readonly config: {
    clobHost: string;
    fetchImpl?: typeof fetch;
    ttlMs?: number | undefined;
  }) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public async getFeeRate(input: { conditionId: string }): Promise<number | null> {
    const conditionId = input.conditionId.trim();
    if (!conditionId) {
      return null;
    }
    const now = Date.now();
    const cached = this.cache.get(conditionId);
    if (cached && cached.expiresAt > now) {
      return cached.feeRate;
    }
    const feeRate = await this.fetchFeeRate(conditionId);
    this.cache.set(conditionId, {
      feeRate,
      expiresAt: now + (this.config.ttlMs ?? 10 * 60_000)
    });
    return feeRate;
  }

  private async fetchFeeRate(conditionId: string): Promise<number | null> {
    const url = new URL(`/markets/${encodeURIComponent(conditionId)}`, this.config.clobHost);
    const response = await this.fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return parsePolymarketFeeRate(payload);
  }
}

export const parsePolymarketFeeRate = (payload: unknown): number | null => {
  const record = asRecord(payload);
  const feeDetails = asRecord(record.fd ?? record.feeDetails ?? record.fee_details);
  const rawRate = feeDetails.r ?? feeDetails.rate ?? record.feeRate ?? record.fee_rate;
  const parsed = parseNonNegativeNumber(rawRate);
  if (parsed === null) {
    return null;
  }
  const exponent = parseNonNegativeNumber(feeDetails.e ?? feeDetails.exponent);
  if (exponent !== null && exponent > 0) {
    return parsed / (10 ** exponent);
  }
  return parsed > 1 ? parsed / 10_000 : parsed;
};

const parseNonNegativeNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
