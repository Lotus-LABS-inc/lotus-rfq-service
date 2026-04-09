import { createHash } from "node:crypto";

import type {
    ExecutionApprovalStatus,
    ExecutionControlReasonCode,
    ExecutionControlRequest
} from "./execution-control-types.js";

export interface ExecutionApprovalResult {
    status: ExecutionApprovalStatus;
    blockReasonCodes: readonly ExecutionControlReasonCode[];
    bindingHash: string;
}

export class ExecutionApprovalGate {
    public evaluate(request: ExecutionControlRequest): ExecutionApprovalResult {
        const bindingHash = this.buildBindingHash(request);
        if (!request.approvalRequirements.required) {
            return {
                status: "NOT_REQUIRED",
                blockReasonCodes: [],
                bindingHash
            };
        }

        if (!request.approvalRequirements.approvalBindingHash) {
            return {
                status: "AWAITING_APPROVAL",
                blockReasonCodes: ["APPROVAL_REQUIRED"],
                bindingHash
            };
        }

        if (request.approvalRequirements.approvalBindingHash !== bindingHash) {
            return {
                status: "MISMATCHED",
                blockReasonCodes: ["APPROVAL_MISMATCH"],
                bindingHash
            };
        }

        if (!request.approvalRequirements.approvalGrantedAt) {
            return {
                status: "REQUIRED",
                blockReasonCodes: ["APPROVAL_REQUIRED"],
                bindingHash
            };
        }

        return {
            status: "APPROVED",
            blockReasonCodes: [],
            bindingHash
        };
    }

    public buildBindingHash(request: ExecutionControlRequest): string {
        return createHash("sha256")
            .update(
                JSON.stringify({
                    routePlanId: request.routePlanId,
                    canonicalExecutableMarketId: request.canonicalExecutableMarketId,
                    canonicalEventId: request.canonicalEventId,
                    userWalletReference: request.userWalletReference,
                    venueTargets: request.venueTargets,
                    requestedSize: request.requestedSize ?? null,
                    requestedNotional: request.requestedNotional ?? null,
                    configVersion: request.configVersion,
                    engineVersion: request.engineVersion,
                    submissionKind: request.submissionKind,
                    executionScopeBinding: request.executionScopeBinding ?? null
                })
            )
            .digest("hex");
    }
}
