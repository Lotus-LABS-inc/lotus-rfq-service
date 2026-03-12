export type ExecutionMode =
    | "FULL_MODE"
    | "DISABLE_PHASE2B"
    | "DISABLE_PHASE2A_AND_2B"
    | "DISABLE_INTERNAL_CROSS"
    | "SOR_ONLY"
    | "SAFE_FALLBACK";

export interface ControlPlaneOverride {
    id: string;
    scopeType: string;
    scopeId: string;
    overrideType: string;
    payload: Record<string, unknown>;
    createdBy: string;
    createdAt: Date;
    expiresAt: Date | null;
}

export interface CreateControlPlaneOverrideInput {
    id?: string;
    scopeType: string;
    scopeId: string;
    overrideType: string;
    payload: Record<string, unknown>;
    createdBy: string;
    expiresAt?: Date | null;
}

export interface PlannerShardState {
    shardId: string;
    mode: string;
    activePlans: number;
    activeBuckets: number;
    staleReservations: number;
    avgPlannerLatencyMs: string | null;
    updatedAt: Date;
}

export interface UpsertPlannerShardStateInput {
    shardId: string;
    mode: string;
    activePlans: number;
    activeBuckets: number;
    staleReservations: number;
    avgPlannerLatencyMs?: string | number | null;
    updatedAt?: Date;
}

export interface BucketState {
    bucketId: string;
    bucketType: string;
    mode: string;
    entityCount: number;
    graphDensity: string | null;
    degradationReason: string | null;
    updatedAt: Date;
}

export interface UpsertBucketStateInput {
    bucketId: string;
    bucketType: string;
    mode: string;
    entityCount: number;
    graphDensity?: string | number | null;
    degradationReason?: string | null;
    updatedAt?: Date;
}

export interface ControlPlaneAuditEvent {
    id: string;
    eventType: string;
    scopeType: string;
    scopeId: string;
    engine: string | null;
    previousMode: string | null;
    newMode: string;
    reason: string;
    payload: Record<string, unknown>;
    createdBy: string;
    createdAt: Date;
}

export interface CreateControlPlaneAuditEventInput {
    id?: string;
    eventType: string;
    scopeType: string;
    scopeId: string;
    engine?: string | null;
    previousMode?: string | null;
    newMode: string;
    reason: string;
    payload: Record<string, unknown>;
    createdBy: string;
    createdAt?: Date;
}
