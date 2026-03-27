import type { ExecutionState } from "./execution-state-types.js";

export interface ExecutionRecord {
    id: string;
    executionIntentId: string;
    venue: string;
    venueExecutionRef: string | null;
    executionState: ExecutionState;
    syncStatus: string;
    settlementStatus: string;
    fillDetails: Readonly<Record<string, unknown>>;
    retryLineage: readonly Record<string, unknown>[];
    providerExecutionKey: string | null;
    replayEnvelopeId: string | null;
    metadata: Readonly<Record<string, unknown>>;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateExecutionRecordInput {
    executionIntentId: string;
    venue: string;
    venueExecutionRef?: string | null;
    executionState: ExecutionState;
    syncStatus: string;
    settlementStatus: string;
    fillDetails?: Readonly<Record<string, unknown>>;
    retryLineage?: readonly Record<string, unknown>[];
    providerExecutionKey?: string | null;
    replayEnvelopeId?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
}
