import type { Pool } from "pg";
import type { CompatibilityClass } from "../canonical/canonicalization-types.js";

export interface CompatibilityOverrideRecord {
    id: string;
    targetDecisionId: string;
    forcedCompatibilityClass: CompatibilityClass;
    reviewerIdentity: string;
    reason: string;
    evidencePayload: Record<string, unknown>;
    createdAt: Date;
    expiresAt: Date | null;
    isActive: boolean;
    overrideVersion: string;
}

export interface CreateCompatibilityOverrideInput {
    targetDecisionId: string;
    forcedCompatibilityClass: CompatibilityClass;
    reviewerIdentity: string;
    reason: string;
    evidencePayload?: Record<string, unknown>;
    expiresAt?: Date | null;
    overrideVersion: string;
}

interface CompatibilityOverrideRow {
    id: string;
    target_decision_id: string;
    forced_compatibility_class: CompatibilityClass;
    reviewer_identity: string;
    reason: string;
    evidence_payload: Record<string, unknown>;
    created_at: Date;
    expires_at: Date | null;
    is_active: boolean;
    override_version: string;
}

export class CompatibilityOverrideRepository {
    public constructor(private readonly pool: Pool) {}

    public async create(input: CreateCompatibilityOverrideInput): Promise<CompatibilityOverrideRecord> {
        const result = await this.pool.query<CompatibilityOverrideRow>(
            `INSERT INTO compatibility_overrides (
                target_decision_id,
                forced_compatibility_class,
                reviewer_identity,
                reason,
                evidence_payload,
                expires_at,
                override_version
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
            RETURNING *`,
            [
                input.targetDecisionId,
                input.forcedCompatibilityClass,
                input.reviewerIdentity,
                input.reason,
                JSON.stringify(input.evidencePayload ?? {}),
                input.expiresAt ?? null,
                input.overrideVersion
            ]
        );

        return mapCompatibilityOverrideRow(result.rows[0]!);
    }

    public async deactivate(overrideId: string): Promise<CompatibilityOverrideRecord | null> {
        const result = await this.pool.query<CompatibilityOverrideRow>(
            `UPDATE compatibility_overrides
                SET is_active = false
              WHERE id = $1
              RETURNING *`,
            [overrideId]
        );

        return result.rows[0] ? mapCompatibilityOverrideRow(result.rows[0]) : null;
    }

    public async listActiveByDecision(targetDecisionId: string): Promise<readonly CompatibilityOverrideRecord[]> {
        const result = await this.pool.query<CompatibilityOverrideRow>(
            `SELECT *
               FROM compatibility_overrides
              WHERE target_decision_id = $1
                AND is_active = true
                AND (expires_at IS NULL OR expires_at > now())
              ORDER BY created_at DESC`,
            [targetDecisionId]
        );

        return result.rows.map(mapCompatibilityOverrideRow);
    }

    public async listActive(): Promise<readonly CompatibilityOverrideRecord[]> {
        const result = await this.pool.query<CompatibilityOverrideRow>(
            `SELECT *
               FROM compatibility_overrides
              WHERE is_active = true
                AND (expires_at IS NULL OR expires_at > now())
              ORDER BY created_at DESC`
        );
        return result.rows.map(mapCompatibilityOverrideRow);
    }

    public async appendAuditEvent(
        overrideId: string,
        action: string,
        actorIdentity: string,
        payload: Record<string, unknown>
    ): Promise<void> {
        await this.pool.query(
            `INSERT INTO compatibility_override_audit_events (
                override_id,
                action,
                actor_identity,
                payload
            ) VALUES ($1, $2, $3, $4::jsonb)`,
            [overrideId, action, actorIdentity, JSON.stringify(payload)]
        );
    }

    public async listAuditHistory(overrideId: string): Promise<readonly Record<string, unknown>[]> {
        const result = await this.pool.query(
            `SELECT id, override_id, action, actor_identity, payload, created_at
               FROM compatibility_override_audit_events
              WHERE override_id = $1
              ORDER BY created_at DESC`,
            [overrideId]
        );
        return result.rows.map((row) => ({
            id: row.id,
            overrideId: row.override_id,
            action: row.action,
            actorIdentity: row.actor_identity,
            payload: row.payload,
            createdAt: row.created_at
        }));
    }
}

const mapCompatibilityOverrideRow = (row: CompatibilityOverrideRow): CompatibilityOverrideRecord => ({
    id: row.id,
    targetDecisionId: row.target_decision_id,
    forcedCompatibilityClass: row.forced_compatibility_class,
    reviewerIdentity: row.reviewer_identity,
    reason: row.reason,
    evidencePayload: row.evidence_payload,
    createdAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    isActive: row.is_active,
    overrideVersion: row.override_version
});
