import {
  SportsAdminService,
  SportsLaneNotFoundError
} from "../api/admin/sports-admin-service.js";
import type { ExecutionScopeAuthority, ExecutionScopeAuthoritySnapshot } from "./execution-scope-token.js";

export class SportsExecutionScopeAuthority implements ExecutionScopeAuthority {
  public constructor(private readonly service: SportsAdminService) {}

  public async getScopeSnapshot(scopeId: string): Promise<ExecutionScopeAuthoritySnapshot | null> {
    try {
      const authority = await this.service.getLaneAuthorityState(scopeId);
      return {
        scopeKind: "SPORTS_LANE",
        scopeId,
        topicKey: authority.topicKey,
        laneType: authority.laneType,
        venueSet: authority.venueSet.split("|"),
        candidateSet: authority.clubSet,
        operatorApprovedToOffer: authority.operatorApprovedToOffer,
        readinessDecision: authority.readinessDecision,
        authorityRef: authority.latestEventId ?? authority.laneId
      };
    } catch (error) {
      if (error instanceof SportsLaneNotFoundError) {
        return null;
      }
      throw error;
    }
  }
}
