import type { Pool } from "pg";

import type { CompatibilityDecision } from "../canonical/compatibility-decision.js";
import type { InterpretedContract } from "../canonical/interpreted-contract-types.js";
import type { CompatibilityClass } from "../canonical/canonicalization-types.js";
import type { CompatibilityReasonCode } from "../canonical/compatibility-reason-codes.js";

interface InterpretedContractRow {
    id: string;
    venue_market_profile_id: string;
    venue: string;
    venue_market_id: string;
    canonical_event_id: string;
    proposition_semantics: Record<string, unknown>;
    outcome_semantics: Record<string, unknown>;
    timing_semantics: Record<string, unknown>;
    resolution_semantics: Record<string, unknown>;
    settlement_semantics: Record<string, unknown>;
    ambiguity_flags: Record<string, unknown>;
    interpretation_confidence: string;
    source_metadata_version: string;
    raw_lineage_references: Record<string, unknown>;
    is_poolable: boolean;
    created_at: Date;
    updated_at: Date;
}

interface CompatibilityDecisionRow {
    id: string;
    canonical_event_id: string;
    interpreted_contract_a_id: string;
    interpreted_contract_b_id: string;
    compatibility_version_id: string;
    replay_envelope_id: string | null;
    compatibility_class: CompatibilityClass;
    reason_codes: CompatibilityReasonCode[];
    hard_blocks: string[];
    caution_conditions: string[];
    soft_penalties: Record<string, unknown>[];
    confidence_score: string;
    factor_breakdown: Record<string, unknown>;
    supporting_reasons: string[];
    reviewer_override_metadata: Record<string, unknown>;
    computed_at: Date;
}

export class CanonicalCompatibilityRepository {
    public constructor(private readonly pool: Pool) {}

    public async upsertInterpretedContract(contract: InterpretedContract): Promise<void> {
        await this.pool.query(
            `INSERT INTO interpreted_contracts (
                id,
                venue_market_profile_id,
                venue,
                venue_market_id,
                canonical_event_id,
                proposition_semantics,
                outcome_semantics,
                timing_semantics,
                resolution_semantics,
                settlement_semantics,
                ambiguity_flags,
                interpretation_confidence,
                source_metadata_version,
                raw_lineage_references,
                is_poolable,
                created_at,
                updated_at
            ) VALUES (
                $1, $2, $3, $4, $5::uuid, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb,
                $11::jsonb, $12::numeric, $13, $14::jsonb, $15, $16, $17
            )
            ON CONFLICT (id) DO UPDATE SET
                proposition_semantics = EXCLUDED.proposition_semantics,
                outcome_semantics = EXCLUDED.outcome_semantics,
                timing_semantics = EXCLUDED.timing_semantics,
                resolution_semantics = EXCLUDED.resolution_semantics,
                settlement_semantics = EXCLUDED.settlement_semantics,
                ambiguity_flags = EXCLUDED.ambiguity_flags,
                interpretation_confidence = EXCLUDED.interpretation_confidence,
                raw_lineage_references = EXCLUDED.raw_lineage_references,
                is_poolable = EXCLUDED.is_poolable,
                updated_at = EXCLUDED.updated_at`,
            [
                contract.id,
                contract.venueMarketProfileId,
                contract.venue,
                contract.venueMarketId,
                contract.canonicalEventId,
                JSON.stringify(contract.normalizedPropositionSemantics),
                JSON.stringify(contract.normalizedOutcomeSemantics),
                JSON.stringify(contract.normalizedTimingSemantics),
                JSON.stringify(contract.normalizedResolutionSemantics),
                JSON.stringify(contract.normalizedSettlementSemantics),
                JSON.stringify(contract.ambiguityFlags),
                contract.interpretationConfidence,
                contract.sourceMetadataVersion,
                JSON.stringify(contract.rawLineageReferences),
                contract.isPoolable,
                contract.createdAt,
                contract.updatedAt
            ]
        );
    }

    public async upsertCompatibilityDecision(decision: CompatibilityDecision): Promise<void> {
        await this.pool.query(
            `INSERT INTO compatibility_decisions (
                id,
                canonical_event_id,
                interpreted_contract_a_id,
                interpreted_contract_b_id,
                compatibility_version_id,
                replay_envelope_id,
                compatibility_class,
                reason_codes,
                hard_blocks,
                caution_conditions,
                soft_penalties,
                confidence_score,
                factor_breakdown,
                supporting_reasons,
                reviewer_override_metadata,
                computed_at
            ) VALUES (
                $1, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, $8::jsonb, $9::jsonb, $10::jsonb,
                $11::jsonb, $12::numeric, $13::jsonb, $14::jsonb, $15::jsonb, $16
            )
            ON CONFLICT (canonical_event_id, interpreted_contract_a_id, interpreted_contract_b_id, compatibility_version_id)
            DO UPDATE SET
                replay_envelope_id = EXCLUDED.replay_envelope_id,
                compatibility_class = EXCLUDED.compatibility_class,
                reason_codes = EXCLUDED.reason_codes,
                hard_blocks = EXCLUDED.hard_blocks,
                caution_conditions = EXCLUDED.caution_conditions,
                soft_penalties = EXCLUDED.soft_penalties,
                confidence_score = EXCLUDED.confidence_score,
                factor_breakdown = EXCLUDED.factor_breakdown,
                supporting_reasons = EXCLUDED.supporting_reasons,
                reviewer_override_metadata = EXCLUDED.reviewer_override_metadata,
                computed_at = EXCLUDED.computed_at`,
            [
                decision.id,
                decision.canonicalEventId,
                decision.interpretedContractAId,
                decision.interpretedContractBId,
                decision.compatibilityVersionId,
                decision.replayReference,
                decision.compatibilityClass,
                JSON.stringify(decision.reasonCodes),
                JSON.stringify(decision.hardBlocks),
                JSON.stringify(decision.cautionConditions),
                JSON.stringify(decision.softPenalties),
                decision.confidenceScore,
                JSON.stringify(decision.factorBreakdown),
                JSON.stringify(decision.supportingReasons),
                JSON.stringify(decision.reviewerOverrideMetadata),
                decision.computedAt
            ]
        );
    }

    public async getCompatibilityDecisionById(id: string): Promise<CompatibilityDecision | null> {
        const result = await this.pool.query<CompatibilityDecisionRow>(
            `SELECT *
               FROM compatibility_decisions
              WHERE id = $1
              LIMIT 1`,
            [id]
        );
        return result.rows[0] ? mapCompatibilityDecisionRow(result.rows[0]) : null;
    }

    public async listCompatibilityDecisionsForEvent(canonicalEventId: string): Promise<readonly CompatibilityDecision[]> {
        const result = await this.pool.query<CompatibilityDecisionRow>(
            `SELECT *
               FROM compatibility_decisions
              WHERE canonical_event_id = $1::uuid
              ORDER BY computed_at DESC`,
            [canonicalEventId]
        );
        return result.rows.map(mapCompatibilityDecisionRow);
    }
}

const mapCompatibilityDecisionRow = (row: CompatibilityDecisionRow): CompatibilityDecision => ({
    id: row.id,
    canonicalEventId: row.canonical_event_id,
    interpretedContractAId: row.interpreted_contract_a_id,
    interpretedContractBId: row.interpreted_contract_b_id,
    compatibilityVersionId: row.compatibility_version_id,
    replayReference: row.replay_envelope_id,
    compatibilityClass: row.compatibility_class,
    reasonCodes: row.reason_codes,
    hardBlocks: row.hard_blocks,
    cautionConditions: row.caution_conditions,
    softPenalties: row.soft_penalties,
    confidenceScore: row.confidence_score,
    factorBreakdown: row.factor_breakdown,
    supportingReasons: row.supporting_reasons,
    reviewerOverrideMetadata: row.reviewer_override_metadata,
    computedAt: new Date(row.computed_at)
});
