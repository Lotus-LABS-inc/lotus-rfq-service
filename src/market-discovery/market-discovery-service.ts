import type { Pool } from "pg";

import { buildStablePromotionIds, readArtifact, type CrossVenueMatchReport } from "../operations/semantic-expansion/shared.js";
import {
  loadSemanticExpansionInventory,
  type SemanticExpansionInventoryRow,
  type SemanticPromotionCandidate
} from "../operations/semantic-expansion/shared.js";
import {
  syncSemanticExactOverlaps,
  type SemanticExactSyncSummary
} from "../operations/semantic-expansion/semantic-exact-sync.js";
import {
  buildMarketDiscoveryCandidates,
  buildMarketDiscoveryCandidatesFromSnapshots
} from "./market-discovery-clustering.js";
import type {
  MarketDiscoveryCandidate,
  MarketDiscoveryCandidateType,
  MarketDiscoveryRunSummary,
  MarketDiscoveryState,
  MarketDiscoveryTopicBundle
} from "./market-discovery-types.js";
import { buildMarketDiscoveryTopicBundles } from "./market-discovery-topic-bundles.js";
import { MarketDiscoveryRepository } from "../repositories/market-discovery.repository.js";
import type {
  MarketDiscoveryArchiveApplyResult,
  MarketDiscoveryArchivePreview
} from "../repositories/market-discovery.repository.js";
import { CuratedMarketAdminService } from "../api/admin/curated-market-admin-service.js";
import type { SemanticDiscoveryCategory } from "../simulation/semantic-rulepack.js";
import type { CanonicalCategory } from "../canonical/canonicalization-types.js";
import {
  UpstreamMarketDiscoveryCollector,
  type UpstreamMarketDiscoveryCollectorResult
} from "./upstream-market-discovery-collector.js";

export class MarketDiscoveryServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDiscoveryServiceError";
  }
}

export interface MarketDiscoveryApprovalResult {
  candidate: MarketDiscoveryCandidate;
  canonicalEventId: string;
  // Present for MERGE_SUGGESTION/ENRICHMENT_ONLY (exact-overlap sync path); absent for
  // NEW_DISCOVERY (projected as a fresh cross-venue canonical event).
  summary?: SemanticExactSyncSummary;
  createdMarketIds?: string[];
}

export interface MarketDiscoveryReviewSummary {
  observedAt: string;
  totalCandidates: number;
  lanes: {
    topicBundles: number;
    newDiscoveries: number;
    mergeSuggestions: number;
    metadataEnrichment: number;
    lowConfidence: number;
    approved: number;
    rejected: number;
  };
  byState: Readonly<Record<MarketDiscoveryState, number>>;
  byCandidateType: Readonly<Record<MarketDiscoveryCandidateType, number>>;
  lowConfidenceMissingFieldCounts: Readonly<Record<string, number>>;
  lowConfidenceReasonCounts: Readonly<Record<string, number>>;
}

export class MarketDiscoveryService {
  private static readonly MATCH_REPORT_PATH = "docs/cross-venue-match-report.json";

  public constructor(
    private readonly pool: Pool,
    private readonly repository: MarketDiscoveryRepository = new MarketDiscoveryRepository(pool),
    private readonly repoRoot: string = process.cwd(),
    private readonly upstreamCollector: { collect: () => Promise<UpstreamMarketDiscoveryCollectorResult> } =
      new UpstreamMarketDiscoveryCollector(),
    private readonly curatedAdmin: CuratedMarketAdminService = new CuratedMarketAdminService(pool)
  ) {}

  public async runOnce(): Promise<MarketDiscoveryRunSummary> {
    const observedAt = new Date().toISOString();
    const inventory = await loadSemanticExpansionInventory(this.pool);
    const { activeRows, candidates: inventoryCandidates } = buildMarketDiscoveryCandidates(inventory);
    const upstream = await this.upstreamCollector.collect();
    const snapshotPersistedCount = await this.repository.upsertVenueSnapshots(upstream.snapshots);
    const {
      activeRows: upstreamActiveRows,
      candidates: upstreamCandidates
    } = buildMarketDiscoveryCandidatesFromSnapshots(upstream.snapshots, inventory);
    const candidates = this.mergeCandidates([...upstreamCandidates, ...inventoryCandidates]);
    const persistedCount = await this.repository.upsertCandidates(candidates);
    const staleRetiredCount = activeRows.length >= 100 && candidates.length > 0
      ? await this.repository.retireStaleNonTerminalCandidates(candidates.map((candidate) => candidate.candidateKey))
      : 0;
    return {
      observedAt,
      inventoryRows: inventory.length,
      activeRows: activeRows.length,
      upstreamRows: upstreamActiveRows.length,
      candidateCount: candidates.length,
      newDiscoveryCount: candidates.filter((candidate) => candidate.candidateType === "NEW_DISCOVERY").length,
      mergeSuggestionCount: candidates.filter((candidate) => candidate.candidateType === "MERGE_SUGGESTION").length,
      enrichmentOnlyCount: candidates.filter((candidate) => candidate.candidateType === "ENRICHMENT_ONLY").length,
      lowConfidenceCount: candidates.filter((candidate) => candidate.candidateType === "LOW_CONFIDENCE").length,
      discoveredCount: candidates.filter((candidate) => candidate.state === "DISCOVERED").length,
      ingestedCount: candidates.filter((candidate) => candidate.state === "INGESTED").length,
      persistedCount,
      snapshotPersistedCount,
      staleRetiredCount,
      upstreamRowsByVenueCategory: this.upstreamRowsByVenueCategory(upstream.snapshots),
      lowConfidenceMissingFieldCounts: this.lowConfidenceMissingFieldCounts(candidates),
      venueStatuses: upstream.venueStatuses
    };
  }

  public async listCandidates(filter: {
    state?: MarketDiscoveryState | undefined;
    lifecycleState?: "OPEN" | "CLOSED" | undefined;
    candidateType?: MarketDiscoveryCandidateType | undefined;
    category?: MarketDiscoveryCandidate["category"] | undefined;
    search?: string | undefined;
  } = {}): Promise<{
    candidates: readonly MarketDiscoveryCandidate[];
    topicBundles: readonly MarketDiscoveryTopicBundle[];
  }> {
    const candidates = this.enrichCandidatesWithRoutingReview(await this.repository.listCandidates(filter));
    return {
      candidates,
      topicBundles: buildMarketDiscoveryTopicBundles(candidates)
    };
  }

  public async listTopicBundles(filter: {
    state?: MarketDiscoveryState | undefined;
    lifecycleState?: "OPEN" | "CLOSED" | undefined;
    candidateType?: MarketDiscoveryCandidateType | undefined;
    category?: MarketDiscoveryCandidate["category"] | undefined;
    search?: string | undefined;
  } = {}): Promise<{
    topicBundles: readonly MarketDiscoveryTopicBundle[];
  }> {
    const candidates = this.enrichCandidatesWithRoutingReview(await this.repository.listCandidates(filter));
    return { topicBundles: buildMarketDiscoveryTopicBundles(candidates) };
  }

  // Read-only lane counts for the admin review surface, derived from persisted candidates
  // (no matcher run). Safe to poll. Groups low-confidence causes so they are readable.
  public async getReviewSummary(): Promise<MarketDiscoveryReviewSummary> {
    const candidates = await this.repository.listCandidates({});
    const bundles = buildMarketDiscoveryTopicBundles(candidates);
    const byState: Record<MarketDiscoveryState, number> = {
      DISCOVERED: 0, INGESTED: 0, APPROVED: 0, REJECTED: 0, SUPPRESSED: 0
    };
    const byCandidateType: Record<MarketDiscoveryCandidateType, number> = {
      NEW_DISCOVERY: 0, MERGE_SUGGESTION: 0, ENRICHMENT_ONLY: 0, LOW_CONFIDENCE: 0
    };
    for (const candidate of candidates) {
      byState[candidate.state] += 1;
      byCandidateType[candidate.candidateType] += 1;
    }
    return {
      observedAt: new Date().toISOString(),
      totalCandidates: candidates.length,
      lanes: {
        topicBundles: bundles.length,
        newDiscoveries: byCandidateType.NEW_DISCOVERY,
        mergeSuggestions: byCandidateType.MERGE_SUGGESTION,
        metadataEnrichment: byCandidateType.ENRICHMENT_ONLY,
        lowConfidence: byCandidateType.LOW_CONFIDENCE,
        approved: byState.APPROVED,
        rejected: byState.REJECTED
      },
      byState,
      byCandidateType,
      lowConfidenceMissingFieldCounts: this.lowConfidenceMissingFieldCounts(candidates),
      lowConfidenceReasonCounts: this.lowConfidenceReasonCounts(candidates)
    };
  }

  public async reject(input: {
    candidateId: string;
    rejectedBy: string;
    reason: string;
  }): Promise<{ candidateId: string; state: "REJECTED" }> {
    const { candidateId } = input;
    const candidate = await this.repository.getCandidate(candidateId);
    if (!candidate) {
      throw new MarketDiscoveryServiceError(`Discovery candidate '${candidateId}' was not found.`);
    }
    if (candidate.state === "APPROVED") {
      throw new MarketDiscoveryServiceError("Approved discovery candidates cannot be rejected.");
    }
    await this.repository.markRejected(input);
    return { candidateId, state: "REJECTED" };
  }

  public async previewArchiveClosed(input: {
    retentionDays?: number | undefined;
  } = {}): Promise<MarketDiscoveryArchivePreview> {
    return this.repository.previewArchiveClosed({
      retentionDays: this.normalizeRetentionDays(input.retentionDays)
    });
  }

  public async applyArchiveClosed(input: {
    retentionDays?: number | undefined;
  } = {}): Promise<MarketDiscoveryArchiveApplyResult> {
    return this.repository.applyArchiveClosed({
      retentionDays: this.normalizeRetentionDays(input.retentionDays)
    });
  }

  public async approve(input: {
    candidateId: string;
    approvedBy: string;
    reason: string;
    makeLive?: boolean | undefined;
  }): Promise<MarketDiscoveryApprovalResult> {
    const candidate = await this.repository.getCandidate(input.candidateId);
    if (!candidate) {
      throw new MarketDiscoveryServiceError(`Discovery candidate '${input.candidateId}' was not found.`);
    }
    if (candidate.state !== "INGESTED") {
      throw new MarketDiscoveryServiceError(`Only INGESTED discovery candidates can be approved. Current state: ${candidate.state}.`);
    }

    // NEW_DISCOVERY members are upstream-only (no canonical event yet), so they can't go through
    // the exact-overlap sync (which extends existing canonical inventory). Project them as a
    // fresh cross-venue canonical event instead, then stamp the frontend approval via markApproved
    // so the source tag is applied consistently with every other approval path.
    if (candidate.candidateType === "NEW_DISCOVERY") {
      return this.approveNewDiscovery(candidate, input);
    }

    const inventory = await loadSemanticExpansionInventory(this.pool);
    const byProfileId = new Map(inventory.map((row) => [row.venueMarketProfileId, row] as const));
    const memberRows = candidate.venueEvidence
      .map((entry) => byProfileId.get(entry.venueMarketProfileId))
      .filter((row): row is SemanticExpansionInventoryRow => row !== undefined);
    if (memberRows.length < 2) {
      throw new MarketDiscoveryServiceError("Discovery candidate no longer has two hydrated venue profiles.");
    }

    const memberRefs = memberRows.map((row) => ({
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      title: row.title,
      canonicalEventId: row.canonicalEventId,
      canonicalMarketId: row.canonicalMarketId,
      evidenceLabel: row.evidenceLabel,
      historicalRowCount: row.historicalRowCount
    }));
    const stableIds = buildStablePromotionIds(memberRefs);
    const promotionCandidate: SemanticPromotionCandidate = {
      promotionId: `discovery_${stableIds.promotionId}`,
      eventTitle: candidate.eventTitle,
      category: this.toSemanticCategory(candidate.category),
      promotionClass: "live_only_exact_overlap",
      targetMode: "new_exact_overlap",
      targetCanonicalEventId: stableIds.canonicalEventId,
      targetCanonicalMarketId: stableIds.canonicalMarketId,
      memberRefs,
      exactClique: true,
      blockReason: null
    };

    const summary = await syncSemanticExactOverlaps({
      repoRoot: this.repoRoot,
      pool: this.pool,
      candidates: [promotionCandidate]
    });
    const promoted = summary.promotedTargets.find((target) => target.promotionId === promotionCandidate.promotionId);
    if (!promoted) {
      const skipped = summary.skippedTargets.find((target) => target.promotionId === promotionCandidate.promotionId);
      throw new MarketDiscoveryServiceError(
        `Discovery approval did not produce a canonical market: ${skipped?.reason ?? "unknown reason"}.`
      );
    }

    await this.repository.markApproved({
      candidateId: candidate.id,
      canonicalEventId: promoted.targetCanonicalEventId,
      makeLive: input.makeLive === true,
      approvedBy: input.approvedBy,
      reason: input.reason
    });

    return { candidate, canonicalEventId: promoted.targetCanonicalEventId, summary };
  }

  private async approveNewDiscovery(
    candidate: MarketDiscoveryCandidate,
    input: { candidateId: string; approvedBy: string; reason: string; makeLive?: boolean | undefined }
  ): Promise<MarketDiscoveryApprovalResult> {
    const members = candidate.venueEvidence
      .filter((entry) => entry.venue && entry.venueMarketId)
      .map((entry) => ({
        venue: entry.venue,
        venueMarketId: entry.venueMarketId,
        title: entry.title,
        ...(entry.outcomes.length > 0
          ? { outcomes: entry.outcomes.map((label) => ({ id: label.toUpperCase(), label })) }
          : {})
      }));
    if (members.length < 2) {
      throw new MarketDiscoveryServiceError("Discovery candidate no longer has two venue members to project.");
    }

    const core = candidate.draftSemanticCore;
    const boundary = candidate.semanticBoundaryKey ?? core?.timeBoundary ?? null;
    const eventPropositionKey = core?.marketFamily && core?.subject
      ? `frontend-curated:${candidate.category}|${core.marketFamily}|${core.subject}|${core.condition ?? "NA"}`
      : undefined;

    const projected = await this.curatedAdmin.projectCrossVenueMarket(
      {
        eventTitle: candidate.eventTitle,
        category: candidate.category as CanonicalCategory,
        marketClass: candidate.marketClass,
        ...(eventPropositionKey ? { eventPropositionKey } : {}),
        ...(boundary ? { resolvesAt: boundary, expiresAt: boundary } : {}),
        members
      },
      input.approvedBy
    );

    await this.repository.markApproved({
      candidateId: candidate.id,
      canonicalEventId: projected.canonicalEventId,
      makeLive: input.makeLive === true,
      approvedBy: input.approvedBy,
      reason: input.reason
    });

    return {
      candidate,
      canonicalEventId: projected.canonicalEventId,
      createdMarketIds: projected.canonicalMarketIds
    };
  }

  private toSemanticCategory(category: string): SemanticDiscoveryCategory {
    switch (category) {
      case "POLITICS":
      case "CRYPTO":
      case "SPORTS":
      case "ESPORTS":
      case "OTHER":
        return category;
      case "POP_CULTURE":
        return "CULTURE";
      default:
        return "OTHER";
    }
  }

  private mergeCandidates(candidates: readonly MarketDiscoveryCandidate[]): readonly MarketDiscoveryCandidate[] {
    const byKey = new Map<string, MarketDiscoveryCandidate>();
    for (const candidate of candidates) {
      const existing = byKey.get(candidate.candidateKey);
      if (!existing || this.candidatePriority(candidate) > this.candidatePriority(existing)) {
        byKey.set(candidate.candidateKey, candidate);
      }
    }
    return [...byKey.values()].sort((left, right) =>
      right.confidenceScore - left.confidenceScore
      || left.eventTitle.localeCompare(right.eventTitle)
    );
  }

  private candidatePriority(candidate: MarketDiscoveryCandidate): number {
    const typeScore = candidate.candidateType === "NEW_DISCOVERY"
      ? 4
      : candidate.candidateType === "MERGE_SUGGESTION"
        ? 3
        : candidate.candidateType === "ENRICHMENT_ONLY"
          ? 2
          : 1;
    const stateScore = candidate.state === "INGESTED" ? 2 : 1;
    return typeScore * 10 + stateScore + candidate.confidenceScore;
  }

  private upstreamRowsByVenueCategory(snapshots: readonly { venue: string; category: string }[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const snapshot of snapshots) {
      const key = `${snapshot.venue}:${snapshot.category}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
  }

  private lowConfidenceMissingFieldCounts(candidates: readonly MarketDiscoveryCandidate[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const candidate of candidates) {
      if (candidate.candidateType !== "LOW_CONFIDENCE") continue;
      const fields = candidate.draftSemanticCore?.missingFields ?? [];
      for (const field of fields.length > 0 ? fields : ["unknown"]) {
        counts[field] = (counts[field] ?? 0) + 1;
      }
    }
    return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
  }

  // Groups the human-readable review-required reason codes carried on each low-confidence
  // candidate (e.g. OUTCOME_REVIEW_REQUIRED, RULES_SOURCE_REVIEW_REQUIRED) so the frontend
  // can show why a candidate needs review without re-deriving it.
  private lowConfidenceReasonCounts(candidates: readonly MarketDiscoveryCandidate[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const candidate of candidates) {
      if (candidate.candidateType !== "LOW_CONFIDENCE") continue;
      for (const code of candidate.reasonCodes) {
        if (code.endsWith("_REVIEW_REQUIRED") || code.endsWith("_UNKNOWN")) {
          counts[code] = (counts[code] ?? 0) + 1;
        }
      }
    }
    return Object.fromEntries(Object.entries(counts).sort(([, left], [, right]) => right - left));
  }

  private normalizeRetentionDays(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 7;
    }
    return Math.max(7, Math.floor(value));
  }

  private enrichCandidatesWithRoutingReview(
    candidates: readonly MarketDiscoveryCandidate[]
  ): readonly MarketDiscoveryCandidate[] {
    if (candidates.length === 0) {
      return candidates;
    }
    const report = this.readLastMatchReport();
    if (!report) {
      return candidates;
    }
    return candidates.map((candidate) => ({
      ...candidate,
      routingReview: this.routingReviewForCandidate(candidate, report)
    }));
  }

  private readLastMatchReport(): CrossVenueMatchReport | null {
    try {
      return readArtifact<CrossVenueMatchReport>(this.repoRoot, MarketDiscoveryService.MATCH_REPORT_PATH);
    } catch {
      return null;
    }
  }

  private routingReviewForCandidate(
    candidate: MarketDiscoveryCandidate,
    report: CrossVenueMatchReport
  ): MarketDiscoveryCandidate["routingReview"] {
    const candidateKeys = new Set(
      candidate.venueEvidence.map((entry) => `${entry.venue}:${entry.venueMarketId}`)
    );
    if (candidateKeys.size === 0) {
      return { exactPromotionIds: [], nearExactMatchIds: [] };
    }
    const hasCandidateMember = (members: readonly { venue: string; venueMarketId: string }[]): boolean =>
      members.some((member) => candidateKeys.has(`${member.venue}:${member.venueMarketId}`));
    return {
      exactPromotionIds: report.promotionCandidates
        .filter((promotion) => hasCandidateMember(promotion.memberRefs))
        .map((promotion) => promotion.promotionId)
        .sort((left, right) => left.localeCompare(right)),
      nearExactMatchIds: report.matches
        .filter((match) =>
          match.matchClass === "semantic_near_exact"
          && hasCandidateMember([match.seed, match.candidate])
        )
        .map((match) => match.matchId)
        .sort((left, right) => left.localeCompare(right))
    };
  }
}
