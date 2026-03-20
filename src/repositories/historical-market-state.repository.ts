import type { Pool, QueryResultRow } from "pg";

import type { CreateHistoricalMarketStateInput } from "../core/historical-simulation/historical-simulation.types.js";

export interface HistoricalMarketStateWatermarkKey {
  venue: string;
  venueMarketId: string;
  metadataVersion: string;
}

export interface HistoricalMarketStateInsertResult {
  inserted: number;
  skipped: number;
}

interface LatestSourceTimestampRow extends QueryResultRow {
  latest_source_timestamp: Date | null;
}

interface InsertedRow extends QueryResultRow {
  id: string;
}

const asJson = (value: Record<string, unknown> | null | undefined): string | null =>
  value === undefined ? null : value === null ? null : JSON.stringify(value);

export class HistoricalMarketStateRepository {
  public constructor(private readonly pool: Pool) {}

  public async getLatestSourceTimestamp(key: HistoricalMarketStateWatermarkKey): Promise<Date | null> {
    const result = await this.pool.query<LatestSourceTimestampRow>(
      `SELECT MAX(source_timestamp) AS latest_source_timestamp
         FROM historical_market_states
        WHERE venue = $1
          AND venue_market_id = $2
          AND metadata_version = $3`,
      [key.venue, key.venueMarketId, key.metadataVersion]
    );

    return result.rows[0]?.latest_source_timestamp ?? null;
  }

  public async insertManyIgnoreDuplicates(
    states: readonly CreateHistoricalMarketStateInput[]
  ): Promise<HistoricalMarketStateInsertResult> {
    if (states.length === 0) {
      return { inserted: 0, skipped: 0 };
    }

    let inserted = 0;

    for (const state of states) {
      const result = await this.pool.query<InsertedRow>(
        `INSERT INTO historical_market_states (
           canonical_event_id,
           canonical_market_id,
           canonical_category,
           venue,
           venue_market_id,
           market_class,
           "timestamp",
           midpoint,
           best_bid,
           best_ask,
           spread,
           last_price,
           volume,
           open_interest,
           candles,
           orderbook_snapshot,
           market_events,
           trades,
           own_execution_history,
           metadata_version,
           source_timestamp
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20, $21
         )
         ON CONFLICT (canonical_event_id, canonical_market_id, venue, venue_market_id, "timestamp", metadata_version) 
         DO UPDATE SET canonical_market_id = EXCLUDED.canonical_market_id
         RETURNING id`,
        [
          state.canonicalEventId,
          state.canonicalMarketId ?? null,
          state.canonicalCategory ?? null,
          state.venue,
          state.venueMarketId,
          state.marketClass,
          state.timestamp,
          state.midpoint ?? null,
          state.bestBid ?? null,
          state.bestAsk ?? null,
          state.spread ?? null,
          state.lastPrice ?? null,
          state.volume ?? null,
          state.openInterest ?? null,
          asJson(state.candles),
          asJson(state.orderbookSnapshot),
          asJson(state.marketEvents),
          asJson(state.trades),
          asJson(state.ownExecutionHistory),
          state.metadataVersion,
          state.sourceTimestamp
        ]
      );

      inserted += result.rowCount ?? 0;
    }

    return { inserted, skipped: states.length - inserted };
  }
}
