import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type {
  PoliticsExtractedRow,
  PoliticsNomineeOutcomeRouteabilityClass,
  PoliticsNomineeRuleCompatibilityClass,
  PoliticsNomineeSharedCoreMarketRow,
  PoliticsNomineeSharedCoreOutcomeRow,
  PoliticsNomineeTopicDecision,
  PoliticsNomineeTopicKey
} from "./politics-types.js";
import { admitNominee2028Row, type PoliticsNominee2028FetchStatus } from "./politics-nominee-2028-cluster.js";

type DerivedRuleMeaning =
  | "NOMINEE_WINNER"
  | "NOMINEE_WINNER_ACCEPTS"
  | "PRIMARY_WINNER"
  | "MATERIALLY_INCOMPATIBLE"
  | "UNKNOWN";

export interface PoliticsNomineeSharedCoreRejectedMarket {
  venue: string;
  venueMarketId: string;
  title: string;
  rejectionReason: string;
}

interface PoliticsNomineeDerivedRuleProfile {
  topicKey: PoliticsNomineeTopicKey;
  venue: PoliticsNomineeSharedCoreMarketRow["venue"];
  derivedMeaning: DerivedRuleMeaning;
  sourceType: string;
  titles: readonly string[];
}

export interface PoliticsNomineeSharedCoreTopicOutcomeSummary {
  topicKey: PoliticsNomineeTopicKey;
  triSharedNamedOutcomes: readonly PoliticsNomineeSharedCoreOutcomeRow[];
  pairSharedNamedOutcomes: readonly PoliticsNomineeSharedCoreOutcomeRow[];
  singleVenueOnlyOutcomes: readonly PoliticsNomineeSharedCoreOutcomeRow[];
  excludedOutcomes: readonly PoliticsNomineeSharedCoreOutcomeRow[];
}

export interface PoliticsNomineeSharedCoreTopicDecisionSummary {
  topicKey: PoliticsNomineeTopicKey;
  topicDecision: PoliticsNomineeTopicDecision;
  ruleDecision: PoliticsNomineeRuleCompatibilityClass | "MIXED";
  sharedNamedOutcomeCount: number;
  triSharedNamedOutcomeCount: number;
  pairSharedNamedOutcomeCount: number;
  excludedTailCount: number;
  othersExcluded: boolean;
  exactAutoRouteable: boolean;
  reviewRequiredRouteable: boolean;
  matcherEvalJustified: boolean;
}

const TOPIC_KEYS: readonly PoliticsNomineeTopicKey[] = [
  "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC"
] as const;

const OTHERS_PATTERN = /\b(other|others|any other|rest of field|field|someone else)\b/i;
const COMPOSITE_PATTERN = /\b(no one|none|not listed|all of the above)\b/i;

const normalizeCandidateName = (value: string): string | null => {
  const normalized = normalizeFreeText(value)
    .normalize("NFKD")
    .replace(/[`'".,()/:-]/g, " ")
    .replace(/\b(jr|sr)\.?\b/g, " $1 ")
    .replace(/\b(the|gov|governor|sen|senator|rep|representative|president|vice president|vp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= 1) {
    return null;
  }

  const collapsedInitials = normalized
    .split(" ")
    .reduce<string[]>((accumulator, token) => {
      if (token.length === 1 && accumulator.length > 0 && accumulator[accumulator.length - 1]!.length === 1) {
        accumulator[accumulator.length - 1] = `${accumulator[accumulator.length - 1]}${token}`;
        return accumulator;
      }
      accumulator.push(token);
      return accumulator;
    }, [])
    .join(" ");

  return collapsedInitials.length > 1 ? collapsedInitials : null;
};

const toCandidateIdentityKey = (value: string | null): string | null =>
  value ? value.replace(/\s+/g, "_") : null;

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const deriveBinaryNomineeCandidateLabel = (row: PoliticsExtractedRow): string | null => {
  if (row.candidateNames.length === 1) {
    return row.candidateNames[0] ?? null;
  }

  const title = row.title.trim();
  const patterns: readonly RegExp[] = [
    /^will\s+(.+?)\s+win\s+the\s+2028\s+(?:republican|democratic)\s+presidential\s+nomination\??$/i,
    /^will\s+(.+?)\s+be(?:come)?\s+the\s+2028\s+(?:republican|democratic)\s+presidential\s+nominee\??$/i,
    /^will\s+(.+?)\s+win\s+the\s+2028\s+(?:republican|democratic)\s+nomination\s+for\s+u\.?s\.?\s+president\??$/i,
    /^will\s+(.+?)\s+be(?:come)?\s+the\s+(?:republican|democratic)\s+nominee\s+for\s+u\.?s\.?\s+president\s+in\s+2028\??$/i
  ];

  for (const pattern of patterns) {
    const matched = title.match(pattern)?.[1]?.trim();
    if (matched) {
      return matched;
    }
  }

  const ruleText = `${row.rulesText ?? ""} ${row.title}`.trim();
  const ruleMatch = ruleText.match(/\bif\s+(.+?)\s+wins\s+the\s+2028\s+(?:republican|democratic)\s+(?:presidential\s+)?nomination\b/i)?.[1]?.trim();
  return ruleMatch ?? null;
};

const buildRuleText = (row: PoliticsExtractedRow): string =>
  `${row.title} ${row.rulesText ?? ""} ${row.resolutionBasisHints.join(" ")}`.trim().toLowerCase();

const deriveRuleMeaning = (row: PoliticsExtractedRow): DerivedRuleMeaning => {
  const text = buildRuleText(row);
  if (!text) {
    return "UNKNOWN";
  }
  if (/\bgeneral election\b|\bwin the presidency\b|\bwin the 2028 election\b/.test(text)) {
    return "MATERIALLY_INCOMPATIBLE";
  }
  if (/\bprimary\b|\bcaucus\b/.test(text) && !/\bnominee\b|\bnomination\b/.test(text)) {
    return "PRIMARY_WINNER";
  }
  if (/\bnominee\b|\bnomination\b/.test(text)) {
    return /\baccept(?:s|ed|ing)?\b/.test(text) ? "NOMINEE_WINNER_ACCEPTS" : "NOMINEE_WINNER";
  }
  return "UNKNOWN";
};

const toResolutionSourceType = (row: PoliticsExtractedRow): string =>
  row.rulesText && row.rulesText.trim().length > 0 ? "TITLE_AND_RULES"
  : row.resolutionBasisHints.length > 0 ? "TITLE_AND_HINTS"
  : "TITLE_ONLY";

const toCandidateMenuType = (row: PoliticsExtractedRow): PoliticsNomineeSharedCoreMarketRow["candidateMenuType"] => {
  if ((row.outcomeStructureType === "YES_NO" || row.outcomeStructureType === "BINARY_NAMED") && deriveBinaryNomineeCandidateLabel(row)) {
    return "CANDIDATE_SPECIFIC_BINARY";
  }
  if (row.outcomeStructureType === "MULTI_CANDIDATE") {
    return row.outcomeLabels.some((label) => OTHERS_PATTERN.test(label))
      ? "FIELD_MULTI_CANDIDATE"
      : "PARTIAL_MULTI_CANDIDATE";
  }
  return "UNKNOWN_MENU";
};

const toTopicKey = (row: PoliticsExtractedRow): PoliticsNomineeTopicKey | null => {
  const admission = admitNominee2028Row(row);
  return admission.admitted ? admission.subgroupKey : null;
};

const toCanonicalTopicLabel = (topicKey: PoliticsNomineeTopicKey): string =>
  topicKey.endsWith("REPUBLICAN") ? "Republican Presidential Nominee 2028" : "Democratic Presidential Nominee 2028";

export const admitNominee2028SharedCoreRow = (row: PoliticsExtractedRow): {
  admitted: boolean;
  topicKey: PoliticsNomineeTopicKey | null;
  reason: string | null;
} => {
  const admission = admitNominee2028Row(row);
  if (!admission.admitted || !admission.subgroupKey) {
    return {
      admitted: false,
      topicKey: null,
      reason: "OUT_OF_SCOPE_FOR_NOMINEE_2028_SHARED_CORE_PASS"
    };
  }
  return {
    admitted: true,
    topicKey: admission.subgroupKey,
    reason: null
  };
};

export const normalizeNominee2028SharedCoreMarket = (row: PoliticsExtractedRow): PoliticsNomineeSharedCoreMarketRow | null => {
  const admission = admitNominee2028SharedCoreRow(row);
  if (!admission.admitted || !admission.topicKey) {
    return null;
  }

  const topicKey = admission.topicKey;
  const ruleMeaning = deriveRuleMeaning(row);
  const candidateMenuType = toCandidateMenuType(row);
  const hasOthersBucket = row.outcomeLabels.some((label) => OTHERS_PATTERN.test(label));
  const reviewRequired = ruleMeaning === "PRIMARY_WINNER";
  const materiallyIncompatible = ruleMeaning === "MATERIALLY_INCOMPATIBLE";

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue as PoliticsNomineeSharedCoreMarketRow["venue"],
    venueMarketId: row.venueMarketId,
    title: row.title,
    topicKey,
    canonicalFamily: "NOMINEE_WINNER",
    canonicalOffice: "US_PRESIDENT",
    canonicalJurisdiction: "USA",
    canonicalCycle: "2028",
    canonicalParty: topicKey.endsWith("REPUBLICAN") ? "REPUBLICAN" : "DEMOCRATIC",
    canonicalTopicLabel: toCanonicalTopicLabel(topicKey),
    canonicalResolutionMeaning:
      ruleMeaning === "UNKNOWN" ? null
      : ruleMeaning === "MATERIALLY_INCOMPATIBLE" ? "INCOMPATIBLE_POLITICAL_MARKET"
      : ruleMeaning === "PRIMARY_WINNER" ? "PRIMARY_WINNER"
      : "PRESIDENTIAL_NOMINEE_WINNER",
    canonicalResolutionSourceType: toResolutionSourceType(row),
    interpretationConfidence: row.extractionConfidence,
    interpretationNotes: row.parseFailures,
    ruleCompatibilityClass: ruleMeaning === "UNKNOWN" ? "UNKNOWN_RULE_MEANING"
      : ruleMeaning === "MATERIALLY_INCOMPATIBLE" ? "RULES_MATERIALLY_INCOMPATIBLE"
      : ruleMeaning === "PRIMARY_WINNER" ? "REVIEW_REQUIRED_RULE_VARIANCE"
      : "EXACT_RULE_COMPATIBLE",
    rejectionReason: null,
    candidateMenuType,
    hasOthersBucket,
    fullMenuKnown: candidateMenuType === "FIELD_MULTI_CANDIDATE",
    fullMenuComparable: candidateMenuType === "FIELD_MULTI_CANDIDATE" && !hasOthersBucket,
    partialMenuComparable: candidateMenuType === "CANDIDATE_SPECIFIC_BINARY" || candidateMenuType === "PARTIAL_MULTI_CANDIDATE",
    reviewRequired,
    materiallyIncompatible
  };
};

const buildOutcomeRow = (input: {
  market: PoliticsNomineeSharedCoreMarketRow;
  rawOutcomeLabel: string;
  normalizedCandidateName: string | null;
  candidateIdentityKey: string | null;
  outcomeType: PoliticsNomineeSharedCoreOutcomeRow["outcomeType"];
  isNamedCandidate: boolean;
  isOthersBucket: boolean;
}): PoliticsNomineeSharedCoreOutcomeRow => ({
  venue: input.market.venue,
  venueMarketId: input.market.venueMarketId,
  topicKey: input.market.topicKey,
  rawOutcomeLabel: input.rawOutcomeLabel,
  normalizedCandidateName: input.normalizedCandidateName,
  candidateIdentityKey: input.candidateIdentityKey,
  outcomeType: input.outcomeType,
  isNamedCandidate: input.isNamedCandidate,
  isOthersBucket: input.isOthersBucket,
  sharedAcrossVenueCount: 0,
  sharedAcrossWhichVenues: [],
  routeabilityClass: input.isOthersBucket ? "EXCLUDED_OTHER_BUCKET" : "EXCLUDED_UNKNOWN"
});

export const extractNominee2028SharedCoreOutcomes = (
  row: PoliticsExtractedRow,
  market: PoliticsNomineeSharedCoreMarketRow
): readonly PoliticsNomineeSharedCoreOutcomeRow[] => {
  const derivedBinaryCandidateLabel = deriveBinaryNomineeCandidateLabel(row);
  if (market.candidateMenuType === "CANDIDATE_SPECIFIC_BINARY" && derivedBinaryCandidateLabel) {
    const normalizedCandidateName = normalizeCandidateName(derivedBinaryCandidateLabel);
    const candidateIdentityKey = toCandidateIdentityKey(normalizedCandidateName);
    return [
      buildOutcomeRow({
        market,
        rawOutcomeLabel: derivedBinaryCandidateLabel,
        normalizedCandidateName,
        candidateIdentityKey,
        outcomeType: normalizedCandidateName ? "NAMED_CANDIDATE" : "UNKNOWN_COMPOSITE",
        isNamedCandidate: Boolean(normalizedCandidateName),
        isOthersBucket: false
      })
    ];
  }

  return row.outcomeLabels.map((label) => {
    if (OTHERS_PATTERN.test(label)) {
      return buildOutcomeRow({
        market,
        rawOutcomeLabel: label,
        normalizedCandidateName: null,
        candidateIdentityKey: null,
        outcomeType: "OTHERS_BUCKET",
        isNamedCandidate: false,
        isOthersBucket: true
      });
    }
    const normalizedCandidateName = normalizeCandidateName(label);
    const candidateIdentityKey = toCandidateIdentityKey(normalizedCandidateName);
    const unknownComposite = !normalizedCandidateName || COMPOSITE_PATTERN.test(label) || /^yes$|^no$/i.test(label);
    return buildOutcomeRow({
      market,
      rawOutcomeLabel: label,
      normalizedCandidateName,
      candidateIdentityKey,
      outcomeType: unknownComposite ? "UNKNOWN_COMPOSITE" : "NAMED_CANDIDATE",
      isNamedCandidate: !unknownComposite && !OTHERS_PATTERN.test(label),
      isOthersBucket: false
    });
  });
};

export const buildNominee2028RuleCompatibility = (
  markets: readonly PoliticsNomineeSharedCoreMarketRow[]
): {
  profiles: readonly PoliticsNomineeDerivedRuleProfile[];
  markets: readonly PoliticsNomineeSharedCoreMarketRow[];
} => {
  const profileMap = new Map<string, PoliticsNomineeDerivedRuleProfile>();
  const topicMeanings = new Map<PoliticsNomineeTopicKey, Set<DerivedRuleMeaning>>();

  for (const market of markets) {
    const key = `${market.topicKey}|${market.venue}`;
    const meaning =
      market.canonicalResolutionMeaning === "INCOMPATIBLE_POLITICAL_MARKET" ? "MATERIALLY_INCOMPATIBLE"
      : market.canonicalResolutionMeaning === "PRIMARY_WINNER" ? "PRIMARY_WINNER"
      : market.canonicalResolutionMeaning === "PRESIDENTIAL_NOMINEE_WINNER" && /accept/i.test(market.title) ? "NOMINEE_WINNER_ACCEPTS"
      : market.canonicalResolutionMeaning === "PRESIDENTIAL_NOMINEE_WINNER" ? "NOMINEE_WINNER"
      : "UNKNOWN";
    topicMeanings.get(market.topicKey)?.add(meaning) ?? topicMeanings.set(market.topicKey, new Set([meaning]));

    const existing = profileMap.get(key);
    if (existing) {
      profileMap.set(key, {
        ...existing,
        derivedMeaning:
          existing.derivedMeaning === meaning ? existing.derivedMeaning
          : existing.derivedMeaning === "UNKNOWN" ? meaning
          : meaning === "UNKNOWN" ? existing.derivedMeaning
          : existing.derivedMeaning === "NOMINEE_WINNER" && meaning === "NOMINEE_WINNER_ACCEPTS" ? "NOMINEE_WINNER_ACCEPTS"
          : existing.derivedMeaning === "NOMINEE_WINNER_ACCEPTS" && meaning === "NOMINEE_WINNER" ? "NOMINEE_WINNER_ACCEPTS"
          : existing.derivedMeaning === "PRIMARY_WINNER" || meaning === "PRIMARY_WINNER" ? "PRIMARY_WINNER"
          : "MATERIALLY_INCOMPATIBLE",
        titles: unique([...existing.titles, market.title])
      });
      continue;
    }
    profileMap.set(key, {
      topicKey: market.topicKey,
      venue: market.venue,
      derivedMeaning: meaning,
      sourceType: market.canonicalResolutionSourceType,
      titles: [market.title]
    });
  }

  const profiles = [...profileMap.values()];
  const compatibleMarkets = markets.map((market) => {
    const meanings = [...(topicMeanings.get(market.topicKey) ?? new Set<DerivedRuleMeaning>(["UNKNOWN"]))];
    const onlyNomineeMeaning = meanings.every((value) => value === "NOMINEE_WINNER" || value === "NOMINEE_WINNER_ACCEPTS");
    const hasReviewVariance = meanings.some((value) => value === "PRIMARY_WINNER");
    const hasMaterialIncompatibility = meanings.some((value) => value === "MATERIALLY_INCOMPATIBLE");
    const hasUnknown = meanings.some((value) => value === "UNKNOWN");

    let ruleCompatibilityClass: PoliticsNomineeRuleCompatibilityClass;
    if (hasMaterialIncompatibility) {
      ruleCompatibilityClass = "RULES_MATERIALLY_INCOMPATIBLE";
    } else if (hasUnknown) {
      ruleCompatibilityClass = "UNKNOWN_RULE_MEANING";
    } else if (hasReviewVariance) {
      ruleCompatibilityClass = "REVIEW_REQUIRED_RULE_VARIANCE";
    } else if (onlyNomineeMeaning && meanings.includes("NOMINEE_WINNER_ACCEPTS")) {
      ruleCompatibilityClass = meanings.length === 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
    } else {
      ruleCompatibilityClass = "EXACT_RULE_COMPATIBLE";
    }

    return {
      ...market,
      ruleCompatibilityClass,
      reviewRequired: ruleCompatibilityClass === "REVIEW_REQUIRED_RULE_VARIANCE",
      materiallyIncompatible: ruleCompatibilityClass === "RULES_MATERIALLY_INCOMPATIBLE"
    };
  });

  return {
    profiles,
    markets: compatibleMarkets
  };
};

const compareOutcomeRouteability = (
  candidateOutcomes: readonly PoliticsNomineeSharedCoreOutcomeRow[],
  markets: readonly PoliticsNomineeSharedCoreMarketRow[]
): PoliticsNomineeOutcomeRouteabilityClass => {
  const venues = unique(candidateOutcomes.map((outcome) => outcome.venue));
  if (candidateOutcomes.some((outcome) => outcome.isOthersBucket)) {
    return "EXCLUDED_OTHER_BUCKET";
  }
  if (candidateOutcomes.some((outcome) => !outcome.isNamedCandidate || !outcome.candidateIdentityKey)) {
    return "EXCLUDED_UNKNOWN";
  }
  if (venues.length <= 1) {
    return "EXCLUDED_NOT_SHARED";
  }

  const relevantMarkets = markets.filter((market) =>
    candidateOutcomes.some((outcome) => outcome.venue === market.venue && outcome.venueMarketId === market.venueMarketId)
  );
  const ruleClasses = unique(relevantMarkets.map((market) => market.ruleCompatibilityClass));

  if (ruleClasses.includes("RULES_MATERIALLY_INCOMPATIBLE")) {
    return "EXCLUDED_INCOMPATIBLE";
  }
  if (ruleClasses.includes("UNKNOWN_RULE_MEANING")) {
    return "EXCLUDED_UNKNOWN";
  }
  if (ruleClasses.includes("REVIEW_REQUIRED_RULE_VARIANCE")) {
    return "REVIEW_REQUIRED_ROUTEABLE";
  }
  return "EXACT_AUTO_ROUTEABLE";
};

export const buildNominee2028SharedOutcomeCore = (input: {
  topicKey: PoliticsNomineeTopicKey;
  markets: readonly PoliticsNomineeSharedCoreMarketRow[];
  outcomes: readonly PoliticsNomineeSharedCoreOutcomeRow[];
}): PoliticsNomineeSharedCoreTopicOutcomeSummary => {
  const namedGroups = new Map<string, PoliticsNomineeSharedCoreOutcomeRow[]>();
  const annotatedOutcomes: PoliticsNomineeSharedCoreOutcomeRow[] = [];

  for (const outcome of input.outcomes) {
    if (outcome.candidateIdentityKey) {
      namedGroups.get(outcome.candidateIdentityKey)?.push(outcome) ?? namedGroups.set(outcome.candidateIdentityKey, [outcome]);
    }
  }

  for (const outcome of input.outcomes) {
    const grouped = outcome.candidateIdentityKey ? (namedGroups.get(outcome.candidateIdentityKey) ?? [outcome]) : [outcome];
    const sharedAcrossWhichVenues = [...unique(grouped.map((entry) => entry.venue))].sort();
    const routeabilityClass =
      outcome.isOthersBucket ? "EXCLUDED_OTHER_BUCKET"
      : compareOutcomeRouteability(grouped, input.markets);
    annotatedOutcomes.push({
      ...outcome,
      sharedAcrossVenueCount: sharedAcrossWhichVenues.length,
      sharedAcrossWhichVenues,
      routeabilityClass
    });
  }

  const triSharedNamedOutcomes = annotatedOutcomes.filter((outcome) =>
    outcome.isNamedCandidate && outcome.sharedAcrossVenueCount === 3
      && (outcome.routeabilityClass === "EXACT_AUTO_ROUTEABLE" || outcome.routeabilityClass === "REVIEW_REQUIRED_ROUTEABLE")
  );
  const pairSharedNamedOutcomes = annotatedOutcomes.filter((outcome) =>
    outcome.isNamedCandidate && outcome.sharedAcrossVenueCount === 2
      && (outcome.routeabilityClass === "EXACT_AUTO_ROUTEABLE" || outcome.routeabilityClass === "REVIEW_REQUIRED_ROUTEABLE")
  );
  const singleVenueOnlyOutcomes = annotatedOutcomes.filter((outcome) => outcome.sharedAcrossVenueCount <= 1 && !outcome.isOthersBucket);
  const excludedOutcomes = annotatedOutcomes.filter((outcome) =>
    outcome.routeabilityClass.startsWith("EXCLUDED_")
  );

  return {
    topicKey: input.topicKey,
    triSharedNamedOutcomes,
    pairSharedNamedOutcomes,
    singleVenueOnlyOutcomes,
    excludedOutcomes
  };
};

export const buildNominee2028TopicDecision = (input: {
  topicKey: PoliticsNomineeTopicKey;
  markets: readonly PoliticsNomineeSharedCoreMarketRow[];
  outcomeCore: PoliticsNomineeSharedCoreTopicOutcomeSummary;
}): PoliticsNomineeSharedCoreTopicDecisionSummary => {
  const venues = unique(input.markets.map((market) => market.venue));
  const routeableOutcomes = [...input.outcomeCore.triSharedNamedOutcomes, ...input.outcomeCore.pairSharedNamedOutcomes];
  const exactAutoRouteable = routeableOutcomes.some((outcome) => outcome.routeabilityClass === "EXACT_AUTO_ROUTEABLE");
  const reviewRequiredRouteable = routeableOutcomes.some((outcome) => outcome.routeabilityClass === "REVIEW_REQUIRED_ROUTEABLE");
  const ruleClasses = unique(input.markets.map((market) => market.ruleCompatibilityClass));
  const ruleDecision =
    ruleClasses.length === 1 ? ruleClasses[0]!
    : "MIXED";

  const sharedNamedOutcomeCount = routeableOutcomes.length;
  const triSharedNamedOutcomeCount = input.outcomeCore.triSharedNamedOutcomes.length;
  const pairSharedNamedOutcomeCount = input.outcomeCore.pairSharedNamedOutcomes.length;
  const excludedTailCount = input.outcomeCore.excludedOutcomes.length;
  const othersExcluded = input.outcomeCore.excludedOutcomes.some((outcome) => outcome.routeabilityClass === "EXCLUDED_OTHER_BUCKET");

  let topicDecision: PoliticsNomineeTopicDecision;
  if (venues.length <= 1) {
    topicDecision = "TOPIC_SINGLE_VENUE_ONLY";
  } else if (triSharedNamedOutcomeCount > 0 && !reviewRequiredRouteable) {
    topicDecision = "TOPIC_SHARED_CORE_TRI_READY";
  } else if (sharedNamedOutcomeCount > 0 && reviewRequiredRouteable) {
    topicDecision = "TOPIC_SHARED_CORE_ROUTEABLE_WITH_REVIEW";
  } else if (pairSharedNamedOutcomeCount > 0) {
    topicDecision = "TOPIC_SHARED_CORE_PAIR_ONLY";
  } else if (input.outcomeCore.excludedOutcomes.some((outcome) => outcome.routeabilityClass === "EXCLUDED_INCOMPATIBLE")) {
    topicDecision = "TOPIC_SHARED_BUT_MATERIALLY_INCOMPATIBLE";
  } else if (input.outcomeCore.excludedOutcomes.some((outcome) => outcome.sharedAcrossVenueCount > 1)) {
    topicDecision = "TOPIC_SHARED_BUT_OUTCOME_CORE_TOO_THIN";
  } else {
    topicDecision = "TOPIC_NO_USABLE_SHARED_CORE";
  }

  return {
    topicKey: input.topicKey,
    topicDecision,
    ruleDecision,
    sharedNamedOutcomeCount,
    triSharedNamedOutcomeCount,
    pairSharedNamedOutcomeCount,
    excludedTailCount,
    othersExcluded,
    exactAutoRouteable,
    reviewRequiredRouteable,
    matcherEvalJustified:
      topicDecision === "TOPIC_SHARED_CORE_TRI_READY"
      || topicDecision === "TOPIC_SHARED_CORE_PAIR_ONLY"
      || topicDecision === "TOPIC_SHARED_CORE_ROUTEABLE_WITH_REVIEW"
  };
};

export const buildNominee2028SharedCoreFinalDecision = (input: {
  republican: PoliticsNomineeSharedCoreTopicDecisionSummary;
  democratic: PoliticsNomineeSharedCoreTopicDecisionSummary;
}): {
  overallPoliticsNomineeDecision: string;
  republicanDecision: PoliticsNomineeTopicDecision;
  democraticDecision: PoliticsNomineeTopicDecision;
  sharedCorePolicyImplemented: true;
  othersExcludedPolicyImplemented: true;
  rulesCompatibilityPolicyImplemented: true;
  nextBestAction: string;
} => {
  const decisions = [input.republican.topicDecision, input.democratic.topicDecision];
  const anyMatcherReady = input.republican.matcherEvalJustified || input.democratic.matcherEvalJustified;
  const anyReviewRequired = input.republican.reviewRequiredRouteable || input.democratic.reviewRequiredRouteable;

  return {
    overallPoliticsNomineeDecision:
      decisions.every((decision) => decision === "TOPIC_SINGLE_VENUE_ONLY") ? "NOMINEE_2028_CLUSTER_SINGLE_VENUE_ONLY"
      : anyReviewRequired ? "NOMINEE_2028_CLUSTER_NARROW_MATCHER_READY"
      : anyMatcherReady ? "NOMINEE_2028_CLUSTER_EXACT_MATCHER_READY"
      : decisions.some((decision) => decision === "TOPIC_SHARED_BUT_MATERIALLY_INCOMPATIBLE") ? "NOMINEE_2028_CLUSTER_BASIS_FRAGMENTED"
      : decisions.some((decision) => decision === "TOPIC_SHARED_BUT_OUTCOME_CORE_TOO_THIN" || decision === "TOPIC_NO_USABLE_SHARED_CORE")
        ? "NOMINEE_2028_CLUSTER_CANDIDATE_SET_MISMATCH"
        : "NOMINEE_2028_CLUSTER_UNKNOWN_FIELDS",
    republicanDecision: input.republican.topicDecision,
    democraticDecision: input.democratic.topicDecision,
    sharedCorePolicyImplemented: true,
    othersExcludedPolicyImplemented: true,
    rulesCompatibilityPolicyImplemented: true,
    nextBestAction:
      anyMatcherReady ? "Run a narrow nominee-only matcher evaluation on the shared named-outcome core."
      : "Repair fresh Opinion and Limitless in-scope nominee supply before matcher work."
  };
};

export const buildNominee2028FetchSummary = (input: {
  candidateRowsByVenue: Record<string, number>;
  fetchStatuses: Record<string, { fetchStatus?: PoliticsNominee2028FetchStatus | string } & Record<string, unknown>>;
}) => ({
  observedAt: new Date().toISOString(),
  freshCandidateMarketsByVenue: input.candidateRowsByVenue,
  fetchStates: Object.fromEntries(
    ["POLYMARKET", "OPINION", "LIMITLESS"].map((venue) => [
      venue,
      input.fetchStatuses[venue]?.fetchStatus ?? "UNSUPPORTED_PATH"
    ])
  )
});

export const nominee2028SharedCoreTopicKeys = TOPIC_KEYS;
