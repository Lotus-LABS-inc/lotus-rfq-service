import type { PoliticsNomineeAdminService } from "../api/admin/politics-nominee-admin-service.js";
import { politicsNomineeLaneIds, type PoliticsNomineeLaneId } from "../operations/semantic-expansion/politics-nominee-limited-prod-shared.js";
import type { ExecutionScopeAuthority, ExecutionScopeAuthoritySnapshot } from "./execution-scope-token.js";

const isPoliticsNomineeLaneId = (value: string): value is PoliticsNomineeLaneId =>
  (politicsNomineeLaneIds as readonly string[]).includes(value);

export class PoliticsNomineeExecutionScopeAuthority implements ExecutionScopeAuthority {
  public constructor(private readonly service: PoliticsNomineeAdminService) {}

  public async getScopeSnapshot(scopeId: string): Promise<ExecutionScopeAuthoritySnapshot | null> {
    if (!isPoliticsNomineeLaneId(scopeId)) {
      return null;
    }

    const authority = await this.service.getLaneAuthorityState(scopeId);
    return {
      scopeKind: "POLITICS_NOMINEE_LANE",
      scopeId,
      topicKey: authority.topicKey,
      laneType: authority.laneType,
      venueSet: authority.venueSet.split("|"),
      candidateSet: authority.candidateSet,
      operatorApprovedToOffer: authority.operatorApprovedToOffer,
      readinessDecision: authority.readinessDecision,
      authorityRef: authority.latestEventId ?? authority.laneId
    };
  }
}
