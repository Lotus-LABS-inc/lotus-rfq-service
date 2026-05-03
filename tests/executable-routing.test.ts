import { describe, expect, it } from "vitest";
import {
  classifyGhostFillRecovery,
  ExecutableRouteService,
  SellQuoteService,
  type ExecutionQuoteRepository,
  type ExecutableTradeQuote,
  type RejectedRouteCandidate,
  type VerifiedExecutionPosition,
  type VerifiedPositionRepository
} from "../src/execution-system/executable-routing.js";
import type { ExecutionVenueReadinessSummary } from "../src/api/admin/execution-venues-admin-service.js";

const readyVenue = (venue: string, overrides: Partial<ExecutionVenueReadinessSummary> = {}): ExecutionVenueReadinessSummary => ({
  venue: venue as ExecutionVenueReadinessSummary["venue"],
  adapter: "PolymarketExecutionAdapterV2",
  executionSigningModel: "BACKEND_SIGNER",
  structuralReadiness: "LIVE_READY",
  operationalStatus: "STRUCTURALLY_READY",
  marketRoutingCoverage: "COVERED_BY_MATCHING",
  liveSubmissionSupported: true,
  liveExecutionEnabled: true,
  featureFlagSelected: true,
  host: "https://example.com",
  chainId: "1",
  requiredEnvPresent: true,
  missingEnv: [],
  dryRunRequiredEnvPresent: true,
  missingDryRunEnv: [],
  credentialsServerSideOnly: true,
  lastHarnessAttempt: {
    artifactPresent: true,
    generatedAt: "2026-05-03T00:00:00.000Z",
    mode: "LIVE_READY",
    submitted: true,
    errorCode: null,
    errorStatus: null,
    errorMessage: null,
    blockers: [],
    warnings: []
  },
  operatorMessage: "ready",
  venueAccountRequired: false,
  venueAccountConfigured: false,
  activeLinkedAccounts: 0,
  accountSetupBlockers: [],
  ...overrides
});

class MemoryQuoteRepository implements ExecutionQuoteRepository {
  public saved: { quote: ExecutableTradeQuote; rejectedCandidates: readonly RejectedRouteCandidate[] } | null = null;

  public async saveQuote(input: { quote: ExecutableTradeQuote; rejectedCandidates: readonly RejectedRouteCandidate[] }): Promise<void> {
    this.saved = input;
  }

  public async findQuote(input: { userId: string; quoteId: string }): Promise<ExecutableTradeQuote | null> {
    return this.saved?.quote.userId === input.userId && this.saved.quote.quoteId === input.quoteId
      ? this.saved.quote
      : null;
  }
}

class MemoryPositionRepository implements VerifiedPositionRepository {
  public constructor(private readonly rows: VerifiedExecutionPosition[]) {}

  public async listVerifiedPositions(input: {
    userId: string;
    marketId: string;
    outcomeId: string;
    venue?: string | undefined;
  }): Promise<VerifiedExecutionPosition[]> {
    return this.rows.filter((row) =>
      row.userId === input.userId &&
      row.marketId === input.marketId &&
      row.outcomeId === input.outcomeId &&
      (!input.venue || row.venue === input.venue)
    );
  }
}

const position = (venue: string, sellableSize = "4"): VerifiedExecutionPosition => ({
  positionId: `${venue}-position`,
  userId: "user-1",
  venue,
  marketId: "market-1",
  outcomeId: "yes",
  venueAccountAddress: "0x1111111111111111111111111111111111111111",
  verifiedSize: sellableSize,
  averageEntryPrice: 0.5,
  sellableSize,
  lastSettlementEvidenceId: "settlement-1",
  status: "VERIFIED"
});

describe("executable route selection", () => {
  it("prefers executable cross-venue routes and hides rejected candidates from user quote", async () => {
    const repository = new MemoryQuoteRepository();
    const service = new ExecutableRouteService({
      async listVenues() {
        return [
          readyVenue("POLYMARKET"),
          readyVenue("LIMITLESS"),
          readyVenue("OPINION", { liveExecutionEnabled: false, operationalStatus: "LIVE_DISABLED" })
        ];
      }
    }, repository, () => new Date("2026-05-03T00:00:00.000Z"));

    const result = await service.quote({
      userId: "user-1",
      side: "buy",
      marketId: "market-1",
      outcomeId: "yes",
      amount: "5",
      candidates: [
        { venue: "OPINION", price: 0.4, availableSize: "5" },
        { venue: "POLYMARKET", price: 0.45, availableSize: "3" },
        { venue: "LIMITLESS", price: 0.46, availableSize: "3" }
      ]
    });

    expect(result.quote).toMatchObject({
      routeType: "CROSS_VENUE",
      venuePath: ["POLYMARKET", "LIMITLESS"],
      executableAmount: "5"
    });
    expect(result.rejectedCandidates).toEqual([
      expect.objectContaining({
        venue: "OPINION",
        blockerCategory: "LIVE_SUBMIT_NOT_READY"
      })
    ]);
    expect(repository.saved?.quote.venuePath).toEqual(["POLYMARKET", "LIMITLESS"]);
  });

  it("falls back to a single executable venue when cross-venue route is not available", async () => {
    const service = new ExecutableRouteService({
      async listVenues() {
        return [
          readyVenue("POLYMARKET"),
          readyVenue("LIMITLESS", { liveExecutionEnabled: false, operationalStatus: "LIVE_DISABLED" })
        ];
      }
    });

    const result = await service.quote({
      userId: "user-1",
      side: "buy",
      marketId: "market-1",
      outcomeId: "yes",
      amount: "2",
      candidates: [
        { venue: "POLYMARKET", price: 0.5, availableSize: "2" },
        { venue: "LIMITLESS", price: 0.49, availableSize: "2" }
      ]
    });

    expect(result.quote).toMatchObject({
      routeType: "SINGLE_VENUE",
      venuePath: ["POLYMARKET"],
      executableAmount: "2"
    });
  });

  it("returns no user quote when no executable route exists", async () => {
    const service = new ExecutableRouteService({
      async listVenues() {
        return [readyVenue("PREDICT_FUN", { liveExecutionEnabled: false, operationalStatus: "LIVE_DISABLED" })];
      }
    });

    const result = await service.quote({
      userId: "user-1",
      side: "buy",
      marketId: "market-1",
      outcomeId: "yes",
      amount: "1",
      candidates: [{ venue: "PREDICT_FUN", price: 0.5, availableSize: "1" }]
    });

    expect(result.quote).toBeNull();
    expect(result.userMessage).toBe("No executable route available right now.");
  });
});

describe("sell quote sizing", () => {
  it("prepares single-venue 50 percent sell from verified position", async () => {
    const routes = new ExecutableRouteService({
      async listVenues() {
        return [readyVenue("POLYMARKET")];
      }
    });
    const service = new SellQuoteService(new MemoryPositionRepository([position("POLYMARKET", "4")]), routes);

    const result = await service.prepareExit({
      userId: "user-1",
      sellMode: "SINGLE_VENUE_SELL",
      venue: "POLYMARKET",
      sizeMode: "PERCENT",
      percent: 50,
      marketId: "market-1",
      outcomeId: "yes",
      candidates: [{ venue: "POLYMARKET", price: 0.6, availableSize: "4" }]
    });

    expect(result.allocations).toEqual([
      expect.objectContaining({ venue: "POLYMARKET", sellSize: "2", availableSize: "4" })
    ]);
    expect(result.quote).toMatchObject({ routeType: "SINGLE_VENUE", executableAmount: "2" });
  });

  it("allocates sell-all custom amount pro-rata across verified positions", async () => {
    const routes = new ExecutableRouteService({
      async listVenues() {
        return [readyVenue("POLYMARKET"), readyVenue("LIMITLESS")];
      }
    });
    const service = new SellQuoteService(new MemoryPositionRepository([
      position("POLYMARKET", "6"),
      position("LIMITLESS", "2")
    ]), routes);

    const result = await service.prepareExit({
      userId: "user-1",
      sellMode: "SELL_ALL",
      sizeMode: "CUSTOM_AMOUNT",
      amount: "4",
      marketId: "market-1",
      outcomeId: "yes",
      candidates: [
        { venue: "POLYMARKET", price: 0.6, availableSize: "6" },
        { venue: "LIMITLESS", price: 0.59, availableSize: "2" }
      ]
    });

    expect(result.allocations).toEqual([
      expect.objectContaining({ venue: "POLYMARKET", sellSize: "3" }),
      expect.objectContaining({ venue: "LIMITLESS", sellSize: "1" })
    ]);
    expect(result.quote).toMatchObject({ routeType: "CROSS_VENUE", executableAmount: "4" });
  });

  it("rejects custom sell amount above verified position", async () => {
    const routes = new ExecutableRouteService({ async listVenues() { return [readyVenue("POLYMARKET")]; } });
    const service = new SellQuoteService(new MemoryPositionRepository([position("POLYMARKET", "1")]), routes);

    await expect(service.prepareExit({
      userId: "user-1",
      sellMode: "SINGLE_VENUE_SELL",
      venue: "POLYMARKET",
      sizeMode: "CUSTOM_AMOUNT",
      amount: "2",
      marketId: "market-1",
      outcomeId: "yes",
      candidates: [{ venue: "POLYMARKET", price: 0.6, availableSize: "1" }]
    })).rejects.toThrow("Custom sell amount cannot exceed verified sellable position size.");
  });
});

describe("automated ghost-fill recovery classification", () => {
  it("selects retry, wait, reroute, refund, and manual review paths", () => {
    expect(classifyGhostFillRecovery({ evidenceState: "MISSING", statusFailureTransient: true })).toMatchObject({
      action: "AUTO_RETRY_STATUS",
      automated: true
    });
    expect(classifyGhostFillRecovery({ evidenceState: "MISSING", finalityDelayLikely: true })).toMatchObject({
      action: "AUTO_WAIT_FOR_FINALITY",
      automated: true
    });
    expect(classifyGhostFillRecovery({ evidenceState: "MISSING", fundsStillAvailable: true, positionExists: false })).toMatchObject({
      action: "AUTO_REROUTE",
      automated: true
    });
    expect(classifyGhostFillRecovery({ evidenceState: "MISSING", userNeedsRestoration: true, positionExists: false })).toMatchObject({
      action: "AUTO_REFUND",
      automated: true
    });
    expect(classifyGhostFillRecovery({ evidenceState: "MISSING", possibleDuplicatePosition: true })).toMatchObject({
      action: "MANUAL_REVIEW",
      automated: false
    });
  });
});
