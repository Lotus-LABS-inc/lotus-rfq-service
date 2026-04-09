import type {
  SportsLaLigaWinnerComparabilityTopicSummary,
  SportsLaLigaWinnerNormalizedTopicRow
} from "../matching/sports/sports-la-liga-winner-family-pass.js";
import { buildSportsLaLigaWinner20252026MatcherMaterialization } from "../matching/sports/sports-la-liga-winner-2025-2026-matcher.js";
import {
  buildSportsDerivedCardinalityLanes,
  buildSportsLaneCatalog
} from "../operations/semantic-expansion/sports-lane-cardinality-catalog.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";

const ARTIFACT_DIR = "artifacts/sports/la-liga-winner-2025-2026-matcher";
const TOPIC_KEY = "SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026" as const;
const ALL_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET|PREDICT" as const;
const LANE_ID_PREFIX = "SPORTS_LA_LIGA_WINNER_2025_2026" as const;
const PRIMARY_PAIR_LANE_ID = "SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET" as const;
const STRICT_ALL_LANE_ID = "SPORTS_LA_LIGA_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT" as const;

export interface SportsLaLigaWinner20252026MatcherRunResult {
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  allVenueLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runSportsLaLigaWinner20252026MatcherPass = async (input: {
  repoRoot: string;
}): Promise<SportsLaLigaWinner20252026MatcherRunResult> => {
  const normalizedTopics = readArtifact<SportsLaLigaWinnerNormalizedTopicRow[]>(
    input.repoRoot,
    "artifacts/sports/la-liga-winner-family-pass/sports-la-liga-winner-normalized-topics.json"
  );
  const comparabilitySummary = readArtifact<SportsLaLigaWinnerComparabilityTopicSummary[]>(
    input.repoRoot,
    "artifacts/sports/la-liga-winner-family-pass/sports-la-liga-winner-comparability-summary.json"
  );

  const materialized = buildSportsLaLigaWinner20252026MatcherMaterialization({
    normalizedTopics,
    comparabilitySummary
  });

  const inputSummary = {
    observedAt: new Date().toISOString(),
    exactTopic: TOPIC_KEY,
    refreshedRowsUsed: normalizedTopics
      .filter((row) => row.canonicalTopicKey === TOPIC_KEY)
      .map((row) => ({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        canonicalClubId: row.canonicalClubId
      })),
    familyComparabilitySourceArtifacts: {
      fetchSummary: "artifacts/sports/la-liga-winner-family-pass/sports-la-liga-winner-fetch-summary.json",
      admissionSummary: "artifacts/sports/la-liga-winner-family-pass/sports-la-liga-winner-admission-summary.json",
      normalizedTopics: "artifacts/sports/la-liga-winner-family-pass/sports-la-liga-winner-normalized-topics.json",
      comparabilitySummary: "artifacts/sports/la-liga-winner-family-pass/sports-la-liga-winner-comparability-summary.json",
      basisFragmentationSummary: "artifacts/sports/la-liga-winner-family-pass/sports-la-liga-winner-basis-fragmentation-summary.json",
      finalDecision: "artifacts/sports/la-liga-winner-family-pass/sports-la-liga-winner-final-decision.json"
    },
    admittedVenues: materialized.admittedVenues,
    admittedClubs: materialized.admittedClubs,
    exclusionsBeforeFinalLaneConstruction: materialized.rejections
  };

  const pairLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    matcherLanes: materialized.pairLanes.map((lane) => ({
      venuePair: lane.venuePair,
      club: lane.normalizedClubName,
      canonicalTopic: lane.canonicalTopicKey,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      evidenceNotes: lane.notes,
      evidence: lane.evidence
    }))
  };

  const allVenueLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    canonicalVenueSet: ALL_VENUE_SET,
    matcherLanes: materialized.allVenueLanes.map((lane) => ({
      venueSet: lane.canonicalVenueSet,
      club: lane.normalizedClubName,
      canonicalTopic: lane.canonicalTopicKey,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      evidenceNotes: lane.notes,
      evidence: lane.evidence
    })),
    notes:
      materialized.allVenueLanes.length > 0
        ? [`Strict all-venue lane survived the ${ALL_VENUE_SET} intersection on a ${materialized.allVenueLanes.length}-club core.`]
        : [`Strict all-venue lane is not currently justified from admitted venues ${materialized.admittedVenues.join("|") || "none"}.`]
  };

  const rejections = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    rejections: materialized.rejections
  };

  const derivedLanes = buildSportsDerivedCardinalityLanes({
    matcherInputSummary: inputSummary as never,
    matcherPairLanes: pairLanes as never,
    matcherStrictAllLanes: allVenueLanes as never
  });

  const singleLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    matcherLanes: derivedLanes.singleLanes.map((lane) => ({
      venue: lane.venue,
      venueSet: lane.venueSet,
      clubs: lane.clubs
    }))
  };

  const triLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    matcherLanes: derivedLanes.triLanes.map((lane) => ({
      venueSet: lane.venueSet,
      clubs: lane.clubs
    }))
  };

  const strictAllLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    matcherLanes: derivedLanes.strictAllLanes.map((lane) => ({
      venueSet: lane.venueSet,
      clubs: lane.clubs
    }))
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    ...materialized.finalDecision
  };

  const laneCatalog = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    lanes: buildSportsLaneCatalog({
      config: {
        topicKey: TOPIC_KEY,
        laneIdPrefix: LANE_ID_PREFIX,
        primaryPairVenueSet: "LIMITLESS|POLYMARKET",
        legacyStrictAllLaneId: STRICT_ALL_LANE_ID,
        legacyPrimaryPairLaneId: PRIMARY_PAIR_LANE_ID,
        matcherArtifactRefs: [
          `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-matcher-input-summary.json`,
          `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-single-lanes.json`,
          `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-pair-lanes.json`,
          `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-tri-lanes.json`,
          `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-strict-all-lanes.json`,
          `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-final-decision.json`
        ]
      },
      matcherInputSummary: inputSummary as never,
      matcherPairLanes: pairLanes as never,
      matcherStrictAllLanes: allVenueLanes as never,
      matcherFinalDecision: finalDecision as never
    })
  };

  const pairLaneSummary = [...new Set(materialized.pairLanes.map((lane) => lane.venuePair))].join(", ") || "none";
  const allVenueClubSummary = materialized.allVenueLanes.map((lane) => lane.normalizedClubName).join(", ") || "none";
  const operatorSummary = [
    "# La Liga Winner 2025-2026 Matcher",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- surviving pair lanes: ${pairLaneSummary}`,
    `- best pair: ${materialized.finalDecision.bestPair ?? "none"}`,
    `- exact-safe pair club count on best pair: ${materialized.finalDecision.exactSafePairCandidateCount}`,
    `- strict all-venue lane: ${materialized.finalDecision.bestAllVenueIfAny ?? "none"}`,
    `- strict all-venue clubs: ${allVenueClubSummary}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- all-venue matcher ready: ${materialized.finalDecision.allVenueMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness follow-up justified: ${materialized.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    "- what is excluded: Other plus venue-only club tails outside the shared core",
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-single-lanes.json`, singleLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-tri-lanes.json`, triLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-all-venue-lanes.json`, allVenueLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-strict-all-lanes.json`, strictAllLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-final-decision.json`, finalDecision);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-lane-catalog.json`, laneCatalog);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-la-liga-winner-2025-2026-operator-summary.md`, `${operatorSummary}\n`);

  return {
    inputSummary,
    pairLanes,
    allVenueLanes,
    rejections,
    finalDecision,
    operatorSummary
  };
};
