import type { Pool } from "pg";

export interface LPKeyRecord {
  id: string;
  lp_id: string;
  key_id: string;
  public_key: string;
  secret_hash: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface NewLPKeyInput {
  lpId: string;
  keyId: string;
  publicKey: string;
  secretHash: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export class LPKeyRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: NewLPKeyInput): Promise<LPKeyRecord> {
    const result = await this.pool.query<LPKeyRecord>(
      `INSERT INTO lp_keys (
        lp_id,
        key_id,
        public_key,
        secret_hash,
        status,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING *`,
      [
        input.lpId,
        input.keyId,
        input.publicKey,
        input.secretHash,
        input.status,
        JSON.stringify(input.metadata ?? {})
      ]
    );

    return result.rows[0] as LPKeyRecord;
  }

  public async findByKeyId(keyId: string): Promise<LPKeyRecord | null> {
    const result = await this.pool.query<LPKeyRecord>(
      "SELECT * FROM lp_keys WHERE key_id = $1 LIMIT 1",
      [keyId]
    );

    return result.rows[0] ?? null;
  }

  public async listByLP(lpId: string, limit = 100): Promise<LPKeyRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const result = await this.pool.query<LPKeyRecord>(
      `SELECT * FROM lp_keys
       WHERE lp_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [lpId, safeLimit]
    );

    return result.rows;
  }

  public async updateStatus(id: string, status: string): Promise<LPKeyRecord | null> {
    const result = await this.pool.query<LPKeyRecord>(
      `UPDATE lp_keys
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status]
    );

    return result.rows[0] ?? null;
  }
}
