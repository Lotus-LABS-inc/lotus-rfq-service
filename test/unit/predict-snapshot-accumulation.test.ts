import { describe, expect, it } from "vitest";

import {
  buildPredictAccumulationMarketProgress,
  selectPredictAccumulationTargets
} from "../../src/operations/semantic-expansion/predict-snapshot-accumulation.js";

describe("predict snapshot accumulation", () => {
  it("selects a balanced 8-market sample with category quotas first", () => {
    const selected = selectPredictAccumulationTargets([
      { marketId: "c1", title: "crypto 1", category: "CRYPTO", lastSeenAt: "2026-03-29T00:00:00.000Z" },
      { marketId: "c2", title: "crypto 2", category: "CRYPTO", lastSeenAt: "2026-03-29T00:00:00.000Z" },
      { marketId: "c3", title: "crypto 3", category: "CRYPTO", lastSeenAt: "2026-03-29T00:00:00.000Z" },
      { marketId: "s1", title: "sports 1", category: "SPORTS", lastSeenAt: "2026-03-29T00:00:00.000Z" },
      { marketId: "s2", title: "sports 2", category: "SPORTS", lastSeenAt: "2026-03-29T00:00:00.000Z" },
      { marketId: "s3", title: "sports 3", category: "SPORTS", lastSeenAt: "2026-03-29T00:00:00.000Z" },
      { marketId: "o1", title: "other 1", category: "OTHER", lastSeenAt: "2026-03-29T00:00:00.000Z" },
      { marketId: "o2", title: "other 2", category: "OTHER", lastSeenAt: "2026-03-29T00:00:00.000Z" },
      { marketId: "o3", title: "other 3", category: "OTHER", lastSeenAt: "2026-03-29T00:00:00.000Z" }
    ], 8);

    expect(selected.map((market) => market.marketId)).toEqual(["c1", "c2", "c3", "s1", "s2", "s3", "o1", "o2"]);
  });

  it("classifies timeout without native snapshots as no_native_orderbook", () => {
    const progress = buildPredictAccumulationMarketProgress({
      target: {
        marketId: "524",
        title: "BNB 5+ times",
        category: "OTHER",
        lastSeenAt: "2026-03-29T00:00:00.000Z"
      },
      targetSnapshotCount: 100,
      snapshotCount: 0,
      checkpointCount: 2,
      firstSnapshotAt: null,
      latestSnapshotAt: null,
      progressState: {
        lastRestSuccessAt: null,
        lastWsSuccessAt: "2026-03-29T01:00:00.000Z",
        latestError: "native_orderbook_not_found",
        consecutiveFailureCount: 5
      },
      wallClockExpired: true
    });

    expect(progress.status).toBe("no_native_orderbook");
    expect(progress.coverageCount).toBe(0);
  });
});
