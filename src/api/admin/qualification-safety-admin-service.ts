import type { Pool } from "pg";
import type { Logger } from "pino";

import type { AutoSafetyActionEngine } from "../../core/qualification/auto-safety-action-engine.js";
import { type AutoSafetyAction, AutoSafetyActionType } from "../../core/qualification/qualification.types.js";

interface AutoSafetyActionRow {
    id: string;
    strategy_key: string;
    scope_type: string;
    scope_id: string;
    action_type: string;
    trigger_reason: string;
    created_at: Date;
    resolved_at: Date | null;
    metadata: Record<string, unknown>;
}

export interface QualificationSafetyActionFilters {
    strategyKey?: string;
    scopeType?: string;
    scopeId?: string;
    actionType?: AutoSafetyActionType;
    resolved?: boolean;
}

export interface QualificationSafetyAdminServiceDeps {
    pool: Pool;
    autoSafetyActionEngine: Pick<AutoSafetyActionEngine, "resolveAction">;
    logger?: Pick<Logger, "info" | "warn" | "error">;
}

export class QualificationSafetyActionNotFoundError extends Error {
    public constructor(actionId: string) {
        super(`Qualification safety action ${actionId} not found.`);
        this.name = "QualificationSafetyActionNotFoundError";
    }
}

export class QualificationSafetyActionResolveError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "QualificationSafetyActionResolveError";
    }
}

const mapRow = (row: AutoSafetyActionRow): AutoSafetyAction => ({
    id: row.id,
    strategyKey: row.strategy_key,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    actionType: row.action_type as AutoSafetyActionType,
    triggerReason: row.trigger_reason,
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
    metadata: row.metadata
});

export class QualificationSafetyAdminService {
    private readonly pool: Pool;
    private readonly autoSafetyActionEngine: Pick<AutoSafetyActionEngine, "resolveAction">;
    private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;

    public constructor(deps: QualificationSafetyAdminServiceDeps) {
        this.pool = deps.pool;
        this.autoSafetyActionEngine = deps.autoSafetyActionEngine;
        this.logger = deps.logger;
    }

    public async listActions(filters: QualificationSafetyActionFilters = {}): Promise<AutoSafetyAction[]> {
        const clauses: string[] = [];
        const values: Array<string | boolean> = [];

        if (filters.strategyKey) {
            values.push(filters.strategyKey);
            clauses.push(`strategy_key = $${values.length}`);
        }
        if (filters.scopeType) {
            values.push(filters.scopeType);
            clauses.push(`scope_type = $${values.length}`);
        }
        if (filters.scopeId) {
            values.push(filters.scopeId);
            clauses.push(`scope_id = $${values.length}`);
        }
        if (filters.actionType) {
            values.push(filters.actionType);
            clauses.push(`action_type = $${values.length}`);
        }
        if (filters.resolved !== undefined) {
            clauses.push(filters.resolved ? `resolved_at IS NOT NULL` : `resolved_at IS NULL`);
        }

        const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
        const result = await this.pool.query<AutoSafetyActionRow>(
            `SELECT id, strategy_key, scope_type, scope_id, action_type, trigger_reason, created_at, resolved_at, metadata
             FROM auto_safety_actions
             ${whereClause}
             ORDER BY created_at DESC, id DESC`,
            values
        );

        return result.rows.map(mapRow);
    }

    public async getAction(actionId: string): Promise<AutoSafetyAction> {
        const result = await this.pool.query<AutoSafetyActionRow>(
            `SELECT id, strategy_key, scope_type, scope_id, action_type, trigger_reason, created_at, resolved_at, metadata
             FROM auto_safety_actions
             WHERE id = $1
             LIMIT 1`,
            [actionId]
        );
        const row = result.rows[0];
        if (!row) {
            throw new QualificationSafetyActionNotFoundError(actionId);
        }
        return mapRow(row);
    }

    public async resolveAction(
        actionId: string,
        resolutionReason: string,
        resolvedBy: string
    ): Promise<{ action: AutoSafetyAction; controlPlaneNote: string }> {
        if (resolutionReason.trim().length === 0) {
            throw new QualificationSafetyActionResolveError("resolutionReason must be a non-empty string.");
        }
        if (resolvedBy.trim().length === 0) {
            throw new QualificationSafetyActionResolveError("resolvedBy must be a non-empty string.");
        }

        const existing = await this.getAction(actionId);
        if (existing.resolvedAt) {
            throw new QualificationSafetyActionResolveError(
                `Qualification safety action ${actionId} is already resolved.`
            );
        }

        try {
            const action = await this.autoSafetyActionEngine.resolveAction(actionId, {
                resolutionReason,
                resolvedBy
            });
            this.logger?.info?.(
                { actionId, resolutionReason, resolvedBy, actionType: action.actionType },
                "Resolved qualification safety action."
            );
            return {
                action,
                controlPlaneNote: "Resolution records the audit action only. Inspect control-plane shard/bucket state and overrides separately; no automatic rollback is performed."
            };
        } catch (error) {
            if (error instanceof Error && error.name === "AutoSafetyActionEngineError") {
                throw new QualificationSafetyActionResolveError(error.message);
            }
            throw error;
        }
    }
}
