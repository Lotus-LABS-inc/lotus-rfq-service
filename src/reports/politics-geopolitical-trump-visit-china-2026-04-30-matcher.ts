import type { Pool } from "pg";

import { buildPoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization } from "../matching/politics/politics-geopolitical-trump-visit-china-2026-04-30-matcher.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import { runPoliticsGeopoliticalTrumpVisitChinaFamilyPass, type PoliticsGeopoliticalTrumpVisitChinaFamilyPassRunResult } from "./politics-geopolitical-trump-visit-china-family-pass.js";

const ARTIFACT_DIR = "artifacts/politics/geopolitical-trump-visit-china-2026-04-30-matcher";
const TOPIC_KEY = "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30" as const;

export interface PoliticsGeopoliticalTrumpVisitChina20260430MatcherRunResult {
  familyPass: PoliticsGeopoliticalTrumpVisitChinaFamilyPassRunResult;
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  triLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsGeopoliticalTrumpVisitChina20260430MatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsGeopoliticalTrumpVisitChina20260430MatcherRunResult> => {
  const familyPass = await runPoliticsGeopoliticalTrumpVisitChinaFamilyPass(input);

  const materialized = buildPoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization({
    comparabilitySummary: familyPass.comparabilitySummary as Parameters<typeof buildPoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization>[0]["comparabilitySummary"]
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
      fetchSummary: "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-fetch-summary.json",
      admissionSummary: "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-admission-summary.json",
      normalizedTopics: "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-normalized-topics.json",
      comparabilitySummary: "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-comparability-summary.json",
      basisFragmentationSummary: "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-basis-fragmentation-summary.json",
      finalDecision: "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-final-decision.json"
    },
    admittedVenues: materialized.admittedVenues,
    admittedProposition: "trump_visit_china_by_2026_04_30",
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
    venueSet: "OPINION|POLYMARKET|PREDICT",
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
        ? ["Strict tri lane survived the currently admitted OPINION|POLYMARKET|PREDICT intersection."]
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
  const triSummary = materialized.triLanes.length > 0 ? "OPINION|POLYMARKET|PREDICT" : "none";
  const operatorSummary = [
    "# Trump Visit China April 30 2026 Matcher",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- surviving pair lanes: ${pairLaneSummary}`,
    `- exact-safe pair proposition: ${materialized.pairLanes.length > 0 ? "trump_visit_china_by_2026_04_30" : "none"}`,
    `- exact-safe tri lane: ${triSummary}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- tri matcher ready: ${materialized.finalDecision.triMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness follow-up justified: ${materialized.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    "- what is excluded: all venues outside OPINION|POLYMARKET|PREDICT for this exact topic",
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-2026-04-30-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-2026-04-30-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-2026-04-30-tri-lanes.json`, triLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-2026-04-30-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-2026-04-30-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-geopolitical-trump-visit-china-2026-04-30-operator-summary.md`, `${operatorSummary}\n`);

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
