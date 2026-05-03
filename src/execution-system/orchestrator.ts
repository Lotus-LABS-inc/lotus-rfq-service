import { randomUUID } from "node:crypto";
import type { ExecutionScopeBinding } from "../execution-control/execution-scope-token.js";
import { AccountingUpdateService } from "./accounting.js";
import type { ExecutionAuditSink } from "./audit.js";
import { ExecutionFeeService } from "./fees.js";
import { FallbackPolicyService } from "./fallback.js";
import { GhostFillProtectionService } from "./ghost-fill.js";
import { ExecutionPreflightService } from "./preflight.js";
import { SettlementVerificationService } from "./settlement.js";
import { ExecutionStateMachineV0 } from "./state-machine.js";
import {
  isBuilderFeeCaptureEnabled,
  isShadowImprovementEnabled,
  type MonetizationPolicy
} from "./monetization-policy.js";
import type {
  ExecutionLegV0,
  ExecutionRequestV0,
  ExecutionResultV0,
  ExecutionStateV0,
  ExecutionSystemMetadataV0,
  GhostFillStatusV0,
  SettlementStatusV0
} from "./types.js";
import { validateExecutionRequest, zeroFees } from "./types.js";
import { ExecutionVenueAdapterRegistry } from "./venue-adapter.js";
import type { MonetizationRepository } from "../repositories/monetization.repository.js";
import type { VerifiedPositionRepository } from "./executable-routing.js";

export interface ExecutionSystemOrchestratorDeps {
  preflight: ExecutionPreflightService;
  adapters: ExecutionVenueAdapterRegistry;
  settlement: SettlementVerificationService;
  ghostFill: GhostFillProtectionService;
  fallback: FallbackPolicyService;
  accounting: AccountingUpdateService;
  fees: ExecutionFeeService;
  monetization?: {
    policy: MonetizationPolicy;
    repository: Pick<MonetizationRepository, "createLedgerEntry" | "upsertPolicy">;
    polymarketBuilderCodeConfigured?: boolean;
  };
  positions?: Pick<VerifiedPositionRepository, "applySettlementDelta">;
  audit: ExecutionAuditSink;
  now?: () => Date;
}

export interface ExecutionSystemContext {
  executionIntentId?: string | null;
  executionRecordId?: string | null;
  routePlanId?: string | null;
  actorIdentity?: string | null;
  scopeBinding?: ExecutionScopeBinding | null;
}

export class ExecutionSystemOrchestrator {
  private readonly now: () => Date;

  public constructor(private readonly deps: ExecutionSystemOrchestratorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  public async execute(rawRequest: unknown, context: ExecutionSystemContext = {}): Promise<{
    result: ExecutionResultV0;
    metadata: ExecutionSystemMetadataV0;
  }> {
    const request = validateExecutionRequest(rawRequest);
    const stateMachine = new ExecutionStateMachineV0();
    const auditEventIds: string[] = [];
    const legs = this.buildLegs(request);
    const settlementEvidenceByLegId = new Map<string, Record<string, unknown>>();
    let settlementStatus: SettlementStatusV0 = "SETTLEMENT_PENDING";
    let ghostFillStatus: GhostFillStatusV0 = "NOT_APPLICABLE";
    let fallbackUsed = false;
    let fallbackReason: string | undefined;
    let feeSummary = this.deps.fees.preview(request);

    const writeAudit = async (eventType: Parameters<ExecutionAuditSink["write"]>[0]["eventType"], payload: Record<string, unknown> = {}) => {
      const id = await this.deps.audit.write({
        eventType,
        executionIntentId: context.executionIntentId ?? null,
        executionRecordId: context.executionRecordId ?? null,
        routePlanId: context.routePlanId ?? null,
        idempotencyKey: request.idempotencyKey,
        actorIdentity: context.actorIdentity ?? request.userId,
        payload: {
          executionId: request.executionId,
          selectedLaneId: request.selectedLaneId,
          venuePath: request.venuePath,
          ...payload
        }
      });
      auditEventIds.push(id);
    };

    await writeAudit("EXECUTION_CREATED");
    stateMachine.transitionTo("PREFLIGHT_CHECKING");
    await writeAudit("PREFLIGHT_STARTED");

    if (this.deps.monetization &&
      isBuilderFeeCaptureEnabled(this.deps.monetization.policy) &&
      request.venuePath.some((venue) => venue.toUpperCase() === "POLYMARKET") &&
      this.deps.monetization.polymarketBuilderCodeConfigured === false) {
      stateMachine.transitionTo("PREFLIGHT_FAILED");
      await writeAudit("PREFLIGHT_FAILED", {
        code: "POLYMARKET_BUILDER_CODE_MISSING",
        reason: "Polymarket builder-fee monetization requires POLYMARKET_BUILDER_CODE."
      });
      stateMachine.transitionTo("FAILED_CLOSED");
      await writeAudit("FAILED_CLOSED", {
        code: "POLYMARKET_BUILDER_CODE_MISSING",
        reason: "Polymarket builder-fee monetization requires POLYMARKET_BUILDER_CODE."
      });
      return this.finish({
        request,
        state: stateMachine.current(),
        legs,
        settlementStatus,
        ghostFillStatus,
        fallbackUsed,
        fallbackReason,
        feeSummary,
        auditEventIds
      });
    }

    const preflight = await this.deps.preflight.evaluate({
      request,
      scopeBinding: context.scopeBinding ?? null
    });
    if (!preflight.ok) {
      stateMachine.transitionTo("PREFLIGHT_FAILED");
      await writeAudit("PREFLIGHT_FAILED", { code: preflight.code, reason: preflight.reason });
      stateMachine.transitionTo("FAILED_CLOSED");
      await writeAudit("FAILED_CLOSED", { code: preflight.code, reason: preflight.reason });
      return this.finish({
        request,
        state: stateMachine.current(),
        legs,
        settlementStatus,
        ghostFillStatus,
        fallbackUsed,
        fallbackReason,
        feeSummary,
        auditEventIds
      });
    }

    stateMachine.transitionTo("READY_TO_SUBMIT");
    await writeAudit("PREFLIGHT_PASSED");
    await writeAudit("ROUTE_SELECTED");
    await writeAudit("LIQUIDITY_RESERVED");

    for (const leg of legs) {
      const adapter = this.deps.adapters.get(leg.venue);
      try {
        const prepared = await adapter.prepareOrder(leg);
        const submitted = await adapter.submitOrder(prepared);
        leg.status = submitted.status === "PARTIAL_FILL" ? "PARTIAL_FILL" : submitted.status === "FILLED" ? "FILLED_PENDING_SETTLEMENT" : "SUBMITTED";
        leg.submittedAt = this.now().toISOString();
        leg.venueOrderId = submitted.venueOrderId;
        if (submitted.fillId) {
          leg.fillId = submitted.fillId;
        }
        await writeAudit("ORDER_SUBMITTED", { legId: leg.executionLegId, venue: leg.venue, venueOrderId: submitted.venueOrderId });
        if (stateMachine.current() === "READY_TO_SUBMIT") {
          stateMachine.transitionTo("SUBMITTED");
        }

        const fill = await adapter.fetchFillState(submitted.venueOrderId);
        if (fill.status === "PARTIAL_FILL") {
          leg.status = "PARTIAL_FILL";
          await writeAudit("PARTIAL_FILL_RECEIVED", { legId: leg.executionLegId });
          if (stateMachine.current() === "SUBMITTED") {
            stateMachine.transitionTo("PARTIAL_FILL");
          }
          return this.finish({ request, state: stateMachine.current(), legs, settlementStatus, ghostFillStatus, fallbackUsed, fallbackReason, feeSummary, auditEventIds });
        }
        if (fill.status === "FILLED") {
          leg.status = "FILLED_PENDING_SETTLEMENT";
          leg.filledAt = this.now().toISOString();
          await writeAudit("FILL_RECEIVED", { legId: leg.executionLegId });
          if (stateMachine.current() === "SUBMITTED" || stateMachine.current() === "PARTIAL_FILL") {
            stateMachine.transitionTo("FILLED_PENDING_SETTLEMENT");
          }
        }

        await writeAudit("SETTLEMENT_CHECK_STARTED", { legId: leg.executionLegId });
        const settlement = await this.deps.settlement.verify(leg);
        settlementEvidenceByLegId.set(leg.executionLegId, settlement.evidence);
        const ghost = this.deps.ghostFill.classify({
          leg,
          fillState: fill,
          settlementStatus: settlement.status,
          protectionEnabled: request.ghostFillProtectionEnabled
        });
        settlementStatus = ghost.settlementStatus;
        ghostFillStatus = ghost.status;
        leg.settlementStatus = settlementStatus;

        if (settlementStatus === "SETTLEMENT_VERIFIED") {
          leg.status = "SETTLEMENT_VERIFIED";
          await writeAudit("SETTLEMENT_VERIFIED", { legId: leg.executionLegId, evidence: settlement.evidence });
        } else if (settlementStatus === "GHOST_FILL_SUSPECTED") {
          stateMachine.transitionTo("GHOST_FILL_SUSPECTED");
          await writeAudit("GHOST_FILL_SUSPECTED", { legId: leg.executionLegId, reason: ghost.reason });
          const fallback = await this.deps.fallback.decide({ request, reason: ghost.reason ?? "ghost_fill_suspected" });
          if (fallback.action === "REROUTE") {
            fallbackUsed = true;
            fallbackReason = fallback.reason;
            stateMachine.transitionTo("REROUTING");
            await writeAudit("REROUTE_STARTED", { fallbackLaneId: fallback.fallbackLaneId });
            stateMachine.transitionTo("REROUTED");
            await writeAudit("REROUTE_COMPLETED", { fallbackLaneId: fallback.fallbackLaneId });
          } else {
            stateMachine.transitionTo("FAILED_CLOSED");
            await writeAudit("FAILED_CLOSED", { reason: fallback.reason });
            return this.finish({ request, state: stateMachine.current(), legs, settlementStatus, ghostFillStatus, fallbackUsed, fallbackReason, feeSummary, auditEventIds });
          }
        } else if (settlementStatus === "GHOST_FILL_CONFIRMED") {
          stateMachine.transitionTo("GHOST_FILL_CONFIRMED");
          await writeAudit("GHOST_FILL_CONFIRMED", { legId: leg.executionLegId });
          stateMachine.transitionTo("FAILED_CLOSED");
          await writeAudit("FAILED_CLOSED", { reason: "ghost_fill_confirmed" });
          return this.finish({ request, state: stateMachine.current(), legs, settlementStatus, ghostFillStatus, fallbackUsed, fallbackReason, feeSummary, auditEventIds });
        }
      } catch (error) {
        const normalized = adapter.normalizeVenueError(error);
        leg.status = "FAILED_CLOSED";
        leg.errorCode = normalized.code;
        if (stateMachine.current() === "READY_TO_SUBMIT") {
          stateMachine.transitionTo("FAILED_CLOSED");
        } else if (stateMachine.current() === "SUBMITTED" || stateMachine.current() === "PARTIAL_FILL" || stateMachine.current() === "FILLED_PENDING_SETTLEMENT") {
          stateMachine.transitionTo("FAILED_CLOSED");
        }
        await writeAudit("FAILED_CLOSED", { code: normalized.code, reason: normalized.message, legId: leg.executionLegId });
        return this.finish({ request, state: stateMachine.current(), legs, settlementStatus, ghostFillStatus, fallbackUsed, fallbackReason, feeSummary, auditEventIds });
      }
    }

    const allSettled = legs.every((leg) => leg.settlementStatus === "SETTLEMENT_VERIFIED");
    if (!allSettled) {
      if (stateMachine.current() !== "FAILED_CLOSED") {
        stateMachine.transitionTo("FAILED_CLOSED");
        await writeAudit("FAILED_CLOSED", { reason: "settlement_not_verified_for_all_legs" });
      }
      return this.finish({ request, state: stateMachine.current(), legs, settlementStatus, ghostFillStatus, fallbackUsed, fallbackReason, feeSummary, auditEventIds });
    }

    if (stateMachine.current() === "FILLED_PENDING_SETTLEMENT") {
      stateMachine.transitionTo("SETTLEMENT_VERIFIED");
    }
    const averagePrice = this.averagePrice(legs);
    feeSummary = this.deps.fees.realized({ request, realizedPrice: averagePrice });
    if (this.deps.monetization && this.deps.monetization.policy.captureMode !== "DISABLED") {
      const { policy, repository } = this.deps.monetization;
      await repository.upsertPolicy(policy);
      if (isShadowImprovementEnabled(policy)) {
        await repository.createLedgerEntry({
          idempotencyKey: `${request.executionId}:SHADOW_PRICE_IMPROVEMENT:${policy.policyVersion}`,
          executionId: request.executionId,
          rfqId: request.rfqId,
          quoteId: stringMetadata(request.metadata, "quoteId"),
          userId: request.userId,
          venue: request.venuePath.join("|"),
          laneId: request.selectedLaneId,
          feePolicyVersion: policy.policyVersion,
          feeType: "LOTUS_SHADOW_PRICE_IMPROVEMENT",
          status: "SHADOW_ONLY",
          amount: String(feeSummary.shadowImprovementFees ?? feeSummary.totalLotusFee ?? feeSummary.totalFees),
          currency: feeSummary.currency ?? policy.currency,
          captureMode: policy.captureMode,
          revenueSource: "SHADOW_PRICE_IMPROVEMENT",
          shadowImprovementFee: String(feeSummary.shadowImprovementFees ?? feeSummary.totalLotusFee ?? feeSummary.totalFees),
          uncollectedImprovementOpportunity: String(feeSummary.uncollectedImprovementOpportunity ?? feeSummary.totalLotusFee ?? feeSummary.totalFees),
          settlementStatus: "SETTLEMENT_VERIFIED",
          metadata: {
            feeSummary,
            executionMode: request.executionMode,
            capApplied: feeSummary.capApplied ?? false,
            disclosure: "Estimated Lotus improvement share, not collected."
          }
        });
      }
      const builderFeeRows = isBuilderFeeCaptureEnabled(policy)
        ? legs
            .filter((leg) => leg.venue.toUpperCase() === "POLYMARKET")
            .map((leg) => ({
              leg,
              amount: extractConfirmedBuilderFeeAmount(leg, settlementEvidenceByLegId.get(leg.executionLegId))
            }))
            .filter((entry): entry is { leg: ExecutionLegV0; amount: number } => entry.amount !== null && entry.amount > 0)
        : [];
      const actualBuilderFeesCollected = builderFeeRows.reduce((sum, entry) => sum + entry.amount, 0);
      if (actualBuilderFeesCollected > 0) {
        feeSummary = {
          ...feeSummary,
          actualBuilderFeesCollected,
          userFeeDisclosureLabel: "Lotus builder fee collected by venue where supported."
        };
      }
      for (const entry of builderFeeRows) {
        const amount = entry.amount.toFixed(8);
        await repository.createLedgerEntry({
          idempotencyKey: `${request.executionId}:POLYMARKET_BUILDER_FEE:${entry.leg.executionLegId}:${policy.policyVersion}`,
          executionId: request.executionId,
          rfqId: request.rfqId,
          quoteId: stringMetadata(request.metadata, "quoteId"),
          userId: request.userId,
          venue: entry.leg.venue,
          laneId: request.selectedLaneId,
          feePolicyVersion: policy.policyVersion,
          feeType: "LOTUS_BUILDER_FEE",
          status: "COLLECTED_BUILDER_FEE",
          amount,
          currency: feeSummary.currency ?? policy.currency,
          captureMode: policy.captureMode,
          revenueSource: "POLYMARKET_BUILDER_FEE",
          actualBuilderFeeCollected: amount,
          settlementStatus: "SETTLEMENT_VERIFIED",
          metadata: {
            executionMode: request.executionMode,
            builderFeeEvidenceConfirmed: true,
            disclosure: "Lotus builder fee collected by venue where supported."
          }
        });
      }
    }
    this.deps.accounting.buildPostSettlementUpdate({
      executionId: request.executionId,
      userId: request.userId,
      canonicalTopicKey: request.canonicalTopicKey,
      candidateId: request.candidateId ?? request.canonicalOutcomeId ?? "unknown",
      side: request.side,
      legs,
      fees: feeSummary
    });
    if (this.deps.positions?.applySettlementDelta) {
      for (const leg of legs.filter((entry) => entry.settlementStatus === "SETTLEMENT_VERIFIED")) {
        await this.deps.positions.applySettlementDelta({
          userId: request.userId,
          venue: leg.venue,
          marketId: request.canonicalTopicKey,
          outcomeId: leg.venueOutcomeId,
          venueAccountAddress: stringMetadata(request.metadata, `${leg.venue.toLowerCase()}VenueAccountAddress`),
          side: request.side,
          size: leg.size,
          averagePrice: leg.price,
          settlementEvidenceId: leg.fillId ?? leg.venueOrderId ?? null,
          metadata: {
            executionId: request.executionId,
            executionLegId: leg.executionLegId
          }
        });
      }
    }
    await writeAudit("ACCOUNTING_UPDATED");
    stateMachine.transitionTo("COMPLETED");
    await writeAudit("USER_RECEIPT_EMITTED");

    return this.finish({ request, state: stateMachine.current(), legs, settlementStatus: "SETTLEMENT_VERIFIED", ghostFillStatus: "CLEAR", fallbackUsed, fallbackReason, feeSummary, auditEventIds });
  }

  private buildLegs(request: ExecutionRequestV0): ExecutionLegV0[] {
    const routeLegs = Array.isArray(request.metadata?.routeLegs)
      ? request.metadata.routeLegs
      : [];
    if (routeLegs.length > 0) {
      return routeLegs.flatMap((rawLeg, index) => {
        if (typeof rawLeg !== "object" || rawLeg === null) {
          return [];
        }
        const leg = rawLeg as Record<string, unknown>;
        const venue = typeof leg.venue === "string" ? leg.venue : null;
        const size = typeof leg.size === "string" && /^\d+(\.\d+)?$/.test(leg.size) ? leg.size : null;
        if (!venue || !size) {
          return [];
        }
        return [{
          executionLegId: `${request.executionId}-leg-${index + 1}-${randomUUID()}`,
          parentExecutionId: request.executionId,
          venue,
          venueMarketId: typeof leg.venueMarketId === "string" && leg.venueMarketId.length > 0
            ? leg.venueMarketId
            : `${request.canonicalTopicKey}:${venue}`,
          venueOutcomeId: typeof leg.venueOutcomeId === "string" && leg.venueOutcomeId.length > 0
            ? leg.venueOutcomeId
            : request.candidateId ?? request.canonicalOutcomeId ?? "unknown",
          side: request.side,
          size,
          price: typeof leg.price === "number" && leg.price >= 0 ? leg.price : request.expectedPrice,
          status: "CREATED" as const,
          settlementStatus: "SETTLEMENT_PENDING" as const
        }];
      });
    }

    return request.venuePath.map((venue, index) => ({
      executionLegId: `${request.executionId}-leg-${index + 1}-${randomUUID()}`,
      parentExecutionId: request.executionId,
      venue,
      venueMarketId: `${request.canonicalTopicKey}:${venue}`,
      venueOutcomeId: request.candidateId ?? request.canonicalOutcomeId ?? "unknown",
      side: request.side,
      size: request.size,
      price: request.expectedPrice,
      status: "CREATED",
      settlementStatus: "SETTLEMENT_PENDING"
    }));
  }

  private finish(input: {
    request: ExecutionRequestV0;
    state: ExecutionStateV0;
    legs: readonly ExecutionLegV0[];
    settlementStatus: SettlementStatusV0;
    ghostFillStatus: GhostFillStatusV0;
    fallbackUsed: boolean;
    fallbackReason?: string | undefined;
    feeSummary?: ReturnType<typeof zeroFees>;
    auditEventIds: readonly string[];
  }): { result: ExecutionResultV0; metadata: ExecutionSystemMetadataV0 } {
    const averagePrice = this.averagePrice(input.legs);
    const filledSize = String(input.legs
      .filter((leg) => leg.settlementStatus === "SETTLEMENT_VERIFIED")
      .reduce((sum, leg) => sum + Number(leg.size), 0));
    const fees = input.feeSummary ?? zeroFees();
    const receipt = input.state === "COMPLETED"
      ? {
          executionId: input.request.executionId,
          userId: input.request.userId,
          state: input.state,
          filledSize,
          averagePrice,
          settlementStatus: input.settlementStatus,
          ghostFillStatus: input.ghostFillStatus,
          fees,
          emittedAt: this.now().toISOString()
        }
      : undefined;

    const result: ExecutionResultV0 = {
      executionId: input.request.executionId,
      finalState: input.state,
      filledSize,
      averagePrice,
      venueBreakdown: input.legs.map((leg) => ({
        venue: leg.venue,
        filledSize: leg.settlementStatus === "SETTLEMENT_VERIFIED" ? leg.size : "0",
        averagePrice: leg.price,
        settlementStatus: leg.settlementStatus
      })),
      settlementStatus: input.settlementStatus,
      ghostFillStatus: input.ghostFillStatus,
      fallbackUsed: input.fallbackUsed,
      fees,
      auditEventIds: [...input.auditEventIds],
      ...(receipt ? { receipt } : {})
    };

    const fallbackState = input.fallbackUsed
      ? "REROUTED"
      : input.state === "FAILED_CLOSED"
        ? "FAILED_CLOSED"
        : "NOT_USED";
    const metadata: ExecutionSystemMetadataV0 = {
      version: "execution-system-v0",
      executionId: input.request.executionId,
      rfqId: input.request.rfqId,
      userId: input.request.userId,
      canonicalTopicKey: input.request.canonicalTopicKey,
      ...(input.request.candidateId ? { candidateId: input.request.candidateId } : {}),
      ...(input.request.canonicalOutcomeId ? { canonicalOutcomeId: input.request.canonicalOutcomeId } : {}),
      side: input.request.side,
      size: input.request.size,
      selectedLaneId: input.request.selectedLaneId,
      venuePath: input.request.venuePath,
      executionMode: input.request.executionMode,
      approvedScopeHash: input.request.approvedScopeHash,
      maxSlippage: input.request.maxSlippage,
      fastLaneEnabled: input.request.fastLaneEnabled,
      ghostFillProtectionEnabled: input.request.ghostFillProtectionEnabled,
      expectedPrice: input.request.expectedPrice,
      expectedFees: input.request.expectedFees,
      idempotencyKey: input.request.idempotencyKey,
      executionState: input.state,
      settlementState: input.settlementStatus,
      ghostFillState: input.ghostFillStatus,
      fallbackState,
      executionRequest: input.request,
      currentState: input.state,
      legs: [...input.legs],
      settlementStatus: input.settlementStatus,
      ghostFillStatus: input.ghostFillStatus,
      fallbackUsed: input.fallbackUsed,
      ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
      feeSummary: fees,
      auditEventIds: [...input.auditEventIds],
      ...(receipt ? { receipt } : {}),
      updatedAt: this.now().toISOString()
    };
    return { result, metadata };
  }

  private averagePrice(legs: readonly ExecutionLegV0[]): number {
    const filled = legs.filter((leg) => leg.status === "SETTLEMENT_VERIFIED" || leg.status === "FILLED_PENDING_SETTLEMENT");
    if (filled.length === 0) {
      return 0;
    }
    return filled.reduce((sum, leg) => sum + leg.price, 0) / filled.length;
  }
}

const stringMetadata = (metadata: Readonly<Record<string, unknown>> | undefined, key: string): string | null => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const numericMetadata = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
};

const findNumericEvidence = (value: unknown, keys: readonly string[]): number | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const found = numericMetadata(record[key]);
    if (found !== null) {
      return found;
    }
  }
  for (const entry of Object.values(record)) {
    const found = findNumericEvidence(entry, keys);
    if (found !== null) {
      return found;
    }
  }
  return null;
};

const extractConfirmedBuilderFeeAmount = (
  leg: ExecutionLegV0,
  evidence: Record<string, unknown> | undefined
): number | null => {
  if (!evidence) {
    return null;
  }
  const directAmount = findNumericEvidence(evidence, [
    "builderFeeAmount",
    "builder_fee_amount",
    "builderFeeCollected",
    "builder_fee_collected",
    "builderFee",
    "builder_fee"
  ]);
  if (directAmount !== null) {
    return directAmount;
  }
  const feeBps = findNumericEvidence(evidence, [
    "builderFeeBps",
    "builder_fee_bps",
    "builderFeeRateBps",
    "builder_fee_rate_bps",
    "tbf",
    "mbf"
  ]);
  if (feeBps === null) {
    return null;
  }
  return Number(leg.size) * leg.price * feeBps / 10_000;
};
