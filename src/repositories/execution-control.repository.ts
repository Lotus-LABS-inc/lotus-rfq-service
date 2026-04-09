import type { Pool } from "pg";

import type {
    ExecutionApprovalStatus,
    ExecutionControlDecision,
    ExecutionControlReasonCode,
    ExecutionIdempotencyStatus,
    ExecutionReplayProtectionStatus
} from "../execution-control/execution-control-types.js";

export interface ExecutionControlDecisionRecord {
    id: string;
    executionIntentId: string | null;
    executionRecordId: string | null;
    routePlanId: string | null;
    idempotencyKey: string;
    decision: ExecutionControlDecision;
    createdAt: Date;
}

export interface ExecutionControlAuditRecord {
    id: string;
    executionIntentId: string | null;
    executionRecordId: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    actorIdentity: string | null;
    createdAt: Date;
}

export class ExecutionControlRepository {
    public constructor(private readonly pool: Pool) {}

    public async createDecision(input: {
        executionIntentId?: string | null;
        executionRecordId?: string | null;
        routePlanId?: string | null;
        routeSelectionTraceId?: string | null;
        canonicalEventId?: string | null;
        canonicalExecutableMarketId: string;
        userWalletRef?: string | null;
        compatibilityDecisionIds: readonly string[];
        compatibilityVersionIds: readonly string[];
        idempotencyKey: string;
        decision: ExecutionControlDecision;
        metadata?: Record<string, unknown>;
    }): Promise<string> {
        const result = await this.pool.query<{ id: string }>(
            `INSERT INTO execution_control_decisions (
                execution_intent_id,
                execution_record_id,
                route_plan_id,
                route_selection_trace_id,
                canonical_event_id,
                canonical_executable_market_id,
                user_wallet_ref,
                compatibility_decision_ids,
                compatibility_version_ids,
                idempotency_key,
                allowed,
                block_reason_codes,
                warning_codes,
                freshness_status,
                policy_status,
                approval_status,
                idempotency_status,
                replay_protection_status,
                next_action,
                metadata
            ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7,
                $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19, $20::jsonb
            )
            RETURNING id`,
            [
                input.executionIntentId ?? null,
                input.executionRecordId ?? null,
                input.routePlanId ?? null,
                input.routeSelectionTraceId ?? null,
                input.canonicalEventId ?? null,
                input.canonicalExecutableMarketId,
                input.userWalletRef ?? null,
                JSON.stringify(input.compatibilityDecisionIds),
                JSON.stringify(input.compatibilityVersionIds),
                input.idempotencyKey,
                input.decision.allowed,
                JSON.stringify(input.decision.blockReasonCodes),
                JSON.stringify(input.decision.warningCodes),
                input.decision.freshnessStatus,
                input.decision.policyStatus,
                input.decision.approvalStatus,
                input.decision.idempotencyStatus,
                input.decision.replayProtectionStatus,
                input.decision.nextAction,
                JSON.stringify(input.metadata ?? {})
            ]
        );

        return result.rows[0]!.id;
    }

    public async upsertApprovalState(input: {
        executionIntentId: string;
        approvalStatus: ExecutionApprovalStatus;
        approvalBindingHash?: string | null;
        approvalGrantedAt?: Date | null;
        approvalActorRef?: string | null;
        approvalContextVersion?: string | null;
        payload?: Record<string, unknown>;
    }): Promise<void> {
        await this.pool.query(
            `INSERT INTO execution_approval_states (
                execution_intent_id,
                approval_status,
                approval_binding_hash,
                approval_granted_at,
                approval_actor_ref,
                approval_context_version,
                payload
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)
            ON CONFLICT (execution_intent_id) DO UPDATE SET
                approval_status = EXCLUDED.approval_status,
                approval_binding_hash = EXCLUDED.approval_binding_hash,
                approval_granted_at = EXCLUDED.approval_granted_at,
                approval_actor_ref = EXCLUDED.approval_actor_ref,
                approval_context_version = EXCLUDED.approval_context_version,
                payload = EXCLUDED.payload,
                updated_at = now()`,
            [
                input.executionIntentId,
                input.approvalStatus,
                input.approvalBindingHash ?? null,
                input.approvalGrantedAt ?? null,
                input.approvalActorRef ?? null,
                input.approvalContextVersion ?? null,
                JSON.stringify(input.payload ?? {})
            ]
        );
    }

    public async findIdempotencyKey(key: string): Promise<{
        id: string;
        executionIntentId: string | null;
        routePlanId: string | null;
        principalId: string;
        walletRef: string | null;
        venueTargets: string[];
        requestedAction: string;
        bindingHash: string;
        lastStatus: ExecutionIdempotencyStatus;
    } | null> {
        const result = await this.pool.query<{
            id: string;
            execution_intent_id: string | null;
            route_plan_id: string | null;
            principal_id: string;
            wallet_ref: string | null;
            venue_targets: string[];
            requested_action: string;
            binding_hash: string;
            last_status: ExecutionIdempotencyStatus;
        }>(
            `SELECT id, execution_intent_id, route_plan_id, principal_id, wallet_ref, venue_targets,
                    requested_action, binding_hash, last_status
               FROM execution_idempotency_keys
              WHERE idempotency_key = $1`,
            [key]
        );

        const row = result.rows[0];
        if (!row) {
            return null;
        }

        return {
            id: row.id,
            executionIntentId: row.execution_intent_id,
            routePlanId: row.route_plan_id,
            principalId: row.principal_id,
            walletRef: row.wallet_ref,
            venueTargets: row.venue_targets,
            requestedAction: row.requested_action,
            bindingHash: row.binding_hash,
            lastStatus: row.last_status
        };
    }

    public async upsertIdempotencyKey(input: {
        idempotencyKey: string;
        executionIntentId?: string | null;
        routePlanId?: string | null;
        principalId: string;
        walletRef?: string | null;
        venueTargets: readonly string[];
        requestedAction: string;
        bindingHash: string;
        lastStatus: ExecutionIdempotencyStatus;
    }): Promise<void> {
        await this.pool.query(
            `INSERT INTO execution_idempotency_keys (
                idempotency_key,
                execution_intent_id,
                route_plan_id,
                principal_id,
                wallet_ref,
                venue_targets,
                requested_action,
                binding_hash,
                last_status
            ) VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7, $8, $9)
            ON CONFLICT (idempotency_key) DO UPDATE SET
                execution_intent_id = COALESCE(EXCLUDED.execution_intent_id, execution_idempotency_keys.execution_intent_id),
                route_plan_id = COALESCE(EXCLUDED.route_plan_id, execution_idempotency_keys.route_plan_id),
                last_status = EXCLUDED.last_status,
                updated_at = now()`,
            [
                input.idempotencyKey,
                input.executionIntentId ?? null,
                input.routePlanId ?? null,
                input.principalId,
                input.walletRef ?? null,
                JSON.stringify(input.venueTargets),
                input.requestedAction,
                input.bindingHash,
                input.lastStatus
            ]
        );
    }

    public async createReplayProtectionRecord(input: {
        executionIntentId?: string | null;
        executionRecordId?: string | null;
        routePlanId?: string | null;
        idempotencyKey: string;
        approvalBindingHash?: string | null;
        providerExecutionKey?: string | null;
        protectionStatus: ExecutionReplayProtectionStatus;
        payload?: Record<string, unknown>;
    }): Promise<string> {
        const result = await this.pool.query<{ id: string }>(
            `INSERT INTO execution_replay_protection_records (
                execution_intent_id,
                execution_record_id,
                route_plan_id,
                idempotency_key,
                approval_binding_hash,
                provider_execution_key,
                protection_status,
                payload
            ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb
            )
            RETURNING id`,
            [
                input.executionIntentId ?? null,
                input.executionRecordId ?? null,
                input.routePlanId ?? null,
                input.idempotencyKey,
                input.approvalBindingHash ?? null,
                input.providerExecutionKey ?? null,
                input.protectionStatus,
                JSON.stringify(input.payload ?? {})
            ]
        );

        return result.rows[0]!.id;
    }

    public async listReplayProtectionByIdempotencyKey(idempotencyKey: string): Promise<
        Array<{
            id: string;
            protectionStatus: ExecutionReplayProtectionStatus;
            payload: Record<string, unknown>;
        }>
    > {
        const result = await this.pool.query<{
            id: string;
            protection_status: ExecutionReplayProtectionStatus;
            payload: Record<string, unknown>;
        }>(
            `SELECT id, protection_status, payload
               FROM execution_replay_protection_records
              WHERE idempotency_key = $1
              ORDER BY created_at DESC`,
            [idempotencyKey]
        );

        return result.rows.map((row) => ({
            id: row.id,
            protectionStatus: row.protection_status,
            payload: row.payload
        }));
    }

    public async createSubmissionLineage(input: {
        executionIntentId: string;
        executionRecordId: string;
        routePlanId?: string | null;
        submissionKind: string;
        providerExecutionKey?: string | null;
        lineagePayload?: Record<string, unknown>;
    }): Promise<void> {
        await this.pool.query(
            `INSERT INTO execution_submission_lineage (
                execution_intent_id,
                execution_record_id,
                route_plan_id,
                submission_kind,
                provider_execution_key,
                lineage_payload
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)`,
            [
                input.executionIntentId,
                input.executionRecordId,
                input.routePlanId ?? null,
                input.submissionKind,
                input.providerExecutionKey ?? null,
                JSON.stringify(input.lineagePayload ?? {})
            ]
        );
    }

    public async createAuditRecord(input: {
        executionIntentId?: string | null;
        executionRecordId?: string | null;
        routePlanId?: string | null;
        idempotencyKey?: string | null;
        eventType: string;
        actorIdentity?: string | null;
        payload?: Record<string, unknown>;
    }): Promise<string> {
        const result = await this.pool.query<{ id: string }>(
            `INSERT INTO execution_control_audit_records (
                execution_intent_id,
                execution_record_id,
                route_plan_id,
                idempotency_key,
                event_type,
                actor_identity,
                payload
            ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb
            )
            RETURNING id`,
            [
                input.executionIntentId ?? null,
                input.executionRecordId ?? null,
                input.routePlanId ?? null,
                input.idempotencyKey ?? null,
                input.eventType,
                input.actorIdentity ?? null,
                JSON.stringify(input.payload ?? {})
            ]
        );

        return result.rows[0]!.id;
    }

    public async listControlAuditByRecord(recordId: string): Promise<ExecutionControlAuditRecord[]> {
        const result = await this.pool.query<{
            id: string;
            execution_intent_id: string | null;
            execution_record_id: string | null;
            event_type: string;
            payload: Record<string, unknown>;
            actor_identity: string | null;
            created_at: Date;
        }>(
            `SELECT id, execution_intent_id, execution_record_id, event_type, payload, actor_identity, created_at
               FROM execution_control_audit_records
              WHERE execution_record_id = $1::uuid
              ORDER BY created_at DESC`,
            [recordId]
        );

        return result.rows.map((row) => ({
            id: row.id,
            executionIntentId: row.execution_intent_id,
            executionRecordId: row.execution_record_id,
            eventType: row.event_type,
            payload: row.payload,
            actorIdentity: row.actor_identity,
            createdAt: new Date(row.created_at)
        }));
    }

    public async listDecisions(limit = 100): Promise<ExecutionControlDecisionRecord[]> {
        const result = await this.pool.query<{
            id: string;
            execution_intent_id: string | null;
            execution_record_id: string | null;
            route_plan_id: string | null;
            idempotency_key: string;
            allowed: boolean;
            block_reason_codes: ExecutionControlReasonCode[];
            warning_codes: ExecutionControlReasonCode[];
            freshness_status: ExecutionControlDecision["freshnessStatus"];
            policy_status: ExecutionControlDecision["policyStatus"];
            approval_status: ExecutionControlDecision["approvalStatus"];
            idempotency_status: ExecutionControlDecision["idempotencyStatus"];
            replay_protection_status: ExecutionControlDecision["replayProtectionStatus"];
            next_action: ExecutionControlDecision["nextAction"];
            created_at: Date;
        }>(
            `SELECT id, execution_intent_id, execution_record_id, route_plan_id, idempotency_key, allowed,
                    block_reason_codes, warning_codes, freshness_status, policy_status, approval_status,
                    idempotency_status, replay_protection_status, next_action, created_at
               FROM execution_control_decisions
              ORDER BY created_at DESC
              LIMIT $1`,
            [limit]
        );

        return result.rows.map((row) => ({
            id: row.id,
            executionIntentId: row.execution_intent_id,
            executionRecordId: row.execution_record_id,
            routePlanId: row.route_plan_id,
            idempotencyKey: row.idempotency_key,
            decision: {
                allowed: row.allowed,
                blockReasonCodes: row.block_reason_codes,
                warningCodes: row.warning_codes,
                freshnessStatus: row.freshness_status,
                policyStatus: row.policy_status,
                approvalStatus: row.approval_status,
                idempotencyStatus: row.idempotency_status,
                replayProtectionStatus: row.replay_protection_status,
                nextAction: row.next_action
            },
            createdAt: new Date(row.created_at)
        }));
    }
}
