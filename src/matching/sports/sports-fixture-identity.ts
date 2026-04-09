import { buildStableTextId } from "../../canonical/canonicalization-types.js";
import type { SportsFixtureIdentity, SportsFixturePocket } from "./sports-fixture-types.js";

export const buildFixtureStartWindowKey = (input: {
  fixtureDateKey: string;
  fixtureStartTimestamp: string | null;
}): string =>
  input.fixtureStartTimestamp ?? `${input.fixtureDateKey}TUNKNOWN`;

export const buildSportsFixtureId = (input: {
  fixturePocket: SportsFixturePocket;
  competitionKey: string;
  matchupKey: string;
  fixtureDateKey: string;
  fixtureStartWindowKey: string;
}): string =>
  buildStableTextId(
    "sportsfixture_",
    `${input.fixturePocket}|${input.competitionKey}|${input.matchupKey}|${input.fixtureDateKey}|${input.fixtureStartWindowKey}`
  );

export const buildSportsFixtureIdentity = (input: {
  fixturePocket: SportsFixturePocket;
  domain: string;
  competitionKey: string;
  competitionLabel: string | null;
  competitionScope: string;
  canonicalSortedParticipants: readonly string[];
  matchupKey: string;
  fixtureDateKey: string;
  fixtureStartTimestamp: string | null;
  dateStatus: string;
  dateSourceProvenance: string | null;
  timestampSource: string | null;
  sourceRowIds: readonly string[];
  fixtureStatus?: string | null;
}): SportsFixtureIdentity => {
  const fixtureStartWindowKey = buildFixtureStartWindowKey({
    fixtureDateKey: input.fixtureDateKey,
    fixtureStartTimestamp: input.fixtureStartTimestamp
  });

  return {
    fixtureId: buildSportsFixtureId({
      fixturePocket: input.fixturePocket,
      competitionKey: input.competitionKey,
      matchupKey: input.matchupKey,
      fixtureDateKey: input.fixtureDateKey,
      fixtureStartWindowKey
    }),
    fixturePocket: input.fixturePocket,
    domain: input.domain,
    competitionKey: input.competitionKey,
    competitionLabel: input.competitionLabel,
    competitionScope: input.competitionScope,
    canonicalSortedParticipants: input.canonicalSortedParticipants,
    matchupKey: input.matchupKey,
    fixtureDateKey: input.fixtureDateKey,
    fixtureStartTimestamp: input.fixtureStartTimestamp,
    fixtureStartWindowKey,
    dateStatus: input.dateStatus,
    dateSourceProvenance: input.dateSourceProvenance,
    timestampSource: input.timestampSource,
    sourceRowIds: [...input.sourceRowIds].sort((a, b) => a.localeCompare(b)),
    fixtureStatus: input.fixtureStatus ?? null
  };
};

