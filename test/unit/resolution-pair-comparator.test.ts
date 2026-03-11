import { describe, expect, it } from "vitest";
import {
  ResolutionPairComparator,
  ResolutionPairComparisonError
} from "../../src/core/rfq-engine/resolution-pair-comparator.js";
import type { NormalizedResolutionProfile } from "../../src/core/rfq-engine/resolution-risk.types.js";

const makeProfile = (overrides: Partial<NormalizedResolutionProfile> = {}): NormalizedResolutionProfile => ({
  id: "9d4fd339-c202-4e38-bf8d-09e7401c6cd9",
  venue: "venue-a",
  venueMarketId: "market-1",
  canonicalEventId: "e45a24f7-ce99-4bfe-af96-c19c26c0e055",
  oracleType: "manual_committee",
  oracleName: "Resolution Committee",
  resolutionAuthorityType: "committee",
  primaryResolutionText: "Market resolves YES if the event occurs before deadline.",
  supplementalRulesText: "Primary venue bulletin controls if disputes arise.",
  disputeWindowHours: "24",
  settlementLagHours: "12",
  marketType: "binary",
  outcomeSchema: { outcomes: ["YES", "NO"] },
  hasAmbiguousTimeBoundary: false,
  hasAmbiguousJurisdictionBoundary: false,
  hasAmbiguousSourceReference: false,
  historicalDivergenceRate: null,
  metadata: {},
  createdAt: new Date("2026-03-11T12:00:00.000Z"),
  updatedAt: new Date("2026-03-11T12:00:00.000Z"),
  ...overrides
});

describe("ResolutionPairComparator", () => {
  const comparator = new ResolutionPairComparator();

  it("returns zero mismatches for identical profiles", () => {
    const profile = makeProfile();
    const result = comparator.compare(profile, makeProfile({ id: "31c635b4-7580-4dbf-a20f-d16b7064d9a8" }));

    expect(result.oracleMismatch.score).toBe(0);
    expect(result.ruleMismatch.score).toBe(0);
    expect(result.wordingAmbiguity.score).toBe(0);
    expect(result.disputeWindowMismatch.score).toBe(0);
    expect(result.settlementLagMismatch.score).toBe(0);
    expect(result.structuralMismatch.score).toBe(0);
    expect(result.historicalDivergence.score).toBe(0);
    expect(result.historicalDivergence.confidence).toBe(0.3);
  });

  it("flags different oracle authority on the same event", () => {
    const left = makeProfile();
    const right = makeProfile({
      id: "b0ca8e76-8258-43f6-8e7b-11eb0139e734",
      oracleType: "third_party_oracle",
      resolutionAuthorityType: "external_publisher"
    });

    const result = comparator.compare(left, right);

    expect(result.oracleMismatch.score).toBe(1);
    expect(result.oracleMismatch.reason).toContain("oracle type differs");
    expect(result.ruleMismatch.score).toBe(1);
    expect(result.ruleMismatch.reason).toContain("resolution authority differs");
  });

  it("detects ambiguous wording mismatch with partial overlap", () => {
    const left = makeProfile({
      primaryResolutionText: "Market resolves YES if the event occurs before the official deadline."
    });
    const right = makeProfile({
      id: "429fd622-6f30-41d4-b2d0-a131a2f55e84",
      primaryResolutionText: "Market resolves YES if the event happens before the deadline cutoff."
    });

    const result = comparator.compare(left, right);

    expect(result.wordingAmbiguity.score).toBe(0.5);
    expect(result.wordingAmbiguity.reason).toContain("partially overlaps");
  });

  it("detects binary versus categorical structural mismatch", () => {
    const left = makeProfile({
      marketType: "binary",
      outcomeSchema: { outcomes: ["YES", "NO"] }
    });
    const right = makeProfile({
      id: "6c4091b9-1f57-4a94-b2f5-07169dde98f9",
      marketType: "categorical",
      outcomeSchema: { outcomes: ["A", "B", "C"] }
    });

    const result = comparator.compare(left, right);

    expect(result.structuralMismatch.score).toBe(1);
    expect(result.structuralMismatch.reason).toContain("market type differs");
  });

  it("fails closed when canonical events differ", () => {
    expect(() =>
      comparator.compare(
        makeProfile(),
        makeProfile({
          id: "b91960e6-3e9a-4c13-b2f0-5b43e2627dd5",
          canonicalEventId: "a00254df-845e-431d-a4de-caf25afaf0b8"
        })
      )
    ).toThrowError(new ResolutionPairComparisonError("canonical_event_mismatch"));
  });

  it("fails closed on invalid resolution profile data", () => {
    expect(() =>
      comparator.compare(
        makeProfile({ oracleType: "" }),
        makeProfile({ id: "0c484765-cfd1-4e2b-81b4-4677f884ec9e" })
      )
    ).toThrow("invalid_resolution_profile");
  });

  it("fails closed on invalid numeric fields", () => {
    expect(() =>
      comparator.compare(
        makeProfile({ disputeWindowHours: "-1" }),
        makeProfile({ id: "b60d3f7c-7fa5-4f45-92d4-c04c1862d131" })
      )
    ).toThrow("invalid_numeric_resolution_profile");
  });

  it("fails closed on malformed outcome schema", () => {
    expect(() =>
      comparator.compare(
        makeProfile({ outcomeSchema: null }),
        makeProfile({ id: "7d55d518-881d-4fc1-aefe-0a14ba591086" })
      )
    ).toThrow("invalid_outcome_schema");
  });
});
