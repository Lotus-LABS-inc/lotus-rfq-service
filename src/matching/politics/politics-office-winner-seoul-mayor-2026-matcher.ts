import type {
  PoliticsNomineeRuleCompatibilityClass,
  PoliticsOfficeWinnerSeoulMayor2026MatcherFinalDecision,
  PoliticsOfficeWinnerSeoulMayor2026MatcherRejection,
  PoliticsOfficeWinnerSeoulMayor2026PairLane,
  PoliticsOfficeWinnerSeoulMayor2026TriLane
} from "./politics-types.js";
import type {
  PoliticsOfficeWinnerComparabilityTopicSummary,
  PoliticsOfficeWinnerNormalizedTopicRow
} from "./politics-office-winner-family-pass.js";

const TOPIC_KEY = "OFFICE_WINNER|SEOUL|MAYOR|2026" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;
const ALLOWED_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET"] as const;
const EXCLUDED_VENUES = ["MYRIAD", "PREDICT"] as const;
const EVIDENCE_SOURCES = [
  "artifacts/politics/office-winner-family-pass/politics-office-winner-fetch-summary.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-admission-summary.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-normalized-topics.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-comparability-summary.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-basis-fragmentation-summary.json",
  "artifacts/politics/office-winner-family-pass/politics-office-winner-final-decision.json"
] as const;

const PAIR_PRIORITY = ["LIMITLESS|OPINION", "LIMITLESS|POLYMARKET", "OPINION|POLYMARKET"] as const;

type AllowedVenue = (typeof ALLOWED_VENUES)[number];
type PairVenueSet = (typeof PAIR_PRIORITY)[number];

export interface PoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization {
  canonicalTopicKey: typeof TOPIC_KEY;
  admittedVenues: readonly string[];
  admittedCandidates: readonly string[];
  pairLanes: readonly PoliticsOfficeWinnerSeoulMayor2026PairLane[];
  triLanes: readonly PoliticsOfficeWinnerSeoulMayor2026TriLane[];
  rejections: readonly PoliticsOfficeWinnerSeoulMayor2026MatcherRejection[];
  finalDecision: PoliticsOfficeWinnerSeoulMayor2026MatcherFinalDecision;
}

const normalizeCandidateName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[`'".,()/:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toCandidateIdentityKey = (value: string): string =>
  normalizeCandidateName(value).replace(/\s+/g, "_");

const getPairKey = (left: AllowedVenue, right: AllowedVenue): PairVenueSet =>
  ([left, right].sort((a, b) => a.localeCompare(b)).join("|") as PairVenueSet);

const mapRuleToPairRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsOfficeWinnerSeoulMayor2026PairLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? "PAIR_EXACT_AUTO_ROUTEABLE"
    : ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING" || ruleStatus === "REVIEW_REQUIRED_RULE_VARIANCE"
      ? "PAIR_REVIEW_REQUIRED"
      : "PAIR_REJECTED";

const mapRuleToTriRouteability = (
  ruleStatus: PoliticsNomineeRuleCompatibilityClass
): PoliticsOfficeWinnerSeoulMayor2026TriLane["routeabilityDecision"] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? "TRI_EXACT_AUTO_ROUTEABLE"
    : ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING" || ruleStatus === "REVIEW_REQUIRED_RULE_VARIANCE"
      ? "TRI_REVIEW_REQUIRED"
      : "TRI_REJECTED";

const findCandidateRawLabel = (
  row: PoliticsOfficeWinnerNormalizedTopicRow,
  normalizedCandidateName: string
): string | null => {
  const match = row.candidateSet.find((candidate) => normalizeCandidateName(candidate) === normalizedCandidateName);
  return match ?? null;
};

const pickBestRowPerVenue = (
  rows: readonly PoliticsOfficeWinnerNormalizedTopicRow[]
): readonly PoliticsOfficeWinnerNormalizedTopicRow[] =>
  [...new Map(
    rows.map((row) => [row.venue, row] as const)
  ).entries()].map(([venue]) =>
    rows
      .filter((row) => row.venue === venue)
      .sort((left, right) =>
        (right.candidateSet.length - left.candidateSet.length)
        || left.venueMarketId.localeCompare(right.venueMarketId)
      )[0]!
  );

const buildPairNotes = (ruleStatus: PoliticsNomineeRuleCompatibilityClass, venuePair: PairVenueSet): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? [`Exact-safe office-winner shared candidate on ${venuePair}.`]
    : [
      `Candidate is shared across ${venuePair}, but rule wording is semantically compatible rather than exact.`,
      "Operator review is required before treating this office-winner pair lane as exact-safe."
    ];

const buildTriNotes = (ruleStatus: PoliticsNomineeRuleCompatibilityClass): readonly string[] =>
  ruleStatus === "EXACT_RULE_COMPATIBLE"
    ? ["Exact-safe office-winner strict 3-venue candidate on LIMITLESS|OPINION|POLYMARKET."]
    : [
      "Candidate survives the strict 3-venue intersection, but rule wording is semantically compatible rather than exact.",
      "Operator review is required before treating this office-winner tri lane as exact-safe."
    ];

export const buildPoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization = (input: {
  normalizedTopics: readonly PoliticsOfficeWinnerNormalizedTopicRow[];
  comparabilitySummary: readonly PoliticsOfficeWinnerComparabilityTopicSummary[];
}): PoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization => {
  const topicSummary = input.comparabilitySummary.find((summary) => summary.canonicalTopicKey === TOPIC_KEY) ?? null;
  const topicRows = input.normalizedTopics.filter((row) => row.canonicalTopicKey === TOPIC_KEY);
  const allowedRows = pickBestRowPerVenue(
    topicRows.filter((row) =>
      ALLOWED_VENUES.includes(row.venue as AllowedVenue)
    ) as readonly PoliticsOfficeWinnerNormalizedTopicRow[]
  );
  const admittedVenues = [...new Set(allowedRows.map((row) => row.venue))].sort();
  const ruleStatus = topicSummary?.ruleCompatibilityClassification ?? "UNKNOWN_RULE_MEANING";
  const pairRouteability = mapRuleToPairRouteability(ruleStatus);
  const triRouteability = mapRuleToTriRouteability(ruleStatus);
  const rejections: PoliticsOfficeWinnerSeoulMayor2026MatcherRejection[] = [];

  for (const venue of EXCLUDED_VENUES) {
    rejections.push({
      scope: "venue",
      venue,
      venueSet: TRI_VENUE_SET,
      reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
      notes: `${venue} is not part of the freshly admitted venue truth for ${TOPIC_KEY}.`
    });
  }

  const candidateVenueRows = new Map<string, Map<AllowedVenue, PoliticsOfficeWinnerNormalizedTopicRow>>();
  for (const row of allowedRows) {
    for (const candidate of row.candidateSet) {
      const normalizedCandidate = normalizeCandidateName(candidate as string);
      if (!normalizedCandidate || normalizedCandidate === "other") {
        continue;
      }
      const venueMap = candidateVenueRows.get(normalizedCandidate) ?? new Map<AllowedVenue, PoliticsOfficeWinnerNormalizedTopicRow>();
      venueMap.set(row.venue as AllowedVenue, row);
      candidateVenueRows.set(normalizedCandidate, venueMap);
    }
  }

  const pairLanes: PoliticsOfficeWinnerSeoulMayor2026PairLane[] = [];
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
        notes: `Rule state ${ruleStatus} blocks exact-safe Seoul office-winner pair construction on ${venuePair}.`
      });
      continue;
    }

    const sharedCandidates = [...candidateVenueRows.entries()]
      .filter(([, venueMap]) => venueMap.has(leftVenue) && venueMap.has(rightVenue))
      .map(([candidate]) => candidate)
      .sort((left, right) => left.localeCompare(right));

    if (sharedCandidates.length === 0) {
      rejections.push({
        scope: "pair_lane",
        venuePair,
        reason: "PAIR_EDGE_MISSING",
        notes: `No shared named candidate survived on ${venuePair} for ${TOPIC_KEY}.`
      });
      continue;
    }

    for (const candidate of sharedCandidates) {
      const leftLabel = findCandidateRawLabel(leftRow, candidate);
      const rightLabel = findCandidateRawLabel(rightRow, candidate);
      if (!leftLabel || !rightLabel) {
        rejections.push({
          scope: "candidate",
          candidateIdentityKey: toCandidateIdentityKey(candidate),
          normalizedCandidateName: candidate,
          venuePair,
          reason: "PAIR_EDGE_MISSING",
          notes: `Candidate ${candidate} did not survive with explicit evidence on both venues in ${venuePair}.`
        });
        continue;
      }
      pairLanes.push({
        canonicalTopicKey: TOPIC_KEY,
        venuePair,
        candidateIdentityKey: toCandidateIdentityKey(candidate),
        normalizedCandidateName: candidate,
        routeabilityDecision: pairRouteability,
        rulesDecision: ruleStatus,
        matcherReady: true,
        evidenceSources: EVIDENCE_SOURCES,
        evidence: [
          { venue: leftVenue, venueMarketId: leftRow.venueMarketId, rawOutcomeLabel: leftLabel },
          { venue: rightVenue, venueMarketId: rightRow.venueMarketId, rawOutcomeLabel: rightLabel }
        ],
        notes: buildPairNotes(ruleStatus, venuePair)
      });
    }
  }

  const triLanes: PoliticsOfficeWinnerSeoulMayor2026TriLane[] = [];
  const triRows = ALLOWED_VENUES.map((venue) => allowedRows.find((row) => row.venue === venue)).filter(Boolean) as PoliticsOfficeWinnerNormalizedTopicRow[];
  if (triRows.length === 3 && triRouteability !== "TRI_REJECTED") {
    const triCandidates = [...candidateVenueRows.entries()]
      .filter(([, venueMap]) => ALLOWED_VENUES.every((venue) => venueMap.has(venue)))
      .map(([candidate]) => candidate)
      .sort((left, right) => left.localeCompare(right));

    if (triCandidates.length > 0) {
      for (const candidate of triCandidates) {
        const evidence = triRows
          .map((row) => {
            const rawOutcomeLabel = findCandidateRawLabel(row, candidate);
            return rawOutcomeLabel ? {
              venue: row.venue as AllowedVenue,
              venueMarketId: row.venueMarketId,
              rawOutcomeLabel
            } : null;
          })
          .filter((entry): entry is {
            venue: AllowedVenue;
            venueMarketId: string;
            rawOutcomeLabel: string;
          } => entry !== null);

        if (evidence.length !== 3) {
          rejections.push({
            scope: "candidate",
            candidateIdentityKey: toCandidateIdentityKey(candidate),
            normalizedCandidateName: candidate,
            venueSet: TRI_VENUE_SET,
            reason: "TRI_EDGE_MISSING",
            notes: `Candidate ${candidate} did not survive with explicit evidence across LIMITLESS, OPINION, and POLYMARKET.`
          });
          continue;
        }

        triLanes.push({
          canonicalTopicKey: TOPIC_KEY,
          canonicalTriVenueSet: TRI_VENUE_SET,
          candidateIdentityKey: toCandidateIdentityKey(candidate),
          normalizedCandidateName: candidate,
          routeabilityDecision: triRouteability,
          rulesDecision: ruleStatus,
          matcherReady: true,
          evidenceSources: EVIDENCE_SOURCES,
          evidence,
          notes: buildTriNotes(ruleStatus)
        });
      }
    } else {
      rejections.push({
        scope: "tri_lane",
        venueSet: TRI_VENUE_SET,
        reason: "TRI_EDGE_MISSING",
        notes: `No shared named candidate survived the strict 3-venue Seoul office-winner intersection.`
      });
    }
  } else if (triRows.length < 3) {
    rejections.push({
      scope: "tri_lane",
      venueSet: TRI_VENUE_SET,
      reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
      notes: `Strict Seoul tri evaluation is blocked because not all of LIMITLESS, OPINION, and POLYMARKET are freshly admitted for ${TOPIC_KEY}.`
    });
  } else {
    rejections.push({
      scope: "tri_lane",
      venueSet: TRI_VENUE_SET,
      reason: "RULE_MISMATCH",
      notes: `Rule state ${ruleStatus} blocks exact-safe Seoul office-winner tri construction.`
    });
  }

  if (topicSummary) {
    for (const outcome of topicSummary.excludedOutcomes) {
      rejections.push({
        scope: "candidate",
        candidateIdentityKey:
          outcome.reason === "UNKNOWN_COMPOSITE" || outcome.reason === "OTHERS_EXCLUDED"
            ? null
            : toCandidateIdentityKey(outcome.label),
        normalizedCandidateName: normalizeCandidateName(outcome.label),
        reason:
          outcome.reason === "OTHERS_EXCLUDED" ? "OTHERS_EXCLUDED"
          : outcome.reason === "UNKNOWN_COMPOSITE" ? "UNKNOWN_COMPOSITE"
          : "NOT_SHARED",
        notes:
          outcome.reason === "OTHERS_EXCLUDED"
            ? `Outcome ${outcome.label} is excluded by shared-core policy.`
            : outcome.reason === "UNKNOWN_COMPOSITE"
              ? `Outcome ${outcome.label} is excluded because it is unknown or composite.`
              : `Candidate ${outcome.label} is not part of the exact shared Seoul office-winner core.`
      });
    }
  } else {
    rejections.push({
      scope: "pair_lane",
      venueSet: TRI_VENUE_SET,
      reason: "OUT_OF_SCOPE_TOPIC",
      notes: `${TOPIC_KEY} was not present in the current office-winner comparability summary.`
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

  const overallDecision: PoliticsOfficeWinnerSeoulMayor2026MatcherFinalDecision["overallDecision"] =
    triMatcherReady
      ? reviewOnly
        ? "OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_REVIEW_REQUIRED"
        : "OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_READY_BUT_PAIR_FIRST"
      : pairMatcherReady
        ? reviewOnly
          ? "OFFICE_WINNER_SEOUL_MAYOR_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
          : "OFFICE_WINNER_SEOUL_MAYOR_2026_PAIR_MATCHER_READY"
        : topicSummary && admittedVenues.length >= 2
          ? "OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_NOT_JUSTIFIED_PAIR_ONLY"
          : "OFFICE_WINNER_SEOUL_MAYOR_2026_MATCHER_NOT_READY";

  return {
    canonicalTopicKey: TOPIC_KEY,
    admittedVenues,
    admittedCandidates: [...new Set(pairLanes.map((lane) => lane.candidateIdentityKey))].sort(),
    pairLanes: pairLanes.sort((left, right) =>
      left.venuePair.localeCompare(right.venuePair) || left.candidateIdentityKey.localeCompare(right.candidateIdentityKey)
    ),
    triLanes: triLanes.sort((left, right) => left.candidateIdentityKey.localeCompare(right.candidateIdentityKey)),
    rejections: rejections.sort((left, right) =>
      left.scope.localeCompare(right.scope)
      || (left.venuePair ?? "").localeCompare(right.venuePair ?? "")
      || (left.venueSet ?? "").localeCompare(right.venueSet ?? "")
      || (left.venue ?? "").localeCompare(right.venue ?? "")
      || (left.candidateIdentityKey ?? "").localeCompare(right.candidateIdentityKey ?? "")
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
          ? `Review the strict Seoul tri lane ${TRI_VENUE_SET} before any readiness follow-up, while keeping ${bestPair ?? "the best pair"} as the safer fallback.`
          : pairMatcherReady
            ? `Start narrow operator review on the best Seoul pair lane ${bestPair ?? "unknown"} and do not assume tri until POLYMARKET, LIMITLESS, and OPINION share an exact-safe core.`
            : `Hold ${TOPIC_KEY} until fresh Seoul office-winner evidence produces a real admitted pair lane.`
    }
  };
};
