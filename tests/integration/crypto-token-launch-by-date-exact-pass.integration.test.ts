import { describe, expect, it } from "vitest";

import { getCryptoTokenLaunchByDateProjectConfig } from "../../src/matching/crypto/crypto-token-launch-by-date-assets.js";
import {
  buildCryptoTokenLaunchByDateFamilyArtifacts,
  buildCryptoTokenLaunchByDateMatcherMaterialization,
  type CryptoTokenLaunchByDateExtractedRow
} from "../../src/matching/crypto/crypto-token-launch-by-date-shared.js";

const pairRows = (dates: readonly string[]): CryptoTokenLaunchByDateExtractedRow[] =>
  dates.flatMap((dateKey) => [
    {
      interpretedContractId: `pm-${dateKey}`,
      venue: "POLYMARKET" as const,
      venueMarketId: `pm-${dateKey}`,
      sourceUrl: "https://polymarket.test",
      title: `Will token launch by ${dateKey}?`,
      rulesText: `Token launch by ${dateKey}.`,
      dateKey
    },
    {
      interpretedContractId: `predict-${dateKey}`,
      venue: "PREDICT" as const,
      venueMarketId: `predict-${dateKey}`,
      sourceUrl: "https://predict.test",
      title: `Will token launch by ${dateKey}?`,
      rulesText: `Token launch by ${dateKey}.`,
      dateKey
    }
  ]);

describe("crypto token launch by date exact pass", () => {
  it("admits MetaMask shared launch dates", () => {
    const config = getCryptoTokenLaunchByDateProjectConfig("METAMASK");
    const family = buildCryptoTokenLaunchByDateFamilyArtifacts(config, pairRows([
      "2025-12-31",
      "2026-06-30",
      "2026-09-30"
    ]));
    const matcher = buildCryptoTokenLaunchByDateMatcherMaterialization({
      config,
      normalizedTopics: family.normalizedTopicRows,
      comparabilitySummary: family.comparabilitySummary
    });

    expect(matcher.pairLanes.map((lane) => lane.exactLaunchDate)).toEqual([
      "2025-12-31",
      "2026-06-30",
      "2026-09-30"
    ]);
  });

  it("excludes Base 2025 from the Predict-backed pair", () => {
    const config = getCryptoTokenLaunchByDateProjectConfig("BASE");
    const family = buildCryptoTokenLaunchByDateFamilyArtifacts(config, [
      ...pairRows(["2026-06-30", "2026-12-31"]),
      {
        interpretedContractId: "pm-2025",
        venue: "POLYMARKET",
        venueMarketId: "pm-2025",
        sourceUrl: "https://polymarket.test/2025",
        title: "Will Base launch a token by 2025?",
        rulesText: "Base launches a token by 2025.",
        dateKey: "2025-12-31"
      }
    ]);
    const matcher = buildCryptoTokenLaunchByDateMatcherMaterialization({
      config,
      normalizedTopics: family.normalizedTopicRows,
      comparabilitySummary: family.comparabilitySummary
    });

    expect(matcher.pairLanes.map((lane) => lane.exactLaunchDate)).toEqual([
      "2026-06-30",
      "2026-12-31"
    ]);
    expect(family.admissionSummary.rowsRejectedByReason.EXCLUDED_NON_SHARED_BASE_TOKEN_LAUNCH_DATE).toBe(1);
  });
});
