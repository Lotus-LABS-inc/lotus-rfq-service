import type { ExecutionIntent } from "../execution/execution-intent.js";
import type { ExecutionRecord } from "../execution/execution-record.js";
import type { ExecutionScopeBinding } from "./execution-scope-token.js";

export const executionControlStatuses = [
    "BLOCKED",
    "AWAITING_APPROVAL",
    "READY_FOR_SUBMISSION",
    "SUBMITTED",
    "SYNC_PENDING",
    "RECONCILING",
    "FAILED"
] as const;

export type ExecutionControlStatus = (typeof executionControlStatuses)[number];

export const executionControlNextActions = [
    "BLOCK",
    "REQUEST_APPROVAL",
    "SUBMIT",
    "REGENERATE_ROUTE",
    "RECONCILE",
    "RETRY_SAFE",
    "MARK_FAILED"
] as const;

export type ExecutionControlNextAction = (typeof executionControlNextActions)[number];

export const executionApprovalStatuses = [
    "NOT_REQUIRED",
    "REQUIRED",
    "AWAITING_APPROVAL",
    "APPROVED",
    "STALE",
    "MISMATCHED",
    "BLOCKED"
] as const;

export type ExecutionApprovalStatus = (typeof executionApprovalStatuses)[number];

export const executionFreshnessStatuses = [
    "FRESH",
    "STALE_ROUTE",
    "STALE_QUOTE",
    "STALE_MARKET_STATE",
    "STALE_COMPATIBILITY",
    "STALE_APPROVAL",
    "TIMING_CONSTRAINT_BLOCKED"
] as const;

export type ExecutionFreshnessStatus = (typeof executionFreshnessStatuses)[number];

export const executionPolicyStatuses = [
    "ALLOWED",
    "ROUTE_TYPE_FORBIDDEN",
    "VENUE_FORBIDDEN",
    "COMPATIBILITY_FORBIDDEN",
    "SETTLEMENT_POLICY_FORBIDDEN",
    "KILL_SWITCH_ACTIVE",
    "ACCOUNT_RESTRICTED",
    "SCOPE_RESTRICTED",
    "ROLLOUT_RESTRICTED",
    "MISSING_COMPATIBILITY_BASIS"
] as const;

export type ExecutionPolicyStatus = (typeof executionPolicyStatuses)[number];

export const executionIdempotencyStatuses = [
    "ALLOCATED",
    "REUSED",
    "CONFLICT",
    "MISMATCHED"
] as const;

export type ExecutionIdempotencyStatus = (typeof executionIdempotencyStatuses)[number];

export const executionReplayProtectionStatuses = [
    "CLEAR",
    "BLOCKED_DUPLICATE",
    "BLOCKED_STALE_APPROVAL",
    "BLOCKED_SUPERSEDED_ROUTE",
    "RECONCILE_REQUIRED",
    "UNSAFE_RETRY_BLOCKED"
] as const;

export type ExecutionReplayProtectionStatus = (typeof executionReplayProtectionStatuses)[number];

export const executionControlReasonCodes = [
    "ROUTE_TYPE_NOT_ALLOWED",
    "VENUE_NOT_ALLOWED",
    "COMPATIBILITY_CLASS_NOT_ALLOWED",
    "SETTLEMENT_POLICY_BLOCKED",
    "KILL_SWITCH_ACTIVE",
    "USER_ACCOUNT_RESTRICTED",
    "SCOPE_RESTRICTED",
    "ROLLOUT_RESTRICTED",
    "ROUTE_PLAN_STALE",
    "QUOTE_STALE",
    "MARKET_STATE_STALE",
    "COMPATIBILITY_STALE",
    "APPROVAL_REQUIRED",
    "APPROVAL_STALE",
    "APPROVAL_MISMATCH",
    "IDEMPOTENCY_CONFLICT",
    "REPLAY_DUPLICATE_ATTEMPT",
    "SUPERSEDED_ROUTE_PLAN",
    "UNCERTAIN_SUBMISSION_STATE",
    "SAFE_RETRY_NOT_ALLOWED",
    "MISSING_COMPATIBILITY_BASIS",
    "INTERNAL_ERROR"
] as const;

export type ExecutionControlReasonCode = (typeof executionControlReasonCodes)[number];

export const executionSubmissionKinds = [
    "INTERNAL_CROSS",
    "SOR_PLAN",
    "LEGACY_RFQ",
    "COMBO_EXTERNAL_PLAN",
    "COMBO_INTERNAL_CLEARING"
] as const;

export type ExecutionSubmissionKind = (typeof executionSubmissionKinds)[number];

export interface ExecutionRouteFreshnessMetadata {
    routeGeneratedAt: Date;
    quoteObservedAt?: Date | null;
    quoteValidUntil?: Date | null;
    marketStateObservedAt?: Date | null;
    compatibilityEvaluatedAt?: Date | null;
    approvalGrantedAt?: Date | null;
    maxRouteAgeMs: number;
    maxQuoteAgeMs?: number | null;
    maxMarketStateAgeMs?: number | null;
    maxCompatibilityAgeMs?: number | null;
    maxApprovalAgeMs?: number | null;
}

export interface ExecutionCompatibilityReferences {
    decisionIds: readonly string[];
    versionIds: readonly string[];
    compatibilityClass?: string | null;
}

export interface ExecutionApprovalRequirement {
    required: boolean;
    approvalBindingHash?: string | null;
    approvalGrantedAt?: Date | null;
    approvalContextVersion?: string | null;
    approvalActorRef?: string | null;
}

export interface ExecutionPolicyContext {
    routeTypeAllowed: boolean;
    venuesAllowed: boolean;
    compatibilityAllowed: boolean;
    settlementAllowed: boolean;
    killSwitchActive: boolean;
    accountAllowed: boolean;
    scopeAllowed: boolean;
    rolloutAllowed: boolean;
}

export interface ExecutionUserWalletReference {
    principalId: string;
    walletRef?: string | null;
}

export interface ExecutionControlRequest {
    routePlanId: string | null;
    canonicalEventId: string | null;
    canonicalExecutableMarketId: string;
    venueTargets: readonly string[];
    userWalletReference: ExecutionUserWalletReference;
    requestedSize?: string | null;
    requestedNotional?: string | null;
    configVersion: string;
    engineVersion: string;
    routeFreshnessMetadata: ExecutionRouteFreshnessMetadata;
    compatibilityReferences: ExecutionCompatibilityReferences;
    approvalRequirements: ExecutionApprovalRequirement;
    idempotencyKey?: string | null;
    routeType: string;
    routeSelectionTraceId?: string | null;
    replayEnvelopeId?: string | null;
    submissionKind: ExecutionSubmissionKind;
    submissionPayload: Readonly<Record<string, unknown>>;
    executionScopeBinding?: ExecutionScopeBinding | null;
    policyContext: ExecutionPolicyContext;
    metadata?: Readonly<Record<string, unknown>>;
}

export interface ExecutionControlDecision {
    allowed: boolean;
    blockReasonCodes: readonly ExecutionControlReasonCode[];
    warningCodes: readonly ExecutionControlReasonCode[];
    freshnessStatus: ExecutionFreshnessStatus;
    policyStatus: ExecutionPolicyStatus;
    approvalStatus: ExecutionApprovalStatus;
    idempotencyStatus: ExecutionIdempotencyStatus;
    replayProtectionStatus: ExecutionReplayProtectionStatus;
    nextAction: ExecutionControlNextAction;
}

export interface ExecutionControlOutcome {
    status: ExecutionControlStatus;
    executionIntentId: string | null;
    executionRecordId: string | null;
    rationale: readonly ExecutionControlReasonCode[];
    auditRef: string;
    idempotencyKey: string;
    replayProtectionRef: string | null;
}

export interface ExecutionControlEvaluationContext {
    request: ExecutionControlRequest;
    approvalStatus: ExecutionApprovalStatus;
    freshnessStatus: ExecutionFreshnessStatus;
    policyStatus: ExecutionPolicyStatus;
    idempotencyStatus: ExecutionIdempotencyStatus;
    replayProtectionStatus: ExecutionReplayProtectionStatus;
    blockReasonCodes: readonly ExecutionControlReasonCode[];
    warningCodes: readonly ExecutionControlReasonCode[];
}

export interface ExecutionControlPersistenceIds {
    decisionId: string;
    replayProtectionRecordId: string | null;
}

export interface ExecutionControlContext {
    intent: ExecutionIntent;
    record: ExecutionRecord;
    auditRef: string;
    idempotencyKey: string;
    replayProtectionRef: string | null;
}
