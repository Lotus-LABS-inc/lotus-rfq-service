import { describe, expect, it } from "vitest"

import { HistoricalMarketClass, type CreateHistoricalMarketStateInput } from "../../src/core/historical-simulation/historical-simulation.types.js"
import type { NormalizedResolutionProfile, ResolutionRiskAssessment } from "../../src/core/rfq-engine/resolution-risk.types.js"
import {
  CanonicalHistoricalNormalizer,
  CanonicalHistoricalNormalizerError,
  type CanonicalHistoricalMapping,
  type CanonicalHistoricalResolutionRiskSnapshot
} from "../../src/simulation/canonical-historical-normalizer.js"

const createState = (overrides: Partial<CreateHistoricalMarketStateInput> = {}): CreateHistoricalMarketStateInput => ({
  canonicalEventId: "placeholder-event",
  venue: "POLYMARKET",
  venueMarketId: "market-1",
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: new Date("2026-03-13T00:00:00.000Z"),
  metadataVersion: "predexon-v2",
  sourceTimestamp: new Date("2026-03-13T00:00:00.000Z"),
  ...overrides
})

const createProfile = (id: string, canonicalEventId: string): NormalizedResolutionProfile => ({
  id,
  venue: "POLYMARKET",
  venueMarketId: `${id}-market`,
  canonicalEventId,
  canonicalMarketId: `${id}-canonical-market`,
  oracleType: "api_oracle",
  oracleName: "oracle",
  resolutionAuthorityType: "official",
  primaryResolutionText: "Resolves by official source.",
  supplementalRulesText: null,
  disputeWindowHours: "24",
  settlementLagHours: "2",
  marketType: "binary",
  outcomeSchema: { yes: true, no: true },
  hasAmbiguousTimeBoundary: false,
  hasAmbiguousJurisdictionBoundary: false,
  hasAmbiguousSourceReference: false,
  historicalDivergenceRate: "0.0",
  metadata: {},
  createdAt: new Date("2026-03-12T00:00:00.000Z"),
  updatedAt: new Date("2026-03-12T01:00:00.000Z")
})

const createAssessment = (
  marketAProfileId: string,
  marketBProfileId: string,
  equivalenceClass: ResolutionRiskAssessment["equivalenceClass"]
): ResolutionRiskAssessment => ({
  id: `${marketAProfileId}-${marketBProfileId}`,
  canonicalEventId: "canonical-event-1",
  canonicalMarketId: "canonical-market-1",
  marketAProfileId,
  marketBProfileId,
  riskScore: "0.05",
  confidenceScore: "0.95",
  equivalenceClass,
  factorBreakdown: {},
  reasons: equivalenceClass === "SAFE_EQUIVALENT" ? ["aligned"] : ["mismatch"],
  version: "resolution-risk-v1",
  computedAt: new Date("2026-03-13T00:00:00.000Z")
})

const createSnapshot = (
  overrides: Partial<CanonicalHistoricalResolutionRiskSnapshot> = {}
): CanonicalHistoricalResolutionRiskSnapshot => ({
  canonicalEventId: "canonical-event-1",
  profiles: [createProfile("profile-a", "canonical-event-1"), createProfile("profile-b", "canonical-event-1")],
  assessments: [createAssessment("profile-a", "profile-b", "SAFE_EQUIVALENT")],
  scoringVersion: "resolution-risk-v1",
  freshness: {
    profileCount: 2,
    expectedPairCount: 1,
    persistedPairCount: 1,
    lastComputedAt: new Date("2026-03-13T00:00:00.000Z"),
    latestProfileUpdatedAt: new Date("2026-03-12T01:00:00.000Z"),
    isComplete: true,
    isStale: false,
    hasMixedVersions: false
  },
  safeEquivalentEligible: true,
  poolingReason: "all_safe_equivalent",
  ...overrides
})

describe("CanonicalHistoricalNormalizer", () => {
  it("maps a sports binary market into a storage-ready normalized record", async () => {
    const mapping: CanonicalHistoricalMapping = {
      canonicalEventId: "canonical-sports-1",
      canonicalCategory: "SPORTS",
      canonicalMarketId: "canonical-market-1"
    }
    const normalizer = new CanonicalHistoricalNormalizer({
      mappingResolver: {
        resolve: async () => [mapping]
      }
    })

    const result = await normalizer.normalize({
      mode: "singleVenue",
      records: [
        {
          state: createState({
            venue: "POLYMARKET",
            venueMarketId: "sports-market-1",
            timestamp: new Date("2026-03-13T10:11:12.000Z"),
            sourceTimestamp: new Date("2026-03-13T10:11:12.000Z")
          })
        }
      ]
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(
      expect.objectContaining({
        canonicalCategory: "SPORTS",
        safeEquivalentEligible: true,
        mappingMetadata: mapping
      })
    )
    expect(result[0]?.state).toEqual(
      expect.objectContaining({
        canonicalEventId: "canonical-sports-1",
        canonicalMarketId: "canonical-market-1",
        venue: "POLYMARKET",
        venueMarketId: "sports-market-1"
      })
    )
    expect(result[0]?.timelineSliceStart.toISOString()).toBe("2026-03-13T10:11:12.000Z")
  })

  it("maps a crypto threshold market with resolution-risk snapshot and deterministic timeline slices", async () => {
    const normalizer = new CanonicalHistoricalNormalizer({
      mappingResolver: {
        resolve: async ({ venueMarketId }) => [
          {
            canonicalEventId: "canonical-event-1",
            canonicalCategory: "CRYPTO",
            canonicalMarketId: `canonical-${venueMarketId}`,
            resolutionProfileId: venueMarketId === "market-a" ? "profile-a" : "profile-b"
          }
        ]
      },
      resolutionRiskProvider: {
        getSnapshot: async () => createSnapshot()
      }
    })

    const result = await normalizer.normalize({
      mode: "pooledSimulation",
      sliceIntervalMs: 60_000,
      records: [
        {
          state: createState({
            venue: "POLYMARKET",
            venueMarketId: "market-b",
            timestamp: new Date("2026-03-13T10:01:40.000Z"),
            sourceTimestamp: new Date("2026-03-13T10:01:40.000Z")
          })
        },
        {
          state: createState({
            venue: "LIMITLESS",
            venueMarketId: "market-a",
            timestamp: new Date("2026-03-13T10:01:20.000Z"),
            sourceTimestamp: new Date("2026-03-13T10:01:20.000Z")
          })
        }
      ]
    })

    expect(result).toHaveLength(2)
    expect(result[0]?.canonicalCategory).toBe("CRYPTO")
    expect(result[0]?.resolutionRiskSnapshot?.canonicalEventId).toBe("canonical-event-1")
    expect(result[0]?.timelineSliceStart.toISOString()).toBe("2026-03-13T10:01:00.000Z")
    expect(result[0]?.state.venueMarketId).toBe("market-a")
    expect(result[1]?.state.venueMarketId).toBe("market-b")
  })

  it("fails closed when no canonical mapping exists", async () => {
    const normalizer = new CanonicalHistoricalNormalizer({
      mappingResolver: {
        resolve: async () => []
      }
    })

    await expect(
      normalizer.normalize({
        mode: "singleVenue",
        records: [{ state: createState() }]
      })
    ).rejects.toMatchObject({
      code: "canonical_mapping_missing"
    })
  })

  it("fails closed when canonical mapping is ambiguous", async () => {
    const normalizer = new CanonicalHistoricalNormalizer({
      mappingResolver: {
        resolve: async () => [
          { canonicalEventId: "event-1", canonicalCategory: "SPORTS" },
          { canonicalEventId: "event-2", canonicalCategory: "SPORTS" }
        ]
      }
    })

    await expect(
      normalizer.normalize({
        mode: "singleVenue",
        records: [{ state: createState() }]
      })
    ).rejects.toMatchObject({
      code: "canonical_mapping_ambiguous"
    })
  })

  it("fails closed when pooled simulation includes mixed canonical events", async () => {
    const normalizer = new CanonicalHistoricalNormalizer({
      mappingResolver: {
        resolve: async ({ venueMarketId }) => [
          {
            canonicalEventId: venueMarketId === "market-a" ? "event-a" : "event-b",
            canonicalCategory: "CRYPTO"
          }
        ]
      }
    })

    await expect(
      normalizer.normalize({
        mode: "pooledSimulation",
        records: [
          { state: createState({ venueMarketId: "market-a" }) },
          { state: createState({ venueMarketId: "market-b" }) }
        ]
      })
    ).rejects.toMatchObject({
      code: "mixed_canonical_event_group"
    })
  })

  it("fails closed when pooled resolution-risk assessment is not SAFE_EQUIVALENT", async () => {
    const normalizer = new CanonicalHistoricalNormalizer({
      mappingResolver: {
        resolve: async ({ venueMarketId }) => [
          {
            canonicalEventId: "canonical-event-1",
            canonicalCategory: "CRYPTO",
            resolutionProfileId: venueMarketId === "market-a" ? "profile-a" : "profile-b"
          }
        ]
      },
      resolutionRiskProvider: {
        getSnapshot: async () =>
          createSnapshot({
            safeEquivalentEligible: false,
            assessments: [createAssessment("profile-a", "profile-b", "CAUTION")],
            poolingReason: "contains_caution"
          })
      }
    })

    await expect(
      normalizer.normalize({
        mode: "pooledSimulation",
        records: [
          { state: createState({ venueMarketId: "market-a" }) },
          { state: createState({ venueMarketId: "market-b" }) }
        ]
      })
    ).rejects.toMatchObject({
      code: "resolution_risk_not_safe_equivalent"
    })
  })

  it("fails closed when pooled resolution-risk snapshot is stale", async () => {
    const normalizer = new CanonicalHistoricalNormalizer({
      mappingResolver: {
        resolve: async () => [
          {
            canonicalEventId: "canonical-event-1",
            canonicalCategory: "CRYPTO",
            resolutionProfileId: "profile-a"
          }
        ]
      },
      resolutionRiskProvider: {
        getSnapshot: async () =>
          createSnapshot({
            freshness: {
              profileCount: 2,
              expectedPairCount: 1,
              persistedPairCount: 0,
              lastComputedAt: new Date("2026-03-12T00:00:00.000Z"),
              latestProfileUpdatedAt: new Date("2026-03-13T00:00:00.000Z"),
              isComplete: false,
              isStale: true,
              hasMixedVersions: false
            }
          })
      }
    })

    await expect(
      normalizer.normalize({
        mode: "pooledSimulation",
        records: [{ state: createState({ venueMarketId: "market-a" }) }]
      })
    ).rejects.toMatchObject({
      code: "resolution_risk_snapshot_stale"
    })
  })
})
