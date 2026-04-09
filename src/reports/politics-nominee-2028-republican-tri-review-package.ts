import type { Pool } from "pg";

import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import {
  runPoliticsNominee2028RepublicanTriMatcherPass,
  type PoliticsNominee2028RepublicanTriMatcherRunResult
} from "./politics-nominee-2028-republican-tri-matcher.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-republican-tri-matcher";

export interface PoliticsNominee2028RepublicanTriReviewPackageRunResult {
  triMatcher: PoliticsNominee2028RepublicanTriMatcherRunResult;
  reviewPackage: Record<string, unknown>;
  reviewChecklist: string;
  reviewSummary: string;
}

export const runPoliticsNominee2028RepublicanTriReviewPackagePass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028RepublicanTriReviewPackageRunResult> => {
  const triMatcher = await runPoliticsNominee2028RepublicanTriMatcherPass(input);
  const lanes = triMatcher.lanes as {
    topic: string;
    canonicalTriVenueSet: string;
    matcherLanes: {
      candidateIdentityKey: string;
      routeabilityDecision: string;
      rulesDecision: string;
      evidence: {
        venue: string;
        venueMarketId: string;
        rawOutcomeLabel: string;
      }[];
    }[];
  };
  const finalDecision = triMatcher.finalDecision as {
    overallDecision: string;
    operatorCredible: boolean;
    exactTriLaneReady: boolean;
    pairFallbackStillPreferredOutsideSubset: boolean;
    approvedCandidates: string[];
    recommendedStartingLane: string | null;
  };

  const reviewPackage = {
    observedAt: new Date().toISOString(),
    reviewState: finalDecision.exactTriLaneReady ? "READY_PENDING_OPERATOR_REVIEW" : "NOT_READY",
    topicKey: lanes.topic,
    approvedTriVenueSet: lanes.canonicalTriVenueSet,
    approvedCandidates: finalDecision.approvedCandidates,
    exactSafeOnly: true,
    ruleCompatibilityState: lanes.matcherLanes.map((lane) => lane.rulesDecision),
    routeabilityState: lanes.matcherLanes.map((lane) => lane.routeabilityDecision),
    pairFallbackStillPreferredOutsideSubset: finalDecision.pairFallbackStillPreferredOutsideSubset,
    exclusionsLocked: [
      "OTHERS_EXCLUDED",
      "NOT_SHARED",
      "UNKNOWN_COMPOSITE",
      "PAIR_ONLY_OUTSIDE_SUBSET",
      "TRI_EDGE_MISSING"
    ],
    sourceArtifacts: {
      triMatcher: `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-matcher-final-decision.json`,
      lanes: `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-matcher-lanes.json`,
      rejections: `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-matcher-rejections.json`
    },
    operatorChecks: [
      "Confirm the scope is exactly NOMINEE|US_PRESIDENT|2028|REPUBLICAN.",
      "Confirm the only approved tri venue set is LIMITLESS|OPINION|POLYMARKET.",
      "Confirm the approved candidate set is exactly jd_vance, marco_rubio, and ron_desantis.",
      "Confirm every approved lane remains TRI_EXACT_AUTO_ROUTEABLE and EXACT_RULE_COMPATIBLE.",
      "Confirm Others, venue-only tails, pair-only names, and unknown/composite outcomes remain excluded.",
      "Confirm pair fallback remains the broader preferred policy outside this narrow tri subset.",
      "Confirm no Democratic or broader Republican topic is included."
    ],
    holdBoundaries: [
      "Do not activate broader Republican tri beyond jd_vance, marco_rubio, and ron_desantis.",
      "Do not add pair-only Republican names to this tri package.",
      "Do not widen into Democratic or broad politics.",
      "Do not treat this review package as routing activation."
    ]
  };

  const reviewChecklist = [
    "# Republican Nominee 2028 Tri Limited-Prod Review Checklist",
    "",
    `- topic locked: ${lanes.topic}`,
    `- approved tri venue set: ${lanes.canonicalTriVenueSet}`,
    `- approved candidates: ${finalDecision.approvedCandidates.join(", ") || "none"}`,
    "",
    "## Required Checks",
    "",
    "- confirm the review package is read-only and does not authorize rollout",
    "- confirm every approved lane is `TRI_EXACT_AUTO_ROUTEABLE`",
    "- confirm every approved lane is `EXACT_RULE_COMPATIBLE`",
    "- confirm no `Others` bucket is present in approved lanes",
    "- confirm pair-only Republican names remain outside this tri subset",
    "- confirm no Democratic or broader politics topic is being promoted from this package",
    "",
    "## Evidence",
    "",
    ...lanes.matcherLanes.map((lane) =>
      `- ${lane.candidateIdentityKey}: ${lane.evidence.map((evidence) => `${evidence.venue}:${evidence.rawOutcomeLabel}`).join(" | ")}`
    ),
    "",
    "## Hold Conditions",
    "",
    "- any rule compatibility drift away from exact-safe",
    "- any candidate mismatch across LIMITLESS, OPINION, and POLYMARKET",
    "- any attempt to add pair-only or venue-only Republican names",
    "- any attempt to widen scope beyond this exact topic and tri subset",
    ""
  ].join("\n");

  const reviewSummary = [
    "# Republican Nominee 2028 Tri Limited-Prod Review",
    "",
    `- current decision: ${finalDecision.overallDecision}`,
    `- operator credible: ${finalDecision.operatorCredible ? "yes" : "no"}`,
    `- approved tri venue set: ${lanes.canonicalTriVenueSet}`,
    `- approved candidates: ${finalDecision.approvedCandidates.join(", ") || "none"}`,
    `- rule status: ${lanes.matcherLanes.map((lane) => lane.rulesDecision).join(", ") || "none"}`,
    `- routeability status: ${lanes.matcherLanes.map((lane) => lane.routeabilityDecision).join(", ") || "none"}`,
    `- pair fallback still preferred outside subset: ${finalDecision.pairFallbackStillPreferredOutsideSubset ? "yes" : "no"}`,
    `- exclusions remain locked: Others, venue-only tails, pair-only Republican names outside subset, unknown/composite`,
    `- review posture: limited-prod operator review only; no activation is authorized here`,
    ""
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-review-package.json`, reviewPackage);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-tri-review-checklist.md`, reviewChecklist);
  writeMarkdownArtifact(input.repoRoot, "docs/politics-nominee-2028-republican-tri-limited-prod-review.md", `${reviewSummary}\n`);

  return {
    triMatcher,
    reviewPackage,
    reviewChecklist,
    reviewSummary
  };
};
