import { describe, expect, it } from "vitest";
import {
  buildFundingReadinessWatcherConfigFromEnv,
  FundingReadinessWatcher,
  type FundingReadinessWatcherLogger,
  type FundingReadinessWatcherRepository
} from "../src/core/funding/funding-readiness-watcher.js";

const logger = (): FundingReadinessWatcherLogger => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
});

describe("funding readiness watcher", () => {
  it("defaults disabled and uses bounded config values", () => {
    expect(buildFundingReadinessWatcherConfigFromEnv({})).toEqual({
      enabled: false,
      intervalMs: 60_000,
      batchSize: 25,
      staleAfterSeconds: 30
    });
    expect(buildFundingReadinessWatcherConfigFromEnv({
      FUNDING_READINESS_WATCHER_ENABLED: "true",
      FUNDING_READINESS_WATCHER_INTERVAL_MS: "1",
      FUNDING_READINESS_WATCHER_BATCH_SIZE: "0",
      FUNDING_READINESS_WATCHER_STALE_AFTER_SECONDS: "-1"
    })).toEqual({
      enabled: true,
      intervalMs: 5_000,
      batchSize: 1,
      staleAfterSeconds: 0
    });
  });

  it("refreshes stale funding intents through the existing funding service path", async () => {
    const refreshed: Array<{ userId: string; fundingIntentId: string }> = [];
    const repository: FundingReadinessWatcherRepository = {
      async listFundingIntentsForReadinessWatch(input) {
        expect(input).toEqual({ limit: 2, staleAfterSeconds: 10 });
        return [
          { userId: "user-1", fundingIntentId: "intent-1" },
          { userId: "user-2", fundingIntentId: "intent-2" }
        ];
      }
    };
    const watcher = new FundingReadinessWatcher(
      repository,
      {
        async refreshIntentStatus(userId, fundingIntentId) {
          refreshed.push({ userId, fundingIntentId });
        }
      },
      logger(),
      {
        enabled: true,
        intervalMs: 60_000,
        batchSize: 2,
        staleAfterSeconds: 10
      }
    );

    await expect(watcher.runOnce()).resolves.toEqual({
      scanned: 2,
      refreshed: 2,
      failed: 0
    });
    expect(refreshed).toEqual([
      { userId: "user-1", fundingIntentId: "intent-1" },
      { userId: "user-2", fundingIntentId: "intent-2" }
    ]);
  });

  it("does not let one failed intent block the rest of the watcher batch", async () => {
    const watcher = new FundingReadinessWatcher(
      {
        async listFundingIntentsForReadinessWatch() {
          return [
            { userId: "user-1", fundingIntentId: "intent-1" },
            { userId: "user-2", fundingIntentId: "intent-2" }
          ];
        }
      },
      {
        async refreshIntentStatus(_userId, fundingIntentId) {
          if (fundingIntentId === "intent-1") {
            throw new Error("temporary venue read failure");
          }
        }
      },
      logger(),
      {
        enabled: true,
        intervalMs: 60_000,
        batchSize: 25,
        staleAfterSeconds: 30
      }
    );

    await expect(watcher.runOnce()).resolves.toEqual({
      scanned: 2,
      refreshed: 1,
      failed: 1
    });
  });
});
