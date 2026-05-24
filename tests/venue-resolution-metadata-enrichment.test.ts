import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  buildMetadataFromPayloads,
  extractPrefixedVenueMarketSegments,
  needsVenueResolutionHydration,
  resolveVenueResolutionMetadata,
  runVenueResolutionMetadataEnrichment,
  type VenueResolutionMetadataRow
} from "../src/operations/semantic-expansion/venue-resolution-metadata-enrichment.js";

const row = (overrides: Partial<VenueResolutionMetadataRow> = {}): VenueResolutionMetadataRow => ({
  profile_id: "profile-limitless-xrp",
  canonical_event_id: "event-xrp",
  canonical_market_id: "market-xrp",
  venue: "LIMITLESS",
  venue_market_id: "LIMITLESS:september-30-2026-1775137169961:CRYPTO|ATH_BY_DATE|XRP|2026-09-30|2026_09_30",
  title: "Ath By Date Xrp 2026-09-30: 2026-09-30",
  description: "Ath By Date Xrp 2026-09-30: 2026-09-30",
  resolution_source: "LIMITLESS",
  resolution_title: "Ath By Date Xrp 2026-09-30: 2026-09-30",
  resolution_rules_text: "Ath By Date Xrp 2026-09-30: 2026-09-30",
  normalized_payload: {},
  raw_source_payload: {},
  ...overrides
});

const limitlessDetail = {
  title: "XRP all-time high by Sep 30, 2026",
  slug: "september-30-2026-1775137169961",
  description: `<p>This market will resolve to "Yes" if any Binance 1 minute candle for XRP/USDT
    has a high price above the current all-time high before Sep 30, 2026. The market resolves
    to "No" otherwise.</p><p>Resolution source:
    <a href="https://www.binance.com/en/trade/XRP_USDT?type=spot">Binance XRP/USDT High prices</a>.</p>`
};

describe("venue resolution metadata enrichment", () => {
  it("extracts prefixed Limitless slugs from venue market ids", () => {
    expect(extractPrefixedVenueMarketSegments("LIMITLESS", row().venue_market_id)).toEqual([
      "september-30-2026-1775137169961",
      "CRYPTO|ATH_BY_DATE|XRP|2026-09-30|2026_09_30"
    ]);
  });

  it("marks title-derived placeholder rules as needing hydration", () => {
    expect(needsVenueResolutionHydration(row())).toBe(true);
  });

  it("does not require hydration when trusted venue rules and source are present", () => {
    expect(needsVenueResolutionHydration(row({
      description: null,
      resolution_rules_text: "This market will resolve to Yes if Binance XRP/USDT reaches a new all-time high before the listed deadline.",
      resolution_source: "Official resolution source: https://www.binance.com/en/trade/XRP_USDT?type=spot"
    }))).toBe(false);
  });

  it("uses live Limitless description HTML as trusted rule and source metadata", () => {
    const metadata = buildMetadataFromPayloads(row(), [limitlessDetail], "limitless_market_detail:september-30-2026-1775137169961");

    expect(metadata).not.toBeNull();
    expect(metadata?.rulesText).toContain("This market will resolve to \"Yes\"");
    expect(metadata?.rulesText).toContain("Binance");
    expect(metadata?.sourceText).toContain("Resolution source");
    expect(metadata?.sourceUrl).toBe("https://www.binance.com/en/trade/XRP_USDT?type=spot");
    expect(metadata?.rawSourcePatch).toMatchObject({
      venueResolutionMetadata: {
        venue: "LIMITLESS",
        slug: "september-30-2026-1775137169961"
      }
    });
  });

  it("resolves Limitless metadata by fetching the parsed slug", async () => {
    const getMarketDetail = vi.fn(async () => limitlessDetail);
    const result = await resolveVenueResolutionMetadata(row(), {
      limitless: { getMarketDetail }
    });

    expect(result.ok).toBe(true);
    expect(getMarketDetail).toHaveBeenCalledWith("september-30-2026-1775137169961");
    if (result.ok) {
      expect(result.metadata.rulesText).toContain("XRP/USDT");
    }
  });

  it("falls back to Polymarket event markets for event-outcome slug mappings", async () => {
    const getMarketByIdentifier = vi.fn(async () => []);
    const getEventMarketsBySlug = vi.fn(async () => [{
      marketId: "pm-arsenal",
      conditionId: "0x1",
      marketSlug: "will-arsenal-win-the-2025-2026-premier-league",
      title: "Will Arsenal win the 2025-2026 Premier League?",
      raw: {
        title: "Will Arsenal win the 2025-2026 Premier League?",
        rules: "This market will resolve to Yes if Arsenal wins the English Premier League 2025-2026 season according to the official league table. Otherwise it resolves to No.",
        resolutionSource: "Official resolution source: https://www.premierleague.com/tables"
      }
    }]);
    const getEventBySlug = vi.fn(async () => ({}));
    const result = await resolveVenueResolutionMetadata(row({
      venue: "POLYMARKET",
      venue_market_id: "POLYMARKET:english-premier-league-winner:arsenal:SPORTS|LEAGUE_WINNER|EPL|2025_2026|ARSENAL",
      title: "EPL 2025 2026 Winner: Arsenal",
      resolution_source: "POLYMARKET"
    }), {
      polymarket: { getMarketByIdentifier, getEventMarketsBySlug, getEventBySlug }
    });

    expect(result.ok).toBe(true);
    expect(getEventMarketsBySlug).toHaveBeenCalledWith("english-premier-league-winner");
    if (result.ok) {
      expect(result.metadata.fetchedBy).toBe("polymarket_gamma_event:english-premier-league-winner");
      expect(result.metadata.rulesText).toContain("Arsenal wins");
    }
  });

  it("uses Polymarket event metadata when event child markets cannot provide trusted rules", async () => {
    const result = await resolveVenueResolutionMetadata(row({
      venue: "POLYMARKET",
      venue_market_id: "POLYMARKET:2026-fifa-world-cup-winner:italy:SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|ITALY",
      title: "Fifa World Cup 2026 Winner: Italy",
      resolution_source: "POLYMARKET"
    }), {
      polymarket: {
        getMarketByIdentifier: vi.fn(async () => []),
        getEventMarketsBySlug: vi.fn(async () => []),
        getEventBySlug: vi.fn(async () => ({
          title: "2026 FIFA World Cup Winner",
          description: "This market will resolve according to the national team that wins the 2026 FIFA World Cup. If at any point it becomes impossible for this team to win the FIFA World Cup based on FIFA rules, it resolves No.",
          resolutionSource: "Official resolution source: https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026"
        }))
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata.fetchedBy).toBe("polymarket_gamma_event:2026-fifa-world-cup-winner");
      expect(result.metadata.rulesText).toContain("2026 FIFA World Cup");
    }
  });

  it("produces sanitized dry-run artifact rows without raw provider payloads", async () => {
    const fakePool = {
      query: vi.fn(async () => ({ rows: [row()] }))
    } as unknown as Pool;

    const summary = await runVenueResolutionMetadataEnrichment({
      pool: fakePool,
      clients: {
        limitless: { getMarketDetail: vi.fn(async () => limitlessDetail) }
      },
      options: {
        apply: false,
        limit: 10,
        concurrency: 1,
        approvalSource: "frontend-curated-catalog"
      },
      generatedAt: "2026-05-24T00:00:00.000Z"
    });

    expect(summary.mode).toBe("DRY_RUN");
    expect(summary.summary.plannedOrUpdated).toBe(1);
    expect(summary.rows[0]).toMatchObject({
      status: "PLANNED",
      venue: "LIMITLESS",
      fetchedBy: "limitless_market_detail:september-30-2026-1775137169961"
    });
    expect(JSON.stringify(summary.rows)).not.toContain("<p>");
    expect(JSON.stringify(summary.rows)).not.toContain("apiKey");
  });
});
