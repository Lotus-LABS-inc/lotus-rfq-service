import { describe, expect, it } from "vitest";

import { buildStagingShadowWindowConfig } from "../../src/shadow/staging-shadow-window-config.js";

describe("staging shadow window config", () => {
  it("restricts canary-countable scopes to approved exact-safe subsets", () => {
    const config = buildStagingShadowWindowConfig([
      {
        routeClassId: "PAIR_PM_LIMITLESS",
        definition: { routeMode: "POLYMARKET_LIMITLESS" },
        safeSubsetMarkets: [
          { canonicalEventId: "evt-1", canonicalMarketId: "mkt-1" },
          { canonicalEventId: "evt-2", canonicalMarketId: "mkt-2" }
        ],
        runnableMarkets: [
          { canonicalEventId: "evt-3", canonicalMarketId: "mkt-3" }
        ],
        blockedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"]
      },
      {
        routeClassId: "PAIR_PM_OPINION",
        definition: { routeMode: "POLYMARKET_OPINION" },
        safeSubsetMarkets: [
          { canonicalEventId: "btc-evt", canonicalMarketId: "btc-mkt" }
        ],
        runnableMarkets: [],
        blockedFamilies: ["POLITICS:*"]
      }
    ] as never, new Date("2026-03-30T12:00:00.000Z"));

    expect(config.authoritativePersistenceTarget).toBe("SUPABASE_DB_URL");
    expect(config.harnessSource).toBe("staging_replay_harness");
    expect(config.routes[0]?.canaryCountableScopeKeys).toEqual(["mkt-1", "mkt-2"]);
    expect(config.routes[0]?.shadowObservableScopeKeys).toEqual(["mkt-3"]);
    expect(config.routes[1]?.sampleTarget).toBe(3);
  });
});
