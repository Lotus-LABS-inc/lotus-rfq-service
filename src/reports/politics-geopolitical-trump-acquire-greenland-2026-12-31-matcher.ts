import type { Pool } from "pg";

import { buildPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization } from "../matching/politics/politics-geopolitical-trump-acquire-greenland-2026-12-31-matcher.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import { runPoliticsGeopoliticalTrumpAcquireGreenlandFamilyPass, type PoliticsGeopoliticalTrumpAcquireGreenlandFamilyPassRunResult } from "./politics-geopolitical-trump-acquire-greenland-family-pass.js";

const ARTIFACT_DIR = "artifacts/politics/geopolitical-trump-acquire-greenland-2026-12-31-matcher";
const TOPIC_KEY = "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31" as const;

export interface PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherRunResult {
  familyPass: PoliticsGeopoliticalTrumpAcquireGreenlandFamilyPassRunResult;
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  triLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherRunResult> => {
  const familyPass = await runPoliticsGeopoliticalTrumpAcquireGreenlandFamilyPass(input);

  const materialized = buildPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization({
    comparabilitySummary: familyPass.comparabilitySummary as Parameters<typeof buildPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization>[0]["comparabilitySummary"]
  });

  const topicSummary = (familyPass.comparabilitySummary as Array<Record<string, unknown>>)
    .find((row) => row["topicKey"] === TOPIC_KEY) ?? null;

  const inputSummary = {
    observedAt: new Date().toISOString(),
    exactTopic: TOPIC_KEY,
    refreshedRowsUsed: (topicSummary?.["sourceRows"] as Array<Record<string, unknown>> | undefined)?.map((row) => ({
      venue: row["venue"],
      venueMarketId: row["venueMarketId"],
      title: row["title"]
    })) ?? [],
    familyComparabilitySourceArtifacts: {
      fetchSummary: "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-fetch-summary.json",
      admissionSummary: "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-admission-summary.json",
      normalizedTopics: "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-normalized-topics.json",
      comparabilitySummary: "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-comparability-summary.json",
      basisFragmentationSummary: "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-basis-fragmentation-summary.json",
      finalDecision: "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-final-decision.json"
    },
    admittedVenues: materialized.admittedVenues,
    admittedProposition: "trump_acquire_greenland_by_2026_12_31",
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
    venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
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
        ? ["Strict tri lane survived the currently admitted LIMITLESS|OPINION|POLYMARKET|PREDICT intersection."]
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
  const triSummary = materialized.triLanes.length > 0 ? "LIMITLESS|OPINION|POLYMARKET|PREDICT" : "none";
  const operatorSummary = [
    "# Trump Acquire Greenland 2026-12-31 Matcher",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- surviving pair lanes: ${pairLaneSummary}`,
    `- exact-safe pair proposition: ${materialized.pairLanes.length > 0 ? "trump_acquire_greenland_by_2026_12_31" : "none"}`,
    `- exact-safe tri lane: ${triSummary}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- tri matcher ready: ${materialized.finalDecision.triMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness follow-up justified: ${materialized.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    "- what is excluded: MYRIAD for this exact topic only",
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-2026-12-31-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-2026-12-31-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-2026-12-31-tri-lanes.json`, triLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-2026-12-31-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-2026-12-31-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-acquire-greenland-2026-12-31-operator-summary.md`, `${operatorSummary}\n`);

  return {
    familyPass,
    inputSummary,
    pairLanes,
    triLanes,
    rejections,
    finalDecision,
    operatorSummary
  };
};
