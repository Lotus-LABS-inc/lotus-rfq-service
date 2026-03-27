import type { Pool } from "pg";

import type { PredictNormalizedOrderbookSnapshot, PredictRecorderCheckpoint } from "../integrations/predict/predict-types.js";
import type { PredictWsClient, PredictWsEnvelope } from "../integrations/predict/predict-ws-client.js";

export interface PredictOrderbookRecorderConfig {
  pool?: Pool;
  wsClient: PredictWsClient;
  normalizeSnapshot: (envelope: PredictWsEnvelope) => PredictNormalizedOrderbookSnapshot | null;
  subscriptionRequestFactory: (topics: readonly string[]) => Record<string, unknown>;
}

export class PredictOrderbookRecorder {
  private unsubscribe: (() => void) | null = null;
  private checkpoints = new Map<string, PredictRecorderCheckpoint>();

  public constructor(private readonly config: PredictOrderbookRecorderConfig) {}

  public start(topics: readonly string[]): void {
    this.config.wsClient.connect();
    this.config.wsClient.subscribe(topics, this.config.subscriptionRequestFactory);
    this.unsubscribe = this.config.wsClient.onEnvelope((envelope) => {
      void this.handleEnvelope(envelope);
    });
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  public async recordSnapshot(snapshot: PredictNormalizedOrderbookSnapshot): Promise<void> {
    if (!this.config.pool) {
      return;
    }
    await this.config.pool.query(
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
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        snapshot.environment,
        snapshot.marketId,
        snapshot.sourceTimestamp,
        snapshot.bestBid,
        snapshot.bestAsk,
        snapshot.spread,
        snapshot.midpoint,
        snapshot.topOfBookSize,
        JSON.stringify(snapshot)
      ]
    );
  }

  private async handleEnvelope(envelope: PredictWsEnvelope): Promise<void> {
    const snapshot = this.config.normalizeSnapshot(envelope);
    if (!snapshot) {
      return;
    }
    await this.recordSnapshot(snapshot);
    this.checkpoints.set(`${snapshot.environment}:${snapshot.marketId}`, {
      recorderType: "ORDERBOOK",
      environment: snapshot.environment,
      marketId: snapshot.marketId,
      checkpointKey: `${snapshot.environment}:${snapshot.marketId}`,
      sequence: envelope.sequence,
      updatedAt: envelope.receivedAt,
      metadata: {
        sourceTimestamp: snapshot.sourceTimestamp?.toISOString() ?? null
      }
    });
  }
}
