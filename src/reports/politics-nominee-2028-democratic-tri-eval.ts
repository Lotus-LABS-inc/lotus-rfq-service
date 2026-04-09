import type { Pool } from "pg";

import type {
  PoliticsNomineeDemocraticPairMatcherFinalDecision,
  PoliticsNomineeTriEvalTopicSummary
} from "../matching/politics/politics-types.js";
import type { PoliticsNomineeSharedCoreTopicOutcomeSummary } from "../matching/politics/politics-nominee-2028-shared-core.js";
import { buildDemocraticTriMatcherMaterialization } from "../matching/politics/politics-nominee-2028-democratic-tri-matcher.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import { runPoliticsNominee2028DemocraticPairMatcherPass } from "./politics-nominee-2028-democratic-pair-matcher.js";
import {
  runPoliticsNominee2028TriEvalPass,
  type PoliticsNominee2028TriEvalRunResult
} from "./politics-nominee-2028-tri-eval.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-democratic-tri-eval";

export interface PoliticsNominee2028DemocraticTriEvalRunResult {
  triEval: PoliticsNominee2028TriEvalRunResult;
  democraticPairMatcher: Awaited<ReturnType<typeof runPoliticsNominee2028DemocraticPairMatcherPass>>;
  inputSummary: Record<string, unknown>;
  triLanes: Record<string, unknown>;
  triRejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsNominee2028DemocraticTriEvalPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028DemocraticTriEvalRunResult> => {
  const triEval = await runPoliticsNominee2028TriEvalPass(input);
  const democraticPairMatcher = await runPoliticsNominee2028DemocraticPairMatcherPass(input);

  const democraticTriSummary = (triEval.finalDecision as { democratic: PoliticsNomineeTriEvalTopicSummary }).democratic;
  const democraticOutcomeCore = triEval.pairEval.sharedCore.democraticOutcomeCore as PoliticsNomineeSharedCoreTopicOutcomeSummary;
  const pairMatcherFinalDecision =
    democraticPairMatcher.finalDecision as unknown as PoliticsNomineeDemocraticPairMatcherFinalDecision;
  const materialized = buildDemocraticTriMatcherMaterialization({
    triSummary: democraticTriSummary,
    pairMatcherFinalDecision
  });

  const inputSummary = {
    observedAt: new Date().toISOString(),
    topicKey: materialized.topicKey,
    refreshedRowsUsed: triEval.pairEval.sharedCore.fetchSummary,
    sourceArtifacts: {
      sharedCore: "artifacts/politics/nominee-2028-shared-core/politics-nominee-2028-democratic-outcome-core.json",
      triEval: "artifacts/politics/nominee-2028-tri-eval/politics-nominee-2028-democratic-tri-lanes.json",
      pairMatcher: "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-final-decision.json"
    },
    admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET"],
    admittedCandidateUniverse: materialized.admittedCandidateUniverse,
    exclusionsBeforeFinalTriDecision: {
      excludedOutcomes: democraticOutcomeCore.excludedOutcomes.map((outcome: PoliticsNomineeSharedCoreTopicOutcomeSummary["excludedOutcomes"][number]) => ({
        candidateIdentityKey: outcome.candidateIdentityKey,
        normalizedCandidateName: outcome.normalizedCandidateName,
        rawOutcomeLabel: outcome.rawOutcomeLabel,
        routeabilityClass: outcome.routeabilityClass,
        sharedAcrossWhichVenues: outcome.sharedAcrossWhichVenues
      })),
      pairSharedNamedOutcomes: democraticOutcomeCore.pairSharedNamedOutcomes.map((outcome: PoliticsNomineeSharedCoreTopicOutcomeSummary["pairSharedNamedOutcomes"][number]) => ({
        candidateIdentityKey: outcome.candidateIdentityKey,
        normalizedCandidateName: outcome.normalizedCandidateName,
        rawOutcomeLabel: outcome.rawOutcomeLabel,
        sharedAcrossWhichVenues: outcome.sharedAcrossWhichVenues,
        routeabilityClass: outcome.routeabilityClass
      }))
    }
  };

  const triLanes = {
    topicKey: materialized.topicKey,
    venueSet: materialized.venueSet,
    matcherLanes: materialized.matcherLanes.map((lane) => ({
      canonicalTopic: lane.topicKey,
      venueSet: lane.canonicalTriVenueSet,
      candidate: lane.candidateIdentityKey,
      triRouteabilityDecision: lane.routeabilityDecision,
      rulesDecision: lane.rulesDecision,
      evidence: lane.evidence,
      evidenceNotes: lane.notes
    })),
    bestPairFallback: materialized.finalDecision.bestPairFallback
  };

  const triRejections = {
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
    "# Democratic Nominee 2028 Tri Eval",
    "",
    `- topic: ${materialized.topicKey}`,
    `- tri survived: ${materialized.finalDecision.triReady ? "yes" : "no"}`,
    `- exact tri-safe candidates: ${materialized.matcherLanes.map((lane) => lane.candidateIdentityKey).join(", ") || "none"}`,
    `- best pair fallback: ${materialized.finalDecision.bestPairFallback?.venuePair ?? "none"}${materialized.finalDecision.bestPairFallback ? ` (${materialized.finalDecision.bestPairFallback.candidates.join(", ")})` : ""}`,
    `- rule compatibility state: ${materialized.finalDecision.ruleStatus}`,
    `- exclusions and why: ${materialized.rejections.map((rejection) => `${rejection.candidateIdentityKey ?? "unknown"}=${rejection.rejectionReason}`).join("; ") || "none"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- limited-prod tri review justified: ${materialized.finalDecision.readinessReviewJustified ? "yes" : "no"}`,
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-tri-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-tri-lanes.json`, triLanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-tri-rejections.json`, triRejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-tri-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-tri-operator-summary.md`, `${operatorSummary}\n`);

  return {
    triEval,
    democraticPairMatcher,
    inputSummary,
    triLanes,
    triRejections,
    finalDecision,
    operatorSummary
  };
};
