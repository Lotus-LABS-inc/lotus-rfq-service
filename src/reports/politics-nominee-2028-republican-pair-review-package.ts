import type { Pool } from "pg";

import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  runPoliticsNominee2028RepublicanPairMatcherPass,
  type PoliticsNominee2028RepublicanPairMatcherRunResult
} from "./politics-nominee-2028-republican-pair-matcher.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-republican-pair-matcher";

export interface PoliticsNominee2028RepublicanPairReviewPackageRunResult {
  pairMatcher: PoliticsNominee2028RepublicanPairMatcherRunResult;
  reviewPackage: Record<string, unknown>;
  reviewChecklist: string;
  reviewSummary: string;
}

export const runPoliticsNominee2028RepublicanPairReviewPackagePass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028RepublicanPairReviewPackageRunResult> => {
  const pairMatcher = await runPoliticsNominee2028RepublicanPairMatcherPass(input);
  const lanes = pairMatcher.lanes as {
    topicKey: string;
    bestPair: string | null;
    matcherLanes: {
      venuePair: string;
      candidateIdentityKey: string;
      normalizedCandidateName: string;
      routeabilityDecision: string;
      rulesDecision: string;
      evidence: {
        venue: string;
        venueMarketId: string;
        rawOutcomeLabel: string;
      }[];
    }[];
  };
  const finalDecision = pairMatcher.finalDecision as {
    overallDecision: string;
    bestPair: string | null;
    bestStartingCandidates: string[];
    pairMatcherReady: boolean;
    operatorCredible: boolean;
  };
  const bestPair = finalDecision.bestPair;
  const bestPairLanes = lanes.matcherLanes.filter((lane) => lane.venuePair === bestPair);

  const reviewPackage = {
    observedAt: new Date().toISOString(),
    reviewState: finalDecision.pairMatcherReady ? "READY_PENDING_OPERATOR_REVIEW" : "NOT_READY",
    topicKey: lanes.topicKey,
    approvedVenuePair: bestPair,
    approvedCandidates: finalDecision.bestStartingCandidates,
    exactSafeOnly: true,
    ruleCompatibilityState: bestPairLanes.map((lane) => lane.rulesDecision),
    routeabilityState: bestPairLanes.map((lane) => lane.routeabilityDecision),
    exclusionsLocked: [
      "OTHERS_EXCLUDED",
      "NOT_SHARED",
      "UNKNOWN_COMPOSITE",
      "RULE_MISMATCH",
      "PAIR_EDGE_MISSING"
    ],
    sourceArtifacts: {
      pairMatcher: `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-matcher-final-decision.json`,
      lanes: `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-matcher-lanes.json`,
      rejections: `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-matcher-rejections.json`
    },
    operatorChecks: [
      "Confirm the scope is exactly NOMINEE|US_PRESIDENT|2028|REPUBLICAN.",
      "Confirm the only approved venue pair is LIMITLESS|POLYMARKET.",
      "Confirm the approved candidate set is exactly the seven listed candidates.",
      "Confirm every approved lane remains PAIR_EXACT_AUTO_ROUTEABLE and EXACT_RULE_COMPATIBLE.",
      "Confirm Others and all non-shared tails remain excluded.",
      "Confirm no Democratic or broader politics topic is included."
    ],
    holdBoundaries: [
      "Do not activate OPINION lanes from this package.",
      "Do not promote tri routing from this package.",
      "Do not add venue-only names.",
      "Do not widen beyond the Republican 2028 nominee topic."
    ]
  };

  const reviewChecklist = [
    "# Republican Nominee 2028 Pair Limited-Prod Review Checklist",
    "",
    `- topic locked: ${lanes.topicKey}`,
    `- approved pair: ${bestPair ?? "none"}`,
    `- approved candidates: ${finalDecision.bestStartingCandidates.join(", ") || "none"}`,
    "",
    "## Required Checks",
    "",
    "- confirm the review package is read-only and does not authorize rollout",
    "- confirm every approved lane is `PAIR_EXACT_AUTO_ROUTEABLE`",
    "- confirm every approved lane is `EXACT_RULE_COMPATIBLE`",
    "- confirm no `Others` bucket is present in approved lanes",
    "- confirm non-shared and unknown/composite outcomes remain excluded",
    "- confirm no Democratic or tri lane is being promoted from this package",
    "",
    "## Evidence",
    "",
    ...bestPairLanes.flatMap((lane) => [
      `- ${lane.candidateIdentityKey}: ${lane.evidence.map((evidence) => `${evidence.venue}:${evidence.rawOutcomeLabel}`).join(" | ")}`
    ]),
    "",
    "## Hold Conditions",
    "",
    "- any rule compatibility drift away from exact-safe",
    "- any candidate mismatch between LIMITLESS and POLYMARKET",
    "- any attempt to add non-shared Republican names",
    "- any attempt to widen scope beyond this exact topic and pair",
    ""
  ].join("\n");

  const reviewSummary = [
    "# Republican Nominee 2028 Pair Limited-Prod Review",
    "",
    `- current decision: ${finalDecision.overallDecision}`,
    `- operator credible: ${finalDecision.operatorCredible ? "yes" : "no"}`,
    `- approved pair: ${bestPair ?? "none"}`,
    `- approved candidates: ${finalDecision.bestStartingCandidates.join(", ") || "none"}`,
    `- rule status: ${bestPairLanes.map((lane) => lane.rulesDecision).join(", ") || "none"}`,
    `- routeability status: ${bestPairLanes.map((lane) => lane.routeabilityDecision).join(", ") || "none"}`,
    `- exclusions remain locked: Others, non-shared tails, unknown/composite, pair-edge-missing`,
    `- review posture: limited-prod operator review only; no activation is authorized here`,
    ""
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-review-package.json`, reviewPackage);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-pair-review-checklist.md`, reviewChecklist);
  writeMarkdownArtifact(input.repoRoot, "docs/politics-nominee-2028-republican-pair-limited-prod-review.md", `${reviewSummary}\n`);

  return {
    pairMatcher,
    reviewPackage,
    reviewChecklist,
    reviewSummary
  };
};
