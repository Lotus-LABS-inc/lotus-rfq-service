import { describe, expect, it } from "vitest";

import { buildBtcInventoryGapDiagnosticFromInputs } from "../../src/operations/semantic-expansion/btc-inventory-gap-diagnostic.js";
import type { OpinionCryptoDateFamilyMatrixResult } from "../../src/integrations/opinion/opinion-crypto-date-family-matrix.js";
import type { CrossVenueMatchReport, SemanticExpansionInventoryRow } from "../../src/operations/semantic-expansion/shared.js";
import type { VenueAuditSourceResult } from "../../src/operations/semantic-expansion/btc-venue-audit-sources.js";
import { parseStructuredProposition } from "../../src/simulation/proposition-matching.js";

const buildInventoryRow = (input: {
  venue: "POLYMARKET" | "LIMITLESS";
  venueMarketId: string;
  title: string;
  rules?: string | null;
}): SemanticExpansionInventoryRow => ({
  venueMarketProfileId: `${input.venue}-${input.venueMarketId}`,
  canonicalEventId: `${input.venue}-event-${input.venueMarketId}`,
  canonicalMarketId: null,
  currentExecutableMemberCount: 0,
  canonicalCategory: "CRYPTO",
  semanticCategory: "CRYPTO",
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  title: input.title,
  description: null,
  rules: input.rules ?? null,
  marketType: null,
  marketClass: "BINARY",
  outcomes: [],
  outcomeSchema: {},
  topics: [],
  publishedAt: null,
  expiresAt: null,
  resolvesAt: null,
  fees: {},
  feeModel: null,
  resolutionSource: null,
  resolutionTitle: null,
  resolutionRulesText: null,
  resolutionAuthorityType: null,
  sourceHierarchy: {},
  disputeWindowHours: null,
  ambiguousTimeBoundary: false,
  ambiguousSourceReference: false,
  ambiguousJurisdictionOrScope: false,
  settlementType: null,
  settlementLagHours: null,
  finalityLagHours: null,
  payoutTimingHours: null,
  feeOnEntry: false,
  feeOnExit: false,
  timeSensitiveFeeBehavior: null,
  requiresConservativeAnchor: false,
  network: null,
  chain: null,
  rawSourcePayload: {},
  normalizedPayload: {},
  mappingLineage: [],
  confidenceScore: null,
  sourceMetadataVersion: "test",
  historicalRowCount: 0,
  latestHistoricalTimestamp: null,
  evidenceLabel: "live_inventory_only"
});

const buildMatrix = (title: string, exactDate = "march 22 2026"): OpinionCryptoDateFamilyMatrixResult => ({
  summary: {
    observedAt: new Date().toISOString(),
    metadataVersion: "test",
    scannedCryptoMarketCount: 1,
    countsByFamily: {
      ATH_BY_DATE: 0,
      THRESHOLD_BY_DATE: 0,
      SAME_DAY_DIRECTIONAL: 1,
      PRICE_AT_CLOSE: 0,
      GENERIC_UP_DOWN: 0
    },
    btcTargetableDates: [{
      family: "SAME_DAY_DIRECTIONAL",
      exactDate,
      cutoffStyle: "NOON_ET_DAILY",
      count: 1,
      representativeMarkets: [{ marketId: "10045", title }]
    }],
    matrix: [{
      asset: "bitcoin",
      family: "SAME_DAY_DIRECTIONAL",
      exactDate,
      cutoffStyle: "NOON_ET_DAILY",
      count: 1,
      representativeMarkets: [{ marketId: "10045", title }]
    }]
  },
  rows: [{
    marketId: "10045",
    title,
    asset: "bitcoin",
    family: "SAME_DAY_DIRECTIONAL",
    exactDate,
    cutoffStyle: "NOON_ET_DAILY",
    triggerStyle: "directional_yes_no"
  }]
});

const emptyCrossVenueReport = (): CrossVenueMatchReport => ({
  observedAt: new Date().toISOString(),
  afterRulepackRefresh: false,
  semanticsRulepackVersion: "test",
  inventorySummary: {
    totalMarkets: 0,
    categories: {},
    venues: { POLYMARKET: 0, LIMITLESS: 0, OPINION: 0, PREDICT: 0 } as CrossVenueMatchReport["inventorySummary"]["venues"],
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
  metrics: {} as CrossVenueMatchReport["metrics"]
});

const emptyVenueAudit = (): VenueAuditSourceResult => ({
  available: false,
  exactAbsenceAllowed: false,
  candidates: [],
  warnings: []
});

const buildAuditCandidate = (input: {
  venue: "POLYMARKET" | "LIMITLESS";
  venueMarketId: string;
  title: string;
  family: string;
  asset: string | null;
  exactDate: string | null;
  cutoffStyle: "NOON_ET_DAILY" | "END_OF_DAY_BY_DATE" | "UNKNOWN";
  evidenceProvenance: "api_confirmed" | "snapshot_supported";
  reference?: string | null;
}) => ({
  ...input,
  rules: null,
  parsed: parseStructuredProposition({
    category: "CRYPTO",
    title: input.title,
    rules: null
  }),
  reference: input.reference ?? null
});

describe("buildBtcInventoryGapDiagnosticFromInputs", () => {
  it("classifies exists but not ingested from exact venue evidence", () => {
    const result = buildBtcInventoryGapDiagnosticFromInputs({
      matrix: buildMatrix("Bitcoin Up or Down on March 22?(12:00 ET)"),
      inventory: [],
      crossVenueReport: emptyCrossVenueReport(),
      venueAuditUniverse: {
        POLYMARKET: {
          available: true,
          exactAbsenceAllowed: true,
          warnings: [],
          candidates: [buildAuditCandidate({
            venue: "POLYMARKET",
            venueMarketId: "pm-live-1",
            title: "Bitcoin Up or Down on March 22?(12:00 ET)",
            family: "SAME_DAY_DIRECTIONAL",
            asset: "bitcoin",
            exactDate: "march 22 2026",
            cutoffStyle: "NOON_ET_DAILY",
            evidenceProvenance: "api_confirmed",
            reference: "pm-live-1"
          })]
        },
        LIMITLESS: emptyVenueAudit()
      }
    });

    expect(result.diagnostic.buckets[0]?.venueAuditByVenue.POLYMARKET.classification).toBe("EXISTS_BUT_NOT_INGESTED");
  });

  it("classifies ingested but rejected when same-family ingested candidate fails exactness", () => {
    const result = buildBtcInventoryGapDiagnosticFromInputs({
      matrix: buildMatrix("Bitcoin Up or Down on March 22?(12:00 ET)"),
      inventory: [buildInventoryRow({
        venue: "POLYMARKET",
        venueMarketId: "pm-wrong-date",
        title: "Bitcoin Up or Down on March 21?(12:00 ET)"
      })],
      crossVenueReport: emptyCrossVenueReport(),
      venueAuditUniverse: {
        POLYMARKET: {
          available: true,
          exactAbsenceAllowed: true,
          warnings: [],
          candidates: []
        },
        LIMITLESS: emptyVenueAudit()
      }
    });

    expect(result.diagnostic.buckets[0]?.venueAuditByVenue.POLYMARKET.classification).toBe("INGESTED_BUT_REJECTED");
  });

  it("classifies not found on venue when live audit is complete and no exact exists", () => {
    const result = buildBtcInventoryGapDiagnosticFromInputs({
      matrix: buildMatrix("Bitcoin Up or Down on March 22?(12:00 ET)"),
      inventory: [],
      crossVenueReport: emptyCrossVenueReport(),
      venueAuditUniverse: {
        POLYMARKET: {
          available: true,
          exactAbsenceAllowed: true,
          warnings: [],
          candidates: []
        },
        LIMITLESS: emptyVenueAudit()
      }
    });

    expect(result.diagnostic.buckets[0]?.venueAuditByVenue.POLYMARKET.classification).toBe("NOT_FOUND_ON_VENUE");
  });

  it("uses unknown when live evidence is incomplete", () => {
    const result = buildBtcInventoryGapDiagnosticFromInputs({
      matrix: buildMatrix("Bitcoin Up or Down on March 22?(12:00 ET)"),
      inventory: [],
      crossVenueReport: emptyCrossVenueReport(),
      venueAuditUniverse: {
        POLYMARKET: emptyVenueAudit(),
        LIMITLESS: emptyVenueAudit()
      }
    });

    expect(result.diagnostic.buckets[0]?.venueAuditByVenue.LIMITLESS.classification).toBe("UNKNOWN");
  });

  it("ranks nearer same-family matches ahead of cross-family matches", () => {
    const result = buildBtcInventoryGapDiagnosticFromInputs({
      matrix: buildMatrix("Bitcoin Up or Down on March 22?(12:00 ET)"),
      inventory: [],
      crossVenueReport: emptyCrossVenueReport(),
      venueAuditUniverse: {
        POLYMARKET: {
          available: true,
          exactAbsenceAllowed: true,
          warnings: [],
          candidates: [
            buildAuditCandidate({
              venue: "POLYMARKET",
              venueMarketId: "pm-cross-family",
              title: "Bitcoin all time high by March 31, 2026?",
              family: "ATH_BY_DATE",
              asset: "bitcoin",
              exactDate: "march 31 2026",
              cutoffStyle: "END_OF_DAY_BY_DATE",
              evidenceProvenance: "api_confirmed"
            }),
            buildAuditCandidate({
              venue: "POLYMARKET",
              venueMarketId: "pm-near-date",
              title: "Bitcoin Up or Down on March 21?(12:00 ET)",
              family: "SAME_DAY_DIRECTIONAL",
              asset: "bitcoin",
              exactDate: "march 21 2026",
              cutoffStyle: "NOON_ET_DAILY",
              evidenceProvenance: "api_confirmed"
            })
          ]
        },
        LIMITLESS: emptyVenueAudit()
      }
    });

    expect(result.diagnostic.buckets[0]?.nearestNearMatchCandidates.venueAudit.POLYMARKET[0]?.venueMarketId).toBe("pm-near-date");
  });

  it("aggregates summary counts for snapshot-supported and scarcity outcomes", () => {
    const result = buildBtcInventoryGapDiagnosticFromInputs({
      matrix: buildMatrix("Bitcoin Up or Down on March 22?(12:00 ET)"),
      inventory: [],
      crossVenueReport: emptyCrossVenueReport(),
      venueAuditUniverse: {
        POLYMARKET: {
          available: true,
          exactAbsenceAllowed: true,
          warnings: [],
          candidates: []
        },
        LIMITLESS: {
          available: true,
          exactAbsenceAllowed: false,
          warnings: [],
          candidates: [buildAuditCandidate({
            venue: "LIMITLESS",
            venueMarketId: "lm-snapshot-1",
            title: "Bitcoin Up or Down on March 22?(12:00 ET)",
            family: "SAME_DAY_DIRECTIONAL",
            asset: "bitcoin",
            exactDate: "march 22 2026",
            cutoffStyle: "NOON_ET_DAILY",
            evidenceProvenance: "snapshot_supported",
            reference: ".tmp-limitless-search-bitcoin.html"
          })]
        }
      }
    });

    expect(result.summary.limitlessEvidenceSummary.snapshotSupportedExistsButNotIngested).toBe(1);
    expect(result.summary.auditOutcomeSummary.bucketsWhereVenueInventoryTrulyDoesNotExist).toBe(1);
    expect(result.markdown).toContain("The remaining blocker");
  });
});
