import { existsSync } from "node:fs";
import path from "node:path";

import type { Pool } from "pg";

import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import { SportsPocketMatchingPipeline, type SportsPocketMatchingPipelineResult } from "../matching/sports/sports-pocket-matching-pipeline.js";
import { classifySportsFamily } from "../matching/sports/sports-family-classifier.js";
import { normalizeSportsCompetitionContext } from "../matching/sports/sports-competition-context.js";
import { extractSportsBoundaryDetailed } from "../matching/sports/sports-normalization.js";
import { normalizeSportsSubjectEntities } from "../matching/sports/sports-subject-entity.js";
import { bindSportsFixtureRow, type SportsFixtureBindableRowInput } from "../matching/sports/sports-fixture-binder.js";
import type { SportsFixtureBindingRow, SportsFixturePocket } from "../matching/sports/sports-fixture-types.js";
import {
  buildSportsTargetedIngestionScope,
  mapCompetitionKeyToTargetedPocket,
  sportsHeldPocketReferences,
  sportsTargetedPocketConfigs,
  sportsTargetedPriorityOrder,
  sportsTargetedVenueAllowlist,
  type SportsTargetedCompetitionKey,
  type SportsTargetedIngestionScope,
  type SportsTargetedPriorityPocket
} from "../matching/sports/sports-targeted-ingestion-scope.js";
import { readArtifact } from "../operations/semantic-expansion/shared.js";

const TARGET_FAMILY = "MATCHUP_WINNER";
const PRIOR_BASELINE_POCKETS = [
  "SPORTS|MATCHUP_WINNER|NBA",
  "ESPORTS|MATCHUP_WINNER|DOTA2_ESL",
  "ESPORTS|MATCHUP_WINNER|KPL",
  "ESPORTS|MATCHUP_WINNER|LCK"
] as const;

export const sportsTargetedRowDiscoveryStateValues = [
  "NOT_DISCOVERED_ON_VENUE",
  "DISCOVERED_NOT_INGESTED",
  "INGESTED_REJECTED",
  "INGESTED_ADMITTED_UNBOUND",
  "INGESTED_ADMITTED_BOUND",
  "UNKNOWN_FETCH_FAILURE"
] as const;
export type SportsTargetedRowDiscoveryState = typeof sportsTargetedRowDiscoveryStateValues[number];

export const sportsTargetedFixtureOverlapValues = [
  "NO_VENUE_MARKET_PROVEN",
  "DISCOVERY_GAP_SUSPECTED",
  "INGESTION_GAP_SUSPECTED",
  "ADMISSION_REJECTION",
  "BOUND_BUT_SINGLE_VENUE_ONLY",
  "CROSS_VENUE_OVERLAP_PRESENT",
  "CROSS_VENUE_OVERLAP_NONCOMPARABLE_BASIS"
] as const;
export type SportsTargetedFixtureOverlapClassification = typeof sportsTargetedFixtureOverlapValues[number];

export const sportsTargetedPocketDecisionValues = [
  "SPORTS_TARGETED_INGESTION_NO_CHANGE_SUPPLY_THIN",
  "SPORTS_TARGETED_INGESTION_DISCOVERY_GAP_FOUND",
  "SPORTS_TARGETED_INGESTION_INGESTION_GAP_FOUND",
  "SPORTS_TARGETED_INGESTION_OVERLAP_IMPROVED",
  "SPORTS_TARGETED_INGESTION_POCKET_READY_FOR_MATCHING_REOPEN",
  "SPORTS_TARGETED_INGESTION_POCKET_STILL_NOT_JUSTIFIED"
] as const;
export type SportsTargetedPocketDecision = typeof sportsTargetedPocketDecisionValues[number];

export type SportsMissingVenueCause =
  | "VENUE_NOT_LISTING"
  | "DISCOVERY_GAP"
  | "INGESTION_GAP"
  | "ADMISSION_REJECTION"
  | "STILL_UNKNOWN";

export interface SportsTargetedVenueInspectionStatus {
  venue: typeof sportsTargetedVenueAllowlist[number];
  inspectionMode: "LOCAL_INVENTORY_ONLY" | "SCOPED_REFRESH_EXECUTED" | "SCOPED_REFRESH_UNAVAILABLE";
  fetchStatus: "SUCCESS" | "FAILED" | "NOT_ATTEMPTED";
  limitation: string | null;
}

export interface SportsTargetedIngestionScopeArtifact extends SportsTargetedIngestionScope {
  observedAt: string;
}

export interface SportsTargetedPocketConfigSummary {
  observedAt: string;
  pockets: readonly {
    pocket: SportsTargetedPriorityPocket;
    domain: "SPORTS" | "ESPORTS";
    competitions: readonly SportsTargetedCompetitionKey[];
    rollupBucket: SportsTargetedPriorityPocket;
    heldSupersededReferences: readonly string[];
  }[];
}

export interface SportsLiveWindowSummary {
  observedAt: string;
  lookbackHours: number;
  lookaheadHours: number;
  windowStartIso: string;
  windowEndIso: string;
  liveWindowPolicy: "LIVE_AND_NEAR_UPCOMING_ONLY";
  shallowLookbackAllowed: true;
}

interface ScopedFixtureRow {
  interpretedContractId: string;
  venue: typeof sportsTargetedVenueAllowlist[number];
  title: string;
  sourceMetadataVersion: string;
  historicalRowCount: number;
  temporalBasis: string;
  pocket: SportsTargetedPriorityPocket;
  competitionKey: SportsTargetedCompetitionKey;
  competitionLabel: string | null;
  fixtureDateKey: string | null;
  scheduledBoundaryKey: string | null;
  family: string;
  admitted: boolean;
  binding: SportsFixtureBindingRow;
}

export interface SportsTargetedFixtureDiscoverySummary {
  observedAt: string;
  sportsFrontierPosition: "SECONDARY_PARALLEL_DISCOVERY_TRACK";
  activeScope: readonly SportsTargetedPriorityPocket[];
  venueInspection: readonly SportsTargetedVenueInspectionStatus[];
  pockets: Record<string, {
    targetFixtureCount: number;
    venuesChecked: readonly string[];
    discoveredRowsByVenue: Record<string, number>;
    admittedRowsByVenue: Record<string, number>;
    boundRowsByVenue: Record<string, number>;
    competitionCounts: Record<string, number>;
    familyPurity: "MATCHUP_WINNER_ONLY" | "MIXED";
    competitionPurity: "SCOPED_ONLY" | "MIXED";
    dominantMissingRowClassification: SportsTargetedFixtureOverlapClassification;
  }>;
}

export interface SportsTargetedIngestionSummary {
  observedAt: string;
  venueInspection: readonly SportsTargetedVenueInspectionStatus[];
  pockets: Record<string, {
    rowsDiscoveredByVenue: Record<string, number>;
    rowsIngestedByVenue: Record<string, number>;
    rowsRejectedByVenue: Record<string, number>;
    rowsAdmittedUnboundByVenue: Record<string, number>;
    rowsAdmittedBoundByVenue: Record<string, number>;
  }>;
}

export interface SportsTargetedFixtureBindingSummary {
  observedAt: string;
  pockets: Record<string, {
    targetFixtureCount: number;
    boundFixtures: readonly {
      fixtureId: string;
      competitionKey: string;
      venues: readonly string[];
      basisBuckets: readonly string[];
      overlap: SportsTargetedFixtureOverlapClassification;
    }[];
    admittedUnboundCount: number;
  }>;
}

export interface SportsTargetedOverlapMatrix {
  observedAt: string;
  fixtures: readonly {
    pocket: SportsTargetedPriorityPocket;
    fixtureId: string;
    competitionKey: string;
    fixtureDateKey: string;
    venues: Record<string, {
      state: SportsTargetedRowDiscoveryState;
      basisBuckets: readonly string[];
    }>;
    overlap: SportsTargetedFixtureOverlapClassification;
  }[];
  pockets: Record<string, {
    twoPlusVenueOverlapCount: number;
    threePlusVenueOverlapCount: number;
    comparableOverlapCount: number;
    nonComparableOverlapCount: number;
  }>;
}

export interface SportsMissingVenueRowsSummary {
  observedAt: string;
  pockets: Record<string, {
    missingVenues: Record<string, {
      missingCause: SportsMissingVenueCause;
      fixtureCount: number;
      nextAction: "DISCOVERY" | "CURRENT_STATE_CAPTURE" | "HOLD";
    }>;
  }>;
}

export interface SportsTargetedSupplyRecoveryPlan {
  observedAt: string;
  pockets: Record<string, {
    decision: SportsTargetedPocketDecision;
    recommendedAction: "TARGETED_DISCOVERY_FOR_MISSING_VENUE_ROWS" | "TARGETED_FIXTURE_INGESTION_WINDOW" | "TARGETED_CURRENT_STATE_CAPTURE" | "HOLD_POCKET_WAIT_FOR_SUPPLY";
    rationale: string;
  }>;
}

export interface SportsTargetedPocketPriority {
  observedAt: string;
  sportsFrontierPosition: "SECONDARY_PARALLEL_DISCOVERY_TRACK";
  pockets: readonly {
    rank: number;
    pocket: SportsTargetedPriorityPocket;
    decision: SportsTargetedPocketDecision;
    recommendedAction: SportsTargetedSupplyRecoveryPlan["pockets"][string]["recommendedAction"];
    dominantMissingRowClassification: SportsTargetedFixtureOverlapClassification;
    rationale: string;
  }[];
  heldSupersededPockets: readonly {
    pocket: string;
    status: "HELD_SUPERSEDED";
  }[];
}

export interface SportsTargetedDeltaVsPriorFixtureSupply {
  observedAt: string;
  activePocketDelta: Record<string, {
    fixturesTargeted: number;
    rowsDiscovered: number;
    rowsAdmitted: number;
    rowsBound: number;
    twoPlusVenueOverlap: number;
    dominantBlocker: string;
  }>;
  heldSupersededPockets: readonly string[];
}

export interface SportsPriorityShiftSummary {
  observedAt: string;
  oldPriorityOrder: readonly string[];
  newPriorityOrder: readonly string[];
  heldSupersededPockets: readonly string[];
  rationale: string;
}

export interface SportsTargetedFinalDecision {
  observedAt: string;
  pockets: Record<string, {
    decision: SportsTargetedPocketDecision;
    worthMatchingReopenLater: boolean;
    remainDiscoveryOnly: boolean;
    shouldHold: boolean;
  }>;
  revisedPriorityOrder: readonly SportsTargetedPriorityPocket[];
  singleBestNextSportsAction: string;
  sportsRemainsSecondaryToCrypto: true;
}

export interface SportsTargetedFixtureDiscoveryArtifacts {
  scope: SportsTargetedIngestionScopeArtifact;
  pocketConfigSummary: SportsTargetedPocketConfigSummary;
  liveWindowSummary: SportsLiveWindowSummary;
  discoverySummary: SportsTargetedFixtureDiscoverySummary;
  ingestionSummary: SportsTargetedIngestionSummary;
  fixtureBindingSummary: SportsTargetedFixtureBindingSummary;
  overlapMatrix: SportsTargetedOverlapMatrix;
  missingVenueSummary: SportsMissingVenueRowsSummary;
  supplyRecoveryPlan: SportsTargetedSupplyRecoveryPlan;
  pocketPriority: SportsTargetedPocketPriority;
  deltaVsPriorFixtureSupply: SportsTargetedDeltaVsPriorFixtureSupply;
  priorityShiftSummary: SportsPriorityShiftSummary;
  finalDecision: SportsTargetedFinalDecision;
  operatorSummary: string;
}

interface PriorFixtureSupplyBaseline {
  pockets: Record<string, {
    uniqueFixtures: number;
    admittedRows: number;
    boundRows: number;
    multiVenueOverlap: number;
    dominantBlocker: string | null;
  }>;
}

const increment = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1;
};

const sortNumericRecord = (record: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(record).sort((left, right) => left[0].localeCompare(right[0])));

const bestKey = (record: Record<string, number>): string =>
  Object.entries(record).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "NO_VENUE_MARKET_PROVEN";

const parseJsonFile = <T>(filePath: string): T | null => {
  if (!existsSync(filePath)) {
    return null;
  }
  return readArtifact<T>(path.resolve(filePath, "..", ".."), `docs/${path.basename(filePath)}`);
};

const normalizeVenueInspection = (
  inspection: readonly SportsTargetedVenueInspectionStatus[] | undefined
): readonly SportsTargetedVenueInspectionStatus[] =>
  sportsTargetedVenueAllowlist.map((venue) =>
    inspection?.find((entry) => entry.venue === venue)
    ?? {
      venue,
      inspectionMode: venue === "POLYMARKET" ? "SCOPED_REFRESH_UNAVAILABLE" : "LOCAL_INVENTORY_ONLY",
      fetchStatus: "NOT_ATTEMPTED",
      limitation: venue === "POLYMARKET"
        ? "No scoped refresh seam is wired for this pass; classification is based on current local inventory only."
        : "This pass classified current local inventory without forcing a fresh remote scoped sync."
    }
  );

const isWithinLiveWindow = (input: {
  boundaryDateKey: string | null;
  scheduledBoundaryKey: string | null;
  scope: SportsTargetedIngestionScope;
}): boolean => {
  if (input.scheduledBoundaryKey) {
    const timestamp = Date.parse(input.scheduledBoundaryKey);
    return Number.isFinite(timestamp)
      && timestamp >= Date.parse(input.scope.liveWindow.startsAt)
      && timestamp <= Date.parse(input.scope.liveWindow.endsAt);
  }
  if (!input.boundaryDateKey) {
    return false;
  }
  return input.boundaryDateKey >= input.scope.liveWindow.startsAt.slice(0, 10)
    && input.boundaryDateKey <= input.scope.liveWindow.endsAt.slice(0, 10);
};

const asTargetVenue = (venue: string): typeof sportsTargetedVenueAllowlist[number] | null =>
  sportsTargetedVenueAllowlist.find((entry) => entry === venue) ?? null;

const collectScopedRows = (input: {
  result: SportsPocketMatchingPipelineResult;
  scope: SportsTargetedIngestionScope;
}): readonly ScopedFixtureRow[] => {
  const admissionLookup = new Map(input.result.admissionEvaluations.map((entry) => [entry.market.interpretedContractId, entry]));
  const rows: ScopedFixtureRow[] = [];

  for (const market of input.result.sourceMarkets) {
      const venue = asTargetVenue(market.venue);
      if (!venue || (market.category !== "SPORTS" && market.category !== "ESPORTS")) {
        continue;
      }

      const classification = classifySportsFamily(market);
      if (classification.family !== TARGET_FAMILY || classification.metadata["taxonomyStatus"] !== "ADMITTED") {
        continue;
      }
      const domain = typeof classification.metadata["domain"] === "string" ? classification.metadata["domain"] as "SPORTS" | "ESPORTS" : null;
      if (!domain) {
        continue;
      }

      const competitionContext = normalizeSportsCompetitionContext({
        market,
        domain,
        family: "MATCHUP_WINNER"
      });
      const competitionKey = competitionContext.competitionKey as SportsTargetedCompetitionKey | null;
      const pocket = competitionKey ? mapCompetitionKeyToTargetedPocket(competitionKey) : null;
      if (!pocket || !competitionKey) {
        continue;
      }

      const boundary = extractSportsBoundaryDetailed(market);
      if (!isWithinLiveWindow({
        boundaryDateKey: boundary.dateKey,
        scheduledBoundaryKey: boundary.scheduledBoundaryKey,
        scope: input.scope
      })) {
        continue;
      }

      const subjectNormalization = normalizeSportsSubjectEntities({
        market,
        family: "MATCHUP_WINNER"
      });
      const binding = bindSportsFixtureRow({
        interpretedContractId: market.interpretedContractId,
        venue,
        venueMarketId: market.venueMarketId,
        title: market.title,
        sourceMetadataVersion: market.sourceMetadataVersion,
        historicalRowCount: market.historicalRowCount,
        temporalBasis: market.inventoryTemporalBasis,
        pocket: pocket as SportsFixturePocket,
        domain,
        competitionContext,
        subjectNormalization,
        eventDate: boundary.dateKey,
        timezoneNormalizedCutoff: boundary.scheduledBoundaryKey,
        dateStatus: boundary.status,
        dateSourceProvenance: boundary.dateSourceProvenance,
        timestampSource: boundary.timestampSource
      } satisfies SportsFixtureBindableRowInput);
      const admission = admissionLookup.get(market.interpretedContractId);
      rows.push({
        interpretedContractId: market.interpretedContractId,
        venue,
        title: market.title,
        sourceMetadataVersion: market.sourceMetadataVersion,
        historicalRowCount: market.historicalRowCount,
        temporalBasis: market.inventoryTemporalBasis,
        pocket,
        competitionKey,
        competitionLabel: competitionContext.competitionLabel,
        fixtureDateKey: boundary.dateKey,
        scheduledBoundaryKey: boundary.scheduledBoundaryKey,
        family: classification.family,
        admitted: admission?.accepted ?? false,
        binding
      });
    }

  return rows;
};

const classifyFixtureOverlap = (rows: readonly ScopedFixtureRow[]): SportsTargetedFixtureOverlapClassification => {
  const boundRows = rows.filter((row) => row.binding.bindingOutcome.startsWith("BOUND_"));
  const admittedUnboundRows = rows.filter((row) => row.admitted && !row.binding.bindingOutcome.startsWith("BOUND_"));
  const rejectedRows = rows.filter((row) => !row.admitted);
  const boundVenueCount = new Set(boundRows.map((row) => row.venue)).size;
  const basisBuckets = [...new Set(boundRows.map((row) => row.binding.basisBucket))];

  if (boundVenueCount >= 2 && basisBuckets.length === 1) {
    return "CROSS_VENUE_OVERLAP_PRESENT";
  }
  if (boundVenueCount >= 2 && basisBuckets.length > 1) {
    return "CROSS_VENUE_OVERLAP_NONCOMPARABLE_BASIS";
  }
  if (boundVenueCount === 1) {
    return "BOUND_BUT_SINGLE_VENUE_ONLY";
  }
  if (admittedUnboundRows.length > 0) {
    return "INGESTION_GAP_SUSPECTED";
  }
  if (rejectedRows.length > 0) {
    return "ADMISSION_REJECTION";
  }
  return "NO_VENUE_MARKET_PROVEN";
};

const classifyMissingCause = (input: {
  rowsForVenue: readonly ScopedFixtureRow[];
  venueStatus: SportsTargetedVenueInspectionStatus;
}): SportsMissingVenueCause => {
  if (input.rowsForVenue.some((row) => row.admitted && row.binding.bindingOutcome.startsWith("BOUND_"))) {
    return "VENUE_NOT_LISTING";
  }
  if (input.rowsForVenue.some((row) => row.admitted && !row.binding.bindingOutcome.startsWith("BOUND_"))) {
    return "INGESTION_GAP";
  }
  if (input.rowsForVenue.some((row) => !row.admitted)) {
    return "ADMISSION_REJECTION";
  }
  if (input.venueStatus.fetchStatus === "FAILED") {
    return "STILL_UNKNOWN";
  }
  if (input.venueStatus.inspectionMode === "SCOPED_REFRESH_UNAVAILABLE") {
    return "DISCOVERY_GAP";
  }
  if (input.venueStatus.fetchStatus === "SUCCESS") {
    return "VENUE_NOT_LISTING";
  }
  return "STILL_UNKNOWN";
};

const derivePocketDecision = (input: {
  overlapCounts: SportsTargetedOverlapMatrix["pockets"][string];
  dominantMissing: SportsTargetedFixtureOverlapClassification;
}): SportsTargetedPocketDecision => {
  if (input.overlapCounts.comparableOverlapCount > 0) {
    return input.overlapCounts.twoPlusVenueOverlapCount > 0
      ? "SPORTS_TARGETED_INGESTION_POCKET_READY_FOR_MATCHING_REOPEN"
      : "SPORTS_TARGETED_INGESTION_OVERLAP_IMPROVED";
  }
  if (input.dominantMissing === "DISCOVERY_GAP_SUSPECTED") {
    return "SPORTS_TARGETED_INGESTION_DISCOVERY_GAP_FOUND";
  }
  if (
    input.dominantMissing === "INGESTION_GAP_SUSPECTED"
    || input.dominantMissing === "ADMISSION_REJECTION"
  ) {
    return "SPORTS_TARGETED_INGESTION_INGESTION_GAP_FOUND";
  }
  if (
    input.dominantMissing === "BOUND_BUT_SINGLE_VENUE_ONLY"
    || input.dominantMissing === "NO_VENUE_MARKET_PROVEN"
  ) {
    return "SPORTS_TARGETED_INGESTION_NO_CHANGE_SUPPLY_THIN";
  }
  return "SPORTS_TARGETED_INGESTION_POCKET_STILL_NOT_JUSTIFIED";
};

const buildPriorBaseline = (repoRoot?: string): PriorFixtureSupplyBaseline => {
  if (!repoRoot) {
    return { pockets: {} };
  }
  const summary = parseJsonFile<{
    pockets?: Record<string, {
      admittedRows?: number;
      uniqueFixtures?: number;
      boundConfidentRows?: number;
      boundWarningRows?: number;
      fixturesWithMultiVenueOverlap?: number;
      dominantBlocker?: string | null;
    }>;
  }>(path.resolve(repoRoot, "docs/sports-pocket-supply-summary.json"));

  const pockets = Object.fromEntries(
    Object.entries(summary?.pockets ?? {}).map(([pocket, value]) => [
      pocket,
      {
        uniqueFixtures: value.uniqueFixtures ?? 0,
        admittedRows: value.admittedRows ?? 0,
        boundRows: (value.boundConfidentRows ?? 0) + (value.boundWarningRows ?? 0),
        multiVenueOverlap: value.fixturesWithMultiVenueOverlap ?? 0,
        dominantBlocker: value.dominantBlocker ?? null
      }
    ])
  );
  return { pockets };
};

const buildArtifactsFromScopedRows = (input: {
  scopedRows: readonly ScopedFixtureRow[];
  scope: SportsTargetedIngestionScope;
  venueInspection?: readonly SportsTargetedVenueInspectionStatus[];
  priorBaseline?: PriorFixtureSupplyBaseline;
}): SportsTargetedFixtureDiscoveryArtifacts => {
  const observedAt = new Date().toISOString();
  const venueInspection = normalizeVenueInspection(input.venueInspection);
  const rowsByPocket = sportsTargetedPriorityOrder.reduce<Record<SportsTargetedPriorityPocket, readonly ScopedFixtureRow[]>>((accumulator, pocket) => {
    accumulator[pocket] = input.scopedRows.filter((row) => row.pocket === pocket);
    return accumulator;
  }, {} as Record<SportsTargetedPriorityPocket, readonly ScopedFixtureRow[]>);

  const scopeArtifact: SportsTargetedIngestionScopeArtifact = {
    observedAt,
    ...input.scope
  };
  const pocketConfigSummary: SportsTargetedPocketConfigSummary = {
    observedAt,
    pockets: sportsTargetedPocketConfigs.map((config) => ({
      pocket: config.pocket,
      domain: config.pocket.startsWith("SPORTS|") ? "SPORTS" : "ESPORTS",
      competitions: config.internalCompetitionKeys,
      rollupBucket: config.pocket,
      heldSupersededReferences: sportsHeldPocketReferences
    }))
  };
  const liveWindowSummary: SportsLiveWindowSummary = {
    observedAt,
    lookbackHours: input.scope.liveWindow.lookbackHours,
    lookaheadHours: input.scope.liveWindow.lookaheadHours,
    windowStartIso: input.scope.liveWindow.startsAt,
    windowEndIso: input.scope.liveWindow.endsAt,
    liveWindowPolicy: input.scope.liveWindow.mode,
    shallowLookbackAllowed: true
  };

  const fixtures = new Map<string, ScopedFixtureRow[]>();
  for (const row of input.scopedRows) {
    if (!row.binding.fixtureId) {
      continue;
    }
    const current = fixtures.get(row.binding.fixtureId) ?? [];
    current.push(row);
    fixtures.set(row.binding.fixtureId, current);
  }

  const overlapFixtures = [...fixtures.entries()]
    .map(([fixtureId, rows]) => {
      const pocket = rows[0]!.pocket;
      const competitionKey = rows[0]!.competitionKey;
      const fixtureDateKey = rows[0]!.fixtureDateKey ?? "UNKNOWN_DATE";
      const overlap = classifyFixtureOverlap(rows);
      const venueState = Object.fromEntries(
        sportsTargetedVenueAllowlist.map((venue) => {
          const venueRows = rows.filter((row) => row.venue === venue);
          const state: SportsTargetedRowDiscoveryState =
            venueRows.some((row) => row.admitted && row.binding.bindingOutcome.startsWith("BOUND_")) ? "INGESTED_ADMITTED_BOUND"
            : venueRows.some((row) => row.admitted) ? "INGESTED_ADMITTED_UNBOUND"
            : venueRows.length > 0 ? "INGESTED_REJECTED"
            : venueInspection.find((entry) => entry.venue === venue)?.fetchStatus === "FAILED" ? "UNKNOWN_FETCH_FAILURE"
            : "NOT_DISCOVERED_ON_VENUE";
          return [venue, {
            state,
            basisBuckets: [...new Set(venueRows.map((row) => row.binding.basisBucket))].sort((left, right) => left.localeCompare(right))
          }];
        })
      ) as SportsTargetedOverlapMatrix["fixtures"][number]["venues"];

      return {
        pocket,
        fixtureId,
        competitionKey,
        fixtureDateKey,
        venues: venueState,
        overlap
      };
    })
    .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));

  const overlapPockets = Object.fromEntries(
    sportsTargetedPriorityOrder.map((pocket) => {
      const fixtureRows = overlapFixtures.filter((fixture) => fixture.pocket === pocket);
      return [pocket, {
        twoPlusVenueOverlapCount: fixtureRows.filter((fixture) => fixture.overlap === "CROSS_VENUE_OVERLAP_PRESENT" || fixture.overlap === "CROSS_VENUE_OVERLAP_NONCOMPARABLE_BASIS").length,
        threePlusVenueOverlapCount: fixtureRows.filter((fixture) =>
          Object.values(fixture.venues).filter((venue) => venue.state === "INGESTED_ADMITTED_BOUND").length >= 3
        ).length,
        comparableOverlapCount: fixtureRows.filter((fixture) => fixture.overlap === "CROSS_VENUE_OVERLAP_PRESENT").length,
        nonComparableOverlapCount: fixtureRows.filter((fixture) => fixture.overlap === "CROSS_VENUE_OVERLAP_NONCOMPARABLE_BASIS").length
      }];
    })
  ) as SportsTargetedOverlapMatrix["pockets"];

  const discoverySummary: SportsTargetedFixtureDiscoverySummary = {
    observedAt,
    sportsFrontierPosition: "SECONDARY_PARALLEL_DISCOVERY_TRACK",
    activeScope: sportsTargetedPriorityOrder,
    venueInspection,
    pockets: Object.fromEntries(
      sportsTargetedPriorityOrder.map((pocket) => {
        const rows = rowsByPocket[pocket];
        const discoveredRowsByVenue = Object.fromEntries(sportsTargetedVenueAllowlist.map((venue) => [venue, rows.filter((row) => row.venue === venue).length])) as Record<string, number>;
        const admittedRowsByVenue = Object.fromEntries(sportsTargetedVenueAllowlist.map((venue) => [venue, rows.filter((row) => row.venue === venue && row.admitted).length])) as Record<string, number>;
        const boundRowsByVenue = Object.fromEntries(sportsTargetedVenueAllowlist.map((venue) => [venue, rows.filter((row) => row.venue === venue && row.binding.bindingOutcome.startsWith("BOUND_")).length])) as Record<string, number>;
        const competitionCounts = sortNumericRecord(rows.reduce<Record<string, number>>((accumulator, row) => {
          increment(accumulator, row.competitionKey);
          return accumulator;
        }, {}));
        const targetedFixtures = overlapFixtures.filter((fixture) => fixture.pocket === pocket);
        const overlapCounts = targetedFixtures.reduce<Record<string, number>>((accumulator, fixture) => {
          increment(accumulator, fixture.overlap);
          return accumulator;
        }, {});

        return [pocket, {
          targetFixtureCount: targetedFixtures.length,
          venuesChecked: sportsTargetedVenueAllowlist,
          discoveredRowsByVenue: sortNumericRecord(discoveredRowsByVenue),
          admittedRowsByVenue: sortNumericRecord(admittedRowsByVenue),
          boundRowsByVenue: sortNumericRecord(boundRowsByVenue),
          competitionCounts,
          familyPurity: rows.every((row) => row.family === "MATCHUP_WINNER") ? "MATCHUP_WINNER_ONLY" : "MIXED",
          competitionPurity: rows.every((row) => sportsTargetedPocketConfigs.find((config) => config.pocket === pocket)?.internalCompetitionKeys.includes(row.competitionKey) ?? false) ? "SCOPED_ONLY" : "MIXED",
          dominantMissingRowClassification: bestKey(overlapCounts) as SportsTargetedFixtureOverlapClassification
        }];
      })
    ) as SportsTargetedFixtureDiscoverySummary["pockets"]
  };

  const ingestionSummary: SportsTargetedIngestionSummary = {
    observedAt,
    venueInspection,
    pockets: Object.fromEntries(
      sportsTargetedPriorityOrder.map((pocket) => {
        const rows = rowsByPocket[pocket];
        return [pocket, {
          rowsDiscoveredByVenue: sortNumericRecord(Object.fromEntries(sportsTargetedVenueAllowlist.map((venue) => [venue, rows.filter((row) => row.venue === venue).length]))),
          rowsIngestedByVenue: sortNumericRecord(Object.fromEntries(sportsTargetedVenueAllowlist.map((venue) => [venue, rows.filter((row) => row.venue === venue).length]))),
          rowsRejectedByVenue: sortNumericRecord(Object.fromEntries(sportsTargetedVenueAllowlist.map((venue) => [venue, rows.filter((row) => row.venue === venue && !row.admitted).length]))),
          rowsAdmittedUnboundByVenue: sortNumericRecord(Object.fromEntries(sportsTargetedVenueAllowlist.map((venue) => [venue, rows.filter((row) => row.venue === venue && row.admitted && !row.binding.bindingOutcome.startsWith("BOUND_")).length]))),
          rowsAdmittedBoundByVenue: sortNumericRecord(Object.fromEntries(sportsTargetedVenueAllowlist.map((venue) => [venue, rows.filter((row) => row.venue === venue && row.admitted && row.binding.bindingOutcome.startsWith("BOUND_")).length])))
        }];
      })
    ) as SportsTargetedIngestionSummary["pockets"]
  };

  const fixtureBindingSummary: SportsTargetedFixtureBindingSummary = {
    observedAt,
    pockets: Object.fromEntries(
      sportsTargetedPriorityOrder.map((pocket) => {
        const pocketFixtures = overlapFixtures.filter((fixture) => fixture.pocket === pocket);
        const rows = rowsByPocket[pocket];
        return [pocket, {
          targetFixtureCount: pocketFixtures.length,
          boundFixtures: pocketFixtures.map((fixture) => ({
            fixtureId: fixture.fixtureId,
            competitionKey: fixture.competitionKey,
            venues: Object.entries(fixture.venues).filter(([, value]) => value.state === "INGESTED_ADMITTED_BOUND").map(([venue]) => venue),
            basisBuckets: [...new Set(Object.values(fixture.venues).flatMap((value) => value.basisBuckets))].sort((left, right) => left.localeCompare(right)),
            overlap: fixture.overlap
          })),
          admittedUnboundCount: rows.filter((row) => row.admitted && !row.binding.bindingOutcome.startsWith("BOUND_")).length
        }];
      })
    ) as SportsTargetedFixtureBindingSummary["pockets"]
  };

  const overlapMatrix: SportsTargetedOverlapMatrix = {
    observedAt,
    fixtures: overlapFixtures,
    pockets: overlapPockets
  };

  const missingVenueSummary: SportsMissingVenueRowsSummary = {
    observedAt,
    pockets: Object.fromEntries(
      sportsTargetedPriorityOrder.map((pocket) => {
        const pocketFixtures = overlapFixtures.filter((fixture) => fixture.pocket === pocket);
        const rows = rowsByPocket[pocket];
        const missingByVenue = Object.fromEntries(
          sportsTargetedVenueAllowlist.map((venue) => {
            const venueStatus = venueInspection.find((entry) => entry.venue === venue)!;
            const fixtureCount = pocketFixtures.filter((fixture) => fixture.venues[venue]?.state === "NOT_DISCOVERED_ON_VENUE" || fixture.venues[venue]?.state === "UNKNOWN_FETCH_FAILURE").length;
            const rowsForVenue = rows.filter((row) => row.venue === venue);
            const missingCause = classifyMissingCause({ rowsForVenue, venueStatus });
            return [venue, {
              missingCause,
              fixtureCount,
              nextAction:
                missingCause === "DISCOVERY_GAP" ? "DISCOVERY"
                : missingCause === "INGESTION_GAP" ? "CURRENT_STATE_CAPTURE"
                : "HOLD"
            }];
          })
        ) as SportsMissingVenueRowsSummary["pockets"][string]["missingVenues"];
        return [pocket, { missingVenues: missingByVenue }];
      })
    ) as SportsMissingVenueRowsSummary["pockets"]
  };

  const supplyRecoveryPlan: SportsTargetedSupplyRecoveryPlan = {
    observedAt,
    pockets: Object.fromEntries(
      sportsTargetedPriorityOrder.map((pocket) => {
        const overlapCounts = overlapPockets[pocket]!;
        const dominantMissing = discoverySummary.pockets[pocket]!.dominantMissingRowClassification;
        const decision = derivePocketDecision({ overlapCounts, dominantMissing });
        const recommendedAction =
          decision === "SPORTS_TARGETED_INGESTION_DISCOVERY_GAP_FOUND" ? "TARGETED_DISCOVERY_FOR_MISSING_VENUE_ROWS"
          : decision === "SPORTS_TARGETED_INGESTION_INGESTION_GAP_FOUND" ? "TARGETED_CURRENT_STATE_CAPTURE"
          : decision === "SPORTS_TARGETED_INGESTION_OVERLAP_IMPROVED" ? "TARGETED_FIXTURE_INGESTION_WINDOW"
          : decision === "SPORTS_TARGETED_INGESTION_POCKET_READY_FOR_MATCHING_REOPEN" ? "TARGETED_FIXTURE_INGESTION_WINDOW"
          : "HOLD_POCKET_WAIT_FOR_SUPPLY";
        const rationale =
          decision === "SPORTS_TARGETED_INGESTION_DISCOVERY_GAP_FOUND"
            ? "Fixture binding is clean enough to justify narrow venue-row discovery work."
            : decision === "SPORTS_TARGETED_INGESTION_INGESTION_GAP_FOUND"
              ? "Rows are appearing, but admission or binding is still preventing overlap proof."
              : decision === "SPORTS_TARGETED_INGESTION_OVERLAP_IMPROVED"
                ? "The pocket now has early overlap evidence inside the live window and deserves a tighter fixture capture window."
                : decision === "SPORTS_TARGETED_INGESTION_POCKET_READY_FOR_MATCHING_REOPEN"
                  ? "Real comparable overlap exists in the live window, so the pocket is strong enough for a later matching reopen."
                  : "The pocket remains discovery-only and should stay secondary to crypto.";
        return [pocket, { decision, recommendedAction, rationale }];
      })
    ) as SportsTargetedSupplyRecoveryPlan["pockets"]
  };

  const pocketPriority: SportsTargetedPocketPriority = {
    observedAt,
    sportsFrontierPosition: "SECONDARY_PARALLEL_DISCOVERY_TRACK",
    pockets: sportsTargetedPriorityOrder.map((pocket, index) => ({
      rank: index + 1,
      pocket,
      decision: supplyRecoveryPlan.pockets[pocket]!.decision,
      recommendedAction: supplyRecoveryPlan.pockets[pocket]!.recommendedAction,
      dominantMissingRowClassification: discoverySummary.pockets[pocket]!.dominantMissingRowClassification,
      rationale: supplyRecoveryPlan.pockets[pocket]!.rationale
    })),
    heldSupersededPockets: sportsHeldPocketReferences.map((pocket) => ({
      pocket,
      status: "HELD_SUPERSEDED"
    }))
  };

  const priorBaseline = input.priorBaseline ?? { pockets: {} };
  const deltaVsPriorFixtureSupply: SportsTargetedDeltaVsPriorFixtureSupply = {
    observedAt,
    activePocketDelta: Object.fromEntries(
      sportsTargetedPriorityOrder.map((pocket) => {
        const rows = rowsByPocket[pocket];
        const baseline = priorBaseline.pockets[pocket] ?? {
          uniqueFixtures: 0,
          admittedRows: 0,
          boundRows: 0,
          multiVenueOverlap: 0,
          dominantBlocker: null
        };
        const targetedFixtures = overlapFixtures.filter((fixture) => fixture.pocket === pocket);
        return [pocket, {
          fixturesTargeted: targetedFixtures.length - baseline.uniqueFixtures,
          rowsDiscovered: rows.length,
          rowsAdmitted: rows.filter((row) => row.admitted).length - baseline.admittedRows,
          rowsBound: rows.filter((row) => row.binding.bindingOutcome.startsWith("BOUND_")).length - baseline.boundRows,
          twoPlusVenueOverlap: overlapPockets[pocket]!.twoPlusVenueOverlapCount - baseline.multiVenueOverlap,
          dominantBlocker: discoverySummary.pockets[pocket]!.dominantMissingRowClassification
        }];
      })
    ),
    heldSupersededPockets: sportsHeldPocketReferences
  };

  const priorityShiftSummary: SportsPriorityShiftSummary = {
    observedAt,
    oldPriorityOrder: PRIOR_BASELINE_POCKETS,
    newPriorityOrder: sportsTargetedPriorityOrder,
    heldSupersededPockets: sportsHeldPocketReferences,
    rationale: "The targeted discovery frontier moved to broader live pockets with higher expected cross-venue overlap, while KPL and LCK are held as superseded references."
  };

  const finalDecision: SportsTargetedFinalDecision = {
    observedAt,
    pockets: Object.fromEntries(
      sportsTargetedPriorityOrder.map((pocket) => {
        const decision = supplyRecoveryPlan.pockets[pocket]!.decision;
        return [pocket, {
          decision,
          worthMatchingReopenLater: decision === "SPORTS_TARGETED_INGESTION_POCKET_READY_FOR_MATCHING_REOPEN",
          remainDiscoveryOnly: decision !== "SPORTS_TARGETED_INGESTION_POCKET_READY_FOR_MATCHING_REOPEN",
          shouldHold: decision === "SPORTS_TARGETED_INGESTION_NO_CHANGE_SUPPLY_THIN" || decision === "SPORTS_TARGETED_INGESTION_POCKET_STILL_NOT_JUSTIFIED"
        }];
      })
    ) as SportsTargetedFinalDecision["pockets"],
    revisedPriorityOrder: sportsTargetedPriorityOrder,
    singleBestNextSportsAction:
      pocketPriority.pockets.find((entry) => entry.decision === "SPORTS_TARGETED_INGESTION_POCKET_READY_FOR_MATCHING_REOPEN")?.recommendedAction
      ?? pocketPriority.pockets.find((entry) => entry.decision === "SPORTS_TARGETED_INGESTION_DISCOVERY_GAP_FOUND")?.recommendedAction
      ?? pocketPriority.pockets.find((entry) => entry.decision === "SPORTS_TARGETED_INGESTION_INGESTION_GAP_FOUND")?.recommendedAction
      ?? "HOLD_POCKET_WAIT_FOR_SUPPLY",
    sportsRemainsSecondaryToCrypto: true
  };

  const operatorSummary = [
    "# Sports Targeted Operator Summary",
    "",
    "Sports remains secondary to crypto. This pass only measures live / near-upcoming fixture-backed overlap for the new priority pockets.",
    "",
    ...pocketPriority.pockets.map((entry) => {
      const overlap = overlapPockets[entry.pocket]!;
      return `- ${entry.pocket}: decision=${entry.decision}, action=${entry.recommendedAction}, targetFixtures=${discoverySummary.pockets[entry.pocket]!.targetFixtureCount}, twoPlusOverlap=${overlap.twoPlusVenueOverlapCount}, dominantMissing=${entry.dominantMissingRowClassification}`;
    }),
    `- held/superseded: ${sportsHeldPocketReferences.join(", ")}`,
    `- single best next sports action: ${finalDecision.singleBestNextSportsAction}`,
    `- sports secondary to crypto: ${finalDecision.sportsRemainsSecondaryToCrypto ? "yes" : "no"}`,
    ""
  ].join("\n");

  return {
    scope: scopeArtifact,
    pocketConfigSummary,
    liveWindowSummary,
    discoverySummary,
    ingestionSummary,
    fixtureBindingSummary,
    overlapMatrix,
    missingVenueSummary,
    supplyRecoveryPlan,
    pocketPriority,
    deltaVsPriorFixtureSupply,
    priorityShiftSummary,
    finalDecision,
    operatorSummary
  };
};

export const buildSportsTargetedFixtureDiscoveryArtifactsFromResult = (input: {
  result: SportsPocketMatchingPipelineResult;
  now?: Date;
  venueInspection?: readonly SportsTargetedVenueInspectionStatus[];
  priorBaseline?: PriorFixtureSupplyBaseline;
}): SportsTargetedFixtureDiscoveryArtifacts => {
  const scope = buildSportsTargetedIngestionScope(input.now ?? new Date());
  const scopedRows = collectScopedRows({
    result: input.result,
    scope
  });
  return buildArtifactsFromScopedRows({
    scopedRows,
    scope,
    ...(input.venueInspection ? { venueInspection: input.venueInspection } : {}),
    ...(input.priorBaseline ? { priorBaseline: input.priorBaseline } : {})
  });
};

export const buildSportsTargetedFixtureDiscoveryArtifacts = async (input: {
  pool: Pool;
  now?: Date;
  venueInspection?: readonly SportsTargetedVenueInspectionStatus[];
  repoRoot?: string;
}): Promise<SportsTargetedFixtureDiscoveryArtifacts> => {
  const pipeline = new SportsPocketMatchingPipeline(new PairEdgeRepository(input.pool));
  const result = await pipeline.run();
  return buildSportsTargetedFixtureDiscoveryArtifactsFromResult({
    result,
    ...(input.now ? { now: input.now } : {}),
    ...(input.venueInspection ? { venueInspection: input.venueInspection } : {}),
    priorBaseline: buildPriorBaseline(input.repoRoot)
  });
};
