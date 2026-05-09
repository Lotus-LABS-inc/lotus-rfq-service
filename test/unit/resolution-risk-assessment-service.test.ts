import { describe, expect, it, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import {
  ReplayDecisionCaptureError,
  ReplayDecisionCaptureService
} from "../../src/core/replay/replay-decision-capture-service.js";
import {
  ResolutionRiskAssessmentService,
  ResolutionRiskAssessmentServiceError
} from "../../src/core/rfq-engine/resolution-risk-assessment-service.js";
import type {
  ResolutionRiskEquivalenceThresholds,
  ResolutionRiskScoringWeights
} from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import type {
  NormalizedResolutionProfile,
  ResolutionFactorComparisonResult,
  ResolutionRiskAssessment
} from "../../src/core/rfq-engine/resolution-risk.types.js";

const makeProfile = (id: string, canonicalEventId = "event-1"): NormalizedResolutionProfile => ({
  id,
  venue: "venue-a",
  venueMarketId: `market-${id}`,
  canonicalEventId,
  canonicalMarketId: "market-1",
  oracleType: "manual_committee",
  oracleName: "Resolution Committee",
  resolutionAuthorityType: "committee",
  primaryResolutionText: "Market resolves YES if the event occurs before deadline.",
  supplementalRulesText: "Primary venue bulletin controls if disputes arise.",
  disputeWindowHours: "24",
  settlementLagHours: "12",
  marketType: "binary",
  outcomeSchema: { outcomes: ["YES", "NO"] },
  hasAmbiguousTimeBoundary: false,
  hasAmbiguousJurisdictionBoundary: false,
  hasAmbiguousSourceReference: false,
  historicalDivergenceRate: "0.01",
  metadata: {},
  createdAt: new Date("2026-03-11T12:00:00.000Z"),
  updatedAt: new Date("2026-03-11T12:00:00.000Z")
});

const factorComparison: ResolutionFactorComparisonResult = {
  oracleMismatch: { score: 0, confidence: 1, reason: "oracle matches" },
  ruleMismatch: { score: 0, confidence: 1, reason: "rules match" },
  wordingAmbiguity: { score: 0, confidence: 1, reason: "wording matches" },
  disputeWindowMismatch: { score: 0, confidence: 1, reason: "window matches" },
  settlementLagMismatch: { score: 0, confidence: 1, reason: "lag matches" },
  structuralMismatch: { score: 0, confidence: 1, reason: "structure matches" },
  historicalDivergence: { score: 0, confidence: 1, reason: "history acceptable" }
};

const assessmentRow = (marketAProfileId: string, marketBProfileId: string): ResolutionRiskAssessment => ({
  id: `assessment-${marketAProfileId}-${marketBProfileId}`,
  canonicalEventId: "event-1",
  canonicalMarketId: "market-1",
  marketAProfileId,
  marketBProfileId,
  riskScore: "0",
  confidenceScore: "1",
  equivalenceClass: "SAFE_EQUIVALENT",
  factorBreakdown: factorComparison as unknown as Record<string, unknown>,
  reasons: [],
  version: "resolution-risk-v1",
  computedAt: new Date("2026-03-11T12:05:00.000Z")
});

const toProfileRow = (profile: NormalizedResolutionProfile) => ({
  id: profile.id,
  venue: profile.venue,
  venue_market_id: profile.venueMarketId,
  canonical_event_id: profile.canonicalEventId,
  canonical_market_id: profile.canonicalMarketId,
  oracle_type: profile.oracleType,
  oracle_name: profile.oracleName,
  resolution_authority_type: profile.resolutionAuthorityType,
  primary_resolution_text: profile.primaryResolutionText,
  supplemental_rules_text: profile.supplementalRulesText,
  dispute_window_hours: profile.disputeWindowHours,
  settlement_lag_hours: profile.settlementLagHours,
  market_type: profile.marketType,
  outcome_schema: profile.outcomeSchema,
  has_ambiguous_time_boundary: profile.hasAmbiguousTimeBoundary,
  has_ambiguous_jurisdiction_boundary: profile.hasAmbiguousJurisdictionBoundary,
  has_ambiguous_source_reference: profile.hasAmbiguousSourceReference,
  historical_divergence_rate: profile.historicalDivergenceRate,
  metadata: profile.metadata,
  created_at: profile.createdAt,
  updated_at: profile.updatedAt
});

const toAssessmentRow = (assessment: ResolutionRiskAssessment) => ({
  id: assessment.id,
  canonical_event_id: assessment.canonicalEventId,
  canonical_market_id: assessment.canonicalMarketId,
  market_a_profile_id: assessment.marketAProfileId,
  market_b_profile_id: assessment.marketBProfileId,
  risk_score: assessment.riskScore,
  confidence_score: assessment.confidenceScore,
  equivalence_class: assessment.equivalenceClass,
  factor_breakdown: assessment.factorBreakdown,
  reasons: assessment.reasons,
  version: assessment.version,
  computed_at: assessment.computedAt,
  liquidity_cost: assessment.liquidityCost ?? null,
  max_settlement_delay_hours: assessment.maxSettlementDelayHours ? String(assessment.maxSettlementDelayHours) : null
});

const makeQueryResult = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
  command: "SELECT",
  rowCount: rows.length,
  oid: 0,
  fields: [],
  rows
});

const makeScoringEngineMock = (
  scoreImpl: (input: { profileA: NormalizedResolutionProfile; profileB: NormalizedResolutionProfile }) => ResolutionRiskAssessment
) => ({
  score: vi.fn(scoreImpl),
  getReplayWeights: vi.fn<() => ResolutionRiskScoringWeights>(() => ({
    oracleMismatch: "0.22",
    ruleMismatch: "0.20",
    wordingAmbiguity: "0.16",
    disputeWindowMismatch: "0.12",
    settlementLagMismatch: "0.10",
    structuralMismatch: "0.10",
    historicalDivergence: "0.10"
  })),
  getReplayThresholds: vi.fn<() => ResolutionRiskEquivalenceThresholds>(() => ({
    safeEquivalentMaxRisk: "0.20",
    safeEquivalentMinConfidence: "0.70",
    cautionMaxRisk: "0.45",
    highRiskMaxRisk: "0.75",
    doNotPoolMinRisk: "0.75",
    lowConfidenceThreshold: "0.50"
  })),
  buildReplayConfidenceInputs: vi.fn(() => ({ factorConfidence: 1 }))
});

describe("ResolutionRiskAssessmentService", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  it("builds all unique ordered pairs for one canonical event", async () => {
    const profiles = [makeProfile("b-profile"), makeProfile("a-profile"), makeProfile("c-profile")];
    const persisted = new Map<string, ResolutionRiskAssessment>([
      ["a-profile:b-profile", assessmentRow("a-profile", "b-profile")],
      ["a-profile:c-profile", assessmentRow("a-profile", "c-profile")],
      ["b-profile:c-profile", assessmentRow("b-profile", "c-profile")]
    ]);

    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM resolution_profiles") && sql.includes("canonical_event_id")) {
        return makeQueryResult(profiles.map(toProfileRow));
      }

      if (sql.includes("INSERT INTO resolution_risk_assessments")) {
        const args = params as string[];
        const key = `${args[2]}:${args[3]}`;
        return makeQueryResult([toAssessmentRow(persisted.get(key)!)]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const comparator = { compare: vi.fn(() => factorComparison) };
    const scorer = makeScoringEngineMock(({ profileA, profileB }) => persisted.get(`${profileA.id}:${profileB.id}`)!);

    const service = new ResolutionRiskAssessmentService({
      pool: { query } as unknown as Pool,
      comparator,
      scoringEngine: scorer,
      logger,
      config: { version: "resolution-risk-v1" }
    });

    const result = await service.buildAssessmentsForCanonicalEvent("event-1");

    expect(result.map((row) => `${row.marketAProfileId}:${row.marketBProfileId}`)).toEqual([
      "a-profile:b-profile",
      "a-profile:c-profile",
      "b-profile:c-profile"
    ]);
    expect(comparator.compare).toHaveBeenCalledTimes(3);
    expect(scorer.score).toHaveBeenCalledTimes(3);
  });

  it("uses lower profile ID first regardless of input order", async () => {
    const profileA = makeProfile("b-profile");
    const profileB = makeProfile("a-profile");
    const persisted = assessmentRow("a-profile", "b-profile");

    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM resolution_profiles") && sql.includes("id = ANY")) {
        return makeQueryResult([toProfileRow(profileA), toProfileRow(profileB)]);
      }

      if (sql.includes("INSERT INTO resolution_risk_assessments")) {
        return makeQueryResult([toAssessmentRow(persisted)]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const comparator = { compare: vi.fn(() => factorComparison) };
    const scorer = makeScoringEngineMock(({ profileA, profileB }) => ({
        ...persisted,
        marketAProfileId: profileA.id,
        marketBProfileId: profileB.id
      }));

    const service = new ResolutionRiskAssessmentService({
      pool: { query } as unknown as Pool,
      comparator,
      scoringEngine: scorer,
      logger,
      config: { version: "resolution-risk-v1" }
    });

    await service.comparePair("b-profile", "a-profile");

    expect(comparator.compare).toHaveBeenCalledWith(expect.objectContaining({ id: "a-profile" }), expect.objectContaining({ id: "b-profile" }));
    expect(scorer.score).toHaveBeenCalledWith(expect.objectContaining({
      profileA: expect.objectContaining({ id: "a-profile" }),
      profileB: expect.objectContaining({ id: "b-profile" })
    }));
  });

  it("fails closed when profiles are from different events", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM resolution_profiles") && sql.includes("id = ANY")) {
        return makeQueryResult([
          toProfileRow(makeProfile("a-profile", "event-1")),
          toProfileRow(makeProfile("b-profile", "event-2"))
        ]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = new ResolutionRiskAssessmentService({
      pool: { query } as unknown as Pool,
      comparator: { compare: vi.fn() },
      scoringEngine: makeScoringEngineMock(() => assessmentRow("a-profile", "b-profile")),
      logger,
      config: { version: "resolution-risk-v1" }
    });

    await expect(service.comparePair("a-profile", "b-profile")).rejects.toThrowError(
      new ResolutionRiskAssessmentServiceError("cross_event_pair_not_allowed")
    );
  });

  it("recomputes the full event, not only touched pairs", async () => {
    const profiles = [makeProfile("a-profile"), makeProfile("b-profile"), makeProfile("c-profile")];
    const persisted = new Map<string, ResolutionRiskAssessment>([
      ["a-profile:b-profile", assessmentRow("a-profile", "b-profile")],
      ["a-profile:c-profile", assessmentRow("a-profile", "c-profile")],
      ["b-profile:c-profile", assessmentRow("b-profile", "c-profile")]
    ]);

    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM resolution_profiles") && sql.includes("WHERE rp.id = $1")) {
        return makeQueryResult([toProfileRow(profiles[0]!)]);
      }

      if (sql.includes("FROM resolution_profiles") && sql.includes("canonical_event_id")) {
        return makeQueryResult(profiles.map(toProfileRow));
      }

      if (sql.includes("INSERT INTO resolution_risk_assessments")) {
        const args = params as string[];
        return makeQueryResult([toAssessmentRow(persisted.get(`${args[2]}:${args[3]}`)!)]); 
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const hooks = { onAssessmentRecomputed: vi.fn() };
    const service = new ResolutionRiskAssessmentService({
      pool: { query } as unknown as Pool,
      comparator: { compare: vi.fn(() => factorComparison) },
      scoringEngine: makeScoringEngineMock(({ profileA, profileB }) => persisted.get(`${profileA.id}:${profileB.id}`)!),
      logger,
      metricsHooks: hooks,
      config: { version: "resolution-risk-v1" }
    });

    const result = await service.recomputeProfileAssessments("a-profile");

    expect(result).toHaveLength(3);
    expect(hooks.onAssessmentRecomputed).toHaveBeenCalledWith({
      canonicalEventId: "event-1",
      profileId: "a-profile",
      assessmentCount: 3,
      version: "resolution-risk-v1"
    });
  });

  it("fires metrics hooks on success and failure", async () => {
    const successHooks = {
      onAssessmentBuilt: vi.fn(),
      onAssessmentPersisted: vi.fn(),
      onAssessmentFailed: vi.fn()
    };
    const persisted = assessmentRow("a-profile", "b-profile");

    const successQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM resolution_profiles") && sql.includes("id = ANY")) {
        return makeQueryResult([
          toProfileRow(makeProfile("a-profile")),
          toProfileRow(makeProfile("b-profile"))
        ]);
      }

      if (sql.includes("INSERT INTO resolution_risk_assessments")) {
        return makeQueryResult([toAssessmentRow(persisted)]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const successService = new ResolutionRiskAssessmentService({
      pool: { query: successQuery } as unknown as Pool,
      comparator: { compare: vi.fn(() => factorComparison) },
      scoringEngine: makeScoringEngineMock(() => persisted),
      logger,
      metricsHooks: successHooks,
      config: { version: "resolution-risk-v1" }
    });

    await successService.comparePair("a-profile", "b-profile");

    expect(successHooks.onAssessmentBuilt).toHaveBeenCalledTimes(1);
    expect(successHooks.onAssessmentPersisted).toHaveBeenCalledTimes(1);
    expect(successHooks.onAssessmentFailed).not.toHaveBeenCalled();

    const failureHooks = {
      onAssessmentBuilt: vi.fn(),
      onAssessmentPersisted: vi.fn(),
      onAssessmentFailed: vi.fn()
    };

    const failureService = new ResolutionRiskAssessmentService({
      pool: { query: successQuery } as unknown as Pool,
      comparator: { compare: vi.fn(() => { throw new Error("compare_failed"); }) },
      scoringEngine: makeScoringEngineMock(() => persisted),
      logger,
      metricsHooks: failureHooks,
      config: { version: "resolution-risk-v1" }
    });

    await expect(failureService.comparePair("a-profile", "b-profile")).rejects.toThrow("compare_failed");
    expect(failureHooks.onAssessmentFailed).toHaveBeenCalledTimes(1);
  });

  it("updates same event/pair/version idempotently instead of duplicating", async () => {
    const profileA = makeProfile("a-profile");
    const profileB = makeProfile("b-profile");
    const persisted = assessmentRow("a-profile", "b-profile");

    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM resolution_profiles") && sql.includes("id = ANY")) {
        return makeQueryResult([toProfileRow(profileA), toProfileRow(profileB)]);
      }

      if (sql.includes("INSERT INTO resolution_risk_assessments")) {
        return makeQueryResult([toAssessmentRow(persisted)]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = new ResolutionRiskAssessmentService({
      pool: { query } as unknown as Pool,
      comparator: { compare: vi.fn(() => factorComparison) },
      scoringEngine: makeScoringEngineMock(() => persisted),
      logger,
      config: { version: "resolution-risk-v1" }
    });

    const first = await service.comparePair("a-profile", "b-profile");
    const second = await service.comparePair("b-profile", "a-profile");

    expect(first.id).toBe(second.id);
    expect(query.mock.calls.filter(([sql]) => (sql as string).includes("INSERT INTO resolution_risk_assessments"))).toHaveLength(2);
  });

  it("fails closed before persistence when replay capture is REQUIRED and capture fails", async () => {
    const profileA = makeProfile("a-profile");
    const profileB = makeProfile("b-profile");

    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM resolution_profiles") && sql.includes("id = ANY")) {
        return makeQueryResult([toProfileRow(profileA), toProfileRow(profileB)]);
      }

      if (sql.includes("INSERT INTO resolution_risk_assessments")) {
        throw new Error("assessment persistence should not be reached");
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const replayDecisionCaptureService = {
      capture: vi.fn(async () => {
        throw new ReplayDecisionCaptureError("RESOLUTION_RISK_ASSESSMENT", "REQUIRED", new Error("capture_failed"));
      }),
      getTotalFailureCount: vi.fn(() => 0)
    };

    const service = new ResolutionRiskAssessmentService({
      pool: { query } as unknown as Pool,
      comparator: { compare: vi.fn(() => factorComparison) },
      scoringEngine: makeScoringEngineMock(() => assessmentRow("a-profile", "b-profile")),
      logger,
      config: { version: "resolution-risk-v1" },
      replayDecisionCaptureService,
      replayCaptureConfig: {
        mode: "REQUIRED",
        configVersion: "cfg-v1",
        engineVersion: "eng-v1",
        featureFlags: { replay: true }
      }
    });

    await expect(service.comparePair("a-profile", "b-profile")).rejects.toBeInstanceOf(ReplayDecisionCaptureError);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO resolution_risk_assessments"), expect.anything());
  });

  it("continues to persistence when replay capture is BEST_EFFORT and capture fails", async () => {
    const profileA = makeProfile("a-profile");
    const profileB = makeProfile("b-profile");
    const persisted = assessmentRow("a-profile", "b-profile");

    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM resolution_profiles") && sql.includes("id = ANY")) {
        return makeQueryResult([toProfileRow(profileA), toProfileRow(profileB)]);
      }

      if (sql.includes("INSERT INTO resolution_risk_assessments")) {
        return makeQueryResult([toAssessmentRow(persisted)]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const replayDecisionCaptureService = {
      capture: vi.fn(async () => null),
      getTotalFailureCount: vi.fn(() => 1)
    };

    const service = new ResolutionRiskAssessmentService({
      pool: { query } as unknown as Pool,
      comparator: { compare: vi.fn(() => factorComparison) },
      scoringEngine: makeScoringEngineMock(() => persisted),
      logger,
      config: { version: "resolution-risk-v1" },
      replayDecisionCaptureService,
      replayCaptureConfig: {
        mode: "BEST_EFFORT",
        configVersion: "cfg-v1",
        engineVersion: "eng-v1",
        featureFlags: { replay: true }
      }
    });

    const result = await service.comparePair("a-profile", "b-profile");

    expect(result.id).toBe(persisted.id);
    expect(replayDecisionCaptureService.capture).toHaveBeenCalledOnce();
  });
});
