import type { Pool } from "pg";

import { buildDemocraticPairMatcherMaterialization } from "../matching/politics/politics-nominee-2028-democratic-pair-matcher.js";
import type { PoliticsNomineeSharedCoreTopicOutcomeSummary } from "../matching/politics/politics-nominee-2028-shared-core.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  runPoliticsNominee2028PairMatcherEvalPass,
  type PoliticsNominee2028PairMatcherEvalRunResult
} from "./politics-nominee-2028-pair-matcher-eval.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-democratic-pair-matcher";

export interface PoliticsNominee2028DemocraticPairMatcherRunResult {
  pairEval: PoliticsNominee2028PairMatcherEvalRunResult;
  inputSummary: Record<string, unknown>;
  lanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsNominee2028DemocraticPairMatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028DemocraticPairMatcherRunResult> => {
  const pairEval = await runPoliticsNominee2028PairMatcherEvalPass(input);
  const democraticOutcomeCore = pairEval.sharedCore.democraticOutcomeCore as PoliticsNomineeSharedCoreTopicOutcomeSummary;

  const materialized = buildDemocraticPairMatcherMaterialization({
    pairSummary: pairEval.democraticPairEval,
    outcomeCore: democraticOutcomeCore,
    triSummary: null
  });

  const inputSummary = {
    observedAt: new Date().toISOString(),
    topicKey: materialized.topicKey,
    sourceReports: {
      sharedCore: "artifacts/politics/nominee-2028-shared-core",
      pairEval: "artifacts/politics/nominee-2028-pair-matcher-eval"
    },
    refreshedRowsUsed: pairEval.sharedCore.fetchSummary,
    admittedVenues: materialized.admittedVenues,
    admittedCandidates: materialized.admittedCandidates,
    exclusionsBeforeMatcherConstruction: democraticOutcomeCore.excludedOutcomes.map((outcome) => ({
      candidateIdentityKey: outcome.candidateIdentityKey,
      normalizedCandidateName: outcome.normalizedCandidateName,
      rawOutcomeLabel: outcome.rawOutcomeLabel,
      routeabilityClass: outcome.routeabilityClass,
      sharedAcrossWhichVenues: outcome.sharedAcrossWhichVenues
    }))
  };

  const lanes = {
    topicKey: materialized.topicKey,
    bestPair: materialized.finalDecision.bestPair,
    matcherLanes: materialized.matcherLanes.map((lane) => ({
      venuePair: lane.venuePair,
      candidate: lane.candidateIdentityKey,
      canonicalTopic: lane.topicKey,
      routeabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      evidence: lane.evidence,
      evidenceNotes: lane.notes
    }))
  };

  const rejections = {
    observedAt: new Date().toISOString(),
    topicKey: materialized.topicKey,
    rejections: materialized.rejections
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    topicKey: materialized.topicKey,
    ...materialized.finalDecision
  };

  const operatorSummary = [
    "# Democratic Nominee 2028 Pair Matcher",
    "",
    `- topic: ${materialized.topicKey}`,
    `- best pair lane: ${materialized.finalDecision.bestPair ?? "none"}`,
    `- exact-safe candidates: ${materialized.finalDecision.bestStartingCandidates.join(", ") || "none"}`,
    `- admitted venues: ${materialized.admittedVenues.join(", ") || "none"}`,
    `- rule compatibility: ${pairEval.democraticPairEval.bestPairLane?.ruleDecision ?? "UNKNOWN_RULE_MEANING"}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- operator credible: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- limited-prod readiness review justified: ${materialized.finalDecision.pairMatcherReady && materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- what is excluded: Others, non-shared tails, unknown/composite outcomes, and any non-matcher-justified Democratic pair lane`,
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-pair-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-pair-matcher-lanes.json`, lanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-pair-matcher-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-pair-matcher-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-pair-matcher-operator-summary.md`, `${operatorSummary}\n`);

  return {
    pairEval,
    inputSummary,
    lanes,
    rejections,
    finalDecision,
    operatorSummary
  };
};
