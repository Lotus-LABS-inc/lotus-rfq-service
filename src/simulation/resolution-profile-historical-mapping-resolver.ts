import type { Pool, QueryResultRow } from "pg";

import type {
  CanonicalHistoricalMapping,
  CanonicalHistoricalMappingResolver
} from "./canonical-historical-normalizer.js";

interface ResolutionProfileMappingRow extends QueryResultRow {
  resolution_profile_id: string;
  canonical_event_id: string;
  canonical_market_id: string;
  canonical_category: "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS" | "OTHER" | null;
  metadata_canonical_category: "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS" | "OTHER" | null;
}

const normalizeCategory = (
  category:
    | ResolutionProfileMappingRow["canonical_category"]
    | ResolutionProfileMappingRow["metadata_canonical_category"]
): CanonicalHistoricalMapping["canonicalCategory"] => {
  switch (category) {
    case "SPORTS":
    case "CRYPTO":
    case "POLITICS":
    case "ESPORTS":
    case "OTHER":
      return category;
    default:
      return "OTHER";
  }
};

const collectCandidateVenueMarketIds = (input: {
  venueMarketId: string;
  sourceMarketMetadata?: Record<string, unknown>;
}): string[] => {
  const identifiers = new Set<string>([input.venueMarketId]);
  const market =
    input.sourceMarketMetadata &&
    typeof input.sourceMarketMetadata.market === "object" &&
    input.sourceMarketMetadata.market !== null
      ? (input.sourceMarketMetadata.market as Record<string, unknown>)
      : null;

  const pushIfString = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0) {
      identifiers.add(value);
    }
  };

  if (market) {
    pushIfString(market.condition_id);
    pushIfString(market.market_id);
    pushIfString(market.market_slug);
  }

  return [...identifiers];
};

export class ResolutionProfileHistoricalMappingResolver implements CanonicalHistoricalMappingResolver {
  public constructor(private readonly pool: Pool) {}

  public async resolve(params: {
    venue: string;
    venueMarketId: string;
    sourceMarketMetadata?: Record<string, unknown>;
  }): Promise<readonly CanonicalHistoricalMapping[]> {
    const candidateVenueMarketIds = collectCandidateVenueMarketIds(params);
    const result = await this.pool.query<ResolutionProfileMappingRow>(
      `WITH latest_state_category AS (
         SELECT DISTINCT ON (canonical_event_id, canonical_market_id, venue, venue_market_id)
                canonical_event_id,
                canonical_market_id,
                venue,
                venue_market_id,
                canonical_category
           FROM historical_market_states
          ORDER BY canonical_event_id, canonical_market_id, venue, venue_market_id, "timestamp" DESC
       ),
       event_category AS (
         SELECT canonical_event_id, MAX(canonical_category) AS canonical_category
           FROM historical_market_states
          GROUP BY canonical_event_id
       )
       SELECT DISTINCT
              rp.id AS resolution_profile_id,
              rp.canonical_event_id,
              rp.canonical_market_id,
              COALESCE(ls.canonical_category, ec.canonical_category, 'OTHER') AS canonical_category,
              UPPER(NULLIF(rp.metadata->>'canonicalCategory', ''))::text AS metadata_canonical_category
         FROM resolution_profiles rp
         LEFT JOIN latest_state_category ls
           ON ls.canonical_event_id::text = rp.canonical_event_id::text
          AND ls.canonical_market_id::text = rp.canonical_market_id::text
          AND ls.venue = rp.venue
          AND ls.venue_market_id = rp.venue_market_id
         LEFT JOIN event_category ec
           ON ec.canonical_event_id::text = rp.canonical_event_id::text
        WHERE rp.venue = $1
          AND rp.venue_market_id = ANY($2::text[])
        ORDER BY rp.canonical_event_id, rp.canonical_market_id, rp.id`,
      [params.venue, candidateVenueMarketIds]
    );

    return result.rows.map((row) => ({
      canonicalEventId: row.canonical_event_id,
      canonicalMarketId: row.canonical_market_id,
      canonicalCategory: normalizeCategory(row.canonical_category ?? row.metadata_canonical_category),
      resolutionProfileId: row.resolution_profile_id
    }));
  }
}
