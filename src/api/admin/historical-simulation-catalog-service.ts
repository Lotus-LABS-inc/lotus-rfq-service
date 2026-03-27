import type { Logger } from "pino";
import type { Pool } from "pg";

import type {
  NormalizedResolutionProfile,
  ResolutionRiskAssessment
} from "../../core/rfq-engine/resolution-risk.types.js";
import type {
  ResolutionRiskCanonicalInspection,
  ResolutionRiskFreshness
} from "./resolution-risk-admin-service.js";

interface HistoricalSimulationProfileRow {
  id: string;
  venue: string;
  venue_market_id: string;
  canonical_event_id: string;
  canonical_market_id: string;
  oracle_type: string | null;
  oracle_name: string | null;
  resolution_authority_type: string | null;
  primary_resolution_text: string | null;
  supplemental_rules_text: string | null;
  dispute_window_hours: string | null;
  settlement_lag_hours: string | null;
  market_type: string | null;
  outcome_schema: Record<string, unknown> | null;
  has_ambiguous_time_boundary: boolean;
  has_ambiguous_jurisdiction_boundary: boolean;
  has_ambiguous_source_reference: boolean;
  historical_divergence_rate: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface HistoricalSimulationAssessmentRow {
  id: string;
  canonical_event_id: string;
  canonical_market_id: string;
  market_a_profile_id: string;
  market_b_profile_id: string;
  risk_score: string;
  confidence_score: string;
  equivalence_class: ResolutionRiskAssessment["equivalenceClass"];
  factor_breakdown: Record<string, unknown>;
  reasons: readonly string[];
  version: string;
  computed_at: Date;
  liquidity_cost: string | null;
  max_settlement_delay_hours: string | null;
}

export interface HistoricalSimulationCatalogServiceDeps {
  pool: Pool;
  version: string;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

const createNoopLogger = (): Pick<Logger, "info" | "warn" | "error"> => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
});

const historicalFactorReasonByKey: Readonly<Record<string, string>> = {
  propositionSimilarity: "Exact proposition semantics were manually curated across the accepted venue profiles.",
  outcomeSchemaCompatibility: "Binary outcome semantics match on the same named participant or threshold proposition.",
  structureCompatibility: "Binary outcome semantics match on the same named participant or threshold proposition.",
  timingCompatibility: "Historical replay stays conservative for cross-venue settlement/finality timing.",
  resolutionCompatibility: "Historical replay stays conservative for cross-venue settlement/finality timing.",
  settlementCompatibility: "Historical replay stays conservative for cross-venue settlement/finality timing."
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeFactorBreakdown = (
  factorBreakdown: Record<string, unknown>,
  confidenceScore: string,
  reasons: readonly string[]
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(factorBreakdown).map(([factor, rawValue]) => {
      const factorRecord = asRecord(rawValue);
      if (
        factorRecord !== null &&
        (Object.prototype.hasOwnProperty.call(factorRecord, "score") ||
          Object.prototype.hasOwnProperty.call(factorRecord, "confidence") ||
          Object.prototype.hasOwnProperty.call(factorRecord, "reason"))
      ) {
        return [factor, rawValue];
      }

      return [
        factor,
        {
          score: parseFiniteNumber(rawValue),
          confidence: parseFiniteNumber(confidenceScore),
          reason:
            historicalFactorReasonByKey[factor] ??
            reasons[0] ??
            "Historical catalog factor recorded during exact-route curation."
        }
      ];
    })
  );

const mapProfileRow = (row: HistoricalSimulationProfileRow): NormalizedResolutionProfile => ({
  id: row.id,
  venue: row.venue,
  venueMarketId: row.venue_market_id,
  canonicalEventId: row.canonical_event_id,
  canonicalMarketId: row.canonical_market_id,
  oracleType: row.oracle_type,
  oracleName: row.oracle_name,
  resolutionAuthorityType: row.resolution_authority_type,
  primaryResolutionText: row.primary_resolution_text,
  supplementalRulesText: row.supplemental_rules_text,
  disputeWindowHours: row.dispute_window_hours,
  settlementLagHours: row.settlement_lag_hours,
  marketType: row.market_type,
  outcomeSchema: row.outcome_schema,
  hasAmbiguousTimeBoundary: row.has_ambiguous_time_boundary,
  hasAmbiguousJurisdictionBoundary: row.has_ambiguous_jurisdiction_boundary,
  hasAmbiguousSourceReference: row.has_ambiguous_source_reference,
  historicalDivergenceRate: row.historical_divergence_rate,
  metadata: row.metadata,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at)
});

const mapAssessmentRow = (row: HistoricalSimulationAssessmentRow): ResolutionRiskAssessment => ({
  id: row.id,
  canonicalEventId: row.canonical_event_id,
  canonicalMarketId: row.canonical_market_id,
  marketAProfileId: row.market_a_profile_id,
  marketBProfileId: row.market_b_profile_id,
  riskScore: row.risk_score,
  confidenceScore: row.confidence_score,
  equivalenceClass: row.equivalence_class,
  factorBreakdown: normalizeFactorBreakdown(row.factor_breakdown, row.confidence_score, row.reasons),
  reasons: row.reasons,
  version: row.version,
  computedAt: new Date(row.computed_at),
  liquidityCost: row.liquidity_cost ?? undefined,
  maxSettlementDelayHours: row.max_settlement_delay_hours ? Number(row.max_settlement_delay_hours) : undefined
});

const buildFreshness = (input: {
  profiles: readonly NormalizedResolutionProfile[];
  assessments: readonly ResolutionRiskAssessment[];
}): ResolutionRiskFreshness => {
  const versions = [...new Set(input.assessments.map((assessment) => assessment.version))];
  const lastComputedAt = input.assessments.reduce<Date | null>(
    (current, assessment) => (current === null || assessment.computedAt > current ? assessment.computedAt : current),
    null
  );
  const latestProfileUpdatedAt = input.profiles.reduce<Date | null>(
    (current, profile) => (current === null || profile.updatedAt > current ? profile.updatedAt : current),
    null
  );
  const expectedPairCount = input.profiles.length < 2 ? 0 : (input.profiles.length * (input.profiles.length - 1)) / 2;
  const persistedPairCount = new Set(
    input.assessments.map((assessment) => `${assessment.marketAProfileId}|${assessment.marketBProfileId}`)
  ).size;
  const isComplete = input.profiles.length >= 2 && persistedPairCount === expectedPairCount;
  const isStale =
    !isComplete || lastComputedAt === null || (latestProfileUpdatedAt !== null && lastComputedAt < latestProfileUpdatedAt);

  return {
    profileCount: input.profiles.length,
    expectedPairCount,
    persistedPairCount,
    lastComputedAt,
    latestProfileUpdatedAt,
    isComplete,
    isStale,
    hasMixedVersions: versions.length > 1
  };
};

export class HistoricalSimulationCatalogService {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;

  public constructor(private readonly deps: HistoricalSimulationCatalogServiceDeps) {
    this.logger = deps.logger ?? createNoopLogger();
  }

  public async hasCanonicalEvent(eventId: string): Promise<boolean> {
    const result = await this.deps.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
           FROM historical_simulation_profiles
          WHERE canonical_event_id = $1
       ) AS exists`,
      [eventId]
    );

    return result.rows[0]?.exists === true;
  }

  public async getCanonicalInspection(eventId: string): Promise<ResolutionRiskCanonicalInspection> {
    const [profilesResult, assessmentsResult] = await Promise.all([
      this.deps.pool.query<HistoricalSimulationProfileRow>(
        `SELECT *
           FROM historical_simulation_profiles
          WHERE canonical_event_id = $1
          ORDER BY id ASC`,
        [eventId]
      ),
      this.deps.pool.query<HistoricalSimulationAssessmentRow>(
        `SELECT *
           FROM historical_simulation_risk_assessments
          WHERE canonical_event_id = $1
          ORDER BY market_a_profile_id ASC, market_b_profile_id ASC, computed_at DESC, version DESC`,
        [eventId]
      )
    ]);

    const profiles = profilesResult.rows.map(mapProfileRow);
    const assessments = this.selectEffectiveAssessments(assessmentsResult.rows.map(mapAssessmentRow));
    const freshness = buildFreshness({ profiles, assessments });
    const versions = [...new Set(assessments.map((assessment) => assessment.version))];

    this.logger.info(
      {
        canonicalEventId: eventId,
        profileCount: profiles.length,
        assessmentCount: assessments.length
      },
      "Loaded historical simulation catalog inspection."
    );

    return {
      canonicalEventId: eventId,
      profiles,
      assessments,
      scoringVersion: versions.length === 0 ? this.deps.version : versions.length === 1 ? versions[0]! : "mixed",
      freshness
    };
  }

  private selectEffectiveAssessments(
    assessments: readonly ResolutionRiskAssessment[]
  ): readonly ResolutionRiskAssessment[] {
    const selected = new Map<string, ResolutionRiskAssessment>();

    for (const assessment of assessments) {
      const key = `${assessment.marketAProfileId}|${assessment.marketBProfileId}`;
      if (!selected.has(key)) {
        selected.set(key, assessment);
      }
    }

    return [...selected.values()].sort(
      (left, right) =>
        left.marketAProfileId.localeCompare(right.marketAProfileId) ||
        left.marketBProfileId.localeCompare(right.marketBProfileId)
    );
  }
}
