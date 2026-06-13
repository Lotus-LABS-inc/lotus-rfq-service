import type { Pool } from "pg";

import type {
  MarketDiscoveryCandidate,
  MarketDiscoveryState,
  MarketDiscoveryVenueEvidence,
  VenueMarketDiscoverySnapshot
} from "../market-discovery/market-discovery-types.js";
import { FRONTEND_CURATED_CATALOG_SOURCE } from "./frontend-market-approval.repository.js";

const asJson = (value: unknown): string => JSON.stringify(value ?? null);

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const asRecordArray = <T extends Record<string, unknown>>(value: unknown): readonly T[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is T => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];

interface CandidateRow {
  id: string;
  candidate_key: string;
  state: MarketDiscoveryState;
  candidate_type: MarketDiscoveryCandidate["candidateType"];
  source_kind: MarketDiscoveryCandidate["sourceKind"];
  event_title: string;
  normalized_event_title: string;
  category: MarketDiscoveryCandidate["category"];
  market_class: MarketDiscoveryCandidate["marketClass"];
  semantic_boundary_key: string | null;
  venue_count: number;
  shared_outcome_count: number;
  confidence_score: string;
  reason_codes: unknown;
  venues: unknown;
  shared_outcomes: unknown;
  missing_outcomes: unknown;
  novelty_summary: unknown;
  draft_semantic_core: unknown;
  match_dimensions: unknown;
  unsafe_grouping_warnings: unknown;
  approval_actions: unknown;
  metadata: unknown;
}

interface LinkRow {
  candidate_id: string;
  venue_market_profile_id: string;
  canonical_event_id: string | null;
  canonical_market_id: string | null;
  venue: MarketDiscoveryVenueEvidence["venue"];
  venue_market_id: string;
  title: string;
  outcomes: unknown;
  quote_ready: boolean;
  execution_ready: boolean;
  evidence_label: string;
  historical_row_count: number;
}

export interface MarketDiscoveryCandidateFilter {
  state?: MarketDiscoveryState | undefined;
  candidateType?: MarketDiscoveryCandidate["candidateType"] | undefined;
  category?: MarketDiscoveryCandidate["category"] | undefined;
  search?: string | undefined;
}

export interface ApproveDiscoveryCandidateInput {
  candidateId: string;
  canonicalEventId: string;
  makeLive: boolean;
  approvedBy: string;
  reason: string;
}

export class MarketDiscoveryRepository {
  public constructor(private readonly pool: Pool) {}

  public async upsertVenueSnapshots(snapshots: readonly VenueMarketDiscoverySnapshot[]): Promise<number> {
    if (snapshots.length === 0) {
      return 0;
    }
    for (const snapshot of snapshots) {
      await this.pool.query(
        `INSERT INTO venue_market_discovery_snapshots (
            id,
            venue,
            venue_market_id,
            active,
            title,
            normalized_title,
            category,
            market_class,
            outcomes,
            semantic_boundary_key,
            expires_at,
            resolves_at,
            rules_text,
            resolution_source,
            slug,
            source_url,
            token_ids,
            quote_ready,
            execution_ready,
            source_hash,
            source_kind,
            raw_summary
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13,
            $14, $15, $16, $17::jsonb, $18, $19, $20, $21, $22::jsonb
        )
        ON CONFLICT (venue, venue_market_id) DO UPDATE SET
            active = EXCLUDED.active,
            title = EXCLUDED.title,
            normalized_title = EXCLUDED.normalized_title,
            category = EXCLUDED.category,
            market_class = EXCLUDED.market_class,
            outcomes = EXCLUDED.outcomes,
            semantic_boundary_key = EXCLUDED.semantic_boundary_key,
            expires_at = EXCLUDED.expires_at,
            resolves_at = EXCLUDED.resolves_at,
            rules_text = EXCLUDED.rules_text,
            resolution_source = EXCLUDED.resolution_source,
            slug = EXCLUDED.slug,
            source_url = EXCLUDED.source_url,
            token_ids = EXCLUDED.token_ids,
            quote_ready = EXCLUDED.quote_ready,
            execution_ready = EXCLUDED.execution_ready,
            source_hash = EXCLUDED.source_hash,
            source_kind = EXCLUDED.source_kind,
            raw_summary = EXCLUDED.raw_summary,
            last_seen_at = now(),
            updated_at = now()`,
        [
          snapshot.id,
          snapshot.venue,
          snapshot.venueMarketId,
          snapshot.active,
          snapshot.title,
          snapshot.normalizedTitle,
          snapshot.category,
          snapshot.marketClass,
          asJson(snapshot.outcomes),
          snapshot.semanticBoundaryKey,
          snapshot.expiresAt,
          snapshot.resolvesAt,
          snapshot.rulesText,
          snapshot.resolutionSource,
          snapshot.slug,
          snapshot.sourceUrl,
          asJson(snapshot.tokenIds),
          snapshot.quoteReady,
          snapshot.executionReady,
          snapshot.sourceHash,
          snapshot.sourceKind,
          asJson(snapshot.rawSummary)
        ]
      );
    }
    return snapshots.length;
  }

  public async upsertCandidates(candidates: readonly MarketDiscoveryCandidate[]): Promise<number> {
    if (candidates.length === 0) {
      return 0;
    }
    await this.pool.query("BEGIN");
    try {
      for (const candidate of candidates) {
        await this.pool.query(
          `INSERT INTO market_discovery_candidates (
              id,
              candidate_key,
              state,
              candidate_type,
              source_kind,
              event_title,
              normalized_event_title,
              category,
              market_class,
              semantic_boundary_key,
              venue_count,
              shared_outcome_count,
              confidence_score,
              reason_codes,
              venues,
              shared_outcomes,
              missing_outcomes,
              novelty_summary,
              draft_semantic_core,
              match_dimensions,
              unsafe_grouping_warnings,
              approval_actions,
              metadata
          ) VALUES (
              $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::numeric,
              $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb,
              $20::jsonb, $21::jsonb, $22::jsonb, $23::jsonb
          )
          ON CONFLICT (candidate_key) DO UPDATE SET
              state = CASE
                  WHEN market_discovery_candidates.state IN ('APPROVED', 'REJECTED', 'SUPPRESSED')
                    THEN market_discovery_candidates.state
                  ELSE EXCLUDED.state
              END,
              candidate_type = EXCLUDED.candidate_type,
              source_kind = EXCLUDED.source_kind,
              event_title = EXCLUDED.event_title,
              normalized_event_title = EXCLUDED.normalized_event_title,
              category = EXCLUDED.category,
              market_class = EXCLUDED.market_class,
              semantic_boundary_key = EXCLUDED.semantic_boundary_key,
              venue_count = EXCLUDED.venue_count,
              shared_outcome_count = EXCLUDED.shared_outcome_count,
              confidence_score = EXCLUDED.confidence_score,
              reason_codes = EXCLUDED.reason_codes,
              venues = EXCLUDED.venues,
              shared_outcomes = EXCLUDED.shared_outcomes,
              missing_outcomes = EXCLUDED.missing_outcomes,
              novelty_summary = EXCLUDED.novelty_summary,
              draft_semantic_core = EXCLUDED.draft_semantic_core,
              match_dimensions = EXCLUDED.match_dimensions,
              unsafe_grouping_warnings = EXCLUDED.unsafe_grouping_warnings,
              approval_actions = EXCLUDED.approval_actions,
              metadata = EXCLUDED.metadata,
              updated_at = now()`,
          [
            candidate.id,
            candidate.candidateKey,
            candidate.state,
            candidate.candidateType,
            candidate.sourceKind,
            candidate.eventTitle,
            candidate.normalizedEventTitle,
            candidate.category,
            candidate.marketClass,
            candidate.semanticBoundaryKey,
            candidate.venueCount,
            candidate.sharedOutcomeCount,
            candidate.confidenceScore.toString(),
            asJson(candidate.reasonCodes),
            asJson(candidate.venues),
            asJson(candidate.sharedOutcomes),
            asJson(candidate.missingOutcomes),
            asJson(candidate.noveltySummary),
            asJson(candidate.draftSemanticCore),
            asJson(candidate.matchDimensions),
            asJson(candidate.unsafeGroupingWarnings),
            asJson(candidate.approvalActions),
            asJson(candidate.metadata)
          ]
        );

        await this.pool.query(
          `DELETE FROM market_discovery_candidate_venue_profiles WHERE candidate_id = $1::uuid`,
          [candidate.id]
        );
        for (const venue of candidate.venueEvidence) {
          await this.pool.query(
            `INSERT INTO market_discovery_candidate_venue_profiles (
                candidate_id,
                venue_market_profile_id,
                canonical_event_id,
                canonical_market_id,
                venue,
                venue_market_id,
                title,
                outcomes,
                quote_ready,
                execution_ready,
                evidence_label,
                historical_row_count
            ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
            ON CONFLICT (candidate_id, venue_market_profile_id) DO UPDATE SET
                canonical_event_id = EXCLUDED.canonical_event_id,
                canonical_market_id = EXCLUDED.canonical_market_id,
                venue = EXCLUDED.venue,
                venue_market_id = EXCLUDED.venue_market_id,
                title = EXCLUDED.title,
                outcomes = EXCLUDED.outcomes,
                quote_ready = EXCLUDED.quote_ready,
                execution_ready = EXCLUDED.execution_ready,
                evidence_label = EXCLUDED.evidence_label,
                historical_row_count = EXCLUDED.historical_row_count,
                updated_at = now()`,
            [
              candidate.id,
              venue.venueMarketProfileId,
              venue.canonicalEventId,
              venue.canonicalMarketId,
              venue.venue,
              venue.venueMarketId,
              venue.title,
              asJson(venue.outcomes),
              venue.quoteReady,
              venue.executionReady,
              venue.evidenceLabel,
              venue.historicalRowCount
            ]
          );
        }
      }
      await this.pool.query("COMMIT");
      return candidates.length;
    } catch (error) {
      await this.pool.query("ROLLBACK");
      throw error;
    }
  }

  public async retireStaleNonTerminalCandidates(observedCandidateKeys: readonly string[]): Promise<number> {
    if (observedCandidateKeys.length === 0) {
      return 0;
    }
    const result = await this.pool.query(
      `UPDATE market_discovery_candidates
          SET state = 'REJECTED',
              reviewed_by = 'market-discovery-worker',
              review_reason = 'auto_suppressed_not_observed_in_latest_discovery_run',
              reviewed_at = now(),
              rejected_at = now(),
              updated_at = now(),
              metadata = metadata || jsonb_build_object(
                'autoSuppressed', true,
                'autoSuppressedReason', 'not_observed_in_latest_discovery_run',
                'autoSuppressedAt', now()
              )
        WHERE state NOT IN ('APPROVED', 'REJECTED', 'SUPPRESSED')
          AND metadata->>'source' = 'semantic-expansion-inventory'
          AND candidate_key <> ALL($1::text[])`,
      [[...observedCandidateKeys]]
    );
    return result.rowCount ?? 0;
  }

  public async listCandidates(filter: MarketDiscoveryCandidateFilter = {}): Promise<readonly MarketDiscoveryCandidate[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filter.state) {
      params.push(filter.state);
      conditions.push(`candidate.state = $${params.length}`);
    }
    if (filter.candidateType) {
      params.push(filter.candidateType);
      conditions.push(`candidate.candidate_type = $${params.length}`);
    }
    if (filter.category) {
      params.push(filter.category);
      conditions.push(`candidate.category = $${params.length}`);
    }
    if (filter.search && filter.search.trim().length > 0) {
      params.push(`%${filter.search.trim()}%`);
      conditions.push(`candidate.event_title ILIKE $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query<CandidateRow & Partial<LinkRow>>(
      `SELECT
          candidate.id::text,
          candidate.candidate_key,
          candidate.state,
          candidate.candidate_type,
          candidate.source_kind,
          candidate.event_title,
          candidate.normalized_event_title,
          candidate.category,
          candidate.market_class,
          candidate.semantic_boundary_key,
          candidate.venue_count,
          candidate.shared_outcome_count,
          candidate.confidence_score::text,
          candidate.reason_codes,
          candidate.venues,
          candidate.shared_outcomes,
          candidate.missing_outcomes,
          candidate.novelty_summary,
          candidate.draft_semantic_core,
          candidate.match_dimensions,
          candidate.unsafe_grouping_warnings,
          candidate.approval_actions,
          candidate.metadata,
          link.candidate_id::text,
          link.venue_market_profile_id,
          link.canonical_event_id::text,
          link.canonical_market_id,
          link.venue,
          link.venue_market_id,
          link.title,
          link.outcomes,
          link.quote_ready,
          link.execution_ready,
          link.evidence_label,
          link.historical_row_count
        FROM market_discovery_candidates candidate
        LEFT JOIN market_discovery_candidate_venue_profiles link
          ON link.candidate_id = candidate.id
        ${where}
        ORDER BY candidate.state ASC, candidate.confidence_score DESC, candidate.updated_at DESC`,
      params
    );
    return this.mapJoinedRows(result.rows);
  }

  public async getCandidate(candidateId: string): Promise<MarketDiscoveryCandidate | null> {
    const result = await this.pool.query<CandidateRow & Partial<LinkRow>>(
      `SELECT
          candidate.id::text,
          candidate.candidate_key,
          candidate.state,
          candidate.candidate_type,
          candidate.source_kind,
          candidate.event_title,
          candidate.normalized_event_title,
          candidate.category,
          candidate.market_class,
          candidate.semantic_boundary_key,
          candidate.venue_count,
          candidate.shared_outcome_count,
          candidate.confidence_score::text,
          candidate.reason_codes,
          candidate.venues,
          candidate.shared_outcomes,
          candidate.missing_outcomes,
          candidate.novelty_summary,
          candidate.draft_semantic_core,
          candidate.match_dimensions,
          candidate.unsafe_grouping_warnings,
          candidate.approval_actions,
          candidate.metadata,
          link.candidate_id::text,
          link.venue_market_profile_id,
          link.canonical_event_id::text,
          link.canonical_market_id,
          link.venue,
          link.venue_market_id,
          link.title,
          link.outcomes,
          link.quote_ready,
          link.execution_ready,
          link.evidence_label,
          link.historical_row_count
        FROM market_discovery_candidates candidate
        LEFT JOIN market_discovery_candidate_venue_profiles link
          ON link.candidate_id = candidate.id
       WHERE candidate.id = $1::uuid`,
      [candidateId]
    );
    return this.mapJoinedRows(result.rows)[0] ?? null;
  }

  public async markRejected(input: { candidateId: string; rejectedBy: string; reason: string }): Promise<void> {
    await this.pool.query(
      `UPDATE market_discovery_candidates
          SET state = 'REJECTED',
              reviewed_by = $2,
              review_reason = $3,
              reviewed_at = now(),
              rejected_at = now(),
              updated_at = now()
        WHERE id = $1::uuid`,
      [input.candidateId, input.rejectedBy, input.reason]
    );
  }

  public async markApproved(input: ApproveDiscoveryCandidateInput): Promise<void> {
    await this.pool.query(
      `UPDATE market_discovery_candidates
          SET state = 'APPROVED',
              approved_canonical_event_id = $2::uuid,
              reviewed_by = $3,
              review_reason = $4,
              reviewed_at = now(),
              approved_at = now(),
              updated_at = now()
        WHERE id = $1::uuid`,
      [input.candidateId, input.canonicalEventId, input.approvedBy, input.reason]
    );
    await this.pool.query(
      `INSERT INTO frontend_market_approvals (
          canonical_event_id,
          status,
          approved_by,
          approval_reason,
          metadata
      ) VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
      ON CONFLICT (canonical_event_id) DO UPDATE SET
          status = EXCLUDED.status,
          approved_by = EXCLUDED.approved_by,
          approval_reason = EXCLUDED.approval_reason,
          metadata = frontend_market_approvals.metadata || EXCLUDED.metadata,
          approved_at = now(),
          updated_at = now()`,
      [
        input.canonicalEventId,
        input.makeLive ? "APPROVED" : "HIDDEN",
        input.approvedBy,
        input.reason,
        // When making it live, stamp the source tag the public catalog filters on
        // (FRONTEND_CURATED_CATALOG_SOURCE) so the market actually surfaces to users. Discovery
        // provenance is preserved under discoverySource. Hidden approvals omit the curated tag
        // (status HIDDEN keeps them invisible; a later catalog resume stamps the tag).
        JSON.stringify(
          input.makeLive
            ? {
                source: FRONTEND_CURATED_CATALOG_SOURCE,
                discoverySource: "market-discovery-v2",
                discoveryCandidateId: input.candidateId,
                defaultVisibility: "APPROVED"
              }
            : {
                discoverySource: "market-discovery-v2",
                discoveryCandidateId: input.candidateId,
                defaultVisibility: "HIDDEN"
              }
        )
      ]
    );
  }

  private mapJoinedRows(rows: readonly (CandidateRow & Partial<LinkRow>)[]): readonly MarketDiscoveryCandidate[] {
    const byId = new Map<string, MarketDiscoveryCandidate & { venueEvidence: MarketDiscoveryVenueEvidence[] }>();
    for (const row of rows) {
      const existing = byId.get(row.id) ?? {
        id: row.id,
        candidateKey: row.candidate_key,
        state: row.state,
        candidateType: row.candidate_type,
        sourceKind: row.source_kind,
        eventTitle: row.event_title,
        normalizedEventTitle: row.normalized_event_title,
        category: row.category,
        marketClass: row.market_class,
        semanticBoundaryKey: row.semantic_boundary_key,
        venueCount: row.venue_count,
        sharedOutcomeCount: row.shared_outcome_count,
        confidenceScore: Number(row.confidence_score),
        reasonCodes: asStringArray(row.reason_codes),
        noveltySummary: isRecord(row.novelty_summary) ? row.novelty_summary : {},
        draftSemanticCore: isRecord(row.draft_semantic_core)
          ? row.draft_semantic_core as unknown as MarketDiscoveryCandidate["draftSemanticCore"]
          : null,
        matchDimensions: isRecord(row.match_dimensions)
          ? row.match_dimensions as unknown as MarketDiscoveryCandidate["matchDimensions"]
          : {
              eventTitle: false,
              category: false,
              marketFamily: false,
              subject: false,
              condition: false,
              timeBoundary: false,
              outcomes: false,
              rulesSource: false,
              venueCount: false
            },
        unsafeGroupingWarnings: asStringArray(row.unsafe_grouping_warnings),
        approvalActions: asStringArray(row.approval_actions),
        venues: asStringArray(row.venues) as MarketDiscoveryCandidate["venues"],
        sharedOutcomes: asStringArray(row.shared_outcomes),
        missingOutcomes: asRecordArray(row.missing_outcomes) as MarketDiscoveryCandidate["missingOutcomes"],
        venueEvidence: [],
        metadata: isRecord(row.metadata) ? row.metadata : {}
      };
      if (row.venue_market_profile_id && row.venue && row.venue_market_id && row.title) {
        existing.venueEvidence.push({
          venueMarketProfileId: row.venue_market_profile_id,
          canonicalEventId: row.canonical_event_id ?? null,
          canonicalMarketId: row.canonical_market_id ?? null,
          venue: row.venue,
          venueMarketId: row.venue_market_id,
          title: row.title,
          outcomes: asStringArray(row.outcomes),
          quoteReady: row.quote_ready ?? false,
          executionReady: row.execution_ready ?? false,
          evidenceLabel: row.evidence_label ?? "",
          historicalRowCount: row.historical_row_count ?? 0
        });
      }
      byId.set(row.id, existing);
    }
    return [...byId.values()];
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
