import { describe, expect, it } from "vitest";

import {
  buildCryptoBtcAthByDateFamilyArtifacts,
  type CryptoBtcAthByDateExtractedRow
} from "../../src/matching/crypto/crypto-btc-ath-by-date-family-pass.js";

const buildRow = (
  overrides: Partial<CryptoBtcAthByDateExtractedRow>
): CryptoBtcAthByDateExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "POLYMARKET",
  venueMarketId: overrides.venueMarketId ?? "bitcoin-all-time-high-by-june-30-2026",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "Bitcoin all time high by June 30, 2026?",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if Bitcoin makes a new all-time high at any point on or before June 30, 2026. Otherwise it resolves to No.",
  exactDateLabel: overrides.exactDateLabel ?? "June 30, 2026"
});

describe("crypto btc ath by date family pass", () => {
  it("builds shared matcher candidates from current pair-shared date buckets", () => {
    const artifacts = buildCryptoBtcAthByDateFamilyArtifacts([
      buildRow({ interpretedContractId: "pm-mar", venue: "POLYMARKET", venueMarketId: "bitcoin-all-time-high-by-march-31-2026", title: "Bitcoin all time high by March 31, 2026?", rulesText: "This market resolves to Yes if Bitcoin makes a new all-time high at any point on or before March 31, 2026. Otherwise it resolves to No.", exactDateLabel: "March 31, 2026" }),
      buildRow({ interpretedContractId: "pm-jun", venue: "POLYMARKET", venueMarketId: "bitcoin-all-time-high-by-june-30-2026", title: "Bitcoin all time high by June 30, 2026?", rulesText: "This market resolves to Yes if Bitcoin makes a new all-time high at any point on or before June 30, 2026. Otherwise it resolves to No.", exactDateLabel: "June 30, 2026" }),
      buildRow({ interpretedContractId: "pm-sep", venue: "POLYMARKET", venueMarketId: "bitcoin-all-time-high-by-september-30-2026", title: "Bitcoin all time high by September 30, 2026?", rulesText: "This market resolves to Yes if Bitcoin makes a new all-time high at any point on or before September 30, 2026. Otherwise it resolves to No.", exactDateLabel: "September 30, 2026" }),
      buildRow({ interpretedContractId: "pm-dec", venue: "POLYMARKET", venueMarketId: "bitcoin-all-time-high-by-december-31-2026", title: "Bitcoin all time high by December 31, 2026?", rulesText: "This market resolves to Yes if Bitcoin makes a new all-time high at any point on or before December 31, 2026. Otherwise it resolves to No.", exactDateLabel: "December 31, 2026" }),
      buildRow({ interpretedContractId: "ll-jun", venue: "LIMITLESS", venueMarketId: "june-30-2026-1775135445337", title: "Bitcoin all time high by June 30, 2026?", rulesText: "This market resolves to Yes if Bitcoin makes a new all-time high at any point on or before June 30, 2026. Otherwise it resolves to No.", exactDateLabel: "June 30, 2026" }),
      buildRow({ interpretedContractId: "ll-sep", venue: "LIMITLESS", venueMarketId: "september-30-2026-1775135445352", title: "Bitcoin all time high by September 30, 2026?", rulesText: "This market resolves to Yes if Bitcoin makes a new all-time high at any point on or before September 30, 2026. Otherwise it resolves to No.", exactDateLabel: "September 30, 2026" }),
      buildRow({ interpretedContractId: "ll-dec", venue: "LIMITLESS", venueMarketId: "december-31-2026-1775135445358", title: "Bitcoin all time high by December 31, 2026?", rulesText: "This market resolves to Yes if Bitcoin makes a new all-time high at any point on or before December 31, 2026. Otherwise it resolves to No.", exactDateLabel: "December 31, 2026" })
    ]);

    expect(artifacts.finalDecision.sharedCandidateTopicKeys).toEqual([
      "CRYPTO|ATH_BY_DATE|BTC|2026-06-30",
      "CRYPTO|ATH_BY_DATE|BTC|2026-09-30",
      "CRYPTO|ATH_BY_DATE|BTC|2026-12-31"
    ]);
    expect(artifacts.comparabilitySummary.map((entry) => entry.canonicalTopicKey)).toContain("CRYPTO|ATH_BY_DATE|BTC|2026-03-31");
    expect(artifacts.comparabilitySummary.find((entry) => entry.canonicalTopicKey === "CRYPTO|ATH_BY_DATE|BTC|2026-03-31")?.matcherCandidate).toBe(false);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("CRYPTO_BTC_ATH_BY_DATE_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
