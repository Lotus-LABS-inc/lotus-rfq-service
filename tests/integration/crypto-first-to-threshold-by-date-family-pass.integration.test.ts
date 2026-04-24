import { describe, expect, it } from "vitest";

import { buildCryptoBtcFirstToThresholdByDateFamilyArtifacts } from "../../src/matching/crypto/crypto-btc-first-to-threshold-by-date-family-pass.js";
import { buildCryptoEthFirstToThresholdByDateFamilyArtifacts } from "../../src/matching/crypto/crypto-eth-first-to-threshold-by-date-family-pass.js";
import { buildCryptoSolFirstToThresholdByDateFamilyArtifacts } from "../../src/matching/crypto/crypto-sol-first-to-threshold-by-date-family-pass.js";
import type { CryptoFirstToThresholdByDateExtractedRow } from "../../src/matching/crypto/crypto-first-to-threshold-by-date-shared.js";

const buildRow = (
  overrides: Partial<CryptoFirstToThresholdByDateExtractedRow>
): CryptoFirstToThresholdByDateExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "POLYMARKET",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "Will Bitcoin hit $60k or $80k first?",
  rulesText: overrides.rulesText ?? "Source is Binance spot. If neither threshold is hit before expiry, resolves 50/50.",
  lowerOutcomeLabel: overrides.lowerOutcomeLabel ?? "$60k",
  higherOutcomeLabel: overrides.higherOutcomeLabel ?? "$80k"
});

const cases = [
  {
    asset: "BTC",
    decisionPrefix: "CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE",
    sharedTopicKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01",
    build: buildCryptoBtcFirstToThresholdByDateFamilyArtifacts,
    lowerOutcomeLabel: "$60k",
    higherOutcomeLabel: "$80k"
  },
  {
    asset: "ETH",
    decisionPrefix: "CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE",
    sharedTopicKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|ETH|1000|3000|2027-01-01",
    build: buildCryptoEthFirstToThresholdByDateFamilyArtifacts,
    lowerOutcomeLabel: "$1,000",
    higherOutcomeLabel: "$3,000"
  },
  {
    asset: "SOL",
    decisionPrefix: "CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE",
    sharedTopicKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|SOL|60|140|2027-01-01",
    build: buildCryptoSolFirstToThresholdByDateFamilyArtifacts,
    lowerOutcomeLabel: "$60",
    higherOutcomeLabel: "$140"
  }
] as const;

describe("crypto first-to-threshold-by-date family pass", () => {
  it.each(cases)("builds a shared matcher candidate for $asset on POLYMARKET|PREDICT", ({ build, sharedTopicKey, decisionPrefix, lowerOutcomeLabel, higherOutcomeLabel }) => {
    const artifacts = build([
      buildRow({
        interpretedContractId: "pm-shared",
        venue: "POLYMARKET",
        venueMarketId: "pm-shared",
        lowerOutcomeLabel,
        higherOutcomeLabel
      }),
      buildRow({
        interpretedContractId: "predict-shared",
        venue: "PREDICT",
        venueMarketId: "predict-shared",
        lowerOutcomeLabel,
        higherOutcomeLabel
      })
    ]);

    expect(artifacts.finalDecision.sharedCandidateTopicKeys).toEqual([sharedTopicKey]);
    expect(artifacts.comparabilitySummary[0]?.matcherCandidate).toBe(true);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe(
      `${decisionPrefix}_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND`
    );
  });
});
