import { describe, expect, it, vi } from "vitest";
import { PgVerifiedPositionRepository } from "../src/repositories/execution-routing.repository.js";

describe("PgVerifiedPositionRepository", () => {
  it("falls back to sibling curated venue market ids when exact sell position lookup is empty", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          position_id: "position-1",
          user_id: "user-1",
          venue: "POLYMARKET",
          market_id: "FRONTEND_CURATED:SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026|CHARLES_LECLERC:POLYMARKET",
          outcome_id: "YES",
          venue_account_address: null,
          verified_size: "25.609756",
          average_entry_price: "0.041",
          sellable_size: "25.609756",
          last_settlement_evidence_id: "fill-1",
          status: "VERIFIED",
          metadata: {
            venueMarketId: "0xcondition",
            venueOutcomeId: "1234567890"
          }
        }]
      });
    const repository = new PgVerifiedPositionRepository({ query } as never);

    const rows = await repository.listVerifiedPositions({
      userId: "user-1",
      marketId: "FRONTEND_CURATED:SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026|CHARLES_LECLERC:LIMITLESS",
      outcomeId: "YES"
    });

    expect(rows).toEqual([expect.objectContaining({
      positionId: "position-1",
      venue: "POLYMARKET",
      sellableSize: "25.609756"
    })]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[1]).toEqual([
      "user-1",
      "YES",
      "FRONTEND\\_CURATED:SPORTS|TOURNAMENT\\_WINNER|F1\\_DRIVERS\\_CHAMPIONSHIP|2026|CHARLES\\_LECLERC:%"
    ]);
  });
});
