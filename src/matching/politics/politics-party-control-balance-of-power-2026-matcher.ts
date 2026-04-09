import type {
  PoliticsNomineeRuleCompatibilityClass,
  PoliticsPartyControlBalanceOfPower2026MatcherFinalDecision,
  PoliticsPartyControlBalanceOfPower2026MatcherRejection,
  PoliticsPartyControlBalanceOfPower2026PairLane,
  PoliticsPartyControlBalanceOfPower2026TriLane
} from "./politics-types.js";
import type {
  PoliticsPartyControlComparabilityTopicSummary,
  PoliticsPartyControlNormalizedTopicRow
} from "./politics-party-control-family-pass.js";

const TOPIC_KEY = "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER" as const;
const TRI_VENUE_SET = "OPINION|POLYMARKET|PREDICT" as const;
const ALLOWED_VENUES = ["OPINION", "POLYMARKET", "PREDICT"] as const;
const EXCLUDED_VENUES = ["LIMITLESS", "MYRIAD"] as const;
const PAIR_PRIORITY = ["OPINION|POLYMARKET", "OPINION|PREDICT", "POLYMARKET|PREDICT"] as const;
const EVIDENCE_SOURCES = [
  "artifacts/politics/party-control-family-pass/politics-party-control-fetch-summary.json",
  "artifacts/politics/party-control-family-pass/politics-party-control-admission-summary.json",
  "artifacts/politics/party-control-family-pass/politics-party-control-normalized-topics.json",
  "artifacts/politics/party-control-family-pass/politics-party-control-comparability-summary.json",
  "artifacts/politics/party-control-family-pass/politics-party-control-basis-fragmentation-summary.json",
  "artifacts/politics/party-control-family-pass/politics-party-control-final-decision.json"
] as const;

type AllowedVenue = (typeof ALLOWED_VENUES)[number];
type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface PoliticsPartyControlBalanceOfPower2026MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly string[];
  admittedOutcomes: readonly string[];
  pairLanes: readonly PoliticsPartyControlBalanceOfPower2026PairLane[];
  triLanes: readonly PoliticsPartyControlBalanceOfPower2026TriLane[];
  rejections: readonly PoliticsPartyControlBalanceOfPower2026MatcherRejection[];
  finalDecision: PoliticsPartyControlBalanceOfPower2026MatcherFinalDecision;
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const toOutcomeIdentityKey = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, "_");

const pickBestRowPerVenue = (
  rows: readonly PoliticsPartyControlNormalizedTopicRow[]
): readonly PoliticsPartyControlNormalizedTopicRow[] =>
  [...new Map(rows.map((row) => [row.venue, row] as const)).keys()].map((venue) =>
    rows
      .filter((row) => row.venue === venue)
      .sort((left, right) =>
        (right.normalizedOutcomes.length - left.normalizedOutcomes.length)
        || left.venueMarketId.localeCompare(right.venueMarketId)
      )[0]!
  );

const mapRuleToPairRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsPartyControlBalanceOfPower2026PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? "PAIR_EXACT_AUTO_ROUTEABLE"
    : ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING" || ruleStatus === "REVIEW_REQUIRED_RULE_VARIANCE"
      ? "PAIR_REVIEW_REQUIRED"
      : "PAIR_REJECTED";

const mapRuleToTriRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsPartyControlBalanceOfPower2026TriLane["routeabilityDecision"] =>
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
    ? [`Exact-safe shared party-control outcome on ${venuePair}.`]
    : [
      `Outcome is shared across ${venuePair}, but rule wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this party-control pair lane as exact-safe."
    ];

const buildTriNotes = (ruleStatus: PoliticsNomineeRuleCompatibilityClass): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe strict 3-venue party-control outcome on OPINION|POLYMARKET|PREDICT."]
    : [
      "Outcome survives the strict 3-venue intersection, but rule wording is semantically compatible rather than exact.",
      "Operator review is required before treating this party-control tri lane as exact-safe."
    ];

export const buildPoliticsPartyControlBalanceOfPower2026MatcherMaterialization = (input: {
  normalizedTopics: readonly PoliticsPartyControlNormalizedTopicRow[];
  comparabilitySummary: readonly PoliticsPartyControlComparabilityTopicSummary[];
}): PoliticsPartyControlBalanceOfPower2026MatcherMaterialization => {
  const topicSummary = input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const topicRows = input.normalizedTopics.filter((row) => row.canonicalTopicKey === TOPIC_KEY && row.rejectionReason === null);
  const allowedRows = pickBestRowPerVenue(
    topicRows.filter((row) => ALLOWED_VENUES.includes(row.venue as AllowedVenue)) as readonly PoliticsPartyControlNormalizedTopicRow[]
  );
  const admittedVenues = [...unique(allowedRows.map((row) => row.venue))].sort();
  const admittedOutcomes = [...unique(allowedRows.flatMap((row) => row.normalizedOutcomes))].sort();
  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "UNKNOWN_RULE_MEANING";
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);
  const triRouteability = mapRuleToTriRouteability(ruleStatus);
  const rejections: PoliticsPartyControlBalanceOfPower2026MatcherRejection[] = [];

  for (const venue of EXCLUDED_VENUES) {
    rejections.push({
      scope: "venue",
      venue,
      venueSet: TRI_VENUE_SET,
      reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
      notes: `${venue} is not part of the freshly admitted venue truth for ${TOPIC_KEY}.`
    });
  }

  const outcomeVenueRows = new Map<string, Map<AllowedVenue, PoliticsPartyControlNormalizedTopicRow>>();
  for (const row of allowedRows) {
    for (const outcome of row.normalizedOutcomes) {
      const venueMap = outcomeVenueRows.get(outcome) ?? new Map<AllowedVenue, PoliticsPartyControlNormalizedTopicRow>();
      venueMap.set(row.venue as AllowedVenue, row);
      outcomeVenueRows.set(outcome, venueMap);
    }
  }

  const pairLanes: PoliticsPartyControlBalanceOfPower2026PairLane[] = [];
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
        notes: `Rule state ${ruleStatus} blocks exact-safe party-control pair construction on ${venuePair}.`
      });
      continue;
    }

    const sharedOutcomes = [...outcomeVenueRows.entries()]
      .filter(([, venueMap]) => venueMap.has(leftVenue) && venueMap.has(rightVenue))
      .map(([outcome]) => outcome)
      .sort((left, right) => left.localeCompare(right));

    if (sharedOutcomes.length === 0) {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "PAIR_EDGE_MISSING",
        notes: `No shared named outcome survived on ${venuePair} for ${TOPIC_KEY}.`
      });
      continue;
    }

    for (const outcome of sharedOutcomes) {
      pairLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        venuePair,
        outcomeIdentityKey: toOutcomeIdentityKey(outcome),
        normalizedOutcomeName: outcome,
        routeabilityDecision: pairRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: [
          { venue: leftVenue, venueMarketId: leftRow.venueMarketId, rawOutcomeLabel: outcome },
          { venue: rightVenue, venueMarketId: rightRow.venueMarketId, rawOutcomeLabel: outcome }
        ],
        notes: buildPairNotes(ruleStatus, venuePair)
      });
    }
  }

  const triLanes: PoliticsPartyControlBalanceOfPower2026TriLane[] = [];
  const triRows = ALLOWED_VENUES.map((venue) => allowedRows.find((row) => row.venue === venue)).filter(Boolean) as PoliticsPartyControlNormalizedTopicRow[];
  if (triRows.length === 3 && triRouteability !== "TRI_REJECTED") {
    const triOutcomes = [...outcomeVenueRows.entries()]
      .filter(([, venueMap]) => ALLOWED_VENUES.every((venue) => venueMap.has(venue)))
      .map(([outcome]) => outcome)
      .sort((left, right) => left.localeCompare(right));

    if (triOutcomes.length > 0) {
      for (const outcome of triOutcomes) {
        triLanes.push({
          canonicalTopicKey: TOPIC_KEY,
          canonicalTriVenueSet: TRI_VENUE_SET,
          outcomeIdentityKey: toOutcomeIdentityKey(outcome),
          normalizedOutcomeName: outcome,
          routeabilityDecision: triRouteability,
          rulesDecision: ruleStatus,
          matcherReady: true,
          evidenceSources: EVIDENCE_SOURCES,
          evidence: triRows.map((row) => ({
            venue: row.venue as AllowedVenue,
            venueMarketId: row.venueMarketId,
            rawOutcomeLabel: outcome
          })),
          notes: buildTriNotes(ruleStatus)
        });
      }

      for (const [outcome, venueMap] of outcomeVenueRows.entries()) {
        if (venueMap.size < 3) {
          rejections.push({
            scope: "outcome",
            outcomeIdentityKey: toOutcomeIdentityKey(outcome),
            normalizedOutcomeName: outcome,
            venueSet: TRI_VENUE_SET,
            reason: "TRI_EDGE_MISSING",
            notes: `Outcome ${outcome} is not shared across all of OPINION, POLYMARKET, and PREDICT.`
          });
        }
      }
    } else {
      rejections.push({
        scope: "tri_lane",
        venueSet: TRI_VENUE_SET,
        reason: "TRI_EDGE_MISSING",
        notes: `No shared named outcome survived the strict 3-venue party-control intersection for ${TOPIC_KEY}.`
      });
    }
  } else if (triRows.length < 3) {
    rejections.push({
      scope: "tri_lane",
      venueSet: TRI_VENUE_SET,
      reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
      notes: `Strict tri evaluation is blocked because not all of OPINION, POLYMARKET, and PREDICT are freshly admitted for ${TOPIC_KEY}.`
    });
  } else {
    rejections.push({
      scope: "tri_lane",
      venueSet: TRI_VENUE_SET,
      reason: "RULE_MISMATCH",
      notes: `Rule state ${ruleStatus} blocks exact-safe party-control tri construction.`
    });
  }

  if (topicSummary) {
    for (const outcome of topicSummary.excludedOutcomes) {
      rejections.push({
        scope: "outcome",
        outcomeIdentityKey:
          outcome.reason === "OTHERS_EXCLUDED" || outcome.reason === "UNKNOWN_COMPOSITE"
            ? null
            : toOutcomeIdentityKey(outcome.label),
        normalizedOutcomeName: outcome.label,
        reason:
          outcome.reason === "OTHERS_EXCLUDED"
            ? "OTHERS_EXCLUDED"
            : outcome.reason === "UNKNOWN_COMPOSITE"
              ? "UNKNOWN_COMPOSITE"
              : "NOT_SHARED",
        notes:
          outcome.reason === "OTHERS_EXCLUDED"
            ? `Outcome ${outcome.label} is excluded by shared-core policy.`
            : outcome.reason === "UNKNOWN_COMPOSITE"
              ? `Outcome ${outcome.label} is excluded because it is unknown or composite.`
              : `Outcome ${outcome.label} is not part of the exact shared party-control core.`
      });
    }
  } else {
    rejections.push({
      scope: "pair_lane",
      venueSet: TRI_VENUE_SET,
      reason: "OUT_OF_SCOPE_TOPIC",
      notes: `${TOPIC_KEY} was not present in the current party-control comparability summary.`
    });
  }

  const pairCounts = new Map<PairVenueSet, number>();
  for (const lane of pairLanes) {
    pairCounts.set(lane.venuePair, (pairCounts.get(lane.venuePair) ?? 0) + 1);
  }

  const bestPair =
    [...pairCounts.entries()]
      .sort((left, right) =>
        (right[1] - left[1])
        || (PAIR_PRIORITY.indexOf(left[0]) - PAIR_PRIORITY.indexOf(right[0]))
      )[0]?.[0] ?? null;
  const bestPairCandidateCount = bestPair ? (pairCounts.get(bestPair) ?? 0) : 0;
  const exactSafeTriCandidateCount = triLanes.length;
  const pairMatcherReady = pairLanes.length > 0;
  const triMatcherReady = triLanes.length > 0;
  const reviewOnly =
    (pairLanes.length > 0 && pairLanes.every((lane) => lane.routeabilityDecision === "PAIR_REVIEW_REQUIRED"))
    || (triLanes.length > 0 && triLanes.every((lane) => lane.routeabilityDecision === "TRI_REVIEW_REQUIRED"));

  const overallDecision: PoliticsPartyControlBalanceOfPower2026MatcherFinalDecision["overallDecision"] =
    triMatcherReady
      ? reviewOnly
        ? "PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_REVIEW_REQUIRED"
        : "PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_READY_BUT_PAIR_FIRST"
      : pairMatcherReady
        ? reviewOnly
          ? "PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_MATCHER_READY"
        : topicSummary && admittedVenues.length >= 2
          ? "PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_NOT_JUSTIFIED_PAIR_ONLY"
          : "PARTY_CONTROL_BALANCE_OF_POWER_2026_MATCHER_NOT_READY";

  return {
    canonicalTopicKey: TOPIC_KEY,
    admittedVenues,
    admittedOutcomes,
    pairLanes: pairLanes.sort((left, right) =>
      left.venuePair.localeCompare(right.venuePair) || left.outcomeIdentityKey.localeCompare(right.outcomeIdentityKey)
    ),
    triLanes: triLanes.sort((left, right) => left.outcomeIdentityKey.localeCompare(right.outcomeIdentityKey)),
    rejections: rejections.sort((left, right) =>
      left.scope.localeCompare(right.scope)
      || (left.venuePair ?? "").localeCompare(right.venuePair ?? "")
      || (left.venueSet ?? "").localeCompare(right.venueSet ?? "")
      || (left.venue ?? "").localeCompare(right.venue ?? "")
      || (left.outcomeIdentityKey ?? "").localeCompare(right.outcomeIdentityKey ?? "")
      || left.reason.localeCompare(right.reason)
    ),
    finalDecision: {
      overallDecision,
      bestPair,
      bestTriIfAny: triMatcherReady ? TRI_VENUE_SET : null,
      pairMatcherReady,
      triMatcherReady,
      pairStillPreferred: true,
      exactSafePairCandidateCount: bestPairCandidateCount,
      exactSafeTriCandidateCount,
      ruleStatus,
      operatorCredible: topicSummary !== null && admittedVenues.length >= 2,
      matcherFollowUpJustified: pairMatcherReady || triMatcherReady,
      singleBestNextAction:
        triMatcherReady
          ? `Start with narrow pair-first operator review on ${bestPair ?? "the best pair"}, while preserving the strict tri lane ${TRI_VENUE_SET} for follow-up.`
          : pairMatcherReady
            ? `Start narrow operator review on the best party-control pair lane ${bestPair ?? "unknown"} and do not assume tri until OPINION, POLYMARKET, and PREDICT keep a strict shared core.`
            : `Hold ${TOPIC_KEY} until fresh party-control evidence produces a real admitted pair lane.`
    }
  };
};
