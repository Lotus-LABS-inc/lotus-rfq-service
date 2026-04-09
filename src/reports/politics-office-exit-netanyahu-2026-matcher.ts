import type { Pool } from "pg";

import { buildPoliticsOfficeExitNetanyahu2026MatcherMaterialization } from "../matching/politics/politics-office-exit-netanyahu-2026-matcher.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import { runPoliticsOfficeExitByDateFamilyPass, type PoliticsOfficeExitByDateFamilyPassRunResult } from "./politics-office-exit-by-date-family-pass.js";

const ARTIFACT_DIR = "artifacts/politics/office-exit-netanyahu-2026-matcher";
const TOPIC_KEY = "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31" as const;

export interface PoliticsOfficeExitNetanyahu2026MatcherRunResult {
  familyPass: PoliticsOfficeExitByDateFamilyPassRunResult;
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  triLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsOfficeExitNetanyahu2026MatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeExitNetanyahu2026MatcherRunResult> => {
  const familyPass = await runPoliticsOfficeExitByDateFamilyPass(input);

  const materialized = buildPoliticsOfficeExitNetanyahu2026MatcherMaterialization({
    normalizedTopics: familyPass.normalizedTopics as Parameters<typeof buildPoliticsOfficeExitNetanyahu2026MatcherMaterialization>[0]["normalizedTopics"],
    comparabilitySummary: familyPass.comparabilitySummary as Parameters<typeof buildPoliticsOfficeExitNetanyahu2026MatcherMaterialization>[0]["comparabilitySummary"]
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
        canonicalRuleMeaning: row["canonicalRuleMeaning"]
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
    admittedProposition: "netanyahu_out_before_2027",
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
    venueSet: "LIMITLESS|POLYMARKET|PREDICT",
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
        ? ["Strict tri lane survived the currently admitted LIMITLESS|POLYMARKET|PREDICT intersection."]
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
  const triSummary = materialized.triLanes.length > 0 ? "LIMITLESS|POLYMARKET|PREDICT" : "none";
  const operatorSummary = [
    "# Netanyahu Office Exit 2026 Matcher",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- surviving pair lanes: ${pairLaneSummary}`,
    `- exact-safe pair proposition: ${materialized.pairLanes.length > 0 ? "netanyahu_out_before_2027" : "none"}`,
    `- exact-safe tri lane: ${triSummary}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- tri matcher ready: ${materialized.finalDecision.triMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness follow-up justified: ${materialized.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    "- what is excluded: all venues outside LIMITLESS|POLYMARKET|PREDICT for this exact topic",
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-netanyahu-2026-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-netanyahu-2026-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-netanyahu-2026-tri-lanes.json`, triLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-netanyahu-2026-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-netanyahu-2026-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-netanyahu-2026-operator-summary.md`, `${operatorSummary}\n`);

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
