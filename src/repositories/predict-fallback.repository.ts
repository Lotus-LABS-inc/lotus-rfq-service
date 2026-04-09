import type { Pool } from "pg";

import type { PredictEnvironment, PredictFallbackSnapshot } from "../integrations/predict/predict-types.js";

export interface PersistPredictFallbackSnapshotInput {
  environment: PredictEnvironment;
  marketId: string;
  provenance: PredictFallbackSnapshot["provenance"];
  fidelity: PredictFallbackSnapshot["fidelity"];
  sourceTimestamp: Date;
  snapshot: Record<string, unknown>;
}

interface PredictFallbackSnapshotRow {
  environment: PredictEnvironment;
  market_id: string;
  provenance: PredictFallbackSnapshot["provenance"];
  fidelity: PredictFallbackSnapshot["fidelity"];
  source_timestamp: Date;
  snapshot_payload: Record<string, unknown>;
}

export class PredictFallbackRepository {
  public constructor(private readonly pool: Pool) {}

  public async insertMany(inputs: readonly PersistPredictFallbackSnapshotInput[]): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }

    const values: unknown[] = [];
    const placeholders = inputs.map((input, index) => {
      const offset = index * 6;
      values.push(
        input.environment,
        input.marketId,
        input.provenance,
        input.fidelity,
        input.sourceTimestamp,
        JSON.stringify(input.snapshot)
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::jsonb)`;
    });

    const result = await this.pool.query(
      `INSERT INTO predict_fallback_historical_snapshots (
         environment,
         market_id,
         provenance,
         fidelity,
         source_timestamp,
         snapshot_payload
       ) VALUES ${placeholders.join(", ")}
       ON CONFLICT (environment, market_id, provenance, source_timestamp) DO NOTHING`,
      values
    );

    return result.rowCount ?? 0;
  }

  public async listForWindow(input: {
    environment: PredictEnvironment;
    marketId: string;
    start: Date;
    end: Date;
  }): Promise<readonly PredictFallbackSnapshot[]> {
    const result = await this.pool.query<PredictFallbackSnapshotRow>(
      `SELECT environment,
              market_id,
              provenance,
              fidelity,
              source_timestamp,
              snapshot_payload
         FROM predict_fallback_historical_snapshots
        WHERE environment = $1
          AND market_id = $2
          AND source_timestamp >= $3
          AND source_timestamp <= $4
        ORDER BY source_timestamp ASC`,
      [input.environment, input.marketId, input.start, input.end]
    );

    return result.rows.map((row) => ({
      environment: row.environment,
      marketId: row.market_id,
      provenance: row.provenance,
      fidelity: row.fidelity,
      timestamp: new Date(row.source_timestamp),
      snapshot: row.snapshot_payload
    }));
  }
}
