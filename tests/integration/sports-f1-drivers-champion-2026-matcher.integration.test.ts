import { describe, expect, it } from "vitest";

import { buildSportsF1DriversChampion2026MatcherMaterialization } from "../../src/matching/sports/sports-f1-drivers-champion-2026-matcher.js";
import type {
  SportsF1DriversChampionComparabilityTopicSummary,
  SportsF1DriversChampionNormalizedTopicRow
} from "../../src/matching/sports/sports-f1-drivers-champion-family-pass.js";

const buildRow = (
  overrides: Partial<SportsF1DriversChampionNormalizedTopicRow>
): SportsF1DriversChampionNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "2026 F1 Drivers' Champion",
  canonicalFamily: "TOURNAMENT_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026",
  canonicalCompetition: "F1_DRIVERS_CHAMPIONSHIP",
  canonicalSeason: "2026",
  canonicalDriverId: overrides.canonicalDriverId ?? "george_russell",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<SportsF1DriversChampionComparabilityTopicSummary> = {}
): SportsF1DriversChampionComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 8,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 8,
  quadSharedNamedOutcomesCount: overrides.quadSharedNamedOutcomesCount ?? 4,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 1,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Charles Leclerc",
    "Fernando Alonso",
    "George Russell",
    "Kimi Antonelli",
    "Lando Norris",
    "Lewis Hamilton",
    "Max Verstappen",
    "Oscar Piastri"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "Other", reason: "OTHERS_EXCLUDED", venues: ["PREDICT"] }
  ],
  notes: overrides.notes ?? []
});

describe("sports f1 drivers champion 2026 matcher", () => {
  it("preserves the broader pair core while keeping the strict all-venue core to the shared 4-driver set", () => {
    const normalizedTopics: SportsF1DriversChampionNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-rus", venue: "LIMITLESS", venueMarketId: "ll-rus", canonicalDriverId: "george_russell" }),
      buildRow({ interpretedContractId: "ll-nor", venue: "LIMITLESS", venueMarketId: "ll-nor", canonicalDriverId: "lando_norris" }),
      buildRow({ interpretedContractId: "ll-ver", venue: "LIMITLESS", venueMarketId: "ll-ver", canonicalDriverId: "max_verstappen" }),
      buildRow({ interpretedContractId: "ll-pia", venue: "LIMITLESS", venueMarketId: "ll-pia", canonicalDriverId: "oscar_piastri" }),
      buildRow({ interpretedContractId: "ll-lec", venue: "LIMITLESS", venueMarketId: "ll-lec", canonicalDriverId: "charles_leclerc" }),
      buildRow({ interpretedContractId: "ll-alo", venue: "LIMITLESS", venueMarketId: "ll-alo", canonicalDriverId: "fernando_alonso" }),
      buildRow({ interpretedContractId: "ll-ant", venue: "LIMITLESS", venueMarketId: "ll-ant", canonicalDriverId: "kimi_antonelli" }),
      buildRow({ interpretedContractId: "ll-ham", venue: "LIMITLESS", venueMarketId: "ll-ham", canonicalDriverId: "lewis_hamilton" }),
      buildRow({ interpretedContractId: "op-rus", venue: "OPINION", venueMarketId: "op-rus", canonicalDriverId: "george_russell" }),
      buildRow({ interpretedContractId: "op-nor", venue: "OPINION", venueMarketId: "op-nor", canonicalDriverId: "lando_norris" }),
      buildRow({ interpretedContractId: "op-ver", venue: "OPINION", venueMarketId: "op-ver", canonicalDriverId: "max_verstappen" }),
      buildRow({ interpretedContractId: "op-pia", venue: "OPINION", venueMarketId: "op-pia", canonicalDriverId: "oscar_piastri" }),
      buildRow({ interpretedContractId: "pm-rus", venue: "POLYMARKET", venueMarketId: "pm-rus", canonicalDriverId: "george_russell" }),
      buildRow({ interpretedContractId: "pm-nor", venue: "POLYMARKET", venueMarketId: "pm-nor", canonicalDriverId: "lando_norris" }),
      buildRow({ interpretedContractId: "pm-ver", venue: "POLYMARKET", venueMarketId: "pm-ver", canonicalDriverId: "max_verstappen" }),
      buildRow({ interpretedContractId: "pm-pia", venue: "POLYMARKET", venueMarketId: "pm-pia", canonicalDriverId: "oscar_piastri" }),
      buildRow({ interpretedContractId: "pm-lec", venue: "POLYMARKET", venueMarketId: "pm-lec", canonicalDriverId: "charles_leclerc" }),
      buildRow({ interpretedContractId: "pm-alo", venue: "POLYMARKET", venueMarketId: "pm-alo", canonicalDriverId: "fernando_alonso" }),
      buildRow({ interpretedContractId: "pm-ant", venue: "POLYMARKET", venueMarketId: "pm-ant", canonicalDriverId: "kimi_antonelli" }),
      buildRow({ interpretedContractId: "pm-ham", venue: "POLYMARKET", venueMarketId: "pm-ham", canonicalDriverId: "lewis_hamilton" }),
      buildRow({ interpretedContractId: "pr-rus", venue: "PREDICT", venueMarketId: "pr-rus", canonicalDriverId: "george_russell" }),
      buildRow({ interpretedContractId: "pr-nor", venue: "PREDICT", venueMarketId: "pr-nor", canonicalDriverId: "lando_norris" }),
      buildRow({ interpretedContractId: "pr-ver", venue: "PREDICT", venueMarketId: "pr-ver", canonicalDriverId: "max_verstappen" }),
      buildRow({ interpretedContractId: "pr-pia", venue: "PREDICT", venueMarketId: "pr-pia", canonicalDriverId: "oscar_piastri" }),
      buildRow({ interpretedContractId: "pr-lec", venue: "PREDICT", venueMarketId: "pr-lec", canonicalDriverId: "charles_leclerc" }),
      buildRow({ interpretedContractId: "pr-alo", venue: "PREDICT", venueMarketId: "pr-alo", canonicalDriverId: "fernando_alonso" }),
      buildRow({ interpretedContractId: "pr-ant", venue: "PREDICT", venueMarketId: "pr-ant", canonicalDriverId: "kimi_antonelli" }),
      buildRow({ interpretedContractId: "pr-ham", venue: "PREDICT", venueMarketId: "pr-ham", canonicalDriverId: "lewis_hamilton" })
    ];

    const materialized = buildSportsF1DriversChampion2026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(8);
    expect(materialized.finalDecision.bestAllVenueIfAny).toBe("LIMITLESS|OPINION|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.exactSafeAllVenueCandidateCount).toBe(4);
    expect(materialized.strictAllLanes.map((lane) => lane.normalizedDriverName)).toEqual([
      "george_russell",
      "lando_norris",
      "max_verstappen",
      "oscar_piastri"
    ]);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(8);
    expect(materialized.rejections.some((rejection) => rejection.normalizedDriverName === "charles_leclerc" && rejection.reason === "ALL_VENUE_EDGE_MISSING")).toBe(true);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_F1_DRIVERS_CHAMPION_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST");
  });
});
