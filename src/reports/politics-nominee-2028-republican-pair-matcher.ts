import type { Pool } from "pg";

import { buildRepublicanPairMatcherMaterialization } from "../matching/politics/politics-nominee-2028-republican-pair-matcher.js";
import { buildNominee2028TriEvalTopicSummary } from "../matching/politics/politics-nominee-2028-tri-eval.js";
import type {
  PoliticsNomineeSharedCoreTopicDecisionSummary,
  PoliticsNomineeSharedCoreTopicOutcomeSummary
} from "../matching/politics/politics-nominee-2028-shared-core.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  runPoliticsNominee2028PairMatcherEvalPass,
  type PoliticsNominee2028PairMatcherEvalRunResult
} from "./politics-nominee-2028-pair-matcher-eval.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-republican-pair-matcher";

export interface PoliticsNominee2028RepublicanPairMatcherRunResult {
  pairEval: PoliticsNominee2028PairMatcherEvalRunResult;
  inputSummary: Record<string, unknown>;
  lanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsNominee2028RepublicanPairMatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028RepublicanPairMatcherRunResult> => {
  const pairEval = await runPoliticsNominee2028PairMatcherEvalPass(input);
  const republicanOutcomeCore = pairEval.sharedCore.republicanOutcomeCore as PoliticsNomineeSharedCoreTopicOutcomeSummary;
  const republicanSharedDecision = (
    pairEval.sharedCore.finalDecision as { republican: PoliticsNomineeSharedCoreTopicDecisionSummary }
  ).republican;
  const republicanTriSummary = buildNominee2028TriEvalTopicSummary({
    topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
    topicDecision: republicanSharedDecision,
    outcomeCore: republicanOutcomeCore,
    pairSummary: pairEval.republicanPairEval
  });

  const materialized = buildRepublicanPairMatcherMaterialization({
    pairSummary: pairEval.republicanPairEval,
    outcomeCore: republicanOutcomeCore,
    triSummary: republicanTriSummary
  });

  const inputSummary = {
    observedAt: new Date().toISOString(),
    topicKey: materialized.topicKey,
    sourceReports: {
      sharedCore: "artifacts/politics/nominee-2028-shared-core",
      pairEval: "artifacts/politics/nominee-2028-pair-matcher-eval",
      triEval: "artifacts/politics/nominee-2028-tri-eval"
    },
    refreshedRowsUsed: pairEval.sharedCore.fetchSummary,
    admittedVenues: materialized.admittedVenues,
    admittedCandidates: materialized.admittedCandidates
  };

  const lanes = {
    topicKey: materialized.topicKey,
    bestPair: materialized.finalDecision.bestPair,
    matcherLanes: materialized.matcherLanes
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
    "# Republican Nominee 2028 Pair Matcher",
    "",
    `- topic: ${materialized.topicKey}`,
    `- best pair lane: ${materialized.finalDecision.bestPair ?? "none"}`,
    `- exact-safe candidates: ${materialized.finalDecision.bestStartingCandidates.join(", ") || "none"}`,
    `- admitted venues: ${materialized.admittedVenues.join(", ") || "none"}`,
    `- pair fallback still preferred: ${materialized.finalDecision.pairFallbackStillPreferred ? "yes" : "no"}`,
    `- pair matcher ready: ${materialized.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- operator credible: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- what is excluded: Others, non-shared tails, unknown/composite outcomes, and tri-only Republican names without exact-safe pair authorization`,
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-matcher-lanes.json`, lanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-matcher-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-matcher-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-matcher-operator-summary.md`, `${operatorSummary}\n`);

  return {
    pairEval,
    inputSummary,
    lanes,
    rejections,
    finalDecision,
    operatorSummary
  };
};
