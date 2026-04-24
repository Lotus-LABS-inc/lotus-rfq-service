import { describe, expect, it } from "vitest";

import { buildCryptoBnbThresholdByDateFamilyArtifacts } from "../../src/matching/crypto/crypto-bnb-threshold-by-date-family-pass.js";
import { buildCryptoBtcThresholdByDateFamilyArtifacts } from "../../src/matching/crypto/crypto-btc-threshold-by-date-family-pass.js";
import { buildCryptoEthThresholdByDateFamilyArtifacts } from "../../src/matching/crypto/crypto-eth-threshold-by-date-family-pass.js";
import { buildCryptoSolThresholdByDateFamilyArtifacts } from "../../src/matching/crypto/crypto-sol-threshold-by-date-family-pass.js";
import type { CryptoThresholdByDateExtractedRow } from "../../src/matching/crypto/crypto-threshold-by-date-shared.js";

const buildRow = (
  overrides: Partial<CryptoThresholdByDateExtractedRow>
): CryptoThresholdByDateExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "POLYMARKET",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "Will Bitcoin reach $100,000 in April?",
  rulesText: overrides.rulesText ?? "This market resolves Yes if the asset reaches the threshold at any point during April 2026.",
  comparator: overrides.comparator ?? "ABOVE",
  thresholdLabel: overrides.thresholdLabel ?? "$100,000"
});

const cases = [
  {
    asset: "BTC",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30",
    decisionPrefix: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoBtcThresholdByDateFamilyArtifacts,
    sharedTopicKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30|ABOVE|100000",
    venueOnlyTopicKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30|BELOW|70000",
    sharedTitle: "Will Bitcoin reach $100,000 in April?",
    venueOnlyTitle: "Will Bitcoin dip to $70,000 in April?"
  },
  {
    asset: "ETH",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30",
    decisionPrefix: "CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoEthThresholdByDateFamilyArtifacts,
    sharedTopicKey: "CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30|ABOVE|5000",
    venueOnlyTopicKey: "CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30|BELOW|2000",
    sharedTitle: "Will Ethereum reach $5,000 in April?",
    venueOnlyTitle: "Will Ethereum dip to $2,000 in April?"
  },
  {
    asset: "SOL",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30",
    decisionPrefix: "CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoSolThresholdByDateFamilyArtifacts,
    sharedTopicKey: "CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30|ABOVE|300",
    venueOnlyTopicKey: "CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30|BELOW|100",
    sharedTitle: "Will Solana reach $300 in April?",
    venueOnlyTitle: "Will Solana dip to $100 in April?"
  },
  {
    asset: "BNB",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30",
    decisionPrefix: "CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoBnbThresholdByDateFamilyArtifacts,
    sharedTopicKey: "CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30|ABOVE|1000",
    venueOnlyTopicKey: "CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30|BELOW|500",
    sharedTitle: "Will BNB reach $1,000 in April?",
    venueOnlyTitle: "Will BNB dip to $500 in April?"
  }
] as const;

describe("crypto threshold by date family pass", () => {
  it.each(cases)("builds shared matcher candidates for $asset and excludes venue-only threshold tails", ({ build, sharedTopicKey, venueOnlyTopicKey, sharedTitle, venueOnlyTitle, decisionPrefix }) => {
    const artifacts = build([
      buildRow({
        interpretedContractId: "pm-shared",
        venue: "POLYMARKET",
        venueMarketId: "pm-shared",
        title: sharedTitle,
        thresholdLabel: sharedTitle.match(/\$[0-9,]+/)?.[0] ?? "$100,000",
        comparator: "ABOVE"
      }),
      buildRow({
        interpretedContractId: "predict-shared",
        venue: "PREDICT",
        venueMarketId: "predict-shared",
        title: sharedTitle,
        thresholdLabel: sharedTitle.match(/\$[0-9,]+/)?.[0] ?? "$100,000",
        comparator: "ABOVE"
      }),
      buildRow({
        interpretedContractId: "pm-tail",
        venue: "POLYMARKET",
        venueMarketId: "pm-tail",
        title: venueOnlyTitle,
        thresholdLabel: venueOnlyTitle.match(/\$[0-9,]+/)?.[0] ?? "$70,000",
        comparator: "BELOW"
      })
    ]);

    expect(artifacts.finalDecision.sharedCandidateTopicKeys).toEqual([sharedTopicKey]);
    expect(artifacts.comparabilitySummary.map((entry) => entry.canonicalTopicKey)).toContain(venueOnlyTopicKey);
    expect(artifacts.comparabilitySummary.find((entry) => entry.canonicalTopicKey === venueOnlyTopicKey)?.matcherCandidate).toBe(false);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe(`${decisionPrefix}_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND`);
  });
});
