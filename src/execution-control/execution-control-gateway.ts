import type { Logger } from "pino";

import { ExecutionControlRepository } from "../repositories/execution-control.repository.js";
import { ExecutionAuditWriter } from "./execution-audit-writer.js";
import type { ExecutionAuditContext } from "./execution-audit-writer.js";
import { ExecutionApprovalGate } from "./execution-approval-gate.js";
import { ExecutionFailSafeHandler } from "./execution-fail-safe-handler.js";
import { ExecutionFreshnessGuard } from "./execution-freshness-guard.js";
import { ExecutionIdempotencyService } from "./execution-idempotency-service.js";
import { ExecutionPolicyValidator } from "./execution-policy-validator.js";
import { ExecutionReplayProtector } from "./execution-replay-protector.js";
import { ExecutionSubmissionOrchestrator } from "./execution-submission-orchestrator.js";
import { withLatencyStage, withLatencyStageSync } from "../observability/latency.js";
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
        const policyResult = withLatencyStageSync("execution_policy_validation", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.policyValidator.validate(request));
        const freshnessResult = withLatencyStageSync("execution_freshness_validation", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.freshnessGuard.evaluate(request));
        const approvalResult = withLatencyStageSync("execution_approval_lookup", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.approvalGate.evaluate(request));
        const idempotencyResult = await withLatencyStage("execution_idempotency_reserve", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.idempotencyService.reserve(request));
        const replayResult = await withLatencyStage("execution_replay_protection", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.replayProtector.evaluate({
            request,
            idempotencyKey: idempotencyResult.idempotencyKey,
            approvalBindingHash: approvalResult.bindingHash
        }));

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

        const audit = await withLatencyStage("execution_control_audit_initialize", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.auditWriter.initialize({
            request,
            idempotencyKey: idempotencyResult.idempotencyKey,
            approvalState: approvalResult.status,
            providerExecutionKey: `${request.submissionKind}:${request.routePlanId ?? request.canonicalExecutableMarketId}`,
            executionVenue:
                request.venueTargets.length > 1 ? "MULTI_VENUE" : request.venueTargets[0] ?? request.submissionKind,
            metadata: {
                controlSubmissionKind: request.submissionKind
            }
        }));

        await withLatencyStage("execution_control_idempotency_attach", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.idempotencyService.attachIntent(idempotencyResult.idempotencyKey, {
            executionIntentId: audit.intent.id,
            routePlanId: request.routePlanId,
            principalId: request.userWalletReference.principalId,
            walletRef: request.userWalletReference.walletRef ?? null,
            venueTargets: request.venueTargets,
            requestedAction: request.routeType,
            bindingHash: approvalResult.bindingHash,
            status: idempotencyResult.status
        }));

        await withLatencyStage("execution_control_approval_state_upsert", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.executionControlRepository.upsertApprovalState({
            executionIntentId: audit.intent.id,
            approvalStatus: approvalResult.status,
            approvalBindingHash: approvalResult.bindingHash,
            approvalGrantedAt: request.approvalRequirements.approvalGrantedAt ?? null,
            approvalActorRef: request.approvalRequirements.approvalActorRef ?? null,
            approvalContextVersion: request.approvalRequirements.approvalContextVersion ?? null,
            payload: {
                required: request.approvalRequirements.required
            }
        }));

        const replayProtectionRef =
            replayResult.recordId ??
            (await withLatencyStage("execution_control_replay_record_write", {
                canonicalMarketId: request.canonicalExecutableMarketId,
                routeType: request.routeType
            }, () => this.deps.replayProtector.record({
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
            })));

        const auditRef = await withLatencyStage("execution_control_gateway_audit_write", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.executionControlRepository.createAuditRecord({
            executionIntentId: audit.intent.id,
            executionRecordId: audit.getRecord().id,
            routePlanId: request.routePlanId,
            idempotencyKey: idempotencyResult.idempotencyKey,
            eventType: "EXECUTION_CONTROL_GATEWAY_EVALUATED",
            actorIdentity: request.userWalletReference.principalId,
            payload: {
                decision
            }
        }));

        await withLatencyStage("execution_control_decision_write", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => this.deps.executionControlRepository.createDecision({
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
        }));

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

        await withLatencyStage("execution_control_pre_submission_audit", {
            canonicalMarketId: request.canonicalExecutableMarketId,
            routeType: request.routeType
        }, () => transitionAuditMany(audit, [
            {
                nextState: "CHECKED",
                reason: "execution_control_checks_passed"
            },
            {
                nextState: "QUOTED",
                reason: "execution_control_quote_bound"
            }
        ]));
        if (approvalResult.status === "APPROVED" || approvalResult.status === "NOT_REQUIRED") {
            await withLatencyStage("execution_control_pre_submission_audit", {
                canonicalMarketId: request.canonicalExecutableMarketId,
                routeType: request.routeType
            }, () => audit.transition("APPROVED", "execution_control_approved"));
        }

        let result;
        try {
            result = await withLatencyStage("execution_submission_handoff", {
                canonicalMarketId: request.canonicalExecutableMarketId,
                routeType: request.routeType,
                external: request.submissionKind !== "INTERNAL_CROSS"
            }, () => this.deps.submissionOrchestrator.submit({
                request,
                audit,
                idempotencyKey: idempotencyResult.idempotencyKey
            }));
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
            const uncertainStatus = result.status;
            await withLatencyStage("execution_control_post_submission_audit", {
                canonicalMarketId: request.canonicalExecutableMarketId,
                routeType: request.routeType
            }, async () => {
            await audit.transition(uncertainStatus, "execution_submission_uncertain", {
                syncStatus: uncertainStatus === "SYNC_PENDING" ? "sync_pending" : "reconciling",
                metadata: resultMetadata,
                ...(result.payload ? { payload: result.payload } : {})
            });
            await audit.recordRecovery({
                localSyncFailed: uncertainStatus === "SYNC_PENDING",
                ...(result.duplicateRisk !== undefined ? { duplicateSubmissionRisk: result.duplicateRisk } : {})
            });
            });
        } else if (result.status === "FAILED") {
            await withLatencyStage("execution_control_post_submission_audit", {
                canonicalMarketId: request.canonicalExecutableMarketId,
                routeType: request.routeType
            }, async () => {
            await audit.transition("FAILED", "execution_submission_failed", {
                syncStatus: "synced",
                metadata: resultMetadata,
                ...(result.payload ? { payload: result.payload } : {})
            });
            await audit.recordRecovery(
                result.duplicateRisk !== undefined ? { duplicateSubmissionRisk: result.duplicateRisk } : {}
            );
            });
        } else {
            await withLatencyStage("execution_control_post_submission_audit", {
                canonicalMarketId: request.canonicalExecutableMarketId,
                routeType: request.routeType
            }, async () => {
                if (result.status === "PARTIAL") {
                    await transitionAuditMany(audit, [
                        {
                            nextState: "EXECUTING",
                            reason: "execution_submission_started",
                            metadata: resultMetadata,
                            ...(result.payload ? { payload: result.payload } : {})
                        },
                        {
                            nextState: "PARTIALLY_FILLED",
                            reason: "execution_submission_partial",
                            metadata: resultMetadata,
                            ...(result.payload ? { fillDetails: result.payload } : {})
                        }
                    ]);
                    await audit.recordRecovery();
                } else {
                    await transitionAuditMany(audit, [
                        {
                            nextState: "EXECUTING",
                            reason: "execution_submission_started",
                            metadata: resultMetadata,
                            ...(result.payload ? { payload: result.payload } : {})
                        },
                        {
                            nextState: "FILLED",
                            reason: "execution_submission_completed",
                            syncStatus: "synced",
                            metadata: resultMetadata,
                            ...(result.payload ? { fillDetails: result.payload } : {})
                        },
                        {
                            nextState: "SETTLED",
                            reason: "execution_submission_settled",
                            settlementStatus: "settled",
                            metadata: resultMetadata
                        }
                    ]);
                }
            });
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

type AuditTransitionBatch = Parameters<ExecutionAuditContext["transitionMany"]>[0];

const transitionAuditMany = async (
    audit: ExecutionAuditContext,
    transitions: AuditTransitionBatch
) => {
    if (typeof audit.transitionMany === "function") {
        return audit.transitionMany(transitions);
    }

    let record = audit.getRecord();
    for (const transition of transitions) {
        const { nextState, reason, ...options } = transition;
        record = await audit.transition(nextState, reason, options);
    }
    return record;
};
