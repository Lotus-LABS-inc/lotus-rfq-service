import type {
    ExecutionControlReasonCode,
    ExecutionControlRequest,
    ExecutionPolicyStatus
} from "./execution-control-types.js";

export interface ExecutionPolicyValidationResult {
    status: ExecutionPolicyStatus;
    allowed: boolean;
    blockReasonCodes: readonly ExecutionControlReasonCode[];
    warningCodes: readonly ExecutionControlReasonCode[];
}

export class ExecutionPolicyValidator {
    public validate(request: ExecutionControlRequest): ExecutionPolicyValidationResult {
        const blockReasonCodes: ExecutionControlReasonCode[] = [];

        if (!request.policyContext.routeTypeAllowed) {
            blockReasonCodes.push("ROUTE_TYPE_NOT_ALLOWED");
        }
        if (!request.policyContext.venuesAllowed) {
            blockReasonCodes.push("VENUE_NOT_ALLOWED");
        }
        if (!request.policyContext.compatibilityAllowed) {
            blockReasonCodes.push("COMPATIBILITY_CLASS_NOT_ALLOWED");
        }
        if (!request.policyContext.settlementAllowed) {
            blockReasonCodes.push("SETTLEMENT_POLICY_BLOCKED");
        }
        if (request.policyContext.killSwitchActive) {
            blockReasonCodes.push("KILL_SWITCH_ACTIVE");
        }
        if (!request.policyContext.accountAllowed) {
            blockReasonCodes.push("USER_ACCOUNT_RESTRICTED");
        }
        if (!request.policyContext.scopeAllowed) {
            blockReasonCodes.push("SCOPE_RESTRICTED");
        }
        if (!request.policyContext.rolloutAllowed) {
            blockReasonCodes.push("ROLLOUT_RESTRICTED");
        }
        const status = resolvePolicyStatus(blockReasonCodes);
        return {
            status,
            allowed: blockReasonCodes.length === 0,
            blockReasonCodes,
            warningCodes: []
        };
    }
}

const resolvePolicyStatus = (blockReasonCodes: readonly ExecutionControlReasonCode[]): ExecutionPolicyStatus => {
    if (blockReasonCodes.includes("KILL_SWITCH_ACTIVE")) {
        return "KILL_SWITCH_ACTIVE";
    }
    if (blockReasonCodes.includes("ROUTE_TYPE_NOT_ALLOWED")) {
        return "ROUTE_TYPE_FORBIDDEN";
    }
    if (blockReasonCodes.includes("VENUE_NOT_ALLOWED")) {
        return "VENUE_FORBIDDEN";
    }
    if (blockReasonCodes.includes("COMPATIBILITY_CLASS_NOT_ALLOWED")) {
        return "COMPATIBILITY_FORBIDDEN";
    }
    if (blockReasonCodes.includes("SETTLEMENT_POLICY_BLOCKED")) {
        return "SETTLEMENT_POLICY_FORBIDDEN";
    }
    if (blockReasonCodes.includes("USER_ACCOUNT_RESTRICTED")) {
        return "ACCOUNT_RESTRICTED";
    }
    if (blockReasonCodes.includes("SCOPE_RESTRICTED")) {
        return "SCOPE_RESTRICTED";
    }
    if (blockReasonCodes.includes("ROLLOUT_RESTRICTED")) {
        return "ROLLOUT_RESTRICTED";
    }
    if (blockReasonCodes.includes("MISSING_COMPATIBILITY_BASIS")) {
        return "MISSING_COMPATIBILITY_BASIS";
    }
    return "ALLOWED";
};
