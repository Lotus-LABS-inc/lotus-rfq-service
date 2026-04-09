import type { Pool } from "pg";
import type { CreateExecutionRecordInput, ExecutionRecord } from "../execution/execution-record.js";

interface ExecutionRecordRow {
    id: string;
    execution_intent_id: string;
    venue: string;
    venue_execution_ref: string | null;
    execution_state: string;
    sync_status: string;
    settlement_status: string;
    fill_details: Record<string, unknown>;
    retry_lineage: Record<string, unknown>[];
    provider_execution_key: string | null;
    replay_envelope_id: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}

export class ExecutionRecordRepository {
    public constructor(private readonly pool: Pool) {}

    public async create(input: CreateExecutionRecordInput): Promise<ExecutionRecord> {
        const result = await this.pool.query<ExecutionRecordRow>(
            `INSERT INTO execution_records (
                execution_intent_id,
                venue,
                venue_execution_ref,
                execution_state,
                sync_status,
                settlement_status,
                fill_details,
                retry_lineage,
                provider_execution_key,
                replay_envelope_id,
                metadata
            ) VALUES (
                $1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::uuid, $11::jsonb
            )
            ON CONFLICT (venue, provider_execution_key) DO UPDATE SET
                execution_state = EXCLUDED.execution_state,
                sync_status = EXCLUDED.sync_status,
                settlement_status = EXCLUDED.settlement_status,
                fill_details = EXCLUDED.fill_details,
                retry_lineage = EXCLUDED.retry_lineage,
                replay_envelope_id = EXCLUDED.replay_envelope_id,
                metadata = EXCLUDED.metadata,
                updated_at = now()
            RETURNING *`,
            [
                input.executionIntentId,
                input.venue,
                input.venueExecutionRef ?? null,
                input.executionState,
                input.syncStatus,
                input.settlementStatus,
                JSON.stringify(input.fillDetails ?? {}),
                JSON.stringify(input.retryLineage ?? []),
                input.providerExecutionKey ?? null,
                input.replayEnvelopeId ?? null,
                JSON.stringify(input.metadata ?? {})
            ]
        );
        return mapExecutionRecordRow(result.rows[0]!);
    }

    public async findById(id: string): Promise<ExecutionRecord | null> {
        const result = await this.pool.query<ExecutionRecordRow>(
            `SELECT * FROM execution_records WHERE id = $1::uuid`,
            [id]
        );
        return result.rows[0] ? mapExecutionRecordRow(result.rows[0]) : null;
    }

    public async list(limit = 100): Promise<ExecutionRecord[]> {
        const result = await this.pool.query<ExecutionRecordRow>(
            `SELECT * FROM execution_records ORDER BY created_at DESC LIMIT $1`,
            [limit]
        );
        return result.rows.map(mapExecutionRecordRow);
    }

    public async appendStateTransition(
        executionRecordId: string,
        fromState: string | null,
        toState: string,
        transitionMetadata: Record<string, unknown>,
        replayEnvelopeId?: string | null
    ): Promise<void> {
        await this.pool.query(
            `INSERT INTO execution_state_transitions (
                execution_record_id,
                from_state,
                to_state,
                transition_metadata,
                replay_envelope_id
            ) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid)`,
            [
                executionRecordId,
                fromState,
                toState,
                JSON.stringify(transitionMetadata),
                replayEnvelopeId ?? null
            ]
        );
    }
}

const mapExecutionRecordRow = (row: ExecutionRecordRow): ExecutionRecord => ({
    id: row.id,
    executionIntentId: row.execution_intent_id,
    venue: row.venue,
    venueExecutionRef: row.venue_execution_ref,
    executionState: row.execution_state as ExecutionRecord["executionState"],
    syncStatus: row.sync_status,
    settlementStatus: row.settlement_status,
    fillDetails: row.fill_details,
    retryLineage: row.retry_lineage,
    providerExecutionKey: row.provider_execution_key,
    replayEnvelopeId: row.replay_envelope_id,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
});
