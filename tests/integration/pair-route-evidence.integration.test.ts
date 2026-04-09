import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writePairRouteRolloutArtifacts } from "../../src/operations/semantic-expansion/pair-route-rollout-summary.js";

describe("pair route evidence artifacts", () => {
  it("writes rollout evidence for both pair classes", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "pair-route-evidence-"));
    mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
    mkdirSync(path.join(repoRoot, "artifacts"), { recursive: true });

    writeFileSync(path.join(repoRoot, "docs/time-basis-routeability-summary.json"), JSON.stringify({
      routeabilityByBasis: [
        { basis: "HISTORICAL_ONLY", routeModes: [{ routeMode: "POLYMARKET_LIMITLESS", routeableMarketCount: 0, eventCount: 0 }, { routeMode: "POLYMARKET_OPINION", routeableMarketCount: 0, eventCount: 0 }], totals: { eventCount: 0, canonicalMarketCount: 0, runnableSingleCount: 0, runnablePairCount: 0, runnableTriCount: 0 }, blockReasons: [] },
        { basis: "LIVE_ONLY", routeModes: [{ routeMode: "POLYMARKET_LIMITLESS", routeableMarketCount: 0, eventCount: 0 }, { routeMode: "POLYMARKET_OPINION", routeableMarketCount: 0, eventCount: 0 }], totals: { eventCount: 0, canonicalMarketCount: 0, runnableSingleCount: 0, runnablePairCount: 0, runnableTriCount: 0 }, blockReasons: [] },
        { basis: "MIXED_BASIS", routeModes: [{ routeMode: "POLYMARKET_LIMITLESS", routeableMarketCount: 0, eventCount: 0 }, { routeMode: "POLYMARKET_OPINION", routeableMarketCount: 1, eventCount: 1 }], totals: { eventCount: 0, canonicalMarketCount: 0, runnableSingleCount: 0, runnablePairCount: 0, runnableTriCount: 0 }, blockReasons: [] },
        { basis: "INSUFFICIENT_BASIS", routeModes: [], totals: { eventCount: 0, canonicalMarketCount: 0, runnableSingleCount: 0, runnablePairCount: 0, runnableTriCount: 0 }, blockReasons: [] }
      ]
    }), "utf8");
    writeFileSync(path.join(repoRoot, "docs/pair-family-exactness-report.json"), JSON.stringify({
      families: [
        { pairFamily: "POLYMARKET_LIMITLESS", exactHistoricalQualifiedCount: 1, exactLiveOnlyCount: 0, nearExactCount: 6, noCandidateCount: 0, dominantBlockerFamilies: [] },
        { pairFamily: "POLYMARKET_OPINION", exactHistoricalQualifiedCount: 0, exactLiveOnlyCount: 0, nearExactCount: 3, noCandidateCount: 1, dominantBlockerFamilies: [] }
      ]
    }), "utf8");
    writeFileSync(path.join(repoRoot, "docs/cross-venue-match-report.json"), JSON.stringify({ matches: [] }), "utf8");
    writeFileSync(path.join(repoRoot, "docs/simulation-canonical-events.json"), JSON.stringify({ categories: { CRYPTO: [] } }), "utf8");

    writePairRouteRolloutArtifacts(repoRoot);
    const summary = JSON.parse(readFileSync(path.join(repoRoot, "docs/pair-route-rollout-summary.json"), "utf8"));
    expect(summary.routes).toHaveLength(2);
  });
});
