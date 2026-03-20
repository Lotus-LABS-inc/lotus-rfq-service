import type { Pool } from "pg";

import type {
    CanonicalEvent,
    CanonicalExecutableMarket,
    CompatibilityEdge,
    PropositionFingerprint,
    ResolutionProfile,
    SettlementProfile,
    VenueMarketProfile
} from "../canonical/canonicalization-types.js";

const asJson = (value: Record<string, unknown> | readonly unknown[] | null | undefined): string =>
    JSON.stringify(value ?? {});

export interface CanonicalGraphSnapshot {
    canonicalEvents: readonly CanonicalEvent[];
    venueMarketProfiles: readonly VenueMarketProfile[];
    propositionFingerprints: readonly PropositionFingerprint[];
    resolutionProfiles: readonly ResolutionProfile[];
    settlementProfiles: readonly SettlementProfile[];
    compatibilityEdges: readonly CompatibilityEdge[];
    executableMarkets: readonly CanonicalExecutableMarket[];
}

export interface PersistedProjectionReference {
    venueMarketProfileId: string;
    resolutionProfileId: string;
    canonicalEventId: string;
    canonicalMarketId: string;
}

export class CanonicalGraphRepository {
    public constructor(private readonly pool: Pool) {}

    public async persistSnapshot(snapshot: CanonicalGraphSnapshot): Promise<void> {
        await this.pool.query("BEGIN");
        try {
            for (const event of snapshot.canonicalEvents) {
                await this.upsertCanonicalEvent(event);
            }
            for (const profile of snapshot.venueMarketProfiles) {
                await this.upsertVenueMarketProfile(profile);
            }
            for (const fingerprint of snapshot.propositionFingerprints) {
                await this.upsertPropositionFingerprint(fingerprint);
            }
            for (const resolutionProfile of snapshot.resolutionProfiles) {
                await this.upsertVenueResolutionProfile(resolutionProfile);
            }
            for (const settlementProfile of snapshot.settlementProfiles) {
                await this.upsertVenueSettlementProfile(settlementProfile);
            }
            for (const executableMarket of snapshot.executableMarkets) {
                await this.upsertExecutableMarket(executableMarket);
                await this.replaceExecutableMarketMembers(executableMarket);
            }
            for (const edge of snapshot.compatibilityEdges) {
                await this.upsertCompatibilityEdge(edge);
            }
            await this.pool.query("COMMIT");
        } catch (error) {
            await this.pool.query("ROLLBACK");
            throw error;
        }
    }

    public async projectResolutionReadModels(snapshot: CanonicalGraphSnapshot): Promise<readonly PersistedProjectionReference[]> {
        await this.pool.query("BEGIN");
        try {
            const executableByProfileId = new Map<string, CanonicalExecutableMarket>();
            for (const market of snapshot.executableMarkets) {
                for (const profileId of market.memberProfileIds) {
                    executableByProfileId.set(profileId, market);
                }
            }

            const oldResolutionProfileIds = new Map<string, string>();
            const references: PersistedProjectionReference[] = [];

            for (const profile of snapshot.venueMarketProfiles) {
                const resolutionProfile = snapshot.resolutionProfiles.find(
                    (candidate) => candidate.venueMarketProfileId === profile.id
                );
                const settlementProfile = snapshot.settlementProfiles.find(
                    (candidate) => candidate.venueMarketProfileId === profile.id
                );
                const executableMarket = executableByProfileId.get(profile.id);
                if (!resolutionProfile || !settlementProfile || !executableMarket) {
                    continue;
                }

                await this.deleteStaleProjectedResolutionProfiles(profile.id, profile.venue, profile.venueMarketId);

                const result = await this.pool.query<{ id: string }>(
                    `INSERT INTO resolution_profiles (
                        venue,
                        venue_market_id,
                        canonical_event_id,
                        canonical_market_id,
                        oracle_type,
                        oracle_name,
                        resolution_authority_type,
                        primary_resolution_text,
                        supplemental_rules_text,
                        dispute_window_hours,
                        settlement_lag_hours,
                        market_type,
                        outcome_schema,
                        has_ambiguous_time_boundary,
                        has_ambiguous_jurisdiction_boundary,
                        has_ambiguous_source_reference,
                        historical_divergence_rate,
                        metadata
                    ) VALUES (
                        $1, $2, $3::uuid, $4, $5, $6, $7, $8, $9,
                        $10::numeric, $11::numeric, $12, $13::jsonb,
                        $14, $15, $16, $17::numeric, $18::jsonb
                    )
                    ON CONFLICT (venue, venue_market_id) DO UPDATE SET
                        canonical_event_id = EXCLUDED.canonical_event_id,
                        canonical_market_id = EXCLUDED.canonical_market_id,
                        oracle_type = EXCLUDED.oracle_type,
                        oracle_name = EXCLUDED.oracle_name,
                        resolution_authority_type = EXCLUDED.resolution_authority_type,
                        primary_resolution_text = EXCLUDED.primary_resolution_text,
                        supplemental_rules_text = EXCLUDED.supplemental_rules_text,
                        dispute_window_hours = EXCLUDED.dispute_window_hours,
                        settlement_lag_hours = EXCLUDED.settlement_lag_hours,
                        market_type = EXCLUDED.market_type,
                        outcome_schema = EXCLUDED.outcome_schema,
                        has_ambiguous_time_boundary = EXCLUDED.has_ambiguous_time_boundary,
                        has_ambiguous_jurisdiction_boundary = EXCLUDED.has_ambiguous_jurisdiction_boundary,
                        has_ambiguous_source_reference = EXCLUDED.has_ambiguous_source_reference,
                        historical_divergence_rate = EXCLUDED.historical_divergence_rate,
                        metadata = EXCLUDED.metadata,
                        updated_at = now()
                    RETURNING id`,
                    [
                        profile.venue,
                        profile.venueMarketId,
                        profile.canonicalEventId,
                        executableMarket.id,
                        profile.resolutionSource,
                        profile.resolutionTitle,
                        resolutionProfile.normalizedResolutionAuthorityType,
                        profile.resolutionTitle ?? profile.title,
                        resolutionProfile.ruleText,
                        resolutionProfile.disputeWindowHours,
                        settlementProfile.settlementLagHours,
                        profile.marketType ?? profile.marketClass,
                        JSON.stringify(profile.outcomeSchema),
                        resolutionProfile.ambiguityFlags.ambiguousTimeBoundary,
                        resolutionProfile.ambiguityFlags.ambiguousJurisdictionOrScope,
                        resolutionProfile.ambiguityFlags.ambiguousSourceReference,
                        null,
                        JSON.stringify({
                            canonicalCategory: profile.category,
                            feeModel: profile.feeModel,
                            network: profile.network,
                            chain: profile.chain,
                            sourceMetadataVersion: profile.sourceMetadataVersion,
                            venueMarketProfileId: profile.id,
                            executableMarketId: executableMarket.id
                        })
                    ]
                );

                const persistedId = result.rows[0]?.id;
                if (!persistedId) {
                    continue;
                }

                oldResolutionProfileIds.set(profile.id, persistedId);
                references.push({
                    venueMarketProfileId: profile.id,
                    resolutionProfileId: persistedId,
                    canonicalEventId: profile.canonicalEventId,
                    canonicalMarketId: executableMarket.id
                });
            }

            for (const edge of snapshot.compatibilityEdges) {
                const left = oldResolutionProfileIds.get(edge.marketAProfileId);
                const right = oldResolutionProfileIds.get(edge.marketBProfileId);
                if (!left || !right) {
                    continue;
                }

                await this.pool.query(
                    `INSERT INTO resolution_risk_assessments (
                        canonical_event_id,
                        canonical_market_id,
                        market_a_profile_id,
                        market_b_profile_id,
                        risk_score,
                        confidence_score,
                        equivalence_class,
                        factor_breakdown,
                        reasons,
                        version,
                        computed_at,
                        liquidity_cost,
                        max_settlement_delay_hours
                    ) VALUES (
                        $1::uuid, $2, $3::uuid, $4::uuid, $5::numeric, $6::numeric, $7, $8::jsonb, $9::jsonb, $10, $11, $12::numeric, $13::numeric
                    )
                    ON CONFLICT (canonical_event_id, canonical_market_id, market_a_profile_id, market_b_profile_id, version)
                    DO UPDATE SET
                        risk_score = EXCLUDED.risk_score,
                        confidence_score = EXCLUDED.confidence_score,
                        equivalence_class = EXCLUDED.equivalence_class,
                        factor_breakdown = EXCLUDED.factor_breakdown,
                        reasons = EXCLUDED.reasons,
                        computed_at = EXCLUDED.computed_at,
                        liquidity_cost = EXCLUDED.liquidity_cost,
                        max_settlement_delay_hours = EXCLUDED.max_settlement_delay_hours`,
                    [
                        edge.canonicalEventId,
                        this.findExecutableMarketIdForEdge(snapshot.executableMarkets, edge),
                        left,
                        right,
                        this.projectRiskScore(edge.compatibilityClass),
                        edge.confidenceScore,
                        this.projectEquivalenceClass(edge.compatibilityClass, edge.liquidityCostBps),
                        JSON.stringify(edge.factorBreakdown),
                        JSON.stringify(edge.reasons),
                        edge.scoringVersion,
                        edge.computedAt,
                        edge.liquidityCostBps === null ? null : (Number(edge.liquidityCostBps) / 10000).toString(),
                        edge.maxSettlementDelayHours
                    ]
                );
            }

            await this.pool.query("COMMIT");
            return references;
        } catch (error) {
            await this.pool.query("ROLLBACK");
            throw error;
        }
    }

    private async upsertCanonicalEvent(event: CanonicalEvent): Promise<void> {
        await this.pool.query(
            `INSERT INTO canonical_events (
                id,
                proposition_key,
                title,
                normalized_proposition_text,
                canonical_category,
                market_class,
                proposition_confidence_score,
                starts_at,
                expires_at,
                resolves_at,
                source_hints,
                metadata
            ) VALUES (
                $1::uuid, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11::jsonb, $12::jsonb
            )
            ON CONFLICT (id) DO UPDATE SET
                proposition_key = EXCLUDED.proposition_key,
                title = EXCLUDED.title,
                normalized_proposition_text = EXCLUDED.normalized_proposition_text,
                canonical_category = EXCLUDED.canonical_category,
                market_class = EXCLUDED.market_class,
                proposition_confidence_score = EXCLUDED.proposition_confidence_score,
                starts_at = EXCLUDED.starts_at,
                expires_at = EXCLUDED.expires_at,
                resolves_at = EXCLUDED.resolves_at,
                source_hints = EXCLUDED.source_hints,
                metadata = EXCLUDED.metadata,
                updated_at = now()`,
            [
                event.id,
                event.propositionKey,
                event.title,
                event.normalizedPropositionText,
                event.category,
                event.marketClass,
                event.propositionConfidenceScore,
                event.startsAt,
                event.expiresAt,
                event.resolvesAt,
                asJson(event.sourceHints),
                asJson(event.metadata)
            ]
        );
    }

    private async upsertVenueMarketProfile(profile: VenueMarketProfile): Promise<void> {
        await this.pool.query(
            `INSERT INTO venue_market_profiles (
                id,
                canonical_event_id,
                venue,
                venue_market_id,
                title,
                description,
                market_type,
                market_class,
                outcomes,
                outcome_schema,
                topics,
                canonical_category,
                published_at,
                expires_at,
                resolves_at,
                fees,
                fee_model,
                resolution_source,
                resolution_title,
                resolution_rules_text,
                network,
                chain,
                raw_source_payload,
                normalized_payload,
                mapping_lineage,
                confidence_score,
                source_metadata_version
            ) VALUES (
                $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12,
                $13, $14, $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23::jsonb, $24::jsonb, $25::jsonb, $26::numeric, $27
            )
            ON CONFLICT (venue, venue_market_id) DO UPDATE SET
                canonical_event_id = EXCLUDED.canonical_event_id,
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                market_type = EXCLUDED.market_type,
                market_class = EXCLUDED.market_class,
                outcomes = EXCLUDED.outcomes,
                outcome_schema = EXCLUDED.outcome_schema,
                topics = EXCLUDED.topics,
                canonical_category = EXCLUDED.canonical_category,
                published_at = EXCLUDED.published_at,
                expires_at = EXCLUDED.expires_at,
                resolves_at = EXCLUDED.resolves_at,
                fees = EXCLUDED.fees,
                fee_model = EXCLUDED.fee_model,
                resolution_source = EXCLUDED.resolution_source,
                resolution_title = EXCLUDED.resolution_title,
                resolution_rules_text = EXCLUDED.resolution_rules_text,
                network = EXCLUDED.network,
                chain = EXCLUDED.chain,
                raw_source_payload = EXCLUDED.raw_source_payload,
                normalized_payload = EXCLUDED.normalized_payload,
                mapping_lineage = EXCLUDED.mapping_lineage,
                confidence_score = EXCLUDED.confidence_score,
                source_metadata_version = EXCLUDED.source_metadata_version,
                updated_at = now()`,
            [
                profile.id,
                profile.canonicalEventId,
                profile.venue,
                profile.venueMarketId,
                profile.title,
                profile.description,
                profile.marketType,
                profile.marketClass,
                JSON.stringify(profile.outcomes),
                JSON.stringify(profile.outcomeSchema),
                JSON.stringify(profile.topics),
                profile.category,
                profile.publishedAt,
                profile.expiresAt,
                profile.resolvesAt,
                JSON.stringify(profile.fees),
                profile.feeModel,
                profile.resolutionSource,
                profile.resolutionTitle,
                profile.resolutionRulesText,
                profile.network,
                profile.chain,
                asJson(profile.rawSourcePayload),
                asJson(profile.normalizedPayload),
                JSON.stringify(profile.mappingLineage),
                profile.confidenceScore,
                profile.sourceMetadataVersion
            ]
        );
    }

    private async upsertPropositionFingerprint(fingerprint: PropositionFingerprint): Promise<void> {
        await this.pool.query(
            `INSERT INTO proposition_fingerprints (
                id,
                venue_market_profile_id,
                subject,
                condition_text,
                time_boundary_text,
                market_class,
                normalized_outcome_schema,
                normalized_proposition_text,
                grouping_hints,
                ambiguity_flags,
                confidence_score,
                broad_fingerprint_key,
                strict_fingerprint_key,
                fingerprint_hash
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, $11::numeric, $12, $13, $14
            )
            ON CONFLICT (venue_market_profile_id) DO UPDATE SET
                subject = EXCLUDED.subject,
                condition_text = EXCLUDED.condition_text,
                time_boundary_text = EXCLUDED.time_boundary_text,
                market_class = EXCLUDED.market_class,
                normalized_outcome_schema = EXCLUDED.normalized_outcome_schema,
                normalized_proposition_text = EXCLUDED.normalized_proposition_text,
                grouping_hints = EXCLUDED.grouping_hints,
                ambiguity_flags = EXCLUDED.ambiguity_flags,
                confidence_score = EXCLUDED.confidence_score,
                broad_fingerprint_key = EXCLUDED.broad_fingerprint_key,
                strict_fingerprint_key = EXCLUDED.strict_fingerprint_key,
                fingerprint_hash = EXCLUDED.fingerprint_hash,
                updated_at = now()`,
            [
                fingerprint.id,
                fingerprint.venueMarketProfileId,
                fingerprint.subject,
                fingerprint.condition,
                fingerprint.timeBoundary,
                fingerprint.marketClass,
                JSON.stringify(fingerprint.normalizedOutcomeSchema),
                fingerprint.normalizedPropositionText,
                asJson(fingerprint.groupingHints),
                JSON.stringify(fingerprint.ambiguityFlags),
                fingerprint.confidenceScore,
                fingerprint.broadFingerprintKey,
                fingerprint.strictFingerprintKey,
                fingerprint.fingerprintHash
            ]
        );
    }

    private async upsertVenueResolutionProfile(profile: ResolutionProfile): Promise<void> {
        await this.pool.query(
            `INSERT INTO venue_resolution_profiles (
                id,
                venue_market_profile_id,
                resolution_source,
                resolution_title,
                normalized_resolution_authority_type,
                rule_text,
                source_hierarchy,
                dispute_window_hours,
                ambiguous_time_boundary,
                ambiguous_source_reference,
                ambiguous_jurisdiction_or_scope,
                metadata_completeness_score,
                metadata
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7::jsonb, $8::numeric, $9, $10, $11, $12::numeric, $13::jsonb
            )
            ON CONFLICT (venue_market_profile_id) DO UPDATE SET
                resolution_source = EXCLUDED.resolution_source,
                resolution_title = EXCLUDED.resolution_title,
                normalized_resolution_authority_type = EXCLUDED.normalized_resolution_authority_type,
                rule_text = EXCLUDED.rule_text,
                source_hierarchy = EXCLUDED.source_hierarchy,
                dispute_window_hours = EXCLUDED.dispute_window_hours,
                ambiguous_time_boundary = EXCLUDED.ambiguous_time_boundary,
                ambiguous_source_reference = EXCLUDED.ambiguous_source_reference,
                ambiguous_jurisdiction_or_scope = EXCLUDED.ambiguous_jurisdiction_or_scope,
                metadata_completeness_score = EXCLUDED.metadata_completeness_score,
                metadata = EXCLUDED.metadata,
                updated_at = now()`,
            [
                profile.id,
                profile.venueMarketProfileId,
                profile.resolutionSource,
                profile.resolutionTitle,
                profile.normalizedResolutionAuthorityType,
                profile.ruleText,
                asJson(profile.sourceHierarchy),
                profile.disputeWindowHours,
                profile.ambiguityFlags.ambiguousTimeBoundary,
                profile.ambiguityFlags.ambiguousSourceReference,
                profile.ambiguityFlags.ambiguousJurisdictionOrScope,
                profile.metadataCompletenessScore,
                asJson(profile.metadata)
            ]
        );
    }

    private async upsertVenueSettlementProfile(profile: SettlementProfile): Promise<void> {
        await this.pool.query(
            `INSERT INTO venue_settlement_profiles (
                id,
                venue_market_profile_id,
                settlement_type,
                settlement_lag_hours,
                dispute_window_hours,
                finality_lag_hours,
                payout_timing_hours,
                fee_on_entry,
                fee_on_exit,
                time_sensitive_fee_behavior,
                requires_conservative_anchor,
                metadata_completeness_score,
                metadata
            ) VALUES (
                $1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8, $9, $10, $11, $12::numeric, $13::jsonb
            )
            ON CONFLICT (venue_market_profile_id) DO UPDATE SET
                settlement_type = EXCLUDED.settlement_type,
                settlement_lag_hours = EXCLUDED.settlement_lag_hours,
                dispute_window_hours = EXCLUDED.dispute_window_hours,
                finality_lag_hours = EXCLUDED.finality_lag_hours,
                payout_timing_hours = EXCLUDED.payout_timing_hours,
                fee_on_entry = EXCLUDED.fee_on_entry,
                fee_on_exit = EXCLUDED.fee_on_exit,
                time_sensitive_fee_behavior = EXCLUDED.time_sensitive_fee_behavior,
                requires_conservative_anchor = EXCLUDED.requires_conservative_anchor,
                metadata_completeness_score = EXCLUDED.metadata_completeness_score,
                metadata = EXCLUDED.metadata,
                updated_at = now()`,
            [
                profile.id,
                profile.venueMarketProfileId,
                profile.settlementType,
                profile.settlementLagHours,
                profile.disputeWindowHours,
                profile.finalityLagHours,
                profile.payoutTimingHours,
                profile.feeOnEntry,
                profile.feeOnExit,
                profile.timeSensitiveFeeBehavior,
                profile.requiresConservativeAnchor,
                profile.metadataCompletenessScore,
                asJson(profile.metadata)
            ]
        );
    }

    private async upsertCompatibilityEdge(edge: CompatibilityEdge): Promise<void> {
        await this.pool.query(
            `INSERT INTO compatibility_edges (
                id,
                canonical_event_id,
                market_a_profile_id,
                market_b_profile_id,
                compatibility_class,
                reasons,
                proposition_similarity_score,
                outcome_schema_compatibility_score,
                timing_compatibility_score,
                resolution_risk_score,
                settlement_risk_score,
                structure_risk_score,
                fee_compatibility_score,
                confidence_score,
                capital_lock_hours,
                max_settlement_delay_hours,
                liquidity_cost_model_version,
                liquidity_cost_bps,
                anchored_finality_hours,
                requires_conservative_settlement_anchor,
                factor_breakdown,
                scoring_version,
                computed_at
            ) VALUES (
                $1, $2::uuid, $3, $4, $5, $6::jsonb, $7::numeric, $8::numeric, $9::numeric, $10::numeric,
                $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric, $17, $18::numeric,
                $19::numeric, $20, $21::jsonb, $22, $23
            )
            ON CONFLICT (canonical_event_id, market_a_profile_id, market_b_profile_id, scoring_version) DO UPDATE SET
                compatibility_class = EXCLUDED.compatibility_class,
                reasons = EXCLUDED.reasons,
                proposition_similarity_score = EXCLUDED.proposition_similarity_score,
                outcome_schema_compatibility_score = EXCLUDED.outcome_schema_compatibility_score,
                timing_compatibility_score = EXCLUDED.timing_compatibility_score,
                resolution_risk_score = EXCLUDED.resolution_risk_score,
                settlement_risk_score = EXCLUDED.settlement_risk_score,
                structure_risk_score = EXCLUDED.structure_risk_score,
                fee_compatibility_score = EXCLUDED.fee_compatibility_score,
                confidence_score = EXCLUDED.confidence_score,
                capital_lock_hours = EXCLUDED.capital_lock_hours,
                max_settlement_delay_hours = EXCLUDED.max_settlement_delay_hours,
                liquidity_cost_model_version = EXCLUDED.liquidity_cost_model_version,
                liquidity_cost_bps = EXCLUDED.liquidity_cost_bps,
                anchored_finality_hours = EXCLUDED.anchored_finality_hours,
                requires_conservative_settlement_anchor = EXCLUDED.requires_conservative_settlement_anchor,
                factor_breakdown = EXCLUDED.factor_breakdown,
                computed_at = EXCLUDED.computed_at`,
            [
                edge.id,
                edge.canonicalEventId,
                edge.marketAProfileId,
                edge.marketBProfileId,
                edge.compatibilityClass,
                JSON.stringify(edge.reasons),
                edge.propositionSimilarityScore,
                edge.outcomeSchemaCompatibilityScore,
                edge.timingCompatibilityScore,
                edge.resolutionRiskScore,
                edge.settlementRiskScore,
                edge.structureRiskScore,
                edge.feeCompatibilityScore,
                edge.confidenceScore,
                edge.capitalLockHours,
                edge.maxSettlementDelayHours,
                edge.liquidityCostModelVersion,
                edge.liquidityCostBps,
                edge.anchoredFinalityHours,
                edge.requiresConservativeSettlementAnchor,
                JSON.stringify(edge.factorBreakdown),
                edge.scoringVersion,
                edge.computedAt
            ]
        );
    }

    private async upsertExecutableMarket(market: CanonicalExecutableMarket): Promise<void> {
        await this.pool.query(
            `INSERT INTO canonical_executable_markets (
                id,
                canonical_event_id,
                display_name,
                market_class,
                compatibility_policy,
                risk_class,
                member_count,
                metadata
            ) VALUES (
                $1, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb
            )
            ON CONFLICT (id) DO UPDATE SET
                canonical_event_id = EXCLUDED.canonical_event_id,
                display_name = EXCLUDED.display_name,
                market_class = EXCLUDED.market_class,
                compatibility_policy = EXCLUDED.compatibility_policy,
                risk_class = EXCLUDED.risk_class,
                member_count = EXCLUDED.member_count,
                metadata = EXCLUDED.metadata,
                updated_at = now()`,
            [
                market.id,
                market.canonicalEventId,
                market.displayName,
                market.marketClass,
                market.compatibilityPolicy,
                market.riskClass,
                market.memberProfileIds.length,
                asJson(market.metadata)
            ]
        );
    }

    private async replaceExecutableMarketMembers(market: CanonicalExecutableMarket): Promise<void> {
        await this.pool.query(
            `DELETE FROM canonical_executable_market_members
              WHERE canonical_executable_market_id = $1`,
            [market.id]
        );

        for (const memberProfileId of market.memberProfileIds) {
            await this.pool.query(
                `INSERT INTO canonical_executable_market_members (
                    canonical_executable_market_id,
                    venue_market_profile_id
                ) VALUES ($1, $2)
                ON CONFLICT DO NOTHING`,
                [market.id, memberProfileId]
            );
        }
    }

    private findExecutableMarketIdForEdge(
        executableMarkets: readonly CanonicalExecutableMarket[],
        edge: CompatibilityEdge
    ): string {
        const market = executableMarkets.find(
            (candidate) =>
                candidate.memberProfileIds.includes(edge.marketAProfileId) &&
                candidate.memberProfileIds.includes(edge.marketBProfileId)
        );

        return market?.id ?? `isolated-${edge.marketAProfileId}-${edge.marketBProfileId}`;
    }

    private async deleteStaleProjectedResolutionProfiles(
        venueMarketProfileId: string,
        venue: VenueMarketProfile["venue"],
        venueMarketId: string
    ): Promise<void> {
        const staleProfiles = await this.pool.query<{ id: string }>(
            `SELECT id
               FROM resolution_profiles
              WHERE metadata->>'venueMarketProfileId' = $1
                AND (venue <> $2 OR venue_market_id <> $3)`,
            [venueMarketProfileId, venue, venueMarketId]
        );

        if (staleProfiles.rowCount === 0) {
            return;
        }

        const staleIds = staleProfiles.rows.map((row) => row.id);
        await this.pool.query(
            `DELETE FROM resolution_risk_assessments
              WHERE market_a_profile_id = ANY($1::uuid[])
                 OR market_b_profile_id = ANY($1::uuid[])`,
            [staleIds]
        );
        await this.pool.query(`DELETE FROM resolution_profiles WHERE id = ANY($1::uuid[])`, [staleIds]);
    }

    private projectEquivalenceClass(
        compatibilityClass: CompatibilityEdge["compatibilityClass"],
        liquidityCostBps: string | null
    ): "SAFE_EQUIVALENT" | "EQUIVALENT_WITH_LAG" | "CAUTION" | "HIGH_RISK" | "DO_NOT_POOL" {
        switch (compatibilityClass) {
            case "EQUIVALENT":
                return liquidityCostBps !== null && Number(liquidityCostBps) > 0
                    ? "EQUIVALENT_WITH_LAG"
                    : "SAFE_EQUIVALENT";
            case "COMPATIBLE_WITH_CAUTION":
                return "CAUTION";
            case "DISTINCT":
                return "HIGH_RISK";
            case "DO_NOT_POOL":
            default:
                return "DO_NOT_POOL";
        }
    }

    private projectRiskScore(compatibilityClass: CompatibilityEdge["compatibilityClass"]): string {
        switch (compatibilityClass) {
            case "EQUIVALENT":
                return "0.1";
            case "COMPATIBLE_WITH_CAUTION":
                return "0.5";
            case "DISTINCT":
                return "0.8";
            case "DO_NOT_POOL":
            default:
                return "1";
        }
    }
}
