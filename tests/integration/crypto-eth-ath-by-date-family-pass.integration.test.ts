import { describe, expect, it } from "vitest";

import {
  buildCryptoEthAthByDateFamilyArtifacts,
  type CryptoEthAthByDateExtractedRow
} from "../../src/matching/crypto/crypto-eth-ath-by-date-family-pass.js";

const buildRow = (overrides: Partial<CryptoEthAthByDateExtractedRow>): CryptoEthAthByDateExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "POLYMARKET",
  venueMarketId: overrides.venueMarketId ?? "ethereum-all-time-high-by-june-30-2026",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "Ethereum all time high by June 30, 2026?",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if Ethereum makes a new all-time high at any point on or before June 30, 2026. Otherwise it resolves to No.",
  exactDateLabel: overrides.exactDateLabel ?? "June 30, 2026"
});

describe("crypto eth ath by date family pass", () => {
  it("builds shared matcher candidates from exact pair-shared date buckets", () => {
    const artifacts = buildCryptoEthAthByDateFamilyArtifacts([
      buildRow({ interpretedContractId: "pm-mar", venueMarketId: "ethereum-all-time-high-by-march-31-2026", title: "Ethereum all time high by March 31, 2026?", exactDateLabel: "March 31, 2026", rulesText: "This market resolves to Yes if Ethereum makes a new all-time high at any point on or before March 31, 2026. Otherwise it resolves to No." }),
      buildRow({ interpretedContractId: "pm-jun" }),
      buildRow({ interpretedContractId: "pm-sep", venueMarketId: "ethereum-all-time-high-by-september-30-2026", title: "Ethereum all time high by September 30, 2026?", exactDateLabel: "September 30, 2026", rulesText: "This market resolves to Yes if Ethereum makes a new all-time high at any point on or before September 30, 2026. Otherwise it resolves to No." }),
      buildRow({ interpretedContractId: "pm-dec", venueMarketId: "ethereum-all-time-high-by-december-31-2026", title: "Ethereum all time high by December 31, 2026?", exactDateLabel: "December 31, 2026", rulesText: "This market resolves to Yes if Ethereum makes a new all-time high at any point on or before December 31, 2026. Otherwise it resolves to No." }),
      buildRow({ interpretedContractId: "ll-jun", venue: "LIMITLESS", venueMarketId: "june-30-2026-eth" }),
      buildRow({ interpretedContractId: "ll-sep", venue: "LIMITLESS", venueMarketId: "september-30-2026-eth", title: "Ethereum all time high by September 30, 2026?", exactDateLabel: "September 30, 2026", rulesText: "This market resolves to Yes if Ethereum makes a new all-time high at any point on or before September 30, 2026. Otherwise it resolves to No." }),
      buildRow({ interpretedContractId: "ll-dec", venue: "LIMITLESS", venueMarketId: "december-31-2026-eth", title: "Ethereum all time high by December 31, 2026?", exactDateLabel: "December 31, 2026", rulesText: "This market resolves to Yes if Ethereum makes a new all-time high at any point on or before December 31, 2026. Otherwise it resolves to No." })
    ]);

    expect(artifacts.finalDecision.sharedCandidateTopicKeys).toEqual([
      "CRYPTO|ATH_BY_DATE|ETH|2026-06-30",
      "CRYPTO|ATH_BY_DATE|ETH|2026-09-30",
      "CRYPTO|ATH_BY_DATE|ETH|2026-12-31"
    ]);
  });
});
