import type {
  SportsLplWinnerComparabilityTopicSummary,
  SportsLplWinnerNormalizedTopicRow
} from "../matching/sports/sports-lpl-winner-family-pass.js";
import { buildSportsLplWinner2026MatcherMaterialization } from "../matching/sports/sports-lpl-winner-2026-matcher.js";
import {
  buildSportsDerivedCardinalityLanes,
  buildSportsLaneCatalog
} from "../operations/semantic-expansion/sports-lane-cardinality-catalog.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";

const ARTIFACT_DIR = "artifacts/sports/lpl-winner-2026-matcher";
const TOPIC_KEY = "SPORTS|LEAGUE_WINNER|LPL|2026" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;
const LANE_ID_PREFIX = "SPORTS_LPL_WINNER_2026" as const;
const PRIMARY_PAIR_LANE_ID = "SPORTS_LPL_WINNER_2026_PAIR_LIMITLESS_POLYMARKET" as const;
const LEGACY_STRICT_ALL_LANE_ID = "SPORTS_LPL_WINNER_2026_STRICT_ALL_UNUSED" as const;

export interface SportsLplWinner2026MatcherRunResult {
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  triLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runSportsLplWinner2026MatcherPass = async (input: {
  repoRoot: string;
}): Promise<SportsLplWinner2026MatcherRunResult> => {
  const normalizedTopicsArtifact = readArtifact<SportsLplWinnerNormalizedTopicRow[]>(
    input.repoRoot,
    "artifacts/sports/lpl-winner-family-pass/sports-lpl-winner-normalized-topics.json"
  );
  const comparabilityArtifact = readArtifact<SportsLplWinnerComparabilityTopicSummary[]>(
    input.repoRoot,
    "artifacts/sports/lpl-winner-family-pass/sports-lpl-winner-comparability-summary.json"
  );

  const materialized = buildSportsLplWinner2026MatcherMaterialization({
    normalizedTopics: normalizedTopicsArtifact,
    comparabilitySummary: comparabilityArtifact
  });

  const inputSummary = {
    observedAt: new Date().toISOString(),
    exactTopic: TOPIC_KEY,
    refreshedRowsUsed: normalizedTopicsArtifact
      .filter((row) => row.canonicalTopicKey === TOPIC_KEY)
      .map((row) => ({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        canonicalClubId: row.canonicalTeamId
      })),
    familyComparabilitySourceArtifacts: {
      fetchSummary: "artifacts/sports/lpl-winner-family-pass/sports-lpl-winner-fetch-summary.json",
      admissionSummary: "artifacts/sports/lpl-winner-family-pass/sports-lpl-winner-admission-summary.json",
      normalizedTopics: "artifacts/sports/lpl-winner-family-pass/sports-lpl-winner-normalized-topics.json",
      comparabilitySummary: "artifacts/sports/lpl-winner-family-pass/sports-lpl-winner-comparability-summary.json",
      basisFragmentationSummary: "artifacts/sports/lpl-winner-family-pass/sports-lpl-winner-basis-fragmentation-summary.json",
      finalDecision: "artifacts/sports/lpl-winner-family-pass/sports-lpl-winner-final-decision.json"
    },
    admittedVenues: materialized.admittedVenues,
    admittedTeams: materialized.admittedTeams,
    exclusionsBeforeFinalLaneConstruction: materialized.rejections
  };

  const pairLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    matcherLanes: materialized.pairLanes.map((lane) => ({
      venuePair: lane.venuePair,
      club: lane.normalizedTeamName,
      canonicalTopic: lane.canonicalTopicKey,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      evidenceNotes: lane.notes,
      evidence: lane.evidence
    }))
  };

  const triLaneRows = [...new Set(materialized.pairLanes.map((lane) => lane.normalizedTeamName))]
    .filter((team) =>
      inputSummary.refreshedRowsUsed.filter((row) => row.canonicalClubId === team).length >= 3
    )
    .sort();

  const triLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    canonicalVenueSet: TRI_VENUE_SET,
    matcherLanes: triLaneRows.map((team) => ({
      venueSet: TRI_VENUE_SET,
      club: team,
      canonicalTopic: TOPIC_KEY,
      routeabilityDecision: materialized.finalDecision.ruleStatus === "EXACT_RULE_COMPATIBLE"
        ? "TRI_EXACT_AUTO_ROUTEABLE"
        : "TRI_REVIEW_REQUIRED",
      rulesDecision: materialized.finalDecision.ruleStatus,
      evidenceNotes: materialized.finalDecision.ruleStatus === "EXACT_RULE_COMPATIBLE"
        ? [`Exact-safe strict tri LPL winner team leg on ${TRI_VENUE_SET}.`]
        : [
          "Team leg survives the strict 3-venue intersection, but venue wording is semantically compatible rather than exact.",
          "Operator review is required before treating this strict tri lane as exact-safe."
        ]
    })),
    notes:
      triLaneRows.length > 0
        ? [`Strict tri lane survived the ${TRI_VENUE_SET} intersection on a ${triLaneRows.length}-team core.`]
        : [`Strict tri lane is not currently justified from admitted venues ${materialized.admittedVenues.join("|") || "none"}.`]
  };

  const rejections = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    rejections: materialized.rejections
  };

  const derivedLanes = buildSportsDerivedCardinalityLanes({
    matcherInputSummary: inputSummary as never,
    matcherPairLanes: pairLanes as never,
    matcherStrictAllLanes: {
      canonicalTopicKey: TOPIC_KEY,
      canonicalVenueSet: "LIMITLESS|OPINION|POLYMARKET|UNUSED",
      matcherLanes: []
    } as never
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

  const derivedTriLanes = {
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
    matcherLanes: [] as Array<{ venueSet: string; clubs: readonly string[] }>
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
        legacyStrictAllLaneId: LEGACY_STRICT_ALL_LANE_ID,
        legacyPrimaryPairLaneId: PRIMARY_PAIR_LANE_ID,
        matcherArtifactRefs: [
          `${ARTIFACT_DIR}/sports-lpl-winner-2026-matcher-input-summary.json`,
          `${ARTIFACT_DIR}/sports-lpl-winner-2026-single-lanes.json`,
          `${ARTIFACT_DIR}/sports-lpl-winner-2026-pair-lanes.json`,
          `${ARTIFACT_DIR}/sports-lpl-winner-2026-tri-lanes.json`,
          `${ARTIFACT_DIR}/sports-lpl-winner-2026-final-decision.json`
        ]
      },
      matcherInputSummary: inputSummary as never,
      matcherPairLanes: pairLanes as never,
      matcherStrictAllLanes: {
        canonicalTopicKey: TOPIC_KEY,
        canonicalVenueSet: "LIMITLESS|OPINION|POLYMARKET|UNUSED",
        matcherLanes: []
      } as never,
      matcherFinalDecision: {
        ...finalDecision,
        bestAllVenueIfAny: null,
        allVenueMatcherReady: false
      } as never
    })
  };

  const pairLaneSummary = [...new Set(materialized.pairLanes.map((lane) => lane.venuePair))].join(", ") || "none";
  const triTeamSummary = triLaneRows.join(", ") || "none";
  const operatorSummary = [
    "# LPL Winner 2026 Matcher",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- surviving pair lanes: ${pairLaneSummary}`,
    `- best pair: ${materialized.finalDecision.bestPair ?? "none"}`,
    `- exact-safe pair team count on best pair: ${materialized.finalDecision.exactSafePairCandidateCount}`,
    `- strict tri lane: ${materialized.finalDecision.bestTriIfAny ?? "none"}`,
    `- strict tri teams: ${triTeamSummary}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- tri matcher ready: ${materialized.finalDecision.triMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness follow-up justified: ${materialized.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    "- what is excluded: venue-only team tails outside the shared core",
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-2026-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-2026-single-lanes.json`, singleLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-2026-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-2026-tri-lanes.json`, derivedTriLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-2026-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-2026-final-decision.json`, finalDecision);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-2026-lane-catalog.json`, laneCatalog);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/sports-lpl-winner-2026-operator-summary.md`, `${operatorSummary}\n`);

  return {
    inputSummary,
    pairLanes,
    triLanes,
    rejections,
    finalDecision,
    operatorSummary
  };
};
