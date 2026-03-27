import type { Pool } from "pg";
import type { ExecutionIntent } from "./execution-intent.js";
import type { ExecutionRecord } from "./execution-record.js";
import { selectRecoveryPolicy, type RecoveryPolicyResult } from "./recovery-policies.js";

export class FailureRecoveryManager {
    public constructor(private readonly pool: Pool) {}

    public async recordRecoveryAction(input: {
        intent: ExecutionIntent;
        record: ExecutionRecord;
        replayEnvelopeId?: string | null;
        quoteExpired?: boolean;
        localSyncFailed?: boolean;
        duplicateSubmissionRisk?: boolean;
    }): Promise<RecoveryPolicyResult> {
        const policy = selectRecoveryPolicy({
            intent: input.intent,
            record: input.record,
            ...(input.quoteExpired !== undefined ? { quoteExpired: input.quoteExpired } : {}),
            ...(input.localSyncFailed !== undefined ? { localSyncFailed: input.localSyncFailed } : {}),
            ...(input.duplicateSubmissionRisk !== undefined ? { duplicateSubmissionRisk: input.duplicateSubmissionRisk } : {})
        });

        await this.pool.query(
            `INSERT INTO execution_recovery_actions (
                execution_intent_id,
                execution_record_id,
                policy_name,
                action_type,
                action_status,
                rationale,
                replay_envelope_id
            ) VALUES (
                $1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::uuid
            )`,
            [
                input.intent.id,
                input.record.id,
                policy.policyName,
                policy.actionType,
                policy.safeToAutoApply ? "proposed" : "manual_review_required",
                JSON.stringify(policy.rationale),
                input.replayEnvelopeId ?? null
            ]
        );

        return policy;
    }
}
