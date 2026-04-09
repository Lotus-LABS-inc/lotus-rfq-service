import type { Logger } from "pino";

import { ExecutionControlRepository } from "../repositories/execution-control.repository.js";
import type { ExecutionAuditContext } from "./execution-audit-writer.js";
import type { ExecutionControlRequest, ExecutionSubmissionKind } from "./execution-control-types.js";

export interface ExecutionSubmissionResult {
    status: "SUBMITTED" | "COMPLETED" | "PARTIAL" | "FAILED" | "SYNC_PENDING" | "RECONCILING";
    providerExecutionKey?: string | null;
    payload?: Record<string, unknown>;
    duplicateRisk?: boolean;
    uncertain?: boolean;
}

export interface ExecutionSubmissionHandler {
    execute(input: {
        request: ExecutionControlRequest;
        audit: ExecutionAuditContext;
        idempotencyKey: string;
    }): Promise<ExecutionSubmissionResult>;
}

export interface ExecutionSubmissionHandlers {
    INTERNAL_CROSS: ExecutionSubmissionHandler;
    SOR_PLAN: ExecutionSubmissionHandler;
    LEGACY_RFQ: ExecutionSubmissionHandler;
    COMBO_EXTERNAL_PLAN?: ExecutionSubmissionHandler;
    COMBO_INTERNAL_CLEARING?: ExecutionSubmissionHandler;
}

export class ExecutionSubmissionOrchestrator {
    public constructor(
        private readonly handlers: ExecutionSubmissionHandlers,
        private readonly executionControlRepository: ExecutionControlRepository,
        private readonly logger: Pick<Logger, "error">
    ) {}

    public async submit(input: {
        request: ExecutionControlRequest;
        audit: ExecutionAuditContext;
        idempotencyKey: string;
    }): Promise<ExecutionSubmissionResult> {
        const handler = this.resolveHandler(input.request.submissionKind);
        await this.executionControlRepository.createSubmissionLineage({
            executionIntentId: input.audit.intent.id,
            executionRecordId: input.audit.getRecord().id,
            routePlanId: input.request.routePlanId,
            submissionKind: input.request.submissionKind,
            providerExecutionKey: input.audit.getRecord().providerExecutionKey,
            lineagePayload: input.request.submissionPayload as Record<string, unknown>
        });

        return handler.execute(input);
    }

    private resolveHandler(kind: ExecutionSubmissionKind): ExecutionSubmissionHandler {
        const handler = this.handlers[kind];
        if (!handler) {
            this.logger.error({ submissionKind: kind }, "Missing execution submission handler.");
            throw new Error(`missing_execution_submission_handler:${kind}`);
        }
        return handler;
    }
}
