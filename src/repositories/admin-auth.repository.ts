import type { Pool } from "pg";

export type AdminMemberRole = "OWNER" | "ADMIN";
export type AdminMemberStatus = "ACTIVE" | "DISABLED";
export type AdminAuthKeyStatus = "ACTIVE" | "REVOKED";

interface AdminMemberRow {
  id: string;
  email: string;
  display_name: string | null;
  role: AdminMemberRole;
  status: AdminMemberStatus;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface AdminAuthKeyRow {
  id: string;
  admin_member_id: string;
  key_id: string;
  key_hash: string;
  status: AdminAuthKeyStatus;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_by: string | null;
  revoked_by: string | null;
  created_at: Date;
  revoked_at: Date | null;
}

export interface AdminMember {
  id: string;
  email: string;
  displayName: string | null;
  role: AdminMemberRole;
  status: AdminMemberStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAuthKey {
  id: string;
  adminMemberId: string;
  keyId: string;
  keyHash: string;
  status: AdminAuthKeyStatus;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdBy: string | null;
  revokedBy: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface CreateAdminMemberInput {
  email: string;
  displayName?: string | null;
  role: AdminMemberRole;
  createdBy?: string | null;
}

export interface CreateAdminAuthKeyInput {
  adminMemberId: string;
  keyId: string;
  keyHash: string;
  createdBy?: string | null;
  expiresAt?: string | null;
}

export class AdminAuthRepository {
  public constructor(private readonly pool: Pool) {}

  public async findMemberByEmail(email: string): Promise<AdminMember | null> {
    const result = await this.pool.query<AdminMemberRow>(
      `SELECT * FROM admin_members WHERE lower(email) = lower($1)`,
      [email]
    );
    return result.rows[0] ? mapAdminMemberRow(result.rows[0]) : null;
  }

  public async findMemberById(id: string): Promise<AdminMember | null> {
    const result = await this.pool.query<AdminMemberRow>(
      `SELECT * FROM admin_members WHERE id = $1::uuid`,
      [id]
    );
    return result.rows[0] ? mapAdminMemberRow(result.rows[0]) : null;
  }

  public async listMembers(limit = 100): Promise<AdminMember[]> {
    const result = await this.pool.query<AdminMemberRow>(
      `SELECT * FROM admin_members ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(mapAdminMemberRow);
  }

  public async upsertMember(input: CreateAdminMemberInput): Promise<AdminMember> {
    const result = await this.pool.query<AdminMemberRow>(
      `INSERT INTO admin_members (
          email,
          display_name,
          role,
          status,
          created_by
       ) VALUES ($1, $2, $3, 'ACTIVE', $4::uuid)
       ON CONFLICT (lower(email)) DO UPDATE SET
          display_name = COALESCE(EXCLUDED.display_name, admin_members.display_name),
          role = EXCLUDED.role,
          status = 'ACTIVE',
          updated_at = now()
       RETURNING *`,
      [
        input.email.toLowerCase(),
        input.displayName ?? null,
        input.role,
        input.createdBy ?? null
      ]
    );
    return mapAdminMemberRow(result.rows[0]!);
  }

  public async disableMember(id: string, actorId: string): Promise<AdminMember | null> {
    const result = await this.pool.query<AdminMemberRow>(
      `UPDATE admin_members
          SET status = 'DISABLED',
              updated_at = now()
        WHERE id = $1::uuid
        RETURNING *`,
      [id]
    );
    await this.createAuditEvent({
      actorAdminMemberId: actorId,
      eventType: "ADMIN_MEMBER_DISABLED",
      targetType: "admin_member",
      targetId: id,
      metadata: {}
    });
    return result.rows[0] ? mapAdminMemberRow(result.rows[0]) : null;
  }

  public async createKey(input: CreateAdminAuthKeyInput): Promise<AdminAuthKey> {
    const result = await this.pool.query<AdminAuthKeyRow>(
      `INSERT INTO admin_auth_keys (
          admin_member_id,
          key_id,
          key_hash,
          status,
          expires_at,
          created_by
       ) VALUES ($1::uuid, $2, $3, 'ACTIVE', $4::timestamptz, $5::uuid)
       RETURNING *`,
      [
        input.adminMemberId,
        input.keyId,
        input.keyHash,
        input.expiresAt ?? null,
        input.createdBy ?? null
      ]
    );
    return mapAdminAuthKeyRow(result.rows[0]!);
  }

  public async findKeyByKeyId(keyId: string): Promise<AdminAuthKey | null> {
    const result = await this.pool.query<AdminAuthKeyRow>(
      `SELECT * FROM admin_auth_keys WHERE key_id = $1`,
      [keyId]
    );
    return result.rows[0] ? mapAdminAuthKeyRow(result.rows[0]) : null;
  }

  public async listKeysForMember(adminMemberId: string): Promise<AdminAuthKey[]> {
    const result = await this.pool.query<AdminAuthKeyRow>(
      `SELECT *
         FROM admin_auth_keys
        WHERE admin_member_id = $1::uuid
        ORDER BY created_at DESC`,
      [adminMemberId]
    );
    return result.rows.map(mapAdminAuthKeyRow);
  }

  public async markKeyUsed(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE admin_auth_keys SET last_used_at = now() WHERE id = $1::uuid`,
      [id]
    );
  }

  public async revokeKey(id: string, actorId: string): Promise<AdminAuthKey | null> {
    const result = await this.pool.query<AdminAuthKeyRow>(
      `UPDATE admin_auth_keys
          SET status = 'REVOKED',
              revoked_by = $2::uuid,
              revoked_at = now()
        WHERE id = $1::uuid
        RETURNING *`,
      [id, actorId]
    );
    await this.createAuditEvent({
      actorAdminMemberId: actorId,
      eventType: "ADMIN_AUTH_KEY_REVOKED",
      targetType: "admin_auth_key",
      targetId: id,
      metadata: {}
    });
    return result.rows[0] ? mapAdminAuthKeyRow(result.rows[0]) : null;
  }

  public async createAuditEvent(input: {
    actorAdminMemberId?: string | null;
    eventType: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO admin_audit_events (
          actor_admin_member_id,
          event_type,
          target_type,
          target_id,
          metadata
       ) VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
      [
        input.actorAdminMemberId ?? null,
        input.eventType,
        input.targetType ?? null,
        input.targetId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }
}

const mapAdminMemberRow = (row: AdminMemberRow): AdminMember => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  role: row.role,
  status: row.status,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at)
});

const mapAdminAuthKeyRow = (row: AdminAuthKeyRow): AdminAuthKey => ({
  id: row.id,
  adminMemberId: row.admin_member_id,
  keyId: row.key_id,
  keyHash: row.key_hash,
  status: row.status,
  lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
  expiresAt: row.expires_at ? new Date(row.expires_at) : null,
  createdBy: row.created_by,
  revokedBy: row.revoked_by,
  createdAt: new Date(row.created_at),
  revokedAt: row.revoked_at ? new Date(row.revoked_at) : null
});
