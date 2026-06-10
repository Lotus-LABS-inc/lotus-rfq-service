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
  match: CrossVenueMatchReport["matches"][number]
): MarketMatchingNearExact => ({
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
  blockReason: match.blockReason
});

const buildQueue = (report: CrossVenueMatchReport, generated: boolean): MarketMatchingReviewQueue => {
  const exactOverlaps = report.promotionCandidates.map(toExactOverlap);
  const nearExact = report.matches
    .filter((match) => match.matchClass === "semantic_near_exact")
    .map(toNearExact);

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
  constructor(
    private readonly pool: Pool,
    private readonly repoRoot: string = process.cwd()
  ) {}

  async runPipeline(): Promise<MarketMatchingReviewQueue> {
    const report = await buildCrossVenueMatchReport(this.pool);
    writeArtifact(this.repoRoot, MATCH_REPORT_PATH, report);
    return buildQueue(report, true);
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

  getReviewQueue(): MarketMatchingReviewQueue {
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
    return buildQueue(report, true);
  }
}
