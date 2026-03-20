import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { HistoricalSimulationCatalogService } from "../../src/api/admin/historical-simulation-catalog-service.js";

const buildPool = () =>
  ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT EXISTS")) {
        return { rows: [{ exists: params?.[0] === "HISTSIM::demo-event" }] };
      }

      if (sql.includes("FROM historical_simulation_profiles")) {
        return {
          rows: [
            {
              id: "profile-opinion",
              venue: "OPINION",
              venue_market_id: "6808",
              canonical_event_id: "HISTSIM::demo-event",
              canonical_market_id: "HISTSIM-demo-market",
              oracle_type: "ORACLE",
              oracle_name: "OPINION",
              resolution_authority_type: "CENTRAL",
              primary_resolution_text: "Demo market",
              supplemental_rules_text: null,
              dispute_window_hours: null,
              settlement_lag_hours: null,
              market_type: "BINARY",
              outcome_schema: null,
              has_ambiguous_time_boundary: false,
              has_ambiguous_jurisdiction_boundary: false,
              has_ambiguous_source_reference: false,
              historical_divergence_rate: null,
              metadata: { catalogScope: "historical_simulation" },
              created_at: new Date("2026-03-19T00:00:00.000Z"),
              updated_at: new Date("2026-03-19T00:00:00.000Z")
            },
            {
              id: "profile-limitless",
              venue: "LIMITLESS",
              venue_market_id: "demo-limitless",
              canonical_event_id: "HISTSIM::demo-event",
              canonical_market_id: "HISTSIM-demo-market",
              oracle_type: "ORACLE",
              oracle_name: "LIMITLESS",
              resolution_authority_type: "CENTRAL",
              primary_resolution_text: "Demo market",
              supplemental_rules_text: null,
              dispute_window_hours: null,
              settlement_lag_hours: null,
              market_type: "BINARY",
              outcome_schema: null,
              has_ambiguous_time_boundary: false,
              has_ambiguous_jurisdiction_boundary: false,
              has_ambiguous_source_reference: false,
              historical_divergence_rate: null,
              metadata: { catalogScope: "historical_simulation" },
              created_at: new Date("2026-03-19T00:00:00.000Z"),
              updated_at: new Date("2026-03-19T00:00:00.000Z")
            }
          ]
        };
      }

      if (sql.includes("FROM historical_simulation_risk_assessments")) {
        return {
          rows: [
            {
              id: "assessment-new",
              canonical_event_id: "HISTSIM::demo-event",
              canonical_market_id: "HISTSIM-demo-market",
              market_a_profile_id: "profile-limitless",
              market_b_profile_id: "profile-opinion",
              risk_score: "0.02",
              confidence_score: "0.95",
              equivalence_class: "SAFE_EQUIVALENT",
              factor_breakdown: {},
              reasons: ["exact_match"],
              version: "historical-sim-catalog-v1",
              computed_at: new Date("2026-03-19T01:00:00.000Z"),
              liquidity_cost: null,
              max_settlement_delay_hours: null
            },
            {
              id: "assessment-old",
              canonical_event_id: "HISTSIM::demo-event",
              canonical_market_id: "HISTSIM-demo-market",
              market_a_profile_id: "profile-limitless",
              market_b_profile_id: "profile-opinion",
              risk_score: "0.05",
              confidence_score: "0.80",
              equivalence_class: "CAUTION",
              factor_breakdown: {},
              reasons: ["stale"],
              version: "historical-sim-catalog-v0",
              computed_at: new Date("2026-03-18T01:00:00.000Z"),
              liquidity_cost: null,
              max_settlement_delay_hours: null
            }
          ]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    })
  }) as unknown as Pool;

describe("HistoricalSimulationCatalogService", () => {
  it("loads simulation-only profiles and keeps the latest effective pair assessment", async () => {
    const service = new HistoricalSimulationCatalogService({
      pool: buildPool(),
      version: "historical-sim-catalog-v1"
    });

    await expect(service.hasCanonicalEvent("HISTSIM::demo-event")).resolves.toBe(true);
    await expect(service.hasCanonicalEvent("HISTSIM::missing")).resolves.toBe(false);

    const inspection = await service.getCanonicalInspection("HISTSIM::demo-event");

    expect(inspection.canonicalEventId).toBe("HISTSIM::demo-event");
    expect(inspection.profiles).toHaveLength(2);
    expect(inspection.assessments).toHaveLength(1);
    expect(inspection.assessments[0]).toEqual(
      expect.objectContaining({
        id: "assessment-new",
        canonicalMarketId: "HISTSIM-demo-market",
        equivalenceClass: "SAFE_EQUIVALENT"
      })
    );
    expect(inspection.scoringVersion).toBe("historical-sim-catalog-v1");
    expect(inspection.freshness).toEqual(
      expect.objectContaining({
        profileCount: 2,
        expectedPairCount: 1,
        persistedPairCount: 1,
        isComplete: true,
        isStale: false
      })
    );
  });
});
