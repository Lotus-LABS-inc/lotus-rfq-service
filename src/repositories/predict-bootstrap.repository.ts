import type { Pool } from "pg";

import type {
  PredictEnvironment,
  PredictNormalizedMarket,
  PredictNormalizedOrderbookSnapshot
} from "../integrations/predict/predict-types.js";

interface PersistedOrderbookSnapshotInput {
  environment: PredictEnvironment;
  marketId: string;
  sourceTimestamp: Date | null;
  bestBid: string | null;
  bestAsk: string | null;
  spread: string | null;
  midpoint: string | null;
  topOfBookSize: string | null;
  snapshotPayload: Record<string, unknown>;
}

const asJson = (value: Record<string, unknown> | readonly unknown[] | null | undefined): string =>
  JSON.stringify(value ?? {});

export class PredictBootstrapRepository {
  public constructor(private readonly pool: Pool) {}

  public async upsertMarketMetadata(markets: readonly PredictNormalizedMarket[]): Promise<number> {
    let upserted = 0;
    for (const market of markets) {
      const result = await this.pool.query(
        `INSERT INTO predict_market_metadata (
           environment,
           market_id,
           title,
           status,
           categories,
           tags,
           market_payload,
           source_metadata_version
         ) VALUES (
           $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8
         )
         ON CONFLICT (environment, market_id, source_metadata_version)
         DO UPDATE SET
           title = EXCLUDED.title,
           status = EXCLUDED.status,
           categories = EXCLUDED.categories,
           tags = EXCLUDED.tags,
           market_payload = EXCLUDED.market_payload,
           updated_at = NOW()`,
        [
          market.environment,
          market.venueMarketId,
          market.title,
          market.status,
          JSON.stringify(market.categories),
          JSON.stringify(market.tags),
          asJson({
            market: market.raw,
            statistics: market.statistics?.raw ?? null,
            lastSale: market.lastSale?.raw ?? null
          }),
          market.sourceMetadataVersion
        ]
      );
      upserted += result.rowCount ?? 0;
    }

    return upserted;
  }

  public async insertOrderbookSnapshots(
    snapshots: readonly PersistedOrderbookSnapshotInput[]
  ): Promise<number> {
    let inserted = 0;
    for (const snapshot of snapshots) {
      const existing = await this.pool.query<{ id: string }>(
        `SELECT id
           FROM predict_orderbook_snapshots
          WHERE environment = $1
            AND market_id = $2
            AND (
              ($3::timestamptz IS NULL AND source_timestamp IS NULL)
              OR source_timestamp = $3::timestamptz
            )
          ORDER BY recorded_at DESC
          LIMIT 1`,
        [snapshot.environment, snapshot.marketId, snapshot.sourceTimestamp]
      );

      if (existing.rowCount && existing.rows[0]?.id) {
        const result = await this.pool.query(
          `UPDATE predict_orderbook_snapshots
              SET best_bid = $4::numeric,
                  best_ask = $5::numeric,
                  spread = $6::numeric,
                  midpoint = $7::numeric,
                  top_of_book_size = $8::numeric,
                  snapshot_payload = $9::jsonb,
                  recorded_at = NOW()
            WHERE id = $1`,
          [
            existing.rows[0].id,
            snapshot.environment,
            snapshot.marketId,
            snapshot.bestBid,
            snapshot.bestAsk,
            snapshot.spread,
            snapshot.midpoint,
            snapshot.topOfBookSize,
            JSON.stringify(snapshot.snapshotPayload)
          ]
        );
        inserted += result.rowCount ?? 0;
        continue;
      }

      const result = await this.pool.query(
        `INSERT INTO predict_orderbook_snapshots (
           environment,
           market_id,
           source_timestamp,
           best_bid,
           best_ask,
           spread,
           midpoint,
           top_of_book_size,
           snapshot_payload
         ) VALUES (
           $1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::jsonb
         )`,
        [
          snapshot.environment,
          snapshot.marketId,
          snapshot.sourceTimestamp,
          snapshot.bestBid,
          snapshot.bestAsk,
          snapshot.spread,
          snapshot.midpoint,
          snapshot.topOfBookSize,
          JSON.stringify(snapshot.snapshotPayload)
        ]
      );
      inserted += result.rowCount ?? 0;
    }

    return inserted;
  }

  public static toPersistedOrderbookSnapshot(
    snapshot: PredictNormalizedOrderbookSnapshot
  ): PersistedOrderbookSnapshotInput {
    return {
      environment: snapshot.environment,
      marketId: snapshot.marketId,
      sourceTimestamp: snapshot.sourceTimestamp,
      bestBid: snapshot.bestBid,
      bestAsk: snapshot.bestAsk,
      spread: snapshot.spread,
      midpoint: snapshot.midpoint,
      topOfBookSize: snapshot.topOfBookSize,
      snapshotPayload: snapshot.raw
    };
  }
}
