import type { Pool, PoolClient } from "pg";
import type {
  UserVenueAccount,
  UserVenueAccountRepository as UserVenueAccountRepositoryContract,
  UserVenueAccountStatus,
  UserVenueAccountType,
  UserVenueAccountVenue
} from "../core/execution/user-venue-accounts.js";

interface UserVenueAccountRow {
  id: string;
  user_id: string;
  venue: UserVenueAccountVenue;
  user_wallet_id: string;
  wallet_address: string;
  venue_account_id: string | null;
  venue_account_address: string | null;
  venue_account_type: UserVenueAccountType;
  status: UserVenueAccountStatus;
  created_at: Date;
  updated_at: Date;
  last_verified_at: Date | null;
}

interface UserVenueAccountAuditEventRow {
  id?: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

const DEFAULT_AUDIT_COALESCE_WINDOW_SECONDS = 86_400;

export class UserVenueAccountRepository implements UserVenueAccountRepositoryContract {
  public constructor(private readonly pool: Pool) {}

  public async listAccounts(userId: string): Promise<UserVenueAccount[]> {
    const result = await this.pool.query<UserVenueAccountRow>(
      `SELECT id, user_id, venue, user_wallet_id, wallet_address, venue_account_id,
              venue_account_address, venue_account_type, status, created_at, updated_at, last_verified_at
         FROM user_venue_accounts
        WHERE user_id = $1
        ORDER BY updated_at DESC`,
      [userId]
    );
    return result.rows.map(mapRow);
  }

  public async findAccount(input: { userId: string; venue: UserVenueAccountVenue }): Promise<UserVenueAccount | null> {
    const result = await this.pool.query<UserVenueAccountRow>(
      `SELECT id, user_id, venue, user_wallet_id, wallet_address, venue_account_id,
              venue_account_address, venue_account_type, status, created_at, updated_at, last_verified_at
         FROM user_venue_accounts
        WHERE user_id = $1
          AND venue = $2
          AND status IN ('PENDING', 'ACTIVE')
        ORDER BY updated_at DESC
        LIMIT 1`,
      [input.userId, input.venue]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  public async upsertAccount(input: Omit<UserVenueAccount, "venueAccountBindingId" | "createdAt" | "updatedAt" | "lastVerifiedAt"> & {
    venueAccountBindingId?: string;
    lastVerifiedAt?: string | null;
  }): Promise<UserVenueAccount> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const account = await this.upsertAccountWithClient(client, input);
      await client.query("COMMIT");
      return account;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async disableAccount(input: { userId: string; venue: UserVenueAccountVenue; reason: string }): Promise<UserVenueAccount | null> {
    const result = await this.pool.query<UserVenueAccountRow>(
      `UPDATE user_venue_accounts
          SET status = 'DISABLED',
              updated_at = now()
        WHERE user_id = $1
          AND venue = $2
          AND status IN ('PENDING', 'ACTIVE')
        RETURNING id, user_id, venue, user_wallet_id, wallet_address, venue_account_id,
                  venue_account_address, venue_account_type, status, created_at, updated_at, last_verified_at`,
      [input.userId, input.venue]
    );
    const account = result.rows[0] ? mapRow(result.rows[0]) : null;
    if (account) {
      await this.appendAccountAuditEvent({
        userId: input.userId,
        venueAccountBindingId: account.venueAccountBindingId,
        eventType: "USER_VENUE_ACCOUNT_DISABLED",
        payload: { venue: input.venue, reason: input.reason }
      });
    }
    return account;
  }

  public async countActiveAccountsByVenue(): Promise<Record<string, number>> {
    const result = await this.pool.query<{ venue: string; count: string }>(
      `SELECT venue, COUNT(*)::text AS count
         FROM user_venue_accounts
        WHERE status = 'ACTIVE'
        GROUP BY venue`
    );
    return Object.fromEntries(result.rows.map((row) => [row.venue, Number(row.count)]));
  }

  public async appendAccountAuditEvent(input: {
    userId: string;
    venueAccountBindingId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const duplicate = await this.findRecentDuplicateAccountAuditEvent(input);
    if (duplicate) {
      return duplicate;
    }
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO user_venue_account_audit_events (user_id, venue_account_id, event_type, payload)
       VALUES ($1, $2::uuid, $3, $4::jsonb)
       RETURNING id`,
      [input.userId, input.venueAccountBindingId ?? null, input.eventType, input.payload]
    );
    return result.rows[0]!.id;
  }

  private async findRecentDuplicateAccountAuditEvent(input: {
    userId: string;
    venueAccountBindingId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<string | null> {
    const windowSeconds = parseAuditCoalesceWindowSeconds(process.env.USER_VENUE_ACCOUNT_AUDIT_COALESCE_WINDOW_SECONDS);
    if (windowSeconds <= 0) {
      return null;
    }
    const result = await this.pool.query<Pick<Required<UserVenueAccountAuditEventRow>, "id">>(
      `SELECT id
         FROM user_venue_account_audit_events
        WHERE user_id = $1
          AND venue_account_id IS NOT DISTINCT FROM $2::uuid
          AND event_type = $3
          AND md5(payload::text) = md5(($4::jsonb)::text)
          AND payload = $4::jsonb
          AND created_at >= now() - ($5::int * interval '1 second')
        ORDER BY created_at DESC
        LIMIT 1`,
      [input.userId, input.venueAccountBindingId ?? null, input.eventType, input.payload, windowSeconds]
    );
    return result.rows[0]?.id ?? null;
  }

  public async findLatestAccountAuditEvent(input: {
    userId: string;
    venueAccountBindingId: string;
    eventType: string;
  }): Promise<{ eventType: string; payload: Record<string, unknown>; createdAt: string } | null> {
    const result = await this.pool.query<UserVenueAccountAuditEventRow>(
      `SELECT event_type, payload, created_at
         FROM user_venue_account_audit_events
        WHERE user_id = $1
          AND venue_account_id = $2::uuid
          AND event_type = $3
        ORDER BY created_at DESC
        LIMIT 1`,
      [input.userId, input.venueAccountBindingId, input.eventType]
    );
    const row = result.rows[0];
    return row
      ? { eventType: row.event_type, payload: row.payload, createdAt: row.created_at.toISOString() }
      : null;
  }

  private async upsertAccountWithClient(
    client: PoolClient,
    input: Omit<UserVenueAccount, "venueAccountBindingId" | "createdAt" | "updatedAt" | "lastVerifiedAt"> & {
      venueAccountBindingId?: string;
      lastVerifiedAt?: string | null;
    }
  ): Promise<UserVenueAccount> {
    const existing = input.venueAccountBindingId
      ? await client.query<UserVenueAccountRow>(
          `SELECT id
             FROM user_venue_accounts
            WHERE id = $1::uuid
            FOR UPDATE`,
          [input.venueAccountBindingId]
        )
      : await client.query<UserVenueAccountRow>(
          `SELECT id
             FROM user_venue_accounts
            WHERE user_id = $1
              AND venue = $2
              AND status IN ('PENDING', 'ACTIVE')
            ORDER BY updated_at DESC
            LIMIT 1
            FOR UPDATE`,
          [input.userId, input.venue]
        );
    if (existing.rows[0]) {
      const result = await client.query<UserVenueAccountRow>(
        `UPDATE user_venue_accounts
            SET user_wallet_id = $2::uuid,
                wallet_address = $3,
                venue_account_id = $4,
                venue_account_address = $5,
                venue_account_type = $6,
                status = $7,
                last_verified_at = $8::timestamptz,
                updated_at = now()
          WHERE id = $1::uuid
          RETURNING id, user_id, venue, user_wallet_id, wallet_address, venue_account_id,
                    venue_account_address, venue_account_type, status, created_at, updated_at, last_verified_at`,
        [
          existing.rows[0].id,
          input.userWalletId,
          input.walletAddress,
          input.venueAccountId,
          input.venueAccountAddress,
          input.venueAccountType,
          input.status,
          input.lastVerifiedAt ?? null
        ]
      );
      return mapRow(result.rows[0]!);
    }
    const result = await client.query<UserVenueAccountRow>(
      `INSERT INTO user_venue_accounts (
          user_id, venue, user_wallet_id, wallet_address, venue_account_id,
          venue_account_address, venue_account_type, status, last_verified_at
       ) VALUES (
          $1, $2, $3::uuid, $4, $5, $6, $7, $8, $9::timestamptz
       )
       RETURNING id, user_id, venue, user_wallet_id, wallet_address, venue_account_id,
                 venue_account_address, venue_account_type, status, created_at, updated_at, last_verified_at`,
      [
        input.userId,
        input.venue,
        input.userWalletId,
        input.walletAddress,
        input.venueAccountId,
        input.venueAccountAddress,
        input.venueAccountType,
        input.status,
        input.lastVerifiedAt ?? null
      ]
    );
    return mapRow(result.rows[0]!);
  }
}

const mapRow = (row: UserVenueAccountRow): UserVenueAccount => ({
  venueAccountBindingId: row.id,
  userId: row.user_id,
  venue: row.venue,
  userWalletId: row.user_wallet_id,
  walletAddress: row.wallet_address,
  venueAccountId: row.venue_account_id,
  venueAccountAddress: row.venue_account_address,
  venueAccountType: row.venue_account_type,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  lastVerifiedAt: row.last_verified_at?.toISOString() ?? null
});

const parseAuditCoalesceWindowSeconds = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_AUDIT_COALESCE_WINDOW_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_AUDIT_COALESCE_WINDOW_SECONDS;
  }
  return Math.min(parsed, 604_800);
};
