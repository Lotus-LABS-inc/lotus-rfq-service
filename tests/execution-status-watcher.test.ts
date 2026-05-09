import { describe, expect, it, vi } from "vitest";
import {
  ExecutionStatusWatcher,
  ExecutionVenueAdapterRegistry,
  SignedTradeBundleService,
  TestExecutionAdapter,
  type ActiveSignedTradeExecutionStatusRepository,
  type ExecutableTradeQuote,
  type ExecutionUpdatePublisher,
  type SignedTradeExecutionStatus,
  type SignedTradePositionRecorder,
  type VerifiedExecutionPosition,
  type VerifiedPositionRepository
} from "../src/execution-system/index.js";

const quote = (): ExecutableTradeQuote => ({
  quoteId: "exec_quote_watch",
  userId: "user-1",
  side: "buy",
  marketId: "canonical-market",
  outcomeId: "YES",
  routeType: "SINGLE_VENUE",
  venuePath: ["TEST"],
  executableAmount: "1",
  skippedAmount: "0",
  expectedPrice: 0.51,
  requiredUserSignatureSteps: [],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  legs: [{
    venue: "TEST",
    venueMarketId: "test-market",
    venueOutcomeId: "test-outcome",
    size: "1",
    price: 0.51,
    requiresUserSignature: false
  }]
});

class MemoryActiveStatusRepository implements ActiveSignedTradeExecutionStatusRepository {
  public readonly rows = new Map<string, SignedTradeExecutionStatus>();

  public constructor(rows: SignedTradeExecutionStatus[]) {
    for (const row of rows) {
      this.rows.set(`${row.userId}:${row.executionId}`, structuredClone(row));
    }
  }

  public async saveExecutionStatus(status: SignedTradeExecutionStatus): Promise<void> {
    this.rows.set(`${status.userId}:${status.executionId}`, structuredClone(status));
  }

  public async findExecutionStatus(input: { userId: string; executionId: string }): Promise<SignedTradeExecutionStatus | null> {
    return structuredClone(this.rows.get(`${input.userId}:${input.executionId}`) ?? null);
  }

  public async listActiveExecutionStatuses(): Promise<SignedTradeExecutionStatus[]> {
    return Array.from(this.rows.values()).map((row) => structuredClone(row));
  }
}

class MemoryPositionStore implements SignedTradePositionRecorder, VerifiedPositionRepository {
  public readonly applications = new Set<string>();
  public readonly positions: VerifiedExecutionPosition[] = [];

  public async recordFilledLeg(input: Parameters<SignedTradePositionRecorder["recordFilledLeg"]>[0]): Promise<void> {
    const key = `${input.executionId}:${input.userId}:${input.legIndex}:${input.venueOrderId}`;
    if (this.applications.has(key)) {
      return;
    }
    this.applications.add(key);
    this.positions.push({
      positionId: key,
      userId: input.userId,
      venue: input.routeLeg.venue,
      marketId: input.route.marketId,
      outcomeId: input.route.outcomeId,
      venueAccountAddress: null,
      verifiedSize: input.routeLeg.size,
      averageEntryPrice: input.routeLeg.price,
      sellableSize: input.routeLeg.size,
      lastSettlementEvidenceId: input.venueOrderId,
      status: "VERIFIED",
      metadata: { executionId: input.executionId }
    });
  }

  public async listVerifiedPositions(input: { userId: string; marketId: string; outcomeId: string; venue?: string | undefined }): Promise<VerifiedExecutionPosition[]> {
    return this.positions.filter((position) =>
      position.userId === input.userId &&
      position.marketId === input.marketId &&
      position.outcomeId === input.outcomeId &&
      (!input.venue || position.venue === input.venue)
    );
  }

  public async applySettlementDelta(): Promise<VerifiedExecutionPosition> {
    throw new Error("not used");
  }
}

const service = (positionStore: MemoryPositionStore, adapter = new TestExecutionAdapter("TEST", {
  fillStatus: "FILLED",
  fillPrice: 0.51,
  settlementStatus: "SETTLEMENT_VERIFIED"
})): SignedTradeBundleService => {
  const registry = new ExecutionVenueAdapterRegistry();
  registry.register(adapter);
  return new SignedTradeBundleService(
    { getQuote: async () => quote() } as never,
    registry,
    { getAccount: async () => null },
    () => new Date("2026-05-08T10:00:00.000Z"),
    process.env,
    undefined,
    positionStore
  );
};

describe("ExecutionStatusWatcher", () => {
  it("refreshes active submitted orders, records positions once, and publishes status and position events", async () => {
    const route = quote();
    const repository = new MemoryActiveStatusRepository([{
      executionId: route.quoteId,
      userId: route.userId,
      status: "SUBMITTED",
      dryRun: false,
      submittedAt: "2026-05-08T09:59:00.000Z",
      updatedAt: "2026-05-08T09:59:00.000Z",
      route,
      submittedLegs: [{
        legIndex: 0,
        venue: "TEST",
        status: "SUBMITTED",
        venueOrderId: "test-order-1"
      }]
    }]);
    const positionStore = new MemoryPositionStore();
    const publisher: ExecutionUpdatePublisher = {
      publishExecutionStatus: vi.fn(async () => undefined),
      publishPositions: vi.fn(async () => undefined)
    };
    const watcher = new ExecutionStatusWatcher(
      repository,
      service(positionStore),
      positionStore,
      publisher,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      { enabled: true, intervalMs: 1_000, batchSize: 50, activeWindowSeconds: 900, settlementIntervalMs: 5_000 }
    );

    await watcher.runOnce();
    await watcher.runOnce();

    const stored = await repository.findExecutionStatus({ userId: route.userId, executionId: route.quoteId });
    expect(stored?.status).toBe("FILLED");
    expect(stored?.submittedLegs[0]?.fillState).toMatchObject({ status: "FILLED", filledSize: "1", averagePrice: 0.51 });
    expect(stored?.submittedLegs[0]?.settlementState).toMatchObject({ status: "SETTLEMENT_VERIFIED" });
    expect(positionStore.applications.size).toBe(1);
    expect(publisher.publishExecutionStatus).toHaveBeenCalled();
    expect(publisher.publishPositions).toHaveBeenCalledWith(expect.objectContaining({
      userId: route.userId,
      marketId: route.marketId,
      outcomeId: route.outcomeId,
      positions: expect.arrayContaining([expect.objectContaining({ verifiedSize: "1" })])
    }));
  });

  it("does not erase prior fill evidence when a later venue status lookup fails", async () => {
    const route = quote();
    const repository = new MemoryActiveStatusRepository([{
      executionId: route.quoteId,
      userId: route.userId,
      status: "FILLED",
      dryRun: false,
      submittedAt: "2026-05-08T09:59:00.000Z",
      updatedAt: "2026-05-08T09:59:00.000Z",
      route,
      submittedLegs: [{
        legIndex: 0,
        venue: "TEST",
        status: "FILLED",
        venueOrderId: "test-order-1",
        fillState: { status: "FILLED", filledSize: "1", averagePrice: 0.51 }
      }]
    }]);
    const positionStore = new MemoryPositionStore();
    const failingAdapter = {
      ...new TestExecutionAdapter("TEST"),
      venue: "TEST",
      async fetchFillState() {
        throw new Error("venue unavailable");
      }
    } as unknown as TestExecutionAdapter;
    const watcher = new ExecutionStatusWatcher(
      repository,
      service(positionStore, failingAdapter),
      positionStore,
      { publishExecutionStatus: vi.fn(async () => undefined), publishPositions: vi.fn(async () => undefined) },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      { enabled: true, intervalMs: 1_000, batchSize: 50, activeWindowSeconds: 900, settlementIntervalMs: 5_000 }
    );

    await watcher.runOnce();

    const stored = await repository.findExecutionStatus({ userId: route.userId, executionId: route.quoteId });
    expect(stored?.status).toBe("FILLED");
    expect(stored?.submittedLegs[0]?.fillState).toMatchObject({ status: "FILLED", filledSize: "1" });
    expect(stored?.submittedLegs[0]?.lastWatcherError).toBe("venue unavailable");
  });
});
