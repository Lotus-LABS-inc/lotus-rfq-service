import type { Pool, QueryResultRow } from "pg";
import type { MarketChartTimeframe, MarketHistoricalChartSource } from "../services/market-data-view.service.js";

export interface VenueOrderbookSnapshotInput {
  canonicalEventId: string;
  canonicalMarketId: string;
  canonicalOutcomeId: string | null;
  venue: string;
  venueMarketId: string;
  venueOutcomeId: string | null;
  source: "STREAM" | "REST";
  quoteQuality: string;
  sourceTimestamp: Date | null;
  receivedAt: Date;
  bestBid: string | null;
  bestAsk: string | null;
  midpoint: string | null;
  spread: string | null;
  bidDepth: string;
  askDepth: string;
  bids: readonly { price: string; size: string }[];
  asks: readonly { price: string; size: string }[];
  blockers: readonly string[];
  metadataVersion?: string | undefined;
}

export interface VenueOrderbookSnapshotCleanupResult {
  deletedOldSnapshots: number;
  deletedClosedMarketSnapshots: number;
}

export interface MarketQuoteReadinessSnapshot {
  canonicalMarketId: string;
  quoteStatus: "live" | "partial" | "stale" | "unavailable";
  quoteReadyVenueCount: number;
  quoteReadyVenues: string[];
  quoteBlockers: Array<{
    venue: string;
    reason: string;
    venueMarketId?: string | undefined;
    venueOutcomeId?: string | undefined;
  }>;
  lastQuoteAt: string | null;
}

export class VenueOrderbookSnapshotRepository implements MarketHistoricalChartSource {
  public constructor(private readonly pool: Pool) {}

  public async insertMany(snapshots: readonly VenueOrderbookSnapshotInput[]): Promise<number> {
    if (snapshots.length === 0) {
      return 0;
    }

    let inserted = 0;
    for (const snapshot of snapshots) {
      const result = await this.pool.query(
        `INSERT INTO venue_orderbook_snapshots (
           canonical_event_id,
           canonical_market_id,
           canonical_outcome_id,
           venue,
           venue_market_id,
           venue_outcome_id,
           source,
           quote_quality,
           source_timestamp,
           received_at,
           best_bid,
           best_ask,
           midpoint,
           spread,
           bid_depth,
           ask_depth,
           bids,
           asks,
           blockers,
           metadata_version
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20
         )`,
        [
          snapshot.canonicalEventId,
          snapshot.canonicalMarketId,
          snapshot.canonicalOutcomeId,
          snapshot.venue.toUpperCase(),
          snapshot.venueMarketId,
          snapshot.venueOutcomeId,
          snapshot.source,
          snapshot.quoteQuality,
          snapshot.sourceTimestamp,
          snapshot.receivedAt,
          snapshot.bestBid,
          snapshot.bestAsk,
          snapshot.midpoint,
          snapshot.spread,
          snapshot.bidDepth,
          snapshot.askDepth,
          JSON.stringify(snapshot.bids),
          JSON.stringify(snapshot.asks),
          JSON.stringify([...new Set(snapshot.blockers)]),
          snapshot.metadataVersion ?? "venue-orderbook-recorder-v1"
        ]
      );
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  }

  public async listChartPoints(input: {
    marketId: string;
    outcomeId?: string | null | undefined;
    canonicalEventId?: string | null | undefined;
    venueMarketIds?: readonly string[] | undefined;
    venueMappings?: readonly { venue: string; venueMarketId: string }[] | undefined;
    since?: Date | null | undefined;
    limit?: number | undefined;
    timeframe?: MarketChartTimeframe | undefined;
  }): Promise<Array<{ timestamp: Date; venue: string; value: string }>> {
    const venueMarketIds = [
      ...new Set([
        ...(input.venueMarketIds ?? []),
        ...(input.venueMappings ?? []).map((mapping) => mapping.venueMarketId)
      ])
    ].filter((value) => value.length > 0);
    const result = await this.pool.query<QueryResultRow & {
      timestamp: Date;
      venue: string;
      value: string | null;
    }>(
      `SELECT received_at AS "timestamp",
              venue,
              COALESCE(midpoint, best_bid, best_ask)::text AS value
         FROM venue_orderbook_snapshots
        WHERE (
              canonical_market_id = $1
              OR canonical_event_id = $2
              OR ($3::text[] IS NOT NULL AND venue_market_id = ANY($3::text[]))
        )
          AND ($4::text IS NULL OR canonical_outcome_id = $4)
          AND ($5::timestamptz IS NULL OR received_at >= $5)
          AND COALESCE(midpoint, best_bid, best_ask) IS NOT NULL
        ORDER BY received_at DESC
        LIMIT $6`,
      [
        input.marketId,
        input.canonicalEventId ?? input.marketId,
        venueMarketIds.length > 0 ? venueMarketIds : null,
        input.outcomeId ?? null,
        input.since ?? null,
        input.limit ?? 600
      ]
    );

    return result.rows
      .flatMap((row) => typeof row.value === "string"
        ? [{ timestamp: row.timestamp, venue: row.venue, value: row.value }]
        : [])
      .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  }

  public async listLatestMarketQuoteReadiness(input: {
    canonicalMarketIds: readonly string[];
    maxAgeMs?: number | undefined;
  }): Promise<MarketQuoteReadinessSnapshot[]> {
    const canonicalMarketIds = [...new Set(input.canonicalMarketIds.map((id) => id.trim()).filter(Boolean))];
    if (canonicalMarketIds.length === 0) {
      return [];
    }
    const maxAgeMs = input.maxAgeMs ?? 5 * 60 * 1000;
    const result = await this.pool.query<QueryResultRow & {
      canonical_market_id: string;
      quote_status: string;
      quote_ready_venue_count: string;
      quote_ready_venues: string[] | null;
      quote_blockers: unknown;
      last_quote_at: Date | null;
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (canonical_market_id, canonical_outcome_id, venue, venue_market_id, venue_outcome_id)
                canonical_market_id,
                canonical_outcome_id,
                venue,
                venue_market_id,
                venue_outcome_id,
                received_at,
                best_bid,
                best_ask,
                midpoint,
                blockers
           FROM venue_orderbook_snapshots
          WHERE canonical_market_id = ANY($1::text[])
          ORDER BY canonical_market_id,
                   canonical_outcome_id,
                   venue,
                   venue_market_id,
                   venue_outcome_id,
                   received_at DESC
       ),
       rolled AS (
         SELECT canonical_market_id,
                MAX(received_at) AS last_quote_at,
                COUNT(DISTINCT venue) FILTER (
                  WHERE received_at >= now() - ($2::int * interval '1 millisecond')
                    AND COALESCE(jsonb_array_length(blockers), 0) = 0
                    AND COALESCE(midpoint, best_bid, best_ask) IS NOT NULL
                ) AS ready_venue_count,
                array_agg(DISTINCT venue) FILTER (
                  WHERE received_at >= now() - ($2::int * interval '1 millisecond')
                    AND COALESCE(jsonb_array_length(blockers), 0) = 0
                    AND COALESCE(midpoint, best_bid, best_ask) IS NOT NULL
                ) AS ready_venues,
                COUNT(DISTINCT venue) FILTER (
                  WHERE COALESCE(jsonb_array_length(blockers), 0) > 0
                ) AS blocked_venue_count,
                jsonb_agg(
                  DISTINCT jsonb_build_object(
                    'venue', venue,
                    'reason', COALESCE(
                      NULLIF(array_to_string(ARRAY(SELECT jsonb_array_elements_text(blockers)), ','), ''),
                      'QUOTE_SNAPSHOT_UNAVAILABLE'
                    ),
                    'venueMarketId', venue_market_id,
                    'venueOutcomeId', venue_outcome_id
                  )
                ) FILTER (WHERE COALESCE(jsonb_array_length(blockers), 0) > 0) AS quote_blockers
           FROM latest
          GROUP BY canonical_market_id
       )
       SELECT canonical_market_id,
              CASE
                WHEN ready_venue_count > 0 AND last_quote_at >= now() - ($2::int * interval '1 millisecond') AND blocked_venue_count = 0 THEN 'live'
                WHEN ready_venue_count > 0 AND last_quote_at >= now() - ($2::int * interval '1 millisecond') THEN 'partial'
                WHEN ready_venue_count > 0 THEN 'stale'
                ELSE 'unavailable'
              END AS quote_status,
              ready_venue_count::text AS quote_ready_venue_count,
              COALESCE(ready_venues, '{}'::text[]) AS quote_ready_venues,
              COALESCE(quote_blockers, '[]'::jsonb) AS quote_blockers,
              last_quote_at
         FROM rolled`,
      [canonicalMarketIds, Math.max(1, Math.floor(maxAgeMs))]
    );
    return result.rows.map((row) => ({
      canonicalMarketId: row.canonical_market_id,
      quoteStatus: parseQuoteStatus(row.quote_status),
      quoteReadyVenueCount: Number(row.quote_ready_venue_count),
      quoteReadyVenues: parseQuoteReadyVenues(row.quote_ready_venues),
      quoteBlockers: parseQuoteBlockers(row.quote_blockers),
      lastQuoteAt: row.last_quote_at?.toISOString() ?? null
    }));
  }

  public async cleanupSnapshots(input: {
    olderThan: Date;
  }): Promise<VenueOrderbookSnapshotCleanupResult> {
    const oldResult = await this.pool.query(
      `DELETE FROM venue_orderbook_snapshots
        WHERE created_at < $1`,
      [input.olderThan]
    );
    const closedResult = await this.pool.query(
      `DELETE FROM venue_orderbook_snapshots vos
        WHERE EXISTS (
          SELECT 1
            FROM canonical_events ce
            LEFT JOIN canonical_executable_markets cem
              ON cem.canonical_event_id = ce.id
            LEFT JOIN frontend_market_approvals fma
              ON fma.canonical_event_id = ce.id
             AND fma.metadata->>'source' = 'frontend-curated-catalog'
           WHERE (
                 vos.canonical_event_id = ce.id::text
                 OR vos.canonical_market_id = ce.proposition_key
                 OR vos.canonical_market_id = cem.id
           )
             AND (
                 ce.resolves_at <= now()
                 OR ce.expires_at <= now()
                 OR COALESCE(fma.status, 'APPROVED') <> 'APPROVED'
             )
        )`
    );

    return {
      deletedOldSnapshots: oldResult.rowCount ?? 0,
      deletedClosedMarketSnapshots: closedResult.rowCount ?? 0
    };
  }
}

const parseQuoteStatus = (value: string): MarketQuoteReadinessSnapshot["quoteStatus"] =>
  value === "live" || value === "partial" || value === "stale" || value === "unavailable"
    ? value
    : "unavailable";

const parseQuoteReadyVenues = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().toUpperCase()))]
    : [];

const parseQuoteBlockers = (value: unknown): MarketQuoteReadinessSnapshot["quoteBlockers"] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    const venue = typeof record.venue === "string" ? record.venue.trim().toUpperCase() : "";
    const reason = normalizeQuoteBlockerReason(record.reason);
    if (!venue || !reason) {
      return [];
    }
    return [{
      venue,
      reason,
      ...(typeof record.venueMarketId === "string" && record.venueMarketId ? { venueMarketId: record.venueMarketId } : {}),
      ...(typeof record.venueOutcomeId === "string" && record.venueOutcomeId ? { venueOutcomeId: record.venueOutcomeId } : {})
    }];
  });
};

const normalizeQuoteBlockerReason = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const raw = value.trim();
  return raw.includes("POLYMARKET_OFFICIAL_MARKET_CLOSED") || raw.includes("POLYMARKET_OFFICIAL_MARKET_NOT_ACCEPTING_ORDERS")
    ? "closed_or_not_accepting_orders"
    : raw;
};
