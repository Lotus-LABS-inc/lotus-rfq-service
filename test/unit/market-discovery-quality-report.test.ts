import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MarketDiscoveryService } from "../../src/market-discovery/market-discovery-service.js";
import type {
  MarketDiscoveryCandidate,
  MarketDiscoveryQualityReport,
  VenueMarketDiscoverySnapshot
} from "../../src/market-discovery/market-discovery-types.js";
import type { MarketDiscoveryRepository } from "../../src/repositories/market-discovery.repository.js";
import type { CrossVenueMatchReport } from "../../src/operations/semantic-expansion/shared.js";

const qualitylessPool = {} as never;

const baseCandidate = (overrides: Partial<MarketDiscoveryCandidate> = {}): MarketDiscoveryCandidate => ({
  id: "00000000-0000-4000-8000-000000000001",
  candidateKey: "candidate-one",
  reviewGroupKey: "review-group-one",
  reviewGroupTitle: "Decibel FDV above ___ one day after launch?",
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
    expect(report.extractionHealth.OPINION?.snapshotCount).toBe(0);
    expect(report.extractionHealth.PREDICT?.snapshotCount).toBe(0);
    expect(report.extractionHealth.LIMITLESS?.sampleMissingRows[0]?.missing).toEqual(
      expect.arrayContaining(["eventTitle", "contractKey", "outcomes", "tokenSlugOrOrderbookKey"])
    );
    expect(report.lowConfidenceSamples.subject?.[0]?.candidateId).toBe(lowConfidence.id);
  });

  it("keeps the quality report available when snapshot health is unavailable", async () => {
    const service = new MarketDiscoveryService(
      qualitylessPool,
      fakeRepository({
        listCandidates: async () => [baseCandidate()],
        listSnapshotHealthRows: async () => {
          throw new Error("snapshot health read model unavailable");
        }
      }),
      process.cwd()
    );

    const report = await service.getQualityReport();

    expect(report.counts.totalCandidates).toBe(1);
    expect(report.counts.newDiscoveries).toBe(1);
    expect(Object.keys(report.extractionHealth).sort()).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(report.extractionHealth.OPINION?.snapshotCount).toBe(0);
  });

  it("uses last good active snapshots when a venue is temporarily unavailable", async () => {
    const fallbackSnapshot: VenueMarketDiscoverySnapshot = {
      id: "00000000-0000-4000-8000-000000000301",
      venue: "OPINION",
      venueMarketId: "opinion-last-good",
      active: true,
      title: "Will Gamma launch a token by 2027?",
      normalizedTitle: "will gamma launch a token by 2027",
      category: "CRYPTO",
      marketClass: "BINARY",
      outcomes: ["Yes", "No"],
      semanticBoundaryKey: "2027-01-01",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      resolvesAt: new Date("2027-01-01T00:00:00.000Z"),
      rulesText: "Resolves from venue rules.",
      resolutionSource: "Opinion",
      slug: "gamma-token-2027",
      sourceUrl: "https://opinion.trade/market/gamma-token-2027",
      tokenIds: ["yes-token", "no-token"],
      quoteReady: true,
      executionReady: true,
      sourceHash: "last-good-hash",
      sourceKind: "UPSTREAM_VENUE",
      rawSummary: {}
    };
    let capturedVenues: readonly string[] = [];
    const service = new MarketDiscoveryService(
      qualitylessPool,
      fakeRepository({
        listActiveVenueSnapshots: async (venues: readonly string[]) => {
          capturedVenues = venues;
          return [fallbackSnapshot];
        }
      }),
      process.cwd()
    );

    const result = await (service as unknown as {
      snapshotsWithUnavailableVenueFallback(input: {
        snapshots: readonly VenueMarketDiscoverySnapshot[];
        venueStatuses: Record<string, { status: string; rowCount: number; warningCount: number }>;
      }): Promise<readonly VenueMarketDiscoverySnapshot[]>;
    }).snapshotsWithUnavailableVenueFallback({
      snapshots: [],
      venueStatuses: {
        OPINION: { status: "UNAVAILABLE", rowCount: 0, warningCount: 1 }
      }
    });

    expect(capturedVenues).toEqual(["OPINION"]);
    expect(result).toEqual([fallbackSnapshot]);
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

  it("keeps discovery lists available when pooled route state is unavailable", async () => {
    const approved = baseCandidate({
      state: "APPROVED",
      approvedCanonicalEventId: "00000000-0000-4000-8000-000000000099"
    });
    const service = new MarketDiscoveryService(
      qualitylessPool,
      fakeRepository({
        listCandidates: async () => [approved],
        listPooledApprovedCanonicalEventIds: async () => {
          throw new Error("missing pooled route read model");
        }
      }),
      process.cwd()
    );

    const { candidates } = await service.listCandidates({ lifecycleState: "OPEN" });

    expect(candidates[0]?.routingStatus).toBe("APPROVED_SINGLE_VENUE");
    expect(candidates[0]?.nextRoutingAction).toBe("RUN_MATCHER");
    expect(candidates[0]?.routingReview).toEqual({ exactPromotionIds: [], nearExactMatchIds: [] });
  });

  it("keeps discovery lists available when the match report artifact is stale", async () => {
    const approved = baseCandidate({
      state: "APPROVED",
      approvedCanonicalEventId: "00000000-0000-4000-8000-000000000099"
    });
    const repoRoot = mkdtempSync(path.join(tmpdir(), "lotus-discovery-stale-report-"));
    mkdirSync(path.join(repoRoot, "docs"));
    writeFileSync(
      path.join(repoRoot, "docs", "cross-venue-match-report.json"),
      `${JSON.stringify({ observedAt: "2026-06-14T00:00:00.000Z" })}\n`,
      "utf8"
    );
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

      expect(candidates[0]?.routingStatus).toBe("APPROVED_SINGLE_VENUE");
      expect(candidates[0]?.nextRoutingAction).toBe("RUN_MATCHER");
      expect(candidates[0]?.routingReview).toEqual({ exactPromotionIds: [], nearExactMatchIds: [] });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("persists candidate corrections and reclassifies when operator evidence completes the core", async () => {
    let candidate = baseCandidate({
      state: "DISCOVERED",
      candidateType: "LOW_CONFIDENCE",
      sharedOutcomes: [],
      sharedOutcomeCount: 0,
      draftSemanticCore: {
        ...baseCandidate().draftSemanticCore!,
        subject: null,
        normalizedOutcomes: [],
        missingFields: ["subject", "outcomes"]
      }
    });
    const insertedCorrections: unknown[] = [];
    const service = new MarketDiscoveryService(
      qualitylessPool,
      fakeRepository({
        getCandidate: async () => candidate,
        insertCorrection: async (input: unknown) => {
          insertedCorrections.push(input);
          return "correction-one";
        },
        updateCandidateReviewFields: async (input: Partial<MarketDiscoveryCandidate>) => {
          candidate = {
            ...candidate,
            ...input,
            draftSemanticCore: input.draftSemanticCore ?? candidate.draftSemanticCore,
            metadata: input.metadata ?? candidate.metadata
          };
        }
      }),
      process.cwd()
    );

    const result = await service.correctCandidate({
      candidateId: candidate.id,
      correctedBy: "operator@example.com",
      reason: "Predict child contract exposed the missing threshold.",
      patch: {
        topicTitle: "Decibel FDV above ___ one day after launch?",
        marketFamily: "FDV_AFTER_LAUNCH",
        subject: "DECIBEL",
        condition: "FDV_AFTER_LAUNCH",
        timeBoundary: "2028-01-01",
        contractLabel: "$20M",
        outcomes: ["ABOVE_20000000"]
      }
    });

    expect(result.correctionId).toBe("correction-one");
    expect(insertedCorrections).toHaveLength(1);
    expect(result.candidate.state).toBe("INGESTED");
    expect(result.candidate.candidateType).toBe("NEW_DISCOVERY");
    expect(result.candidate.sharedOutcomes).toEqual(["ABOVE_20000000"]);
    expect(result.candidate.reasonCodes).toContain("OPERATOR_CORRECTED");
  });

  it("group corrections persist shared evidence without accepting child contract labels", async () => {
    const rows = [
      baseCandidate({ id: "00000000-0000-4000-8000-000000000101", candidateKey: "candidate-a" }),
      baseCandidate({ id: "00000000-0000-4000-8000-000000000102", candidateKey: "candidate-b" })
    ];
    const insertedCorrections: Array<{ patch?: unknown }> = [];
    const updatedIds: string[] = [];
    const service = new MarketDiscoveryService(
      qualitylessPool,
      fakeRepository({
        listCandidates: async () => rows,
        insertCorrection: async (input: { patch?: unknown }) => {
          insertedCorrections.push(input);
          return "group-correction";
        },
        getCandidate: async (candidateId: string) => rows.find((row) => row.id === candidateId) ?? null,
        updateCandidateReviewFields: async (input: { candidateId: string }) => {
          updatedIds.push(input.candidateId);
        }
      }),
      process.cwd()
    );

    const result = await service.correctGroup({
      reviewGroupKey: "review-group-one",
      correctedBy: "operator@example.com",
      reason: "Shared title normalized from venue payloads.",
      patch: {
        topicTitle: "Kraken IPO Closing Market Cap Above",
        contractLabel: "$20B",
        subject: "KRAKEN"
      }
    });

    expect(result.correctionId).toBe("group-correction");
    expect(insertedCorrections[0]?.patch).toMatchObject({
      topicTitle: "Kraken IPO Closing Market Cap Above",
      subject: "KRAKEN"
    });
    expect(insertedCorrections[0]?.patch).not.toHaveProperty("contractLabel");
    expect(updatedIds).toEqual(rows.map((row) => row.id));
  });

  it("batch hidden approval skips non-ingested rows instead of approving them", async () => {
    const rows = [
      baseCandidate({
        id: "00000000-0000-4000-8000-000000000201",
        state: "DISCOVERED",
        candidateType: "LOW_CONFIDENCE"
      }),
      baseCandidate({
        id: "00000000-0000-4000-8000-000000000202",
        state: "REJECTED",
        candidateType: "NEW_DISCOVERY"
      })
    ];
    const service = new MarketDiscoveryService(
      qualitylessPool,
      fakeRepository({
        listCandidates: async () => rows
      }),
      process.cwd()
    );

    const result = await service.approveGroupHidden({
      reviewGroupKey: "review-group-one",
      approvedBy: "operator@example.com",
      reason: "Approve coherent hidden contracts."
    });

    expect(result.approved).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual(["candidate_not_ingested", "candidate_not_ingested"]);
  });
});
