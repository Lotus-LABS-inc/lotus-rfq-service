import type { Pool } from "pg";

import { PredictReadinessRepository } from "../../repositories/predict-readiness.repository.js";
import {
  getPairFamilyVenues,
  isOneEdgeAwayFromTriEligibility,
  loadExactSeedDefinitions,
  missingPairFamilies,
  resolvePairFamily,
  type ExactSeedDefinition,
  type MissingPairFamily
} from "./exact-seed-shared.js";
import {
  loadSemanticExpansionInventory,
  readArtifact,
  writeArtifact,
  type CrossVenueMatchClass,
  type CrossVenueMatchReport,
  type CrossVenueReportMatchEntry,
  type SemanticExpansionInventoryRow
} from "./shared.js";

type PairFamilySeedStatus =
  | "semantic_exact_historical_qualified"
  | "semantic_exact_live_only"
  | "semantic_near_exact"
  | "blocked_by_compatibility"
  | "no_candidate_found";

type ExactDateReportStatus =
  | "exact_date_found"
  | "wrong_date_same_family"
  | "no_candidate_found"
  | "not_exact_date_searchable";

export interface PairFamilyExactnessReport {
  observedAt: string;
  sourceMatchReportPath: string;
  families: ReadonlyArray<{
    pairFamily: MissingPairFamily;
    venues: readonly string[];
    totalSeedCount: number;
    exactHistoricalQualifiedCount: number;
    exactLiveOnlyCount: number;
    nearExactCount: number;
    blockedCount: number;
    noCandidateCount: number;
    candidateToExactConversionOpportunityRate: number;
    dominantBlockerFamilies: ReadonlyArray<{
      blocker: string;
      count: number;
    }>;
    exactDateSummary: {
      searchableSeedCount: number;
      exactDateFoundCount: number;
      wrongDateFoundCount: number;
      noExactDateCandidateCount: number;
    };
    seeds: ReadonlyArray<{
      seedReference: string;
      category: ExactSeedDefinition["canonicalCategory"];
      title: string;
      memberVenues: readonly string[];
      status: PairFamilySeedStatus;
      oneEdgeAwayFromTriEligibility: boolean;
      exactDateSearchable: boolean;
      exactDateKey: string | null;
          exactDateStatus: ExactDateReportStatus;
      missingVenuesForExactDate: readonly string[];
      dominantFailedDimensions: readonly string[];
      selectedCandidates: ReadonlyArray<{
        venue: string;
        venueMarketId: string;
        title: string;
        matchClass: CrossVenueMatchClass;
        finalConfidence: number;
        failedDimensions: readonly string[];
        compatibilityDecisionClass: string | null;
        acquisitionProvenance: {
          sourceMetadataVersion: string;
          mappingLineage: readonly string[];
          exactSeedAcquisition: boolean;
          exactDateAcquisition: boolean;
          exactDateStatus: string | null;
          exactDateKey: string | null;
          sameDayTargetedIngestion: boolean;
          sourcePolicy: string | null;
          curatedFallbackUsed: boolean;
          targetPairFamilies: readonly string[];
        } | null;
        predictReadiness: {
          state: string;
          historicalQualified: boolean;
          reason: string | null;
        } | null;
      }>;
    }>;
  }>;
}

const rankMatchClass = (value: CrossVenueMatchClass): number =>
  value === "semantic_exact_historical_qualified" ? 5
  : value === "semantic_exact_live_only" ? 4
  : value === "semantic_near_exact" ? 3
  : value === "blocked_by_compatibility" ? 2
  : 1;

const toSeedStatus = (matchClass: CrossVenueMatchClass | null): PairFamilySeedStatus =>
  matchClass === "semantic_exact_historical_qualified" ? "semantic_exact_historical_qualified"
  : matchClass === "semantic_exact_live_only" ? "semantic_exact_live_only"
  : matchClass === "semantic_near_exact" ? "semantic_near_exact"
  : matchClass === "blocked_by_compatibility" ? "blocked_by_compatibility"
  : "no_candidate_found";

const extractFailedDimensions = (match: CrossVenueReportMatchEntry): readonly string[] => {
  const raw = match.semanticValidation.failedDimensions;
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
};

const normalizeBlocker = (match: CrossVenueReportMatchEntry): string =>
  match.matchClass === "blocked_by_compatibility"
    ? `compatibility:${match.compatibilityDecisionClass ?? "unknown"}`
    : extractFailedDimensions(match)[0]
      ?? match.blockReason
      ?? "no_candidate_found";

const aggregateTopStrings = (values: readonly string[]): readonly { blocker: string; count: number }[] =>
  [...values.reduce<Map<string, number>>((accumulator, value) => {
    accumulator.set(value, (accumulator.get(value) ?? 0) + 1);
    return accumulator;
  }, new Map<string, number>()).entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([blocker, count]) => ({ blocker, count }))
    .slice(0, 5);

const selectCandidateRef = (
  seed: ExactSeedDefinition,
  match: CrossVenueReportMatchEntry
) => {
  const seedIsLeft = match.seed.canonicalMarketId === seed.canonicalMarketId;
  const seedIsRight = match.candidate.canonicalMarketId === seed.canonicalMarketId;
  if (seedIsLeft && !seedIsRight) {
    return match.candidate;
  }
  if (seedIsRight && !seedIsLeft) {
    return match.seed;
  }
  const familyVenues = new Set(getPairFamilyVenues(resolvePairFamily(match.seed.venue, match.candidate.venue) ?? missingPairFamilies[0]!));
  if (familyVenues.has(match.candidate.venue) && !seed.memberVenues.includes(match.candidate.venue)) {
    return match.candidate;
  }
  if (familyVenues.has(match.seed.venue) && !seed.memberVenues.includes(match.seed.venue)) {
    return match.seed;
  }
  return match.candidate;
};

const extractTargetPairFamilies = (row: SemanticExpansionInventoryRow | undefined): readonly string[] => {
  if (!row) {
    return [];
  }
  const normalized = row.normalizedPayload.targetPairFamilies;
  if (Array.isArray(normalized)) {
    return normalized.filter((value): value is string => typeof value === "string");
  }
  const raw = row.rawSourcePayload.targetPairFamilies;
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
};

const buildAcquisitionProvenance = (row: SemanticExpansionInventoryRow | undefined) =>
  row ? {
    sourceMetadataVersion: row.sourceMetadataVersion,
    mappingLineage: row.mappingLineage,
    exactSeedAcquisition:
      row.mappingLineage.includes("opinion-exact-seed-acquisition")
      || row.mappingLineage.includes("predict-exact-seed-acquisition"),
    exactDateAcquisition: row.normalizedPayload.exactDateAcquisition === true || row.rawSourcePayload.exactDateAcquisition === true,
    exactDateStatus:
      typeof row.normalizedPayload.exactDateStatus === "string" ? row.normalizedPayload.exactDateStatus
      : typeof row.rawSourcePayload.exactDateStatus === "string" ? row.rawSourcePayload.exactDateStatus
      : null,
    exactDateKey:
      typeof row.normalizedPayload.exactDateKey === "string" ? row.normalizedPayload.exactDateKey
      : typeof row.rawSourcePayload.exactDateKey === "string" ? row.rawSourcePayload.exactDateKey
      : null,
    sameDayTargetedIngestion: row.normalizedPayload.sameDayTargetedIngestion === true || row.rawSourcePayload.sameDayTargetedIngestion === true,
    sourcePolicy:
      typeof row.normalizedPayload.sourcePolicy === "string" ? row.normalizedPayload.sourcePolicy
      : typeof row.rawSourcePayload.sourcePolicy === "string" ? row.rawSourcePayload.sourcePolicy
      : null,
    curatedFallbackUsed: row.normalizedPayload.curatedFallbackUsed === true || row.rawSourcePayload.curatedFallbackUsed === true,
    targetPairFamilies: extractTargetPairFamilies(row)
  } : null;

export const buildPairFamilyExactnessReportFromInputs = (input: {
  report: CrossVenueMatchReport;
  seeds: readonly ExactSeedDefinition[];
  inventoryByKey: ReadonlyMap<string, SemanticExpansionInventoryRow>;
  predictReadinessByMarketId: ReadonlyMap<string, { state: string; historicalQualified: boolean; reason: string | null }>;
  sourceMatchReportPath: string;
}): PairFamilyExactnessReport => {
  const matchesByFamily = new Map<MissingPairFamily, CrossVenueReportMatchEntry[]>();
  for (const family of missingPairFamilies) {
    matchesByFamily.set(family, []);
  }
  for (const match of input.report.matches) {
    const family = resolvePairFamily(match.seed.venue, match.candidate.venue);
    if (family) {
      matchesByFamily.get(family)!.push(match);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    sourceMatchReportPath: input.sourceMatchReportPath,
    families: missingPairFamilies.map((family) => {
      const familyMatches = matchesByFamily.get(family) ?? [];
      const relevantSeeds = input.seeds.filter((seed) => seed.targetPairFamilies.includes(family));
      const seedEntries = relevantSeeds.map((seed) => {
        const seedMatches = familyMatches
          .filter((match) => match.seed.canonicalMarketId === seed.canonicalMarketId || match.candidate.canonicalMarketId === seed.canonicalMarketId)
          .sort((left, right) =>
            rankMatchClass(right.matchClass) - rankMatchClass(left.matchClass)
            || right.finalConfidence - left.finalConfidence
            || left.matchId.localeCompare(right.matchId)
          );
        const bestMatch = seedMatches[0] ?? null;
        const status = toSeedStatus(bestMatch?.matchClass ?? null);
        const familyVenues = getPairFamilyVenues(family);
        const exactDateCandidates = seedMatches
          .slice(0, 3)
          .map((match) => {
            const candidateRef = selectCandidateRef(seed, match);
            const inventoryRow = input.inventoryByKey.get(`${candidateRef.venue}:${candidateRef.venueMarketId}`);
            return {
              candidateRef,
              inventoryRow
            };
          });
        const exactDateFound = exactDateCandidates.some(({ inventoryRow }) =>
          inventoryRow?.normalizedPayload.exactDateAcquisition === true || inventoryRow?.rawSourcePayload.exactDateAcquisition === true
        );
        const wrongDateFound = !exactDateFound && exactDateCandidates.some(({ inventoryRow }) =>
          inventoryRow?.normalizedPayload.exactDateStatus === "wrong_date_same_family"
          || inventoryRow?.rawSourcePayload.exactDateStatus === "wrong_date_same_family"
        );
        const dominantFailedDimensions = [...seedMatches.reduce<Map<string, number>>((accumulator, match) => {
          const dimensions = extractFailedDimensions(match);
          for (const dimension of dimensions) {
            accumulator.set(dimension, (accumulator.get(dimension) ?? 0) + 1);
          }
          return accumulator;
        }, new Map())]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([dimension]) => dimension)
          .slice(0, 5);

        const exactDateStatus: ExactDateReportStatus =
          seed.exactDateSearch === null ? "not_exact_date_searchable"
          : exactDateFound ? "exact_date_found"
          : wrongDateFound ? "wrong_date_same_family"
          : "no_candidate_found";

        return {
          seedReference: seed.seedReference,
          category: seed.canonicalCategory,
          title: seed.title,
          memberVenues: seed.memberVenues,
          status,
          oneEdgeAwayFromTriEligibility: isOneEdgeAwayFromTriEligibility(seed, family, status),
          exactDateSearchable: seed.exactDateSearch !== null,
          exactDateKey: seed.exactDateSearch?.exactDateKey ?? null,
          exactDateStatus,
          missingVenuesForExactDate: seed.exactDateSearch === null
            ? []
            : familyVenues.filter((venue) => !seed.memberVenues.includes(venue)),
          dominantFailedDimensions,
          selectedCandidates: seedMatches.slice(0, 3).map((match) => {
            const candidateRef = selectCandidateRef(seed, match);
            const inventoryRow = input.inventoryByKey.get(`${candidateRef.venue}:${candidateRef.venueMarketId}`);
            return {
              venue: candidateRef.venue,
              venueMarketId: candidateRef.venueMarketId,
              title: candidateRef.title,
              matchClass: match.matchClass,
              finalConfidence: match.finalConfidence,
              failedDimensions: extractFailedDimensions(match),
              compatibilityDecisionClass: match.compatibilityDecisionClass,
              acquisitionProvenance: buildAcquisitionProvenance(inventoryRow),
              predictReadiness: candidateRef.venue === "PREDICT"
                ? input.predictReadinessByMarketId.get(candidateRef.venueMarketId) ?? null
                : null
            };
          })
        };
      });

      const statuses = seedEntries.map((entry) => entry.status);
      const blockers = seedEntries
        .flatMap((entry) => entry.selectedCandidates.length > 0
          ? familyMatches
            .filter((match) => match.seed.canonicalMarketId === entry.seedReference || match.candidate.canonicalMarketId === entry.seedReference)
            .map(normalizeBlocker)
          : ["no_candidate_found"]
        );
      const totalSeedCount = seedEntries.length;
      const exactHistoricalQualifiedCount = statuses.filter((status) => status === "semantic_exact_historical_qualified").length;
      const exactLiveOnlyCount = statuses.filter((status) => status === "semantic_exact_live_only").length;
      const nearExactCount = statuses.filter((status) => status === "semantic_near_exact").length;
      const blockedCount = statuses.filter((status) => status === "blocked_by_compatibility").length;
      const noCandidateCount = statuses.filter((status) => status === "no_candidate_found").length;
      const searchableSeedCount = seedEntries.filter((entry) => entry.exactDateSearchable).length;
      const exactDateFoundCount = seedEntries.filter((entry) => entry.exactDateStatus === "exact_date_found").length;
      const wrongDateFoundCount = seedEntries.filter((entry) => entry.exactDateStatus === "wrong_date_same_family").length;
      const noExactDateCandidateCount = seedEntries.filter((entry) => entry.exactDateStatus === "no_candidate_found").length;

      return {
        pairFamily: family,
        venues: getPairFamilyVenues(family),
        totalSeedCount,
        exactHistoricalQualifiedCount,
        exactLiveOnlyCount,
        nearExactCount,
        blockedCount,
        noCandidateCount,
        candidateToExactConversionOpportunityRate: totalSeedCount === 0
          ? 0
          : Number(((nearExactCount + blockedCount) / totalSeedCount).toFixed(6)),
        dominantBlockerFamilies: aggregateTopStrings(blockers),
        exactDateSummary: {
          searchableSeedCount,
          exactDateFoundCount,
          wrongDateFoundCount,
          noExactDateCandidateCount
        },
        seeds: seedEntries
      };
    })
  };
};

export const buildPairFamilyExactnessReport = async (input: {
  repoRoot: string;
  pool: Pool;
  reportPath?: string;
}): Promise<PairFamilyExactnessReport> => {
  const reportPath = input.reportPath ?? "docs/cross-venue-match-report.json";
  const [report, seeds, inventory] = await Promise.all([
    Promise.resolve(readArtifact<CrossVenueMatchReport>(input.repoRoot, reportPath)),
    loadExactSeedDefinitions(input.pool),
    loadSemanticExpansionInventory(input.pool)
  ]);
  const inventoryByKey = new Map(inventory.map((row) => [`${row.venue}:${row.venueMarketId}`, row] as const));
  const predictMarketIds = [...new Set(
    report.matches.flatMap((match) => [
      match.seed.venue === "PREDICT" ? match.seed.venueMarketId : null,
      match.candidate.venue === "PREDICT" ? match.candidate.venueMarketId : null
    ].filter((value): value is string => value !== null))
  )];
  const predictReadinessRepository = new PredictReadinessRepository(input.pool);
  const predictReadinessByMarketId = await predictReadinessRepository.summarizeReadinessByMarketIds({
    marketIds: predictMarketIds
  });

  const normalizedReadiness = new Map(
    [...predictReadinessByMarketId.entries()].map(([marketId, readiness]) => [marketId, {
      state: readiness.state,
      historicalQualified: readiness.historicalQualified,
      reason: readiness.reason
    }] as const)
  );

  const built = buildPairFamilyExactnessReportFromInputs({
    report,
    seeds,
    inventoryByKey,
    predictReadinessByMarketId: normalizedReadiness,
    sourceMatchReportPath: reportPath
  });
  writeArtifact(input.repoRoot, "docs/pair-family-exactness-report.json", built);
  return built;
};
