import { describe, expect, it, vi } from "vitest";
import { InternalCrossingEngine } from "../../src/core/internal-engine/engine.js";
import type { InternalOrder, RedisBookOrder } from "../../src/core/internal-engine/types.js";
import type { OrderBook } from "../../src/core/internal-engine/order-book.js";
import type { LockHandle, OrderLocker } from "../../src/core/internal-engine/locker.js";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import { OrderLockError } from "../../src/core/internal-engine/locker.js";

interface QueryResponse<Row> {
  rows: Row[];
}

const makeIncomingOrder = (overrides: Partial<InternalOrder> = {}): InternalOrder => ({
  id: overrides.id ?? "taker-order-1",
  market_id: overrides.market_id ?? "11111111-1111-1111-1111-111111111111",
  user_id: overrides.user_id ?? "22222222-2222-2222-2222-222222222222",
  side: overrides.side ?? "buy",
  price: overrides.price ?? "0.60",
  initial_size: overrides.initial_size ?? "10",
  remaining_size: overrides.remaining_size ?? "10",
  status: overrides.status ?? "OPEN",
  ...(overrides.resolution_profile_id !== undefined
    ? { resolution_profile_id: overrides.resolution_profile_id }
    : {}),
  created_at: overrides.created_at ?? new Date("2026-03-10T12:00:00.000Z"),
  updated_at: overrides.updated_at ?? new Date("2026-03-10T12:00:00.000Z")
});

const makeMakerEntry = (overrides: Partial<RedisBookOrder> = {}): RedisBookOrder => ({
  orderId: overrides.orderId ?? "maker-order-1",
  marketId: overrides.marketId ?? "11111111-1111-1111-1111-111111111111",
  side: overrides.side ?? "sell",
  member: overrides.member ?? "000000000000001:maker-order-1",
  price: overrides.price ?? "0.60",
  remaining: overrides.remaining ?? "5",
  userId: overrides.userId ?? "33333333-3333-3333-3333-333333333333",
  createdAtMs: overrides.createdAtMs ?? Date.parse("2026-03-10T11:59:00.000Z"),
  ...(overrides.resolutionProfileId !== undefined
    ? { resolutionProfileId: overrides.resolutionProfileId }
    : {})
});

const makeLogger = (): Pick<Logger, "info" | "warn" | "error"> => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const makePoolClient = (
  query: (sql: string, params?: unknown[]) => Promise<QueryResponse<Record<string, unknown>>>
): PoolClient =>
  ({
    query: query as unknown as PoolClient["query"],
    release: vi.fn()
  } as unknown as PoolClient);

describe("InternalCrossingEngine", () => {
  it("matches a maker order, updates exposure, and returns partial-fill progress", async () => {
    const orderBook: Pick<OrderBook, "getBestOppositeOrders" | "removeOrder" | "updateRemaining"> = {
      getBestOppositeOrders: vi.fn().mockResolvedValueOnce([makeMakerEntry()]).mockResolvedValueOnce([]),
      removeOrder: vi.fn(),
      updateRemaining: vi.fn().mockResolvedValue({ orderId: "maker-order-1", remaining: "0" })
    };
    const lockHandle: LockHandle = {
      lockIds: ["lock:order:maker-order-1", "lock:order:taker-order-1"],
      ownerId: "owner-1"
    };
    const orderLocker: Pick<OrderLocker, "acquireDualOrderLocks" | "releaseLocks"> = {
      acquireDualOrderLocks: vi.fn().mockResolvedValue(lockHandle),
      releaseLocks: vi.fn().mockResolvedValue(undefined)
    };

    const query = vi.fn<
      (sql: string, params?: unknown[]) => Promise<QueryResponse<Record<string, unknown>>>
    >()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: "maker-order-1",
            user_id: "33333333-3333-3333-3333-333333333333",
            market_id: "11111111-1111-1111-1111-111111111111",
            side: "sell",
            price: "0.60",
            remaining_size: "15",
            status: "OPEN",
            created_at: new Date("2026-03-10T11:59:00.000Z")
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "trade-1", created_at: new Date("2026-03-10T12:00:01.000Z") }]
      })
      .mockResolvedValueOnce({ rows: [] }) // update maker
      .mockResolvedValueOnce({ rows: [] }) // taker exposure select
      .mockResolvedValueOnce({ rows: [{ id: "exp-taker" }] }) // taker exposure insert
      .mockResolvedValueOnce({ rows: [] }) // taker journal
      .mockResolvedValueOnce({ rows: [] }) // maker exposure select
      .mockResolvedValueOnce({ rows: [{ id: "exp-maker" }] }) // maker exposure insert
      .mockResolvedValueOnce({ rows: [] }) // maker journal
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const client = makePoolClient(query);
    const pool: Pick<Pool, "connect"> = {
      connect: vi.fn().mockResolvedValue(client)
    };
    const logger = makeLogger();
    const engine = new InternalCrossingEngine(pool as Pool, orderBook as OrderBook, orderLocker as OrderLocker, logger as Logger);

    const result = await engine.attemptCross(makeIncomingOrder());

    expect(result.filledSize).toBe(10);
    expect(result.remainingSize).toBe(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.size).toBe("10");
    expect(orderBook.updateRemaining).toHaveBeenCalledWith("maker-order-1", "5");
    expect(orderLocker.releaseLocks).toHaveBeenCalledWith(lockHandle);

    const takerExposureInsert = query.mock.calls[5];
    const takerJournalInsert = query.mock.calls[6];
    const makerExposureInsert = query.mock.calls[8];
    const makerJournalInsert = query.mock.calls[9];

    expect(takerExposureInsert?.[1]).toEqual([
      "22222222-2222-2222-2222-222222222222",
      "11111111-1111-1111-1111-111111111111",
      "buy",
      "6",
      "-2",
    ]);
    expect(makerExposureInsert?.[1]).toEqual([
      "33333333-3333-3333-3333-333333333333",
      "11111111-1111-1111-1111-111111111111",
      "sell",
      "4",
      "2",
    ]);

    const takerPayload = JSON.parse(String(takerJournalInsert?.[1]?.[8] ?? "{}")) as Record<string, string>;
    const makerPayload = JSON.parse(String(makerJournalInsert?.[1]?.[8] ?? "{}")) as Record<string, string>;
    expect(Number(takerPayload.maxLossDelta)).toBeCloseTo(6, 8);
    expect(Number(takerPayload.maxGainDelta)).toBeCloseTo(4, 8);
    expect(Number(makerPayload.maxLossDelta)).toBeCloseTo(4, 8);
    expect(Number(makerPayload.maxGainDelta)).toBeCloseTo(6, 8);
  });

  it("fully fills a maker and removes it from the redis book", async () => {
    const orderBook: Pick<OrderBook, "getBestOppositeOrders" | "removeOrder" | "updateRemaining"> = {
      getBestOppositeOrders: vi.fn().mockResolvedValueOnce([makeMakerEntry({ remaining: "10" })]).mockResolvedValueOnce([]),
      removeOrder: vi.fn().mockResolvedValue(true),
      updateRemaining: vi.fn()
    };
    const lockHandle: LockHandle = {
      lockIds: ["lock:order:maker-order-1", "lock:order:taker-order-1"],
      ownerId: "owner-1"
    };
    const orderLocker: Pick<OrderLocker, "acquireDualOrderLocks" | "releaseLocks"> = {
      acquireDualOrderLocks: vi.fn().mockResolvedValue(lockHandle),
      releaseLocks: vi.fn().mockResolvedValue(undefined)
    };

    const query = vi.fn<
      (sql: string, params?: unknown[]) => Promise<QueryResponse<Record<string, unknown>>>
    >()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "maker-order-1",
            user_id: "33333333-3333-3333-3333-333333333333",
            market_id: "11111111-1111-1111-1111-111111111111",
            side: "sell",
            price: "0.60",
            remaining_size: "10",
            status: "OPEN",
            created_at: new Date("2026-03-10T11:59:00.000Z")
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "trade-1", created_at: new Date("2026-03-10T12:00:01.000Z") }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "exp-taker" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "exp-maker" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const pool: Pick<Pool, "connect"> = {
      connect: vi.fn().mockResolvedValue(makePoolClient(query))
    };
    const engine = new InternalCrossingEngine(pool as Pool, orderBook as OrderBook, orderLocker as OrderLocker, makeLogger() as Logger);

    const result = await engine.attemptCross(makeIncomingOrder({ remaining_size: "10", initial_size: "10" }));

    expect(result.filledSize).toBe(10);
    expect(result.remainingSize).toBe(0);
    expect(orderBook.removeOrder).toHaveBeenCalledWith("maker-order-1");
    expect(orderBook.updateRemaining).not.toHaveBeenCalled();
  });

  it("cancels matching on self-trade without taking locks", async () => {
    const orderBook: Pick<OrderBook, "getBestOppositeOrders"> = {
      getBestOppositeOrders: vi.fn().mockResolvedValue([
        makeMakerEntry({ userId: "22222222-2222-2222-2222-222222222222" })
      ])
    };
    const orderLocker: Pick<OrderLocker, "acquireDualOrderLocks" | "releaseLocks"> = {
      acquireDualOrderLocks: vi.fn(),
      releaseLocks: vi.fn()
    };
    const pool: Pick<Pool, "connect"> = {
      connect: vi.fn()
    };
    const logger = makeLogger();
    const engine = new InternalCrossingEngine(pool as Pool, orderBook as OrderBook, orderLocker as OrderLocker, logger as Logger);

    const result = await engine.attemptCross(makeIncomingOrder());

    expect(result.filledSize).toBe(0);
    expect(result.remainingSize).toBe(0);
    expect(orderLocker.acquireDualOrderLocks).not.toHaveBeenCalled();
  });

  it("allows SAFE_EQUIVALENT cross-profile crossing candidates", async () => {
    const orderBook: Pick<OrderBook, "getBestOppositeOrders" | "removeOrder" | "updateRemaining"> = {
      getBestOppositeOrders: vi.fn().mockResolvedValueOnce([
        makeMakerEntry({ remaining: "10", resolutionProfileId: "profile-b" })
      ]).mockResolvedValueOnce([]),
      removeOrder: vi.fn().mockResolvedValue(true),
      updateRemaining: vi.fn()
    };
    const lockHandle: LockHandle = {
      lockIds: ["lock:order:maker-order-1", "lock:order:taker-order-1"],
      ownerId: "owner-1"
    };
    const orderLocker: Pick<OrderLocker, "acquireDualOrderLocks" | "releaseLocks"> = {
      acquireDualOrderLocks: vi.fn().mockResolvedValue(lockHandle),
      releaseLocks: vi.fn().mockResolvedValue(undefined)
    };
    const eligibilityService = {
      isSafeForInternalPooling: vi.fn().mockResolvedValue(true)
    };

    const query = vi.fn<
      (sql: string, params?: unknown[]) => Promise<QueryResponse<Record<string, unknown>>>
    >()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "maker-order-1",
            user_id: "33333333-3333-3333-3333-333333333333",
            market_id: "11111111-1111-1111-1111-111111111111",
            side: "sell",
            price: "0.60",
            remaining_size: "10",
            status: "OPEN",
            created_at: new Date("2026-03-10T11:59:00.000Z")
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "trade-1", created_at: new Date("2026-03-10T12:00:01.000Z") }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "exp-taker" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "exp-maker" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const pool: Pick<Pool, "connect"> = {
      connect: vi.fn().mockResolvedValue(makePoolClient(query))
    };
    const engine = new InternalCrossingEngine(
      pool as Pool,
      orderBook as OrderBook,
      orderLocker as OrderLocker,
      makeLogger() as Logger,
      eligibilityService as never
    );

    const result = await engine.attemptCross(
      makeIncomingOrder({ resolution_profile_id: "profile-a", remaining_size: "10", initial_size: "10" })
    );

    expect(eligibilityService.isSafeForInternalPooling).toHaveBeenCalledWith(
      "profile-a",
      "profile-b",
      { stableKey: "taker-order-1" }
    );
    expect(result.filledSize).toBe(10);
  });

  it("rejects non-safe cross-profile crossing candidates fail-closed", async () => {
    const orderBook: Pick<OrderBook, "getBestOppositeOrders"> = {
      getBestOppositeOrders: vi.fn().mockResolvedValue([
        makeMakerEntry({ resolutionProfileId: "profile-b" })
      ])
    };
    const orderLocker: Pick<OrderLocker, "acquireDualOrderLocks" | "releaseLocks"> = {
      acquireDualOrderLocks: vi.fn(),
      releaseLocks: vi.fn()
    };
    const eligibilityService = {
      isSafeForInternalPooling: vi.fn().mockResolvedValue(false)
    };
    const engine = new InternalCrossingEngine(
      { connect: vi.fn() } as unknown as Pool,
      orderBook as OrderBook,
      orderLocker as OrderLocker,
      makeLogger() as Logger,
      eligibilityService as never
    );

    const result = await engine.attemptCross(
      makeIncomingOrder({ resolution_profile_id: "profile-a" })
    );

    expect(eligibilityService.isSafeForInternalPooling).toHaveBeenCalledWith(
      "profile-a",
      "profile-b",
      { stableKey: "taker-order-1" }
    );
    expect(orderLocker.acquireDualOrderLocks).not.toHaveBeenCalled();
    expect(result.filledSize).toBe(0);
    expect(result.remainingSize).toBe(10);
  });

  it("rolls back and removes stale makers when Postgres revalidation fails", async () => {
    const orderBook: Pick<OrderBook, "getBestOppositeOrders" | "removeOrder"> = {
      getBestOppositeOrders: vi.fn().mockResolvedValueOnce([makeMakerEntry()]).mockResolvedValueOnce([]),
      removeOrder: vi.fn().mockResolvedValue(true)
    };
    const lockHandle: LockHandle = {
      lockIds: ["lock:order:maker-order-1", "lock:order:taker-order-1"],
      ownerId: "owner-1"
    };
    const orderLocker: Pick<OrderLocker, "acquireDualOrderLocks" | "releaseLocks"> = {
      acquireDualOrderLocks: vi.fn().mockResolvedValue(lockHandle),
      releaseLocks: vi.fn().mockResolvedValue(undefined)
    };

    const query = vi.fn<
      (sql: string, params?: unknown[]) => Promise<QueryResponse<Record<string, unknown>>>
    >()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // maker select returns none
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const client: Pick<PoolClient, "query" | "release"> = {
      query: query as unknown as PoolClient["query"],
      release: vi.fn()
    } as unknown as PoolClient;
    const pool: Pick<Pool, "connect"> = {
      connect: vi.fn().mockResolvedValue(client)
    };
    const logger = makeLogger();
    const engine = new InternalCrossingEngine(pool as Pool, orderBook as OrderBook, orderLocker as OrderLocker, logger as Logger);

    const result = await engine.attemptCross(makeIncomingOrder());

    expect(result.trades).toEqual([]);
    expect(orderBook.removeOrder).toHaveBeenCalledWith("maker-order-1");
    expect(orderLocker.releaseLocks).toHaveBeenCalledWith(lockHandle);
  });

  it("skips duplicate trade replay without mutating exposure twice", async () => {
    const orderBook: Pick<OrderBook, "getBestOppositeOrders" | "updateRemaining"> = {
      getBestOppositeOrders: vi.fn().mockResolvedValueOnce([makeMakerEntry()]).mockResolvedValueOnce([]),
      updateRemaining: vi.fn().mockResolvedValue({ orderId: "maker-order-1", remaining: "5" })
    };
    const orderLocker: Pick<OrderLocker, "acquireDualOrderLocks" | "releaseLocks"> = {
      acquireDualOrderLocks: vi.fn().mockResolvedValue({
        lockIds: ["lock:order:maker-order-1", "lock:order:taker-order-1"],
        ownerId: "owner-1"
      }),
      releaseLocks: vi.fn().mockResolvedValue(undefined)
    };

    const query = vi.fn<
      (sql: string, params?: unknown[]) => Promise<QueryResponse<Record<string, unknown>>>
    >()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: "maker-order-1",
            user_id: "33333333-3333-3333-3333-333333333333",
            market_id: "11111111-1111-1111-1111-111111111111",
            side: "sell",
            price: "0.60",
            remaining_size: "5",
            status: "OPEN",
            created_at: new Date("2026-03-10T11:59:00.000Z")
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] }) // duplicate trade insert
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const pool: Pick<Pool, "connect"> = {
      connect: vi.fn().mockResolvedValue(makePoolClient(query))
    };
    const logger = makeLogger();
    const engine = new InternalCrossingEngine(pool as Pool, orderBook as OrderBook, orderLocker as OrderLocker, logger as Logger);

    const result = await engine.attemptCross(makeIncomingOrder());

    expect(result.trades).toEqual([]);
    expect(result.filledSize).toBe(0);
    expect(orderBook.updateRemaining).toHaveBeenCalledWith("maker-order-1", "5");
  });

  it("fails closed on lock contention before beginning any transaction", async () => {
    const orderBook: Pick<OrderBook, "getBestOppositeOrders"> = {
      getBestOppositeOrders: vi.fn().mockResolvedValue([makeMakerEntry()])
    };
    const orderLocker: Pick<OrderLocker, "acquireDualOrderLocks" | "releaseLocks"> = {
      acquireDualOrderLocks: vi.fn().mockRejectedValue(
        new OrderLockError(["maker-order-1", "taker-order-1"], 5)
      ),
      releaseLocks: vi.fn()
    };
    const pool: Pick<Pool, "connect"> = {
      connect: vi.fn()
    };
    const engine = new InternalCrossingEngine(pool as Pool, orderBook as OrderBook, orderLocker as OrderLocker, makeLogger() as Logger);

    await expect(engine.attemptCross(makeIncomingOrder())).rejects.toBeInstanceOf(OrderLockError);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(orderLocker.releaseLocks).not.toHaveBeenCalled();
  });

  it("rolls back and rethrows when a downstream DB write fails after trade insert", async () => {
    const orderBook: Pick<OrderBook, "getBestOppositeOrders" | "removeOrder" | "updateRemaining"> = {
      getBestOppositeOrders: vi.fn().mockResolvedValue([makeMakerEntry()]),
      removeOrder: vi.fn(),
      updateRemaining: vi.fn()
    };
    const lockHandle: LockHandle = {
      lockIds: ["lock:order:maker-order-1", "lock:order:taker-order-1"],
      ownerId: "owner-1"
    };
    const orderLocker: Pick<OrderLocker, "acquireDualOrderLocks" | "releaseLocks"> = {
      acquireDualOrderLocks: vi.fn().mockResolvedValue(lockHandle),
      releaseLocks: vi.fn().mockResolvedValue(undefined)
    };
    const query = vi.fn<
      (sql: string, params?: unknown[]) => Promise<QueryResponse<Record<string, unknown>>>
    >()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "maker-order-1",
            user_id: "33333333-3333-3333-3333-333333333333",
            market_id: "11111111-1111-1111-1111-111111111111",
            side: "sell",
            price: "0.60",
            remaining_size: "5",
            status: "OPEN",
            created_at: new Date("2026-03-10T11:59:00.000Z")
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "trade-1", created_at: new Date("2026-03-10T12:00:01.000Z") }]
      })
      .mockRejectedValueOnce(new Error("update_maker_failed"))
      .mockResolvedValueOnce({ rows: [] });

    const pool: Pick<Pool, "connect"> = {
      connect: vi.fn().mockResolvedValue(makePoolClient(query))
    };
    const engine = new InternalCrossingEngine(pool as Pool, orderBook as OrderBook, orderLocker as OrderLocker, makeLogger() as Logger);

    await expect(engine.attemptCross(makeIncomingOrder({ remaining_size: "5", initial_size: "5" }))).rejects.toThrow("update_maker_failed");
    expect(query).toHaveBeenNthCalledWith(5, "ROLLBACK");
    expect(orderBook.removeOrder).not.toHaveBeenCalled();
    expect(orderBook.updateRemaining).not.toHaveBeenCalled();
    expect(orderLocker.releaseLocks).toHaveBeenCalledWith(lockHandle);
  });
});
