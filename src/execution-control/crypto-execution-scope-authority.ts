import {
  CryptoAdminService,
  CryptoLaneNotFoundError
} from "../api/admin/crypto-admin-service.js";
import type { ExecutionScopeAuthority, ExecutionScopeAuthoritySnapshot } from "./execution-scope-token.js";

export class CryptoExecutionScopeAuthority implements ExecutionScopeAuthority {
  public constructor(private readonly service: CryptoAdminService) {}

  public async getScopeSnapshot(scopeId: string): Promise<ExecutionScopeAuthoritySnapshot | null> {
    try {
      const authority = await this.service.getLaneAuthorityState(scopeId);
      return {
        scopeKind: "CRYPTO_LANE",
        scopeId,
        topicKey: authority.familyKey,
        laneType: authority.laneType,
        venueSet: authority.venueSet.split("|"),
        candidateSet: authority.candidateSet,
        operatorApprovedToOffer: authority.operatorApprovedToOffer,
        readinessDecision: authority.readinessDecision,
        authorityRef: authority.latestEventId ?? authority.laneId
      };
    } catch (error) {
      if (error instanceof CryptoLaneNotFoundError) {
        return null;
      }
      throw error;
    }
  }
}
