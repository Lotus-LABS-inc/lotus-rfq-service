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

const normalizeVenue = (venue: string): string => (venue === "PREDICT" ? "PREDICT_FUN" : venue);

/**
 * Event-level accept (B1). Pools the event's EXACT-overlap candidates from the current match
 * report into the canonical graph via the proven promotionId-scoped sync.
 *
 * Near-exact override-pooling is deliberately NOT implemented: a read-only validation showed the
 * matcher's per-dimension flags are not reliable enough to gate parameter safety (it cleared a
 * BTC-ATH Dec-31 vs Jun-30 pair on timeBoundaryMatch), so auto-pooling near-exacts on those flags
 * could merge genuinely different markets. Near-exact candidates are surfaced read-only on the
 * event detail for operators to review and decline; new cross-venue pools go through the exact
 * path. Requires ADMIN+2FA at the route layer.
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

    const venueFilter = input.venues && input.venues.length > 0
      ? new Set(input.venues.map(normalizeVenue))
      : null;

    const promotionIds: string[] = [];
    for (const candidate of report.promotionCandidates) {
      const belongs = candidate.memberRefs.some((member) => eventKeyOf(member.canonicalEventId) === input.eventKey);
      if (!belongs) {
        continue;
      }
      if (venueFilter && !candidate.memberRefs.every((member) => venueFilter.has(normalizeVenue(member.venue)))) {
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
