import type { Pool } from "pg";

import {
  readArtifact,
  type CrossVenueMatchReport
} from "../../operations/semantic-expansion/shared.js";
import {
  syncSemanticExactOverlaps,
  type SemanticExactSyncSummary
} from "../../operations/semantic-expansion/semantic-exact-sync.js";
import { MarketEventReviewRepository } from "../../repositories/market-event-review.repository.js";
import { deriveEventKeyFromProposition } from "./market-event-review-service.js";

const MATCH_REPORT_PATH = "docs/cross-venue-match-report.json";

export class MarketEventAcceptServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketEventAcceptServiceError";
  }
}

export interface AcceptEventInput {
  eventKey: string;
  venues?: readonly string[] | undefined;
  reason: string;
}

export interface AcceptEventResult {
  eventKey: string;
  exactCandidatesPooled: number;
  summary: SemanticExactSyncSummary | null;
}

/**
 * Event-level accept (B1, Option A — exact path). Pools the event's exact-overlap candidates
 * from the current match report into the canonical graph, reusing the proven, promotionId-scoped
 * sync. Near-exact override pooling is intentionally not handled here yet (it mutates the graph on
 * operator assertion and is validated separately). Requires ADMIN+2FA at the route layer.
 */
export class MarketEventAcceptService {
  constructor(
    private readonly pool: Pool,
    private readonly eventRepository: MarketEventReviewRepository,
    private readonly repoRoot: string = process.cwd()
  ) {}

  async acceptEvent(input: AcceptEventInput): Promise<AcceptEventResult> {
    let report: CrossVenueMatchReport;
    try {
      report = readArtifact<CrossVenueMatchReport>(this.repoRoot, MATCH_REPORT_PATH);
    } catch {
      throw new MarketEventAcceptServiceError(
        "No match report is available. Run the matcher (POST /admin/market-matching/run) first."
      );
    }

    // Resolve the event grouping key for every canonical event referenced by a promotion candidate.
    const eventIds = new Set<string>();
    for (const candidate of report.promotionCandidates) {
      for (const member of candidate.memberRefs) {
        eventIds.add(member.canonicalEventId);
      }
    }
    const propositionKeys = await this.eventRepository.getPropositionKeys([...eventIds]);
    const eventKeyOf = (canonicalEventId: string): string => {
      const propositionKey = propositionKeys.get(canonicalEventId);
      return propositionKey
        ? deriveEventKeyFromProposition(propositionKey, canonicalEventId)
        : `event:raw:${canonicalEventId}`;
    };

    const venueFilter = input.venues && input.venues.length > 0 ? new Set(input.venues) : null;

    const promotionIds: string[] = [];
    for (const candidate of report.promotionCandidates) {
      const memberEventKeys = candidate.memberRefs.map((member) => eventKeyOf(member.canonicalEventId));
      const belongsToEvent = memberEventKeys.some((key) => key === input.eventKey);
      if (!belongsToEvent) {
        continue;
      }
      if (venueFilter && !candidate.memberRefs.every((member) => venueFilter.has(member.venue))) {
        continue;
      }
      promotionIds.push(candidate.promotionId);
    }

    if (promotionIds.length === 0) {
      return { eventKey: input.eventKey, exactCandidatesPooled: 0, summary: null };
    }

    const summary = await syncSemanticExactOverlaps({
      repoRoot: this.repoRoot,
      pool: this.pool,
      promotionIds
    });
    return {
      eventKey: input.eventKey,
      exactCandidatesPooled: summary.promotedTargets.length,
      summary
    };
  }
}
