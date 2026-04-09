import { describe, expect, it } from "vitest";

import { buildLimitlessBtcDirectionalDiscoveryMap } from "../../src/reports/limitless-btc-directional-discovery-map.js";

describe("limitless btc directional discovery map", () => {
  it("enumerates the supported Limitless discovery and enrichment surfaces", () => {
    const artifact = buildLimitlessBtcDirectionalDiscoveryMap({
      limitlessApiKeyPresent: true
    });

    expect(artifact.authoritativeDiscoverySurface).toBe("limitless-live-market-loader");
    expect(artifact.surfaces.map((surface) => surface.surfaceName)).toEqual(expect.arrayContaining([
      "limitless-live-market-loader",
      "limitless-live-market-loader-snapshot-fallback",
      "limitless-client-market-detail",
      "ingest-limitless-live-markets.job",
      "btc-venue-audit-sources"
    ]));
  });
});
