import type { ExecutionRecord } from "./execution-record.js";

export interface SyncRecoveryResult {
    shouldRetry: boolean;
    reason: string;
}

export const evaluateSyncRecovery = (record: ExecutionRecord): SyncRecoveryResult => {
    if (record.executionState !== "SYNC_PENDING") {
        return {
            shouldRetry: false,
            reason: "not_sync_pending"
        };
    }
    return {
        shouldRetry: true,
        reason: "sync_pending_retry_allowed"
    };
};
