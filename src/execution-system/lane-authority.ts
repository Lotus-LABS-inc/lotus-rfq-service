import type {
  ExecutionScopeAuthorityRegistry,
  ExecutionScopeBinding
} from "../execution-control/execution-scope-token.js";
import type { ExecutionCheckResult, ExecutionRequestV0 } from "./types.js";

export const executableLaneStates = ["OPERATOR_APPROVED_SANDBOX", "OPERATOR_APPROVED_LIMITED_PROD"] as const;
export type ExecutableLaneState = (typeof executableLaneStates)[number];

export const nonExecutableLaneStates = [
  "MATCHER_READY",
  "READINESS_READY_FOR_REVIEW",
  "OPERATOR_REVIEW_REQUIRED",
  "REVIEW_REQUIRED",
  "FAMILY_MATCHER_CANDIDATE_FOUND",
  "TRI_REVIEW_REQUIRED",
  "PAIR_REVIEW_REQUIRED",
  "HELD",
  "ROLLED_BACK",
  "REJECTED"
] as const;

export type LaneExecutionState = ExecutableLaneState | (typeof nonExecutableLaneStates)[number] | string;

export interface ExecutionLaneAuthoritySnapshot {
  laneId: string;
  laneState: LaneExecutionState;
  topicKey: string;
  venueSet: readonly string[];
  candidateSet: readonly string[];
  ruleState: "EXACT_SAFE" | "SEMANTIC_COMPATIBLE" | "REVIEW_REQUIRED" | "DEGRADED" | string;
  held?: boolean;
  rolledBack?: boolean;
  rejected?: boolean;
}

export interface ExecutionLaneAuthorityResolver {
  getLaneAuthority(laneId: string): Promise<ExecutionLaneAuthoritySnapshot | null>;
}

const normalize = (values: readonly string[]): readonly string[] =>
  [...values].map((value) => value.trim()).filter(Boolean).sort();

const setIncludesAll = (scope: readonly string[], requested: readonly string[]): boolean => {
  const allowed = new Set(normalize(scope));
  return normalize(requested).every((value) => allowed.has(value));
};

export class ApprovedLaneExecutionGate {
  public constructor(private readonly resolver: ExecutionLaneAuthorityResolver) {}

  public async evaluate(input: {
    request: ExecutionRequestV0;
    scopeBinding?: ExecutionScopeBinding | null;
    fallbackLaneId?: string | null;
    requireScopeToken?: boolean;
  }): Promise<ExecutionCheckResult & { lane?: ExecutionLaneAuthoritySnapshot; fallbackLane?: ExecutionLaneAuthoritySnapshot }> {
    const lane = await this.resolver.getLaneAuthority(input.request.selectedLaneId);
    if (!lane) {
      return { ok: false, code: "LANE_NOT_FOUND", reason: `Lane ${input.request.selectedLaneId} was not found.` };
    }

    const primaryCheck = this.checkLane(input.request, lane, input.scopeBinding ?? null, input.requireScopeToken ?? true);
    if (!primaryCheck.ok) {
      return { ...primaryCheck, lane };
    }

    if (input.fallbackLaneId) {
      const fallbackLane = await this.resolver.getLaneAuthority(input.fallbackLaneId);
      if (!fallbackLane) {
        return { ok: false, code: "FALLBACK_NOT_APPROVED", reason: `Fallback lane ${input.fallbackLaneId} was not found.`, lane };
      }
      const fallbackCheck = this.checkLane(input.request, fallbackLane, null, false);
      if (!fallbackCheck.ok) {
        return {
          ok: false,
          code: "FALLBACK_NOT_APPROVED",
          reason: `Fallback lane ${input.fallbackLaneId} is not executable: ${fallbackCheck.reason}`,
          lane,
          fallbackLane
        };
      }
      return { ok: true, lane, fallbackLane };
    }

    return { ok: true, lane };
  }

  private checkLane(
    request: ExecutionRequestV0,
    lane: ExecutionLaneAuthoritySnapshot,
    scopeBinding: ExecutionScopeBinding | null,
    requireScopeToken: boolean
  ): ExecutionCheckResult {
    if (lane.held || lane.rolledBack || lane.rejected || ["HELD", "ROLLED_BACK", "REJECTED"].includes(lane.laneState)) {
      return { ok: false, code: "LANE_HELD_OR_REVOKED", reason: `Lane ${lane.laneId} is held, rolled back, or rejected.` };
    }
    if (!executableLaneStates.includes(lane.laneState as ExecutableLaneState)) {
      return { ok: false, code: "LANE_NOT_OPERATOR_APPROVED", reason: `Lane ${lane.laneId} is ${lane.laneState}, not operator-approved.` };
    }
    if (lane.topicKey !== request.canonicalTopicKey) {
      return { ok: false, code: "TOPIC_SCOPE_MISMATCH", reason: `Lane topic ${lane.topicKey} does not match ${request.canonicalTopicKey}.` };
    }
    const candidate = request.candidateId ?? request.canonicalOutcomeId;
    if (candidate && !setIncludesAll(lane.candidateSet, [candidate])) {
      return { ok: false, code: "CANDIDATE_SCOPE_MISMATCH", reason: `Candidate ${candidate} is outside lane ${lane.laneId}.` };
    }
    if (!setIncludesAll(lane.venueSet, request.venuePath)) {
      return { ok: false, code: "VENUE_SCOPE_MISMATCH", reason: `Venue path is outside lane ${lane.laneId}.` };
    }
    if (lane.ruleState === "DEGRADED" || lane.ruleState === "REVIEW_REQUIRED") {
      return { ok: false, code: "RULE_STATE_DEGRADED", reason: `Lane ${lane.laneId} rule state is ${lane.ruleState}.` };
    }
    if (!scopeBinding && requireScopeToken) {
      return { ok: false, code: "SCOPE_TOKEN_REQUIRED", reason: "Execution scope token is required for market-lane execution." };
    }
    if (!scopeBinding) {
      return { ok: true };
    }
    if (scopeBinding.scopeId !== lane.laneId || scopeBinding.topicKey !== lane.topicKey) {
      return { ok: false, code: "SCOPE_TOKEN_INVALID", reason: "Execution scope token does not bind the selected lane/topic." };
    }
    if (!setIncludesAll(scopeBinding.venueSet, request.venuePath)) {
      return { ok: false, code: "SCOPE_TOKEN_INVALID", reason: "Execution scope token does not bind the venue path." };
    }
    if (candidate && !setIncludesAll(scopeBinding.candidateSet, [candidate])) {
      return { ok: false, code: "SCOPE_TOKEN_INVALID", reason: "Execution scope token does not bind the requested outcome/candidate." };
    }
    return { ok: true };
  }
}

export class StaticLaneAuthorityResolver implements ExecutionLaneAuthorityResolver {
  public constructor(private readonly lanes: ReadonlyMap<string, ExecutionLaneAuthoritySnapshot>) {}

  public async getLaneAuthority(laneId: string): Promise<ExecutionLaneAuthoritySnapshot | null> {
    return this.lanes.get(laneId) ?? null;
  }
}

export class ScopeAuthorityLaneResolver implements ExecutionLaneAuthorityResolver {
  public constructor(private readonly authorities: ExecutionScopeAuthorityRegistry) {}

  public async getLaneAuthority(laneId: string): Promise<ExecutionLaneAuthoritySnapshot | null> {
    for (const authority of Object.values(this.authorities)) {
      if (!authority) continue;
      const snapshot = await authority.getScopeSnapshot(laneId);
      if (!snapshot) continue;
      return {
        laneId: snapshot.scopeId,
        laneState: snapshot.operatorApprovedToOffer
          ? "OPERATOR_APPROVED_SANDBOX"
          : snapshot.readinessDecision,
        topicKey: snapshot.topicKey,
        venueSet: snapshot.venueSet,
        candidateSet: snapshot.candidateSet,
        ruleState: snapshot.operatorApprovedToOffer ? "EXACT_SAFE" : "REVIEW_REQUIRED"
      };
    }
    return null;
  }
}
