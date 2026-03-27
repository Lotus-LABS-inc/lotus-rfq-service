import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerResolutionRiskRoutes } from "../src/api/routes/resolution-risk.js";
import type { NormalizedResolutionProfile, ResolutionRiskAssessment } from "../src/core/rfq-engine/resolution-risk.types.js";

const CANONICAL_EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_A_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_B_ID = "33333333-3333-4333-8333-333333333333";

const buildAssessment = (overrides: Partial<ResolutionRiskAssessment> = {}): ResolutionRiskAssessment => ({
  id: "11111111-1111-4111-8111-111111111111",
  canonicalEventId: CANONICAL_EVENT_ID,
  canonicalMarketId: "market-1",
  marketAProfileId: PROFILE_A_ID,
  marketBProfileId: PROFILE_B_ID,
  riskScore: "0.18",
  confidenceScore: "0.84",
  equivalenceClass: "SAFE_EQUIVALENT",
  factorBreakdown: {
    oracleMismatch: { score: 0, confidence: 1 }
  },
  reasons: [],
  version: "resolution-risk-v1",
  computedAt: new Date("2026-03-11T00:00:00.000Z"),
  ...overrides
});

const buildProfile = (overrides: Partial<NormalizedResolutionProfile> = {}): NormalizedResolutionProfile => ({
  id: PROFILE_A_ID,
  venue: "polymarket",
  venueMarketId: "mkt-1",
  canonicalEventId: CANONICAL_EVENT_ID,
  canonicalMarketId: "market-1",
  oracleType: "manual_committee",
  oracleName: "Resolution Committee",
  resolutionAuthorityType: "committee",
  primaryResolutionText: "Event resolves YES if condition occurs before cutoff.",
  supplementalRulesText: "Primary bulletin governs disputes.",
  disputeWindowHours: "24",
  settlementLagHours: "12",
  marketType: "binary",
  outcomeSchema: { outcomes: ["YES", "NO"] },
  hasAmbiguousTimeBoundary: false,
  hasAmbiguousJurisdictionBoundary: false,
  hasAmbiguousSourceReference: false,
  historicalDivergenceRate: "0.01",
  metadata: {},
  createdAt: new Date("2026-03-11T00:00:00.000Z"),
  updatedAt: new Date("2026-03-11T00:00:00.000Z"),
  ...overrides
});

describe("resolution risk routes", () => {
  it("returns canonical event assessments in deterministic order", async () => {
    const app = Fastify({ logger: false });
    const assessments = [
      buildAssessment(),
      buildAssessment({
        id: "44444444-4444-4444-8444-444444444444",
        marketAProfileId: PROFILE_A_ID,
        marketBProfileId: "55555555-5555-4555-8555-555555555555"
      })
    ];
    const firstAssessment = assessments[0]!;
    const secondAssessment = assessments[1]!;

    await registerResolutionRiskRoutes(app, {
      buildAssessmentsForCanonicalEvent: vi.fn().mockResolvedValue(assessments),
      comparePair: vi.fn(),
      resolveProfileByVenueMarket: vi.fn()
    });

    const response = await app.inject({
      method: "GET",
      url: `/resolution-risk/canonical/${CANONICAL_EVENT_ID}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      canonicalEventId: CANONICAL_EVENT_ID,
      assessmentCount: 2,
      assessments: [
        {
          label: "Safe equivalent",
          riskScore: "0.18",
          confidenceScore: "0.84",
          equivalenceClass: "SAFE_EQUIVALENT",
          shortReasons: [],
          factorBreakdown: firstAssessment.factorBreakdown,
          recommendedAction: "Poolable"
        },
        {
          label: "Safe equivalent",
          riskScore: "0.18",
          confidenceScore: "0.84",
          equivalenceClass: "SAFE_EQUIVALENT",
          shortReasons: [],
          factorBreakdown: secondAssessment.factorBreakdown,
          recommendedAction: "Poolable"
        }
      ]
    });

    await app.close();
  });

  it("returns empty canonical event list when the service returns no pairs", async () => {
    const app = Fastify({ logger: false });

    await registerResolutionRiskRoutes(app, {
      buildAssessmentsForCanonicalEvent: vi.fn().mockResolvedValue([]),
      comparePair: vi.fn(),
      resolveProfileByVenueMarket: vi.fn()
    });

    const response = await app.inject({
      method: "GET",
      url: `/resolution-risk/canonical/${CANONICAL_EVENT_ID}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      canonicalEventId: CANONICAL_EVENT_ID,
      assessmentCount: 0,
      assessments: []
    });

    await app.close();
  });

  it("returns one pair assessment regardless of input ordering", async () => {
    const app = Fastify({ logger: false });
    const comparePair = vi.fn().mockResolvedValue(
      buildAssessment({
        marketAProfileId: PROFILE_A_ID,
        marketBProfileId: PROFILE_B_ID
      })
    );

    await registerResolutionRiskRoutes(app, {
      buildAssessmentsForCanonicalEvent: vi.fn(),
      comparePair,
      resolveProfileByVenueMarket: vi.fn()
    });

    const response = await app.inject({
      method: "GET",
      url: `/resolution-risk/pair?profileAId=${PROFILE_B_ID}&profileBId=${PROFILE_A_ID}`
    });

    expect(response.statusCode).toBe(200);
    expect(comparePair).toHaveBeenCalledWith(
      PROFILE_B_ID,
      PROFILE_A_ID
    );
    expect(response.json()).toEqual({
      assessment: {
        label: "Safe equivalent",
        riskScore: "0.18",
        confidenceScore: "0.84",
        equivalenceClass: "SAFE_EQUIVALENT",
        shortReasons: [],
        factorBreakdown: {
          oracleMismatch: { score: 0, confidence: 1 }
        },
        recommendedAction: "Poolable"
      }
    });

    await app.close();
  });

  it("maps cross-event pair failures to 409", async () => {
    const app = Fastify({ logger: false });

    await registerResolutionRiskRoutes(app, {
      buildAssessmentsForCanonicalEvent: vi.fn(),
      comparePair: vi.fn().mockRejectedValue({ code: "cross_event_pair_not_allowed" }),
      resolveProfileByVenueMarket: vi.fn()
    });

    const response = await app.inject({
      method: "GET",
      url: `/resolution-risk/pair?profileAId=${PROFILE_A_ID}&profileBId=${PROFILE_B_ID}`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "CROSS_EVENT_PAIR_NOT_ALLOWED",
      message: "Resolution risk comparisons require profiles from the same canonical event."
    });

    await app.close();
  });

  it("returns 400 on invalid pair query input", async () => {
    const app = Fastify({ logger: false });

    await registerResolutionRiskRoutes(app, {
      buildAssessmentsForCanonicalEvent: vi.fn(),
      comparePair: vi.fn(),
      resolveProfileByVenueMarket: vi.fn()
    });

    const response = await app.inject({
      method: "GET",
      url: "/resolution-risk/pair?profileAId=bad"
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("returns only market-related assessments for a resolved profile", async () => {
    const app = Fastify({ logger: false });
    const profile = buildProfile();
    const related = buildAssessment({
      marketAProfileId: profile.id,
      marketBProfileId: PROFILE_B_ID
    });
    const unrelated = buildAssessment({
      id: "66666666-6666-4666-8666-666666666666",
      marketAProfileId: "77777777-7777-4777-8777-777777777777",
      marketBProfileId: "88888888-8888-4888-8888-888888888888"
    });

    await registerResolutionRiskRoutes(app, {
      buildAssessmentsForCanonicalEvent: vi.fn().mockResolvedValue([related, unrelated]),
      comparePair: vi.fn(),
      resolveProfileByVenueMarket: vi.fn().mockResolvedValue(profile)
    });

    const response = await app.inject({
      method: "GET",
      url: "/resolution-risk/market/polymarket/mkt-1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      profile: {
        ...profile,
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z"
      },
      assessmentCount: 1,
      assessments: [
        {
          label: "Safe equivalent",
          riskScore: "0.18",
          confidenceScore: "0.84",
          equivalenceClass: "SAFE_EQUIVALENT",
          shortReasons: [],
          factorBreakdown: related.factorBreakdown,
          recommendedAction: "Poolable"
        }
      ]
    });

    await app.close();
  });

  it("returns 404 for a missing venue market profile", async () => {
    const app = Fastify({ logger: false });

    await registerResolutionRiskRoutes(app, {
      buildAssessmentsForCanonicalEvent: vi.fn(),
      comparePair: vi.fn(),
      resolveProfileByVenueMarket: vi.fn().mockResolvedValue(null)
    });

    const response = await app.inject({
      method: "GET",
      url: "/resolution-risk/market/polymarket/missing-market"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "PROFILE_NOT_FOUND",
      message: "Resolution profile not found for venue market."
    });

    await app.close();
  });

  it("fails closed with 500 on canonical service errors", async () => {
    const app = Fastify({ logger: false });

    await registerResolutionRiskRoutes(app, {
      buildAssessmentsForCanonicalEvent: vi.fn().mockRejectedValue(new Error("boom")),
      comparePair: vi.fn(),
      resolveProfileByVenueMarket: vi.fn()
    });

    const response = await app.inject({
      method: "GET",
      url: `/resolution-risk/canonical/${CANONICAL_EVENT_ID}`
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "RESOLUTION_RISK_ERROR",
      message: "Resolution risk request failed."
    });

    await app.close();
  });
});
