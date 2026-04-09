import type { Pool } from "pg";

import type {
  PoliticsOfficeExitByDateComparabilityTopicSummary,
  PoliticsOfficeExitByDateNormalizedTopicRow
} from "../matching/politics/politics-office-exit-by-date-family-pass.js";
import { buildPoliticsOfficeExitTrump2026MatcherMaterialization } from "../matching/politics/politics-office-exit-trump-2026-matcher.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";

const ARTIFACT_DIR = "artifacts/politics/office-exit-trump-2026-matcher";
const TOPIC_KEY = "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31" as const;

export interface PoliticsOfficeExitTrump2026MatcherRunResult {
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  triLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsOfficeExitTrump2026MatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeExitTrump2026MatcherRunResult> => {
  void input.pool;
  const normalizedTopics = readArtifact<PoliticsOfficeExitByDateNormalizedTopicRow[]>(
    input.repoRoot,
    "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-normalized-topics.json"
  );
  const comparabilitySummary = readArtifact<PoliticsOfficeExitByDateComparabilityTopicSummary[]>(
    input.repoRoot,
    "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-comparability-summary.json"
  );

  const materialized = buildPoliticsOfficeExitTrump2026MatcherMaterialization({
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
        canonicalRuleMeaning: row.canonicalRuleMeaning
      })),
    familyComparabilitySourceArtifacts: {
      fetchSummary: "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-fetch-summary.json",
      admissionSummary: "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-admission-summary.json",
      normalizedTopics: "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-normalized-topics.json",
      comparabilitySummary: "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-comparability-summary.json",
      basisFragmentationSummary: "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-basis-fragmentation-summary.json",
      finalDecision: "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-final-decision.json"
    },
    admittedVenues: materialized.admittedVenues,
    admittedProposition: "trump_out_before_2027",
    exclusionsBeforeFinalLaneConstruction: materialized.rejections
  };

  const pairLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    matcherLanes: materialized.pairLanes.map((lane) => ({
      venuePair: lane.venuePair,
      proposition: lane.propositionIdentityKey,
      canonicalTopic: lane.canonicalTopicKey,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      evidenceNotes: lane.notes,
      evidence: lane.evidence
    }))
  };

  const triLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    venueSet: "LIMITLESS|OPINION|POLYMARKET",
    matcherLanes: materialized.triLanes.map((lane) => ({
      venueSet: lane.canonicalTriVenueSet,
      proposition: lane.propositionIdentityKey,
      canonicalTopic: lane.canonicalTopicKey,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      evidenceNotes: lane.notes,
      evidence: lane.evidence
    })),
    notes:
      materialized.triLanes.length > 0
        ? ["Strict tri lane survived the currently admitted LIMITLESS|OPINION|POLYMARKET intersection."]
        : [`Strict tri lane is not currently justified from admitted venues ${materialized.admittedVenues.join("|") || "none"}.`]
  };

  const rejections = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    rejections: materialized.rejections
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    ...materialized.finalDecision
  };

  const pairLaneSummary = [...new Set(materialized.pairLanes.map((lane) => lane.venuePair))].join(", ") || "none";
  const triSummary = materialized.triLanes.length > 0 ? "LIMITLESS|OPINION|POLYMARKET" : "none";
  const operatorSummary = [
    "# Trump Office Exit 2026 Matcher",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- surviving pair lanes: ${pairLaneSummary}`,
    `- exact-safe pair proposition: ${materialized.pairLanes.length > 0 ? "trump_out_before_2027" : "none"}`,
    `- exact-safe tri lane: ${triSummary}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- tri matcher ready: ${materialized.finalDecision.triMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness follow-up justified: ${materialized.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    "- what is excluded: MYRIAD and any widening beyond the exact Trump office-exit proposition or the freshly admitted venue truth",
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-trump-2026-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-trump-2026-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-trump-2026-tri-lanes.json`, triLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-trump-2026-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-trump-2026-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-trump-2026-operator-summary.md`, `${operatorSummary}\n`);

  return {
    inputSummary,
    pairLanes,
    triLanes,
    rejections,
    finalDecision,
    operatorSummary
  };
};
