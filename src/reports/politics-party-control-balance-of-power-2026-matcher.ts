import type { Pool } from "pg";

import { buildPoliticsPartyControlBalanceOfPower2026MatcherMaterialization } from "../matching/politics/politics-party-control-balance-of-power-2026-matcher.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import { runPoliticsPartyControlFamilyPass, type PoliticsPartyControlFamilyPassRunResult } from "./politics-party-control-family-pass.js";

const ARTIFACT_DIR = "artifacts/politics/party-control-balance-of-power-2026-matcher";
const TOPIC_KEY = "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER" as const;

export interface PoliticsPartyControlBalanceOfPower2026MatcherRunResult {
  familyPass: PoliticsPartyControlFamilyPassRunResult;
  inputSummary: Record<string, unknown>;
  pairLanes: Record<string, unknown>;
  triLanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsPartyControlBalanceOfPower2026MatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsPartyControlBalanceOfPower2026MatcherRunResult> => {
  const familyPass = await runPoliticsPartyControlFamilyPass(input);

  const materialized = buildPoliticsPartyControlBalanceOfPower2026MatcherMaterialization({
    normalizedTopics: familyPass.normalizedTopics as Parameters<typeof buildPoliticsPartyControlBalanceOfPower2026MatcherMaterialization>[0]["normalizedTopics"],
    comparabilitySummary: familyPass.comparabilitySummary as Parameters<typeof buildPoliticsPartyControlBalanceOfPower2026MatcherMaterialization>[0]["comparabilitySummary"]
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
        normalizedOutcomes: row["normalizedOutcomes"]
      })),
    familyComparabilitySourceArtifacts: {
      fetchSummary: "artifacts/politics/party-control-family-pass/politics-party-control-fetch-summary.json",
      admissionSummary: "artifacts/politics/party-control-family-pass/politics-party-control-admission-summary.json",
      normalizedTopics: "artifacts/politics/party-control-family-pass/politics-party-control-normalized-topics.json",
      comparabilitySummary: "artifacts/politics/party-control-family-pass/politics-party-control-comparability-summary.json",
      basisFragmentationSummary: "artifacts/politics/party-control-family-pass/politics-party-control-basis-fragmentation-summary.json",
      finalDecision: "artifacts/politics/party-control-family-pass/politics-party-control-final-decision.json"
    },
    admittedVenues: materialized.admittedVenues,
    admittedOutcomes: materialized.admittedOutcomes,
    exclusionsBeforeFinalLaneConstruction: materialized.rejections
  };

  const pairLanes = {
    observedAt: new Date().toISOString(),
    canonicalTopicKey: TOPIC_KEY,
    matcherLanes: materialized.pairLanes.map((lane) => ({
      venuePair: lane.venuePair,
      outcome: lane.outcomeIdentityKey,
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
      outcome: lane.outcomeIdentityKey,
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
  const pairOutcomeSummary = materialized.pairLanes.length > 0
    ? materialized.pairLanes.map((lane) => `${lane.venuePair}:${lane.outcomeIdentityKey}`).join(", ")
    : "none";
  const triOutcomeSummary = materialized.triLanes.map((lane) => lane.outcomeIdentityKey).join(", ") || "none";

  const operatorSummary = [
    "# Party Control Balance Of Power 2026 Matcher",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- surviving pair lanes: ${pairLaneSummary}`,
    `- exact-safe pair outcomes: ${pairOutcomeSummary}`,
    `- exact-safe tri outcomes: ${triOutcomeSummary}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- tri matcher ready: ${materialized.finalDecision.triMatcherReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness follow-up justified: ${materialized.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    "- what is excluded: Other, venue-only tails, unknown/composite outcomes, and all venues outside OPINION|POLYMARKET|PREDICT for this exact topic",
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-balance-of-power-2026-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-balance-of-power-2026-pair-lanes.json`, pairLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-balance-of-power-2026-tri-lanes.json`, triLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-balance-of-power-2026-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-balance-of-power-2026-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-balance-of-power-2026-operator-summary.md`, `${operatorSummary}\n`);

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
