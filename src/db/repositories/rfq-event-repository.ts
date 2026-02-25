import type { Pool } from "pg";

export interface RFQEventRecord {
  id: string;
  session_id: string;
  quote_id: string | null;
  event_type: string;
  event_payload: Record<string, unknown>;
  created_at: Date;
}

export interface NewRFQEventInput {
  sessionId: string;
  quoteId?: string;
  eventType: string;
  eventPayload?: Record<string, unknown>;
}

export class RFQEventRepository {
  public constructor(private readonly pool: Pool) {}

  public async append(input: NewRFQEventInput): Promise<RFQEventRecord> {
    const result = await this.pool.query<RFQEventRecord>(
      `INSERT INTO rfq_events (
        session_id,
        quote_id,
        event_type,
        event_payload
      ) VALUES ($1, $2, $3, $4::jsonb)
      RETURNING *`,
      [
        input.sessionId,
        input.quoteId ?? null,
        input.eventType,
        JSON.stringify(input.eventPayload ?? {})
      ]
    );

    return result.rows[0] as RFQEventRecord;
  }

  public async listBySessionId(sessionId: string, limit = 200): Promise<RFQEventRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const result = await this.pool.query<RFQEventRecord>(
      `SELECT * FROM rfq_events
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, safeLimit]
    );

    return result.rows;
  }
}
