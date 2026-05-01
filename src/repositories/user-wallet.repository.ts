import type { Pool, PoolClient } from "pg";
import type { FundingVenue } from "../core/funding/types.js";
import type {
  UserWallet,
  UserWalletChainFamily,
  UserWalletProvider,
  UserWalletPurpose,
  UserWalletRepository as UserWalletRepositoryContract,
  UserWalletStatus
} from "../core/funding/user-wallets.js";

interface UserWalletRow {
  id: string;
  user_id: string;
  provider: UserWalletProvider;
  provider_sub_org_id: string | null;
  provider_wallet_id: string | null;
  provider_wallet_account_id: string | null;
  chain_family: UserWalletChainFamily;
  chain: string;
  address: string;
  purpose: UserWalletPurpose;
  venue: FundingVenue | null;
  exportable: boolean;
  status: UserWalletStatus;
  created_at: Date;
  updated_at: Date;
}

export class UserWalletRepository implements UserWalletRepositoryContract {
  public constructor(private readonly pool: Pool) {}

  public async listWallets(userId: string): Promise<UserWallet[]> {
    const result = await this.pool.query<UserWalletRow>(
      `SELECT id, user_id, provider, provider_sub_org_id, provider_wallet_id, provider_wallet_account_id,
              chain_family, chain, address, purpose, venue, exportable, status, created_at, updated_at
         FROM user_wallets
        WHERE user_id = $1
        ORDER BY updated_at DESC`,
      [userId]
    );
    return result.rows.map(mapWallet);
  }

  public async findWalletById(walletId: string): Promise<UserWallet | null> {
    const result = await this.pool.query<UserWalletRow>(
      `SELECT id, user_id, provider, provider_sub_org_id, provider_wallet_id, provider_wallet_account_id,
              chain_family, chain, address, purpose, venue, exportable, status, created_at, updated_at
         FROM user_wallets
        WHERE id = $1::uuid`,
      [walletId]
    );
    return result.rows[0] ? mapWallet(result.rows[0]) : null;
  }

  public async findActiveWallet(input: {
    userId: string;
    chainFamily: UserWalletChainFamily;
    purpose: UserWalletPurpose;
    venue?: FundingVenue | null;
  }): Promise<UserWallet | null> {
    const result = await this.pool.query<UserWalletRow>(
      `SELECT id, user_id, provider, provider_sub_org_id, provider_wallet_id, provider_wallet_account_id,
              chain_family, chain, address, purpose, venue, exportable, status, created_at, updated_at
         FROM user_wallets
        WHERE user_id = $1
          AND chain_family = $2
          AND purpose = $3
          AND status = 'ACTIVE'
          AND COALESCE(venue, '') = COALESCE($4, '')
        ORDER BY updated_at DESC
        LIMIT 1`,
      [input.userId, input.chainFamily, input.purpose, input.venue ?? null]
    );
    return result.rows[0] ? mapWallet(result.rows[0]) : null;
  }

  public async upsertWallet(input: Omit<UserWallet, "walletId" | "createdAt" | "updatedAt"> & { walletId?: string }): Promise<UserWallet> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const wallet = await this.upsertWalletWithClient(client, input);
      if (input.chainFamily === "EVM" && input.purpose === "WITHDRAWAL_DESTINATION") {
        await client.query(
          `INSERT INTO user_withdrawal_wallets (user_id, chain_family, address, label, verified_at)
           VALUES ($1, 'EVM', $2, NULL, NULL)
           ON CONFLICT (user_id, chain_family)
           DO UPDATE SET address = EXCLUDED.address, verified_at = NULL, updated_at = now()`,
          [input.userId, input.address]
        );
      }
      await client.query("COMMIT");
      return wallet;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async appendWalletAuditEvent(input: {
    userId: string;
    walletId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO user_wallet_audit_events (user_id, wallet_id, event_type, payload)
       VALUES ($1, $2::uuid, $3, $4::jsonb)
       RETURNING id`,
      [input.userId, input.walletId ?? null, input.eventType, input.payload]
    );
    return result.rows[0]!.id;
  }

  private async upsertWalletWithClient(
    client: PoolClient,
    input: Omit<UserWallet, "walletId" | "createdAt" | "updatedAt"> & { walletId?: string }
  ): Promise<UserWallet> {
    const existing = input.walletId
      ? await client.query<UserWalletRow>(
          `SELECT id, user_id, provider, provider_sub_org_id, provider_wallet_id, provider_wallet_account_id,
                  chain_family, chain, address, purpose, venue, exportable, status, created_at, updated_at
             FROM user_wallets
            WHERE id = $1::uuid
            FOR UPDATE`,
          [input.walletId]
        )
      : await client.query<UserWalletRow>(
          `SELECT id, user_id, provider, provider_sub_org_id, provider_wallet_id, provider_wallet_account_id,
                  chain_family, chain, address, purpose, venue, exportable, status, created_at, updated_at
             FROM user_wallets
            WHERE user_id = $1
              AND chain_family = $2
              AND purpose = $3
              AND COALESCE(venue, '') = COALESCE($4, '')
              AND status = 'ACTIVE'
            ORDER BY updated_at DESC
            LIMIT 1
            FOR UPDATE`,
          [input.userId, input.chainFamily, input.purpose, input.venue ?? null]
        );
    if (existing.rows[0]) {
      const result = await client.query<UserWalletRow>(
        `UPDATE user_wallets
            SET provider = $2,
                provider_sub_org_id = $3,
                provider_wallet_id = $4,
                provider_wallet_account_id = $5,
                chain = $6,
                address = $7,
                exportable = $8,
                status = $9,
                updated_at = now()
          WHERE id = $1::uuid
          RETURNING id, user_id, provider, provider_sub_org_id, provider_wallet_id, provider_wallet_account_id,
                    chain_family, chain, address, purpose, venue, exportable, status, created_at, updated_at`,
        [
          existing.rows[0].id,
          input.provider,
          input.providerSubOrgId,
          input.providerWalletId,
          input.providerWalletAccountId,
          input.chain,
          input.address,
          input.exportable,
          input.status
        ]
      );
      return mapWallet(result.rows[0]!);
    }
    const result = await client.query<UserWalletRow>(
      `INSERT INTO user_wallets (
          user_id, provider, provider_sub_org_id, provider_wallet_id, provider_wallet_account_id,
          chain_family, chain, address, purpose, venue, exportable, status
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )
       RETURNING id, user_id, provider, provider_sub_org_id, provider_wallet_id, provider_wallet_account_id,
                 chain_family, chain, address, purpose, venue, exportable, status, created_at, updated_at`,
      [
        input.userId,
        input.provider,
        input.providerSubOrgId,
        input.providerWalletId,
        input.providerWalletAccountId,
        input.chainFamily,
        input.chain,
        input.address,
        input.purpose,
        input.venue,
        input.exportable,
        input.status
      ]
    );
    return mapWallet(result.rows[0]!);
  }
}

const mapWallet = (row: UserWalletRow): UserWallet => ({
  walletId: row.id,
  userId: row.user_id,
  provider: row.provider,
  providerSubOrgId: row.provider_sub_org_id,
  providerWalletId: row.provider_wallet_id,
  providerWalletAccountId: row.provider_wallet_account_id,
  chainFamily: row.chain_family,
  chain: row.chain,
  address: row.address,
  purpose: row.purpose,
  venue: row.venue,
  exportable: row.exportable,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});
