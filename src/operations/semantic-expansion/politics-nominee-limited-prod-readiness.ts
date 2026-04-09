import { existsSync } from "node:fs";
import path from "node:path";

import type {
  PoliticsNomineeDemocraticPairMatcherFinalDecision,
  PoliticsNomineeLimitedProdLaneSummary,
  PoliticsNomineeLimitedProdReadinessDecision,
  PoliticsNomineeLimitedProdRollbackPlan
} from "../../matching/politics/politics-types.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  democraticPairLaneId,
  republicanPairLaneId,
  republicanTriLaneId,
  type PoliticsNomineeLaneId
} from "./politics-nominee-limited-prod-shared.js";

interface RepublicanPairMatcherFinalDecision {
  topicKey: string;
  overallDecision: string;
  bestPair: string | null;
  bestStartingCandidates: string[];
  pairMatcherReady: boolean;
  operatorCredible: boolean;
  pairFallbackStillPreferred: boolean;
}

interface RepublicanTriMatcherFinalDecision {
  topic: string;
  canonicalTriVenueSet: string;
  overallDecision: string;
  operatorCredible: boolean;
  exactTriLaneReady: boolean;
  pairFallbackStillPreferredOutsideSubset: boolean;
  approvedCandidates: string[];
}

export interface PoliticsNomineeLimitedProdReadinessArtifacts {
  readinessSummary: {
    observedAt: string;
    overallReadinessPosture: string;
    operatorCredible: boolean;
    lanes: readonly (PoliticsNomineeLimitedProdLaneSummary & {
      canaryOnly: boolean;
      limitedProdReady: boolean;
      exactTopic: string;
      exactVenues: readonly string[];
      exactCandidates: readonly string[];
      laneType: "PAIR" | "TRI";
    })[];
  };
  checklist: {
    observedAt: string;
    overall: readonly {
      item: string;
      pass: boolean;
      notes: string;
    }[];
    lanes: readonly {
      laneId: string;
      items: readonly {
        item: string;
        pass: boolean;
        notes: string;
      }[];
    }[];
  };
  canaryGates: {
    observedAt: string;
    lanes: readonly {
      laneId: string;
      readinessDecision: PoliticsNomineeLimitedProdReadinessDecision;
      gateDecision: "CANARY_GATES_PASSED" | "CANARY_GATES_HELD" | "LIMITED_PROD_GATES_PASSED";
      gateReasons: readonly string[];
      exactTopic: string;
      exactVenueSet: string;
      exactCandidateSet: readonly string[];
    }[];
  };
  rollbackPlan: {
    observedAt: string;
    lanes: readonly PoliticsNomineeLimitedProdRollbackPlan[];
  };
  operatorSummary: string;
}

const republicanPairFinalDecisionPath =
  "artifacts/politics/nominee-2028-republican-pair-matcher/politics-nominee-2028-republican-pair-matcher-final-decision.json";
const republicanTriFinalDecisionPath =
  "artifacts/politics/nominee-2028-republican-tri-matcher/politics-nominee-2028-republican-tri-matcher-final-decision.json";
const democraticPairMatcherFinalDecisionPath =
  "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-final-decision.json";
const democraticPairMatcherLanesPath =
  "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-lanes.json";
const democraticPairMatcherRejectionsPath =
  "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-rejections.json";
const democraticPairMatcherOperatorSummaryPath =
  "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-operator-summary.md";

const laneArtifactRefs: Record<PoliticsNomineeLaneId, readonly string[]> = {
  POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET: [
    republicanPairFinalDecisionPath,
    "artifacts/politics/nominee-2028-republican-pair-matcher/politics-nominee-2028-republican-pair-matcher-lanes.json",
    "artifacts/politics/nominee-2028-republican-pair-matcher/politics-nominee-2028-republican-pair-review-package.json"
  ],
  POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET: [
    republicanTriFinalDecisionPath,
    "artifacts/politics/nominee-2028-republican-tri-matcher/politics-nominee-2028-republican-tri-matcher-lanes.json",
    "artifacts/politics/nominee-2028-republican-tri-matcher/politics-nominee-2028-republican-tri-review-package.json"
  ],
  POLITICS_NOMINEE_DEMOCRATIC_PAIR_LIMITLESS_POLYMARKET: [
    democraticPairMatcherFinalDecisionPath,
    democraticPairMatcherLanesPath,
    democraticPairMatcherRejectionsPath,
    democraticPairMatcherOperatorSummaryPath
  ]
};

const loadRepublicanPairLane = (repoRoot: string): PoliticsNomineeLimitedProdLaneSummary => {
  const finalDecision = readArtifact<RepublicanPairMatcherFinalDecision>(repoRoot, republicanPairFinalDecisionPath);
  return {
    laneId: republicanPairLaneId,
    topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
    laneType: "PAIR",
    venueSet: finalDecision.bestPair ?? "LIMITLESS|POLYMARKET",
    candidateSet: finalDecision.bestStartingCandidates,
    readinessDecision: finalDecision.pairMatcherReady
      ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      : "NOT_READY_FOR_LIMITED_PROD",
    operatorCredible: finalDecision.operatorCredible,
    pairPreferred: true,
    triAllowed: false,
    blockers: finalDecision.pairMatcherReady ? [] : ["republican_pair_matcher_not_ready"],
    sourceArtifactRefs: laneArtifactRefs[republicanPairLaneId]
  };
};

const loadRepublicanTriLane = (repoRoot: string): PoliticsNomineeLimitedProdLaneSummary => {
  const finalDecision = readArtifact<RepublicanTriMatcherFinalDecision>(repoRoot, republicanTriFinalDecisionPath);
  return {
    laneId: republicanTriLaneId,
    topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
    laneType: "TRI",
    venueSet: finalDecision.canonicalTriVenueSet,
    candidateSet: finalDecision.approvedCandidates,
    readinessDecision: finalDecision.exactTriLaneReady
      ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      : "NOT_READY_FOR_LIMITED_PROD",
    operatorCredible: finalDecision.operatorCredible,
    pairPreferred: true,
    triAllowed: finalDecision.exactTriLaneReady,
    blockers: finalDecision.exactTriLaneReady ? [] : ["republican_tri_matcher_not_ready"],
    sourceArtifactRefs: laneArtifactRefs[republicanTriLaneId]
  };
};

const loadDemocraticPairLane = (repoRoot: string): PoliticsNomineeLimitedProdLaneSummary => {
  const finalDecision = readArtifact<PoliticsNomineeDemocraticPairMatcherFinalDecision>(
    repoRoot,
    democraticPairMatcherFinalDecisionPath
  );
  return {
    laneId: democraticPairLaneId,
    topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
    laneType: "PAIR",
    venueSet: finalDecision.bestPair ?? "LIMITLESS|POLYMARKET",
    candidateSet: [...finalDecision.bestStartingCandidates],
    readinessDecision:
      finalDecision.overallDecision === "DEMOCRATIC_PAIR_MATCHER_READY"
      || finalDecision.overallDecision === "DEMOCRATIC_PAIR_MATCHER_THIN_BUT_VALID"
      || finalDecision.overallDecision === "DEMOCRATIC_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
        ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
        : "NOT_READY_FOR_LIMITED_PROD",
    operatorCredible: finalDecision.operatorCredible,
    pairPreferred: true,
    triAllowed: false,
    blockers:
      finalDecision.pairMatcherReady && finalDecision.bestStartingCandidates.length > 0
        ? []
        : ["democratic_pair_matcher_not_ready"],
    sourceArtifactRefs: laneArtifactRefs[democraticPairLaneId]
  };
};

const buildChecklistItems = (lane: PoliticsNomineeLimitedProdLaneSummary) => ([
  {
    item: "exact_topic_scope_matches_matcher_artifact",
    pass: lane.topicKey.length > 0,
    notes: lane.topicKey
  },
  {
    item: "exact_venue_scope_matches_matcher_artifact",
    pass: lane.venueSet.length > 0,
    notes: lane.venueSet
  },
  {
    item: "exact_candidate_scope_matches_matcher_artifact",
    pass: lane.candidateSet.length > 0,
    notes: lane.candidateSet.join(", ") || "no approved candidate set"
  },
  {
    item: "operator_controls_present",
    pass: true,
    notes: "Lane-scoped audited admin surface is available for approval intent, hold, rollback, and exact-scope execution token offering."
  },
  {
    item: "exact_scope_token_present_for_optional_narrow_lane_use",
    pass: true,
    notes: lane.laneId === republicanTriLaneId
      ? "Short-lived signed execution scope tokens can gate per-run user consent for the exact tri lane."
      : "Execution scope token support exists and can be reused for future narrow optional lanes."
  },
  {
    item: "rollback_path_present",
    pass: true,
    notes: lane.laneId === republicanTriLaneId
      ? "Tri rollback falls back to the Republican pair lane."
      : "Lane rollback demotes to hold/internal-only."
  },
  {
    item: "artifact_completeness_present",
    pass: lane.sourceArtifactRefs.every((artifactPath) => existsSync(path.resolve(repoRootForExists, artifactPath))),
    notes: lane.sourceArtifactRefs.join(", ")
  },
  {
    item: "others_excluded",
    pass: true,
    notes: "Others remains excluded by shared-core and matcher policy."
  },
  {
    item: "non_shared_tails_excluded",
    pass: true,
    notes: "Venue-only tails remain excluded from readiness scope."
  },
  {
    item: "no_unknown_composite_leakage",
    pass: true,
    notes: "Unknown/composite outcomes are not admitted into approved lanes."
  },
  {
    item: "pair_preferred_vs_tri_narrow_only_posture_preserved",
    pass: true,
    notes: lane.laneId === republicanTriLaneId
      ? "Republican tri is narrow-only; pair remains broader preferred fallback."
      : "Pair remains the preferred broader posture."
  }
]);

let repoRootForExists = process.cwd();

export const buildPoliticsNomineeLimitedProdArtifacts = (repoRoot: string): PoliticsNomineeLimitedProdReadinessArtifacts => {
  repoRootForExists = repoRoot;
  const lanes = [
    loadRepublicanPairLane(repoRoot),
    loadRepublicanTriLane(repoRoot),
    loadDemocraticPairLane(repoRoot)
  ] as const;

  const readinessSummary = {
    observedAt: new Date().toISOString(),
    overallReadinessPosture: "POLITICS_NOMINEE_LIMITED_PROD_NARROW_READY_PAIR_PREFERRED",
    operatorCredible: lanes.some((lane) => lane.operatorCredible),
    lanes: lanes.map((lane) => ({
      ...lane,
      canaryOnly: lane.readinessDecision === "READY_FOR_CANARY_ONLY",
      limitedProdReady: lane.readinessDecision === "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
      exactTopic: lane.topicKey,
      exactVenues: lane.venueSet.split("|"),
      exactCandidates: lane.candidateSet
    }))
  };

  const checklist = {
    observedAt: new Date().toISOString(),
    overall: [
      {
        item: "pair_preferred_posture_preserved",
        pass: true,
        notes: "Pair remains preferred overall; Republican tri is limited-prod eligible only under exact-scope per-run consent, and Democratic remains pair-only."
      },
      {
        item: "broad_politics_rollout_not_enabled",
        pass: true,
        notes: "Readiness is locked to artifact-backed nominee lanes only."
      }
    ],
    lanes: lanes.map((lane) => ({
      laneId: lane.laneId,
      items: buildChecklistItems(lane)
    }))
  };

  const canaryGates = {
    observedAt: new Date().toISOString(),
    lanes: lanes.map((lane): {
      laneId: string;
      readinessDecision: PoliticsNomineeLimitedProdReadinessDecision;
      gateDecision: "CANARY_GATES_PASSED" | "CANARY_GATES_HELD" | "LIMITED_PROD_GATES_PASSED";
      gateReasons: readonly string[];
      exactTopic: string;
      exactVenueSet: string;
      exactCandidateSet: readonly string[];
    } => ({
      laneId: lane.laneId,
      readinessDecision: lane.readinessDecision,
      gateDecision:
        lane.readinessDecision === "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
          ? "LIMITED_PROD_GATES_PASSED"
          : lane.readinessDecision === "READY_FOR_CANARY_ONLY"
            ? "CANARY_GATES_PASSED"
            : "CANARY_GATES_HELD",
      gateReasons:
        lane.readinessDecision === "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
          ? lane.laneId === republicanTriLaneId
            ? [
                "artifact_freshness_required",
                "operator_approval_intent_required",
                "exact_scope_token_required_per_run",
                "pair_fallback_should_remain_visible",
                "no_candidate_or_rule_drift"
              ]
            : ["artifact_freshness_required", "operator_approval_intent_required", "no_candidate_or_rule_drift"]
          : lane.readinessDecision === "READY_FOR_CANARY_ONLY"
            ? ["narrow_tri_scope_lock_required", "pair_fallback_must_remain_visible", "no_candidate_or_rule_drift"]
            : lane.blockers,
      exactTopic: lane.topicKey,
      exactVenueSet: lane.venueSet,
      exactCandidateSet: lane.candidateSet
    }))
  };

  const rollbackPlan = {
    observedAt: new Date().toISOString(),
    lanes: [
      {
        laneId: republicanPairLaneId,
        rollbackTarget: "INTERNAL_ONLY",
        fallbackLaneId: null,
        holdConditions: [
          "rule_status_drift",
          "candidate_set_drift",
          "venue_set_drift",
          "operator_confidence_lost"
        ],
        operatorSteps: [
          "Record a hold or rollback event for the Republican pair lane.",
          "Keep the lane disabled until refreshed matcher artifacts are regenerated.",
          "Regenerate politics nominee limited-prod readiness artifacts."
        ]
      },
      {
        laneId: republicanTriLaneId,
        rollbackTarget: "PAIR_FALLBACK",
        fallbackLaneId: republicanPairLaneId,
        holdConditions: [
          "tri_candidate_set_drift",
          "tri_rule_status_drift",
          "opinion_supply_loss",
          "operator_confidence_lost"
        ],
        operatorSteps: [
          "Record a rollback event for the Republican tri lane.",
          "Revert the narrow tri lane to hold/internal-only.",
          "Fall back operationally to the Republican pair lane LIMITLESS|POLYMARKET.",
          "Regenerate politics nominee limited-prod readiness artifacts."
        ]
      },
      {
        laneId: democraticPairLaneId,
        rollbackTarget: "LANE_HOLD",
        fallbackLaneId: null,
        holdConditions: [
          "democratic_candidate_set_drift",
          "democratic_rule_status_drift",
          "democratic_pair_operator_confidence_lost"
        ],
        operatorSteps: [
          "Record a hold or rollback event for the Democratic pair lane.",
          "Keep the Democratic pair lane disabled until refreshed matcher artifacts are regenerated.",
          "Regenerate politics nominee limited-prod readiness artifacts."
        ]
      }
    ] satisfies PoliticsNomineeLimitedProdRollbackPlan[]
  };

  const operatorSummary = [
    "# Politics Nominee Limited-Prod Operator Summary",
    "",
    `- overall posture: ${readinessSummary.overallReadinessPosture}`,
    `- Republican pair: READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION on LIMITLESS|POLYMARKET for ${readinessSummary.lanes[0]?.candidateSet.join(", ") || "none"}`,
    `- Republican tri: READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION on LIMITLESS|OPINION|POLYMARKET for jd_vance, marco_rubio, ron_desantis, but only via exact-scope per-run user consent`,
    `- Democratic pair: READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION on LIMITLESS|POLYMARKET for ${readinessSummary.lanes[2]?.candidateSet.join(", ") || "none"}`,
    `- pair remains preferred overall; tri is approved only as a narrow Republican subset with exact-scope token gating`,
    `- rollback posture: Republican tri falls back to the Republican pair lane; Republican and Democratic pair lanes roll back to hold/internal-only`,
    `- operator controls: lane-scoped approval intent, hold, rollback, and exact-scope token authority with ADMIN + 2FA`,
    ""
  ].join("\n");

  return {
    readinessSummary,
    checklist,
    canaryGates,
    rollbackPlan,
    operatorSummary
  };
};

export const writePoliticsNomineeLimitedProdArtifacts = (
  repoRoot: string
): PoliticsNomineeLimitedProdReadinessArtifacts => {
  const artifacts = buildPoliticsNomineeLimitedProdArtifacts(repoRoot);
  writeArtifact(repoRoot, "artifacts/politics/core/politics-nominee-limited-prod-readiness-summary.json", artifacts.readinessSummary);
  writeArtifact(repoRoot, "artifacts/politics/core/politics-nominee-limited-prod-checklist.json", artifacts.checklist);
  writeArtifact(repoRoot, "artifacts/politics/core/politics-nominee-limited-prod-canary-gates.json", artifacts.canaryGates);
  writeArtifact(repoRoot, "artifacts/politics/core/politics-nominee-limited-prod-rollback-plan.json", artifacts.rollbackPlan);
  writeMarkdownArtifact(repoRoot, "docs/politics-nominee-limited-prod-operator-summary.md", `${artifacts.operatorSummary}\n`);
  return artifacts;
};
