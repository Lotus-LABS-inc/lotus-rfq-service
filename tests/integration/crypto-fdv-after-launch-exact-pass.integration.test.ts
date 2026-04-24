import { describe, expect, it } from "vitest";

import { getCryptoFdvAfterLaunchProjectConfig } from "../../src/matching/crypto/crypto-fdv-after-launch-assets.js";
import {
  buildCryptoFdvAfterLaunchFamilyArtifacts,
  buildCryptoFdvAfterLaunchMatcherMaterialization,
  type CryptoFdvAfterLaunchExtractedRow
} from "../../src/matching/crypto/crypto-fdv-after-launch-shared.js";

const pairRows = (thresholds: readonly string[]): CryptoFdvAfterLaunchExtractedRow[] =>
  thresholds.flatMap((threshold) => [
    {
      interpretedContractId: `pm-${threshold}`,
      venue: "POLYMARKET" as const,
      venueMarketId: `pm-${threshold}`,
      sourceUrl: "https://polymarket.test",
      title: `FDV above ${threshold} one day after launch?`,
      rulesText: `FDV above ${threshold} one day after launch.`,
      thresholdLabel: threshold
    },
    {
      interpretedContractId: `predict-${threshold}`,
      venue: "PREDICT" as const,
      venueMarketId: `predict-${threshold}`,
      sourceUrl: "https://predict.test",
      title: `FDV above ${threshold} one day after launch?`,
      rulesText: `FDV above ${threshold} one day after launch.`,
      thresholdLabel: threshold
    }
  ]);

describe("crypto FDV after launch exact pass", () => {
  it.each([
    ["EXTENDED", ["$150M", "$300M", "$500M", "$800M", "$1B", "$2B", "$3B"]],
    ["METAMASK", ["$700M", "$1B", "$2B", "$3B", "$4B"]],
    ["OPENSEA", ["$500M", "$1B", "$2B", "$3B", "$5B"]],
    ["REYA", ["$150M", "$200M", "$300M", "$400M", "$1B"]]
  ] as const)("admits only shared POLYMARKET|PREDICT FDV thresholds for %s", (project, thresholds) => {
    const config = getCryptoFdvAfterLaunchProjectConfig(project);
    const family = buildCryptoFdvAfterLaunchFamilyArtifacts(config, [
      ...pairRows(thresholds),
      {
        interpretedContractId: "pm-tail",
        venue: "POLYMARKET",
        venueMarketId: "pm-tail",
        sourceUrl: "https://polymarket.test/tail",
        title: "FDV above $70M one day after launch?",
        rulesText: "FDV above $70M one day after launch.",
        thresholdLabel: "$70M"
      }
    ]);
    const matcher = buildCryptoFdvAfterLaunchMatcherMaterialization({
      config,
      normalizedTopics: family.normalizedTopicRows,
      comparabilitySummary: family.comparabilitySummary
    });

    expect(matcher.finalDecision.bestPair).toBe("POLYMARKET|PREDICT");
    expect(matcher.pairLanes).toHaveLength(thresholds.length);
    expect(matcher.pairLanes.map((lane) => lane.exactFdvThresholdLabel)).toEqual(thresholds);
    expect(matcher.rejections.some((entry) => entry.exactFdvThresholdLabel === "$70M")).toBe(true);
  });
});
