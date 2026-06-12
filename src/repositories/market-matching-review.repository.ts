import type { Pool } from "pg";

export interface MarketMatchingRejectionInput {
  matchId: string;
  eventTitle?: string | null;
  seedVenue?: string | null;
  seedVenueMarketId?: string | null;
  candidateVenue?: string | null;
  candidateVenueMarketId?: string | null;
  reason: string;
  decidedBy: string;
}

/**
 * Persists operator review decisions on near-exact cross-venue matches. Rejections are
 * keyed by the matcher's stable matchId so they survive pipeline re-runs.
 */
export class MarketMatchingReviewRepository {
  public constructor(private readonly pool: Pool) {}

  public async rejectMatch(input: MarketMatchingRejectionInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO market_matching_review_decisions
          (match_id, decision, event_title, seed_venue, seed_venue_market_id,
           candidate_venue, candidate_venue_market_id, reason, decided_by, decided_at, updated_at)
        VALUES ($1, 'REJECTED', $2, $3, $4, $5, $6, $7, $8, now(), now())
        ON CONFLICT (match_id) DO UPDATE
          SET decision = 'REJECTED',
              event_title = EXCLUDED.event_title,
              seed_venue = EXCLUDED.seed_venue,
              seed_venue_market_id = EXCLUDED.seed_venue_market_id,
              candidate_venue = EXCLUDED.candidate_venue,
              candidate_venue_market_id = EXCLUDED.candidate_venue_market_id,
              reason = EXCLUDED.reason,
              decided_by = EXCLUDED.decided_by,
              updated_at = now()`,
      [
        input.matchId,
        input.eventTitle ?? null,
        input.seedVenue ?? null,
        input.seedVenueMarketId ?? null,
        input.candidateVenue ?? null,
        input.candidateVenueMarketId ?? null,
        input.reason,
        input.decidedBy
      ]
    );
  }

  /** Map of rejected matchId -> rejection reason. */
  public async listRejections(): Promise<Map<string, string>> {
    const result = await this.pool.query<{ match_id: string; reason: string }>(
      `SELECT match_id, reason FROM market_matching_review_decisions WHERE decision = 'REJECTED'`
    );
    return new Map(result.rows.map((row) => [row.match_id, row.reason]));
  }
}
