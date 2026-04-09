import type { Pool } from "pg";

import {
  buildNominee2028PairMatcherFinalDecision,
  buildNominee2028PairMatcherTopicSummary,
  type PoliticsNomineePairMatcherFinalDecision,
  type PoliticsNomineePairMatcherTopicSummary
} from "../matching/politics/politics-nominee-2028-pair-matcher-eval.js";
import type {
  PoliticsNomineeSharedCoreTopicDecisionSummary,
  PoliticsNomineeSharedCoreTopicOutcomeSummary
} from "../matching/politics/politics-nominee-2028-shared-core.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  runPoliticsNominee2028SharedCorePass,
  type PoliticsNominee2028SharedCoreRunResult
} from "./politics-nominee-2028-shared-core.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-pair-matcher-eval";

const routeableCandidatesByLane = (lanes: readonly { venuePair: string; sharedNamedCandidateCount: number }[]): Record<string, number> =>
  Object.fromEntries(lanes.map((lane) => [lane.venuePair, lane.sharedNamedCandidateCount]));

export interface PoliticsNominee2028PairMatcherEvalRunResult {
  sharedCore: PoliticsNominee2028SharedCoreRunResult;
  fetchSummary: Record<string, unknown>;
  republicanPairEval: PoliticsNomineePairMatcherTopicSummary;
  democraticPairEval: PoliticsNomineePairMatcherTopicSummary;
  routeabilitySummary: Record<string, unknown>;
  finalDecision: PoliticsNomineePairMatcherFinalDecision & Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsNominee2028PairMatcherEvalPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028PairMatcherEvalRunResult> => {
  const sharedCore = await runPoliticsNominee2028SharedCorePass(input);

  const republicanOutcomeCore = sharedCore.republicanOutcomeCore as PoliticsNomineeSharedCoreTopicOutcomeSummary;
  const democraticOutcomeCore = sharedCore.democraticOutcomeCore as PoliticsNomineeSharedCoreTopicOutcomeSummary;
  const republicanDecision = (sharedCore.finalDecision as { republican: PoliticsNomineeSharedCoreTopicDecisionSummary }).republican;
  const democraticDecision = (sharedCore.finalDecision as { democratic: PoliticsNomineeSharedCoreTopicDecisionSummary }).democratic;

  const republicanPairEval = buildNominee2028PairMatcherTopicSummary({
    topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
    outcomeCore: republicanOutcomeCore,
    topicDecision: republicanDecision
  });
  const democraticPairEval = buildNominee2028PairMatcherTopicSummary({
    topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
    outcomeCore: democraticOutcomeCore,
    topicDecision: democraticDecision
  });
  const overallDecision = buildNominee2028PairMatcherFinalDecision({
    republican: republicanPairEval,
    democratic: democraticPairEval
  });

  const fetchSummary = {
    observedAt: new Date().toISOString(),
    pairFirstOnly: true,
    triConsidered: false,
    ...sharedCore.fetchSummary
  };

  const routeabilitySummary = {
    observedAt: new Date().toISOString(),
    pairFirstOnly: true,
    triConsidered: false,
    republican: {
      topicDecisionFromSharedCore: republicanPairEval.sharedCoreTopicDecision,
      routeablePairLaneCount: republicanPairEval.routeablePairLaneCount,
      routeableCandidatesByPair: routeableCandidatesByLane(republicanPairEval.pairLanes)
    },
    democratic: {
      topicDecisionFromSharedCore: democraticPairEval.sharedCoreTopicDecision,
      routeablePairLaneCount: democraticPairEval.routeablePairLaneCount,
      routeableCandidatesByPair: routeableCandidatesByLane(democraticPairEval.pairLanes)
    }
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    pairFirstOnly: true,
    triConsidered: false,
    republican: {
      topicKey: republicanPairEval.topicKey,
      matcherEvalJustified: republicanPairEval.matcherEvalJustified,
      bestPairLane: republicanPairEval.bestPairLane
    },
    democratic: {
      topicKey: democraticPairEval.topicKey,
      matcherEvalJustified: democraticPairEval.matcherEvalJustified,
      bestPairLane: democraticPairEval.bestPairLane
    },
    ...overallDecision
  };

  const operatorSummary = [
    "# Politics Nominee 2028 Pair Matcher Eval",
    "",
    `- pair-first only: yes`,
    `- tri considered: no`,
    `- republican best pair: ${republicanPairEval.bestPairLane ? `${republicanPairEval.bestPairLane.venuePair} (${republicanPairEval.bestPairLane.sharedNamedCandidateCount} shared named candidates)` : "none"}`,
    `- democratic best pair: ${democraticPairEval.bestPairLane ? `${democraticPairEval.bestPairLane.venuePair} (${democraticPairEval.bestPairLane.sharedNamedCandidateCount} shared named candidates)` : "none"}`,
    `- matcher eval justified: ${overallDecision.matcherEvalJustified ? "yes" : "no"}`,
    `- recommended starting pair: ${overallDecision.recommendedStartingPair ?? "none"}`,
    `- next best action: ${overallDecision.nextBestAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-pair-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-lanes.json`, republicanPairEval);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-pair-lanes.json`, democraticPairEval);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-pair-routeability-summary.json`, routeabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-pair-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-pair-operator-summary.md`, `${operatorSummary}\n`);

  return {
    sharedCore,
    fetchSummary,
    republicanPairEval,
    democraticPairEval,
    routeabilitySummary,
    finalDecision,
    operatorSummary
  };
};
