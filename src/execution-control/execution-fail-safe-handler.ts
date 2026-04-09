import type { ExecutionControlNextAction, ExecutionControlReasonCode, ExecutionControlStatus } from "./execution-control-types.js";

export interface ExecutionFailSafeResult {
    status: ExecutionControlStatus;
    rationale: readonly ExecutionControlReasonCode[];
    nextAction: ExecutionControlNextAction;
}

export class ExecutionFailSafeHandler {
    public block(reasons: readonly ExecutionControlReasonCode[], nextAction: ExecutionControlNextAction = "BLOCK"): ExecutionFailSafeResult {
        return {
            status: "BLOCKED",
            rationale: reasons,
            nextAction
        };
    }

    public awaitingApproval(reasons: readonly ExecutionControlReasonCode[]): ExecutionFailSafeResult {
        return {
            status: "AWAITING_APPROVAL",
            rationale: reasons,
            nextAction: "REQUEST_APPROVAL"
        };
    }

    public mapSubmissionFailure(input: {
        uncertain: boolean;
        duplicateRisk?: boolean;
        reasons: readonly ExecutionControlReasonCode[];
    }): ExecutionFailSafeResult {
        if (input.uncertain) {
            return {
                status: input.duplicateRisk ? "RECONCILING" : "SYNC_PENDING",
                rationale: input.reasons,
                nextAction: input.duplicateRisk ? "RECONCILE" : "RECONCILE"
            };
        }

        return {
            status: "FAILED",
            rationale: input.reasons,
            nextAction: input.duplicateRisk ? "RECONCILE" : "MARK_FAILED"
        };
    }
}
