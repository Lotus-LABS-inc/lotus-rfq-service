import type { Pool } from "pg";

import { CanonicalGraphProjector } from "../../canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../canonical/canonical-compatibility-projector.js";
import { buildStableTextId } from "../../canonical/canonicalization-types.js";
import { CuratedCanonicalGraphSnapshotBuilder } from "../../canonical/curated-canonical-graph.js";
import {
  HistoricalMarketClass,
  HistoricalSimulationRouteModeDefinitions,
  type CreateHistoricalMarketStateInput
} from "../../core/historical-simulation/historical-simulation.types.js";
import { CanonicalCompatibilityRepository } from "../../repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../../repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../../repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../../repositories/historical-market-state.repository.js";
import { buildCategoryGroupedCanonicalReport } from "../fast-testing/simulation-canonical-report.js";
import { createSimulationAdminService } from "../fast-testing/simulation-admin-service-factory.js";
import {
  readArtifact,
  writeArtifact,
  loadSemanticExpansionInventory,
  semanticExpansionVenues,
  type CrossVenueMatchReport,
  type SemanticExpansionInventoryRow
} from "./shared.js";
import {
  hydrateInventoryRowToExecutableSeed,
  loadHydratedCanonicalMarketSeeds,
  type HydratedPromotionSeed
} from "./executable-grade-seed-hydrator.js";

export interface SemanticExactSyncSummary {
  observedAt: string;
  processedPromotionCandidates: number;
  promotedHistoricalQualified: number;
  promotedLiveOnly: number;
  remappedHistoricalRows: number;
  insertedSyntheticRows: number;
  updatedCanonicalReportPath: string;
  promotedTargets: ReadonlyArray<{
    promotionId: string;
    targetCanonicalEventId: string;
    targetCanonicalMarketId: string;
    promotionClass: string;
    memberCount: number;
    hydration: ReadonlyArray<{
      venue: string;
      venueMarketId: string;
      hydrationSource: string;
      usedFallback: boolean;
    }>;
  }>;
  skippedTargets: ReadonlyArray<{
    promotionId: string;
    reason: string;
    hydration: ReadonlyArray<{
      venue: string;
      venueMarketId: string;
      hydrationSource: string;
      usedFallback: boolean;
    }>;
  }>;
}

const toSyntheticState = (row: SemanticExpansionInventoryRow, target: {
  canonicalEventId: string;
  canonicalMarketId: string;
  promotionClass: string;
}): CreateHistoricalMarketStateInput => {
  const timestamp = row.expiresAt
    ? new Date(row.expiresAt)
    : row.publishedAt
      ? new Date(row.publishedAt)
      : new Date();

  return {
    canonicalEventId: target.canonicalEventId,
    canonicalMarketId: target.canonicalMarketId,
    canonicalCategory:
      row.canonicalCategory === "POLITICS"
      || row.canonicalCategory === "CRYPTO"
      || row.canonicalCategory === "SPORTS"
      || row.canonicalCategory === "ESPORTS"
        ? row.canonicalCategory
        : "OTHER",
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    marketClass:
      row.marketClass === "BINARY" || row.marketClass === "CATEGORICAL" || row.marketClass === "SCALAR"
        ? (row.marketClass as HistoricalMarketClass)
        : HistoricalMarketClass.BINARY,
    timestamp,
    midpoint: null,
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: null,
    volume: null,
    openInterest: null,
    orderbookSnapshot: {
      source: "semantic_exact_overlap_projection",
      promotionClass: target.promotionClass,
      title: row.title
    },
    marketEvents: {
      source: "semantic_exact_overlap_projection",
      promotionClass: target.promotionClass,
      title: row.title
    },
    metadataVersion: "semantic-exact-overlap-v1",
    sourceTimestamp: timestamp
  };
};

const remapHistoricalRows = async (
  pool: Pool,
  row: SemanticExpansionInventoryRow,
  target: { canonicalEventId: string; canonicalMarketId: string }
): Promise<number> => {
  const result = await pool.query(
    `UPDATE historical_market_states
        SET canonical_event_id = $1,
            canonical_market_id = $2,
            canonical_category = $3
      WHERE venue = $4
        AND venue_market_id = $5`,
    [target.canonicalEventId, target.canonicalMarketId, row.canonicalCategory, row.venue, row.venueMarketId]
  );

  return result.rowCount ?? 0;
};

const cleanupStaleMembership = async (
  pool: Pool,
  row: SemanticExpansionInventoryRow,
  canonicalMarketId: string
): Promise<void> => {
  await pool.query(
    `DELETE FROM canonical_executable_market_members
      WHERE venue_market_profile_id = $1
        AND canonical_executable_market_id <> $2`,
    [row.venueMarketProfileId, canonicalMarketId]
  );
};

const buildSeedsForPromotion = async (
  pool: Pool,
  memberRows: readonly SemanticExpansionInventoryRow[],
  target: {
    canonicalEventId: string;
    canonicalMarketId: string;
    promotionClass: "historical_qualified_exact_overlap" | "live_only_exact_overlap";
    targetMode: "existing_market_extension" | "new_exact_overlap";
  }
) => {
  const merged = new Map<string, HydratedPromotionSeed>();
  if (target.targetMode === "existing_market_extension") {
    const existingSeeds = await loadHydratedCanonicalMarketSeeds(pool, target.canonicalMarketId, {
      canonicalEventId: target.canonicalEventId,
      canonicalMarketId: target.canonicalMarketId
    });
    for (const entry of existingSeeds) {
      merged.set(`${entry.venue}:${entry.venueMarketId}`, entry);
    }
  }

  for (const row of memberRows) {
    const key = `${row.venue}:${row.venueMarketId}`;
    if (merged.has(key)) {
      continue;
    }
    const hydrated = await hydrateInventoryRowToExecutableSeed(pool, row, {
      canonicalEventId: target.canonicalEventId,
      canonicalMarketId: target.canonicalMarketId,
      classification: target.promotionClass
    });
    merged.set(key, hydrated);
  }

  return [...merged.values()];
};

const activeSemanticVenueSet = new Set<string>(semanticExpansionVenues);
const allowedSemanticRouteModes = new Set(
  HistoricalSimulationRouteModeDefinitions
    .filter((definition) => definition.requiredVenues.every((venue) => activeSemanticVenueSet.has(venue)))
    .map((definition) => definition.mode)
);

const filterCanonicalReportForSemanticExpansion = (
  report: Awaited<ReturnType<typeof buildCategoryGroupedCanonicalReport>>
): Awaited<ReturnType<typeof buildCategoryGroupedCanonicalReport>> => ({
  ...report,
  categories: {
    POLITICS: report.categories.POLITICS.map((item) => ({
      ...item,
      routeModeSummary: item.routeModeSummary.filter((routeMode) => allowedSemanticRouteModes.has(routeMode.routeMode)),
      canonicalMarkets: item.canonicalMarkets.map((market) => ({
        ...market,
        routeModes: market.routeModes.filter((routeMode) =>
          routeMode.requiredVenues.every((venue) => activeSemanticVenueSet.has(venue))
        )
      }))
    })),
    CRYPTO: report.categories.CRYPTO.map((item) => ({
      ...item,
      routeModeSummary: item.routeModeSummary.filter((routeMode) => allowedSemanticRouteModes.has(routeMode.routeMode)),
      canonicalMarkets: item.canonicalMarkets.map((market) => ({
        ...market,
        routeModes: market.routeModes.filter((routeMode) =>
          routeMode.requiredVenues.every((venue) => activeSemanticVenueSet.has(venue))
        )
      }))
    })),
    SPORTS: report.categories.SPORTS.map((item) => ({
      ...item,
      routeModeSummary: item.routeModeSummary.filter((routeMode) => allowedSemanticRouteModes.has(routeMode.routeMode)),
      canonicalMarkets: item.canonicalMarkets.map((market) => ({
        ...market,
        routeModes: market.routeModes.filter((routeMode) =>
          routeMode.requiredVenues.every((venue) => activeSemanticVenueSet.has(venue))
        )
      }))
    })),
    ESPORTS: report.categories.ESPORTS.map((item) => ({
      ...item,
      routeModeSummary: item.routeModeSummary.filter((routeMode) => allowedSemanticRouteModes.has(routeMode.routeMode)),
      canonicalMarkets: item.canonicalMarkets.map((market) => ({
        ...market,
        routeModes: market.routeModes.filter((routeMode) =>
          routeMode.requiredVenues.every((venue) => activeSemanticVenueSet.has(venue))
        )
      }))
    }))
  }
});

export const syncSemanticExactOverlaps = async (input: {
  repoRoot: string;
  pool: Pool;
  reportPath?: string;
}): Promise<SemanticExactSyncSummary> => {
  const report = readArtifact<CrossVenueMatchReport>(
    input.repoRoot,
    input.reportPath ?? "docs/cross-venue-match-report.json"
  );
  const inventory = await loadSemanticExpansionInventory(input.pool);
  const inventoryByKey = new Map(
    inventory.map((row) => [`${row.venue}:${row.venueMarketId}`, row] as const)
  );

  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(input.pool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(input.pool),
      new CompatibilityVersionRepository(input.pool)
    )
  );
  const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
  const historyRepository = new HistoricalMarketStateRepository(input.pool);

  let promotedHistoricalQualified = 0;
  let promotedLiveOnly = 0;
  let remappedHistoricalRows = 0;
  let insertedSyntheticRows = 0;
  const promotedTargets: Array<{
    promotionId: string;
    targetCanonicalEventId: string;
    targetCanonicalMarketId: string;
    promotionClass: string;
    memberCount: number;
    hydration: ReadonlyArray<{
      venue: string;
      venueMarketId: string;
      hydrationSource: string;
      usedFallback: boolean;
    }>;
  }> = [];
  const skippedTargets: Array<{
    promotionId: string;
    reason: string;
    hydration: ReadonlyArray<{
      venue: string;
      venueMarketId: string;
      hydrationSource: string;
      usedFallback: boolean;
    }>;
  }> = [];

  for (const candidate of report.promotionCandidates) {
    const memberRows = candidate.memberRefs
      .map((member) => inventoryByKey.get(`${member.venue}:${member.venueMarketId}`))
      .filter((row): row is SemanticExpansionInventoryRow => row !== undefined);
    if (memberRows.length < 2) {
      continue;
    }

    const hydratedSeeds = await buildSeedsForPromotion(input.pool, memberRows, {
      canonicalEventId: candidate.targetCanonicalEventId,
      canonicalMarketId: candidate.targetCanonicalMarketId,
      promotionClass: candidate.promotionClass,
      targetMode: candidate.targetMode
    });
    const hydration = hydratedSeeds.map((entry) => ({
      venue: entry.venue,
      venueMarketId: entry.venueMarketId,
      hydrationSource: entry.hydrationSource,
      usedFallback: entry.usedFallback
    }));

    try {
      await projector.persistAndProject(snapshotBuilder.build(hydratedSeeds.map((entry) => entry.seed)));
    } catch (error) {
      skippedTargets.push({
        promotionId: candidate.promotionId,
        reason: error instanceof Error ? error.message : String(error),
        hydration
      });
      continue;
    }

    for (const row of memberRows) {
      await cleanupStaleMembership(input.pool, row, candidate.targetCanonicalMarketId);
      const remapped = await remapHistoricalRows(input.pool, row, {
        canonicalEventId: candidate.targetCanonicalEventId,
        canonicalMarketId: candidate.targetCanonicalMarketId
      });
      remappedHistoricalRows += remapped;
      if (remapped === 0) {
        const inserted = await historyRepository.insertManyIgnoreDuplicates([
          toSyntheticState(row, {
            canonicalEventId: candidate.targetCanonicalEventId,
            canonicalMarketId: candidate.targetCanonicalMarketId,
            promotionClass: candidate.promotionClass
          })
        ]);
        insertedSyntheticRows += inserted.inserted;
      }
    }

    if (candidate.promotionClass === "historical_qualified_exact_overlap") {
      promotedHistoricalQualified += 1;
    } else {
      promotedLiveOnly += 1;
    }
    promotedTargets.push({
      promotionId: candidate.promotionId,
      targetCanonicalEventId: candidate.targetCanonicalEventId,
      targetCanonicalMarketId: candidate.targetCanonicalMarketId,
      promotionClass: candidate.promotionClass,
      memberCount: memberRows.length,
      hydration
    });
  }

  const simulationAdminService = createSimulationAdminService({ pool: input.pool });
  const canonicalReport = await buildCategoryGroupedCanonicalReport({
    pool: input.pool,
    simulationAdminService
  });
  const filteredCanonicalReport = filterCanonicalReportForSemanticExpansion(canonicalReport);
  const updatedCanonicalReportPath = writeArtifact(
    input.repoRoot,
    "docs/cross-venue-promotion-canonical-report.json",
    filteredCanonicalReport
  );

  const summary: SemanticExactSyncSummary = {
    observedAt: new Date().toISOString(),
    processedPromotionCandidates: report.promotionCandidates.length,
    promotedHistoricalQualified,
    promotedLiveOnly,
    remappedHistoricalRows,
    insertedSyntheticRows,
    updatedCanonicalReportPath,
    promotedTargets,
    skippedTargets
  };

  writeArtifact(input.repoRoot, "docs/semantic-exact-sync-summary.json", summary);
  return summary;
};
