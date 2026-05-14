import { describe, expect, it } from "vitest";
import { deriveMarketDisplayMetadata, type MarketDisplayMetadataInput } from "../../src/repositories/market-catalog.repository.js";

const row = (canonicalMarketId: string, title: string): MarketDisplayMetadataInput => ({
  canonical_market_ids: [canonicalMarketId],
  title,
  proposition_key: canonicalMarketId.replace(/^FRONTEND_CURATED:/, "").replace(/:[A-Z_]+$/, ""),
  frontend_display_title: title
});

describe("deriveMarketDisplayMetadata", () => {
  it("renders ATH-by-date outcomes as full dates", () => {
    const metadata = deriveMarketDisplayMetadata(row(
      "FRONTEND_CURATED:CRYPTO|ATH_BY_DATE|ETH|2026-06-30|2026_06_30:POLYMARKET",
      "Ath By Date Eth 2026-06-30: 2026-06-30"
    ));

    expect(metadata).toEqual({
      displayTopic: "ETH ATH by ____",
      displayOutcome: "June 30, 2026",
      displayOutcomeKey: "date:2026-06-30"
    });
  });

  it("renders geopolitical by-date outcomes as full dates", () => {
    const metadata = deriveMarketDisplayMetadata(row(
      "FRONTEND_CURATED:GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31|YES:LIMITLESS",
      "USA Greenland Trump Acquire Greenland 2026-12-31: 2026-12-31"
    ));

    expect(metadata.displayTopic).toBe("Trump Acquire Greenland by ____");
    expect(metadata.displayOutcome).toBe("December 31, 2026");
    expect(metadata.displayOutcomeKey).toBe("date:2026-12-31");
  });

  it("renders office exit by-date outcomes as full dates", () => {
    const metadata = deriveMarketDisplayMetadata(row(
      "FRONTEND_CURATED:OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31|YES:PREDICT",
      "Office Exit By Date Israel Prime Minister Benjamin Netanyahu 2026-12-31: 2026-12-31"
    ));

    expect(metadata.displayTopic).toBe("Benjamin Netanyahu out by ____");
    expect(metadata.displayOutcome).toBe("December 31, 2026");
    expect(metadata.displayOutcomeKey).toBe("date:2026-12-31");
  });

  it("renders candidate markets as candidate names", () => {
    const metadata = deriveMarketDisplayMetadata(row(
      "FRONTEND_CURATED:NOMINEE|US_PRESIDENT|2028|DEMOCRATIC|GAVIN_NEWSOM:POLYMARKET",
      "Democratic Presidential Nominee 2028: Gavin Newsom"
    ));

    expect(metadata.displayTopic).toBe("Democratic Presidential Nominee 2028");
    expect(metadata.displayOutcome).toBe("Gavin Newsom");
    expect(metadata.displayOutcomeKey).toBe("candidate:GAVIN_NEWSOM");
  });

  it("renders FDV threshold outcomes as money candidates", () => {
    const metadata = deriveMarketDisplayMetadata(row(
      "FRONTEND_CURATED:CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|EXTENDED|ONE_DAY_AFTER_LAUNCH|ABOVE|150000000|150M:PREDICT",
      "FDV Threshold After Launch Extended One Day After Launch: 150M"
    ));

    expect(metadata.displayTopic).toBe("Extended FDV One Day After Launch");
    expect(metadata.displayOutcome).toBe("$150M");
    expect(metadata.displayOutcomeKey).toBe("threshold:150000000");
  });

  it("renders token launch markets as date candidate events", () => {
    const metadata = deriveMarketDisplayMetadata(row(
      "FRONTEND_CURATED:CRYPTO|TOKEN_LAUNCH_BY_DATE|BASE|2026-06-30|2026_06_30:POLYMARKET",
      "Token Launch By Date Base 2026-06-30: 2026-06-30"
    ));

    expect(metadata.displayTopic).toBe("Base to launch a token by ____");
    expect(metadata.displayOutcome).toBe("June 30, 2026");
    expect(metadata.displayOutcomeKey).toBe("date:2026-06-30");
  });

  it("renders threshold-by-date markets as price candidate events", () => {
    const metadata = deriveMarketDisplayMetadata(row(
      "FRONTEND_CURATED:CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30|ABOVE|85000|85_000:POLYMARKET",
      "Threshold By Date Btc 2026-04-30: ↑ 85,000"
    ));

    expect(metadata.displayTopic).toBe("What price will Bitcoin hit in April 2026?");
    expect(metadata.displayOutcome).toBe("↑ $85,000");
    expect(metadata.displayOutcomeKey).toBe("threshold:ABOVE:85000");
  });

  it("renders first-to-threshold markets as price race candidate events", () => {
    const metadata = deriveMarketDisplayMetadata(row(
      "FRONTEND_CURATED:CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|SOL|60|140|2027-01-01|YES:PREDICT",
      "First To Threshold By Date Sol 60: 2027-01-01"
    ));

    expect(metadata.displayTopic).toBe("SOL first to hit ____");
    expect(metadata.displayOutcome).toBe("$60 or $140 first");
    expect(metadata.displayOutcomeKey).toBe("first-threshold:60:140");
  });

  it("renders tournament winner outcomes as candidate names", () => {
    const metadata = deriveMarketDisplayMetadata(row(
      "FRONTEND_CURATED:SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|FRANCE:PREDICT",
      "Will France win the 2026 FIFA World Cup?"
    ));

    expect(metadata.displayTopic).toBe("FIFA World Cup 2026 Winner");
    expect(metadata.displayOutcome).toBe("France");
    expect(metadata.displayOutcomeKey).toBe("candidate:FRANCE");
  });
});
