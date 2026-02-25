import type { Pool } from "pg";

export interface RFQExecutionRecord {
  id: string;
  session_id: string;
  quote_id: string;
  execution_status: string;
  executed_price: string;
  executed_quantity: string;
  venue_execution_ref: string | null;
  transaction_hash: string | null;
  execution_payload: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface NewRFQExecutionInput {
  sessionId: string;
  quoteId: string;
  executionStatus: string;
  executedPrice: string;
  executedQuantity: string;
  venueExecutionRef?: string;
  transactionHash?: string;
  executionPayload?: Record<string, unknown>;
}

export class RFQExecutionRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: NewRFQExecutionInput): Promise<RFQExecutionRecord> {
    const result = await this.pool.query<RFQExecutionRecord>(
      `INSERT INTO rfq_executions (
        session_id,
        quote_id,
        execution_status,
        executed_price,
        executed_quantity,
        venue_execution_ref,
        transaction_hash,
        execution_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING *`,
      [
        input.sessionId,
        input.quoteId,
        input.executionStatus,
        input.executedPrice,
        input.executedQuantity,
        input.venueExecutionRef ?? null,
        input.transactionHash ?? null,
        JSON.stringify(input.executionPayload ?? {})
      ]
    );

    return result.rows[0] as RFQExecutionRecord;
  }
}

