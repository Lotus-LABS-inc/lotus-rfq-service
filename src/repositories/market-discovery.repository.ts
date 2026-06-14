import type { Pool } from "pg";

import type {
  MarketDiscoveryCandidate,
  MarketDiscoveryLifecycleState,
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
  approved_canonical_event_id: string | null;
  approved_resolves_at: string | null;
  archive_eligible_after: string | null;
  archive_snapshot_candidate: boolean;
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
  lifecycleState?: MarketDiscoveryLifecycleState | undefined;
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

export interface MarketDiscoveryArchivePreview {
  retentionDays: number;
  cutoffIso: string;
  eligibleCandidateCount: number;
  eligibleSnapshotCount: number;
  reasonCounts: Readonly<Record<string, number>>;
  candidates: readonly {
    id: string;
    candidateKey: string;
    state: MarketDiscoveryState;
    eventTitle: string;
    reason: string;
  }[];
}

export interface MarketDiscoveryArchiveApplyResult extends MarketDiscoveryArchivePreview {
  deletedCandidateCount: number;
  deletedSnapshotCount: number;
}

export interface MarketDiscoverySnapshotHealthRow {
  venue: string;
  venueMarketId: string;
  title: string;
  active: boolean;
  outcomeCount: number;
  hasEventTitle: boolean;
  hasTokenSlugOrOrderbookKey: boolean;
  quoteReady: boolean;
  executionReady: boolean;
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
    if (filter.lifecycleState === "CLOSED") {
      conditions.push(`approved_event.resolves_at IS NOT NULL AND approved_event.resolves_at < NOW()`);
    } else if (filter.lifecycleState === "OPEN") {
      conditions.push(`(approved_event.resolves_at IS NULL OR approved_event.resolves_at >= NOW())`);
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
          candidate.approved_canonical_event_id::text,
          approved_event.resolves_at::text AS approved_resolves_at,
          CASE
            WHEN candidate.state IN ('APPROVED', 'REJECTED', 'SUPPRESSED')
             AND candidate.updated_at < NOW() - interval '7 days'
             AND (
               (approved_event.resolves_at IS NOT NULL AND approved_event.resolves_at < NOW() - interval '7 days')
               OR NOT EXISTS (
                 SELECT 1
                   FROM market_discovery_candidate_venue_profiles archive_link
                   JOIN venue_market_discovery_snapshots archive_snapshot
                     ON archive_snapshot.venue = archive_link.venue
                    AND archive_snapshot.venue_market_id = archive_link.venue_market_id
                  WHERE archive_link.candidate_id = candidate.id
                    AND archive_snapshot.active = true
                    AND COALESCE(archive_snapshot.resolves_at, archive_snapshot.expires_at, archive_snapshot.last_seen_at) >= NOW() - interval '7 days'
               )
             )
            THEN (candidate.updated_at + interval '7 days')::text
            ELSE NULL
          END AS archive_eligible_after,
          EXISTS (
            SELECT 1
              FROM market_discovery_candidate_venue_profiles archive_link
              JOIN venue_market_discovery_snapshots archive_snapshot
                ON archive_snapshot.venue = archive_link.venue
               AND archive_snapshot.venue_market_id = archive_link.venue_market_id
             WHERE archive_link.candidate_id = candidate.id
               AND archive_snapshot.active = false
          ) AS archive_snapshot_candidate,
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
        LEFT JOIN canonical_events approved_event
          ON approved_event.id = candidate.approved_canonical_event_id
        LEFT JOIN market_discovery_candidate_venue_profiles link
          ON link.candidate_id = candidate.id
        ${where}
        ORDER BY candidate.state ASC, candidate.confidence_score DESC, candidate.updated_at DESC`,
      params
    );
    return this.mapJoinedRows(result.rows);
  }

  public async listSnapshotHealthRows(): Promise<readonly MarketDiscoverySnapshotHealthRow[]> {
    const result = await this.pool.query<{
      venue: string;
      venue_market_id: string;
      title: string;
      active: boolean;
      outcome_count: string;
      has_event_title: boolean;
      has_token_slug_or_orderbook_key: boolean;
      quote_ready: boolean;
      execution_ready: boolean;
    }>(
      `SELECT
          venue,
          venue_market_id,
          title,
          active,
          COALESCE(jsonb_array_length(outcomes), 0)::text AS outcome_count,
          (
            COALESCE(NULLIF(raw_summary->>'eventTitle', ''), NULLIF(raw_summary->>'eventSlug', ''), NULLIF(title, '')) IS NOT NULL
          ) AS has_event_title,
          (
            COALESCE(jsonb_array_length(token_ids), 0) > 0
            OR NULLIF(slug, '') IS NOT NULL
            OR NULLIF(raw_summary->>'orderbookTopic', '') IS NOT NULL
            OR NULLIF(raw_summary->>'tokenId', '') IS NOT NULL
            OR NULLIF(raw_summary->>'conditionId', '') IS NOT NULL
          ) AS has_token_slug_or_orderbook_key,
          quote_ready,
          execution_ready
        FROM venue_market_discovery_snapshots
       ORDER BY venue ASC, last_seen_at DESC
       LIMIT 5000`
    );
    return result.rows.map((row) => ({
      venue: row.venue,
      venueMarketId: row.venue_market_id,
      title: row.title,
      active: row.active,
      outcomeCount: Number(row.outcome_count),
      hasEventTitle: row.has_event_title,
      hasTokenSlugOrOrderbookKey: row.has_token_slug_or_orderbook_key,
      quoteReady: row.quote_ready,
      executionReady: row.execution_ready
    }));
  }

  public async listPooledApprovedCanonicalEventIds(canonicalEventIds: readonly string[]): Promise<ReadonlySet<string>> {
    const ids = [...new Set(canonicalEventIds.filter((id) => id.length > 0))];
    if (ids.length === 0) {
      return new Set();
    }
    const result = await this.pool.query<{ canonical_event_id: string }>(
      `SELECT cem.canonical_event_id::text
         FROM canonical_executable_markets cem
         JOIN canonical_executable_market_members mem
           ON mem.canonical_executable_market_id = cem.id
        WHERE cem.canonical_event_id = ANY($1::uuid[])
        GROUP BY cem.id, cem.canonical_event_id
       HAVING COUNT(DISTINCT mem.venue_market_profile_id) >= 2`,
      [ids]
    );
    return new Set(result.rows.map((row) => row.canonical_event_id));
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
          candidate.approved_canonical_event_id::text,
          approved_event.resolves_at::text AS approved_resolves_at,
          CASE
            WHEN candidate.state IN ('APPROVED', 'REJECTED', 'SUPPRESSED')
             AND candidate.updated_at < NOW() - interval '7 days'
             AND (
               (approved_event.resolves_at IS NOT NULL AND approved_event.resolves_at < NOW() - interval '7 days')
               OR NOT EXISTS (
                 SELECT 1
                   FROM market_discovery_candidate_venue_profiles archive_link
                   JOIN venue_market_discovery_snapshots archive_snapshot
                     ON archive_snapshot.venue = archive_link.venue
                    AND archive_snapshot.venue_market_id = archive_link.venue_market_id
                  WHERE archive_link.candidate_id = candidate.id
                    AND archive_snapshot.active = true
                    AND COALESCE(archive_snapshot.resolves_at, archive_snapshot.expires_at, archive_snapshot.last_seen_at) >= NOW() - interval '7 days'
               )
             )
            THEN (candidate.updated_at + interval '7 days')::text
            ELSE NULL
          END AS archive_eligible_after,
          EXISTS (
            SELECT 1
              FROM market_discovery_candidate_venue_profiles archive_link
              JOIN venue_market_discovery_snapshots archive_snapshot
                ON archive_snapshot.venue = archive_link.venue
               AND archive_snapshot.venue_market_id = archive_link.venue_market_id
             WHERE archive_link.candidate_id = candidate.id
               AND archive_snapshot.active = false
          ) AS archive_snapshot_candidate,
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
        LEFT JOIN canonical_events approved_event
          ON approved_event.id = candidate.approved_canonical_event_id
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

  public async previewArchiveClosed(input: { retentionDays: number }): Promise<MarketDiscoveryArchivePreview> {
    const retentionDays = Math.max(1, Math.floor(input.retentionDays));
    const result = await this.pool.query<{
      id: string;
      candidate_key: string;
      state: MarketDiscoveryState;
      event_title: string;
      reason: string;
    }>(
      this.archiveCandidatePreviewSql(),
      [retentionDays]
    );
    const snapshots = await this.pool.query<{ count: string }>(this.archiveSnapshotCountSql(), [retentionDays]);
    const reasonCounts = await this.archiveReasonCounts(retentionDays);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    return {
      retentionDays,
      cutoffIso: cutoff.toISOString(),
      eligibleCandidateCount: result.rows.length,
      eligibleSnapshotCount: Number(snapshots.rows[0]?.count ?? 0),
      reasonCounts,
      candidates: result.rows.map((row) => ({
        id: row.id,
        candidateKey: row.candidate_key,
        state: row.state,
        eventTitle: row.event_title,
        reason: row.reason
      }))
    };
  }

  public async applyArchiveClosed(input: { retentionDays: number }): Promise<MarketDiscoveryArchiveApplyResult> {
    const preview = await this.previewArchiveClosed(input);
    await this.pool.query("BEGIN");
    try {
      const deleteLinks = await this.pool.query<{ id: string }>(
        `WITH eligible AS (${this.archiveCandidateIdsSql()})
         DELETE FROM market_discovery_candidate_venue_profiles link
          USING eligible
          WHERE link.candidate_id = eligible.id
          RETURNING eligible.id::text AS id`,
        [preview.retentionDays]
      );
      const deleteCandidates = await this.pool.query<{ id: string }>(
        `WITH eligible AS (${this.archiveCandidateIdsSql()})
         DELETE FROM market_discovery_candidates candidate
          USING eligible
          WHERE candidate.id = eligible.id
          RETURNING candidate.id::text AS id`,
        [preview.retentionDays]
      );
      const deleteSnapshots = await this.pool.query<{ id: string }>(
        `${this.archiveSnapshotDeleteSql()}`,
        [preview.retentionDays]
      );
      await this.pool.query("COMMIT");
      return {
        ...preview,
        deletedCandidateCount: deleteCandidates.rowCount ?? deleteLinks.rowCount ?? 0,
        deletedSnapshotCount: deleteSnapshots.rowCount ?? 0
      };
    } catch (error) {
      await this.pool.query("ROLLBACK");
      throw error;
    }
  }

  private mapJoinedRows(rows: readonly (CandidateRow & Partial<LinkRow>)[]): readonly MarketDiscoveryCandidate[] {
    const byId = new Map<string, MarketDiscoveryCandidate & { venueEvidence: MarketDiscoveryVenueEvidence[] }>();
    for (const row of rows) {
      const existing = byId.get(row.id) ?? {
        id: row.id,
        candidateKey: row.candidate_key,
        state: row.state,
        lifecycleState: this.lifecycleState(row),
        approvedCanonicalEventId: row.approved_canonical_event_id,
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
        routingStatus: row.state === "APPROVED" ? "APPROVED_SINGLE_VENUE" : "NOT_APPROVED",
        nextRoutingAction: row.state === "APPROVED" ? "RUN_MATCHER" : "NONE",
        routingReview: { exactPromotionIds: [], nearExactMatchIds: [] },
        archiveEligibility: this.archiveEligibility(row),
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

  private lifecycleState(row: CandidateRow): MarketDiscoveryLifecycleState {
    if (!row.approved_resolves_at) {
      return "OPEN";
    }
    const resolvesAt = new Date(row.approved_resolves_at);
    return !Number.isNaN(resolvesAt.getTime()) && resolvesAt.getTime() < Date.now() ? "CLOSED" : "OPEN";
  }

  private archiveEligibility(row: CandidateRow): MarketDiscoveryCandidate["archiveEligibility"] {
    const terminal = row.state === "APPROVED" || row.state === "REJECTED" || row.state === "SUPPRESSED";
    if (!terminal) {
      return {
        eligible: false,
        reason: "non_terminal_candidate",
        eligibleAfter: null
      };
    }
    if (!row.archive_eligible_after) {
      return {
        eligible: false,
        reason: row.approved_resolves_at ? "retention_window_not_elapsed" : "active_or_recent_snapshot_evidence",
        eligibleAfter: null
      };
    }
    const eligibleAfter = new Date(row.archive_eligible_after);
    const eligible = !Number.isNaN(eligibleAfter.getTime()) && eligibleAfter.getTime() <= Date.now();
    return {
      eligible,
      reason: eligible
        ? row.approved_resolves_at ? "closed_canonical_event_retention_elapsed" : "inactive_snapshot_retention_elapsed"
        : "retention_window_not_elapsed",
      eligibleAfter: row.archive_eligible_after
    };
  }

  private archiveCandidateIdsSql(): string {
    return `
      SELECT candidate.id
        FROM market_discovery_candidates candidate
        LEFT JOIN canonical_events approved_event
          ON approved_event.id = candidate.approved_canonical_event_id
       WHERE candidate.state IN ('APPROVED', 'REJECTED', 'SUPPRESSED')
         AND candidate.updated_at < NOW() - ($1::int * interval '1 day')
         AND (
           (approved_event.resolves_at IS NOT NULL AND approved_event.resolves_at < NOW() - ($1::int * interval '1 day'))
           OR NOT EXISTS (
             SELECT 1
               FROM market_discovery_candidate_venue_profiles link
               JOIN venue_market_discovery_snapshots snapshot
                 ON snapshot.venue = link.venue
                AND snapshot.venue_market_id = link.venue_market_id
              WHERE link.candidate_id = candidate.id
                AND snapshot.active = true
                AND COALESCE(snapshot.resolves_at, snapshot.expires_at, snapshot.last_seen_at) >= NOW() - ($1::int * interval '1 day')
           )
         )`;
  }

  private archiveCandidatePreviewSql(): string {
    return `
      WITH eligible AS (${this.archiveCandidateIdsSql()})
      SELECT
          candidate.id::text,
          candidate.candidate_key,
          candidate.state,
          candidate.event_title,
          CASE
            WHEN approved_event.resolves_at IS NOT NULL THEN 'closed_canonical_event_retention_elapsed'
            ELSE 'inactive_snapshot_retention_elapsed'
          END AS reason
        FROM eligible
        JOIN market_discovery_candidates candidate ON candidate.id = eligible.id
        LEFT JOIN canonical_events approved_event ON approved_event.id = candidate.approved_canonical_event_id
       ORDER BY candidate.updated_at ASC
       LIMIT 200`;
  }

  private async archiveReasonCounts(retentionDays: number): Promise<Record<string, number>> {
    const result = await this.pool.query<{ reason: string; count: string }>(
      `WITH annotated AS (
         SELECT
            candidate.id,
            CASE
              WHEN candidate.state NOT IN ('APPROVED', 'REJECTED', 'SUPPRESSED') THEN 'not_terminal'
              WHEN candidate.updated_at >= NOW() - ($1::int * interval '1 day') THEN 'retention_window_not_elapsed'
              WHEN approved_event.resolves_at IS NOT NULL AND approved_event.resolves_at >= NOW() THEN 'unresolved_live_blocked'
              WHEN approved_event.resolves_at IS NOT NULL AND approved_event.resolves_at < NOW() - ($1::int * interval '1 day') THEN 'closed_canonical_event_retention_elapsed'
              WHEN EXISTS (
                SELECT 1
                  FROM market_discovery_candidate_venue_profiles link
                  JOIN venue_market_discovery_snapshots snapshot
                    ON snapshot.venue = link.venue
                   AND snapshot.venue_market_id = link.venue_market_id
                 WHERE link.candidate_id = candidate.id
                   AND snapshot.active = true
                   AND COALESCE(snapshot.resolves_at, snapshot.expires_at, snapshot.last_seen_at) >= NOW() - ($1::int * interval '1 day')
              ) THEN 'active_or_recent_snapshot_evidence'
              ELSE 'inactive_snapshot_retention_elapsed'
            END AS reason
           FROM market_discovery_candidates candidate
           LEFT JOIN canonical_events approved_event
             ON approved_event.id = candidate.approved_canonical_event_id
       )
       SELECT reason, COUNT(*)::text AS count
         FROM annotated
        GROUP BY reason
        ORDER BY reason ASC`,
      [retentionDays]
    );
    return Object.fromEntries(result.rows.map((row) => [row.reason, Number(row.count)]));
  }

  private archiveSnapshotCountSql(): string {
    return `
      SELECT COUNT(*)::text AS count
        FROM venue_market_discovery_snapshots snapshot
       WHERE (
          snapshot.active = false
          OR COALESCE(snapshot.resolves_at, snapshot.expires_at) < NOW() - ($1::int * interval '1 day')
        )
         AND snapshot.last_seen_at < NOW() - ($1::int * interval '1 day')
         AND NOT EXISTS (
          SELECT 1
            FROM market_discovery_candidate_venue_profiles link
           WHERE link.venue = snapshot.venue
             AND link.venue_market_id = snapshot.venue_market_id
        )`;
  }

  private archiveSnapshotDeleteSql(): string {
    return `
      DELETE FROM venue_market_discovery_snapshots snapshot
       WHERE (
          snapshot.active = false
          OR COALESCE(snapshot.resolves_at, snapshot.expires_at) < NOW() - ($1::int * interval '1 day')
        )
         AND snapshot.last_seen_at < NOW() - ($1::int * interval '1 day')
         AND NOT EXISTS (
          SELECT 1
            FROM market_discovery_candidate_venue_profiles link
           WHERE link.venue = snapshot.venue
             AND link.venue_market_id = snapshot.venue_market_id
        )
      RETURNING snapshot.id::text`;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
