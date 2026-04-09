import type { Pool } from "pg";

import type { PredictNormalizedExecutionEvent, PredictRecorderCheckpoint } from "../integrations/predict/predict-types.js";
import type { PredictWsClient, PredictWsEnvelope } from "../integrations/predict/predict-ws-client.js";

export interface PredictMatchEventRecorderConfig {
  pool?: Pool;
  wsClient: PredictWsClient;
  normalizeEvent: (envelope: PredictWsEnvelope) => PredictNormalizedExecutionEvent | null;
  subscriptionRequestFactory: (topics: readonly string[]) => Record<string, unknown>;
}

export class PredictMatchEventRecorder {
  private unsubscribe: (() => void) | null = null;
  private checkpoints = new Map<string, PredictRecorderCheckpoint>();

  public constructor(private readonly config: PredictMatchEventRecorderConfig) {}

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

  public getCheckpoints(): readonly PredictRecorderCheckpoint[] {
    return [...this.checkpoints.values()];
  }

  public async recordEvent(event: PredictNormalizedExecutionEvent): Promise<void> {
    if (!this.config.pool) {
      return;
    }
    await this.config.pool.query(
      `INSERT INTO predict_match_events (
         environment,
         market_id,
         event_id,
         order_hash,
         side,
         price,
         size,
         event_timestamp,
         event_payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (environment, event_id) DO UPDATE
           SET event_payload = EXCLUDED.event_payload`,
      [
        event.environment,
        event.marketId,
        event.eventId,
        event.orderHash,
        event.side,
        event.price,
        event.size,
        event.timestamp,
        JSON.stringify(event)
      ]
    );
  }

  private async handleEnvelope(envelope: PredictWsEnvelope): Promise<void> {
    const event = this.config.normalizeEvent(envelope);
    if (!event) {
      return;
    }
    await this.recordEvent(event);
    const marketId = event.marketId ?? "unknown";
    this.checkpoints.set(`${event.environment}:${marketId}`, {
      recorderType: "MATCH_EVENT",
      environment: event.environment,
      marketId,
      checkpointKey: `${event.environment}:${marketId}`,
      sequence: envelope.sequence,
      updatedAt: envelope.receivedAt,
      metadata: {
        eventId: event.eventId
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
