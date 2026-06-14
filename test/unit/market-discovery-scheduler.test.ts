import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isMarketDiscoverySchedulerEnabled,
  startMarketDiscoveryScheduler
} from "../../src/market-discovery/market-discovery-scheduler.js";
import type { MarketDiscoveryRunSummary } from "../../src/market-discovery/market-discovery-types.js";

const logger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

describe("market discovery scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is enabled only for staging or preview environments", () => {
    expect(isMarketDiscoverySchedulerEnabled({ LOTUS_DEPLOY_ENV: "staging" })).toBe(true);
    expect(isMarketDiscoverySchedulerEnabled({ APP_ENV: "preview" })).toBe(true);
    expect(isMarketDiscoverySchedulerEnabled({ LOTUS_DEPLOY_ENV: "production", NODE_ENV: "production" })).toBe(false);
  });

  it("does not start outside staging or preview", () => {
    const log = logger();
    const handle = startMarketDiscoveryScheduler(
      { runOnce: vi.fn() },
      log as never,
      { env: { LOTUS_DEPLOY_ENV: "production" } }
    );

    expect(handle).toBeNull();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ lotusDeployEnv: "production" }),
      "Market discovery scheduler disabled outside staging/preview."
    );
  });

  it("skips overlapping runs", async () => {
    vi.useFakeTimers();
    const log = logger();
    let resolveRun: (() => void) | undefined;
    const summary: MarketDiscoveryRunSummary = {
      observedAt: "2026-06-14T00:00:00.000Z",
      inventoryRows: 0,
      activeRows: 0,
      upstreamRows: 0,
      candidateCount: 1,
      newDiscoveryCount: 1,
      mergeSuggestionCount: 0,
      enrichmentOnlyCount: 0,
      lowConfidenceCount: 0,
      discoveredCount: 0,
      ingestedCount: 1,
      persistedCount: 1,
      snapshotPersistedCount: 1,
      staleRetiredCount: 0,
      upstreamRowsByVenueCategory: {},
      lowConfidenceMissingFieldCounts: {},
      venueStatuses: {}
    };
    const runOnce = vi.fn<() => Promise<MarketDiscoveryRunSummary>>(async () => new Promise((resolve) => {
      resolveRun = () => resolve({
        ...summary
      });
    }));

    const handle = startMarketDiscoveryScheduler(
      { runOnce },
      log as never,
      {
        env: { LOTUS_DEPLOY_ENV: "staging" },
        intervalMs: 60_000,
        runImmediately: true
      }
    );

    expect(handle).not.toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { reason: "interval" },
      "Market discovery scheduler skipped overlapping run."
    );

    resolveRun?.();
    await vi.runOnlyPendingTimersAsync();
    handle?.stop();
  });
});
