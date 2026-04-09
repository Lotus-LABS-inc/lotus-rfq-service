import type { ContractFamily } from "../matching-types.js";

export const sportsTargetVenueValues = ["POLYMARKET", "LIMITLESS", "OPINION", "PREDICT"] as const;
export type SportsTargetVenue = typeof sportsTargetVenueValues[number];

export const sportsScopedDomainValues = ["SPORTS", "ESPORTS"] as const;
export type SportsScopedDomain = typeof sportsScopedDomainValues[number];

export const sportsScopedFamilyValues = [
  "MATCHUP_WINNER",
  "CHAMPIONSHIP_WINNER",
  "TOURNAMENT_WINNER",
  "SPLIT_WINNER",
  "LEAGUE_WINNER"
] as const satisfies readonly ContractFamily[];
export type SportsScopedFamily = typeof sportsScopedFamilyValues[number];

export const sportsCompetitionScopeValues = ["MATCH", "OUTRIGHT"] as const;
export type SportsCompetitionScope = typeof sportsCompetitionScopeValues[number];

export const sportsTaxonomyStatusValues = [
  "ADMITTED",
  "FAMILY_OUT_OF_SCOPE",
  "AMBIGUOUS_FAMILY",
  "NON_SPORTS_ROW",
  "NON_ESPORTS_ROW"
] as const;
export type SportsTaxonomyStatus = typeof sportsTaxonomyStatusValues[number];

export const sportsCompetitionBlockerValues = [
  "COMPETITION_CONTEXT_MISMATCH",
  "COMPETITION_SCOPE_MISSING",
  "MATCH_VS_OUTRIGHT_MISMATCH",
  "SPLIT_VS_MATCH_MISMATCH",
  "LEAGUE_VS_TOURNAMENT_MISMATCH"
] as const;
export type SportsCompetitionBlocker = typeof sportsCompetitionBlockerValues[number];

export const sportsSubjectBlockerValues = [
  "SUBJECT_ENTITY_MISMATCH",
  "UNRESOLVED_ALIAS",
  "OPPONENT_MISMATCH",
  "SIDE_ASSIGNMENT_MISMATCH"
] as const;
export type SportsSubjectBlocker = typeof sportsSubjectBlockerValues[number];

export const sportsPrefilterBlockerValues = [
  "DOMAIN_MISMATCH",
  "FAMILY_MISMATCH",
  "COMPETITION_CONTEXT_MISMATCH",
  "COMPETITION_SCOPE_MISMATCH",
  "SUBJECT_ENTITY_MISMATCH",
  "DATE_WINDOW_MISMATCH",
  "OPPONENT_MISMATCH",
  "SIDE_ASSIGNMENT_MISMATCH",
  "OUTCOME_STRUCTURE_MISMATCH"
] as const;
export type SportsPrefilterBlocker = typeof sportsPrefilterBlockerValues[number];

export const sportsAllowedVenuePairs = new Set([
  "LIMITLESS|OPINION",
  "LIMITLESS|POLYMARKET",
  "LIMITLESS|PREDICT",
  "OPINION|POLYMARKET",
  "OPINION|PREDICT",
  "POLYMARKET|PREDICT"
]);

export const buildSportsVenuePairKey = (leftVenue: SportsTargetVenue, rightVenue: SportsTargetVenue): string =>
  leftVenue.localeCompare(rightVenue) <= 0 ? `${leftVenue}|${rightVenue}` : `${rightVenue}|${leftVenue}`;
