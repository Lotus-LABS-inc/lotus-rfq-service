import type { Pool } from "pg";

import type { SimulationAdminService, SimulationCanonicalCoverage } from "../../api/admin/simulation-admin-service.js";
import type { HistoricalMarketClass } from "../../core/historical-simulation/historical-simulation.types.js";

export interface CanonicalEventReportItem {
  canonicalEventId: string;
  catalogScope: string;
  category: "POLITICS" | "CRYPTO" | "SPORTS" | "ESPORTS";
  marketClass: HistoricalMarketClass | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  venueCoverage: SimulationCanonicalCoverage["venueCoverage"];
  routeModeSummary: SimulationCanonicalCoverage["routeModeSummary"];
  predictReadinessOverview: SimulationCanonicalCoverage["predictReadinessOverview"];
  hasTriVenueRoute: boolean;
  triVenueRouteableMarketCount: number;
  canonicalMarkets: SimulationCanonicalCoverage["canonicalMarkets"];
}

export interface CategoryGroupedCanonicalReport {
  observedAt: string;
  categories: Record<"POLITICS" | "CRYPTO" | "SPORTS" | "ESPORTS", readonly CanonicalEventReportItem[]>;
}

interface EventRow {
  canonical_event_id: string;
  canonical_category: "POLITICS" | "CRYPTO" | "SPORTS" | "ESPORTS";
}

const SIMULATION_CATEGORIES = ["POLITICS", "CRYPTO", "SPORTS", "ESPORTS"] as const;

const summarizeCoverageWindow = (
  venueCoverage: SimulationCanonicalCoverage["venueCoverage"]
): { coverageStart: string | null; coverageEnd: string | null } => {
  if (venueCoverage.length === 0) {
    return {
      coverageStart: null,
      coverageEnd: null
    };
  }

  const coverageStart = venueCoverage.reduce<Date>(
    (current, entry) => entry.coverageStart < current ? entry.coverageStart : current,
    venueCoverage[0]!.coverageStart
  );
  const coverageEnd = venueCoverage.reduce<Date>(
    (current, entry) => entry.coverageEnd > current ? entry.coverageEnd : current,
    venueCoverage[0]!.coverageEnd
  );

  return {
    coverageStart: coverageStart.toISOString(),
    coverageEnd: coverageEnd.toISOString()
  };
};

export const buildCategoryGroupedCanonicalReport = async (input: {
  pool: Pool;
  simulationAdminService: Pick<SimulationAdminService, "getCanonicalCoverage">;
}): Promise<CategoryGroupedCanonicalReport> => {
  const eventRows = await input.pool.query<EventRow>(
    `SELECT canonical_event_id, canonical_category
       FROM historical_market_states
      WHERE canonical_category IN ('POLITICS', 'CRYPTO', 'SPORTS', 'ESPORTS')
      GROUP BY canonical_event_id, canonical_category
      ORDER BY canonical_category ASC, canonical_event_id ASC`
  );

  const grouped = {
    POLITICS: [] as CanonicalEventReportItem[],
    CRYPTO: [] as CanonicalEventReportItem[],
    SPORTS: [] as CanonicalEventReportItem[],
    ESPORTS: [] as CanonicalEventReportItem[]
  };

  for (const row of eventRows.rows) {
    const coverage = await input.simulationAdminService.getCanonicalCoverage(row.canonical_event_id);
    const { coverageStart, coverageEnd } = summarizeCoverageWindow(coverage.venueCoverage);
    grouped[row.canonical_category].push({
      canonicalEventId: coverage.canonicalEventId,
      catalogScope: coverage.catalogScope,
      category: row.canonical_category,
      marketClass: coverage.marketClass,
      coverageStart,
      coverageEnd,
      venueCoverage: coverage.venueCoverage,
      routeModeSummary: coverage.routeModeSummary,
      predictReadinessOverview: coverage.predictReadinessOverview,
      hasTriVenueRoute: coverage.hasTriVenueRoute,
      triVenueRouteableMarketCount: coverage.triVenueRouteableMarketCount,
      canonicalMarkets: coverage.canonicalMarkets
    });
  }

  return {
    observedAt: new Date().toISOString(),
    categories: {
      POLITICS: grouped.POLITICS,
      CRYPTO: grouped.CRYPTO,
      SPORTS: grouped.SPORTS,
      ESPORTS: grouped.ESPORTS
    }
  };
};
