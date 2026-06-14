import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MarketDiscoveryService } from "../../src/market-discovery/market-discovery-service.js";
import type {
  MarketDiscoveryCandidate,
  MarketDiscoveryQualityReport
} from "../../src/market-discovery/market-discovery-types.js";
import type { MarketDiscoveryRepository } from "../../src/repositories/market-discovery.repository.js";
import type { CrossVenueMatchReport } from "../../src/operations/semantic-expansion/shared.js";

const qualitylessPool = {} as never;

const baseCandidate = (overrides: Partial<MarketDiscoveryCandidate> = {}): MarketDiscoveryCandidate => ({
  id: "00000000-0000-4000-8000-000000000001",
  candidateKey: "candidate-one",
  state: "INGESTED",
  lifecycleState: "OPEN",
  approvedCanonicalEventId: null,
  candidateType: "NEW_DISCOVERY",
  sourceKind: "UPSTREAM_VENUE",
  eventTitle: "Decibel FDV above ___ one day after launch?",
  normalizedEventTitle: "decibel fdv above one day after launch",
  category: "CRYPTO",
  marketClass: "BINARY",
  semanticBoundaryKey: "2028-01-01",
  venueCount: 2,
  sharedOutcomeCount: 1,
  confidenceScore: 0.82,
  reasonCodes: ["EVENT_TITLE_MATCH", "CONTRACT_OUTCOME_OVERLAP"],
  noveltySummary: {},
  draftSemanticCore: {
    category: "CRYPTO",
    proposedEventTitle: "Decibel FDV above ___ one day after launch?",
    marketFamily: "FDV_AFTER_LAUNCH",
    subject: "DECIBEL",
    condition: "FDV_AFTER_LAUNCH",
    timeBoundary: "2028-01-01",
    marketClass: "BINARY",
    normalizedOutcomes: ["ABOVE_20000000"],
    venueMembers: [],
    missingFields: []
  },
  matchDimensions: {
    eventTitle: true,
    category: true,
    marketFamily: true,
    subject: true,
    condition: true,
    timeBoundary: true,
    outcomes: true,
    rulesSource: true,
    venueCount: true
  },
  unsafeGroupingWarnings: [],
  approvalActions: ["CREATE_CANONICAL_MARKET_HIDDEN", "REJECT"],
  routingStatus: "NOT_APPROVED",
  nextRoutingAction: "NONE",
  routingReview: { exactPromotionIds: [], nearExactMatchIds: [] },
  archiveEligibility: { eligible: false, reason: "not_terminal", eligibleAfter: null },
  venues: ["POLYMARKET", "PREDICT"],
  sharedOutcomes: ["ABOVE_20000000"],
  missingOutcomes: [],
  venueEvidence: [
    {
      venueMarketProfileId: "POLYMARKET:decibel-20m",
      canonicalEventId: null,
      canonicalMarketId: null,
      venue: "POLYMARKET",
      venueMarketId: "decibel-20m",
      title: "Decibel FDV above $20M one day after launch?",
      outcomes: ["Yes", "No"],
      quoteReady: true,
      executionReady: true,
      evidenceLabel: "current_state",
      historicalRowCount: 0
    },
    {
      venueMarketProfileId: "PREDICT:decibel-20m",
      canonicalEventId: null,
      canonicalMarketId: null,
      venue: "PREDICT",
      venueMarketId: "decibel-20m",
      title: "Decibel FDV above $20M one day after launch?",
      outcomes: ["Yes", "No"],
      quoteReady: true,
      executionReady: true,
      evidenceLabel: "current_state",
      historicalRowCount: 0
    }
  ],
  metadata: {
    semanticEvidence: [
      {
        venue: "POLYMARKET",
        venueMarketId: "decibel-20m",
        topicTitle: "Decibel FDV above ___ one day after launch?",
        topicKey: "decibel:fdv_after_launch",
        contractLabel: "$20M",
        contractKey: "ABOVE_20000000"
      },
      {
        venue: "PREDICT",
        venueMarketId: "decibel-20m",
        topicTitle: "Decibel FDV above ___ one day after launch?",
        topicKey: "decibel:fdv_after_launch",
        contractLabel: "$20M",
        contractKey: "ABOVE_20000000"
      }
    ]
  },
  ...overrides
});

const fakeRepository = (overrides: Partial<MarketDiscoveryRepository> = {}): MarketDiscoveryRepository => ({
  listCandidates: async () => [],
  listSnapshotHealthRows: async () => [],
  listPooledApprovedCanonicalEventIds: async () => new Set<string>(),
  ...overrides
}) as unknown as MarketDiscoveryRepository;

const baseReport = (overrides: Partial<CrossVenueMatchReport> = {}): CrossVenueMatchReport => ({
  observedAt: "2026-06-14T00:00:00.000Z",
  afterRulepackRefresh: false,
  semanticsRulepackVersion: "test",
  inventorySummary: {
    totalMarkets: 0,
    categories: {},
    venues: {
      LIMITLESS: 0,
      MYRIAD: 0,
      OPINION: 0,
      POLYMARKET: 0,
      PREDICT: 0
    },
    evidenceLabels: {
      current_state: 0,
      fallback: 0,
      historical: 0,
      live_inventory_only: 0,
      recorder: 0
    }
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
  metrics: {
    suggestions: 0,
    accepted: 0,
    rejected: 0,
    stale: 0
  } as never,
  ...overrides
});

const withMatchReport = (report: CrossVenueMatchReport): string => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "lotus-discovery-report-"));
  mkdirSync(path.join(repoRoot, "docs"));
  writeFileSync(path.join(repoRoot, "docs", "cross-venue-match-report.json"), `${JSON.stringify(report)}\n`, "utf8");
  return repoRoot;
};

describe("market discovery quality reporting", () => {
  it("defaults candidate lists to open lifecycle rows", async () => {
    let capturedFilter: unknown;
    const service = new MarketDiscoveryService(
      qualitylessPool,
      fakeRepository({
        listCandidates: async (filter: unknown) => {
          capturedFilter = filter;
          return [];
        }
      }),
      process.cwd()
    );

    await service.listCandidates();

    expect(capturedFilter).toEqual({ lifecycleState: "OPEN" });
  });

  it("summarizes quality counts, missing venues, extraction health, and low-confidence samples", async () => {
    const lowConfidence = baseCandidate({
      id: "00000000-0000-4000-8000-000000000002",
      candidateKey: "candidate-low",
      state: "DISCOVERED",
      candidateType: "LOW_CONFIDENCE",
      venues: ["LIMITLESS"],
      draftSemanticCore: {
        ...baseCandidate().draftSemanticCore!,
        missingFields: ["subject", "outcomeOverlap"]
      },
      metadata: {
        semanticEvidence: [
          {
            venue: "LIMITLESS",
            venueMarketId: "lim-missing",
            topicTitle: "Unknown topic",
            topicKey: "unknown-topic",
            contractLabel: null,
            contractKey: null
          }
        ]
      }
    });
    const service = new MarketDiscoveryService(
      qualitylessPool,
      fakeRepository({
        listCandidates: async () => [baseCandidate(), lowConfidence],
        listSnapshotHealthRows: async () => [
          {
            venue: "POLYMARKET",
            venueMarketId: "decibel-20m",
            title: "Decibel FDV above $20M one day after launch?",
            active: true,
            outcomeCount: 2,
            hasEventTitle: true,
            hasTokenSlugOrOrderbookKey: true,
            quoteReady: true,
            executionReady: true
          },
          {
            venue: "LIMITLESS",
            venueMarketId: "lim-missing",
            title: "Unknown topic",
            active: true,
            outcomeCount: 0,
            hasEventTitle: false,
            hasTokenSlugOrOrderbookKey: false,
            quoteReady: false,
            executionReady: false
          }
        ]
      }),
      process.cwd()
    );

    const report: MarketDiscoveryQualityReport = await service.getQualityReport();

    expect(report.counts.newDiscoveries).toBe(1);
    expect(report.counts.lowConfidence).toBe(1);
    expect(report.counts.pairCoverage).toBe(1);
    expect(report.missingVenueEvidence.NO_MATCHED_LIMITLESS_CONTRACT).toBe(1);
    expect(report.extractionHealth.POLYMARKET?.topicKeyPresent).toBe(1);
    expect(report.extractionHealth.LIMITLESS?.eventTitlePresent).toBe(0);
    expect(report.extractionHealth.LIMITLESS?.sampleMissingRows[0]?.missing).toEqual(
      expect.arrayContaining(["eventTitle", "contractKey", "outcomes", "tokenSlugOrOrderbookKey"])
    );
    expect(report.lowConfidenceSamples.subject?.[0]?.candidateId).toBe(lowConfidence.id);
  });

  it("derives pair/tri routing status from match reports and pooled canonical events", async () => {
    const approvedEventId = "00000000-0000-4000-8000-000000000099";
    const approved = baseCandidate({
      state: "APPROVED",
      approvedCanonicalEventId: approvedEventId
    });
    const repoRoot = withMatchReport(baseReport({
      promotionCandidates: [
        {
          promotionId: "promo_decibel_pair",
          eventTitle: approved.eventTitle,
          category: "CRYPTO",
          promotionClass: "live_only_exact_overlap",
          targetMode: "new_exact_overlap",
          targetCanonicalEventId: "target-event",
          targetCanonicalMarketId: "target-market",
          exactClique: true,
          blockReason: null,
          memberRefs: [
            {
              venue: "POLYMARKET",
              venueMarketId: "decibel-20m",
              title: "Decibel FDV above $20M one day after launch?",
              canonicalEventId: "seed-event",
              canonicalMarketId: null,
              evidenceLabel: "current_state",
              historicalRowCount: 0
            }
          ]
        }
      ]
    }));
    try {
      const service = new MarketDiscoveryService(
        qualitylessPool,
        fakeRepository({
          listCandidates: async () => [approved],
          listPooledApprovedCanonicalEventIds: async () => new Set<string>()
        }),
        repoRoot
      );

      const { candidates } = await service.listCandidates({ lifecycleState: "OPEN" });

      expect(candidates[0]?.routingStatus).toBe("PAIR_TRI_REVIEW_AVAILABLE");
      expect(candidates[0]?.nextRoutingAction).toBe("OPEN_PAIR_TRI_REVIEW");
      expect(candidates[0]?.routingReview.exactPromotionIds).toEqual(["promo_decibel_pair"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }

    const pooledService = new MarketDiscoveryService(
      qualitylessPool,
      fakeRepository({
        listCandidates: async () => [approved],
        listPooledApprovedCanonicalEventIds: async () => new Set<string>([approvedEventId])
      }),
      process.cwd()
    );

    const { candidates } = await pooledService.listCandidates({ lifecycleState: "OPEN" });

    expect(candidates[0]?.routingStatus).toBe("POOLED_ROUTE_APPROVED");
    expect(candidates[0]?.nextRoutingAction).toBe("ALREADY_POOLED");
  });
});
