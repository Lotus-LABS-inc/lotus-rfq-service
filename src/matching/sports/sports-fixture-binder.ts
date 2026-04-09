import type { SportsCompetitionContext } from "./sports-competition-context.js";
import type { SportsSubjectNormalization } from "./sports-subject-entity.js";
import type { SportsFixtureBindingOutcome, SportsFixtureBindingRow, SportsFixturePocket, SportsFixtureRowBasisBucket } from "./sports-fixture-types.js";
import { buildSportsFixtureIdentity } from "./sports-fixture-identity.js";
import { detectEvidenceLabel } from "../../operations/semantic-expansion/shared.js";

export interface SportsFixtureBindableRowInput {
  interpretedContractId: string;
  venue: string;
  venueMarketId: string;
  title: string;
  sourceMetadataVersion: string;
  historicalRowCount: number;
  temporalBasis: string;
  pocket: SportsFixturePocket | null;
  domain: string | null;
  competitionContext: SportsCompetitionContext | null;
  subjectNormalization: SportsSubjectNormalization | null;
  eventDate: string | null;
  timezoneNormalizedCutoff: string | null;
  dateStatus: string;
  dateSourceProvenance: string | null;
  timestampSource: string | null;
}

const toBasisBucket = (input: {
  sourceMetadataVersion: string;
  historicalRowCount: number;
}): SportsFixtureRowBasisBucket => {
  const evidenceLabel = detectEvidenceLabel(input);
  return evidenceLabel === "historical" ? "HISTORICAL"
    : evidenceLabel === "current_state" ? "CURRENT_STATE"
    : "LIVE";
};

const buildBindingResult = (
  row: SportsFixtureBindableRowInput,
  outcome: SportsFixtureBindingOutcome,
  reasons: readonly string[]
): SportsFixtureBindingRow => ({
  interpretedContractId: row.interpretedContractId,
  venue: row.venue,
  venueMarketId: row.venueMarketId,
  title: row.title,
  rawSubjectText: row.subjectNormalization?.subjectEntityRaw ?? null,
  rawOpponentText: row.subjectNormalization?.opponentEntityRaw ?? null,
  normalizedSubject: row.subjectNormalization?.normalizedSubjectEntity ?? null,
  normalizedOpponent: row.subjectNormalization?.normalizedOpponentEntity ?? null,
  matchupKey: row.subjectNormalization?.matchupKey ?? null,
  canonicalSortedParticipants: row.subjectNormalization?.canonicalSortedTeams ?? [],
  fixturePocket: row.pocket,
  domain: row.domain,
  competitionKey: row.competitionContext?.competitionKey ?? null,
  competitionLabel: row.competitionContext?.competitionLabel ?? null,
  competitionScope: row.competitionContext?.competitionScope ?? null,
  eventDate: row.eventDate,
  fixtureStartTimestamp: row.timezoneNormalizedCutoff,
  fixtureStartWindowKey: row.eventDate
    ? (row.timezoneNormalizedCutoff ?? `${row.eventDate}TUNKNOWN`)
    : null,
  dateStatus: row.dateStatus,
  dateSourceProvenance: row.dateSourceProvenance,
  timestampSource: row.timestampSource,
  temporalBasis: row.temporalBasis,
  basisBucket: toBasisBucket({
    sourceMetadataVersion: row.sourceMetadataVersion,
    historicalRowCount: row.historicalRowCount
  }),
  sourceMetadataVersion: row.sourceMetadataVersion,
  historicalRowCount: row.historicalRowCount,
  bindingOutcome: outcome,
  bindingReasons: reasons,
  fixtureId: null
});

export const bindSportsFixtureRow = (row: SportsFixtureBindableRowInput): SportsFixtureBindingRow => {
  const competitionContext = row.competitionContext;
  if (row.pocket === null || competitionContext === null || competitionContext.competitionKey === null || row.domain === null) {
    return buildBindingResult(row, "UNBOUND_OUT_OF_SCOPE", ["POCKET_OUT_OF_SCOPE"]);
  }
  if (competitionContext.competitionScope !== "MATCH") {
    return buildBindingResult(row, "UNBOUND_NON_FIXTURE_ROW", ["NON_MATCH_SCOPE"]);
  }
  if (!row.subjectNormalization?.normalizedOpponentEntity || !row.subjectNormalization.matchupKey) {
    return buildBindingResult(row, "UNBOUND_MISSING_OPPONENT", ["MISSING_OPPONENT"]);
  }
  if (!row.eventDate) {
    return buildBindingResult(row, "UNBOUND_MISSING_DATE", ["MISSING_EVENT_DATE"]);
  }
  if (competitionContext.blockers.length > 0) {
    return buildBindingResult(row, "UNBOUND_COMPETITION_DRIFT", competitionContext.blockers);
  }

  const identity = buildSportsFixtureIdentity({
    fixturePocket: row.pocket,
    domain: row.domain,
    competitionKey: competitionContext.competitionKey,
    competitionLabel: competitionContext.competitionLabel,
    competitionScope: competitionContext.competitionScope,
    canonicalSortedParticipants: row.subjectNormalization.canonicalSortedTeams,
    matchupKey: row.subjectNormalization.matchupKey,
    fixtureDateKey: row.eventDate,
    fixtureStartTimestamp: row.timezoneNormalizedCutoff,
    dateStatus: row.dateStatus,
    dateSourceProvenance: row.dateSourceProvenance,
    timestampSource: row.timestampSource,
    sourceRowIds: [row.interpretedContractId],
    fixtureStatus: null
  });

  const bound = buildBindingResult(
    row,
    row.dateStatus === "DATE_CONFIRMED" ? "BOUND_CONFIDENT" : "BOUND_WITH_PROVENANCE_WARNING",
    row.dateStatus === "DATE_CONFIRMED" ? ["FIXTURE_IDENTITY_CONFIRMED"] : ["FIXTURE_IDENTITY_INFERRED_DATE"]
  );
  return {
    ...bound,
    fixtureId: identity.fixtureId,
    fixtureStartWindowKey: identity.fixtureStartWindowKey
  };
};
