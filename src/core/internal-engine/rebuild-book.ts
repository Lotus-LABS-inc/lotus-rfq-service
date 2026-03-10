import type { Pool } from "pg";
import Decimal from "decimal.js";
import type { Logger } from "pino";
import type { OrderBook } from "./order-book.js";
import type { InternalOrder } from "./types.js";
import {
  internalCrossRebuildDiscrepancyTotal,
  internalCrossRebuildTotal
} from "../../observability/metrics.js";

export interface RebuildScope {
  marketIds?: readonly string[];
}

export interface RebuildInternalCrossBookOptions {
  dryRun?: boolean;
  scope?: RebuildScope;
}

export interface RebuildInternalCrossBookResult {
  dryRun: boolean;
  markets: readonly string[];
  postgresOpenOrders: number;
  rebuiltOrders: number;
  missingRedisOrders: readonly string[];
  staleRedisOrderIds: readonly string[];
}

interface AuthoritativeOrderRow {
  id: string;
  market_id: string;
  user_id: string;
  side: "buy" | "sell";
  price: string;
  initial_size: string;
  remaining_size: string;
  status: "OPEN" | "PARTIAL";
  created_at: Date;
  updated_at: Date;
}

interface RedisBookOrderSnapshot {
  orderId: string;
  marketId: string;
  side: "buy" | "sell";
  member: string;
  price: string;
  remaining: string;
  userId: string;
  createdAtMs: number;
}

const parseRedisOrder = (raw: string | null): RedisBookOrderSnapshot | null => {
  if (raw === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RedisBookOrderSnapshot>;
    if (
      typeof parsed.orderId !== "string" ||
      typeof parsed.marketId !== "string" ||
      (parsed.side !== "buy" && parsed.side !== "sell") ||
      typeof parsed.member !== "string" ||
      typeof parsed.price !== "string" ||
      typeof parsed.remaining !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.createdAtMs !== "number"
    ) {
      return null;
    }
    return parsed as RedisBookOrderSnapshot;
  } catch {
    return null;
  }
};

export class InternalCrossBookRebuilder {
  public constructor(
    private readonly pool: Pool,
    private readonly orderBook: OrderBook,
    private readonly logger: Pick<Logger, "info" | "warn" | "error">
  ) {}

  public async rebuild(
    options: RebuildInternalCrossBookOptions = {}
  ): Promise<RebuildInternalCrossBookResult> {
    const authoritativeOrders = await this.loadAuthoritativeOrders(options.scope);
    const marketIds = [...new Set(authoritativeOrders.map((order) => order.market_id))];
    const missingRedisOrders: string[] = [];
    const staleRedisOrderIds: string[] = [];

    for (const order of authoritativeOrders) {
      const snapshot = await this.orderBook.getOrderSnapshot(order.id);
      if (!snapshot) {
        missingRedisOrders.push(order.id);
        continue;
      }

      const parsed = parseRedisOrder(snapshot.raw);
      if (!parsed || !this.matchesAuthoritativeOrder(parsed, order)) {
        staleRedisOrderIds.push(order.id);
      }
    }

    for (const orderId of staleRedisOrderIds) {
      internalCrossRebuildDiscrepancyTotal.inc({ discrepancy_type: "stale_snapshot" });
    }
    for (const orderId of missingRedisOrders) {
      void orderId;
      internalCrossRebuildDiscrepancyTotal.inc({ discrepancy_type: "missing_snapshot" });
    }

    if (!options.dryRun) {
      for (const order of authoritativeOrders) {
        await this.orderBook.removeOrder(order.id).catch(() => undefined);
        await this.orderBook.addOrder(this.toInternalOrder(order));
      }
    }

    internalCrossRebuildTotal.inc({
      result: options.dryRun ? "dry_run" : "applied"
    });
    this.logger.info(
      {
        dryRun: options.dryRun ?? false,
        postgresOpenOrders: authoritativeOrders.length,
        missingRedisOrders: missingRedisOrders.length,
        staleRedisOrderIds: staleRedisOrderIds.length
      },
      "Internal cross Redis book rebuild evaluated."
    );

    return {
      dryRun: options.dryRun ?? false,
      markets: marketIds,
      postgresOpenOrders: authoritativeOrders.length,
      rebuiltOrders: options.dryRun ? 0 : authoritativeOrders.length,
      missingRedisOrders,
      staleRedisOrderIds
    };
  }

  private async loadAuthoritativeOrders(scope?: RebuildScope): Promise<readonly AuthoritativeOrderRow[]> {
    const hasScopedMarkets = Boolean(scope?.marketIds && scope.marketIds.length > 0);
    const result = hasScopedMarkets
      ? await this.pool.query<AuthoritativeOrderRow>(
          `SELECT id, market_id, user_id, side, price::text, initial_size::text, remaining_size::text, status, created_at, updated_at
           FROM internal_orders
           WHERE status IN ('OPEN', 'PARTIAL')
             AND remaining_size > 0
             AND market_id = ANY($1::text[])
           ORDER BY market_id ASC, side ASC, price ASC, created_at ASC`,
          [scope?.marketIds]
        )
      : await this.pool.query<AuthoritativeOrderRow>(
          `SELECT id, market_id, user_id, side, price::text, initial_size::text, remaining_size::text, status, created_at, updated_at
           FROM internal_orders
           WHERE status IN ('OPEN', 'PARTIAL')
             AND remaining_size > 0
           ORDER BY market_id ASC, side ASC, price ASC, created_at ASC`
        );

    return result.rows;
  }

  private matchesAuthoritativeOrder(snapshot: RedisBookOrderSnapshot, order: AuthoritativeOrderRow): boolean {
    return (
      snapshot.orderId === order.id &&
      snapshot.marketId === order.market_id &&
      snapshot.side === order.side &&
      snapshot.userId === order.user_id &&
      new Decimal(snapshot.price).eq(order.price) &&
      new Decimal(snapshot.remaining).eq(order.remaining_size)
    );
  }

  private toInternalOrder(order: AuthoritativeOrderRow): InternalOrder {
    return {
      id: order.id,
      market_id: order.market_id,
      user_id: order.user_id,
      side: order.side,
      price: order.price,
      initial_size: order.initial_size,
      remaining_size: order.remaining_size,
      status: order.status,
      created_at: order.created_at,
      updated_at: order.updated_at
    };
  }
}
