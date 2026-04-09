import type { Pool } from "pg";

import type { CanonicalCategory, CanonicalVenue } from "../../canonical/canonicalization-types.js";
import { buildCategoryGroupedCanonicalReport, type CategoryGroupedCanonicalReport } from "../fast-testing/simulation-canonical-report.js";
import { createSimulationAdminService } from "../fast-testing/simulation-admin-service-factory.js";
import {
  buildExactDateSeedSearch,
  buildSeedSourceText,
  type ExactSeedDefinition,
  type MissingPairFamily
} from "./exact-seed-shared.js";

type AnchorCategory = Extract<CanonicalCategory, "CRYPTO" | "SPORTS" | "ESPORTS" | "POLITICS">;

interface AnchorProfileDetail {
  venue: CanonicalVenue;
  venueMarketId: string;
  title: string | null;
  rules: string | null;
  boundaryReferenceAt: string | null;
}

const IN_SCOPE_PAIR_FAMILIES: readonly MissingPairFamily[] = [
  "POLYMARKET_OPINION",
  "LIMITLESS_OPINION"
];

const toDetailKey = (venue: string, venueMarketId: string): string => `${venue}:${venueMarketId}`;

export const buildPmLimitlessRouteableAnchorSeedsFromCanonicalReport = (input: {
  report: CategoryGroupedCanonicalReport;
  profileDetailsByKey: ReadonlyMap<string, AnchorProfileDetail>;
  categories?: readonly AnchorCategory[];
}): readonly ExactSeedDefinition[] => {
  const categoryFilter = new Set<AnchorCategory>(input.categories ?? ["CRYPTO", "SPORTS", "ESPORTS"]);
  const seeds: ExactSeedDefinition[] = [];

  for (const [category, events] of Object.entries(input.report.categories) as Array<[AnchorCategory, CategoryGroupedCanonicalReport["categories"][AnchorCategory]]>) {
    if (!categoryFilter.has(category)) {
      continue;
    }

    for (const event of events) {
      for (const market of event.canonicalMarkets ?? []) {
        if (!(market.runnableRouteModes ?? []).includes("POLYMARKET_LIMITLESS")) {
          continue;
        }

        const memberVenues = market.venues
          .map((venue) => venue.venue)
          .filter((venue): venue is CanonicalVenue => venue === "POLYMARKET" || venue === "LIMITLESS");
        if (!memberVenues.includes("POLYMARKET") || !memberVenues.includes("LIMITLESS")) {
          continue;
        }

        const memberVenueMarketIds = market.venues
          .filter((venue) => venue.venue === "POLYMARKET" || venue.venue === "LIMITLESS")
          .map((venue) => `${venue.venue}:${venue.venueMarketId}`)
          .sort((left: string, right: string) => left.localeCompare(right));

        const memberTitles = market.venues
          .filter((venue) => venue.venue === "POLYMARKET" || venue.venue === "LIMITLESS")
          .map((venue) => {
            const detail = input.profileDetailsByKey.get(toDetailKey(venue.venue, venue.venueMarketId));
            return detail?.title ?? venue.title ?? "";
          })
          .filter((value: string) => value.trim().length > 0);

        const memberRules = market.venues
          .filter((venue) => venue.venue === "POLYMARKET" || venue.venue === "LIMITLESS")
          .map((venue) => input.profileDetailsByKey.get(toDetailKey(venue.venue as CanonicalVenue, venue.venueMarketId))?.rules ?? "")
          .filter((value: string) => value.trim().length > 0);

        const title =
          memberTitles.find((value) => value.trim().length > 0)
          ?? market.venues.find((venue) => typeof venue.title === "string" && venue.title.trim().length > 0)?.title
          ?? market.canonicalMarketId;

        const boundaryReferenceAt =
          market.venues
            .filter((venue) => venue.venue === "POLYMARKET" || venue.venue === "LIMITLESS")
            .map((venue) => input.profileDetailsByKey.get(toDetailKey(venue.venue as CanonicalVenue, venue.venueMarketId))?.boundaryReferenceAt ?? null)
            .find((value): value is string => typeof value === "string" && value.length > 0)
          ?? null;

        const sourceText = buildSeedSourceText({
          title,
          memberTitles,
          memberRules
        });

        const exactDateSearch = buildExactDateSeedSearch({
          canonicalCategory: category,
          title,
          sourceText,
          targetPairFamilies: IN_SCOPE_PAIR_FAMILIES,
          boundaryReferenceAt
        });

        seeds.push({
          seedReference: market.canonicalMarketId,
          canonicalEventId: event.canonicalEventId,
          canonicalMarketId: market.canonicalMarketId,
          canonicalCategory: category,
          title,
          sourceText,
          memberVenues: ["LIMITLESS", "POLYMARKET"],
          memberVenueMarketIds,
          targetPairFamilies: IN_SCOPE_PAIR_FAMILIES,
          exactDateSearch,
          boundaryReferenceAt
        });
      }
    }
  }

  return seeds.sort((left, right) =>
    left.canonicalCategory.localeCompare(right.canonicalCategory)
    || left.title.localeCompare(right.title)
    || left.canonicalMarketId.localeCompare(right.canonicalMarketId)
  );
};

const loadAnchorProfileDetails = async (
  pool: Pool,
  keys: readonly string[]
): Promise<ReadonlyMap<string, AnchorProfileDetail>> => {
  if (keys.length === 0) {
    return new Map();
  }

  const marketIds = [...new Set(keys.map((key) => key.split(":")[1]!).filter((value) => value.length > 0))];
  const result = await pool.query<{
    venue: CanonicalVenue;
    venue_market_id: string;
    title: string | null;
    rules: string | null;
    boundary_reference_at: Date | null;
  }>(
    `SELECT
       vmp.venue,
       vmp.venue_market_id,
       vmp.title,
       COALESCE(vrp.rule_text, vmp.resolution_rules_text, vmp.description) AS rules,
       COALESCE(vmp.resolves_at, vmp.expires_at, vmp.published_at) AS boundary_reference_at
     FROM venue_market_profiles vmp
     LEFT JOIN venue_resolution_profiles vrp
       ON vrp.venue_market_profile_id = vmp.id
    WHERE vmp.venue IN ('POLYMARKET', 'LIMITLESS')
      AND vmp.venue_market_id = ANY($1::text[])`,
    [marketIds]
  );

  return new Map(
    result.rows.map((row) => [
      toDetailKey(row.venue, row.venue_market_id),
      {
        venue: row.venue,
        venueMarketId: row.venue_market_id,
        title: row.title,
        rules: row.rules,
        boundaryReferenceAt: row.boundary_reference_at?.toISOString() ?? null
      }
    ] as const)
  );
};

export const loadPmLimitlessRouteableAnchorSeeds = async (input: {
  pool: Pool;
  categories?: readonly AnchorCategory[];
}): Promise<readonly ExactSeedDefinition[]> => {
  const simulationAdminService = createSimulationAdminService({ pool: input.pool });
  const report = await buildCategoryGroupedCanonicalReport({
    pool: input.pool,
    simulationAdminService
  });

  const venueKeys = report.categories.CRYPTO
    .concat(report.categories.SPORTS, report.categories.ESPORTS, report.categories.POLITICS)
    .flatMap((event) => event.canonicalMarkets ?? [])
    .filter((market) => (market.runnableRouteModes ?? []).includes("POLYMARKET_LIMITLESS"))
    .flatMap((market) => market.venues ?? [])
    .filter((venue) => venue.venue === "POLYMARKET" || venue.venue === "LIMITLESS")
    .map((venue) => toDetailKey(venue.venue, venue.venueMarketId));

  const details = await loadAnchorProfileDetails(input.pool, venueKeys);
  return buildPmLimitlessRouteableAnchorSeedsFromCanonicalReport({
    report,
    profileDetailsByKey: details,
    ...(input.categories ? { categories: input.categories } : {})
  });
};
