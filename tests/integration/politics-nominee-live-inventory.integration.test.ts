import { describe, expect, it } from "vitest";

import { buildLiveNomineeMarket, runPoliticsNomineeArtifacts } from "./politics-test-fixtures.js";

describe("politics nominee live inventory", () => {
  it("tracks live nominee rows and venue fetch status", () => {
    const artifacts = runPoliticsNomineeArtifacts([
      buildLiveNomineeMarket({ interpretedContractId: "op-1", venue: "OPINION" }),
      buildLiveNomineeMarket({ interpretedContractId: "pm-1", venue: "POLYMARKET" }),
      buildLiveNomineeMarket({ interpretedContractId: "ll-1", venue: "LIMITLESS" })
    ]);

    expect(artifacts.liveInventorySummary.liveNomineeRowsByVenue.OPINION).toBe(1);
    expect(artifacts.liveInventorySummary.liveNomineeRowsByVenue.POLYMARKET).toBe(1);
    expect(artifacts.liveFetchStatus.OPINION!.fetchStatus).toBe("SUCCESS");
    expect(artifacts.liveFetchStatus.POLYMARKET!.fetchStatus).toBe("PARTIAL");
    expect(artifacts.liveFetchStatus.PREDICT!.fetchStatus).toBe("EMPTY");
  });
});
