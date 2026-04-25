import type { Logger } from "pino";

import { ExecutionControlRepository } from "../repositories/execution-control.repository.js";
import { ExecutionAuditWriter } from "./execution-audit-writer.js";
import { ExecutionApprovalGate } from "./execution-approval-gate.js";
import { ExecutionFailSafeHandler } from "./execution-fail-safe-handler.js";
import { ExecutionFreshnessGuard } from "./execution-freshness-guard.js";
import { ExecutionIdempotencyService } from "./execution-idempotency-service.js";
import { ExecutionPolicyValidator } from "./execution-policy-validator.js";
import { ExecutionReplayProtector } from "./execution-replay-protector.js";
import { ExecutionSubmissionOrchestrator } from "./execution-submission-orchestrator.js";
import type {
    ExecutionControlDecision,
    ExecutionControlOutcome,
    ExecutionControlRequest
} from "./execution-control-types.js";

export interface ExecutionControlGatewayDeps {
    policyValidator: ExecutionPolicyValidator;
    freshnessGuard: ExecutionFreshnessGuard;
    approvalGate: ExecutionApprovalGate;
    idempotencyService: ExecutionIdempotencyService;
    replayProtector: ExecutionReplayProtector;
    submissionOrchestrator: ExecutionSubmissionOrchestrator;
    failSafeHandler: ExecutionFailSafeHandler;
    auditWriter: ExecutionAuditWriter;
    executionControlRepository: ExecutionControlRepository;
    logger: Pick<Logger, "error">;
}

export class ExecutionControlGateway {
    public constructor(private readonly deps: ExecutionControlGatewayDeps) {}

    public async execute(request: ExecutionControlRequest): Promise<ExecutionControlOutcome> {
        const policyResult = this.deps.policyValidator.validate(request);
        const freshnessResult = this.deps.freshnessGuard.evaluate(request);
        const approvalResult = this.deps.approvalGate.evaluate(request);
        const idempotencyResult = await this.deps.idempotencyService.reserve(request);
        const replayResult = await this.deps.replayProtector.evaluate({
            request,
            idempotencyKey: idempotencyResult.idempotencyKey,
            approvalBindingHash: approvalResult.bindingHash
        });

        const decision = this.buildDecision({
            policyResult,
            freshnessResult,
            approvalResult,
            idempotencyResult,
            replayResult
        });

        const blockedByApproval = approvalResult.status === "AWAITING_APPROVAL" || approvalResult.status === "REQUIRED";
        const blocked =
            !decision.allowed ||
            freshnessResult.blockReasonCodes.length > 0 ||
            replayResult.blockReasonCodes.length > 0 ||
            idempotencyResult.status === "MISMATCHED";

        const audit = await this.deps.auditWriter.initialize({
            request,
            idempotencyKey: idempotencyResult.idempotencyKey,
            approvalState: approvalResult.status,
            providerExecutionKey: `${request.submissionKind}:${request.routePlanId ?? request.canonicalExecutableMarketId}`,
            executionVenue:
                request.venueTargets.length > 1 ? "MULTI_VENUE" : request.venueTargets[0] ?? request.submissionKind,
            metadata: {
                controlSubmissionKind: request.submissionKind
            }
        });

        await this.deps.idempotencyService.attachIntent(idempotencyResult.idempotencyKey, {
            executionIntentId: audit.intent.id,
            routePlanId: request.routePlanId,
            principalId: request.userWalletReference.principalId,
            walletRef: request.userWalletReference.walletRef ?? null,
            venueTargets: request.venueTargets,
            requestedAction: request.routeType,
            bindingHash: approvalResult.bindingHash,
            status: idempotencyResult.status
        });

        await this.deps.executionControlRepository.upsertApprovalState({
            executionIntentId: audit.intent.id,
            approvalStatus: approvalResult.status,
            approvalBindingHash: approvalResult.bindingHash,
            approvalGrantedAt: request.approvalRequirements.approvalGrantedAt ?? null,
            approvalActorRef: request.approvalRequirements.approvalActorRef ?? null,
            approvalContextVersion: request.approvalRequirements.approvalContextVersion ?? null,
            payload: {
                required: request.approvalRequirements.required
            }
        });

        const replayProtectionRef =
            replayResult.recordId ??
            (await this.deps.replayProtector.record({
                executionIntentId: audit.intent.id,
                executionRecordId: audit.getRecord().id,
                routePlanId: request.routePlanId,
                idempotencyKey: idempotencyResult.idempotencyKey,
                approvalBindingHash: approvalResult.bindingHash,
                providerExecutionKey: audit.getRecord().providerExecutionKey,
                protectionStatus: replayResult.status,
                payload: {
                    submissionKind: request.submissionKind
                }
            }));

        const auditRef = await this.deps.executionControlRepository.createAuditRecord({
            executionIntentId: audit.intent.id,
            executionRecordId: audit.getRecord().id,
            routePlanId: request.routePlanId,
            idempotencyKey: idempotencyResult.idempotencyKey,
            eventType: "EXECUTION_CONTROL_GATEWAY_EVALUATED",
            actorIdentity: request.userWalletReference.principalId,
            payload: {
                decision
            }
        });

        await this.deps.executionControlRepository.createDecision({
            executionIntentId: audit.intent.id,
            executionRecordId: audit.getRecord().id,
            routePlanId: request.routePlanId,
            routeSelectionTraceId: request.routeSelectionTraceId ?? null,
            canonicalEventId: request.canonicalEventId,
            canonicalExecutableMarketId: request.canonicalExecutableMarketId,
            userWalletRef: request.userWalletReference.walletRef ?? null,
            compatibilityDecisionIds: request.compatibilityReferences.decisionIds,
            compatibilityVersionIds: request.compatibilityReferences.versionIds,
            idempotencyKey: idempotencyResult.idempotencyKey,
            decision
        });

        if (blockedByApproval) {
            await audit.transition("AWAITING_APPROVAL", "execution_awaiting_approval");
            const failSafe = this.deps.failSafeHandler.awaitingApproval([
                ...approvalResult.blockReasonCodes
            ]);
            return {
                status: failSafe.status,
                executionIntentId: audit.intent.id,
                executionRecordId: audit.getRecord().id,
                rationale: failSafe.rationale,
                auditRef,
                idempotencyKey: idempotencyResult.idempotencyKey,
                replayProtectionRef
            };
        }

        if (blocked) {
            await audit.transition("FAILED", "execution_control_blocked", {
                payload: {
                    reasons: decision.blockReasonCodes
                },
                syncStatus: "blocked"
            });
            const failSafe = this.deps.failSafeHandler.block(decision.blockReasonCodes, decision.nextAction);
            return {
                status: failSafe.status,
                executionIntentId: audit.intent.id,
                executionRecordId: audit.getRecord().id,
                rationale: failSafe.rationale,
                auditRef,
                idempotencyKey: idempotencyResult.idempotencyKey,
                replayProtectionRef
            };
        }

        await audit.transition("CHECKED", "execution_control_checks_passed");
        await audit.transition("QUOTED", "execution_control_quote_bound");
        if (approvalResult.status === "APPROVED" || approvalResult.status === "NOT_REQUIRED") {
            await audit.transition("APPROVED", "execution_control_approved");
        }

        let result;
        try {
            result = await this.deps.submissionOrchestrator.submit({
                request,
                audit,
                idempotencyKey: idempotencyResult.idempotencyKey
            });
        } catch (error) {
            await audit.transition("SYNC_PENDING", "execution_submission_uncertain", {
                payload: {
                    error: error instanceof Error ? error.message : "unknown_error"
                },
                syncStatus: "sync_pending"
            });
            await audit.recordRecovery({ localSyncFailed: true });
            const failSafe = this.deps.failSafeHandler.mapSubmissionFailure({
                uncertain: true,
                reasons: ["UNCERTAIN_SUBMISSION_STATE"]
            });
            return {
                status: failSafe.status,
                executionIntentId: audit.intent.id,
                executionRecordId: audit.getRecord().id,
                rationale: failSafe.rationale,
                auditRef,
                idempotencyKey: idempotencyResult.idempotencyKey,
                replayProtectionRef
            };
        }

        const resultMetadata = result.payload?.executionSystemV0
            ? { executionSystemV0: result.payload.executionSystemV0 }
            : {};

        if (result.status === "SYNC_PENDING" || result.status === "RECONCILING") {
            await audit.transition(result.status, "execution_submission_uncertain", {
                syncStatus: result.status === "SYNC_PENDING" ? "sync_pending" : "reconciling",
                metadata: resultMetadata,
                ...(result.payload ? { payload: result.payload } : {})
            });
            await audit.recordRecovery({
                localSyncFailed: result.status === "SYNC_PENDING",
                ...(result.duplicateRisk !== undefined ? { duplicateSubmissionRisk: result.duplicateRisk } : {})
            });
        } else if (result.status === "FAILED") {
            await audit.transition("FAILED", "execution_submission_failed", {
                syncStatus: "synced",
                metadata: resultMetadata,
                ...(result.payload ? { payload: result.payload } : {})
            });
            await audit.recordRecovery(
                result.duplicateRisk !== undefined ? { duplicateSubmissionRisk: result.duplicateRisk } : {}
            );
        } else {
            await audit.transition("EXECUTING", "execution_submission_started", {
                metadata: resultMetadata,
                ...(result.payload ? { payload: result.payload } : {})
            });
            if (result.status === "PARTIAL") {
                await audit.transition("PARTIALLY_FILLED", "execution_submission_partial", {
                    metadata: resultMetadata,
                    ...(result.payload ? { fillDetails: result.payload } : {})
                });
                await audit.recordRecovery();
            } else {
                await audit.transition("FILLED", "execution_submission_completed", {
                    syncStatus: "synced",
                    metadata: resultMetadata,
                    ...(result.payload ? { fillDetails: result.payload } : {})
                });
                await audit.transition("SETTLED", "execution_submission_settled", {
                    settlementStatus: "settled",
                    metadata: resultMetadata
                });
            }
        }

        return {
            status: mapSubmissionStatus(result.status),
            executionIntentId: audit.intent.id,
            executionRecordId: audit.getRecord().id,
            rationale:
                result.status === "FAILED"
                    ? ["INTERNAL_ERROR"]
                    : decision.warningCodes,
            auditRef,
            idempotencyKey: idempotencyResult.idempotencyKey,
            replayProtectionRef
        };
    }

    private buildDecision(input: {
        policyResult: ReturnType<ExecutionPolicyValidator["validate"]>;
        freshnessResult: ReturnType<ExecutionFreshnessGuard["evaluate"]>;
        approvalResult: ReturnType<ExecutionApprovalGate["evaluate"]>;
        idempotencyResult: Awaited<ReturnType<ExecutionIdempotencyService["reserve"]>>;
        replayResult: Awaited<ReturnType<ExecutionReplayProtector["evaluate"]>>;
    }): ExecutionControlDecision {
        const blockReasonCodes = [
            ...input.policyResult.blockReasonCodes,
            ...input.freshnessResult.blockReasonCodes,
            ...input.approvalResult.blockReasonCodes,
            ...input.replayResult.blockReasonCodes,
            ...(input.idempotencyResult.status === "MISMATCHED" ? (["IDEMPOTENCY_CONFLICT"] as const) : [])
        ];

        const nextAction =
            input.approvalResult.status === "AWAITING_APPROVAL" || input.approvalResult.status === "REQUIRED"
                ? "REQUEST_APPROVAL"
                : input.freshnessResult.status === "STALE_ROUTE" ||
                    input.freshnessResult.status === "STALE_QUOTE" ||
                    input.freshnessResult.status === "STALE_MARKET_STATE" ||
                    input.freshnessResult.status === "STALE_COMPATIBILITY"
                  ? "REGENERATE_ROUTE"
                  : input.replayResult.status === "RECONCILE_REQUIRED"
                    ? "RECONCILE"
                    : blockReasonCodes.length > 0
                      ? "BLOCK"
                      : "SUBMIT";

        return {
            allowed:
                input.policyResult.allowed &&
                input.freshnessResult.fresh &&
                input.replayResult.blockReasonCodes.length === 0 &&
                input.idempotencyResult.status !== "MISMATCHED" &&
                input.approvalResult.status !== "MISMATCHED" &&
                input.approvalResult.status !== "STALE",
            blockReasonCodes,
            warningCodes: [
                ...input.policyResult.warningCodes
            ],
            freshnessStatus: input.freshnessResult.status,
            policyStatus: input.policyResult.status,
            approvalStatus: input.approvalResult.status,
            idempotencyStatus: input.idempotencyResult.status,
            replayProtectionStatus: input.replayResult.status,
            nextAction
        };
    }
}

const mapSubmissionStatus = (status: "SUBMITTED" | "COMPLETED" | "PARTIAL" | "FAILED" | "SYNC_PENDING" | "RECONCILING") => {
    switch (status) {
        case "SYNC_PENDING":
            return "SYNC_PENDING" as const;
        case "RECONCILING":
            return "RECONCILING" as const;
        case "FAILED":
            return "FAILED" as const;
        case "SUBMITTED":
        case "COMPLETED":
        case "PARTIAL":
            return "SUBMITTED" as const;
        default:
            return "FAILED" as const;
    }
};
