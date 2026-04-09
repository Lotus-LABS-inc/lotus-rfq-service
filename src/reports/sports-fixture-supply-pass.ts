import type { Pool } from "pg";

import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import { SportsPocketMatchingPipeline, type SportsPocketMatchingPipelineResult } from "../matching/sports/sports-pocket-matching-pipeline.js";
import { classifySportsFamily } from "../matching/sports/sports-family-classifier.js";
import { normalizeSportsCompetitionContext } from "../matching/sports/sports-competition-context.js";
import { extractSportsBoundaryDetailed } from "../matching/sports/sports-normalization.js";
import { normalizeSportsSubjectEntities } from "../matching/sports/sports-subject-entity.js";
import { bindSportsFixtureRow, type SportsFixtureBindableRowInput } from "../matching/sports/sports-fixture-binder.js";
import { buildSportsFixtureIdentity } from "../matching/sports/sports-fixture-identity.js";
import type {
  SportsFixtureBindingRow,
  SportsFixtureCoverageBlocker,
  SportsFixtureFinalDecisionLabel,
  SportsFixtureIdentity,
  SportsFixturePocket,
  SportsLiveFixtureIngestionReadiness,
  SportsPocketSupplyGap,
  SportsTargetedSupplyRecommendation
} from "../matching/sports/sports-fixture-types.js";
import { sportsFixturePocketValues } from "../matching/sports/sports-fixture-types.js";

const TARGET_VENUES = ["POLYMARKET", "LIMITLESS", "OPINION", "PREDICT"] as const;
const TARGET_COMPETITIONS = ["nba", "dota2_esl", "kpl", "lck"] as const;
const TARGET_SCOPE_PATTERN = /\bnba\b|\bdota2\b|\besl\b|\bkpl\b|\blck\b/i;

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const sortRecord = (value: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(value).sort((a, b) => a[0].localeCompare(b[0])));

const bestKey = (value: Record<string, number>): string | null =>
  Object.entries(value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

const normalizeVenuePairKey = (left: string, right: string): string =>
  [left, right].sort((a, b) => a.localeCompare(b)).join("_");

const asFixturePocket = (input: {
  domain: string | null;
  family: string;
  competitionKey: string | null;
}): SportsFixturePocket | null => {
  if (!input.domain || input.family !== "MATCHUP_WINNER" || !input.competitionKey) {
    return null;
  }
  const candidate = `${input.domain}|MATCHUP_WINNER|${input.competitionKey.toUpperCase()}`;
  return sportsFixturePocketValues.includes(candidate as SportsFixturePocket)
    ? candidate as SportsFixturePocket
    : null;
};

interface FixtureScopeRow {
  interpretedContractId: string;
  venue: string;
  venueMarketId: string;
  title: string;
  temporalBasis: string;
  sourceMetadataVersion: string;
  historicalRowCount: number;
  family: string;
  domain: string | null;
  competitionKey: string | null;
  competitionLabel: string | null;
  pocket: SportsFixturePocket | null;
  binding: SportsFixtureBindingRow;
}

export interface SportsFixtureModelSummary {
  observedAt: string;
  fixtureCountByPocket: Record<string, number>;
  dateStatusCounts: Record<string, number>;
  competitionCounts: Record<string, number>;
  fixtureModelVersion: string;
}

export interface SportsFixtureBindingSummary {
  observedAt: string;
  rows: readonly SportsFixtureBindingRow[];
  outcomeCounts: Record<string, number>;
  bindingReasonCounts: Record<string, number>;
}

export interface SportsFixtureCoverageMatrix {
  observedAt: string;
  fixtures: readonly {
    fixtureId: string;
    fixturePocket: SportsFixturePocket;
    competitionKey: string;
    competitionLabel: string | null;
    canonicalSortedParticipants: readonly string[];
    matchupKey: string;
    fixtureDateKey: string;
    fixtureStartTimestamp: string | null;
    fixtureStartWindowKey: string;
    boundVenueCount: number;
    crossVenueOverlapCount: number;
    comparableOverlapCount: number;
    exactSafeEligibleInPrinciple: boolean;
    blockers: readonly SportsFixtureCoverageBlocker[];
    venueCoverage: Record<string, {
      boundRowCount: number;
      family: string | null;
      basisBuckets: readonly string[];
      bindingOutcomes: readonly string[];
      pairComparableInPrinciple: boolean;
    }>;
  }[];
}

export interface SportsPocketSupplySummary {
  observedAt: string;
  pockets: Record<string, {
    admittedRows: number;
    boundConfidentRows: number;
    boundWarningRows: number;
    unboundRowsByOutcome: Record<string, number>;
    uniqueFixtures: number;
    fixturesWithMultiVenueOverlap: number;
    comparableFixtureOverlapCount: number;
    exactSafeCandidateCountInPrinciple: number;
    perVenueBoundCoverage: Record<string, number>;
    dominantBlocker: string | null;
  }>;
}

export interface SportsPocketGapClassifier {
  observedAt: string;
  pockets: Record<string, {
    gap: SportsPocketSupplyGap;
    rationale: string;
  }>;
}

export interface SportsTargetedSupplyRecoveryPlan {
  observedAt: string;
  pockets: Record<string, {
    recommendation: SportsTargetedSupplyRecommendation;
    targetVenue: string | null;
    targetBasis: string | null;
    rationale: string;
    safeRecoveryHookAvailable: boolean;
  }>;
}

export interface SportsLiveFixtureIngestionReadinessSummary {
  observedAt: string;
  pockets: Record<string, {
    readiness: SportsLiveFixtureIngestionReadiness;
    rationale: string;
  }>;
}

export interface SportsFixtureFinalDecision {
  observedAt: string;
  decision: SportsFixtureFinalDecisionLabel;
  singleBestNextSportsAction: string;
  sportsFrontierRecommendation: "REENTER_MAIN_FRONTIER" | "REMAIN_SECONDARY";
  rationale: string;
}

export interface SportsFixtureSupplyPassArtifacts {
  fixtureModelSummary: SportsFixtureModelSummary;
  fixtureBindingSummary: SportsFixtureBindingSummary;
  fixtureCoverageMatrix: SportsFixtureCoverageMatrix;
  pocketSupplySummary: SportsPocketSupplySummary;
  pocketGapClassifier: SportsPocketGapClassifier;
  targetedSupplyRecoveryPlan: SportsTargetedSupplyRecoveryPlan;
  liveFixtureIngestionReadiness: SportsLiveFixtureIngestionReadinessSummary;
  finalDecision: SportsFixtureFinalDecision;
  operatorSummary: string;
}

const collectFixtureScopeRows = (result: SportsPocketMatchingPipelineResult): readonly FixtureScopeRow[] =>
  result.sourceMarkets
    .filter((market) =>
      (market.category === "SPORTS" || market.category === "ESPORTS")
      && TARGET_VENUES.includes(market.venue as typeof TARGET_VENUES[number])
    )
    .map((market) => {
      const classification = classifySportsFamily(market);
      const domain = typeof classification.metadata["domain"] === "string" ? classification.metadata["domain"] : null;
      const competitionContext =
        domain !== null
          && classification.family === "MATCHUP_WINNER"
          ? normalizeSportsCompetitionContext({
              market,
              domain: domain as "SPORTS" | "ESPORTS",
              family: "MATCHUP_WINNER"
            })
          : null;
      const boundary = extractSportsBoundaryDetailed(market);
      const subjectNormalization =
        classification.family === "MATCHUP_WINNER"
          ? normalizeSportsSubjectEntities({ market, family: "MATCHUP_WINNER" })
          : null;
      const pocket = asFixturePocket({
        domain,
        family: classification.family,
        competitionKey: competitionContext?.competitionKey ?? null
      });
      const inScope =
        pocket !== null
        || TARGET_SCOPE_PATTERN.test(`${market.title} ${market.rulesText ?? ""}`)
        || (competitionContext?.competitionKey ? TARGET_COMPETITIONS.includes(competitionContext.competitionKey as typeof TARGET_COMPETITIONS[number]) : false);

      const bindable: SportsFixtureBindableRowInput = {
        interpretedContractId: market.interpretedContractId,
        venue: market.venue,
        venueMarketId: market.venueMarketId,
        title: market.title,
        sourceMetadataVersion: market.sourceMetadataVersion,
        historicalRowCount: market.historicalRowCount,
        temporalBasis: market.inventoryTemporalBasis,
        pocket: inScope ? pocket : null,
        domain: inScope ? domain : null,
        competitionContext: inScope ? competitionContext : null,
        subjectNormalization: inScope ? subjectNormalization : null,
        eventDate: boundary.dateKey,
        timezoneNormalizedCutoff: boundary.scheduledBoundaryKey,
        dateStatus: boundary.status,
        dateSourceProvenance: boundary.dateSourceProvenance,
        timestampSource: boundary.timestampSource
      };

      return {
        interpretedContractId: market.interpretedContractId,
        venue: market.venue,
        venueMarketId: market.venueMarketId,
        title: market.title,
        temporalBasis: market.inventoryTemporalBasis,
        sourceMetadataVersion: market.sourceMetadataVersion,
        historicalRowCount: market.historicalRowCount,
        family: classification.family,
        domain,
        competitionKey: competitionContext?.competitionKey ?? null,
        competitionLabel: competitionContext?.competitionLabel ?? null,
        pocket: inScope ? pocket : null,
        binding: bindSportsFixtureRow(bindable)
      };
    })
    .filter((row) =>
      row.pocket !== null
      || row.binding.bindingOutcome !== "UNBOUND_OUT_OF_SCOPE"
      || TARGET_SCOPE_PATTERN.test(row.title)
    );

const buildFixtureIndex = (rows: readonly FixtureScopeRow[]): ReadonlyMap<string, readonly FixtureScopeRow[]> => {
  const grouped = new Map<string, FixtureScopeRow[]>();
  for (const row of rows) {
    if (!row.binding.fixtureId) {
      continue;
    }
    const current = grouped.get(row.binding.fixtureId) ?? [];
    current.push(row);
    grouped.set(row.binding.fixtureId, current);
  }
  return grouped;
};

const buildFixtureIdentityFromRows = (rows: readonly FixtureScopeRow[]): SportsFixtureIdentity => {
  const first = rows[0]!;
  return buildSportsFixtureIdentity({
    fixturePocket: first.binding.fixturePocket!,
    domain: first.binding.domain!,
    competitionKey: first.binding.competitionKey!,
    competitionLabel: first.binding.competitionLabel,
    competitionScope: first.binding.competitionScope!,
    canonicalSortedParticipants: first.binding.canonicalSortedParticipants,
    matchupKey: first.binding.matchupKey!,
    fixtureDateKey: first.binding.eventDate!,
    fixtureStartTimestamp: first.binding.fixtureStartTimestamp,
    dateStatus: first.binding.dateStatus,
    dateSourceProvenance: first.binding.dateSourceProvenance,
    timestampSource: first.binding.timestampSource,
    sourceRowIds: rows.map((row) => row.interpretedContractId),
    fixtureStatus: null
  });
};

const buildFixtureModelSummary = (rows: readonly FixtureScopeRow[]): SportsFixtureModelSummary => {
  const fixtureCountByPocket: Record<string, number> = {};
  const dateStatusCounts: Record<string, number> = {};
  const competitionCounts: Record<string, number> = {};

  for (const row of rows.filter((entry) => entry.binding.fixtureId !== null)) {
    if (row.binding.fixturePocket) {
      increment(fixtureCountByPocket, row.binding.fixturePocket);
    }
    increment(dateStatusCounts, row.binding.dateStatus);
    if (row.binding.competitionKey) {
      increment(competitionCounts, row.binding.competitionKey);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    fixtureCountByPocket: sortRecord(fixtureCountByPocket),
    dateStatusCounts: sortRecord(dateStatusCounts),
    competitionCounts: sortRecord(competitionCounts),
    fixtureModelVersion: "sports-fixture-model-v1"
  };
};

const buildFixtureBindingSummary = (rows: readonly FixtureScopeRow[]): SportsFixtureBindingSummary => {
  const outcomeCounts: Record<string, number> = {};
  const bindingReasonCounts: Record<string, number> = {};
  const bindings = rows.map((row) => row.binding);

  for (const row of bindings) {
    increment(outcomeCounts, row.bindingOutcome);
    for (const reason of row.bindingReasons) {
      increment(bindingReasonCounts, reason);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    rows: bindings,
    outcomeCounts: sortRecord(outcomeCounts),
    bindingReasonCounts: sortRecord(bindingReasonCounts)
  };
};

const compareFixtureRowsInPrinciple = (rows: readonly FixtureScopeRow[]): {
  crossVenueOverlapCount: number;
  comparableOverlapCount: number;
  exactSafeEligibleInPrinciple: boolean;
} => {
  const venuePairs = new Set<string>();
  const comparablePairs = new Set<string>();
  let exactSafeEligibleInPrinciple = false;

  for (let index = 0; index < rows.length; index += 1) {
    for (let inner = index + 1; inner < rows.length; inner += 1) {
      const left = rows[index]!;
      const right = rows[inner]!;
      if (left.venue === right.venue) {
        continue;
      }
      const venuePair = normalizeVenuePairKey(left.venue, right.venue);
      venuePairs.add(venuePair);
      if (left.binding.basisBucket === right.binding.basisBucket) {
        comparablePairs.add(venuePair);
        if (
          left.binding.bindingOutcome.startsWith("BOUND_")
          && right.binding.bindingOutcome.startsWith("BOUND_")
        ) {
          exactSafeEligibleInPrinciple = true;
        }
      }
    }
  }

  return {
    crossVenueOverlapCount: venuePairs.size,
    comparableOverlapCount: comparablePairs.size,
    exactSafeEligibleInPrinciple
  };
};

const buildFixtureCoverageMatrix = (rows: readonly FixtureScopeRow[]): SportsFixtureCoverageMatrix => {
  const byFixture = buildFixtureIndex(rows);
  const fixtures = [...byFixture.values()]
    .map((fixtureRows) => {
      const identity = buildFixtureIdentityFromRows(fixtureRows);
      const overlap = compareFixtureRowsInPrinciple(fixtureRows);
      const blockers = new Set<SportsFixtureCoverageBlocker>();
      const venueCoverage = Object.fromEntries(
        TARGET_VENUES.map((venue) => {
          const venueRows = fixtureRows.filter((row) => row.venue === venue);
          return [venue, {
            boundRowCount: venueRows.length,
            family: venueRows[0]?.family ?? null,
            basisBuckets: [...new Set(venueRows.map((row) => row.binding.basisBucket))].sort((a, b) => a.localeCompare(b)),
            bindingOutcomes: [...new Set(venueRows.map((row) => row.binding.bindingOutcome))].sort((a, b) => a.localeCompare(b)),
            pairComparableInPrinciple: venueRows.length > 0 && fixtureRows.some((other) =>
              other.venue !== venue && other.binding.basisBucket === venueRows[0]!.binding.basisBucket
            )
          }];
        })
      ) as Record<string, {
        boundRowCount: number;
        family: string | null;
        basisBuckets: readonly string[];
        bindingOutcomes: readonly string[];
        pairComparableInPrinciple: boolean;
      }>;

      if (new Set(fixtureRows.map((row) => row.venue)).size < 2) {
        blockers.add("MISSING_VENUE_SUPPLY");
      }
      if (overlap.crossVenueOverlapCount > 0 && overlap.comparableOverlapCount === 0) {
        blockers.add("BASIS_FRAGMENTED");
      }
      if (rows.some((row) =>
        row.binding.fixturePocket === identity.fixturePocket
        && row.binding.competitionKey === identity.competitionKey
        && row.binding.matchupKey === identity.matchupKey
        && row.binding.bindingOutcome === "UNBOUND_MISSING_DATE"
      )) {
        blockers.add("UNBOUND_DATE");
      }
      if (rows.some((row) =>
        row.binding.fixturePocket === identity.fixturePocket
        && row.binding.competitionKey === identity.competitionKey
        && row.binding.matchupKey === identity.matchupKey
        && row.binding.bindingOutcome === "UNBOUND_MISSING_OPPONENT"
      )) {
        blockers.add("UNBOUND_IDENTITY");
      }
      if (rows.some((row) =>
        row.binding.fixturePocket === identity.fixturePocket
        && row.binding.competitionKey === identity.competitionKey
        && row.binding.bindingOutcome === "UNBOUND_COMPETITION_DRIFT"
      )) {
        blockers.add("COMPETITION_DRIFT");
      }
      if (rows.some((row) =>
        row.binding.fixturePocket === identity.fixturePocket
        && row.binding.bindingOutcome === "UNBOUND_NON_FIXTURE_ROW"
      )) {
        blockers.add("NON_FIXTURE_CONTAMINATION");
      }

      return {
        fixtureId: identity.fixtureId,
        fixturePocket: identity.fixturePocket,
        competitionKey: identity.competitionKey,
        competitionLabel: identity.competitionLabel,
        canonicalSortedParticipants: identity.canonicalSortedParticipants,
        matchupKey: identity.matchupKey,
        fixtureDateKey: identity.fixtureDateKey,
        fixtureStartTimestamp: identity.fixtureStartTimestamp,
        fixtureStartWindowKey: identity.fixtureStartWindowKey,
        boundVenueCount: new Set(fixtureRows.map((row) => row.venue)).size,
        crossVenueOverlapCount: overlap.crossVenueOverlapCount,
        comparableOverlapCount: overlap.comparableOverlapCount,
        exactSafeEligibleInPrinciple: overlap.exactSafeEligibleInPrinciple,
        blockers: [...blockers].sort((a, b) => a.localeCompare(b)),
        venueCoverage
      };
    })
    .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));

  return {
    observedAt: new Date().toISOString(),
    fixtures
  };
};

const buildPocketSupplySummary = (
  rows: readonly FixtureScopeRow[],
  coverageMatrix: SportsFixtureCoverageMatrix
): SportsPocketSupplySummary => {
  const pockets = Object.fromEntries(
    sportsFixturePocketValues.map((pocket) => [pocket, {
      admittedRows: 0,
      boundConfidentRows: 0,
      boundWarningRows: 0,
      unboundRowsByOutcome: {} as Record<string, number>,
      uniqueFixtures: 0,
      fixturesWithMultiVenueOverlap: 0,
      comparableFixtureOverlapCount: 0,
      exactSafeCandidateCountInPrinciple: 0,
      perVenueBoundCoverage: Object.fromEntries(TARGET_VENUES.map((venue) => [venue, 0])) as Record<string, number>,
      dominantBlocker: null as string | null
    }])
  ) as SportsPocketSupplySummary["pockets"];

  const blockerCountsByPocket: Record<string, Record<string, number>> = {};
  for (const row of rows.filter((entry) => entry.binding.fixturePocket !== null)) {
    const summary = pockets[row.binding.fixturePocket!]!;
    summary.admittedRows += 1;
    if (row.binding.bindingOutcome === "BOUND_CONFIDENT") {
      summary.boundConfidentRows += 1;
      increment(summary.perVenueBoundCoverage, row.venue);
    } else if (row.binding.bindingOutcome === "BOUND_WITH_PROVENANCE_WARNING") {
      summary.boundWarningRows += 1;
      increment(summary.perVenueBoundCoverage, row.venue);
    } else {
      increment(summary.unboundRowsByOutcome, row.binding.bindingOutcome);
    }
  }

  for (const fixture of coverageMatrix.fixtures) {
    const summary = pockets[fixture.fixturePocket]!;
    summary.uniqueFixtures += 1;
    if (fixture.boundVenueCount >= 2) {
      summary.fixturesWithMultiVenueOverlap += 1;
    }
    if (fixture.comparableOverlapCount > 0) {
      summary.comparableFixtureOverlapCount += 1;
    }
    if (fixture.exactSafeEligibleInPrinciple) {
      summary.exactSafeCandidateCountInPrinciple += 1;
    }
    blockerCountsByPocket[fixture.fixturePocket] ??= {};
    for (const blocker of fixture.blockers) {
      increment(blockerCountsByPocket[fixture.fixturePocket]!, blocker);
    }
  }

  for (const pocket of sportsFixturePocketValues) {
    const summary = pockets[pocket]!;
    const aggregateBlockers = {
      ...(blockerCountsByPocket[pocket] ?? {}),
      ...summary.unboundRowsByOutcome
    };
    summary.unboundRowsByOutcome = sortRecord(summary.unboundRowsByOutcome);
    summary.perVenueBoundCoverage = sortRecord(summary.perVenueBoundCoverage);
    summary.dominantBlocker = bestKey(aggregateBlockers);
  }

  return {
    observedAt: new Date().toISOString(),
    pockets
  };
};

const classifyPocketGap = (summary: SportsPocketSupplySummary["pockets"][SportsFixturePocket]): SportsPocketSupplyGap => {
  if (summary.admittedRows === 0) {
    return "TOO_THIN_TO_JUSTIFY";
  }
  if (summary.uniqueFixtures === 0) {
    return Object.keys(summary.unboundRowsByOutcome).length > 0 ? "BINDING_INCOMPLETE" : "TOO_THIN_TO_JUSTIFY";
  }
  if (summary.exactSafeCandidateCountInPrinciple > 0) {
    return "BINDABLE_AND_PROMISING";
  }
  if (summary.fixturesWithMultiVenueOverlap > 0 && summary.comparableFixtureOverlapCount === 0) {
    return "BASIS_FRAGMENTED";
  }
  if (Object.keys(summary.unboundRowsByOutcome).length > 0 && summary.boundConfidentRows + summary.boundWarningRows < summary.admittedRows) {
    return "UNBOUND_SUPPLY_PRESENT";
  }
  return "SUPPLY_THIN";
};

const buildPocketGapClassifier = (summary: SportsPocketSupplySummary): SportsPocketGapClassifier => ({
  observedAt: new Date().toISOString(),
  pockets: Object.fromEntries(
    Object.entries(summary.pockets).map(([pocket, entry]) => {
      const gap = classifyPocketGap(entry);
      const rationale =
        gap === "BINDABLE_AND_PROMISING"
          ? "The pocket now has comparable multi-venue fixtures that are exact-safe eligible in principle."
          : gap === "BASIS_FRAGMENTED"
            ? "Fixtures bind across venues, but basis divergence still blocks comparability."
            : gap === "UNBOUND_SUPPLY_PRESENT"
              ? "Rows exist, but too many remain unbound because date or identity proof is incomplete."
              : gap === "SUPPLY_THIN"
                ? "Fixture identity is mostly clean, but the pocket remains single-venue or near-single-venue."
                : gap === "BINDING_INCOMPLETE"
                  ? "The pocket still lacks enough deterministic binding to support stronger supply actions."
                  : "The pocket remains too thin to justify further sports investment.";
      return [pocket, { gap, rationale }];
    })
  ) as SportsPocketGapClassifier["pockets"]
});

const recommendationForPocket = (input: {
  summary: SportsPocketSupplySummary["pockets"][SportsFixturePocket];
  gap: SportsPocketSupplyGap;
}): {
  recommendation: SportsTargetedSupplyRecommendation;
  targetVenue: string | null;
  targetBasis: string | null;
  rationale: string;
  safeRecoveryHookAvailable: boolean;
} => {
  const safeRecoveryHookAvailable = false;
  if (input.gap === "BASIS_FRAGMENTED") {
    return {
      recommendation: "TARGETED_CURRENT_STATE_CAPTURE",
      targetVenue: "POLYMARKET",
      targetBasis: "CURRENT_STATE",
      rationale: "The fixture overlap already exists across venues, so the smallest justified next move is to capture a converged current-state basis window.",
      safeRecoveryHookAvailable
    };
  }
  if (input.gap === "BINDABLE_AND_PROMISING") {
    return {
      recommendation: "TARGETED_DISCOVERY_FOR_MISSING_VENUE_ROWS",
      targetVenue: "POLYMARKET",
      targetBasis: null,
      rationale: "The pocket has fixture-backed exact-safe potential and now primarily needs missing venue rows.",
      safeRecoveryHookAvailable
    };
  }
  if (input.gap === "SUPPLY_THIN" && input.summary.boundConfidentRows + input.summary.boundWarningRows >= 4) {
    return {
      recommendation: "TARGETED_DISCOVERY_FOR_MISSING_VENUE_ROWS",
      targetVenue: "POLYMARKET",
      targetBasis: null,
      rationale: "The pocket binds cleanly enough that narrow venue discovery is justified before any broader sports work.",
      safeRecoveryHookAvailable
    };
  }
  return {
    recommendation: "HOLD_POCKET_WAIT_FOR_SUPPLY",
    targetVenue: null,
    targetBasis: null,
    rationale: "The pocket is not yet strong enough to justify a narrower supply action.",
    safeRecoveryHookAvailable
  };
};

const buildTargetedSupplyRecoveryPlan = (
  summary: SportsPocketSupplySummary,
  classifier: SportsPocketGapClassifier
): SportsTargetedSupplyRecoveryPlan => ({
  observedAt: new Date().toISOString(),
  pockets: Object.fromEntries(
    sportsFixturePocketValues.map((pocket) => [
      pocket,
      recommendationForPocket({
        summary: summary.pockets[pocket]!,
        gap: classifier.pockets[pocket]!.gap
      })
    ])
  ) as SportsTargetedSupplyRecoveryPlan["pockets"]
});

const buildLiveFixtureIngestionReadiness = (input: {
  classifier: SportsPocketGapClassifier;
  recoveryPlan: SportsTargetedSupplyRecoveryPlan;
}): SportsLiveFixtureIngestionReadinessSummary => ({
  observedAt: new Date().toISOString(),
  pockets: Object.fromEntries(
    sportsFixturePocketValues.map((pocket) => {
      const gap = input.classifier.pockets[pocket]!.gap;
      const recommendation = input.recoveryPlan.pockets[pocket]!.recommendation;
      const readiness: SportsLiveFixtureIngestionReadiness =
        gap === "BASIS_FRAGMENTED" && recommendation === "TARGETED_CURRENT_STATE_CAPTURE"
          ? "HIGH_VALUE_NOW"
          : gap === "BINDABLE_AND_PROMISING"
            ? "USEFUL_BUT_PREMATURE"
            : gap === "SUPPLY_THIN"
              ? "LOW_VALUE_UNTIL_SUPPLY_IMPROVES"
              : "NOT_JUSTIFIED";
      const rationale =
        readiness === "HIGH_VALUE_NOW"
          ? "Fixture binding is strong enough that a narrow live/current-state capture window could close a missing basis leg."
          : readiness === "USEFUL_BUT_PREMATURE"
            ? "The pocket binds well, but venue overlap is still too sparse for immediate live capture."
            : readiness === "LOW_VALUE_UNTIL_SUPPLY_IMPROVES"
              ? "Live snapshots would likely add more single-venue rows before they add comparable overlap."
              : "The pocket is still too unresolved or too thin for live fixture ingestion to be useful.";
      return [pocket, { readiness, rationale }];
    })
  ) as SportsLiveFixtureIngestionReadinessSummary["pockets"]
});

const buildFinalDecision = (input: {
  classifier: SportsPocketGapClassifier;
  recoveryPlan: SportsTargetedSupplyRecoveryPlan;
  readiness: SportsLiveFixtureIngestionReadinessSummary;
}): SportsFixtureFinalDecision => {
  const gaps = sportsFixturePocketValues.map((pocket) => input.classifier.pockets[pocket]!.gap);
  const hasHighValueLive = sportsFixturePocketValues.some((pocket) => input.readiness.pockets[pocket]!.readiness === "HIGH_VALUE_NOW");
  const hasTargetedSupplyNext = sportsFixturePocketValues.some((pocket) => {
    const recommendation = input.recoveryPlan.pockets[pocket]!.recommendation;
    return recommendation === "TARGETED_DISCOVERY_FOR_MISSING_VENUE_ROWS"
      || recommendation === "TARGETED_HISTORICAL_BACKFILL"
      || recommendation === "TARGETED_CURRENT_STATE_CAPTURE";
  });
  const basisDominant = sportsFixturePocketValues.some((pocket) => input.classifier.pockets[pocket]!.gap === "BASIS_FRAGMENTED");
  const cleanButWaiting = sportsFixturePocketValues.some((pocket) => input.classifier.pockets[pocket]!.gap === "SUPPLY_THIN");
  const allTooThin = gaps.every((gap) => gap === "SUPPLY_THIN" || gap === "TOO_THIN_TO_JUSTIFY");

  const decision: SportsFixtureFinalDecisionLabel =
    hasHighValueLive ? "SPORTS_FIXTURE_BINDING_READY__LIVE_FIXTURE_INGESTION_JUSTIFIED"
    : hasTargetedSupplyNext && !basisDominant ? "SPORTS_FIXTURE_BINDING_READY__TARGETED_SUPPLY_RECOVERY_NEXT"
    : basisDominant ? "SPORTS_FIXTURE_BINDING_READY__BASIS_FRAGMENTATION_DOMINANT"
    : cleanButWaiting ? "SPORTS_FIXTURE_BINDING_READY__WAITING_ON_VENUE_SUPPLY"
    : allTooThin ? "SPORTS_FIXTURE_BINDING_READY__POCKETS_TOO_THIN"
    : "SPORTS_FIXTURE_BINDING_INCOMPLETE__MANUAL_REVIEW_NEEDED";

  const singleBestNextSportsAction =
    decision === "SPORTS_FIXTURE_BINDING_READY__LIVE_FIXTURE_INGESTION_JUSTIFIED"
      ? "TARGETED_CURRENT_STATE_CAPTURE"
      : decision === "SPORTS_FIXTURE_BINDING_READY__TARGETED_SUPPLY_RECOVERY_NEXT"
        ? "TARGETED_DISCOVERY_FOR_MISSING_VENUE_ROWS"
        : decision === "SPORTS_FIXTURE_BINDING_READY__BASIS_FRAGMENTATION_DOMINANT"
          ? "TARGETED_CURRENT_STATE_CAPTURE"
          : decision === "SPORTS_FIXTURE_BINDING_READY__WAITING_ON_VENUE_SUPPLY"
            ? "HOLD_POCKET_WAIT_FOR_SUPPLY"
            : "HOLD_SPORTS_AND_RETURN_TO_OTHER_FRONTIER";

  const sportsFrontierRecommendation =
    decision === "SPORTS_FIXTURE_BINDING_READY__LIVE_FIXTURE_INGESTION_JUSTIFIED"
    || decision === "SPORTS_FIXTURE_BINDING_READY__TARGETED_SUPPLY_RECOVERY_NEXT"
      ? "REENTER_MAIN_FRONTIER"
      : "REMAIN_SECONDARY";

  const rationale =
    decision === "SPORTS_FIXTURE_BINDING_READY__LIVE_FIXTURE_INGESTION_JUSTIFIED"
      ? "At least one pocket now binds fixtures strongly enough that live fixture capture is likely to improve comparable supply."
      : decision === "SPORTS_FIXTURE_BINDING_READY__TARGETED_SUPPLY_RECOVERY_NEXT"
        ? "Fixture binding is strong enough that the next highest-ROI move is a narrow supply recovery rather than more matcher work."
        : decision === "SPORTS_FIXTURE_BINDING_READY__BASIS_FRAGMENTATION_DOMINANT"
          ? "The main blocker is now converging basis across already bindable cross-venue fixtures."
          : decision === "SPORTS_FIXTURE_BINDING_READY__WAITING_ON_VENUE_SUPPLY"
            ? "The pockets bind cleanly enough to diagnose supply, but they still lack enough cross-venue rows to justify more active sports work."
            : decision === "SPORTS_FIXTURE_BINDING_READY__POCKETS_TOO_THIN"
              ? "All scoped pockets remain too shallow after binding to justify another sports pass."
              : "The current fixture binder still cannot classify enough scoped rows deterministically to support a stronger decision.";

  return {
    observedAt: new Date().toISOString(),
    decision,
    singleBestNextSportsAction,
    sportsFrontierRecommendation,
    rationale
  };
};

const buildOperatorSummary = (input: {
  summary: SportsPocketSupplySummary;
  classifier: SportsPocketGapClassifier;
  readiness: SportsLiveFixtureIngestionReadinessSummary;
  finalDecision: SportsFixtureFinalDecision;
}): string => [
  "# Sports Fixture Operator Summary",
  "",
  ...sportsFixturePocketValues.map((pocket, index) => {
    const summary = input.summary.pockets[pocket]!;
    return `${index + 1}. ${pocket}: admitted=${summary.admittedRows}, fixtures=${summary.uniqueFixtures}, multiVenue=${summary.fixturesWithMultiVenueOverlap}, comparable=${summary.comparableFixtureOverlapCount}, gap=${input.classifier.pockets[pocket]!.gap}, liveReadiness=${input.readiness.pockets[pocket]!.readiness}.`;
  }),
  `${sportsFixturePocketValues.length + 1}. Final decision: ${input.finalDecision.decision}.`,
  `${sportsFixturePocketValues.length + 2}. Single best next sports action: ${input.finalDecision.singleBestNextSportsAction}.`,
  `${sportsFixturePocketValues.length + 3}. Sports frontier priority: ${input.finalDecision.sportsFrontierRecommendation}.`,
  ""
].join("\n");

export const buildSportsFixtureSupplyArtifactsFromResult = (input: {
  result: SportsPocketMatchingPipelineResult;
}): SportsFixtureSupplyPassArtifacts => {
  const rows = collectFixtureScopeRows(input.result);
  const fixtureModelSummary = buildFixtureModelSummary(rows);
  const fixtureBindingSummary = buildFixtureBindingSummary(rows);
  const fixtureCoverageMatrix = buildFixtureCoverageMatrix(rows);
  const pocketSupplySummary = buildPocketSupplySummary(rows, fixtureCoverageMatrix);
  const pocketGapClassifier = buildPocketGapClassifier(pocketSupplySummary);
  const targetedSupplyRecoveryPlan = buildTargetedSupplyRecoveryPlan(pocketSupplySummary, pocketGapClassifier);
  const liveFixtureIngestionReadiness = buildLiveFixtureIngestionReadiness({
    classifier: pocketGapClassifier,
    recoveryPlan: targetedSupplyRecoveryPlan
  });
  const finalDecision = buildFinalDecision({
    classifier: pocketGapClassifier,
    recoveryPlan: targetedSupplyRecoveryPlan,
    readiness: liveFixtureIngestionReadiness
  });

  return {
    fixtureModelSummary,
    fixtureBindingSummary,
    fixtureCoverageMatrix,
    pocketSupplySummary,
    pocketGapClassifier,
    targetedSupplyRecoveryPlan,
    liveFixtureIngestionReadiness,
    finalDecision,
    operatorSummary: buildOperatorSummary({
      summary: pocketSupplySummary,
      classifier: pocketGapClassifier,
      readiness: liveFixtureIngestionReadiness,
      finalDecision
    })
  };
};

export const buildSportsFixtureSupplyArtifacts = async (input: {
  pool: Pool;
}): Promise<SportsFixtureSupplyPassArtifacts> => {
  const pipeline = new SportsPocketMatchingPipeline(new PairEdgeRepository(input.pool));
  const result = await pipeline.run();
  return buildSportsFixtureSupplyArtifactsFromResult({ result });
};

const buildListMarkdown = (title: string, lines: readonly string[]): string => [
  `# ${title}`,
  "",
  ...lines,
  ""
].join("\n");

export const buildSportsFixtureModelSummaryMarkdown = (artifact: SportsFixtureModelSummary): string =>
  buildListMarkdown("Sports Fixture Model Summary", [
    `- fixture model version: ${artifact.fixtureModelVersion}`,
    `- fixtures by pocket: ${Object.entries(artifact.fixtureCountByPocket).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
    `- date statuses: ${Object.entries(artifact.dateStatusCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildSportsFixtureBindingSummaryMarkdown = (artifact: SportsFixtureBindingSummary): string =>
  buildListMarkdown("Sports Fixture Binding Summary", [
    `- binding outcomes: ${Object.entries(artifact.outcomeCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
    `- binding reasons: ${Object.entries(artifact.bindingReasonCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`
  ]);

export const buildSportsFixtureCoverageMatrixMarkdown = (artifact: SportsFixtureCoverageMatrix): string =>
  buildListMarkdown("Sports Fixture Coverage Matrix", artifact.fixtures.map((fixture) =>
    `- ${fixture.fixturePocket} | ${fixture.fixtureId}: venues=${fixture.boundVenueCount}, comparable=${fixture.comparableOverlapCount}, exactSafeEligible=${fixture.exactSafeEligibleInPrinciple ? "yes" : "no"}, blockers=${fixture.blockers.join(", ") || "none"}`
  ));

export const buildSportsPocketSupplySummaryMarkdown = (artifact: SportsPocketSupplySummary): string =>
  buildListMarkdown("Sports Pocket Supply Summary", Object.entries(artifact.pockets).map(([pocket, summary]) =>
    `- ${pocket}: admitted=${summary.admittedRows}, fixtures=${summary.uniqueFixtures}, multiVenue=${summary.fixturesWithMultiVenueOverlap}, comparable=${summary.comparableFixtureOverlapCount}, exactSafeCandidates=${summary.exactSafeCandidateCountInPrinciple}, dominantBlocker=${summary.dominantBlocker ?? "none"}`
  ));

export const buildSportsTargetedSupplyRecoveryPlanMarkdown = (artifact: SportsTargetedSupplyRecoveryPlan): string =>
  buildListMarkdown("Sports Targeted Supply Recovery Plan", Object.entries(artifact.pockets).map(([pocket, summary]) =>
    `- ${pocket}: ${summary.recommendation}${summary.targetVenue ? `, targetVenue=${summary.targetVenue}` : ""}${summary.targetBasis ? `, targetBasis=${summary.targetBasis}` : ""}`
  ));

export const buildSportsLiveFixtureIngestionReadinessMarkdown = (artifact: SportsLiveFixtureIngestionReadinessSummary): string =>
  buildListMarkdown("Sports Live Fixture Ingestion Readiness", Object.entries(artifact.pockets).map(([pocket, summary]) =>
    `- ${pocket}: ${summary.readiness}`
  ));
