import type { Pool } from "pg";

export interface RFQSessionRecord {
  id: string;
  request_id: string;
  canonical_market_id: string;
  taker_id: string;
  side: "buy" | "sell";
  quantity: string;
  status: string;
  idempotency_key: string;
  expires_at: Date;
  metadata: Record<string, unknown>;
  flow_segment: "soft" | "standard" | null;
  flow_segment_version: string | null;
  flow_segment_input_hash: string | null;
  flow_segment_reasons: unknown[];
  created_at: Date;
  updated_at: Date;
}

export interface NewRFQSessionInput {
  requestId: string;
  canonicalMarketId: string;
  takerId: string;
  side: "buy" | "sell";
  quantity: string;
  status: string;
  idempotencyKey: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
  flowSegment?: "soft" | "standard";
  flowSegmentVersion?: string;
  flowSegmentInputHash?: string;
  flowSegmentReasons?: readonly unknown[];
}

export class RFQSessionRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: NewRFQSessionInput): Promise<RFQSessionRecord> {
    const result = await this.pool.query<RFQSessionRecord>(
      `INSERT INTO rfq_sessions (
        request_id,
        canonical_market_id,
        taker_id,
        side,
        quantity,
        status,
        idempotency_key,
        expires_at,
        metadata,
        flow_segment,
        flow_segment_version,
        flow_segment_input_hash,
        flow_segment_reasons
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13::jsonb)
      RETURNING *`,
      [
        input.requestId,
        input.canonicalMarketId,
        input.takerId,
        input.side,
        input.quantity,
        input.status,
        input.idempotencyKey,
        input.expiresAt,
        JSON.stringify(input.metadata ?? {}),
        input.flowSegment ?? null,
        input.flowSegmentVersion ?? null,
        input.flowSegmentInputHash ?? null,
        JSON.stringify(input.flowSegmentReasons ?? [])
      ]
    );

    return result.rows[0] as RFQSessionRecord;
  }

  public async findById(id: string): Promise<RFQSessionRecord | null> {
    const result = await this.pool.query<RFQSessionRecord>(
      "SELECT * FROM rfq_sessions WHERE id = $1 LIMIT 1",
      [id]
    );

    return result.rows[0] ?? null;
  }

  public async findByRequestId(requestId: string): Promise<RFQSessionRecord | null> {
    const result = await this.pool.query<RFQSessionRecord>(
      "SELECT * FROM rfq_sessions WHERE request_id = $1 LIMIT 1",
      [requestId]
    );

    return result.rows[0] ?? null;
  }

  public async updateStatus(id: string, status: string): Promise<RFQSessionRecord | null> {
    const result = await this.pool.query<RFQSessionRecord>(
      `UPDATE rfq_sessions
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status]
    );

    return result.rows[0] ?? null;
  }
}
