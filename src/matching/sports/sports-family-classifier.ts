import { buildStableTextId } from "../../canonical/canonicalization-types.js";
import type { ContractFamilyClassification, MatchingMarketRecord } from "../matching-types.js";
import type { SportsScopedDomain, SportsScopedFamily, SportsTaxonomyStatus } from "./sports-match-labels.js";
import { sportsScopedFamilyValues } from "./sports-match-labels.js";
import { buildSportsText } from "./sports-normalization.js";

const CLASSIFIER_VERSION = "sports-family-classifier-v1";
const PROP_OR_NOISE_PATTERN = /\b(cards?|shots?(?: on target)?|fouls?|assists?|passes?|saves?|score first|goal after|start in xi|treble|join a club|who scores more points|points? at|rebounds?|player)\b/i;
const SPREAD_TOTAL_PATTERN = /\bspread|over\/under|over under|total\b/i;
const MATCHUP_PATTERN = /\b(vs\.?|versus)\b/i;

export interface SportsFamilyTaxonomyClassification extends ContractFamilyClassification {
  metadata: ContractFamilyClassification["metadata"] & {
    domain: SportsScopedDomain | null;
    taxonomyStatus: SportsTaxonomyStatus;
    scopeRejectionReasons: readonly string[];
  };
}

const resolveDomain = (market: MatchingMarketRecord): SportsScopedDomain | null =>
  market.category === "SPORTS" ? "SPORTS"
  : market.category === "ESPORTS" ? "ESPORTS"
  : null;

const classifyInScopeFamily = (market: MatchingMarketRecord, domain: SportsScopedDomain): {
  family: SportsScopedFamily | null;
  ambiguous: boolean;
  reasons: readonly string[];
} => {
  const text = buildSportsText(market);

  if (PROP_OR_NOISE_PATTERN.test(text) || SPREAD_TOTAL_PATTERN.test(text)) {
    return {
      family: null,
      ambiguous: false,
      reasons: ["family:out_of_scope_prop_or_total"]
    };
  }

  if (MATCHUP_PATTERN.test(text)) {
    return {
      family: "MATCHUP_WINNER",
      ambiguous: false,
      reasons: ["family:matchup_winner"]
    };
  }

  if (domain === "SPORTS") {
    if (/\b(finals|stanley cup|super bowl|world series|championship)\b/i.test(text)) {
      return {
        family: "CHAMPIONSHIP_WINNER",
        ambiguous: false,
        reasons: ["family:championship_winner"]
      };
    }
    if (/\b(world cup|cup|tournament|playoffs?)\b/i.test(text) && !/\bstanley cup\b/i.test(text)) {
      return {
        family: "TOURNAMENT_WINNER",
        ambiguous: false,
        reasons: ["family:tournament_winner"]
      };
    }
    return {
      family: null,
      ambiguous: false,
      reasons: ["family:not_in_scope"]
    };
  }

  if (/\b(split|spring|summer|winter)\b/i.test(text)) {
    return {
      family: "SPLIT_WINNER",
      ambiguous: false,
      reasons: ["family:split_winner"]
    };
  }
  if (/\b(lck|lcs|lec|lpl|league)\b/i.test(text)) {
    return {
      family: "LEAGUE_WINNER",
      ambiguous: false,
      reasons: ["family:league_winner"]
    };
  }
  if (/\b(worlds|tournament|major|masters|cup|playoffs?)\b/i.test(text)) {
    return {
      family: "TOURNAMENT_WINNER",
      ambiguous: false,
      reasons: ["family:tournament_winner"]
    };
  }
  return {
    family: null,
    ambiguous: false,
    reasons: ["family:not_in_scope"]
  };
};

const computeConfidence = (status: SportsTaxonomyStatus, ambiguityFlags: readonly string[]): string =>
  status === "ADMITTED" ? Math.max(0.6, 1 - ambiguityFlags.length * 0.1).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
  : status === "AMBIGUOUS_FAMILY" ? "0.45"
  : "0.2";

export const classifySportsFamily = (market: MatchingMarketRecord): SportsFamilyTaxonomyClassification => {
  const domain = resolveDomain(market);
  const ambiguityFlags = Object.entries(market.ambiguityFlags)
    .filter((entry): entry is [string, true] => entry[1] === true)
    .map(([key]) => key);

  if (domain === null) {
    const status = market.category === "SPORTS" ? "NON_ESPORTS_ROW" : "NON_SPORTS_ROW";
    return {
      interpretedContractId: market.interpretedContractId,
      family: "OTHER_EVENT_STYLE",
      familyConfidence: computeConfidence(status, ambiguityFlags),
      classificationReasons: ["domain:not_sports_or_esports"],
      ruleIds: [buildStableTextId("familyrule_", `${CLASSIFIER_VERSION}|NON_TARGET`)],
      ambiguityFlags,
      weakStructureLane: true,
      classifierVersion: CLASSIFIER_VERSION,
      metadata: {
        domain: null,
        taxonomyStatus: status,
        scopeRejectionReasons: [status]
      }
    };
  }

  const classified = classifyInScopeFamily(market, domain);
  const taxonomyStatus: SportsTaxonomyStatus =
    classified.family !== null ? "ADMITTED"
    : classified.ambiguous ? "AMBIGUOUS_FAMILY"
    : "FAMILY_OUT_OF_SCOPE";
  const family = classified.family ?? "OTHER_EVENT_STYLE";

  return {
    interpretedContractId: market.interpretedContractId,
    family,
    familyConfidence: computeConfidence(taxonomyStatus, ambiguityFlags),
    classificationReasons: classified.reasons,
    ruleIds: [
      buildStableTextId("familyrule_", `${CLASSIFIER_VERSION}|${domain}|${family}`),
      `domain:${domain.toLowerCase()}`,
      `taxonomy:${taxonomyStatus.toLowerCase()}`
    ],
    ambiguityFlags: taxonomyStatus === "AMBIGUOUS_FAMILY"
      ? [...ambiguityFlags, "ambiguous_sports_family"]
      : ambiguityFlags,
    weakStructureLane: taxonomyStatus !== "ADMITTED",
    classifierVersion: CLASSIFIER_VERSION,
    metadata: {
      domain,
      taxonomyStatus,
      scopeRejectionReasons:
        taxonomyStatus === "ADMITTED" ? []
        : taxonomyStatus === "AMBIGUOUS_FAMILY" ? ["AMBIGUOUS_FAMILY"]
        : ["FAMILY_OUT_OF_SCOPE"]
    }
  };
};

export const isSportsFamilyInScope = (family: string): family is SportsScopedFamily =>
  sportsScopedFamilyValues.includes(family as SportsScopedFamily);
