import type { PredictClient } from "./predict-client.js";
import type { PredictEnvironment, PredictNormalizedExecutionEvent } from "./predict-types.js";

export interface PredictEventsAdapterConfig {
  client: Pick<PredictClient, "getOrders" | "getOrderMatchEvents" | "getAccountActivity">;
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

const normalizeEvent = (
  environment: PredictEnvironment,
  kind: PredictNormalizedExecutionEvent["kind"],
  payload: Record<string, unknown>,
  fallbackId: string
): PredictNormalizedExecutionEvent => ({
  venue: "PREDICT",
  environment,
  kind,
  eventId:
    typeof payload.id === "string" || typeof payload.id === "number"
      ? String(payload.id)
      : fallbackId,
  marketId:
    typeof payload.marketId === "string" || typeof payload.marketId === "number"
      ? String(payload.marketId)
      : typeof payload.market_id === "string" || typeof payload.market_id === "number"
        ? String(payload.market_id)
        : null,
  orderHash:
    typeof payload.orderHash === "string"
      ? payload.orderHash
      : typeof payload.order_hash === "string"
        ? payload.order_hash
        : typeof payload.hash === "string"
          ? payload.hash
          : null,
  side: typeof payload.side === "string" ? payload.side : null,
  price: typeof payload.price === "string" || typeof payload.price === "number" ? String(payload.price) : null,
  size:
    typeof payload.size === "string" || typeof payload.size === "number"
      ? String(payload.size)
      : typeof payload.remainingSize === "string" || typeof payload.remainingSize === "number"
        ? String(payload.remainingSize)
        : typeof payload.remaining_size === "string" || typeof payload.remaining_size === "number"
          ? String(payload.remaining_size)
          : null,
  timestamp: asDate(payload.timestamp ?? payload.createdAt ?? payload.created_at ?? payload.matchedAt ?? payload.matched_at),
  raw: payload
});

export class PredictEventsAdapter {
  public constructor(private readonly config: PredictEventsAdapterConfig) {}

  public async getOrders(input: { marketId?: string }): Promise<readonly PredictNormalizedExecutionEvent[]> {
    const orders = await this.config.client.getOrders(input.marketId ? { marketId: input.marketId } : {});
    return orders.map((entry, index) => normalizeEvent(this.config.environment, "ORDER", asRecord(entry), `order-${index}`));
  }

  public async getOrderMatchEvents(input: { marketId?: string; orderHash?: string }): Promise<readonly PredictNormalizedExecutionEvent[]> {
    const events = await this.config.client.getOrderMatchEvents(input);
    return events.map((entry, index) => normalizeEvent(this.config.environment, "MATCH", asRecord(entry), `match-${index}`));
  }

  public async getAccountActivity(): Promise<readonly PredictNormalizedExecutionEvent[]> {
    const events = await this.config.client.getAccountActivity();
    return events.map((entry, index) =>
      normalizeEvent(this.config.environment, "ACCOUNT_ACTIVITY", asRecord(entry), `activity-${index}`)
    );
  }
}
