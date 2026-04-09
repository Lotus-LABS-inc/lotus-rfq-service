import type { Logger } from "pino";

import { ExecutionIntentRepository } from "../repositories/execution-intent.repository.js";
import { ExecutionRecordRepository } from "../repositories/execution-record.repository.js";
import { ExecutionControlRepository } from "../repositories/execution-control.repository.js";
import { ExecutionStateMachine } from "../execution/execution-state-machine.js";
import type { ExecutionState } from "../execution/execution-state-types.js";
import type { ExecutionIntent } from "../execution/execution-intent.js";
import type { ExecutionRecord } from "../execution/execution-record.js";
import type { FailureRecoveryManager } from "../execution/failure-recovery-manager.js";
import type { ExecutionControlRequest } from "./execution-control-types.js";

export interface ExecutionAuditContext {
    intent: ExecutionIntent;
    getRecord: () => ExecutionRecord;
    transition: (
        nextState: ExecutionState,
        reason: string,
        options?: {
            payload?: Record<string, unknown>;
            syncStatus?: string;
            settlementStatus?: string;
            fillDetails?: Record<string, unknown>;
            metadata?: Record<string, unknown>;
        }
    ) => Promise<ExecutionRecord>;
    recordRecovery: (flags?: {
        quoteExpired?: boolean;
        localSyncFailed?: boolean;
        duplicateSubmissionRisk?: boolean;
    }) => Promise<void>;
}

export class ExecutionAuditWriter {
    public constructor(
        private readonly executionIntentRepository: ExecutionIntentRepository,
        private readonly executionRecordRepository: ExecutionRecordRepository,
        private readonly executionControlRepository: ExecutionControlRepository,
        private readonly failureRecoveryManager: FailureRecoveryManager,
        private readonly logger: Pick<Logger, "error">
    ) {}

    public async initialize(input: {
        request: ExecutionControlRequest;
        idempotencyKey: string;
        approvalState: string;
        providerExecutionKey: string;
        executionVenue: string;
        metadata?: Record<string, unknown>;
    }): Promise<ExecutionAuditContext> {
        const request = input.request;
        const intent = await this.executionIntentRepository.create({
            requestKey: input.idempotencyKey,
            routePlanId: request.routePlanId,
            routeSelectionTraceId: request.routeSelectionTraceId ?? null,
            initiatingPrincipal: request.userWalletReference.principalId,
            requestedAction: request.routeType,
            requestedNotional: request.requestedNotional ?? null,
            requestedSize: request.requestedSize ?? null,
            routeType: request.routeType,
            approvalState: input.approvalState,
            intendedVenues: request.venueTargets,
            compatibilityDecisionIds: request.compatibilityReferences.decisionIds,
            compatibilityVersionIds: request.compatibilityReferences.versionIds,
            replayEnvelopeId: request.replayEnvelopeId ?? null,
            metadata: {
                canonicalEventId: request.canonicalEventId,
                canonicalExecutableMarketId: request.canonicalExecutableMarketId,
                walletRef: request.userWalletReference.walletRef ?? null,
                configVersion: request.configVersion,
                engineVersion: request.engineVersion,
                submissionKind: request.submissionKind,
                executionScopeBinding: request.executionScopeBinding ?? null,
                ...(request.metadata ?? {}),
                ...(input.metadata ?? {})
            }
        });

        let record = await this.executionRecordRepository.create({
            executionIntentId: intent.id,
            venue: input.executionVenue,
            executionState: "CREATED",
            syncStatus: "pending",
            settlementStatus: "pending",
            providerExecutionKey: input.providerExecutionKey,
            replayEnvelopeId: request.replayEnvelopeId ?? null,
            metadata: {
                routePlanId: request.routePlanId,
                routeSelectionTraceId: request.routeSelectionTraceId ?? null,
                submissionKind: request.submissionKind,
                executionScopeBinding: request.executionScopeBinding ?? null,
                ...(input.metadata ?? {})
            }
        });

        await this.executionControlRepository.createAuditRecord({
            executionIntentId: intent.id,
            executionRecordId: record.id,
            routePlanId: request.routePlanId,
            idempotencyKey: input.idempotencyKey,
            eventType: "EXECUTION_CONTROL_INTENT_CREATED",
            actorIdentity: request.userWalletReference.principalId,
            payload: {
                submissionKind: request.submissionKind,
                routeType: request.routeType
            }
        });

        const stateMachine = new ExecutionStateMachine();

        const transition = async (
            nextState: ExecutionState,
            reason: string,
            options: {
                payload?: Record<string, unknown>;
                syncStatus?: string;
                settlementStatus?: string;
                fillDetails?: Record<string, unknown>;
                metadata?: Record<string, unknown>;
            } = {}
        ): Promise<ExecutionRecord> => {
            const fromState = stateMachine.getState();
            stateMachine.transitionTo(nextState, {
                reason,
                ...(options.payload ? { payload: options.payload } : {})
            });

            record = await this.executionRecordRepository.create({
                executionIntentId: intent.id,
                venue: record.venue,
                venueExecutionRef: record.venueExecutionRef,
                executionState: nextState,
                syncStatus: options.syncStatus ?? record.syncStatus,
                settlementStatus: options.settlementStatus ?? record.settlementStatus,
                fillDetails: options.fillDetails ?? record.fillDetails,
                retryLineage: record.retryLineage,
                providerExecutionKey: record.providerExecutionKey,
                replayEnvelopeId: record.replayEnvelopeId,
                metadata: {
                    ...(record.metadata as Record<string, unknown>),
                    ...(options.metadata ?? {})
                }
            });

            await this.executionRecordRepository.appendStateTransition(
                record.id,
                fromState,
                nextState,
                {
                    reason,
                    ...(options.payload ? { payload: options.payload } : {})
                },
                record.replayEnvelopeId
            );

            await this.executionControlRepository.createAuditRecord({
                executionIntentId: intent.id,
                executionRecordId: record.id,
                routePlanId: request.routePlanId,
                idempotencyKey: input.idempotencyKey,
                eventType: "EXECUTION_CONTROL_STATE_TRANSITION",
                actorIdentity: request.userWalletReference.principalId,
                payload: {
                    fromState,
                    toState: nextState,
                    reason,
                    ...(options.payload ? { transitionPayload: options.payload } : {})
                }
            });

            return record;
        };

        const recordRecovery = async (flags: {
            quoteExpired?: boolean;
            localSyncFailed?: boolean;
            duplicateSubmissionRisk?: boolean;
        } = {}): Promise<void> => {
            try {
                await this.failureRecoveryManager.recordRecoveryAction({
                    intent,
                    record,
                    replayEnvelopeId: request.replayEnvelopeId ?? null,
                    ...(flags.quoteExpired !== undefined ? { quoteExpired: flags.quoteExpired } : {}),
                    ...(flags.localSyncFailed !== undefined ? { localSyncFailed: flags.localSyncFailed } : {}),
                    ...(flags.duplicateSubmissionRisk !== undefined
                        ? { duplicateSubmissionRisk: flags.duplicateSubmissionRisk }
                        : {})
                });
            } catch (error) {
                this.logger.error({ err: error, executionIntentId: intent.id, executionRecordId: record.id }, "Failed to record recovery action.");
            }
        };

        await transition("CREATED", "execution_control_intent_created", {
            payload: {
                submissionKind: request.submissionKind
            }
        });

        return {
            intent,
            getRecord: () => record,
            transition,
            recordRecovery
        };
    }
}
