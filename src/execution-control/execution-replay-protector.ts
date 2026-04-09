import { ExecutionControlRepository } from "../repositories/execution-control.repository.js";
import type {
    ExecutionControlReasonCode,
    ExecutionControlRequest,
    ExecutionReplayProtectionStatus
} from "./execution-control-types.js";

export interface ExecutionReplayProtectionResult {
    status: ExecutionReplayProtectionStatus;
    blockReasonCodes: readonly ExecutionControlReasonCode[];
    recordId: string | null;
}

export class ExecutionReplayProtector {
    public constructor(private readonly repository: ExecutionControlRepository) {}

    public async evaluate(input: {
        request: ExecutionControlRequest;
        idempotencyKey: string;
        approvalBindingHash: string;
    }): Promise<ExecutionReplayProtectionResult> {
        const records = await this.repository.listReplayProtectionByIdempotencyKey(input.idempotencyKey);
        const latest = records[0];
        if (!latest) {
            return {
                status: "CLEAR",
                blockReasonCodes: [],
                recordId: null
            };
        }

        if (latest.protectionStatus === "RECONCILE_REQUIRED" || latest.protectionStatus === "UNSAFE_RETRY_BLOCKED") {
            return {
                status: "RECONCILE_REQUIRED",
                blockReasonCodes: ["UNCERTAIN_SUBMISSION_STATE"],
                recordId: latest.id
            };
        }

        if (latest.protectionStatus === "BLOCKED_STALE_APPROVAL") {
            return {
                status: "BLOCKED_STALE_APPROVAL",
                blockReasonCodes: ["APPROVAL_STALE"],
                recordId: latest.id
            };
        }

        if (latest.protectionStatus === "BLOCKED_SUPERSEDED_ROUTE") {
            return {
                status: "BLOCKED_SUPERSEDED_ROUTE",
                blockReasonCodes: ["SUPERSEDED_ROUTE_PLAN"],
                recordId: latest.id
            };
        }

        if (latest.protectionStatus === "BLOCKED_DUPLICATE") {
            return {
                status: "BLOCKED_DUPLICATE",
                blockReasonCodes: ["REPLAY_DUPLICATE_ATTEMPT"],
                recordId: latest.id
            };
        }

        return {
            status: "CLEAR",
            blockReasonCodes: [],
            recordId: latest.id
        };
    }

    public async record(input: {
        executionIntentId?: string | null;
        executionRecordId?: string | null;
        routePlanId?: string | null;
        idempotencyKey: string;
        approvalBindingHash?: string | null;
        providerExecutionKey?: string | null;
        protectionStatus: ExecutionReplayProtectionStatus;
        payload?: Record<string, unknown>;
    }): Promise<string> {
        return this.repository.createReplayProtectionRecord(input);
    }
}
