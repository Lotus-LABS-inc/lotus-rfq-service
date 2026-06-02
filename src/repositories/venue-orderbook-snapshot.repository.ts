import type { Pool, QueryResultRow } from "pg";
import type { NormalizedQuoteLevel, NormalizedVenueQuoteSnapshot } from "../core/sor/quote-snapshot.js";
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
  deletedClosedLatestSnapshots: number;
  deletedStaleBlockedLatestSnapshots: number;
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

export const DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS = 15_000;

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
      await this.upsertLatest(snapshot);
    }
    return inserted;
  }

  private async upsertLatest(snapshot: VenueOrderbookSnapshotInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO venue_orderbook_latest_snapshots (
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
         metadata_version,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20, now()
       )
       ON CONFLICT (canonical_market_id, canonical_outcome_id, venue, venue_market_id, venue_outcome_id)
       DO UPDATE SET
         canonical_event_id = EXCLUDED.canonical_event_id,
         source = EXCLUDED.source,
         quote_quality = EXCLUDED.quote_quality,
         source_timestamp = EXCLUDED.source_timestamp,
         received_at = EXCLUDED.received_at,
         best_bid = EXCLUDED.best_bid,
         best_ask = EXCLUDED.best_ask,
         midpoint = EXCLUDED.midpoint,
         spread = EXCLUDED.spread,
         bid_depth = EXCLUDED.bid_depth,
         ask_depth = EXCLUDED.ask_depth,
         bids = EXCLUDED.bids,
         asks = EXCLUDED.asks,
         blockers = EXCLUDED.blockers,
         metadata_version = EXCLUDED.metadata_version,
         updated_at = now()
       WHERE EXCLUDED.received_at >= venue_orderbook_latest_snapshots.received_at`,
      [
        snapshot.canonicalEventId,
        snapshot.canonicalMarketId,
        nullableKey(snapshot.canonicalOutcomeId),
        snapshot.venue.toUpperCase(),
        snapshot.venueMarketId,
        nullableKey(snapshot.venueOutcomeId),
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
      `WITH detail_points AS (
         SELECT received_at AS "timestamp",
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
          LIMIT $6
       ),
       hourly_points AS (
         SELECT bucket_start AS "timestamp",
                venue,
                COALESCE(last_midpoint, avg_midpoint, last_best_bid, avg_best_bid, last_best_ask, avg_best_ask)::text AS value
           FROM venue_orderbook_snapshot_hourly_compactions
          WHERE (
                canonical_market_id = $1
                OR canonical_event_id = $2
                OR ($3::text[] IS NOT NULL AND venue_market_id = ANY($3::text[]))
          )
            AND ($4::text IS NULL OR canonical_outcome_id = $4)
            AND ($5::timestamptz IS NULL OR bucket_start >= date_trunc('hour', $5::timestamptz))
            AND COALESCE(last_midpoint, avg_midpoint, last_best_bid, avg_best_bid, last_best_ask, avg_best_ask) IS NOT NULL
          ORDER BY bucket_start DESC
          LIMIT $6
       )
       SELECT "timestamp", venue, value
         FROM (
           SELECT * FROM detail_points
           UNION ALL
           SELECT * FROM hourly_points
         ) points
        ORDER BY "timestamp" DESC
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

  public async getLatestSnapshot(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
    maxAgeMs: number;
  }): Promise<NormalizedVenueQuoteSnapshot | null> {
    const result = await this.pool.query<QueryResultRow & {
      canonical_market_id: string;
      venue: string;
      venue_market_id: string;
      venue_outcome_id: string | null;
      source: "STREAM" | "REST";
      quote_quality: string;
      source_timestamp: Date | null;
      received_at: Date;
      bids: unknown;
      asks: unknown;
      blockers: unknown;
    }>(
      `SELECT canonical_market_id,
              venue,
              venue_market_id,
              venue_outcome_id,
              source,
              quote_quality,
              source_timestamp,
              received_at,
              bids,
              asks,
              blockers
         FROM venue_orderbook_latest_snapshots
        WHERE venue = $1
          AND venue_market_id = $2
          AND ($3::text IS NULL OR venue_outcome_id = $3)
          AND received_at >= now() - ($4::int * interval '1 millisecond')
        ORDER BY received_at DESC
        LIMIT 1`,
      [
        input.venue.toUpperCase(),
        input.venueMarketId,
        input.venueOutcomeId === undefined ? null : nullableKey(input.venueOutcomeId),
        Math.max(1, Math.floor(input.maxAgeMs))
      ]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      venue: row.venue.toUpperCase(),
      venueMarketId: row.venue_market_id,
      ...(row.venue_outcome_id ? { venueOutcomeId: row.venue_outcome_id } : {}),
      source: row.source,
      quoteQuality: parseQuoteQuality(row.quote_quality),
      sourceTimestamp: row.source_timestamp,
      receivedAt: row.received_at,
      bids: parseLevels(row.bids),
      asks: parseLevels(row.asks),
      missingFactors: [],
      blockers: parseStringArray(row.blockers),
      streamResynced: true,
      metadata: {
        venueMarketId: row.venue_market_id,
        venueOutcomeId: row.venue_outcome_id || undefined,
        hotSnapshotSource: "db_last_good"
      }
    };
  }

  public async listLatestMarketQuoteReadiness(input: {
    canonicalMarketIds: readonly string[];
    maxAgeMs?: number | undefined;
  }): Promise<MarketQuoteReadinessSnapshot[]> {
    const canonicalMarketIds = [...new Set(input.canonicalMarketIds.map((id) => id.trim()).filter(Boolean))];
    if (canonicalMarketIds.length === 0) {
      return [];
    }
    const maxAgeMs = input.maxAgeMs ?? DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS;
    const lookbackMs = Math.max(maxAgeMs, 30 * 60 * 1000);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '4500ms'");
      const result = await client.query<QueryResultRow & {
      canonical_market_id: string;
      quote_status: string;
      quote_ready_venue_count: string;
      quote_ready_venues: string[] | null;
      quote_blockers: unknown;
      last_quote_at: Date | null;
    }>(
      `WITH latest AS (
         SELECT canonical_market_id,
                canonical_outcome_id,
                venue,
                venue_market_id,
                venue_outcome_id,
                received_at,
                best_bid,
                best_ask,
                midpoint,
                blockers
           FROM venue_orderbook_latest_snapshots
          WHERE canonical_market_id = ANY($1::text[])
            AND received_at >= now() - ($3::int * interval '1 millisecond')
       ),
       annotated AS (
         SELECT canonical_market_id,
                canonical_outcome_id,
                CASE WHEN venue IN ('PREDICT', 'PREDICT_FUN') THEN 'PREDICT_FUN' ELSE venue END AS normalized_venue,
                venue_market_id,
                venue_outcome_id,
                received_at,
                best_bid,
                best_ask,
                midpoint,
                blockers,
                COALESCE(jsonb_array_length(blockers), 0) = 0
                  AND COALESCE(midpoint, best_bid, best_ask) IS NOT NULL AS display_ready,
                received_at >= now() - ($2::int * interval '1 millisecond') AS fresh,
                COALESCE(jsonb_array_length(blockers), 0) > 0 AS quote_blocked
           FROM latest
       ),
       ready_venues AS (
         SELECT DISTINCT canonical_market_id,
                normalized_venue
           FROM annotated
          WHERE display_ready
            AND fresh
       ),
       rolled AS (
         SELECT annotated.canonical_market_id,
                MAX(annotated.received_at) AS last_quote_at,
                COUNT(DISTINCT annotated.normalized_venue) FILTER (
                  WHERE annotated.display_ready
                ) AS display_ready_venue_count,
                COUNT(DISTINCT annotated.normalized_venue) FILTER (
                  WHERE annotated.display_ready AND annotated.fresh
                ) AS fresh_ready_venue_count,
                array_agg(DISTINCT annotated.normalized_venue) FILTER (
                  WHERE annotated.display_ready AND annotated.fresh
                ) AS ready_venues,
                COUNT(DISTINCT annotated.normalized_venue) FILTER (
                  WHERE annotated.quote_blocked
                    AND ready_venues.normalized_venue IS NULL
                ) AS blocked_venue_count,
                jsonb_agg(
                  DISTINCT jsonb_build_object(
                    'venue', annotated.normalized_venue,
                    'reason', COALESCE(
                      NULLIF(array_to_string(ARRAY(SELECT jsonb_array_elements_text(annotated.blockers)), ','), ''),
                      'QUOTE_SNAPSHOT_UNAVAILABLE'
                    ),
                    'venueMarketId', annotated.venue_market_id,
                    'venueOutcomeId', annotated.venue_outcome_id
                  )
                ) FILTER (
                  WHERE annotated.quote_blocked
                    AND ready_venues.normalized_venue IS NULL
                ) AS quote_blockers
           FROM annotated
           LEFT JOIN ready_venues
             ON ready_venues.canonical_market_id = annotated.canonical_market_id
            AND ready_venues.normalized_venue = annotated.normalized_venue
          GROUP BY annotated.canonical_market_id
       )
       SELECT canonical_market_id,
              CASE
                WHEN display_ready_venue_count > 0 AND fresh_ready_venue_count = display_ready_venue_count AND blocked_venue_count = 0 THEN 'live'
                WHEN fresh_ready_venue_count > 0 THEN 'partial'
                WHEN display_ready_venue_count > 0 THEN 'stale'
                ELSE 'unavailable'
              END AS quote_status,
              fresh_ready_venue_count::text AS quote_ready_venue_count,
              COALESCE(ready_venues, '{}'::text[]) AS quote_ready_venues,
              COALESCE(quote_blockers, '[]'::jsonb) AS quote_blockers,
              last_quote_at
         FROM rolled`,
        [canonicalMarketIds, Math.max(1, Math.floor(maxAgeMs)), Math.max(1, Math.floor(lookbackMs))]
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({
        canonicalMarketId: row.canonical_market_id,
        quoteStatus: parseQuoteStatus(row.quote_status),
        quoteReadyVenueCount: Number(row.quote_ready_venue_count),
        quoteReadyVenues: parseQuoteReadyVenues(row.quote_ready_venues),
        quoteBlockers: parseQuoteBlockers(row.quote_blockers),
        lastQuoteAt: row.last_quote_at?.toISOString() ?? null
      }));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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
    const closedLatestResult = await this.pool.query(
      `DELETE FROM venue_orderbook_latest_snapshots vos
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
    const staleBlockedLatestResult = await this.pool.query(
      `DELETE FROM venue_orderbook_latest_snapshots
        WHERE COALESCE(jsonb_array_length(blockers), 0) > 0
          AND (
              received_at < now() - interval '30 minutes'
              OR EXISTS (
                SELECT 1
                  FROM jsonb_array_elements_text(blockers) blocker(value)
                 WHERE blocker.value = 'QUOTE_PROVIDER_TIMEOUT'
                    OR blocker.value LIKE '%quote_reader_timeout_after_%'
                    OR blocker.value LIKE '%recorder sample timed out%'
              )
          )`
    );

    return {
      deletedOldSnapshots: oldResult.rowCount ?? 0,
      deletedClosedMarketSnapshots: closedResult.rowCount ?? 0,
      deletedClosedLatestSnapshots: closedLatestResult.rowCount ?? 0,
      deletedStaleBlockedLatestSnapshots: staleBlockedLatestResult.rowCount ?? 0
    };
  }
}

const parseQuoteStatus = (value: string): MarketQuoteReadinessSnapshot["quoteStatus"] =>
  value === "live" || value === "partial" || value === "stale" || value === "unavailable"
    ? value
    : "unavailable";

const parseQuoteQuality = (value: string): NormalizedVenueQuoteSnapshot["quoteQuality"] =>
  value === "FULL_DEPTH_STREAM" ||
  value === "FULL_DEPTH_REST" ||
  value === "TOP_OF_BOOK_REST" ||
  value === "INDICATIVE_DEPTH" ||
  value === "DIAGNOSTIC_ONLY"
    ? value
    : "DIAGNOSTIC_ONLY";

const parseLevels = (value: unknown): readonly NormalizedQuoteLevel[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
      const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
      const price = typeof record.price === "string" ? record.price : null;
      const size = typeof record.size === "string" ? record.size : null;
      return price && size ? [{ price, size }] : [];
    })
    : [];

const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];

const nullableKey = (value: string | null | undefined): string =>
  value ?? "";

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
  return value.trim();
};
