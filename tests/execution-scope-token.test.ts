import { describe, expect, it } from "vitest";

import {
  ExecutionScopeAuthorityError,
  ExecutionScopeTokenError,
  ExecutionScopeTokenService,
  type ExecutionScopeAuthority
} from "../src/execution-control/execution-scope-token.js";

describe("ExecutionScopeTokenService", () => {
  const authority: ExecutionScopeAuthority = {
    getScopeSnapshot: async (scopeId) => {
      if (scopeId === "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET") {
        return {
          scopeKind: "POLITICS_NOMINEE_LANE",
          scopeId,
          topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
          laneType: "TRI",
          venueSet: ["LIMITLESS", "OPINION", "POLYMARKET"],
          candidateSet: ["jd_vance", "marco_rubio", "ron_desantis"],
          operatorApprovedToOffer: true,
          readinessDecision: "READY_FOR_CANARY_ONLY",
          authorityRef: "evt-1"
        };
      }
      if (scopeId === "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET") {
        return {
          scopeKind: "CRYPTO_LANE",
          scopeId,
          topicKey: "CRYPTO|ATH_BY_DATE|BTC",
          laneType: "PAIR",
          venueSet: ["LIMITLESS", "POLYMARKET"],
          candidateSet: ["2026-05-31", "2026-06-30"],
          operatorApprovedToOffer: true,
          readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
          authorityRef: "evt-2"
        };
      }
      if (scopeId === "SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET") {
        return {
          scopeKind: "SPORTS_LANE",
          scopeId,
          topicKey: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
          laneType: "PAIR",
          venueSet: ["LIMITLESS", "POLYMARKET"],
          candidateSet: ["arsenal", "liverpool", "manchester_city"],
          operatorApprovedToOffer: false,
          readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
          authorityRef: "evt-3"
        };
      }
      return null;
    }
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
      flowSegment: "soft",
      flowSegmentVersion: "flow-segmentation-v1",
      flowSegmentInputHash: "hash-1",
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
      expectedFlowSegment: "soft",
      actualVenueTargets: ["POLYMARKET", "LIMITLESS", "OPINION"],
      authorities: {
        POLITICS_NOMINEE_LANE: authority
      },
      now: new Date("2026-04-04T12:01:00.000Z")
    });

    expect(validated.binding.scopeId).toBe("POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET");
    expect(validated.binding.venueSet).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(validated.claims.flowSegment).toBe("soft");
  });

  it("fails closed when the expected flow segment differs from the token", async () => {
    const service = new ExecutionScopeTokenService("scope-secret");
    const issued = service.issue({
      scopeKind: "CRYPTO_LANE",
      scopeId: "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      flowSegment: "standard",
      ttlSeconds: 120,
      scope: {
        topicKey: "CRYPTO|ATH_BY_DATE|BTC",
        laneType: "PAIR",
        venueSet: ["POLYMARKET", "LIMITLESS"],
        candidateSet: ["2026-06-30", "2026-05-31"]
      },
      now: new Date("2026-04-04T12:00:00.000Z")
    });

    await expect(service.validate({
      token: issued.token,
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      expectedFlowSegment: "soft",
      authorities: {
        CRYPTO_LANE: authority
      },
      now: new Date("2026-04-04T12:01:00.000Z")
    })).rejects.toBeInstanceOf(ExecutionScopeTokenError);
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

  it("supports crypto lane scope tokens once operator approval intent exists", async () => {
    const service = new ExecutionScopeTokenService("scope-secret");
    const issued = service.issue({
      scopeKind: "CRYPTO_LANE",
      scopeId: "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      ttlSeconds: 120,
      scope: {
        topicKey: "CRYPTO|ATH_BY_DATE|BTC",
        laneType: "PAIR",
        venueSet: ["POLYMARKET", "LIMITLESS"],
        candidateSet: ["2026-06-30", "2026-05-31"]
      },
      now: new Date("2026-04-04T12:00:00.000Z")
    });

    const validated = await service.validate({
      token: issued.token,
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      actualVenueTargets: ["LIMITLESS", "POLYMARKET"],
      authorities: {
        CRYPTO_LANE: authority
      },
      now: new Date("2026-04-04T12:01:00.000Z")
    });

    expect(validated.binding.scopeKind).toBe("CRYPTO_LANE");
  });

  it("fails closed for sports lanes still waiting for operator review", async () => {
    const service = new ExecutionScopeTokenService("scope-secret");
    const issued = service.issue({
      scopeKind: "SPORTS_LANE",
      scopeId: "SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET",
      principalId: "user-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      canonicalMarketId: "canonical-market-1",
      ttlSeconds: 120,
      scope: {
        topicKey: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
        laneType: "PAIR",
        venueSet: ["LIMITLESS", "POLYMARKET"],
        candidateSet: ["arsenal", "liverpool", "manchester_city"]
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
        SPORTS_LANE: authority
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
