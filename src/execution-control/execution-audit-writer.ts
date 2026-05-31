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

interface ExecutionTransitionOptions {
    payload?: Record<string, unknown>;
    syncStatus?: string;
    settlementStatus?: string;
    fillDetails?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

interface ExecutionTransitionRequest extends ExecutionTransitionOptions {
    nextState: ExecutionState;
    reason: string;
}

export interface ExecutionAuditContext {
    intent: ExecutionIntent;
    getRecord: () => ExecutionRecord;
    transition: (
        nextState: ExecutionState,
        reason: string,
        options?: ExecutionTransitionOptions
    ) => Promise<ExecutionRecord>;
    transitionMany: (transitions: readonly ExecutionTransitionRequest[]) => Promise<ExecutionRecord>;
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

        const writeTransitionEvidence = async (events: readonly {
            fromState: ExecutionState | null;
            toState: ExecutionState;
            reason: string;
            payload?: Record<string, unknown>;
        }[]): Promise<void> => {
            await this.executionRecordRepository.appendStateTransitions(
                events.map((event) => ({
                    executionRecordId: record.id,
                    fromState: event.fromState,
                    toState: event.toState,
                    transitionMetadata: {
                        reason: event.reason,
                        ...(event.payload ? { payload: event.payload } : {})
                    },
                    replayEnvelopeId: record.replayEnvelopeId
                }))
            );

            await this.executionControlRepository.createAuditRecords(
                events.map((event) => ({
                    executionIntentId: intent.id,
                    executionRecordId: record.id,
                    routePlanId: request.routePlanId,
                    idempotencyKey: input.idempotencyKey,
                    eventType: "EXECUTION_CONTROL_STATE_TRANSITION",
                    actorIdentity: request.userWalletReference.principalId,
                    payload: {
                        fromState: event.fromState,
                        toState: event.toState,
                        reason: event.reason,
                        ...(event.payload ? { transitionPayload: event.payload } : {})
                    }
                }))
            );
        };

        const transitionMany = async (
            transitions: readonly ExecutionTransitionRequest[]
        ): Promise<ExecutionRecord> => {
            if (transitions.length === 0) {
                return record;
            }

            const transitionEvents = transitions.map((transitionRequest) => {
                const fromState = stateMachine.getState();
                stateMachine.transitionTo(transitionRequest.nextState, {
                    reason: transitionRequest.reason,
                    ...(transitionRequest.payload ? { payload: transitionRequest.payload } : {})
                });
                return {
                    fromState,
                    toState: transitionRequest.nextState,
                    reason: transitionRequest.reason,
                    ...(transitionRequest.payload ? { payload: transitionRequest.payload } : {}),
                    options: transitionRequest
                };
            });

            const finalTransition = transitions[transitions.length - 1]!;
            const finalMetadata = transitions.reduce<Record<string, unknown>>(
                (acc, transitionRequest) => ({
                    ...acc,
                    ...(transitionRequest.metadata ?? {})
                }),
                record.metadata as Record<string, unknown>
            );
            const finalFillDetails =
                [...transitions].reverse().find((transitionRequest) => transitionRequest.fillDetails !== undefined)
                    ?.fillDetails ?? record.fillDetails;

            record = await this.executionRecordRepository.create({
                executionIntentId: intent.id,
                venue: record.venue,
                venueExecutionRef: record.venueExecutionRef,
                executionState: finalTransition.nextState,
                syncStatus: finalTransition.syncStatus ?? record.syncStatus,
                settlementStatus: finalTransition.settlementStatus ?? record.settlementStatus,
                fillDetails: finalFillDetails,
                retryLineage: record.retryLineage,
                providerExecutionKey: record.providerExecutionKey,
                replayEnvelopeId: record.replayEnvelopeId,
                metadata: finalMetadata
            });

            await writeTransitionEvidence(transitionEvents);

            return record;
        };

        const transition = async (
            nextState: ExecutionState,
            reason: string,
            options: ExecutionTransitionOptions = {}
        ): Promise<ExecutionRecord> => transitionMany([{ nextState, reason, ...options }]);

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

        const createdFromState = stateMachine.getState();
        const createdPayload = { submissionKind: request.submissionKind };
        stateMachine.transitionTo("CREATED", {
            reason: "execution_control_intent_created",
            payload: createdPayload
        });
        await writeTransitionEvidence([{
            fromState: createdFromState,
            toState: "CREATED",
            reason: "execution_control_intent_created",
            payload: createdPayload
        }]);

        return {
            intent,
            getRecord: () => record,
            transition,
            transitionMany,
            recordRecovery
        };
    }
}
