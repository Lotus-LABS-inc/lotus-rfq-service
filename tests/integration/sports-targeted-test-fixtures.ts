import { SportsPocketMatchingPipeline } from "../../src/matching/sports/sports-pocket-matching-pipeline.js";
import type { MatchingMarketRecord } from "../../src/matching/matching-types.js";
import {
  buildSportsTargetedFixtureDiscoveryArtifactsFromResult,
  type SportsTargetedFixtureDiscoveryArtifacts,
  type SportsTargetedVenueInspectionStatus
} from "../../src/reports/sports-targeted-fixture-discovery.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemorySportsRepository } from "./sports-test-harness.js";

export const sportsTargetedNow = new Date("2026-04-02T12:00:00.000Z");

export const defaultVenueInspection: readonly SportsTargetedVenueInspectionStatus[] = [
  {
    venue: "OPINION",
    inspectionMode: "SCOPED_REFRESH_EXECUTED",
    fetchStatus: "SUCCESS",
    limitation: null
  },
  {
    venue: "POLYMARKET",
    inspectionMode: "SCOPED_REFRESH_UNAVAILABLE",
    fetchStatus: "NOT_ATTEMPTED",
    limitation: "Inventory only"
  },
  {
    venue: "LIMITLESS",
    inspectionMode: "SCOPED_REFRESH_EXECUTED",
    fetchStatus: "SUCCESS",
    limitation: null
  },
  {
    venue: "PREDICT",
    inspectionMode: "SCOPED_REFRESH_EXECUTED",
    fetchStatus: "SUCCESS",
    limitation: null
  }
];

const buildMatchWinnerMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  category: MatchingMarketRecord["category"];
  title: string;
  rulesText: string;
  teams: readonly [string, string];
  sourceMetadataVersion?: string;
  historicalRowCount?: number;
}): MatchingMarketRecord => ({
  ...buildMatchingMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    venueMarketId: input.interpretedContractId,
    title: input.title,
    rulesText: input.rulesText,
    category: input.category,
    ...(input.sourceMetadataVersion ? { sourceMetadataVersion: input.sourceMetadataVersion } : {}),
    ...(input.historicalRowCount !== undefined ? { historicalRowCount: input.historicalRowCount } : {})
  }),
  outcomes: [{ label: input.teams[0] }, { label: input.teams[1] }],
  outcomeSchema: { outcomeLabels: [input.teams[0], input.teams[1]] }
});

export const buildEplMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  title?: string;
  teams?: readonly [string, string];
  sourceMetadataVersion?: string;
  historicalRowCount?: number;
}): MatchingMarketRecord => {
  const teams = input.teams ?? ["Arsenal", "Chelsea"] as const;
  return buildMatchWinnerMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    category: "SPORTS",
    title: input.title ?? `EPL: ${teams[0]} vs ${teams[1]} (Apr 3 7:00PM ET)`,
    rulesText: "Premier League matchup winner for Apr 3 at 7:00PM ET.",
    teams,
    ...(input.sourceMetadataVersion ? { sourceMetadataVersion: input.sourceMetadataVersion } : {}),
    ...(input.historicalRowCount !== undefined ? { historicalRowCount: input.historicalRowCount } : {})
  });
};

export const buildLaLigaMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  title?: string;
  teams?: readonly [string, string];
  rulesText?: string;
}): MatchingMarketRecord => {
  const teams = input.teams ?? ["Real Madrid", "Barcelona"] as const;
  return buildMatchWinnerMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    category: "SPORTS",
    title: input.title ?? `La Liga: ${teams[0]} vs ${teams[1]} (Apr 4 3:00PM ET)`,
    rulesText: input.rulesText ?? "La Liga matchup winner for Apr 4 at 3:00PM ET.",
    teams
  });
};

export const buildValorantMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  title?: string;
  teams?: readonly [string, string];
  rulesText?: string;
}): MatchingMarketRecord => {
  const teams = input.teams ?? ["Sentinels", "Paper Rex"] as const;
  const title = input.title ?? `VALORANT Masters: ${teams[0]} vs ${teams[1]} (Apr 3 3:00PM ET)`;
  return buildMatchWinnerMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    category: "ESPORTS",
    title,
    rulesText: input.rulesText ?? `${title}.`,
    teams
  });
};

export const buildLolMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  title?: string;
  teams?: readonly [string, string];
  rulesText?: string;
}): MatchingMarketRecord => {
  const teams = input.teams ?? ["G2", "Fnatic"] as const;
  const title = input.title ?? `LEC: ${teams[0]} vs ${teams[1]} (Apr 4 1:00PM ET)`;
  return buildMatchWinnerMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    category: "ESPORTS",
    title,
    rulesText: input.rulesText ?? `${title}.`,
    teams
  });
};

export const runSportsTargetedArtifacts = async (input: {
  markets: readonly MatchingMarketRecord[];
  venueInspection?: readonly SportsTargetedVenueInspectionStatus[];
}): Promise<SportsTargetedFixtureDiscoveryArtifacts> => {
  const result = await new SportsPocketMatchingPipeline(new InMemorySportsRepository(input.markets)).run();
  return buildSportsTargetedFixtureDiscoveryArtifactsFromResult({
    result,
    now: sportsTargetedNow,
    venueInspection: input.venueInspection ?? defaultVenueInspection
  });
};
