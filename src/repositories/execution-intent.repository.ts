import type { Pool } from "pg";
import type { ExecutionIntent, CreateExecutionIntentInput } from "../execution/execution-intent.js";

interface ExecutionIntentRow {
    id: string;
    request_key: string;
    route_plan_id: string | null;
    route_selection_trace_id: string | null;
    initiating_principal: string;
    requested_action: string;
    requested_notional: string | null;
    requested_size: string | null;
    route_type: string;
    approval_state: string;
    intended_venues: string[];
    compatibility_decision_ids: string[];
    compatibility_version_ids: string[];
    replay_envelope_id: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}

export class ExecutionIntentRepository {
    public constructor(private readonly pool: Pool) {}

    public async create(input: CreateExecutionIntentInput): Promise<ExecutionIntent> {
        const result = await this.pool.query<ExecutionIntentRow>(
            `INSERT INTO execution_intents (
                request_key,
                route_plan_id,
                route_selection_trace_id,
                initiating_principal,
                requested_action,
                requested_notional,
                requested_size,
                route_type,
                approval_state,
                intended_venues,
                compatibility_decision_ids,
                compatibility_version_ids,
                replay_envelope_id,
                metadata
            ) VALUES (
                $1, $2::uuid, $3::uuid, $4, $5, $6::numeric, $7::numeric, $8, $9,
                $10::jsonb, $11::jsonb, $12::jsonb, $13::uuid, $14::jsonb
            )
            ON CONFLICT (request_key) DO UPDATE SET
                updated_at = now()
            RETURNING *`,
            [
                input.requestKey,
                input.routePlanId ?? null,
                input.routeSelectionTraceId ?? null,
                input.initiatingPrincipal,
                input.requestedAction,
                input.requestedNotional ?? null,
                input.requestedSize ?? null,
                input.routeType,
                input.approvalState,
                JSON.stringify(input.intendedVenues),
                JSON.stringify(input.compatibilityDecisionIds ?? []),
                JSON.stringify(input.compatibilityVersionIds ?? []),
                input.replayEnvelopeId ?? null,
                JSON.stringify(input.metadata ?? {})
            ]
        );
        return mapExecutionIntentRow(result.rows[0]!);
    }
}

const mapExecutionIntentRow = (row: ExecutionIntentRow): ExecutionIntent => ({
    id: row.id,
    requestKey: row.request_key,
    routePlanId: row.route_plan_id,
    routeSelectionTraceId: row.route_selection_trace_id,
    initiatingPrincipal: row.initiating_principal,
    requestedAction: row.requested_action,
    requestedNotional: row.requested_notional,
    requestedSize: row.requested_size,
    routeType: row.route_type,
    approvalState: row.approval_state,
    intendedVenues: row.intended_venues,
    compatibilityDecisionIds: row.compatibility_decision_ids,
    compatibilityVersionIds: row.compatibility_version_ids,
    replayEnvelopeId: row.replay_envelope_id,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
});
