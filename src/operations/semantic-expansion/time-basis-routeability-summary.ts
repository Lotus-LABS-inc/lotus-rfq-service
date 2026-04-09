import type { Pool, QueryResultRow } from "pg";

import type { SimulationAdminService, SimulationCanonicalCoverage, SimulationRouteabilitySummary } from "../../api/admin/simulation-admin-service.js";
import {
  HistoricalSimulationRouteModeDefinitions,
  type HistoricalSimulationRouteAvailabilityReason,
  type HistoricalSimulationRouteMode
} from "../../core/historical-simulation/historical-simulation.types.js";
import {
  classifyEvidenceLabelBasis,
  classifyHistoricalMetadataVersionBasis,
  classifyRouteabilityBasis,
  type InventoryTemporalBasis,
  type RouteabilityTemporalBasis
} from "../../inventory/inventory-basis-classifier.js";
import {
  loadSemanticExpansionInventory,
  writeArtifact,
  writeMarkdownArtifact,
  type SemanticExpansionInventoryRow
} from "./shared.js";

interface HistoricalStateBasisRow extends QueryResultRow {
  canonical_event_id: string;
  venue: string;
  venue_market_id: string;
  metadata_version: string;
  row_count: string;
}

export interface TimeBasisInventoryAudit {
  observedAt: string;
  venueBasisDistribution: Record<string, {
    primaryBasis: Record<string, number>;
    availableBasis: Record<string, number>;
  }>;
  marketBasisDetails: ReadonlyArray<{
    venue: string;
    venueMarketId: string;
    canonicalEventId: string;
    primaryBasis: InventoryTemporalBasis;
    availableBases: readonly InventoryTemporalBasis[];
    evidenceLabel: string;
    sourceMetadataVersion: string;
  }>;
}

export interface BasisRouteabilitySlice {
  basis: RouteabilityTemporalBasis;
  routeModes: ReadonlyArray<{
    routeMode: HistoricalSimulationRouteMode;
    label: string;
    cardinality: "single" | "pair" | "tri";
    routeableMarketCount: number;
    eventCount: number;
  }>;
  totals: {
    eventCount: number;
    canonicalMarketCount: number;
    runnableSingleCount: number;
    runnablePairCount: number;
    runnableTriCount: number;
  };
  blockReasons: readonly {
    reason: HistoricalSimulationRouteAvailabilityReason;
    count: number;
  }[];
}

export interface TimeBasisRouteabilitySummary {
  observedAt: string;
  inventoryAudit: TimeBasisInventoryAudit;
  overallRouteability: SimulationRouteabilitySummary;
  routeabilityByBasis: ReadonlyArray<BasisRouteabilitySlice>;
  eventBasisDistribution: Record<RouteabilityTemporalBasis, number>;
  routeModeBasisBreakdown: Record<string, Record<RouteabilityTemporalBasis, number>>;
  explicitAnswers: {
    limitlessOpinionZeroDerivedFrom: Record<RouteabilityTemporalBasis, number>;
    triZeroDerivedFrom: Record<RouteabilityTemporalBasis, number>;
  };
}

interface EventBasisClassification {
  canonicalEventId: string;
  routeMode: HistoricalSimulationRouteMode;
  basis: RouteabilityTemporalBasis;
  routeableMarketCount: number;
  hasAnyRoute: boolean;
  reasonCounts: readonly HistoricalSimulationRouteAvailabilityReason[];
}

const sortCounts = <T extends string>(counts: ReadonlyMap<T, number>): readonly { reason: T; count: number }[] =>
  [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const buildAvailabilityMap = async (pool: Pool): Promise<ReadonlyMap<string, readonly InventoryTemporalBasis[]>> => {
  const result = await pool.query<HistoricalStateBasisRow>(
    `SELECT canonical_event_id, venue, venue_market_id, metadata_version, COUNT(*)::text AS row_count
       FROM historical_market_states
      GROUP BY canonical_event_id, venue, venue_market_id, metadata_version`
  );

  const grouped = new Map<string, Set<InventoryTemporalBasis>>();
  for (const row of result.rows) {
    const key = `${row.venue}:${row.venue_market_id}`;
    const bases = grouped.get(key) ?? new Set<InventoryTemporalBasis>();
    bases.add(classifyHistoricalMetadataVersionBasis(row.metadata_version));
    grouped.set(key, bases);
  }

  return new Map(
    [...grouped.entries()].map(([key, values]) => [key, [...values].sort()] as const)
  );
};

const buildInventoryAudit = (
  inventory: readonly SemanticExpansionInventoryRow[],
  availabilityByMarket: ReadonlyMap<string, readonly InventoryTemporalBasis[]>
): TimeBasisInventoryAudit => {
  const venueBasisDistribution: TimeBasisInventoryAudit["venueBasisDistribution"] = {};
  const marketBasisDetails = inventory.map((row) => {
    const primaryBasis = classifyEvidenceLabelBasis(row.evidenceLabel);
    const availableBases = availabilityByMarket.get(`${row.venue}:${row.venueMarketId}`) ?? [primaryBasis];
    const venueDistribution = venueBasisDistribution[row.venue] ?? {
      primaryBasis: {},
      availableBasis: {}
    };
    venueDistribution.primaryBasis[primaryBasis] = (venueDistribution.primaryBasis[primaryBasis] ?? 0) + 1;
    for (const basis of availableBases) {
      venueDistribution.availableBasis[basis] = (venueDistribution.availableBasis[basis] ?? 0) + 1;
    }
    venueBasisDistribution[row.venue] = venueDistribution;

    return {
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      canonicalEventId: row.canonicalEventId,
      primaryBasis,
      availableBases,
      evidenceLabel: row.evidenceLabel,
      sourceMetadataVersion: row.sourceMetadataVersion
    };
  });

  return {
    observedAt: new Date().toISOString(),
    venueBasisDistribution,
    marketBasisDetails
  };
};

const classifyEventRouteModeBasis = (input: {
  coverage: SimulationCanonicalCoverage;
  availabilityByMarket: ReadonlyMap<string, readonly InventoryTemporalBasis[]>;
}): readonly EventBasisClassification[] => {
  const byVenue = new Map<string, Set<InventoryTemporalBasis>>();
  for (const market of input.coverage.canonicalMarkets) {
    for (const venue of market.venues) {
      const bases = input.availabilityByMarket.get(`${venue.venue}:${venue.venueMarketId}`) ?? ["UNKNOWN"];
      const bucket = byVenue.get(venue.venue) ?? new Set<InventoryTemporalBasis>();
      for (const basis of bases) {
        bucket.add(basis);
      }
      byVenue.set(venue.venue, bucket);
    }
  }

  return input.coverage.routeModeSummary.map((summary) => {
    const definition = HistoricalSimulationRouteModeDefinitions.find((entry) => entry.mode === summary.routeMode)!;
    const requiredBasisValues: InventoryTemporalBasis[] = [];
    for (const venue of definition.requiredVenues) {
      const bases = byVenue.get(venue);
      if (!bases || bases.size === 0) {
        return {
          canonicalEventId: input.coverage.canonicalEventId,
          routeMode: summary.routeMode,
          basis: "INSUFFICIENT_BASIS" as const,
          routeableMarketCount: summary.routeableMarketCount,
          hasAnyRoute: summary.hasAnyRoute,
          reasonCounts: unique(
            input.coverage.canonicalMarkets.flatMap((market) =>
              market.routeModes
                .filter((route) => route.routeMode === summary.routeMode && route.reason !== null)
                .map((route) => route.reason!)
            )
          )
        };
      }
      requiredBasisValues.push(...bases);
    }

    return {
      canonicalEventId: input.coverage.canonicalEventId,
      routeMode: summary.routeMode,
      basis: classifyRouteabilityBasis(requiredBasisValues),
      routeableMarketCount: summary.routeableMarketCount,
      hasAnyRoute: summary.hasAnyRoute,
      reasonCounts: unique(
        input.coverage.canonicalMarkets.flatMap((market) =>
          market.routeModes
            .filter((route) => route.routeMode === summary.routeMode && route.reason !== null)
            .map((route) => route.reason!)
        )
      )
    };
  });
};

const emptySlice = (
  basis: RouteabilityTemporalBasis
): BasisRouteabilitySlice => ({
  basis,
  routeModes: HistoricalSimulationRouteModeDefinitions.map((definition) => ({
    routeMode: definition.mode,
    label: definition.label,
    cardinality: definition.cardinality,
    routeableMarketCount: 0,
    eventCount: 0
  })),
  totals: {
    eventCount: 0,
    canonicalMarketCount: 0,
    runnableSingleCount: 0,
    runnablePairCount: 0,
    runnableTriCount: 0
  },
  blockReasons: []
});

export const buildTimeBasisRouteabilitySummary = async (input: {
  repoRoot: string;
  pool: Pool;
  simulationAdminService: Pick<SimulationAdminService, "getCanonicalCoverage" | "getRouteabilitySummary">;
}): Promise<TimeBasisRouteabilitySummary> => {
  const [inventory, overallRouteability, availabilityByMarket] = await Promise.all([
    loadSemanticExpansionInventory(input.pool),
    input.simulationAdminService.getRouteabilitySummary({}),
    buildAvailabilityMap(input.pool)
  ]);

  const inventoryAudit = buildInventoryAudit(inventory, availabilityByMarket);
  const eventIds = unique(inventory.map((row) => row.canonicalEventId));
  const coverageResults = await Promise.all(
    eventIds.map(async (eventId) => {
      try {
        return await input.simulationAdminService.getCanonicalCoverage(eventId);
      } catch {
        return null;
      }
    })
  );
  const coverages = coverageResults.filter((coverage): coverage is SimulationCanonicalCoverage => coverage !== null);
  const classified = coverages.flatMap((coverage) =>
    classifyEventRouteModeBasis({
      coverage,
      availabilityByMarket
    })
  );

  const basisValues: readonly RouteabilityTemporalBasis[] = [
    "HISTORICAL_ONLY",
    "LIVE_ONLY",
    "MIXED_BASIS",
    "INSUFFICIENT_BASIS"
  ];
  const routeabilityByBasis = basisValues.map((basis) => {
    const slice = emptySlice(basis);
    const basisCoverages = coverages.filter((coverage) =>
      classified.some((entry) => entry.canonicalEventId === coverage.canonicalEventId && entry.basis === basis)
    );
    const routeModeCounts = new Map(slice.routeModes.map((entry) => [entry.routeMode, { ...entry }]));
    const reasonCounts = new Map<HistoricalSimulationRouteAvailabilityReason, number>();

    for (const entry of classified.filter((row) => row.basis === basis)) {
      const current = routeModeCounts.get(entry.routeMode)!;
      current.routeableMarketCount += entry.routeableMarketCount;
      if (entry.hasAnyRoute) {
        current.eventCount += 1;
      }
      for (const reason of entry.reasonCounts) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
    }

    slice.routeModes = HistoricalSimulationRouteModeDefinitions.map((definition) => routeModeCounts.get(definition.mode)!);
    slice.totals.eventCount = unique(basisCoverages.map((coverage) => coverage.canonicalEventId)).length;
    slice.totals.canonicalMarketCount = basisCoverages.reduce((total, coverage) => total + coverage.canonicalMarkets.length, 0);
    slice.totals.runnableSingleCount = basisCoverages.reduce(
      (total, coverage) => total + coverage.canonicalMarkets.filter((market) => market.routeModes.some((route) => route.cardinality === "single" && route.runnable)).length,
      0
    );
    slice.totals.runnablePairCount = basisCoverages.reduce(
      (total, coverage) => total + coverage.canonicalMarkets.filter((market) => market.routeModes.some((route) => route.cardinality === "pair" && route.runnable)).length,
      0
    );
    slice.totals.runnableTriCount = basisCoverages.reduce(
      (total, coverage) => total + coverage.canonicalMarkets.filter((market) => market.routeModes.some((route) => route.cardinality === "tri" && route.runnable)).length,
      0
    );
    slice.blockReasons = sortCounts(reasonCounts);
    return slice;
  });

  const eventBasisDistribution = basisValues.reduce<Record<RouteabilityTemporalBasis, number>>((accumulator, basis) => {
    accumulator[basis] = unique(classified.filter((entry) => entry.basis === basis).map((entry) => entry.canonicalEventId)).length;
    return accumulator;
  }, {
    HISTORICAL_ONLY: 0,
    LIVE_ONLY: 0,
    MIXED_BASIS: 0,
    INSUFFICIENT_BASIS: 0
  });

  const routeModeBasisBreakdown = Object.fromEntries(
    HistoricalSimulationRouteModeDefinitions.map((definition) => [
      definition.mode,
      basisValues.reduce<Record<RouteabilityTemporalBasis, number>>((accumulator, basis) => {
        accumulator[basis] = classified.filter((entry) => entry.routeMode === definition.mode && entry.basis === basis).length;
        return accumulator;
      }, {
        HISTORICAL_ONLY: 0,
        LIVE_ONLY: 0,
        MIXED_BASIS: 0,
        INSUFFICIENT_BASIS: 0
      })
    ])
  );

  const summary: TimeBasisRouteabilitySummary = {
    observedAt: new Date().toISOString(),
    inventoryAudit,
    overallRouteability,
    routeabilityByBasis,
    eventBasisDistribution,
    routeModeBasisBreakdown,
    explicitAnswers: {
      limitlessOpinionZeroDerivedFrom: routeModeBasisBreakdown.LIMITLESS_OPINION ?? {
        HISTORICAL_ONLY: 0,
        LIVE_ONLY: 0,
        MIXED_BASIS: 0,
        INSUFFICIENT_BASIS: 0
      },
      triZeroDerivedFrom: routeModeBasisBreakdown.POLYMARKET_LIMITLESS_OPINION ?? {
        HISTORICAL_ONLY: 0,
        LIVE_ONLY: 0,
        MIXED_BASIS: 0,
        INSUFFICIENT_BASIS: 0
      }
    }
  };

  writeArtifact(input.repoRoot, "docs/time-basis-inventory-audit.json", inventoryAudit);
  writeArtifact(input.repoRoot, "docs/time-basis-routeability-summary.json", summary);
  writeArtifact(input.repoRoot, "docs/routeability-summary-historical-only.json", routeabilityByBasis.find((slice) => slice.basis === "HISTORICAL_ONLY"));
  writeArtifact(input.repoRoot, "docs/routeability-summary-live-only.json", routeabilityByBasis.find((slice) => slice.basis === "LIVE_ONLY"));
  writeArtifact(input.repoRoot, "docs/routeability-summary-mixed-basis.json", routeabilityByBasis.find((slice) => slice.basis === "MIXED_BASIS"));

  const markdown = [
    "# Time-Basis Routeability Summary",
    "",
    `Observed at: ${summary.observedAt}`,
    "",
    "## Venue Basis Distribution",
    ...Object.entries(inventoryAudit.venueBasisDistribution).map(
      ([venue, counts]) =>
        `- ${venue}: primary=${JSON.stringify(counts.primaryBasis)} available=${JSON.stringify(counts.availableBasis)}`
    ),
    "",
    "## Routeability By Basis",
    ...routeabilityByBasis.map(
      (slice) =>
        `- ${slice.basis}: events=${slice.totals.eventCount}, runnablePairs=${slice.totals.runnablePairCount}, runnableTri=${slice.totals.runnableTriCount}, LIMITLESS_OPINION=${slice.routeModes.find((row) => row.routeMode === "LIMITLESS_OPINION")?.routeableMarketCount ?? 0}, TRI=${slice.routeModes.find((row) => row.routeMode === "POLYMARKET_LIMITLESS_OPINION")?.routeableMarketCount ?? 0}`
    ),
    "",
    "## Explicit Answer",
    `- LIMITLESS_OPINION basis distribution: ${JSON.stringify(summary.explicitAnswers.limitlessOpinionZeroDerivedFrom)}`,
    `- POLYMARKET_LIMITLESS_OPINION basis distribution: ${JSON.stringify(summary.explicitAnswers.triZeroDerivedFrom)}`
  ].join("\n");
  writeMarkdownArtifact(input.repoRoot, "docs/time-basis-routeability-summary.md", `${markdown}\n`);

  return summary;
};
