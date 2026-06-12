import type { Pool } from "pg";

import { buildCrossVenueMatchReport } from "../../operations/semantic-expansion/cross-venue-match-report.js";
import {
  readArtifact,
  writeArtifact,
  type CrossVenueMatchReport
} from "../../operations/semantic-expansion/shared.js";
import {
  syncSemanticExactOverlaps,
  type SemanticExactSyncSummary
} from "../../operations/semantic-expansion/semantic-exact-sync.js";
import { MarketMatchingReviewRepository } from "../../repositories/market-matching-review.repository.js";

const MATCH_REPORT_PATH = "docs/cross-venue-match-report.json";

export class MarketMatchingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketMatchingServiceError";
  }
}

export interface MarketMatchingMemberRef {
  venue: string;
  venueMarketId: string;
  title: string;
  historicalRowCount: number;
}

/**
 * An exact-overlap clique the matching engine considers safe to pool. Operators
 * still approve promotion explicitly — this is a review-queue entry, not an action.
 */
export interface MarketMatchingExactOverlap {
  promotionId: string;
  eventTitle: string;
  category: string;
  promotionClass: string;
  targetMode: string;
  targetCanonicalEventId: string;
  targetCanonicalMarketId: string;
  members: MarketMatchingMemberRef[];
}

/**
 * A near-exact pair the engine refuses to pool automatically because at least one
 * required dimension differs. Surfaced with the failed dimensions so an operator can
 * judge whether the two markets are genuinely the same proposition.
 */
export interface MarketMatchingNearExact {
  matchId: string;
  eventTitle: string;
  category: string;
  venueSet: readonly string[];
  seed: { venue: string; venueMarketId: string; title: string };
  candidate: { venue: string; venueMarketId: string; title: string };
  finalConfidence: number;
  failedDimensions: readonly string[];
  blockReason: string | null;
  reviewStatus: "PENDING" | "REJECTED";
  rejectionReason: string | null;
}

export interface MarketMatchingReviewQueue {
  observedAt: string;
  generated: boolean;
  inventoryTotal: number;
  exactOverlapCount: number;
  nearExactCount: number;
  exactOverlaps: MarketMatchingExactOverlap[];
  nearExact: MarketMatchingNearExact[];
}

const toExactOverlap = (
  candidate: CrossVenueMatchReport["promotionCandidates"][number]
): MarketMatchingExactOverlap => ({
  promotionId: candidate.promotionId,
  eventTitle: candidate.eventTitle,
  category: candidate.category,
  promotionClass: candidate.promotionClass,
  targetMode: candidate.targetMode,
  targetCanonicalEventId: candidate.targetCanonicalEventId,
  targetCanonicalMarketId: candidate.targetCanonicalMarketId,
  members: candidate.memberRefs.map((member) => ({
    venue: member.venue,
    venueMarketId: member.venueMarketId,
    title: member.title,
    historicalRowCount: member.historicalRowCount
  }))
});

const toNearExact = (
  match: CrossVenueMatchReport["matches"][number],
  rejections: Map<string, string>
): MarketMatchingNearExact => {
  const rejectionReason = rejections.get(match.matchId) ?? null;
  return {
    matchId: match.matchId,
    eventTitle: match.seed.title,
    category: match.category,
    venueSet: match.venueSet,
    seed: {
      venue: match.seed.venue,
      venueMarketId: match.seed.venueMarketId,
      title: match.seed.title
    },
    candidate: {
      venue: match.candidate.venue,
      venueMarketId: match.candidate.venueMarketId,
      title: match.candidate.title
    },
    finalConfidence: match.finalConfidence,
    failedDimensions: match.failedDimensions,
    blockReason: match.blockReason,
    reviewStatus: rejectionReason === null ? "PENDING" : "REJECTED",
    rejectionReason
  };
};

const buildQueue = (
  report: CrossVenueMatchReport,
  generated: boolean,
  rejections: Map<string, string>
): MarketMatchingReviewQueue => {
  const exactOverlaps = report.promotionCandidates.map(toExactOverlap);
  const nearExact = report.matches
    .filter((match) => match.matchClass === "semantic_near_exact")
    .map((match) => toNearExact(match, rejections));

  return {
    observedAt: report.observedAt,
    generated,
    inventoryTotal: report.inventorySummary.totalMarkets,
    exactOverlapCount: exactOverlaps.length,
    nearExactCount: nearExact.length,
    exactOverlaps,
    nearExact
  };
};

/**
 * Read-only orchestration over the semantic cross-venue matcher. `runPipeline` runs the
 * engine and persists the report artifact; `getReviewQueue` serves the last persisted
 * report. Neither mutates the canonical graph or any trading state — promotion of an
 * exact overlap is a separate, operator-gated action.
 */
export class MarketMatchingService {
  private readonly reviewRepository: MarketMatchingReviewRepository;

  constructor(
    private readonly pool: Pool,
    private readonly repoRoot: string = process.cwd(),
    reviewRepository?: MarketMatchingReviewRepository
  ) {
    this.reviewRepository = reviewRepository ?? new MarketMatchingReviewRepository(pool);
  }

  async runPipeline(): Promise<MarketMatchingReviewQueue> {
    const [report, rejections] = await Promise.all([
      buildCrossVenueMatchReport(this.pool),
      this.reviewRepository.listRejections()
    ]);
    writeArtifact(this.repoRoot, MATCH_REPORT_PATH, report);
    return buildQueue(report, true, rejections);
  }

  /**
   * Operator-gated promotion of a single reviewed exact-overlap candidate into the
   * canonical graph. Runs against the last persisted match report; the candidate must
   * still be present there (re-run the pipeline if the report is stale). This mutates
   * the canonical graph and historical market states, so callers must enforce ADMIN+2FA.
   */
  async approve(promotionId: string): Promise<SemanticExactSyncSummary> {
    const summary = await syncSemanticExactOverlaps({
      repoRoot: this.repoRoot,
      pool: this.pool,
      promotionIds: [promotionId]
    });
    if (summary.processedPromotionCandidates === 0) {
      throw new MarketMatchingServiceError(
        `No exact-overlap candidate '${promotionId}' in the current match report. Re-run the pipeline and try again.`
      );
    }
    if (summary.skippedTargets.length > 0 && summary.promotedTargets.length === 0) {
      throw new MarketMatchingServiceError(
        `Promotion of '${promotionId}' was skipped: ${summary.skippedTargets[0]?.reason ?? "unknown reason"}.`
      );
    }
    return summary;
  }

  async getReviewQueue(): Promise<MarketMatchingReviewQueue> {
    let report: CrossVenueMatchReport;
    try {
      report = readArtifact<CrossVenueMatchReport>(this.repoRoot, MATCH_REPORT_PATH);
    } catch {
      return {
        observedAt: new Date(0).toISOString(),
        generated: false,
        inventoryTotal: 0,
        exactOverlapCount: 0,
        nearExactCount: 0,
        exactOverlaps: [],
        nearExact: []
      };
    }
    const rejections = await this.reviewRepository.listRejections();
    return buildQueue(report, true, rejections);
  }

  /**
   * Operator rejection of a near-exact pair. Persists the decision keyed by matchId so it
   * survives pipeline re-runs and is reflected as reviewStatus REJECTED in the queue.
   * Context (titles/venues) is captured from the current report when available.
   */
  async reject(matchId: string, reason: string, actor: string): Promise<MarketMatchingNearExact | null> {
    let match: CrossVenueMatchReport["matches"][number] | undefined;
    try {
      const report = readArtifact<CrossVenueMatchReport>(this.repoRoot, MATCH_REPORT_PATH);
      match = report.matches.find((entry) => entry.matchId === matchId);
    } catch {
      match = undefined;
    }
    await this.reviewRepository.rejectMatch({
      matchId,
      reason,
      decidedBy: actor,
      eventTitle: match?.seed.title ?? null,
      seedVenue: match?.seed.venue ?? null,
      seedVenueMarketId: match?.seed.venueMarketId ?? null,
      candidateVenue: match?.candidate.venue ?? null,
      candidateVenueMarketId: match?.candidate.venueMarketId ?? null
    });
    if (!match) {
      return null;
    }
    return toNearExact(match, new Map([[matchId, reason]]));
  }
}
