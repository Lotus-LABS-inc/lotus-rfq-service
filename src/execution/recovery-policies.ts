import type { ExecutionRecord } from "./execution-record.js";
import type { ExecutionIntent } from "./execution-intent.js";

export type RecoveryActionType =
    | "await_manual_review"
    | "retry_sync"
    | "retry_execution"
    | "expire_quote"
    | "cleanup_reservation"
    | "revalidate_route";

export interface RecoveryPolicyResult {
    policyName: string;
    actionType: RecoveryActionType;
    safeToAutoApply: boolean;
    rationale: Readonly<Record<string, unknown>>;
}

export const selectRecoveryPolicy = (input: {
    intent: ExecutionIntent;
    record: ExecutionRecord;
    quoteExpired?: boolean;
    localSyncFailed?: boolean;
    duplicateSubmissionRisk?: boolean;
}): RecoveryPolicyResult => {
    if (input.duplicateSubmissionRisk) {
        return {
            policyName: "duplicate_submission_guard",
            actionType: "await_manual_review",
            safeToAutoApply: false,
            rationale: { reason: "duplicate_submission_risk" }
        };
    }
    if (input.localSyncFailed || input.record.executionState === "SYNC_PENDING") {
        return {
            policyName: "sync_recovery",
            actionType: "retry_sync",
            safeToAutoApply: true,
            rationale: { reason: "local_sync_failed" }
        };
    }
    if (input.quoteExpired) {
        return {
            policyName: "quote_expiry",
            actionType: "expire_quote",
            safeToAutoApply: true,
            rationale: { reason: "quote_expired" }
        };
    }
    if (input.record.executionState === "PARTIALLY_FILLED") {
        return {
            policyName: "partial_fill_revalidation",
            actionType: "revalidate_route",
            safeToAutoApply: false,
            rationale: { reason: "partial_fill_requires_revalidation" }
        };
    }
    return {
        policyName: "reservation_cleanup",
        actionType: "cleanup_reservation",
        safeToAutoApply: true,
        rationale: { reason: "default_cleanup" }
    };
};
