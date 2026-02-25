import type { Pool } from "pg";

export interface RFQQuoteRecord {
  id: string;
  session_id: string;
  lp_key_id: string;
  quote_status: string;
  price: string;
  quantity: string;
  fee_bps: number;
  valid_until: Date;
  quote_payload: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface NewRFQQuoteInput {
  sessionId: string;
  lpKeyId: string;
  quoteStatus: string;
  price: string;
  quantity: string;
  feeBps: number;
  validUntil: Date;
  quotePayload?: Record<string, unknown>;
}

export class RFQQuoteRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: NewRFQQuoteInput): Promise<RFQQuoteRecord> {
    const result = await this.pool.query<RFQQuoteRecord>(
      `INSERT INTO rfq_quotes (
        session_id,
        lp_key_id,
        quote_status,
        price,
        quantity,
        fee_bps,
        valid_until,
        quote_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING *`,
      [
        input.sessionId,
        input.lpKeyId,
        input.quoteStatus,
        input.price,
        input.quantity,
        input.feeBps,
        input.validUntil,
        JSON.stringify(input.quotePayload ?? {})
      ]
    );

    return result.rows[0] as RFQQuoteRecord;
  }

  public async findById(id: string): Promise<RFQQuoteRecord | null> {
    const result = await this.pool.query<RFQQuoteRecord>(
      "SELECT * FROM rfq_quotes WHERE id = $1 LIMIT 1",
      [id]
    );

    return result.rows[0] ?? null;
  }

  public async findByExternalQuoteId(
    sessionId: string,
    externalQuoteId: string
  ): Promise<RFQQuoteRecord | null> {
    const result = await this.pool.query<RFQQuoteRecord>(
      `SELECT * FROM rfq_quotes
       WHERE session_id = $1
         AND quote_payload->>'quoteId' = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId, externalQuoteId]
    );

    return result.rows[0] ?? null;
  }

  public async listBySessionId(sessionId: string, limit = 100): Promise<RFQQuoteRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const result = await this.pool.query<RFQQuoteRecord>(
      `SELECT * FROM rfq_quotes
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, safeLimit]
    );

    return result.rows;
  }
}
