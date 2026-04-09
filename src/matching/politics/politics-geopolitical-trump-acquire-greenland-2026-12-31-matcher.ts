import type {
  PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherFinalDecision,
  PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherRejection,
  PoliticsGeopoliticalTrumpAcquireGreenland20261231PairLane,
  PoliticsGeopoliticalTrumpAcquireGreenland20261231TriLane,
  PoliticsNomineeRuleCompatibilityClass
} from "./politics-types.js";
import type {
  PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary
} from "./politics-geopolitical-trump-acquire-greenland-family-pass.js";

const TOPIC_KEY = "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31" as const;
const PROPOSITION_IDENTITY_KEY = "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31" as const;
const NORMALIZED_PROPOSITION_NAME = "trump_acquire_greenland_by_2026_12_31" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET|PREDICT" as const;
const ALLOWED_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;
const EXCLUDED_VENUES = ["MYRIAD"] as const;
const PAIR_PRIORITY = [
  "LIMITLESS|POLYMARKET",
  "LIMITLESS|OPINION",
  "LIMITLESS|PREDICT",
  "OPINION|POLYMARKET",
  "OPINION|PREDICT",
  "POLYMARKET|PREDICT"
] as const;
const EVIDENCE_SOURCES = [
  "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-fetch-summary.json",
  "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-admission-summary.json",
  "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-normalized-topics.json",
  "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-comparability-summary.json",
  "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-basis-fragmentation-summary.json",
  "artifacts/politics/geopolitical-trump-acquire-greenland-family-pass/politics-geopolitical-trump-acquire-greenland-final-decision.json"
] as const;

type AllowedVenue = (typeof ALLOWED_VENUES)[number];
type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly string[];
  pairLanes: readonly PoliticsGeopoliticalTrumpAcquireGreenland20261231PairLane[];
  triLanes: readonly PoliticsGeopoliticalTrumpAcquireGreenland20261231TriLane[];
  rejections: readonly PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherRejection[];
  finalDecision: PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherFinalDecision;
}

const mapComparabilityToRuleStatus = (
  comparabilityLabel: PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary["comparabilityLabel"]
): PoliticsNomineeRuleCompatibilityClass =>
  comparabilityLabel === "EXACT_COMPARABLE"
    ? "EXACT_RULE_COMPATIBLE"
    : comparabilityLabel === "NARROW_COMPARABLE"
      ? "SEMANTICALLY_COMPATIBLE_REWORDING"
      : "UNKNOWN_RULE_MEANING";

const mapRuleToPairRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsGeopoliticalTrumpAcquireGreenland20261231PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? "PAIR_EXACT_AUTO_ROUTEABLE"
    : ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING" || ruleStatus === "REVIEW_REQUIRED_RULE_VARIANCE"
      ? "PAIR_REVIEW_REQUIRED"
      : "PAIR_REJECTED";

const mapRuleToTriRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsGeopoliticalTrumpAcquireGreenland20261231TriLane["routeabilityDecision"] =>
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
    ? [`Exact-safe Greenland-acquisition proposition on ${venuePair}.`]
    : [
      `Greenland-acquisition proposition is shared on ${venuePair}, but one venue uses narrower 'part of Greenland' wording.`,
      "Operator review is required before treating this pair lane as exact-safe."
    ];

const buildTriNotes = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe strict 4-venue geopolitical proposition on LIMITLESS|OPINION|POLYMARKET|PREDICT."]
    : [
      "Geopolitical proposition survives the strict 4-venue intersection, but one venue uses narrower 'part of Greenland' wording.",
      "Operator review is required before treating this tri lane as exact-safe."
    ];

export const buildPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization = (input: {
  comparabilitySummary: readonly PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary[];
}): PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherMaterialization => {
  const topicSummary = input.comparabilitySummary.find((summary) => summary.topicKey === TOPIC_KEY) ?? null;
  const admittedVenues = topicSummary?.venuesPresent ?? [];
  const ruleStatus = mapComparabilityToRuleStatus(topicSummary?.comparabilityLabel ?? "FRAGMENTED");
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);
  const triRouteability = mapRuleToTriRouteability(ruleStatus);
  const rejections: PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherRejection[] = [];

  for (const venue of EXCLUDED_VENUES) {
    rejections.push({
      scope: "venue",
      venue,
      venueSet: TRI_VENUE_SET,
      reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
      notes: `${venue} is not part of the freshly admitted venue truth for ${TOPIC_KEY}.`
    });
  }

  const sourceRowsByVenue = new Map(
    (topicSummary?.sourceRows ?? []).map((row) => [row.venue, row] as const)
  );

  const pairLanes: PoliticsGeopoliticalTrumpAcquireGreenland20261231PairLane[] = [];
  for (const venuePair of PAIR_PRIORITY) {
    const [leftVenue, rightVenue] = venuePair.split("|") as [AllowedVenue, AllowedVenue];
    const leftRow = sourceRowsByVenue.get(leftVenue);
    const rightRow = sourceRowsByVenue.get(rightVenue);

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
        notes: `Rule state ${ruleStatus} blocks exact-safe geopolitical pair construction on ${venuePair}.`
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

  const triLanes: PoliticsGeopoliticalTrumpAcquireGreenland20261231TriLane[] = [];
  if (ALLOWED_VENUES.every((venue) => sourceRowsByVenue.has(venue))) {
    if (triRouteability === "TRI_REJECTED") {
      rejections.push({
        scope: "tri_lane",
        venueSet: TRI_VENUE_SET,
        reason: "RULE_MISMATCH",
        notes: `Rule state ${ruleStatus} blocks exact-safe geopolitical tri construction.`
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
        evidence: ALLOWED_VENUES.map((venue) => {
          const row = sourceRowsByVenue.get(venue)!;
          return { venue, venueMarketId: row.venueMarketId, title: row.title };
        }),
        notes: buildTriNotes(ruleStatus)
      });
    }
  } else {
    rejections.push({
      scope: "tri_lane",
      venueSet: TRI_VENUE_SET,
      reason: "TRI_EDGE_MISSING",
      notes: `Strict tri evaluation is blocked because not all of ${ALLOWED_VENUES.join(", ")} are freshly admitted for ${TOPIC_KEY}.`
    });
  }

  if (!topicSummary) {
    rejections.push({
      scope: "pair_lane",
      venueSet: TRI_VENUE_SET,
      reason: "OUT_OF_SCOPE_TOPIC",
      notes: `${TOPIC_KEY} was not present in the current geopolitical comparability summary.`
    });
  }

  const bestPair = pairLanes.length > 0
    ? PAIR_PRIORITY.find((pair) => pairLanes.some((lane) => lane.venuePair === pair)) ?? null
    : null;
  const pairMatcherReady = pairLanes.length > 0;
  const triMatcherReady = triLanes.length > 0;
  const reviewOnly =
    (pairMatcherReady && pairLanes.every((lane) => lane.routeabilityDecision === "PAIR_REVIEW_REQUIRED"))
    || (triMatcherReady && triLanes.every((lane) => lane.routeabilityDecision === "TRI_REVIEW_REQUIRED"));

  const overallDecision: PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherFinalDecision["overallDecision"] =
    triMatcherReady
      ? reviewOnly
        ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_REVIEW_REQUIRED"
        : "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_READY_BUT_PAIR_FIRST"
      : pairMatcherReady
        ? reviewOnly
          ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_MATCHER_READY"
        : topicSummary
          && admittedVenues.length >= 2
          && ruleStatus !== "RULES_MATERIALLY_INCOMPATIBLE"
          && ruleStatus !== "UNKNOWN_RULE_MEANING"
          ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_NOT_JUSTIFIED_PAIR_ONLY"
          : "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_MATCHER_NOT_READY";

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
          ? `Start narrow pair-first review on ${bestPair ?? "the best pair"}, while preserving the strict tri lane ${TRI_VENUE_SET} as a first-class route.`
          : pairMatcherReady
            ? `Start narrow review on the best geopolitical pair lane ${bestPair ?? "unknown"} and do not assume tri until LIMITLESS, OPINION, POLYMARKET, and PREDICT remain freshly admitted.`
            : `Hold ${TOPIC_KEY} until fresh geopolitical evidence produces a real admitted pair lane.`
    }
  };
};
