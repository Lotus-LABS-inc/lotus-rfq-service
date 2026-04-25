import { ApprovedLaneExecutionGate } from "./lane-authority.js";
import type { ExecutionCheckResult, ExecutionRequestV0 } from "./types.js";

export interface FallbackDecision {
  action: "REROUTE" | "FAIL_CLOSED";
  fallbackLaneId?: string;
  reason: string;
}

export class FallbackPolicyService {
  public constructor(private readonly laneGate: ApprovedLaneExecutionGate) {}

  public async decide(input: {
    request: ExecutionRequestV0;
    reason: string;
  }): Promise<FallbackDecision> {
    if (!input.request.fallbackLaneId) {
      return { action: "FAIL_CLOSED", reason: "No approved fallback lane was supplied." };
    }

    const result: ExecutionCheckResult = await this.laneGate.evaluate({
      request: input.request,
      scopeBinding: null,
      fallbackLaneId: input.request.fallbackLaneId,
      requireScopeToken: false
    });

    if (!result.ok) {
      return {
        action: "FAIL_CLOSED",
        reason: result.reason ?? "Fallback lane is not approved."
      };
    }

    return {
      action: "REROUTE",
      fallbackLaneId: input.request.fallbackLaneId,
      reason: input.reason
    };
  }
}
