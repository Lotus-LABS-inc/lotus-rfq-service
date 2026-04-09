import { describe, expect, it } from "vitest";

import { CryptoMatchingPipeline } from "../../src/matching/crypto/crypto-matching-pipeline.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemoryCryptoRepository } from "./crypto-test-harness.js";

const markets = [
  buildMatchingMarket({
    interpretedContractId: "pm-ath",
    venue: "POLYMARKET",
    venueMarketId: "pm-ath",
    category: "CRYPTO",
    title: "Bitcoin all time high by March 31, 2026?"
  }),
  buildMatchingMarket({
    interpretedContractId: "lt-ath",
    venue: "LIMITLESS",
    venueMarketId: "lt-ath",
    category: "CRYPTO",
    title: "Bitcoin all time high by March 31?"
  }),
  buildMatchingMarket({
    interpretedContractId: "op-daily",
    venue: "OPINION",
    venueMarketId: "op-daily",
    category: "CRYPTO",
    title: "Bitcoin Up or Down on March 21?(12:00 ET)"
  })
] as const;

describe("crypto matching determinism", () => {
  it("produces the same BTC edge ids and labels for the same inputs", async () => {
    const first = await new CryptoMatchingPipeline(new InMemoryCryptoRepository(markets)).run();
    const second = await new CryptoMatchingPipeline(new InMemoryCryptoRepository(markets)).run();

    expect(first.matchingVersion.id).toBe(second.matchingVersion.id);
    expect(first.pairEdges.map((edge) => ({ id: edge.id, label: edge.label, provenance: edge.provenance.replay.deterministicInputHash })))
      .toEqual(second.pairEdges.map((edge) => ({ id: edge.id, label: edge.label, provenance: edge.provenance.replay.deterministicInputHash })));
  });
});

