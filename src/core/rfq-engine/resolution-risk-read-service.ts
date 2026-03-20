import type { Pool } from "pg";
import type { ResolutionRiskAssessment } from "./resolution-risk.types.js";

interface ResolutionRiskAssessmentRow {
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

export interface ResolutionRiskPairLookup {
    profileAId: string;
    profileBId: string;
}

export interface IResolutionRiskReadService {
    getAssessmentByProfilePair(profileAId: string, profileBId: string): Promise<ResolutionRiskAssessment | null>;
    getAssessmentsByProfilePairs(
        pairs: readonly ResolutionRiskPairLookup[]
    ): Promise<ReadonlyMap<string, ResolutionRiskAssessment>>;
}

export interface ResolutionRiskReadServiceDeps {
    pool: Pool;
    version: string;
}

export class ResolutionRiskReadService implements IResolutionRiskReadService {
    private readonly pool: Pool;
    private readonly version: string;

    public constructor(deps: ResolutionRiskReadServiceDeps) {
        this.pool = deps.pool;
        this.version = deps.version;
    }

    public async getAssessmentByProfilePair(
        profileAId: string,
        profileBId: string
    ): Promise<ResolutionRiskAssessment | null> {
        const ordered = canonicalizePair(profileAId, profileBId);
        const result = await this.pool.query<ResolutionRiskAssessmentRow>(
            `SELECT *
               FROM resolution_risk_assessments
              WHERE market_a_profile_id = $1
                AND market_b_profile_id = $2
                AND version = $3
              LIMIT 1`,
            [ordered.profileAId, ordered.profileBId, this.version]
        );

        return result.rowCount === 0 ? null : mapAssessmentRow(result.rows[0]!);
    }

    public async getAssessmentsByProfilePairs(
        pairs: readonly ResolutionRiskPairLookup[]
    ): Promise<ReadonlyMap<string, ResolutionRiskAssessment>> {
        const orderedPairs = dedupeOrderedPairs(pairs);
        if (orderedPairs.length === 0) {
            return new Map();
        }

        const values: string[] = [];
        const predicates: string[] = [];
        for (const pair of orderedPairs) {
            const index = values.length;
            values.push(pair.profileAId, pair.profileBId);
            predicates.push(`(market_a_profile_id = $${index + 1} AND market_b_profile_id = $${index + 2})`);
        }
        values.push(this.version);
        const versionParam = `$${values.length}`;

        const result = await this.pool.query<ResolutionRiskAssessmentRow>(
            `SELECT *
               FROM resolution_risk_assessments
              WHERE (${predicates.join(" OR ")})
                AND version = ${versionParam}`,
            values
        );

        const assessments = new Map<string, ResolutionRiskAssessment>();
        for (const row of result.rows) {
            const assessment = mapAssessmentRow(row);
            assessments.set(pairKey(assessment.marketAProfileId, assessment.marketBProfileId), assessment);
        }
        return assessments;
    }
}

export const canonicalizePair = (
    profileAId: string,
    profileBId: string
): { profileAId: string; profileBId: string } =>
    profileAId.localeCompare(profileBId) <= 0
        ? { profileAId, profileBId }
        : { profileAId: profileBId, profileBId: profileAId };

export const pairKey = (profileAId: string, profileBId: string): string => {
    const ordered = canonicalizePair(profileAId, profileBId);
    return `${ordered.profileAId}|${ordered.profileBId}`;
};

const dedupeOrderedPairs = (
    pairs: readonly ResolutionRiskPairLookup[]
): ReadonlyArray<{ profileAId: string; profileBId: string }> => {
    const seen = new Set<string>();
    const orderedPairs: Array<{ profileAId: string; profileBId: string }> = [];

    for (const pair of pairs) {
        const ordered = canonicalizePair(pair.profileAId, pair.profileBId);
        const key = pairKey(ordered.profileAId, ordered.profileBId);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        orderedPairs.push(ordered);
    }

    return orderedPairs;
};

const mapAssessmentRow = (row: ResolutionRiskAssessmentRow): ResolutionRiskAssessment => ({
    id: row.id,
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    marketAProfileId: row.market_a_profile_id,
    marketBProfileId: row.market_b_profile_id,
    riskScore: row.risk_score,
    confidenceScore: row.confidence_score,
    equivalenceClass: row.equivalence_class,
    factorBreakdown: row.factor_breakdown,
    reasons: row.reasons,
    version: row.version,
    computedAt: new Date(row.computed_at),
    liquidityCost: row.liquidity_cost ?? undefined,
    maxSettlementDelayHours: row.max_settlement_delay_hours ? Number(row.max_settlement_delay_hours) : undefined
});
