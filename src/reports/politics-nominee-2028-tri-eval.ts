import type { Pool } from "pg";

import {
  buildNominee2028TriEvalFinalDecision,
  buildNominee2028TriEvalTopicSummary
} from "../matching/politics/politics-nominee-2028-tri-eval.js";
import type {
  PoliticsNomineeSharedCoreTopicDecisionSummary,
  PoliticsNomineeSharedCoreTopicOutcomeSummary
} from "../matching/politics/politics-nominee-2028-shared-core.js";
import type { PoliticsNomineePairMatcherTopicSummary } from "../matching/politics/politics-nominee-2028-pair-matcher-eval.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  runPoliticsNominee2028PairMatcherEvalPass,
  type PoliticsNominee2028PairMatcherEvalRunResult
} from "./politics-nominee-2028-pair-matcher-eval.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-tri-eval";

const countsByVenue = (rows: readonly { venue: string }[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.venue] = (accumulator[row.venue] ?? 0) + 1;
    return accumulator;
  }, {});

export interface PoliticsNominee2028TriEvalRunResult {
  pairEval: PoliticsNominee2028PairMatcherEvalRunResult;
  fetchSummary: Record<string, unknown>;
  republicanTriLanes: Record<string, unknown>;
  democraticTriLanes: Record<string, unknown>;
  rejectionBreakdown: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsNominee2028TriEvalPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028TriEvalRunResult> => {
  const pairEval = await runPoliticsNominee2028PairMatcherEvalPass(input);

  const sharedCore = pairEval.sharedCore;
  const republicanOutcomeCore = sharedCore.republicanOutcomeCore as PoliticsNomineeSharedCoreTopicOutcomeSummary;
  const democraticOutcomeCore = sharedCore.democraticOutcomeCore as PoliticsNomineeSharedCoreTopicOutcomeSummary;
  const republicanSharedDecision = (sharedCore.finalDecision as { republican: PoliticsNomineeSharedCoreTopicDecisionSummary }).republican;
  const democraticSharedDecision = (sharedCore.finalDecision as { democratic: PoliticsNomineeSharedCoreTopicDecisionSummary }).democratic;

  const republicanPairSummary = pairEval.republicanPairEval as PoliticsNomineePairMatcherTopicSummary;
  const democraticPairSummary = pairEval.democraticPairEval as PoliticsNomineePairMatcherTopicSummary;

  const republican = buildNominee2028TriEvalTopicSummary({
    topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
    topicDecision: republicanSharedDecision,
    outcomeCore: republicanOutcomeCore,
    pairSummary: republicanPairSummary
  });
  const democratic = buildNominee2028TriEvalTopicSummary({
    topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
    topicDecision: democraticSharedDecision,
    outcomeCore: democraticOutcomeCore,
    pairSummary: democraticPairSummary
  });
  const overall = buildNominee2028TriEvalFinalDecision({
    republican,
    democratic
  });

  const fetchSummary = {
    observedAt: new Date().toISOString(),
    sourceReports: {
      sharedCore: "artifacts/politics/nominee-2028-shared-core",
      pairEval: "artifacts/politics/nominee-2028-pair-matcher-eval"
    },
    republican: {
      topicKey: republican.topicKey,
      admittedRowsByVenue: countsByVenue([
        ...republicanOutcomeCore.triSharedNamedOutcomes,
        ...republicanOutcomeCore.pairSharedNamedOutcomes,
        ...republicanOutcomeCore.excludedOutcomes,
        ...republicanOutcomeCore.singleVenueOnlyOutcomes
      ])
    },
    democratic: {
      topicKey: democratic.topicKey,
      admittedRowsByVenue: countsByVenue([
        ...democraticOutcomeCore.triSharedNamedOutcomes,
        ...democraticOutcomeCore.pairSharedNamedOutcomes,
        ...democraticOutcomeCore.excludedOutcomes,
        ...democraticOutcomeCore.singleVenueOnlyOutcomes
      ])
    }
  };

  const republicanTriLanes = {
    topicKey: republican.topicKey,
    bestPairLane: republican.bestPairLane,
    triLane: republican.triLane,
    topicFinalDecision: republican.topicFinalDecision
  };
  const democraticTriLanes = {
    topicKey: democratic.topicKey,
    bestPairLane: democratic.bestPairLane,
    triLane: democratic.triLane,
    topicFinalDecision: democratic.topicFinalDecision
  };

  const rejectionBreakdown = {
    observedAt: new Date().toISOString(),
    republican: [
      ...republican.triLane.excludedCandidates,
      ...(republican.bestPairLane?.excludedCandidates ?? [])
    ],
    democratic: [
      ...democratic.triLane.excludedCandidates,
      ...(democratic.bestPairLane?.excludedCandidates ?? [])
    ]
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    republican,
    democratic,
    recommendedStartingLane: overall.recommendedStartingLane,
    overallTriDecision: overall.overallTriDecision,
    triOperatorCredible: overall.triOperatorCredible,
    pairStillPreferred: overall.pairStillPreferred,
    nextBestAction: overall.nextBestAction
  };

  const operatorSummary = [
    "# Politics Nominee 2028 Tri Eval",
    "",
    `- republican: ${republican.topicFinalDecision}`,
    `- republican tri safe candidates: ${republican.triLane.safeCandidates.map((candidate) => candidate.candidateIdentityKey).join(", ") || "none"}`,
    `- republican best pair: ${republican.bestPairLane ? `${republican.bestPairLane.venuePair} (${republican.bestPairLane.sharedNamedCandidateCount})` : "none"}`,
    `- democratic: ${democratic.topicFinalDecision}`,
    `- democratic tri safe candidates: ${democratic.triLane.safeCandidates.map((candidate) => candidate.candidateIdentityKey).join(", ") || "none"}`,
    `- democratic best pair: ${democratic.bestPairLane ? `${democratic.bestPairLane.venuePair} (${democratic.bestPairLane.sharedNamedCandidateCount})` : "none"}`,
    `- recommended starting lane: ${overall.recommendedStartingLane ? `${overall.recommendedStartingLane.topicKey} ${overall.recommendedStartingLane.laneType} ${overall.recommendedStartingLane.venueSet}` : "none"}`,
    `- pair still preferred: ${overall.pairStillPreferred ? "yes" : "no"}`,
    `- next best action: ${overall.nextBestAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-tri-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-lanes.json`, republicanTriLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-tri-lanes.json`, democraticTriLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-tri-rejection-breakdown.json`, rejectionBreakdown);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-tri-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-tri-operator-summary.md`, `${operatorSummary}\n`);

  return {
    pairEval,
    fetchSummary,
    republicanTriLanes,
    democraticTriLanes,
    rejectionBreakdown,
    finalDecision,
    operatorSummary
  };
};
