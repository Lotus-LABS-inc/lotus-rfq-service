import type { Pool } from "pg";

import { buildStablePromotionIds } from "../operations/semantic-expansion/shared.js";
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
import type { SemanticDiscoveryCategory } from "../simulation/semantic-rulepack.js";
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
  summary: SemanticExactSyncSummary;
}

export class MarketDiscoveryService {
  public constructor(
    private readonly pool: Pool,
    private readonly repository: MarketDiscoveryRepository = new MarketDiscoveryRepository(pool),
    private readonly repoRoot: string = process.cwd(),
    private readonly upstreamCollector: { collect: () => Promise<UpstreamMarketDiscoveryCollectorResult> } =
      new UpstreamMarketDiscoveryCollector()
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
    candidateType?: MarketDiscoveryCandidateType | undefined;
  } = {}): Promise<{
    candidates: readonly MarketDiscoveryCandidate[];
    topicBundles: readonly MarketDiscoveryTopicBundle[];
  }> {
    const candidates = await this.repository.listCandidates(filter);
    return {
      candidates,
      topicBundles: buildMarketDiscoveryTopicBundles(candidates)
    };
  }

  public async listTopicBundles(filter: {
    state?: MarketDiscoveryState | undefined;
    candidateType?: MarketDiscoveryCandidateType | undefined;
  } = {}): Promise<{
    topicBundles: readonly MarketDiscoveryTopicBundle[];
  }> {
    const candidates = await this.repository.listCandidates(filter);
    return { topicBundles: buildMarketDiscoveryTopicBundles(candidates) };
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
    if (candidate.candidateType === "NEW_DISCOVERY") {
      throw new MarketDiscoveryServiceError(
        "NEW_DISCOVERY approval requires the create-canonical-market review action; it is intentionally not routed through the existing merge approval path."
      );
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

    return { candidate, summary };
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
}
