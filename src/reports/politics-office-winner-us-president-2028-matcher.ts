import type { Pool } from "pg";

import { buildPoliticsOfficeWinnerUsPresident2028MatcherMaterialization } from "../matching/politics/politics-office-winner-us-president-2028-matcher.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import { runPoliticsOfficeWinnerFamilyPass, type PoliticsOfficeWinnerFamilyPassRunResult } from "./politics-office-winner-family-pass.js";

const ARTIFACT_DIR = "artifacts/politics/office-winner-us-president-2028-matcher";
const TOPIC_KEY = "OFFICE_WINNER|USA|US_PRESIDENT|2028" as const;

export interface PoliticsOfficeWinnerUsPresident2028MatcherRunResult {
  familyPass: PoliticsOfficeWinnerFamilyPassRunResult;
  inputSummary: Record<string, unknown>;
  lanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsOfficeWinnerUsPresident2028MatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeWinnerUsPresident2028MatcherRunResult> => {
  const familyPass = await runPoliticsOfficeWinnerFamilyPass(input);

  const materialized = buildPoliticsOfficeWinnerUsPresident2028MatcherMaterialization({
    normalizedTopics: familyPass.normalizedTopics as Parameters<typeof buildPoliticsOfficeWinnerUsPresident2028MatcherMaterialization>[0]["normalizedTopics"],
    comparabilitySummary: familyPass.comparabilitySummary as Parameters<typeof buildPoliticsOfficeWinnerUsPresident2028MatcherMaterialization>[0]["comparabilitySummary"]
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
    exclusionsBeforeFinalMatcherConstruction: materialized.rejections
  };

  const lanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    bestPair: materialized.finalDecision.bestPair,
    matcherLanes: materialized.matcherLanes.map((lane) => ({
      venuePair: lane.venuePair,
      candidate: lane.candidateIdentityKey,
      canonicalTopic: lane.canonicalTopicKey,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      evidenceNotes: lane.notes,
      evidence: lane.evidence
    }))
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

  const operatorSummary = [
    "# Office Winner USA President 2028 Matcher",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- best pair lane: ${materialized.finalDecision.bestPair ?? "none"}`,
    `- exact-safe candidates: ${materialized.finalDecision.bestStartingCandidates.join(", ") || "none"}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness follow-up justified: ${materialized.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- what is excluded: Others, venue-only tails, unknown/composite outcomes, and all venues outside LIMITLESS|POLYMARKET for this exact topic`,
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-us-president-2028-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-us-president-2028-matcher-lanes.json`, lanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-us-president-2028-matcher-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-us-president-2028-matcher-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-us-president-2028-operator-summary.md`, `${operatorSummary}\n`);

  return {
    familyPass,
    inputSummary,
    lanes,
    rejections,
    finalDecision,
    operatorSummary
  };
};
