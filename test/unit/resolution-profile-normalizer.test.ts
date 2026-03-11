import { describe, expect, it } from "vitest";
import {
  ResolutionProfileNormalizer,
  ResolutionProfileNormalizationError
} from "../../src/core/rfq-engine/resolution-profile-normalizer.js";
import type { ResolutionProfileNormalizerInput } from "../../src/core/rfq-engine/resolution-risk.types.js";

const baseMarket = {
  canonicalMarketId: "0b31f6d4-7e80-4426-9954-8e9e5ee5f6a4",
  canonicalEventId: "364c56c5-a2a0-4f55-bb16-01290c62af7c",
  venue: "venue-a",
  venueMarketId: "market-123"
} satisfies ResolutionProfileNormalizerInput["market"];

describe("ResolutionProfileNormalizer", () => {
  const normalizer = new ResolutionProfileNormalizer();

  it("normalizes flat venue metadata", () => {
    const result = normalizer.normalize({
      market: baseMarket,
      venueMetadata: {
        shape: "flat",
        oracleType: "manual_committee",
        oracleName: "Resolution Committee",
        resolutionAuthorityType: "committee",
        primaryResolutionText: "Resolves to YES if the event occurs before close.",
        supplementalRulesText: "Committee may rely on primary exchange notices.",
        disputeWindowHours: 24,
        settlementLagHours: "12",
        marketType: "binary",
        outcomeSchema: { yes: true, no: true },
        hasAmbiguousTimeBoundary: true,
        hasAmbiguousJurisdictionBoundary: false,
        hasAmbiguousSourceReference: true,
        historicalDivergenceRate: "0.025",
        metadata: { adapterVersion: "1.0.0" }
      }
    });

    expect(result.venue).toBe(baseMarket.venue);
    expect(result.venueMarketId).toBe(baseMarket.venueMarketId);
    expect(result.oracleType).toBe("manual_committee");
    expect(result.oracleName).toBe("Resolution Committee");
    expect(result.disputeWindowHours).toBe("24");
    expect(result.settlementLagHours).toBe("12");
    expect(result.historicalDivergenceRate).toBe("0.025");
    expect(result.outcomeSchema).toEqual({ yes: true, no: true });
    expect(result.hasAmbiguousTimeBoundary).toBe(true);
    expect(result.hasAmbiguousSourceReference).toBe(true);
    expect(result.metadata).toEqual({ adapterVersion: "1.0.0" });
  });

  it("normalizes nested rules venue metadata", () => {
    const result = normalizer.normalize({
      market: { ...baseMarket, venue: "venue-b", venueMarketId: "market-456" },
      venueMetadata: {
        shape: "nested_rules",
        oracle: {
          type: "exchange_oracle",
          name: "Venue Rules Oracle"
        },
        rules: {
          authorityType: "venue_rules",
          primaryText: "Market resolves according to published venue rulebook.",
          supplementalText: "Secondary notices apply if venue publishes an amendment."
        },
        timing: {
          disputeWindowHours: "48",
          settlementLagHours: 6
        },
        market: {
          type: "categorical",
          outcomeSchema: { outcomes: ["A", "B", "C"] }
        },
        ambiguity: {
          timeBoundary: false,
          jurisdictionBoundary: true,
          sourceReference: false
        },
        history: {
          divergenceRate: 0.1
        },
        metadata: {
          sourceSystem: "adapter-b"
        }
      }
    });

    expect(result.oracleType).toBe("exchange_oracle");
    expect(result.resolutionAuthorityType).toBe("venue_rules");
    expect(result.primaryResolutionText).toContain("published venue rulebook");
    expect(result.supplementalRulesText).toContain("Secondary notices");
    expect(result.disputeWindowHours).toBe("48");
    expect(result.settlementLagHours).toBe("6");
    expect(result.marketType).toBe("categorical");
    expect(result.hasAmbiguousJurisdictionBoundary).toBe(true);
    expect(result.metadata).toEqual({ sourceSystem: "adapter-b" });
  });

  it("normalizes oracle document venue metadata", () => {
    const result = normalizer.normalize({
      market: { ...baseMarket, venue: "venue-c", venueMarketId: "market-789" },
      venueMetadata: {
        shape: "oracle_document",
        resolution: {
          oracle: {
            type: "third_party_oracle",
            name: "Oracle Corp"
          },
          authority: {
            type: "external_publisher"
          },
          primaryText: "Oracle Corp published outcome controls settlement.",
          marketType: "binary",
          outcomeSchema: {
            outcomes: ["YES", "NO"]
          }
        },
        documents: {
          supplementalRulesText: "Fallback to venue bulletin if oracle unavailable."
        },
        windows: {
          disputeHours: "72",
          settlementLagHours: "18"
        },
        flags: {
          ambiguousTimeBoundary: false,
          ambiguousJurisdictionBoundary: false,
          ambiguousSourceReference: true
        },
        stats: {
          historicalDivergenceRate: "0.005"
        },
        metadata: {
          documentRef: "oracle-doc-42"
        }
      }
    });

    expect(result.oracleType).toBe("third_party_oracle");
    expect(result.oracleName).toBe("Oracle Corp");
    expect(result.resolutionAuthorityType).toBe("external_publisher");
    expect(result.disputeWindowHours).toBe("72");
    expect(result.settlementLagHours).toBe("18");
    expect(result.hasAmbiguousSourceReference).toBe(true);
    expect(result.historicalDivergenceRate).toBe("0.005");
  });

  it("fails closed when critical metadata is missing", () => {
    expect(() =>
      normalizer.normalize({
        market: baseMarket,
        venueMetadata: {
          shape: "flat",
          oracleType: "manual_committee",
          resolutionAuthorityType: "committee",
          marketType: "binary",
          outcomeSchema: { yes: true, no: true }
        }
      })
    ).toThrowError(new ResolutionProfileNormalizationError("missing_required_resolution_metadata"));
  });

  it("fails closed on invalid outcome schema", () => {
    expect(() =>
      normalizer.normalize({
        market: baseMarket,
        venueMetadata: {
          shape: "flat",
          oracleType: "manual_committee",
          resolutionAuthorityType: "committee",
          primaryResolutionText: "Some text",
          marketType: "binary",
          outcomeSchema: [] as unknown as Record<string, unknown>
        }
      })
    ).toThrow("invalid_outcome_schema");
  });

  it("fails closed on invalid numeric metadata", () => {
    expect(() =>
      normalizer.normalize({
        market: baseMarket,
        venueMetadata: {
          shape: "nested_rules",
          oracle: { type: "exchange_oracle" },
          rules: {
            authorityType: "venue_rules",
            primaryText: "Some primary text"
          },
          timing: {
            disputeWindowHours: -1
          },
          market: {
            type: "binary",
            outcomeSchema: { yes: true, no: true }
          }
        }
      })
    ).toThrow("invalid_numeric_resolution_metadata");
  });

  it("fails closed on invalid ambiguity flag", () => {
    expect(() =>
      normalizer.normalize({
        market: baseMarket,
        venueMetadata: {
          shape: "oracle_document",
          resolution: {
            oracle: { type: "third_party_oracle" },
            authority: { type: "external_publisher" },
            primaryText: "Oracle controls",
            marketType: "binary",
            outcomeSchema: { yes: true, no: true }
          },
          flags: {
            ambiguousTimeBoundary: "yes" as unknown as boolean
          }
        }
      })
    ).toThrow("invalid_ambiguity_flag");
  });
});
