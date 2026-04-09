import Decimal from "decimal.js";

import type { PredictClient } from "./predict-client.js";
import type { PredictEnvironment, PredictNormalizedOrderbookSnapshot, PredictOrderbookLevel } from "./predict-types.js";

export interface PredictOrderbookAdapterConfig {
  client: Pick<PredictClient, "getMarketOrderbook">;
  environment: PredictEnvironment;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const asDate = (value: unknown): Date | null => {
  if (typeof value === "number") {
    return new Date(value >= 1_000_000_000_000 ? value : value * 1_000);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
};

const normalizeLevel = (value: unknown): PredictOrderbookLevel | null => {
  if (Array.isArray(value) && value.length >= 2) {
    const [price, size] = value;
    if ((typeof price === "string" || typeof price === "number") && (typeof size === "string" || typeof size === "number")) {
      return {
        price: String(price),
        size: String(size),
        raw: { price, size }
      };
    }
    return null;
  }
  const record = asRecord(value);
  const price = record.price;
  const size = record.size;
  if ((typeof price !== "string" && typeof price !== "number") || (typeof size !== "string" && typeof size !== "number")) {
    return null;
  }
  return {
    price: String(price),
    size: String(size),
    raw: record
  };
};

const normalizeLevels = (levels: unknown): readonly PredictOrderbookLevel[] =>
  Array.isArray(levels)
    ? levels.map(normalizeLevel).filter((value): value is PredictOrderbookLevel => value !== null)
    : [];

const firstValue = (levels: readonly PredictOrderbookLevel[]): string | null => levels[0]?.price ?? null;

const sumTopOfBook = (bids: readonly PredictOrderbookLevel[], asks: readonly PredictOrderbookLevel[]): string | null => {
  const sizes = [bids[0]?.size, asks[0]?.size].filter((value): value is string => value !== undefined);
  if (sizes.length === 0) {
    return null;
  }
  return sizes.reduce((total, value) => total.plus(value), new Decimal(0)).toString();
};

const computeSpread = (bestBid: string | null, bestAsk: string | null): string | null =>
  bestBid === null || bestAsk === null ? null : new Decimal(bestAsk).minus(bestBid).toString();

const computeMidpoint = (bestBid: string | null, bestAsk: string | null): string | null =>
  bestBid === null || bestAsk === null ? null : new Decimal(bestBid).plus(bestAsk).div(2).toString();

export class PredictOrderbookAdapter {
  public constructor(private readonly config: PredictOrderbookAdapterConfig) {}

  public async getOrderbookSnapshot(marketId: string): Promise<PredictNormalizedOrderbookSnapshot> {
    const payload = asRecord(await this.config.client.getMarketOrderbook(marketId));
    const bids = normalizeLevels(payload.bids);
    const asks = normalizeLevels(payload.asks);
    const bestBid = firstValue(bids);
    const bestAsk = firstValue(asks);

    return {
      venue: "PREDICT",
      environment: this.config.environment,
      marketId,
      sourceTimestamp: asDate(payload.timestamp),
      bids,
      asks,
      bestBid,
      bestAsk,
      spread: computeSpread(bestBid, bestAsk),
      midpoint: computeMidpoint(bestBid, bestAsk),
      topOfBookSize: sumTopOfBook(bids, asks),
      raw: payload
    };
  }
}
