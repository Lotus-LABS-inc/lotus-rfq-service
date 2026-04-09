import type { Pool } from "pg";

import type {
  PredictEnvironment,
  PredictNormalizedOrderbookSnapshot,
  PredictRecorderCheckpoint
} from "../integrations/predict/predict-types.js";
import type { PredictWsClient, PredictWsEnvelope } from "../integrations/predict/predict-ws-client.js";

export interface PredictOrderbookRecorderConfig {
  pool?: Pool;
  wsClient: PredictWsClient;
  environment: PredictEnvironment;
  normalizeSnapshot: (envelope: PredictWsEnvelope) => PredictNormalizedOrderbookSnapshot | null;
  subscriptionRequestFactory: (topics: readonly string[]) => Record<string, unknown>;
  topicToMarketId?: (topic: string) => string | null;
  bootstrapSnapshotLoader?: (marketId: string) => Promise<PredictNormalizedOrderbookSnapshot | null>;
}

export class PredictOrderbookRecorder {
  private unsubscribe: (() => void) | null = null;
  private checkpoints = new Map<string, PredictRecorderCheckpoint>();

  public constructor(private readonly config: PredictOrderbookRecorderConfig) {}

  public async start(topics: readonly string[]): Promise<void> {
    this.unsubscribe = this.config.wsClient.onEnvelope((envelope) => {
      void this.handleEnvelope(envelope);
    });
    const topicToMarketId = this.config.topicToMarketId ?? ((topic: string) => topic.split("/").at(-1) ?? null);
    const startedAt = new Date();
    for (const topic of topics) {
      const marketId = topicToMarketId(topic);
      if (!marketId) {
        continue;
      }
      this.checkpoints.set(`subscription:${marketId}`, {
        recorderType: "ORDERBOOK",
        environment: this.config.environment,
        marketId,
        checkpointKey: `subscription:${marketId}`,
        sequence: 0,
        updatedAt: startedAt,
        metadata: {
          phase: "subscription_requested",
          topic,
          startedAt: startedAt.toISOString()
        }
      });
    }

    if (this.config.bootstrapSnapshotLoader) {
      for (const topic of topics) {
        const marketId = topicToMarketId(topic);
        if (!marketId) {
          continue;
        }
        const bootstrapSnapshot = await this.config.bootstrapSnapshotLoader(marketId);
        if (!bootstrapSnapshot) {
          continue;
        }
        await this.recordSnapshot(bootstrapSnapshot);
        this.checkpoints.set(`${bootstrapSnapshot.environment}:${bootstrapSnapshot.marketId}`, {
          recorderType: "ORDERBOOK",
          environment: bootstrapSnapshot.environment,
          marketId: bootstrapSnapshot.marketId,
          checkpointKey: `${bootstrapSnapshot.environment}:${bootstrapSnapshot.marketId}`,
          sequence: 0,
          updatedAt: startedAt,
          metadata: {
            phase: "bootstrap_snapshot_persisted",
            sourceTimestamp: bootstrapSnapshot.sourceTimestamp?.toISOString() ?? null
          }
        });
      }
    }

    this.config.wsClient.connect();
    await this.config.wsClient.waitForOpen();
    this.config.wsClient.subscribe(topics, this.config.subscriptionRequestFactory);
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  public getCheckpoints(): readonly PredictRecorderCheckpoint[] {
    return [...this.checkpoints.values()];
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

  public async flushCheckpoints(): Promise<number> {
    if (!this.config.pool || this.checkpoints.size === 0) {
      return 0;
    }

    let persisted = 0;
    for (const checkpoint of this.checkpoints.values()) {
      const result = await this.config.pool.query(
        `INSERT INTO predict_recorder_checkpoints (
           recorder_type,
           environment,
           market_id,
           checkpoint_key,
           event_sequence,
           checkpoint_metadata
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (recorder_type, checkpoint_key) DO UPDATE SET
           environment = EXCLUDED.environment,
           market_id = EXCLUDED.market_id,
           event_sequence = EXCLUDED.event_sequence,
           checkpoint_metadata = EXCLUDED.checkpoint_metadata,
           updated_at = NOW()`,
        [
          checkpoint.recorderType,
          checkpoint.environment,
          checkpoint.marketId,
          checkpoint.checkpointKey,
          checkpoint.sequence,
          JSON.stringify(checkpoint.metadata)
        ]
      );
      persisted += result.rowCount ?? 0;
    }

    return persisted;
  }
}
