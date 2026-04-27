import type { Pool } from "pg";

export type WithdrawalWalletChainFamily = "EVM";

export interface UserWithdrawalWallet {
  userId: string;
  chainFamily: WithdrawalWalletChainFamily;
  address: string;
  label: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserWithdrawalWalletRow {
  user_id: string;
  chain_family: string;
  address: string;
  label: string | null;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class UserWithdrawalWalletRepository {
  public constructor(private readonly pool: Pool) {}

  public async listWallets(userId: string): Promise<UserWithdrawalWallet[]> {
    const result = await this.pool.query<UserWithdrawalWalletRow>(
      `SELECT user_id, chain_family, address, label, verified_at, created_at, updated_at
         FROM user_withdrawal_wallets
        WHERE user_id = $1
        ORDER BY updated_at DESC`,
      [userId]
    );
    return result.rows.map(mapRow);
  }

  public async upsertEvmWallet(input: {
    userId: string;
    address: string;
    label?: string | null;
  }): Promise<UserWithdrawalWallet> {
    const result = await this.pool.query<UserWithdrawalWalletRow>(
      `INSERT INTO user_withdrawal_wallets (user_id, chain_family, address, label)
       VALUES ($1, 'EVM', $2, $3)
       ON CONFLICT (user_id, chain_family)
       DO UPDATE SET address = EXCLUDED.address, label = EXCLUDED.label, verified_at = NULL, updated_at = now()
       RETURNING user_id, chain_family, address, label, verified_at, created_at, updated_at`,
      [input.userId, input.address, input.label ?? null]
    );
    return mapRow(result.rows[0]!);
  }

  public async hasEvmWithdrawalWallet(userId: string, address?: string | null): Promise<boolean> {
    const values: string[] = [userId];
    const addressClause = address
      ? " AND lower(address) = lower($2)"
      : "";
    if (address) {
      values.push(address);
    }
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM user_withdrawal_wallets
          WHERE user_id = $1
            AND chain_family = 'EVM'
            ${addressClause}
       ) AS exists`,
      values
    );
    return result.rows[0]?.exists === true;
  }
}

const mapRow = (row: UserWithdrawalWalletRow): UserWithdrawalWallet => ({
  userId: row.user_id,
  chainFamily: "EVM",
  address: row.address,
  label: row.label,
  verifiedAt: row.verified_at ? row.verified_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});
