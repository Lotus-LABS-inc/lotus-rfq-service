import type { Pool } from "pg";

import { buildRepublicanTriMatcherMaterialization } from "../matching/politics/politics-nominee-2028-republican-tri-matcher.js";
import type { PoliticsNomineeTriEvalTopicSummary } from "../matching/politics/politics-types.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  runPoliticsNominee2028TriEvalPass,
  type PoliticsNominee2028TriEvalRunResult
} from "./politics-nominee-2028-tri-eval.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-republican-tri-matcher";

export interface PoliticsNominee2028RepublicanTriMatcherRunResult {
  triEval: PoliticsNominee2028TriEvalRunResult;
  inputSummary: Record<string, unknown>;
  lanes: Record<string, unknown>;
  rejections: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsNominee2028RepublicanTriMatcherPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028RepublicanTriMatcherRunResult> => {
  const triEval = await runPoliticsNominee2028TriEvalPass(input);
  const republican = (triEval.finalDecision as { republican: PoliticsNomineeTriEvalTopicSummary }).republican;
  const materialized = buildRepublicanTriMatcherMaterialization({
    triSummary: republican
  });

  const inputSummary = {
    observedAt: new Date().toISOString(),
    topic: materialized.topicKey,
    venues: materialized.venueSet.split("|"),
    candidates: materialized.approvedCandidates,
    sourceArtifacts: {
      sharedCore: "artifacts/politics/nominee-2028-shared-core/politics-nominee-2028-republican-outcome-core.json",
      triEval: "artifacts/politics/nominee-2028-tri-eval/politics-nominee-2028-republican-tri-lanes.json",
      pairMatcher: "artifacts/politics/nominee-2028-republican-pair-matcher/politics-nominee-2028-republican-pair-matcher-final-decision.json"
    },
    admittedRowSummary: {
      triSafeCandidateCount: republican.triSafeCandidateCount,
      pairSafeCandidateCount: republican.pairSafeCandidateCount,
      triDecision: republican.triLane.triDecision,
      triRuleDecision: republican.triLane.ruleDecision
    }
  };

  const lanes = {
    topic: materialized.topicKey,
    canonicalTriVenueSet: materialized.venueSet,
    matcherLanes: materialized.matcherLanes
  };

  const rejections = {
    observedAt: new Date().toISOString(),
    topic: materialized.topicKey,
    rejections: materialized.rejections
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    topic: materialized.topicKey,
    canonicalTriVenueSet: materialized.venueSet,
    ...materialized.finalDecision
  };

  const operatorSummary = [
    "# Republican Nominee 2028 Tri Matcher",
    "",
    `- topic: ${materialized.topicKey}`,
    `- exact tri venue set: ${materialized.venueSet}`,
    `- exact approved candidates: ${materialized.finalDecision.approvedCandidates.join(", ") || "none"}`,
    `- rule compatibility status: ${republican.triLane.ruleDecision}`,
    `- exact tri lane ready: ${materialized.finalDecision.exactTriLaneReady ? "yes" : "no"}`,
    `- operator review justified: ${materialized.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- pair fallback still preferred outside subset: ${materialized.finalDecision.pairFallbackStillPreferredOutsideSubset ? "yes" : "no"}`,
    `- out of scope: Democratic, Others, venue-only tails, unknown/composite outcomes, and Republican pair-only names outside jd_vance, marco_rubio, ron_desantis`,
    `- next action: ${materialized.finalDecision.singleBestNextAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-matcher-input-summary.json`, inputSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-matcher-lanes.json`, lanes);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-matcher-rejections.json`, rejections);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-matcher-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-matcher-operator-summary.md`, `${operatorSummary}\n`);

  return {
    triEval,
    inputSummary,
    lanes,
    rejections,
    finalDecision,
    operatorSummary
  };
};
