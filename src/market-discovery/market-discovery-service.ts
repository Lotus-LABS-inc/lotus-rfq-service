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
  MarketDiscoveryCorrectionPatch,
  MarketDiscoveryGroupApprovalResult,
  MarketDiscoveryQualityReport,
  MarketDiscoveryRunSummary,
  MarketDiscoveryState,
  MarketDiscoveryTopicBundle,
  VenueMarketDiscoverySnapshot
} from "./market-discovery-types.js";
import { buildMarketDiscoveryTopicBundles } from "./market-discovery-topic-bundles.js";
import { MarketDiscoveryRepository } from "../repositories/market-discovery.repository.js";
import type {
  MarketDiscoveryArchiveApplyResult,
  MarketDiscoveryArchivePreview,
  MarketDiscoverySnapshotHealthRow
} from "../repositories/market-discovery.repository.js";
import { CuratedMarketAdminService } from "../api/admin/curated-market-admin-service.js";
import type { SemanticDiscoveryCategory } from "../simulation/semantic-rulepack.js";
import { normalizeFreeText, type CanonicalCategory } from "../canonical/canonicalization-types.js";
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
    const discoverySnapshots = await this.snapshotsWithUnavailableVenueFallback(upstream);
    const snapshotPersistedCount = await this.repository.upsertVenueSnapshots(upstream.snapshots);
    const {
      activeRows: upstreamActiveRows,
      candidates: upstreamCandidates
    } = buildMarketDiscoveryCandidatesFromSnapshots(discoverySnapshots, inventory);
    const candidates = this.mergeCandidates([...upstreamCandidates, ...inventoryCandidates]);
    const persistedCount = await this.repository.upsertCandidates(candidates);
    const staleRetiredCount = activeRows.length >= 100 && candidates.length > 0
      ? await this.repository.retireStaleNonTerminalCandidates(candidates.map((candidate) => candidate.candidateKey))
      : 0;
    const qualityReport = await this.getQualityReport();
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
      upstreamRowsByVenueCategory: this.upstreamRowsByVenueCategory(discoverySnapshots),
      lowConfidenceMissingFieldCounts: this.lowConfidenceMissingFieldCounts(candidates),
      venueStatuses: upstream.venueStatuses,
      qualityReport
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
    const candidates = await this.enrichCandidatesWithRoutingReview(
      await this.repository.listCandidates(this.withDefaultOpenLifecycle(filter))
    );
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
    const candidates = await this.enrichCandidatesWithRoutingReview(
      await this.repository.listCandidates(this.withDefaultOpenLifecycle(filter))
    );
    return { topicBundles: buildMarketDiscoveryTopicBundles(candidates) };
  }

  // Read-only lane counts for the admin review surface, derived from persisted candidates
  // (no matcher run). Safe to poll. Groups low-confidence causes so they are readable.
  public async getReviewSummary(): Promise<MarketDiscoveryReviewSummary> {
    const candidates = await this.repository.listCandidates({ lifecycleState: "OPEN" });
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

  public async getQualityReport(): Promise<MarketDiscoveryQualityReport> {
    const candidates = await this.enrichCandidatesWithRoutingReview(
      await this.repository.listCandidates({ lifecycleState: "OPEN" })
    );
    const bundles = buildMarketDiscoveryTopicBundles(candidates);
    const snapshotRows = await this.safeListSnapshotHealthRows();
    const candidateTypeCounts: Record<MarketDiscoveryCandidateType, number> = {
      NEW_DISCOVERY: 0, MERGE_SUGGESTION: 0, ENRICHMENT_ONLY: 0, LOW_CONFIDENCE: 0
    };
    for (const candidate of candidates) {
      candidateTypeCounts[candidate.candidateType] += 1;
    }
    const childContracts = bundles.flatMap((bundle) => bundle.children);
    const coverageCounts = {
      singleCoverage: childContracts.filter((child) => child.coverageKind === "SINGLE").length,
      pairCoverage: childContracts.filter((child) => child.coverageKind === "PAIR").length,
      triCoverage: childContracts.filter((child) => child.coverageKind === "TRI").length,
      multiCoverage: childContracts.filter((child) => child.coverageKind === "MULTI").length
    };
    return {
      observedAt: new Date().toISOString(),
      counts: {
        totalCandidates: candidates.length,
        topicBundles: bundles.length,
        childContracts: childContracts.length,
        newDiscoveries: candidateTypeCounts.NEW_DISCOVERY,
        mergeSuggestions: candidateTypeCounts.MERGE_SUGGESTION,
        metadataEnrichment: candidateTypeCounts.ENRICHMENT_ONLY,
        lowConfidence: candidateTypeCounts.LOW_CONFIDENCE,
        ...coverageCounts
      },
      venueCoverage: this.venueCoverage(candidates, childContracts),
      missingVenueEvidence: this.missingVenueEvidenceCounts(bundles),
      extractionHealth: this.extractionHealth(snapshotRows, candidates),
      lowConfidenceSamples: this.lowConfidenceSamples(candidates)
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

  public async correctCandidate(input: {
    candidateId: string;
    patch: MarketDiscoveryCorrectionPatch;
    reason: string;
    correctedBy: string;
  }): Promise<{ correctionId: string; candidate: MarketDiscoveryCandidate }> {
    const candidate = await this.requireCandidate(input.candidateId);
    const patch = this.normalizeCorrectionPatch(input.patch);
    const correctionId = await this.repository.insertCorrection({
      target: "CANDIDATE",
      candidateId: candidate.id,
      candidateKey: candidate.candidateKey,
      reviewGroupKey: candidate.reviewGroupKey,
      patch,
      reason: input.reason,
      correctedBy: input.correctedBy
    });
    const updated = await this.applyCorrectionToCandidate(candidate, patch);
    return { correctionId, candidate: updated };
  }

  public async correctGroup(input: {
    reviewGroupKey: string;
    patch: MarketDiscoveryCorrectionPatch;
    reason: string;
    correctedBy: string;
  }): Promise<{ correctionId: string; candidates: readonly MarketDiscoveryCandidate[] }> {
    const candidates = await this.candidatesForReviewGroup(input.reviewGroupKey);
    if (candidates.length === 0) {
      throw new MarketDiscoveryServiceError(`Discovery review group '${input.reviewGroupKey}' was not found.`);
    }
    const patch = this.normalizeCorrectionPatch(input.patch, { group: true });
    const correctionId = await this.repository.insertCorrection({
      target: "GROUP",
      reviewGroupKey: input.reviewGroupKey,
      patch,
      reason: input.reason,
      correctedBy: input.correctedBy
    });
    const updated: MarketDiscoveryCandidate[] = [];
    for (const candidate of candidates) {
      updated.push(await this.applyCorrectionToCandidate(candidate, patch));
    }
    return { correctionId, candidates: updated };
  }

  public async reclassifyCandidate(input: {
    candidateId: string;
  }): Promise<{ candidate: MarketDiscoveryCandidate }> {
    const candidate = await this.requireCandidate(input.candidateId);
    const patch = this.patchFromCandidate(candidate);
    if (Object.keys(patch).length === 0) {
      return { candidate };
    }
    return { candidate: await this.applyCorrectionToCandidate(candidate, patch) };
  }

  public async reclassifyGroup(input: {
    reviewGroupKey: string;
  }): Promise<{ candidates: readonly MarketDiscoveryCandidate[] }> {
    const candidates = await this.candidatesForReviewGroup(input.reviewGroupKey);
    if (candidates.length === 0) {
      throw new MarketDiscoveryServiceError(`Discovery review group '${input.reviewGroupKey}' was not found.`);
    }
    const updated: MarketDiscoveryCandidate[] = [];
    for (const candidate of candidates) {
      const patch = this.patchFromCandidate(candidate);
      updated.push(Object.keys(patch).length === 0 ? candidate : await this.applyCorrectionToCandidate(candidate, patch));
    }
    return { candidates: updated };
  }

  public async approveGroupHidden(input: {
    reviewGroupKey: string;
    approvedBy: string;
    reason: string;
  }): Promise<MarketDiscoveryGroupApprovalResult> {
    const candidates = await this.candidatesForReviewGroup(input.reviewGroupKey);
    if (candidates.length === 0) {
      throw new MarketDiscoveryServiceError(`Discovery review group '${input.reviewGroupKey}' was not found.`);
    }
    const result: {
      approved: MarketDiscoveryGroupApprovalResult["approved"][number][];
      skipped: MarketDiscoveryGroupApprovalResult["skipped"][number][];
      failed: MarketDiscoveryGroupApprovalResult["failed"][number][];
    } = { approved: [], skipped: [], failed: [] };
    for (const candidate of candidates) {
      if (candidate.state !== "INGESTED") {
        result.skipped.push({
          candidateId: candidate.id,
          state: candidate.state,
          candidateType: candidate.candidateType,
          reason: "candidate_not_ingested"
        });
        continue;
      }
      try {
        const approved = await this.approve({
          candidateId: candidate.id,
          approvedBy: input.approvedBy,
          reason: input.reason,
          makeLive: false
        });
        result.approved.push({
          candidateId: candidate.id,
          canonicalEventId: approved.canonicalEventId
        });
      } catch (error) {
        result.failed.push({
          candidateId: candidate.id,
          reason: error instanceof Error ? error.message : "approval_failed"
        });
      }
    }
    return { reviewGroupKey: input.reviewGroupKey, ...result };
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

  private withDefaultOpenLifecycle<T extends { lifecycleState?: "OPEN" | "CLOSED" | undefined }>(filter: T): T {
    return filter.lifecycleState ? filter : { ...filter, lifecycleState: "OPEN" };
  }

  private async enrichCandidatesWithRoutingReview(
    candidates: readonly MarketDiscoveryCandidate[]
  ): Promise<readonly MarketDiscoveryCandidate[]> {
    if (candidates.length === 0) {
      return candidates;
    }
    const report = this.readLastMatchReport();
    const pooledEventIds = await this.safeListPooledApprovedCanonicalEventIds(candidates);
    return candidates.map((candidate) => {
      const routingReview = report
        ? this.routingReviewForCandidate(candidate, report)
        : { exactPromotionIds: [], nearExactMatchIds: [] };
      const pooled = candidate.approvedCanonicalEventId !== null && pooledEventIds.has(candidate.approvedCanonicalEventId);
      const routingStatus = pooled
        ? "POOLED_ROUTE_APPROVED"
        : routingReview.exactPromotionIds.length > 0
          ? "PAIR_TRI_REVIEW_AVAILABLE"
          : candidate.state === "APPROVED"
            ? "APPROVED_SINGLE_VENUE"
            : "NOT_APPROVED";
      const nextRoutingAction = pooled
        ? "ALREADY_POOLED"
        : routingReview.exactPromotionIds.length > 0
          ? "OPEN_PAIR_TRI_REVIEW"
          : candidate.state === "APPROVED"
            ? "RUN_MATCHER"
            : "NONE";
      return {
        ...candidate,
        routingStatus,
        nextRoutingAction,
        routingReview
      };
    });
  }

  private readLastMatchReport(): CrossVenueMatchReport | null {
    try {
      return readArtifact<CrossVenueMatchReport>(this.repoRoot, MarketDiscoveryService.MATCH_REPORT_PATH);
    } catch {
      return null;
    }
  }

  private async safeListPooledApprovedCanonicalEventIds(
    candidates: readonly MarketDiscoveryCandidate[]
  ): Promise<ReadonlySet<string>> {
    const canonicalEventIds = candidates
      .map((candidate) => candidate.approvedCanonicalEventId)
      .filter((id): id is string => id !== null);
    if (canonicalEventIds.length === 0) {
      return new Set();
    }
    try {
      return await this.repository.listPooledApprovedCanonicalEventIds(canonicalEventIds);
    } catch {
      return new Set();
    }
  }

  private async safeListSnapshotHealthRows(): Promise<readonly MarketDiscoverySnapshotHealthRow[]> {
    try {
      return await this.repository.listSnapshotHealthRows();
    } catch {
      return [];
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
    const promotionCandidates = Array.isArray(report.promotionCandidates)
      ? report.promotionCandidates
      : [];
    const matches = Array.isArray(report.matches)
      ? report.matches
      : [];
    return {
      exactPromotionIds: promotionCandidates
        .filter((promotion) =>
          Array.isArray(promotion.memberRefs) && hasCandidateMember(promotion.memberRefs)
        )
        .map((promotion) => promotion.promotionId)
        .filter((promotionId): promotionId is string => typeof promotionId === "string")
        .sort((left, right) => left.localeCompare(right)),
      nearExactMatchIds: matches
        .filter((match) =>
          match.matchClass === "semantic_near_exact"
          && match.seed
          && match.candidate
          && hasCandidateMember([match.seed, match.candidate])
        )
        .map((match) => match.matchId)
        .filter((matchId): matchId is string => typeof matchId === "string")
        .sort((left, right) => left.localeCompare(right))
    };
  }

  private venueCoverage(
    candidates: readonly MarketDiscoveryCandidate[],
    children: readonly { venues: readonly string[]; missingVenueEvidence: readonly string[] }[]
  ): MarketDiscoveryQualityReport["venueCoverage"] {
    const venues = new Set<string>();
    for (const candidate of candidates) {
      for (const venue of candidate.venues) venues.add(venue);
    }
    for (const child of children) {
      for (const venue of child.venues) venues.add(venue);
      for (const missing of child.missingVenueEvidence) {
        const match = /^NO_MATCHED_(.+)_(TOPIC|CONTRACT)$/.exec(missing);
        if (match?.[1]) venues.add(match[1]);
      }
    }
    const output: Record<string, { candidateCount: number; childContractCount: number; missingFromBundleCount: number }> = {};
    for (const venue of [...venues].sort((left, right) => left.localeCompare(right))) {
      output[venue] = {
        candidateCount: candidates.filter((candidate) => candidate.venues.includes(venue as never)).length,
        childContractCount: children.filter((child) => child.venues.includes(venue)).length,
        missingFromBundleCount: children.filter((child) =>
          child.missingVenueEvidence.some((reason) => reason.includes(`_${venue}_`))
        ).length
      };
    }
    return output;
  }

  private missingVenueEvidenceCounts(bundles: readonly MarketDiscoveryTopicBundle[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const bundle of bundles) {
      for (const reason of bundle.missingVenueEvidence) {
        counts[reason] = (counts[reason] ?? 0) + 1;
      }
      for (const child of bundle.children) {
        for (const reason of child.missingVenueEvidence) {
          counts[reason] = (counts[reason] ?? 0) + 1;
        }
      }
    }
    return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
  }

  private extractionHealth(
    snapshots: readonly MarketDiscoverySnapshotHealthRow[],
    candidates: readonly MarketDiscoveryCandidate[]
  ): MarketDiscoveryQualityReport["extractionHealth"] {
    const expectedVenues = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"];
    const semanticByVenueMarket = new Map<string, {
      topicKey: boolean;
      contractLabel: boolean;
      contractKey: boolean;
    }>();
    for (const candidate of candidates) {
      for (const entry of this.semanticEvidence(candidate)) {
        semanticByVenueMarket.set(`${entry.venue}:${entry.venueMarketId}`, {
          topicKey: Boolean(entry.topicKey),
          contractLabel: Boolean(entry.contractLabel),
          contractKey: Boolean(entry.contractKey)
        });
      }
    }
    const byVenue = new Map<string, typeof snapshots>();
    for (const row of snapshots) {
      const rows = byVenue.get(row.venue) ?? [];
      byVenue.set(row.venue, [...rows, row]);
    }
    const output: Record<string, MarketDiscoveryQualityReport["extractionHealth"][string]> = {};
    for (const [venue, rows] of [...byVenue.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const sampleMissingRows: {
        venueMarketId: string;
        title: string;
        missing: readonly string[];
      }[] = [];
      let topicKeyPresent = 0;
      let contractLabelPresent = 0;
      let contractKeyPresent = 0;
      for (const row of rows) {
        const semantic = semanticByVenueMarket.get(`${row.venue}:${row.venueMarketId}`);
        if (semantic?.topicKey) topicKeyPresent += 1;
        if (semantic?.contractLabel) contractLabelPresent += 1;
        if (semantic?.contractKey) contractKeyPresent += 1;
        const missing = [
          row.hasEventTitle ? null : "eventTitle",
          semantic?.topicKey ? null : "topicKey",
          semantic?.contractLabel ? null : "contractLabel",
          semantic?.contractKey ? null : "contractKey",
          row.outcomeCount > 0 ? null : "outcomes",
          row.hasTokenSlugOrOrderbookKey ? null : "tokenSlugOrOrderbookKey"
        ].filter((entry): entry is string => entry !== null);
        if (missing.length > 0 && sampleMissingRows.length < 5) {
          sampleMissingRows.push({
            venueMarketId: row.venueMarketId,
            title: row.title,
            missing
          });
        }
      }
      output[venue] = {
        snapshotCount: rows.length,
        activeSnapshotCount: rows.filter((row) => row.active).length,
        eventTitlePresent: rows.filter((row) => row.hasEventTitle).length,
        topicKeyPresent,
        contractLabelPresent,
        contractKeyPresent,
        rowsWithOutcomes: rows.filter((row) => row.outcomeCount > 0).length,
        totalOutcomeCount: rows.reduce((sum, row) => sum + row.outcomeCount, 0),
        rowsWithTokenSlugOrOrderbookKey: rows.filter((row) => row.hasTokenSlugOrOrderbookKey).length,
        quoteReadyCount: rows.filter((row) => row.quoteReady).length,
        executionReadyCount: rows.filter((row) => row.executionReady).length,
        sampleMissingRows
      };
    }
    for (const venue of expectedVenues) {
      output[venue] ??= {
        snapshotCount: 0,
        activeSnapshotCount: 0,
        eventTitlePresent: 0,
        topicKeyPresent: 0,
        contractLabelPresent: 0,
        contractKeyPresent: 0,
        rowsWithOutcomes: 0,
        totalOutcomeCount: 0,
        rowsWithTokenSlugOrOrderbookKey: 0,
        quoteReadyCount: 0,
        executionReadyCount: 0,
        sampleMissingRows: []
      };
    }
    return output;
  }

  private lowConfidenceSamples(candidates: readonly MarketDiscoveryCandidate[]): MarketDiscoveryQualityReport["lowConfidenceSamples"] {
    const output: Record<string, MarketDiscoveryQualityReport["lowConfidenceSamples"][string]> = {};
    for (const candidate of candidates) {
      if (candidate.candidateType !== "LOW_CONFIDENCE") continue;
      const fields = candidate.draftSemanticCore?.missingFields ?? ["unknown"];
      for (const field of fields.length > 0 ? fields : ["unknown"]) {
        const bucket = output[field] ?? [];
        if (bucket.length >= 5) continue;
        output[field] = [
          ...bucket,
          {
            candidateId: candidate.id,
            eventTitle: candidate.eventTitle,
            venues: candidate.venues,
            missingFields: fields,
            reasonCodes: candidate.reasonCodes
          }
        ];
      }
    }
    return output;
  }

  private async requireCandidate(candidateId: string): Promise<MarketDiscoveryCandidate> {
    const candidate = await this.repository.getCandidate(candidateId);
    if (!candidate) {
      throw new MarketDiscoveryServiceError(`Discovery candidate '${candidateId}' was not found.`);
    }
    return candidate;
  }

  private async snapshotsWithUnavailableVenueFallback(
    upstream: UpstreamMarketDiscoveryCollectorResult
  ): Promise<readonly VenueMarketDiscoverySnapshot[]> {
    const failedVenues = Object.entries(upstream.venueStatuses)
      .filter(([, venueStatus]) => venueStatus.status === "UNAVAILABLE")
      .map(([venue]) => venue === "PREDICT_FUN" ? "PREDICT" : venue);
    if (failedVenues.length === 0) {
      return upstream.snapshots;
    }
    const currentVenues = new Set<string>(upstream.snapshots.map((snapshot) => snapshot.venue));
    const fallbackVenues = failedVenues.filter((venue) => !currentVenues.has(venue));
    if (fallbackVenues.length === 0) {
      return upstream.snapshots;
    }
    const fallbackSnapshots = await this.repository.listActiveVenueSnapshots(fallbackVenues);
    if (fallbackSnapshots.length === 0) {
      return upstream.snapshots;
    }
    return [...upstream.snapshots, ...fallbackSnapshots];
  }

  private async candidatesForReviewGroup(reviewGroupKey: string): Promise<readonly MarketDiscoveryCandidate[]> {
    const candidates = await this.enrichCandidatesWithRoutingReview(
      await this.repository.listCandidates({ lifecycleState: "OPEN" })
    );
    return candidates.filter((candidate) => candidate.reviewGroupKey === reviewGroupKey);
  }

  private normalizeCorrectionPatch(
    patch: MarketDiscoveryCorrectionPatch,
    options: { group?: boolean } = {}
  ): MarketDiscoveryCorrectionPatch {
    const cleaned: MarketDiscoveryCorrectionPatch = {};
    const textFields: (keyof Omit<MarketDiscoveryCorrectionPatch, "category" | "outcomes">)[] = [
      "topicTitle",
      "marketFamily",
      "subject",
      "condition",
      "contractLabel",
      "timeBoundary",
      "sourceUrl",
      "rulesText"
    ];
    for (const key of textFields) {
      const value = patch[key];
      if (typeof value === "string" && value.trim().length > 0) {
        if (options.group && key === "contractLabel") continue;
        cleaned[key] = value.trim();
      }
    }
    if (typeof patch.category === "string" && patch.category.trim().length > 0) {
      cleaned.category = patch.category;
    }
    if (Array.isArray(patch.outcomes)) {
      const outcomes = [...new Set(patch.outcomes.map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
      if (outcomes.length > 0) cleaned.outcomes = outcomes;
    }
    return cleaned;
  }

  private patchFromCandidate(candidate: MarketDiscoveryCandidate): MarketDiscoveryCorrectionPatch {
    const correction = this.recordValue(candidate.metadata.operatorCorrectionPatch);
    if (!correction) return {};
    return this.normalizeCorrectionPatch(correction as MarketDiscoveryCorrectionPatch);
  }

  private async applyCorrectionToCandidate(
    candidate: MarketDiscoveryCandidate,
    patch: MarketDiscoveryCorrectionPatch
  ): Promise<MarketDiscoveryCandidate> {
    const eventTitle = patch.topicTitle ?? candidate.draftSemanticCore?.proposedEventTitle ?? candidate.eventTitle;
    const normalizedEventTitle = normalizeFreeText(eventTitle);
    const category = patch.category ?? candidate.category;
    const semanticBoundaryKey = patch.timeBoundary ?? candidate.semanticBoundaryKey;
    const sharedOutcomes = patch.outcomes ?? candidate.sharedOutcomes;
    const draftSemanticCore = this.correctedDraftSemanticCore(candidate, patch, eventTitle, category, semanticBoundaryKey, sharedOutcomes);
    const metadata = this.correctedMetadata(candidate, patch, eventTitle);
    const hasSemanticCore = Boolean(
      draftSemanticCore?.marketFamily
      && draftSemanticCore.subject
      && draftSemanticCore.condition
      && draftSemanticCore.timeBoundary
    );
    const hasOutcomes = sharedOutcomes.length > 0;
    const candidateType = hasSemanticCore && hasOutcomes && candidate.venueCount >= 2
      ? candidate.candidateType === "LOW_CONFIDENCE" ? "NEW_DISCOVERY" : candidate.candidateType
      : "LOW_CONFIDENCE";
    const state = candidateType !== "LOW_CONFIDENCE" && hasSemanticCore && hasOutcomes ? "INGESTED" : "DISCOVERED";
    const missingFields = [
      draftSemanticCore?.marketFamily ? null : "marketFamily",
      draftSemanticCore?.subject ? null : "subject",
      draftSemanticCore?.condition ? null : "condition",
      draftSemanticCore?.timeBoundary ? null : "timeBoundary",
      hasOutcomes ? null : "outcomes"
    ].filter((entry): entry is string => entry !== null);
    const reasonCodes = [
      ...candidate.reasonCodes.filter((code) => !code.startsWith("OPERATOR_CORRECTED")),
      "OPERATOR_CORRECTED",
      hasSemanticCore ? "OPERATOR_SEMANTIC_CORE_COMPLETE" : "OPERATOR_SEMANTIC_CORE_INCOMPLETE",
      hasOutcomes ? "OPERATOR_OUTCOME_EVIDENCE_PRESENT" : "OPERATOR_OUTCOME_EVIDENCE_MISSING"
    ];
    const matchDimensions = {
      ...candidate.matchDimensions,
      eventTitle: normalizedEventTitle.length > 0,
      category: true,
      marketFamily: Boolean(draftSemanticCore?.marketFamily),
      subject: Boolean(draftSemanticCore?.subject),
      condition: Boolean(draftSemanticCore?.condition),
      timeBoundary: Boolean(draftSemanticCore?.timeBoundary),
      outcomes: hasOutcomes,
      venueCount: candidate.venueCount >= 2
    };
    await this.repository.updateCandidateReviewFields({
      candidateId: candidate.id,
      state,
      candidateType,
      eventTitle,
      normalizedEventTitle,
      category,
      semanticBoundaryKey,
      sharedOutcomes,
      sharedOutcomeCount: sharedOutcomes.length,
      confidenceScore: Number(Math.max(candidate.confidenceScore, hasSemanticCore && hasOutcomes ? 0.93 : candidate.confidenceScore).toFixed(6)),
      reasonCodes,
      draftSemanticCore: draftSemanticCore ? { ...draftSemanticCore, missingFields } : null,
      matchDimensions,
      approvalActions: this.approvalActionsForType(candidateType),
      metadata
    });
    return this.requireCandidate(candidate.id);
  }

  private correctedDraftSemanticCore(
    candidate: MarketDiscoveryCandidate,
    patch: MarketDiscoveryCorrectionPatch,
    eventTitle: string,
    category: CanonicalCategory,
    semanticBoundaryKey: string | null,
    sharedOutcomes: readonly string[]
  ): MarketDiscoveryCandidate["draftSemanticCore"] {
    const current = candidate.draftSemanticCore ?? {
      category,
      proposedEventTitle: eventTitle,
      marketFamily: null,
      subject: null,
      condition: null,
      timeBoundary: semanticBoundaryKey,
      marketClass: candidate.marketClass,
      normalizedOutcomes: sharedOutcomes,
      venueMembers: candidate.venueEvidence.map((entry) => ({
        venue: entry.venue,
        venueMarketId: entry.venueMarketId,
        title: entry.title,
        sourceUrl: null
      })),
      missingFields: []
    };
    return {
      ...current,
      category,
      proposedEventTitle: eventTitle,
      marketFamily: patch.marketFamily ?? current.marketFamily,
      subject: patch.subject ?? current.subject,
      condition: patch.condition ?? current.condition,
      timeBoundary: patch.timeBoundary ?? current.timeBoundary ?? semanticBoundaryKey,
      normalizedOutcomes: sharedOutcomes
    };
  }

  private correctedMetadata(
    candidate: MarketDiscoveryCandidate,
    patch: MarketDiscoveryCorrectionPatch,
    eventTitle: string
  ): Readonly<Record<string, unknown>> {
    const metadata = { ...candidate.metadata };
    const previousPatch = this.recordValue(metadata.operatorCorrectionPatch) ?? {};
    metadata.operatorCorrectionPatch = { ...previousPatch, ...patch };
    metadata.operatorCorrectedAt = new Date().toISOString();
    const entries = Array.isArray(metadata.semanticEvidence) ? metadata.semanticEvidence : [];
    const topicKey = patch.topicTitle ? normalizeFreeText(patch.topicTitle).replace(/\s/g, "_").toUpperCase() : null;
    const contractKey = patch.contractLabel ? normalizeFreeText(patch.contractLabel).replace(/\s/g, "_").toUpperCase() : null;
    metadata.semanticEvidence = entries
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
      .map((entry) => ({
        ...entry,
        topicTitle: patch.topicTitle ?? entry.topicTitle ?? eventTitle,
        topicKey: topicKey ?? entry.topicKey,
        contractLabel: patch.contractLabel ?? entry.contractLabel,
        contractKey: contractKey ?? entry.contractKey
      }));
    if (Array.isArray(metadata.semanticEvidence) && metadata.semanticEvidence.length === 0) {
      metadata.semanticEvidence = candidate.venues.map((venue) => ({
        venue,
        venueMarketId: "",
        topicTitle: patch.topicTitle ?? eventTitle,
        topicKey: topicKey ?? normalizeFreeText(eventTitle).replace(/\s/g, "_").toUpperCase(),
        contractLabel: patch.contractLabel ?? null,
        contractKey: contractKey
      }));
    }
    if (patch.sourceUrl || patch.rulesText) {
      metadata.operatorCorrectionSource = {
        sourceUrl: patch.sourceUrl ?? null,
        rulesText: patch.rulesText ?? null
      };
    }
    return metadata;
  }

  private approvalActionsForType(candidateType: MarketDiscoveryCandidateType): readonly string[] {
    switch (candidateType) {
      case "NEW_DISCOVERY":
        return ["CREATE_CANONICAL_MARKET_HIDDEN", "CREATE_CANONICAL_MARKET_LIVE", "ATTACH_TO_EXISTING_CANONICAL_MARKET", "SPLIT_CANDIDATE", "REJECT", "SUPPRESS"];
      case "MERGE_SUGGESTION":
        return ["MERGE_EXISTING_CANONICAL_MARKETS", "REJECT", "SUPPRESS"];
      case "ENRICHMENT_ONLY":
        return ["APPLY_METADATA_ENRICHMENT", "REJECT", "SUPPRESS"];
      case "LOW_CONFIDENCE":
        return ["SPLIT_CANDIDATE", "REJECT", "SUPPRESS"];
    }
  }

  private recordValue(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private semanticEvidence(candidate: MarketDiscoveryCandidate): readonly {
    venue: string;
    venueMarketId: string;
    topicKey: string | null;
    contractLabel: string | null;
    contractKey: string | null;
  }[] {
    const entries = Array.isArray(candidate.metadata.semanticEvidence)
      ? candidate.metadata.semanticEvidence
      : [];
    return entries
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
      .map((entry) => ({
        venue: typeof entry.venue === "string" ? entry.venue : "",
        venueMarketId: typeof entry.venueMarketId === "string" ? entry.venueMarketId : "",
        topicKey: typeof entry.topicKey === "string" && entry.topicKey.length > 0 ? entry.topicKey : null,
        contractLabel: typeof entry.contractLabel === "string" && entry.contractLabel.length > 0 ? entry.contractLabel : null,
        contractKey: typeof entry.contractKey === "string" && entry.contractKey.length > 0 ? entry.contractKey : null
      }))
      .filter((entry) => entry.venue.length > 0 && entry.venueMarketId.length > 0);
  }
}
