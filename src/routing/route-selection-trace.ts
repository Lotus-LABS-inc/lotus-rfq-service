import type { Pool } from "pg";

export interface CreateRouteSelectionTraceInput {
    rfqId: string;
    routePlanId?: string | null;
    replayEnvelopeId?: string | null;
    selectedCandidateId?: string | null;
    selectedRouteRationale?: Record<string, unknown>;
    candidateOrdering?: readonly string[];
    compatibilityDecisionIds?: readonly string[];
    compatibilityVersionIds?: readonly string[];
}

export class RouteSelectionTraceWriter {
    public constructor(private readonly pool: Pool) {}

    public async create(input: CreateRouteSelectionTraceInput): Promise<string> {
        const result = await this.pool.query<{ id: string }>(
            `INSERT INTO route_selection_traces (
                rfq_id,
                route_plan_id,
                replay_envelope_id,
                selected_candidate_id,
                selected_route_rationale,
                candidate_ordering,
                compatibility_decision_ids,
                compatibility_version_ids
            ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb
            )
            RETURNING id`,
            [
                input.rfqId,
                input.routePlanId ?? null,
                input.replayEnvelopeId ?? null,
                input.selectedCandidateId ?? null,
                JSON.stringify(input.selectedRouteRationale ?? {}),
                JSON.stringify(input.candidateOrdering ?? []),
                JSON.stringify(input.compatibilityDecisionIds ?? []),
                JSON.stringify(input.compatibilityVersionIds ?? [])
            ]
        );
        return result.rows[0]!.id;
    }

    public async appendCandidate(
        routeSelectionTraceId: string,
        candidateId: string,
        candidatePayload: Record<string, unknown>,
        feasibilityStatus: string
    ): Promise<void> {
        await this.pool.query(
            `INSERT INTO route_candidate_sets (
                route_selection_trace_id,
                candidate_id,
                candidate_payload,
                feasibility_status
            ) VALUES ($1::uuid, $2::uuid, $3::jsonb, $4)`,
            [routeSelectionTraceId, candidateId, JSON.stringify(candidatePayload), feasibilityStatus]
        );
    }

    public async appendRejectionReason(
        routeSelectionTraceId: string,
        candidateId: string | null,
        reasonCode: string,
        reasonPayload: Record<string, unknown>
    ): Promise<void> {
        await this.pool.query(
            `INSERT INTO route_rejection_reasons (
                route_selection_trace_id,
                candidate_id,
                reason_code,
                reason_payload
            ) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)`,
            [routeSelectionTraceId, candidateId, reasonCode, JSON.stringify(reasonPayload)]
        );
    }
}
