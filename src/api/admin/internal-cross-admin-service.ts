import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { Pool } from "pg";
import type { RedisClient } from "../../db/redis.js";

interface TradeRow {
  id: string;
  market_id: string;
  buy_order_id: string;
  sell_order_id: string;
  price: string;
  size: string;
  created_at: Date;
}

interface InternalOrderRow {
  id: string;
  market_id: string;
  user_id: string;
  side: "buy" | "sell";
  price: string;
  initial_size: string;
  remaining_size: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface ExposureRow {
  id: string;
  user_id: string;
  canonical_market_id: string;
  side: "buy" | "sell";
  gross_notional: string;
  net_notional: string;
  last_updated: Date;
  version: number;
  metadata: Record<string, unknown> | null;
}

interface ExposureJournalRow {
  id: number;
  exposure_id: string | null;
  change: string;
  prev_gross: string | null;
  prev_net: string | null;
  new_gross: string | null;
  new_net: string | null;
  source: string;
  reference_id: string | null;
  created_at: Date;
  payload: Record<string, unknown> | null;
}

interface AdminEventRow {
  id: string;
  entity_type: "ORDER" | "TRADE";
  entity_id: string;
  action: string;
  requested_by: string;
  correlation_id: string;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

interface UnwindTaskRow {
  id: string;
  trade_id: string;
  requested_by: string;
  reason: string;
  correlation_id: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

interface RedisBookPresence {
  present: boolean;
  raw: Record<string, unknown> | null;
}

export interface InternalCrossTradeInspection {
  trade: TradeRow;
  buyer_order: InternalOrderRow;
  seller_order: InternalOrderRow;
  exposure_journal_references: ExposureJournalRow[];
  redis_book_presence: {
    buyer_order: RedisBookPresence;
    seller_order: RedisBookPresence;
  };
}

export interface InternalCrossOrderInspection {
  order: InternalOrderRow;
  redis_book_status: RedisBookPresence;
  related_trades: TradeRow[];
  related_exposure_state: ExposureRow[];
}

export interface RemoveFromBookInput {
  orderId: string;
  requestedBy: string;
  reason?: string;
  correlationId?: string;
}

export interface ReconcileTradeInput {
  tradeId: string;
  requestedBy: string;
  dryRun: boolean;
  force: boolean;
  correlationId?: string;
}

export interface ForceUnwindTradeInput {
  tradeId: string;
  requestedBy: string;
  reason: string;
  correlationId?: string;
}

export interface InternalCrossReconcileReport {
  trade_id: string;
  dry_run: boolean;
  force: boolean;
  discrepancies: Array<{
    code: string;
    severity: "warning" | "critical";
    message: string;
    details?: Record<string, unknown>;
  }>;
  admin_event_id: string;
}

export class InternalCrossTradeNotFoundError extends Error {
  public constructor(tradeId: string) {
    super(`Internal cross trade ${tradeId} not found.`);
    this.name = "InternalCrossTradeNotFoundError";
  }
}

export class InternalCrossOrderNotFoundError extends Error {
  public constructor(orderId: string) {
    super(`Internal cross order ${orderId} not found.`);
    this.name = "InternalCrossOrderNotFoundError";
  }
}

export class InternalCrossAmbiguityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InternalCrossAmbiguityError";
  }
}

export interface InternalCrossAdminServiceDeps {
  pool: Pool;
  redis: RedisClient;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export class InternalCrossAdminService {
  public constructor(private readonly deps: InternalCrossAdminServiceDeps) {}

  public async getTradeInspection(tradeId: string): Promise<InternalCrossTradeInspection> {
    const trade = await this.loadTrade(tradeId);
    const buyerOrder = await this.loadOrderOptional(trade.buy_order_id);
    const sellerOrder = await this.loadOrderOptional(trade.sell_order_id);

    if (!buyerOrder || !sellerOrder) {
      throw new InternalCrossAmbiguityError(
        `Trade ${tradeId} does not have both order states persisted in internal_orders.`
      );
    }
    if (buyerOrder.market_id !== trade.market_id || sellerOrder.market_id !== trade.market_id) {
      throw new InternalCrossAmbiguityError(`Trade ${tradeId} market/order mismatch detected.`);
    }

    const [journalRows, buyerRedis, sellerRedis] = await Promise.all([
      this.loadExposureJournalByTrade(tradeId),
      this.loadRedisPresence(trade.buy_order_id),
      this.loadRedisPresence(trade.sell_order_id)
    ]);

    return {
      trade,
      buyer_order: buyerOrder,
      seller_order: sellerOrder,
      exposure_journal_references: journalRows,
      redis_book_presence: {
        buyer_order: buyerRedis,
        seller_order: sellerRedis
      }
    };
  }

  public async getOrderInspection(orderId: string): Promise<InternalCrossOrderInspection> {
    const order = await this.loadOrder(orderId);
    const [redisStatus, relatedTrades, relatedExposureState] = await Promise.all([
      this.loadRedisPresence(orderId),
      this.loadRelatedTrades(orderId),
      this.loadExposureState(order.user_id, order.market_id)
    ]);

    return {
      order,
      redis_book_status: redisStatus,
      related_trades: relatedTrades,
      related_exposure_state: relatedExposureState
    };
  }

  public async removeOrderFromBook(input: RemoveFromBookInput): Promise<{
    removed: boolean;
    warning?: string;
    admin_event_id: string;
    correlation_id: string;
  }> {
    const order = await this.loadOrder(input.orderId);
    const removed = await this.removeRedisOrder(input.orderId);
    const correlationId = input.correlationId ?? randomUUID();
    const warning = order.status === "OPEN"
      ? "Postgres still reports OPEN; verify staleness before recreating book state."
      : undefined;

    const adminEventId = await this.insertAdminEvent({
      entityType: "ORDER",
      entityId: input.orderId,
      action: "REMOVE_FROM_BOOK",
      requestedBy: input.requestedBy,
      correlationId,
      payload: {
        removed,
        order_status: order.status,
        reason: input.reason ?? null,
        warning: warning ?? null
      }
    });

    this.deps.logger.warn(
      {
        orderId: input.orderId,
        removed,
        correlationId,
        requestedBy: input.requestedBy,
        warning
      },
      "Admin removed order from internal cross Redis book."
    );

    return {
      removed,
      ...(warning ? { warning } : {}),
      admin_event_id: adminEventId,
      correlation_id: correlationId
    };
  }

  public async reconcileTrade(input: ReconcileTradeInput): Promise<InternalCrossReconcileReport> {
    const trade = await this.loadTrade(input.tradeId);
    const [buyerOrder, sellerOrder, journalRows] = await Promise.all([
      this.loadOrderOptional(trade.buy_order_id),
      this.loadOrderOptional(trade.sell_order_id),
      this.loadExposureJournalByTrade(trade.id)
    ]);

    const discrepancies: InternalCrossReconcileReport["discrepancies"] = [];

    if (!buyerOrder) {
      discrepancies.push({
        code: "BUY_ORDER_NOT_PERSISTED",
        severity: "critical",
        message: "Buyer order state is not present in internal_orders.",
        details: { buy_order_id: trade.buy_order_id }
      });
    }
    if (!sellerOrder) {
      discrepancies.push({
        code: "SELL_ORDER_NOT_PERSISTED",
        severity: "critical",
        message: "Seller order state is not present in internal_orders.",
        details: { sell_order_id: trade.sell_order_id }
      });
    }
    if (journalRows.length < 2) {
      discrepancies.push({
        code: "EXPOSURE_JOURNAL_INCOMPLETE",
        severity: "critical",
        message: "Expected at least two exposure journal rows for crossed trade.",
        details: { journal_count: journalRows.length }
      });
    }
    if (buyerOrder && buyerOrder.market_id !== trade.market_id) {
      discrepancies.push({
        code: "BUY_ORDER_MARKET_MISMATCH",
        severity: "critical",
        message: "Buyer order market does not match trade market.",
        details: { trade_market_id: trade.market_id, buyer_market_id: buyerOrder.market_id }
      });
    }
    if (sellerOrder && sellerOrder.market_id !== trade.market_id) {
      discrepancies.push({
        code: "SELL_ORDER_MARKET_MISMATCH",
        severity: "critical",
        message: "Seller order market does not match trade market.",
        details: { trade_market_id: trade.market_id, seller_market_id: sellerOrder.market_id }
      });
    }

    const correlationId = input.correlationId ?? randomUUID();
    const adminEventId = await this.insertAdminEvent({
      entityType: "TRADE",
      entityId: trade.id,
      action: "RECONCILE",
      requestedBy: input.requestedBy,
      correlationId,
      payload: {
        dry_run: input.dryRun,
        force: input.force,
        discrepancy_count: discrepancies.length
      }
    });

    return {
      trade_id: trade.id,
      dry_run: input.dryRun,
      force: input.force,
      discrepancies,
      admin_event_id: adminEventId
    };
  }

  public async createForceUnwindTask(input: ForceUnwindTradeInput): Promise<{
    task_id: string;
    trade_id: string;
    correlation_id: string;
    status: string;
    admin_event_id: string;
  }> {
    await this.loadTrade(input.tradeId);
    const correlationId = input.correlationId ?? randomUUID();
    const taskId = randomUUID();

    await this.deps.pool.query(
      `INSERT INTO internal_cross_unwind_tasks (id, trade_id, requested_by, reason, correlation_id, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [taskId, input.tradeId, input.requestedBy, input.reason, correlationId, "PENDING", JSON.stringify({ phase: "PHASE_1" })]
    );

    const adminEventId = await this.insertAdminEvent({
      entityType: "TRADE",
      entityId: input.tradeId,
      action: "FORCE_UNWIND_REQUESTED",
      requestedBy: input.requestedBy,
      correlationId,
      payload: {
        task_id: taskId,
        reason: input.reason
      }
    });

    this.deps.logger.warn(
      {
        tradeId: input.tradeId,
        taskId,
        correlationId,
        requestedBy: input.requestedBy
      },
      "Admin created internal cross unwind task."
    );

    return {
      task_id: taskId,
      trade_id: input.tradeId,
      correlation_id: correlationId,
      status: "PENDING",
      admin_event_id: adminEventId
    };
  }

  private async loadTrade(tradeId: string): Promise<TradeRow> {
    const result = await this.deps.pool.query<TradeRow>(
      `SELECT id, market_id, buy_order_id, sell_order_id, price::text, size::text, created_at
       FROM trades
       WHERE id = $1
       LIMIT 1`,
      [tradeId]
    );
    const trade = result.rows[0];
    if (!trade) {
      throw new InternalCrossTradeNotFoundError(tradeId);
    }
    return trade;
  }

  private async loadOrder(orderId: string): Promise<InternalOrderRow> {
    const order = await this.loadOrderOptional(orderId);
    if (!order) {
      throw new InternalCrossOrderNotFoundError(orderId);
    }
    return order;
  }

  private async loadOrderOptional(orderId: string): Promise<InternalOrderRow | null> {
    const result = await this.deps.pool.query<InternalOrderRow>(
      `SELECT id, market_id, user_id, side, price::text, initial_size::text, remaining_size::text,
              status::text AS status, created_at, updated_at
       FROM internal_orders
       WHERE id = $1
       LIMIT 1`,
      [orderId]
    );
    return result.rows[0] ?? null;
  }

  private async loadRelatedTrades(orderId: string): Promise<TradeRow[]> {
    const result = await this.deps.pool.query<TradeRow>(
      `SELECT id, market_id, buy_order_id, sell_order_id, price::text, size::text, created_at
       FROM trades
       WHERE buy_order_id = $1 OR sell_order_id = $1
       ORDER BY created_at DESC`,
      [orderId]
    );
    return result.rows;
  }

  private async loadExposureState(userId: string, marketId: string): Promise<ExposureRow[]> {
    const result = await this.deps.pool.query<ExposureRow>(
      `SELECT id, user_id::text AS user_id, canonical_market_id::text AS canonical_market_id,
              side, gross_notional::text, net_notional::text, last_updated, version, metadata
       FROM exposure
       WHERE user_id::text = $1 AND canonical_market_id::text = $2
       ORDER BY side ASC`,
      [userId, marketId]
    );
    return result.rows;
  }

  private async loadExposureJournalByTrade(tradeId: string): Promise<ExposureJournalRow[]> {
    const result = await this.deps.pool.query<ExposureJournalRow>(
      `SELECT id, exposure_id::text, change::text, prev_gross::text, prev_net::text,
              new_gross::text, new_net::text, source, reference_id::text, created_at, payload
       FROM exposure_journal
       WHERE reference_id::text = $1
       ORDER BY created_at ASC, id ASC`,
      [tradeId]
    );
    return result.rows;
  }

  private async loadRedisPresence(orderId: string): Promise<RedisBookPresence> {
    const raw = await this.deps.redis.get(`book:order:${orderId}`);
    if (raw === null) {
      return { present: false, raw: null };
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { present: true, raw: parsed };
    } catch (error) {
      throw new InternalCrossAmbiguityError(`Redis book payload for order ${orderId} is corrupted.`);
    }
  }

  private async removeRedisOrder(orderId: string): Promise<boolean> {
    const raw = await this.deps.redis.get(`book:order:${orderId}`);
    if (raw === null) {
      return false;
    }
    let parsed: { marketId?: unknown; side?: unknown; member?: unknown } = {};
    try {
      parsed = JSON.parse(raw) as { marketId?: unknown; side?: unknown; member?: unknown };
    } catch {
      throw new InternalCrossAmbiguityError(`Redis book payload for order ${orderId} is corrupted.`);
    }
    if (typeof parsed.marketId !== "string" || (parsed.side !== "buy" && parsed.side !== "sell") || typeof parsed.member !== "string") {
      throw new InternalCrossAmbiguityError(`Redis book payload for order ${orderId} is malformed.`);
    }

    const removedCount = await this.deps.redis.zrem(
      `book:${parsed.marketId}:${String(parsed.side).toUpperCase()}`,
      parsed.member
    );
    await this.deps.redis.del(`book:order:${orderId}`);
    return removedCount > 0;
  }

  private async insertAdminEvent(input: {
    entityType: "ORDER" | "TRADE";
    entityId: string;
    action: string;
    requestedBy: string;
    correlationId: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const eventId = randomUUID();
    await this.deps.pool.query(
      `INSERT INTO internal_cross_admin_events
        (id, entity_type, entity_id, action, requested_by, correlation_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        eventId,
        input.entityType,
        input.entityId,
        input.action,
        input.requestedBy,
        input.correlationId,
        JSON.stringify(input.payload)
      ]
    );
    return eventId;
  }
}
