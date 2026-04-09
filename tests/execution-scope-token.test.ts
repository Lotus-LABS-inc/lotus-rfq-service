import { describe, expect, it } from "vitest";

import {
  ExecutionScopeAuthorityError,
  ExecutionScopeTokenError,
  ExecutionScopeTokenService,
  type ExecutionScopeAuthority
} from "../src/execution-control/execution-scope-token.js";

describe("ExecutionScopeTokenService", () => {
  const authority: ExecutionScopeAuthority = {
    getScopeSnapshot: async (scopeId) => scopeId === "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET"
      ? {
          scopeKind: "POLITICS_NOMINEE_LANE",
          scopeId,
          topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
          laneType: "TRI",
          venueSet: ["LIMITLESS", "OPINION", "POLYMARKET"],
          candidateSet: ["jd_vance", "marco_rubio", "ron_desantis"],
          operatorApprovedToOffer: true,
          readinessDecision: "READY_FOR_CANARY_ONLY",
          authorityRef: "evt-1"
        }
      : null
  };

  it("issues and validates a signed scope token against live authority", async () => {
    const service = new ExecutionScopeTokenService("scope-secret");
    const issued = service.issue({
      scopeKind: "POLITICS_NOMINEE_LANE",
      scopeId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET",
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      ttlSeconds: 120,
      scope: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        laneType: "TRI",
        venueSet: ["POLYMARKET", "LIMITLESS", "OPINION"],
        candidateSet: ["ron_desantis", "jd_vance", "marco_rubio"]
      },
      now: new Date("2026-04-04T12:00:00.000Z")
    });

    const validated = await service.validate({
      token: issued.token,
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      actualVenueTargets: ["POLYMARKET", "LIMITLESS", "OPINION"],
      authorities: {
        POLITICS_NOMINEE_LANE: authority
      },
      now: new Date("2026-04-04T12:01:00.000Z")
    });

    expect(validated.binding.scopeId).toBe("POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET");
    expect(validated.binding.venueSet).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
  });

  it("fails closed when the live authority no longer matches the route venue set", async () => {
    const service = new ExecutionScopeTokenService("scope-secret");
    const issued = service.issue({
      scopeKind: "POLITICS_NOMINEE_LANE",
      scopeId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET",
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      ttlSeconds: 120,
      scope: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        laneType: "TRI",
        venueSet: ["POLYMARKET", "LIMITLESS", "OPINION"],
        candidateSet: ["ron_desantis", "jd_vance", "marco_rubio"]
      },
      now: new Date("2026-04-04T12:00:00.000Z")
    });

    await expect(service.validate({
      token: issued.token,
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      actualVenueTargets: ["LIMITLESS", "POLYMARKET"],
      authorities: {
        POLITICS_NOMINEE_LANE: authority
      },
      now: new Date("2026-04-04T12:01:00.000Z")
    })).rejects.toBeInstanceOf(ExecutionScopeAuthorityError);
  });

  it("fails closed when the token is expired", async () => {
    const service = new ExecutionScopeTokenService("scope-secret");
    const issued = service.issue({
      scopeKind: "POLITICS_NOMINEE_LANE",
      scopeId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET",
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      ttlSeconds: 60,
      scope: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        laneType: "TRI",
        venueSet: ["POLYMARKET", "LIMITLESS", "OPINION"],
        candidateSet: ["ron_desantis", "jd_vance", "marco_rubio"]
      },
      now: new Date("2026-04-04T12:00:00.000Z")
    });

    await expect(service.validate({
      token: issued.token,
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      authorities: {
        POLITICS_NOMINEE_LANE: authority
      },
      now: new Date("2026-04-04T12:02:00.000Z")
    })).rejects.toBeInstanceOf(ExecutionScopeTokenError);
  });
});
