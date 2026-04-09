import { describe, expect, it } from "vitest";

import { SportsPocketMatchingPipeline } from "../../src/matching/sports/sports-pocket-matching-pipeline.js";
import { extractSportsBoundaryDetailed } from "../../src/matching/sports/sports-normalization.js";
import { buildNbaRepairArtifactsFromResult } from "../../src/reports/nba-repair-pass.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemorySportsRepository } from "./sports-test-harness.js";

const buildNbaMarket = (input: {
  interpretedContractId: string;
  venue: "POLYMARKET" | "OPINION" | "PREDICT";
  title: string;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  resolvesAt?: Date | null;
  sourceMetadataVersion?: string;
  historicalRowCount?: number;
}) => ({
  ...buildMatchingMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    venueMarketId: input.interpretedContractId,
    title: input.title,
    rulesText: "NBA matchup. If the listed team wins, the market resolves to that team.",
    category: "SPORTS",
    ...(input.sourceMetadataVersion ? { sourceMetadataVersion: input.sourceMetadataVersion } : {}),
    ...(input.historicalRowCount !== undefined ? { historicalRowCount: input.historicalRowCount } : {})
  }),
  publishedAt: input.publishedAt ?? new Date("2026-03-26T03:51:10.000Z"),
  expiresAt: input.expiresAt ?? new Date("2026-03-28T00:00:00.000Z"),
  resolvesAt: input.resolvesAt ?? new Date("2026-03-28T00:00:00.000Z"),
  outcomes: input.title.includes("Lakers")
    ? [{ label: "Lakers" }, { label: "Magic" }]
    : input.title.includes("Knicks")
      ? [{ label: "Knicks" }, { label: "Spurs" }]
      : [{ label: "Bulls" }, { label: "Grizzlies" }],
  outcomeSchema: { outcomeLabels: input.title.includes("Lakers") ? ["Lakers", "Magic"] : input.title.includes("Knicks") ? ["Knicks", "Spurs"] : ["Bulls", "Grizzlies"] }
});

describe("nba-repair-pass", () => {
  it("does not fabricate 1970 dates from epoch-sentinel opinion rows", () => {
    const boundary = extractSportsBoundaryDetailed(buildNbaMarket({
      interpretedContractId: "opinion-epoch",
      venue: "OPINION",
      title: "NBA: Bulls vs Grizzlies (Mar. 28 8:00PM ET)",
      publishedAt: new Date("2026-03-26T03:51:10.000Z"),
      expiresAt: new Date("2026-03-28T00:00:00.000Z"),
      resolvesAt: new Date("1970-01-01T00:00:00.000Z"),
      sourceMetadataVersion: "opinion-current-bootstrap-v1"
    }));

    expect(boundary.dateKey).toBe("2026-03-28");
    expect(boundary.scheduledBoundaryKey?.startsWith("2026-03-29T00:00:00.000Z")).toBe(true);
    expect(boundary.status).toBe("DATE_INFERRED");
    expect(boundary.unsafeDefaultReasons).toContain("RESOLVES_AT_EPOCH_SENTINEL");
  });

  it("builds the same deterministic nba matchup key when venue order differs", async () => {
    const repository = new InMemorySportsRepository([
      buildNbaMarket({
        interpretedContractId: "nba-left",
        venue: "POLYMARKET",
        title: "Lakers vs. Magic",
        publishedAt: new Date("2026-03-15T14:00:05.324Z"),
        expiresAt: new Date("2026-03-21T23:00:00.000Z"),
        resolvesAt: new Date("2026-03-21T23:00:00.000Z"),
        historicalRowCount: 12,
        sourceMetadataVersion: "predexon-v2"
      }),
      buildNbaMarket({
        interpretedContractId: "nba-right",
        venue: "OPINION",
        title: "NBA: Magic vs Lakers (Mar. 21 7:00PM ET)",
        publishedAt: new Date("2026-03-20T03:00:00.000Z"),
        expiresAt: new Date("2026-03-21T00:00:00.000Z"),
        resolvesAt: new Date("1970-01-01T00:00:00.000Z"),
        sourceMetadataVersion: "opinion-current-bootstrap-v1"
      })
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const entities = result.entityEvaluations.filter((row) => row.pocket === "SPORTS|MATCHUP_WINNER|NBA");

    expect(entities).toHaveLength(2);
    expect(entities[0]?.matchupKey).toBe(entities[1]?.matchupKey);
    expect(entities[0]?.canonicalSortedTeams).toEqual(["los angeles lakers", "orlando magic"]);
    expect(entities[1]?.canonicalSortedTeams).toEqual(["los angeles lakers", "orlando magic"]);
  });

  it("produces an exact-safe nba edge and same-game proof after repair", async () => {
    const repository = new InMemorySportsRepository([
      buildNbaMarket({
        interpretedContractId: "route-left",
        venue: "POLYMARKET",
        title: "Lakers vs. Magic",
        publishedAt: new Date("2026-03-15T14:00:05.324Z"),
        expiresAt: new Date("2026-03-21T23:00:00.000Z"),
        resolvesAt: new Date("2026-03-21T23:00:00.000Z"),
        sourceMetadataVersion: "predexon-v2"
      }),
      buildNbaMarket({
        interpretedContractId: "route-right",
        venue: "OPINION",
        title: "NBA: Lakers vs Magic (Mar. 21 7:00PM ET)",
        publishedAt: new Date("2026-03-20T03:00:00.000Z"),
        expiresAt: new Date("2026-03-21T00:00:00.000Z"),
        resolvesAt: new Date("1970-01-01T00:00:00.000Z"),
        sourceMetadataVersion: "opinion-current-bootstrap-v1"
      })
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const artifacts = buildNbaRepairArtifactsFromResult({
      result,
      baseline: {
        preRepairBadDateRows: 1,
        preRepairCandidatePairsConsidered: 1,
        preRepairMatchIdentityRejects: 1,
        preRepairDateAlignmentRejects: 1,
        preRepairExactSafeEdges: 0,
        preRepairRouteableOpportunities: 0
      }
    });

    expect(artifacts.dateRepairSummary.fakeEpochRowsAfter).toBe(0);
    expect(artifacts.matchInstanceProofSummary.proofClassCounts["SAME_GAME_PROVEN"]).toBe(1);
    expect(artifacts.routeabilitySummary.exactSafeApprovedEdges).toBe(1);
    expect(artifacts.finalDecision.decision).toBe("NBA_IDENTITY_REPAIRED__EXACT_SAFE_EDGES_CREATED");
  });
});
