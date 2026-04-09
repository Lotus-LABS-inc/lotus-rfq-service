import type {
  PoliticsOfficeWinnerComparabilityTopicSummary,
  PoliticsOfficeWinnerNormalizedTopicRow
} from "./politics-office-winner-family-pass.js";
import type {
  PoliticsNomineeRuleCompatibilityClass,
  PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision,
  PoliticsOfficeWinnerUsPresident2028MatcherLane,
  PoliticsOfficeWinnerUsPresident2028MatcherRejection
} from "./politics-types.js";

const TOPIC_KEY = "OFFICE_WINNER|USA|US_PRESIDENT|2028" as const;
const VENUE_PAIR = "LIMITLESS|POLYMARKET" as const;
const ALLOWED_VENUES = ["LIMITLESS", "POLYMARKET"] as const;
const EXCLUDED_VENUES = ["MYRIAD", "OPINION", "PREDICT"] as const;
const EVIDENCE_SOURCES = [
  "artifacts/politics/office-winner-family-pass/politics-office-winner-fetch-summary.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-admission-summary.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-normalized-topics.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-comparability-summary.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-basis-fragmentation-summary.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-final-decision.json"
] as const;

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const normalizeCandidateName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[`'".,()/:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toCandidateIdentityKey = (value: string): string =>
  normalizeCandidateName(value).replace(/\s+/g, "_");

const mapRuleDecisionToRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsOfficeWinnerUsPresident2028MatcherLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE" ? "PAIR_EXACT_AUTO_ROUTEABLE"
  : ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING" || ruleStatus === "REVIEW_REQUIRED_RULE_VARIANCE" ? "PAIR_REVIEW_REQUIRED"
  : "PAIR_REJECTED";

const findCandidateRawLabel = (
  row: PoliticsOfficeWinnerNormalizedTopicRow,
  normalizedCandidateName: string
): string | null => {
  const match = row.candidateSet.find((candidate) => normalizeCandidateName(candidate) === normalizedCandidateName);
  return match ?? null;
};

const buildCandidateNotes = (ruleStatus: PoliticsNomineeRuleCompatibilityClass): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe office-winner shared candidate on LIMITLESS|POLYMARKET."]
    : [
      "Candidate is shared across LIMITLESS|POLYMARKET, but rule wording is semantically compatible rather than exact.",
      "Operator review is required before treating this office-winner lane as exact-safe."
    ];

export interface PoliticsOfficeWinnerUsPresident2028MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  venuePair: typeof VENUE_PAIR;
  admittedVenues: readonly string[];
  admittedCandidates: readonly string[];
  matcherLanes: readonly PoliticsOfficeWinnerUsPresident2028MatcherLane[];
  rejections: readonly PoliticsOfficeWinnerUsPresident2028MatcherRejection[];
  finalDecision: PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision;
}

export const buildPoliticsOfficeWinnerUsPresident2028MatcherMaterialization = (input: {
  normalizedTopics: readonly PoliticsOfficeWinnerNormalizedTopicRow[];
  comparabilitySummary: readonly PoliticsOfficeWinnerComparabilityTopicSummary[];
}): PoliticsOfficeWinnerUsPresident2028MatcherMaterialization => {
  const topicSummary = input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const topicRows = input.normalizedTopics.filter((row) => row.canonicalTopicKey === TOPIC_KEY);
  const allowedRows = topicRows.filter((row) =>
    ALLOWED_VENUES.includes(row.venue as (typeof ALLOWED_VENUES)[number])
  ) as readonly PoliticsOfficeWinnerNormalizedTopicRow[];
  const venueSet = new Set(allowedRows.map((row) => row.venue));

  const rejections: PoliticsOfficeWinnerUsPresident2028MatcherRejection[] = [];

  for (const venue of EXCLUDED_VENUES) {
    rejections.push({
      scope: "venue",
      venue,
      venuePair: VENUE_PAIR,
      reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
      notes: `${venue} is not part of the freshly admitted venue truth for ${TOPIC_KEY}.`
    });
  }

  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "UNKNOWN_RULE_MEANING";
  const routeabilityDecision = mapRuleDecisionToRouteability(ruleStatus);
  const sharedCandidates = topicSummary?.sharedNamedCandidates ?? [];
  const materializedCandidates =
    allowedRows.length === 2 && routeabilityDecision !== "PAIR_REJECTED"
      ? sharedCandidates
      : [];

  const laneCandidates = materializedCandidates
    .map((candidate): PoliticsOfficeWinnerUsPresident2028MatcherLane | null => {
      const evidence = allowedRows
        .map((row) => {
          const rawOutcomeLabel = findCandidateRawLabel(row, candidate);
          return rawOutcomeLabel ? {
            venue: row.venue as "LIMITLESS" | "POLYMARKET",
            venueMarketId: row.venueMarketId,
            rawOutcomeLabel
          } : null;
        })
        .filter((entry): entry is {
          venue: "LIMITLESS" | "POLYMARKET";
          venueMarketId: string;
          rawOutcomeLabel: string;
        } => entry !== null);

      if (evidence.length !== 2) {
        rejections.push({
          scope: "candidate",
          candidateIdentityKey: toCandidateIdentityKey(candidate),
          normalizedCandidateName: candidate,
          venuePair: VENUE_PAIR,
          reason: "PAIR_EDGE_MISSING",
          notes: `Candidate ${candidate} did not survive with explicit evidence on both LIMITLESS and POLYMARKET.`
        });
        return null;
      }

      return {
        canonicalTopicKey: TOPIC_KEY,
        venuePair: VENUE_PAIR,
        candidateIdentityKey: toCandidateIdentityKey(candidate),
        normalizedCandidateName: candidate,
        routeabilityDecision,
        rulesDecision: ruleStatus,
        matcherReady: routeabilityDecision !== "PAIR_REJECTED",
        evidenceSources: EVIDENCE_SOURCES,
        evidence,
        notes: buildCandidateNotes(ruleStatus)
      };
    });
  const matcherLanes: PoliticsOfficeWinnerUsPresident2028MatcherLane[] = laneCandidates
    .filter((lane): lane is PoliticsOfficeWinnerUsPresident2028MatcherLane => lane !== null)
    .sort((left, right) => left.candidateIdentityKey.localeCompare(right.candidateIdentityKey));

  if (topicSummary) {
    for (const outcome of topicSummary.excludedOutcomes) {
      rejections.push({
        scope: "candidate",
        candidateIdentityKey:
          outcome.reason === "UNKNOWN_COMPOSITE" || outcome.reason === "OTHERS_EXCLUDED"
            ? null
            : toCandidateIdentityKey(outcome.label),
        normalizedCandidateName: normalizeCandidateName(outcome.label),
        venuePair: VENUE_PAIR,
        reason:
          outcome.reason === "OTHERS_EXCLUDED" ? "OTHERS_EXCLUDED"
          : outcome.reason === "UNKNOWN_COMPOSITE" ? "UNKNOWN_COMPOSITE"
          : "NOT_SHARED",
        notes:
          outcome.reason === "OTHERS_EXCLUDED"
            ? `Outcome ${outcome.label} is excluded by shared-core policy.`
            : outcome.reason === "UNKNOWN_COMPOSITE"
              ? `Outcome ${outcome.label} is excluded because it is unknown or composite.`
              : `Candidate ${outcome.label} is not part of the exact shared LIMITLESS|POLYMARKET office-winner core.`
      });
    }
  }

  if (!topicSummary) {
    rejections.push({
      scope: "lane",
      venuePair: VENUE_PAIR,
      reason: "OUT_OF_SCOPE_TOPIC",
      notes: `${TOPIC_KEY} was not present in the current office-winner comparability summary.`
    });
  } else if (venueSet.size < 2) {
    rejections.push({
      scope: "lane",
      venuePair: VENUE_PAIR,
      reason: "PAIR_EDGE_MISSING",
      notes: `${TOPIC_KEY} is not currently admitted on both LIMITLESS and POLYMARKET.`
    });
  } else if (routeabilityDecision === "PAIR_REJECTED") {
    rejections.push({
      scope: "lane",
      venuePair: VENUE_PAIR,
      reason: "RULE_MISMATCH",
      notes: `Rule state ${ruleStatus} blocks exact-safe office-winner matcher construction.`
    });
  } else if (matcherLanes.length <= 1) {
    rejections.push({
      scope: "lane",
      venuePair: VENUE_PAIR,
      reason: "THIN_LANE",
      notes: `Only ${matcherLanes.length} exact-safe shared candidate survived for ${VENUE_PAIR}.`
    });
  }

  const reviewOnly = matcherLanes.length > 0 && matcherLanes.every((lane) => lane.routeabilityDecision === "PAIR_REVIEW_REQUIRED");
  const heldOnRules = routeabilityDecision === "PAIR_REJECTED";
  const thinLane = matcherLanes.length > 0 && matcherLanes.length <= 1;

  const finalDecision: PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision = {
    overallDecision:
      matcherLanes.length === 0 ? heldOnRules ? "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_HELD_ON_RULES" : "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_NOT_READY"
      : reviewOnly ? "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
      : thinLane ? "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_THIN_BUT_VALID"
      : "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_READY",
    bestPair: matcherLanes.length > 0 ? VENUE_PAIR : null,
    bestStartingCandidates: matcherLanes.map((lane) => lane.candidateIdentityKey),
    pairMatcherReady: matcherLanes.length > 0,
    operatorCredible: topicSummary !== null && venueSet.has("LIMITLESS") && venueSet.has("POLYMARKET"),
    pairPreferred: true,
    exactSafeCandidateCount: matcherLanes.length,
    ruleStatus,
    matcherFollowUpJustified: matcherLanes.length > 0,
    singleBestNextAction:
      matcherLanes.length === 0
        ? `Hold ${TOPIC_KEY} until LIMITLESS|POLYMARKET produces a usable exact-safe office-winner pair lane.`
        : reviewOnly
          ? `Start a narrow readiness review for ${VENUE_PAIR} on ${TOPIC_KEY}, but require operator rule review because only semantically compatible wording survived.`
          : `Start a narrow readiness review for ${VENUE_PAIR} on ${TOPIC_KEY} with candidates ${matcherLanes.map((lane) => lane.candidateIdentityKey).join(", ")}.`
  };

  return {
    canonicalTopicKey: TOPIC_KEY,
    venuePair: VENUE_PAIR,
    admittedVenues: [...unique(allowedRows.map((row) => row.venue))].sort((left, right) => left.localeCompare(right)),
    admittedCandidates: matcherLanes.map((lane) => lane.candidateIdentityKey),
    matcherLanes,
    rejections: rejections.sort((left, right) =>
      left.scope.localeCompare(right.scope)
      || (left.venue ?? "").localeCompare(right.venue ?? "")
      || (left.venuePair ?? "").localeCompare(right.venuePair ?? "")
      || (left.candidateIdentityKey ?? "").localeCompare(right.candidateIdentityKey ?? "")
      || left.reason.localeCompare(right.reason)
    ),
    finalDecision
  };
};
