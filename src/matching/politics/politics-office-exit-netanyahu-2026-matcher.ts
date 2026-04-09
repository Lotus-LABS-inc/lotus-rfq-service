import type {
  PoliticsNomineeRuleCompatibilityClass,
  PoliticsOfficeExitNetanyahu2026MatcherFinalDecision,
  PoliticsOfficeExitNetanyahu2026MatcherRejection,
  PoliticsOfficeExitNetanyahu2026PairLane,
  PoliticsOfficeExitNetanyahu2026TriLane
} from "./politics-types.js";
import type {
  PoliticsOfficeExitByDateComparabilityTopicSummary,
  PoliticsOfficeExitByDateNormalizedTopicRow
} from "./politics-office-exit-by-date-family-pass.js";

const TOPIC_KEY = "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31" as const;
const PROPOSITION_IDENTITY_KEY = "NETANYAHU_OUT_BEFORE_2027" as const;
const NORMALIZED_PROPOSITION_NAME = "netanyahu_out_before_2027" as const;
const TRI_VENUE_SET = "LIMITLESS|POLYMARKET|PREDICT" as const;
const ALLOWED_VENUES = ["LIMITLESS", "POLYMARKET", "PREDICT"] as const;
const EXCLUDED_VENUES = ["OPINION", "MYRIAD"] as const;
const PAIR_PRIORITY = ["LIMITLESS|POLYMARKET", "LIMITLESS|PREDICT", "POLYMARKET|PREDICT"] as const;
const EVIDENCE_SOURCES = [
  "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-fetch-summary.json",
  "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-admission-summary.json",
  "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-normalized-topics.json",
  "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-comparability-summary.json",
  "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-basis-fragmentation-summary.json",
  "artifacts/politics/office-exit-by-date-family-pass/politics-office-exit-by-date-final-decision.json"
] as const;

type AllowedVenue = (typeof ALLOWED_VENUES)[number];
type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface PoliticsOfficeExitNetanyahu2026MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly string[];
  pairLanes: readonly PoliticsOfficeExitNetanyahu2026PairLane[];
  triLanes: readonly PoliticsOfficeExitNetanyahu2026TriLane[];
  rejections: readonly PoliticsOfficeExitNetanyahu2026MatcherRejection[];
  finalDecision: PoliticsOfficeExitNetanyahu2026MatcherFinalDecision;
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const mapRuleToPairRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsOfficeExitNetanyahu2026PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? "PAIR_EXACT_AUTO_ROUTEABLE"
    : ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING" || ruleStatus === "REVIEW_REQUIRED_RULE_VARIANCE"
      ? "PAIR_REVIEW_REQUIRED"
      : "PAIR_REJECTED";

const mapRuleToTriRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsOfficeExitNetanyahu2026TriLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? "TRI_EXACT_AUTO_ROUTEABLE"
    : ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING" || ruleStatus === "REVIEW_REQUIRED_RULE_VARIANCE"
      ? "TRI_REVIEW_REQUIRED"
      : "TRI_REJECTED";

const buildPairNotes = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass,
  venuePair: PairVenueSet
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? [`Exact-safe office-exit proposition lane on ${venuePair}.`]
    : [
      `Office-exit proposition is shared on ${venuePair}, but rule wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this pair lane as exact-safe."
    ];

const buildTriNotes = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe strict 3-venue office-exit proposition lane on LIMITLESS|POLYMARKET|PREDICT."]
    : [
      "Office-exit proposition survives the strict 3-venue intersection, but rule wording is semantically compatible rather than exact.",
      "Operator review is required before treating this tri lane as exact-safe."
    ];

export const buildPoliticsOfficeExitNetanyahu2026MatcherMaterialization = (input: {
  normalizedTopics: readonly PoliticsOfficeExitByDateNormalizedTopicRow[];
  comparabilitySummary: readonly PoliticsOfficeExitByDateComparabilityTopicSummary[];
}): PoliticsOfficeExitNetanyahu2026MatcherMaterialization => {
  const topicSummary = input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const topicRows = input.normalizedTopics.filter((row) => row.canonicalTopicKey === TOPIC_KEY && row.rejectionReason === null);
  const allowedRows = [...new Map(
    topicRows
      .filter((row) => ALLOWED_VENUES.includes(row.venue as AllowedVenue))
      .map((row) => [row.venue, row] as const)
  ).values()];
  const admittedVenues = [...unique(allowedRows.map((row) => row.venue))].sort();
  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "UNKNOWN_RULE_MEANING";
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);
  const triRouteability = mapRuleToTriRouteability(ruleStatus);
  const rejections: PoliticsOfficeExitNetanyahu2026MatcherRejection[] = [];

  for (const venue of EXCLUDED_VENUES) {
    rejections.push({
      scope: "venue",
      venue,
      venueSet: TRI_VENUE_SET,
      reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
      notes: `${venue} is not part of the freshly admitted venue truth for ${TOPIC_KEY}.`
    });
  }

  const pairLanes: PoliticsOfficeExitNetanyahu2026PairLane[] = [];
  for (const venuePair of PAIR_PRIORITY) {
    const [leftVenue, rightVenue] = venuePair.split("|") as [AllowedVenue, AllowedVenue];
    const leftRow = allowedRows.find((row) => row.venue === leftVenue);
    const rightRow = allowedRows.find((row) => row.venue === rightVenue);

    if (!leftRow || !rightRow) {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "PAIR_EDGE_MISSING",
        notes: `${venuePair} is not currently admitted for ${TOPIC_KEY}.`
      });
      continue;
    }

    if (pairRouteability === "PAIR_REJECTED") {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "RULE_MISMATCH",
        notes: `Rule state ${ruleStatus} blocks exact-safe office-exit pair construction on ${venuePair}.`
      });
      continue;
    }

    pairLanes.push({
      canonicalTopicKey: TOPIC_KEY,
      venuePair,
      propositionIdentityKey: PROPOSITION_IDENTITY_KEY,
      normalizedPropositionName: NORMALIZED_PROPOSITION_NAME,
      routeabilityDecision: pairRouteability,
      rulesDecision: ruleStatus,
      matcherReady: true,
      evidenceSources: EVIDENCE_SOURCES,
      evidence: [
        { venue: leftVenue, venueMarketId: leftRow.venueMarketId, title: leftRow.title },
        { venue: rightVenue, venueMarketId: rightRow.venueMarketId, title: rightRow.title }
      ],
      notes: buildPairNotes(ruleStatus, venuePair)
    });
  }

  const triLanes: PoliticsOfficeExitNetanyahu2026TriLane[] = [];
  if (ALLOWED_VENUES.every((venue) => allowedRows.some((row) => row.venue === venue))) {
    if (triRouteability === "TRI_REJECTED") {
      rejections.push({
        scope: "tri_lane",
        venueSet: TRI_VENUE_SET,
        reason: "RULE_MISMATCH",
        notes: `Rule state ${ruleStatus} blocks exact-safe office-exit tri construction.`
      });
    } else {
      triLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        canonicalTriVenueSet: TRI_VENUE_SET,
        propositionIdentityKey: PROPOSITION_IDENTITY_KEY,
        normalizedPropositionName: NORMALIZED_PROPOSITION_NAME,
        routeabilityDecision: triRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: allowedRows
          .sort((left, right) => left.venue.localeCompare(right.venue))
          .map((row) => ({
            venue: row.venue as AllowedVenue,
            venueMarketId: row.venueMarketId,
            title: row.title
          })),
        notes: buildTriNotes(ruleStatus)
      });
    }
  } else {
    rejections.push({
      scope: "tri_lane",
      venueSet: TRI_VENUE_SET,
      reason: "TRI_EDGE_MISSING",
      notes: `Strict tri evaluation is blocked because not all of LIMITLESS, POLYMARKET, and PREDICT are freshly admitted for ${TOPIC_KEY}.`
    });
  }

  if (!topicSummary) {
    rejections.push({
      scope: "pair_lane",
      venueSet: TRI_VENUE_SET,
      reason: "OUT_OF_SCOPE_TOPIC",
      notes: `${TOPIC_KEY} was not present in the current office-exit comparability summary.`
    });
  }

  const bestPair = pairLanes.length > 0 ? PAIR_PRIORITY.find((pair) => pairLanes.some((lane) => lane.venuePair === pair)) ?? null : null;
  const pairMatcherReady = pairLanes.length > 0;
  const triMatcherReady = triLanes.length > 0;
  const reviewOnly =
    (pairMatcherReady && pairLanes.every((lane) => lane.routeabilityDecision === "PAIR_REVIEW_REQUIRED"))
    || (triMatcherReady && triLanes.every((lane) => lane.routeabilityDecision === "TRI_REVIEW_REQUIRED"));

  const overallDecision: PoliticsOfficeExitNetanyahu2026MatcherFinalDecision["overallDecision"] =
    triMatcherReady
      ? reviewOnly
        ? "OFFICE_EXIT_NETANYAHU_2026_TRI_REVIEW_REQUIRED"
        : "OFFICE_EXIT_NETANYAHU_2026_TRI_READY_BUT_PAIR_FIRST"
      : pairMatcherReady
        ? reviewOnly
          ? "OFFICE_EXIT_NETANYAHU_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "OFFICE_EXIT_NETANYAHU_2026_PAIR_MATCHER_READY"
        : topicSummary
          && admittedVenues.length >= 2
          && ruleStatus !== "RULES_MATERIALLY_INCOMPATIBLE"
          && ruleStatus !== "UNKNOWN_RULE_MEANING"
          ? "OFFICE_EXIT_NETANYAHU_2026_TRI_NOT_JUSTIFIED_PAIR_ONLY"
          : "OFFICE_EXIT_NETANYAHU_2026_MATCHER_NOT_READY";

  return {
    canonicalTopicKey: TOPIC_KEY,
    admittedVenues,
    pairLanes: pairLanes.sort((left, right) => left.venuePair.localeCompare(right.venuePair)),
    triLanes,
    rejections: rejections.sort((left, right) =>
      left.scope.localeCompare(right.scope)
      || (left.venuePair ?? "").localeCompare(right.venuePair ?? "")
      || (left.venueSet ?? "").localeCompare(right.venueSet ?? "")
      || (left.venue ?? "").localeCompare(right.venue ?? "")
      || left.reason.localeCompare(right.reason)
    ),
    finalDecision: {
      overallDecision,
      bestPair,
      bestTriIfAny: triMatcherReady ? TRI_VENUE_SET : null,
      pairMatcherReady,
      triMatcherReady,
      pairStillPreferred: true,
      exactSafePairCandidateCount: pairLanes.length,
      exactSafeTriCandidateCount: triLanes.length,
      ruleStatus,
      operatorCredible: topicSummary !== null && admittedVenues.length >= 2,
      matcherFollowUpJustified: pairMatcherReady || triMatcherReady,
      singleBestNextAction:
        triMatcherReady
          ? `Start narrow operator review on the strict tri lane ${TRI_VENUE_SET}, while keeping ${bestPair ?? "the best pair"} as the pair fallback.`
          : pairMatcherReady
            ? `Start narrow operator review on the best office-exit pair lane ${bestPair ?? "unknown"} and do not assume tri until LIMITLESS, POLYMARKET, and PREDICT remain freshly admitted.`
            : `Hold ${TOPIC_KEY} until fresh office-exit evidence produces a real admitted pair lane.`
    }
  };
};
