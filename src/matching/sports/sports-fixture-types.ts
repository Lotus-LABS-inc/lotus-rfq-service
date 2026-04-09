export const sportsFixturePocketValues = [
  "SPORTS|MATCHUP_WINNER|NBA",
  "SPORTS|MATCHUP_WINNER|EPL",
  "SPORTS|MATCHUP_WINNER|LA_LIGA",
  "ESPORTS|MATCHUP_WINNER|DOTA2_ESL",
  "ESPORTS|MATCHUP_WINNER|VALORANT",
  "ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS",
  "ESPORTS|MATCHUP_WINNER|KPL",
  "ESPORTS|MATCHUP_WINNER|LCK"
] as const;
export type SportsFixturePocket = typeof sportsFixturePocketValues[number];

export const sportsFixtureBindingOutcomeValues = [
  "BOUND_CONFIDENT",
  "BOUND_WITH_PROVENANCE_WARNING",
  "UNBOUND_MISSING_DATE",
  "UNBOUND_MISSING_OPPONENT",
  "UNBOUND_COMPETITION_DRIFT",
  "UNBOUND_BASIS_DRIFT",
  "UNBOUND_NON_FIXTURE_ROW",
  "UNBOUND_OUT_OF_SCOPE"
] as const;
export type SportsFixtureBindingOutcome = typeof sportsFixtureBindingOutcomeValues[number];

export const sportsFixtureCoverageBlockerValues = [
  "MISSING_VENUE_SUPPLY",
  "UNBOUND_IDENTITY",
  "UNBOUND_DATE",
  "BASIS_FRAGMENTED",
  "COMPETITION_DRIFT",
  "NON_FIXTURE_CONTAMINATION"
] as const;
export type SportsFixtureCoverageBlocker = typeof sportsFixtureCoverageBlockerValues[number];

export const sportsPocketSupplyGapValues = [
  "SUPPLY_THIN",
  "UNBOUND_SUPPLY_PRESENT",
  "BASIS_FRAGMENTED",
  "BINDABLE_AND_PROMISING",
  "TOO_THIN_TO_JUSTIFY",
  "BINDING_INCOMPLETE"
] as const;
export type SportsPocketSupplyGap = typeof sportsPocketSupplyGapValues[number];

export const sportsTargetedSupplyRecommendationValues = [
  "HOLD_POCKET_WAIT_FOR_SUPPLY",
  "TARGETED_DISCOVERY_FOR_MISSING_VENUE_ROWS",
  "TARGETED_FIXTURE_INGESTION_WINDOW",
  "TARGETED_HISTORICAL_BACKFILL",
  "TARGETED_CURRENT_STATE_CAPTURE",
  "HOLD_UNTIL_BASIS_CONVERGES"
] as const;
export type SportsTargetedSupplyRecommendation = typeof sportsTargetedSupplyRecommendationValues[number];

export const sportsLiveFixtureIngestionReadinessValues = [
  "HIGH_VALUE_NOW",
  "USEFUL_BUT_PREMATURE",
  "LOW_VALUE_UNTIL_SUPPLY_IMPROVES",
  "NOT_JUSTIFIED"
] as const;
export type SportsLiveFixtureIngestionReadiness = typeof sportsLiveFixtureIngestionReadinessValues[number];

export const sportsFixtureFinalDecisionLabelValues = [
  "SPORTS_FIXTURE_BINDING_READY__TARGETED_SUPPLY_RECOVERY_NEXT",
  "SPORTS_FIXTURE_BINDING_READY__LIVE_FIXTURE_INGESTION_JUSTIFIED",
  "SPORTS_FIXTURE_BINDING_READY__WAITING_ON_VENUE_SUPPLY",
  "SPORTS_FIXTURE_BINDING_READY__BASIS_FRAGMENTATION_DOMINANT",
  "SPORTS_FIXTURE_BINDING_READY__POCKETS_TOO_THIN",
  "SPORTS_FIXTURE_BINDING_INCOMPLETE__MANUAL_REVIEW_NEEDED"
] as const;
export type SportsFixtureFinalDecisionLabel = typeof sportsFixtureFinalDecisionLabelValues[number];

export type SportsFixtureRowBasisBucket = "LIVE" | "HISTORICAL" | "CURRENT_STATE";

export interface SportsFixtureIdentity {
  fixtureId: string;
  fixturePocket: SportsFixturePocket;
  domain: string;
  competitionKey: string;
  competitionLabel: string | null;
  competitionScope: string;
  canonicalSortedParticipants: readonly string[];
  matchupKey: string;
  fixtureDateKey: string;
  fixtureStartTimestamp: string | null;
  fixtureStartWindowKey: string;
  dateStatus: string;
  dateSourceProvenance: string | null;
  timestampSource: string | null;
  sourceRowIds: readonly string[];
  fixtureStatus: string | null;
}

export interface SportsFixtureBindingRow {
  interpretedContractId: string;
  venue: string;
  venueMarketId: string;
  title: string;
  rawSubjectText: string | null;
  rawOpponentText: string | null;
  normalizedSubject: string | null;
  normalizedOpponent: string | null;
  matchupKey: string | null;
  canonicalSortedParticipants: readonly string[];
  fixturePocket: SportsFixturePocket | null;
  domain: string | null;
  competitionKey: string | null;
  competitionLabel: string | null;
  competitionScope: string | null;
  eventDate: string | null;
  fixtureStartTimestamp: string | null;
  fixtureStartWindowKey: string | null;
  dateStatus: string;
  dateSourceProvenance: string | null;
  timestampSource: string | null;
  temporalBasis: string;
  basisBucket: SportsFixtureRowBasisBucket;
  sourceMetadataVersion: string;
  historicalRowCount: number;
  bindingOutcome: SportsFixtureBindingOutcome;
  bindingReasons: readonly string[];
  fixtureId: string | null;
}
