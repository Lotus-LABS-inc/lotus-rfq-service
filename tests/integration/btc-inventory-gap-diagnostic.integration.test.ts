import { describe, expect, it } from "vitest";

import { buildBtcInventoryGapDiagnosticFromInputs } from "../../src/operations/semantic-expansion/btc-inventory-gap-diagnostic.js";
import { parseStructuredProposition } from "../../src/simulation/proposition-matching.js";

describe("buildBtcInventoryGapDiagnosticFromInputs integration shape", () => {
  it("produces venue-audit summary rollups for mixed ingestion and venue scarcity", () => {
    const result = buildBtcInventoryGapDiagnosticFromInputs({
      matrix: {
        summary: {
          observedAt: new Date().toISOString(),
          metadataVersion: "test",
          scannedCryptoMarketCount: 2,
          countsByFamily: {
            ATH_BY_DATE: 0,
            THRESHOLD_BY_DATE: 0,
            SAME_DAY_DIRECTIONAL: 2,
            PRICE_AT_CLOSE: 0,
            GENERIC_UP_DOWN: 0
          },
          btcTargetableDates: [
            {
              family: "SAME_DAY_DIRECTIONAL",
              exactDate: "march 21 2026",
              cutoffStyle: "NOON_ET_DAILY",
              count: 1,
              representativeMarkets: [{ marketId: "10044", title: "Bitcoin Up or Down on March 21?(12:00 ET)" }]
            },
            {
              family: "SAME_DAY_DIRECTIONAL",
              exactDate: "march 22 2026",
              cutoffStyle: "NOON_ET_DAILY",
              count: 1,
              representativeMarkets: [{ marketId: "10045", title: "Bitcoin Up or Down on March 22?(12:00 ET)" }]
            }
          ],
          matrix: []
        },
        rows: [
          {
            marketId: "10044",
            title: "Bitcoin Up or Down on March 21?(12:00 ET)",
            asset: "bitcoin",
            family: "SAME_DAY_DIRECTIONAL",
            exactDate: "march 21 2026",
            cutoffStyle: "NOON_ET_DAILY",
            triggerStyle: "directional_yes_no"
          },
          {
            marketId: "10045",
            title: "Bitcoin Up or Down on March 22?(12:00 ET)",
            asset: "bitcoin",
            family: "SAME_DAY_DIRECTIONAL",
            exactDate: "march 22 2026",
            cutoffStyle: "NOON_ET_DAILY",
            triggerStyle: "directional_yes_no"
          }
        ]
      },
      inventory: [],
      crossVenueReport: {
        observedAt: new Date().toISOString(),
        afterRulepackRefresh: false,
        semanticsRulepackVersion: "test",
        inventorySummary: {
          totalMarkets: 0,
          categories: {},
          venues: { POLYMARKET: 0, LIMITLESS: 0, OPINION: 0, PREDICT: 0 } as never,
          evidenceLabels: { historical: 0, current_state: 0, recorder: 0, fallback: 0, live_inventory_only: 0 }
        },
        matches: [],
        promotionCandidates: [],
        summary: {
          exactHistoricalQualified: 0,
          exactLiveOnly: 0,
          nearExact: 0,
          proxyOrMismatch: 0,
          blockedByCompatibility: 0
        },
        metrics: {} as never
      },
      venueAuditUniverse: {
        POLYMARKET: {
          available: true,
          exactAbsenceAllowed: true,
          warnings: [],
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: "pm-live-21",
            title: "Bitcoin Up or Down on March 21?(12:00 ET)",
            rules: null,
            family: "SAME_DAY_DIRECTIONAL",
            asset: "bitcoin",
            exactDate: "march 21 2026",
            cutoffStyle: "NOON_ET_DAILY",
            parsed: parseStructuredProposition({
              category: "CRYPTO",
              title: "Bitcoin Up or Down on March 21?(12:00 ET)",
              rules: null
            }),
            evidenceProvenance: "api_confirmed",
            reference: "pm-live-21"
          }]
        },
        LIMITLESS: {
          available: true,
          exactAbsenceAllowed: false,
          warnings: ["limitless_live_api_unavailable_using_snapshot_positive_evidence_only"],
          candidates: []
        }
      }
    });

    expect(result.summary.countsByVenueAndClassification.some((row) => row.classification === "EXISTS_BUT_NOT_INGESTED")).toBe(true);
    expect(result.summary.auditOutcomeSummary.bucketsWhereInventoryScarcityRemainsTheBlockerEvenAfterFullIngestion).toBe(1);
    expect(result.markdown).toContain("Final conclusion");
  });
});
