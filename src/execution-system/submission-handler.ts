import type { ExecutionSubmissionHandler, ExecutionSubmissionResult } from "../execution-control/execution-submission-orchestrator.js";
import type { ExecutionRequestV0 } from "./types.js";
import { zeroFees } from "./types.js";
import type { ExecutionSystemOrchestrator } from "./orchestrator.js";

const executionModeForVenuePath = (venuePath: readonly string[]): ExecutionRequestV0["executionMode"] => {
  if (venuePath.length === 1) return "SINGLE_VENUE";
  if (venuePath.length === 2) return "PAIR";
  if (venuePath.length === 3) return "TRI";
  return "SPLIT";
};

const stringMetadata = (metadata: Readonly<Record<string, unknown>> | undefined, key: string): string | null => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractRouteLegs = (payload: Readonly<Record<string, unknown>>): readonly Record<string, unknown>[] => {
  const plan = payload.plan;
  if (!isRecord(plan) || !Array.isArray(plan.steps)) {
    return [];
  }

  return plan.steps
    .filter(isRecord)
    .map((step) => ({
      venue: typeof step.providerId === "string" ? step.providerId : null,
      size: typeof step.roundedSize === "number"
        ? String(step.roundedSize)
        : typeof step.targetSize === "number"
          ? String(step.targetSize)
          : null,
      price: typeof step.targetPrice === "number" ? step.targetPrice : null,
      venueMarketId: isRecord(step.metadata) && typeof step.metadata.leg_id === "string" ? step.metadata.leg_id : null,
      venueOutcomeId: typeof step.candidateId === "string" ? step.candidateId : null
    }))
    .filter((leg) => typeof leg.venue === "string" && typeof leg.size === "string");
};

export class ExecutionSystemSubmissionHandler implements ExecutionSubmissionHandler {
  public constructor(private readonly orchestrator: ExecutionSystemOrchestrator) {}

  public async execute(input: Parameters<ExecutionSubmissionHandler["execute"]>[0]): Promise<ExecutionSubmissionResult> {
    const binding = input.request.executionScopeBinding ?? null;
    const metadata = input.request.metadata;
    const venuePath = input.request.venueTargets;
    const executionRequest: ExecutionRequestV0 = {
      executionId: input.audit.getRecord().id,
      rfqId: stringMetadata(metadata, "sessionId") ?? input.request.routePlanId ?? input.request.canonicalExecutableMarketId,
      userId: input.request.userWalletReference.principalId,
      canonicalTopicKey: binding?.topicKey ?? input.request.canonicalExecutableMarketId,
      candidateId: binding?.candidateSet[0] ?? input.request.canonicalExecutableMarketId,
      side: stringMetadata(metadata, "executionSide") === "sell" ? "sell" : "buy",
      size: input.request.requestedSize ?? "0",
      selectedLaneId: binding?.scopeId ?? stringMetadata(metadata, "selectedLaneId") ?? "UNSCOPED_MARKET_LANE",
      venuePath: [...venuePath],
      executionMode: executionModeForVenuePath(venuePath),
      approvedScopeHash: input.request.approvalRequirements.approvalBindingHash ?? input.idempotencyKey,
      maxSlippage: Number(metadata?.maxSlippage ?? 0),
      fastLaneEnabled: metadata?.fastLaneEnabled === true,
      ghostFillProtectionEnabled: metadata?.ghostFillProtectionEnabled !== false,
      expectedPrice: Number(metadata?.expectedPrice ?? 0),
      expectedFees: zeroFees(),
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
      ...(binding?.scopeId ? { executionScopeToken: `${binding.scopeKind}:${binding.scopeId}` } : {}),
      ...(stringMetadata(metadata, "fallbackLaneId") ? { fallbackLaneId: stringMetadata(metadata, "fallbackLaneId")! } : {}),
      metadata: {
        ...(stringMetadata(metadata, "quoteId") ? { quoteId: stringMetadata(metadata, "quoteId")! } : {}),
        routeLegs: extractRouteLegs(input.request.submissionPayload)
      }
    };

    const output = await this.orchestrator.execute(executionRequest, {
      executionIntentId: input.audit.intent.id,
      executionRecordId: input.audit.getRecord().id,
      routePlanId: input.request.routePlanId,
      actorIdentity: input.request.userWalletReference.principalId,
      scopeBinding: binding
    });

    return {
      status:
        output.result.finalState === "COMPLETED"
          ? "COMPLETED"
          : output.result.finalState === "FAILED_CLOSED" || output.result.finalState === "PREFLIGHT_FAILED"
            ? "FAILED"
            : "SYNC_PENDING",
      providerExecutionKey: `execution-system-v0:${output.result.executionId}`,
      payload: {
        executionSystemV0: output.metadata
      }
    };
  }
}
