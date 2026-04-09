import type {
  PoliticsGeopoliticalTrumpVisitChina20260430MatcherFinalDecision,
  PoliticsGeopoliticalTrumpVisitChina20260430MatcherRejection,
  PoliticsGeopoliticalTrumpVisitChina20260430PairLane,
  PoliticsGeopoliticalTrumpVisitChina20260430TriLane,
  PoliticsNomineeRuleCompatibilityClass
} from "./politics-types.js";
import type {
  PoliticsGeopoliticalTrumpVisitChinaTopicSummary
} from "./politics-geopolitical-trump-visit-china-family-pass.js";

const TOPIC_KEY = "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30" as const;
const PROPOSITION_IDENTITY_KEY = "TRUMP_VISIT_CHINA_BY_2026_04_30" as const;
const NORMALIZED_PROPOSITION_NAME = "trump_visit_china_by_2026_04_30" as const;
const TRI_VENUE_SET = "OPINION|POLYMARKET|PREDICT" as const;
const ALLOWED_VENUES = ["OPINION", "POLYMARKET", "PREDICT"] as const;
const EXCLUDED_VENUES = ["LIMITLESS", "MYRIAD"] as const;
const PAIR_PRIORITY = ["OPINION|POLYMARKET", "OPINION|PREDICT", "POLYMARKET|PREDICT"] as const;
const EVIDENCE_SOURCES = [
  "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-fetch-summary.json",
  "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-admission-summary.json",
  "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-normalized-topics.json",
  "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-comparability-summary.json",
  "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-basis-fragmentation-summary.json",
  "artifacts/politics/geopolitical-trump-visit-china-family-pass/politics-geopolitical-trump-visit-china-final-decision.json"
] as const;

type AllowedVenue = (typeof ALLOWED_VENUES)[number];
type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface PoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly string[];
  pairLanes: readonly PoliticsGeopoliticalTrumpVisitChina20260430PairLane[];
  triLanes: readonly PoliticsGeopoliticalTrumpVisitChina20260430TriLane[];
  rejections: readonly PoliticsGeopoliticalTrumpVisitChina20260430MatcherRejection[];
  finalDecision: PoliticsGeopoliticalTrumpVisitChina20260430MatcherFinalDecision;
}

const mapComparabilityToRuleStatus = (
  comparabilityLabel: PoliticsGeopoliticalTrumpVisitChinaTopicSummary["comparabilityLabel"]
): PoliticsNomineeRuleCompatibilityClass =>
  comparabilityLabel === "EXACT_COMPARABLE"
    ? "EXACT_RULE_COMPATIBLE"
    : comparabilityLabel === "NARROW_COMPARABLE"
      ? "SEMANTICALLY_COMPATIBLE_REWORDING"
      : "UNKNOWN_RULE_MEANING";

const mapRuleToPairRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsGeopoliticalTrumpVisitChina20260430PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? "PAIR_EXACT_AUTO_ROUTEABLE"
    : ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING" || ruleStatus === "REVIEW_REQUIRED_RULE_VARIANCE"
      ? "PAIR_REVIEW_REQUIRED"
      : "PAIR_REJECTED";

const mapRuleToTriRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsGeopoliticalTrumpVisitChina20260430TriLane["routeabilityDecision"] =>
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
    ? [`Exact-safe geopolitical event-by-date proposition on ${venuePair}.`]
    : [
      `Geopolitical proposition is shared on ${venuePair}, but rule wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this pair lane as exact-safe."
    ];

const buildTriNotes = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe strict 3-venue geopolitical proposition on OPINION|POLYMARKET|PREDICT."]
    : [
      "Geopolitical proposition survives the strict 3-venue intersection, but rule wording is semantically compatible rather than exact.",
      "Operator review is required before treating this tri lane as exact-safe."
    ];

export const buildPoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization = (input: {
  comparabilitySummary: readonly PoliticsGeopoliticalTrumpVisitChinaTopicSummary[];
}): PoliticsGeopoliticalTrumpVisitChina20260430MatcherMaterialization => {
  const topicSummary = input.comparabilitySummary.find((summary) => summary.topicKey === TOPIC_KEY) ?? null;
  const admittedVenues = topicSummary?.venuesPresent ?? [];
  const ruleStatus = mapComparabilityToRuleStatus(topicSummary?.comparabilityLabel ?? "FRAGMENTED");
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);
  const triRouteability = mapRuleToTriRouteability(ruleStatus);
  const rejections: PoliticsGeopoliticalTrumpVisitChina20260430MatcherRejection[] = [];

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

  const pairLanes: PoliticsGeopoliticalTrumpVisitChina20260430PairLane[] = [];
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

  const triLanes: PoliticsGeopoliticalTrumpVisitChina20260430TriLane[] = [];
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
      notes: `Strict tri evaluation is blocked because not all of OPINION, POLYMARKET, and PREDICT are freshly admitted for ${TOPIC_KEY}.`
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

  const overallDecision: PoliticsGeopoliticalTrumpVisitChina20260430MatcherFinalDecision["overallDecision"] =
    triMatcherReady
      ? reviewOnly
        ? "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_REVIEW_REQUIRED"
        : "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_READY_BUT_PAIR_FIRST"
      : pairMatcherReady
        ? reviewOnly
          ? "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_MATCHER_READY"
        : topicSummary
          && admittedVenues.length >= 2
          && ruleStatus !== "RULES_MATERIALLY_INCOMPATIBLE"
          && ruleStatus !== "UNKNOWN_RULE_MEANING"
          ? "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_NOT_JUSTIFIED_PAIR_ONLY"
          : "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_MATCHER_NOT_READY";

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
            ? `Start narrow review on the best geopolitical pair lane ${bestPair ?? "unknown"} and do not assume tri until OPINION, POLYMARKET, and PREDICT remain freshly admitted.`
            : `Hold ${TOPIC_KEY} until fresh geopolitical evidence produces a real admitted pair lane.`
    }
  };
};
