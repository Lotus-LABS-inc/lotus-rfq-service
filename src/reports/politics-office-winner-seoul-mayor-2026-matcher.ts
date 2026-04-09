import type { Pool } from "pg";

import { buildPoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization } from "../matching/politics/politics-office-winner-seoul-mayor-2026-matcher.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import { runPoliticsOfficeWinnerFamilyPass, type PoliticsOfficeWinnerFamilyPassRunResult } from "./politics-office-winner-family-pass.js";

const ARTIFACT_DIR = "artifacts/politics/office-winner-seoul-mayor-2026-matcher";
const TOPIC_KEY = "OFFICE_WINNER|SEOUL|MAYOR|2026" as const;

export interface PoliticsOfficeWinnerSeoulMayor2026MatcherRunResult {
  familyPass: PoliticsOfficeWinnerFamilyPassRunResult;
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  triLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsOfficeWinnerSeoulMayor2026MatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeWinnerSeoulMayor2026MatcherRunResult> => {
  const familyPass = await runPoliticsOfficeWinnerFamilyPass(input);

  const materialized = buildPoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization({
    normalizedTopics: familyPass.normalizedTopics as Parameters<typeof buildPoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization>[0]["normalizedTopics"],
    comparabilitySummary: familyPass.comparabilitySummary as Parameters<typeof buildPoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization>[0]["comparabilitySummary"]
  });

  const inputSummary = {
    observedAt: new Date().toISOString(),
    exactTopic: TOPIC_KEY,
    refreshedRowsUsed: (familyPass.normalizedTopics as Array<Record<string, unknown>>)
      .filter((row) => row["canonicalTopicKey"] === TOPIC_KEY)
      .map((row) => ({
        venue: row["venue"],
        venueMarketId: row["venueMarketId"],
        title: row["title"],
        candidateSet: row["candidateSet"]
      })),
    familyComparabilitySourceArtifacts: {
      fetchSummary: "artifacts/politics/office-winner-family-pass/politics-office-winner-fetch-summary.json",
      admissionSummary: "artifacts/politics/office-winner-family-pass/politics-office-winner-admission-summary.json",
      normalizedTopics: "artifacts/politics/office-winner-family-pass/politics-office-winner-normalized-topics.json",
      comparabilitySummary: "artifacts/politics/office-winner-family-pass/politics-office-winner-comparability-summary.json",
      basisFragmentationSummary: "artifacts/politics/office-winner-family-pass/politics-office-winner-basis-fragmentation-summary.json",
      finalDecision: "artifacts/politics/office-winner-family-pass/politics-office-winner-final-decision.json"
    },
    admittedVenues: materialized.admittedVenues,
    admittedCandidates: materialized.admittedCandidates,
    exclusionsBeforeFinalLaneConstruction: materialized.rejections
  };

  const pairLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    matcherLanes: materialized.pairLanes.map((lane) => ({
      venuePair: lane.venuePair,
      candidate: lane.candidateIdentityKey,
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
      candidate: lane.candidateIdentityKey,
      canonicalTopic: lane.canonicalTopicKey,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      evidenceNotes: lane.notes,
      evidence: lane.evidence
    })),
    notes:
      materialized.triLanes.length > 0
        ? ["Strict Seoul tri lane survived the currently admitted 3-venue intersection."]
        : [`Strict Seoul tri lane is not currently justified from admitted venues ${materialized.admittedVenues.join("|") || "none"}.`]
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
  const pairCandidateSummary = materialized.pairLanes.length > 0
    ? materialized.pairLanes.map((lane) => `${lane.venuePair}:${lane.candidateIdentityKey}`).join(", ")
    : "none";
  const triCandidateSummary = materialized.triLanes.map((lane) => lane.candidateIdentityKey).join(", ") || "none";

  const operatorSummary = [
    "# Office Winner Seoul Mayor 2026 Matcher",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- surviving pair lanes: ${pairLaneSummary}`,
    `- exact-safe pair candidates: ${pairCandidateSummary}`,
    `- exact-safe tri candidates: ${triCandidateSummary}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- tri matcher ready: ${materialized.finalDecision.triMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness follow-up justified: ${materialized.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    "- what is excluded: Others, venue-only tails, unknown/composite outcomes, MYRIAD, and PREDICT for this exact topic",
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-seoul-mayor-2026-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-seoul-mayor-2026-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-seoul-mayor-2026-tri-lanes.json`, triLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-seoul-mayor-2026-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-seoul-mayor-2026-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-seoul-mayor-2026-operator-summary.md`, `${operatorSummary}\n`);

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
