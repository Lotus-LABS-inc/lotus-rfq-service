import type { Pool } from "pg";
import type { SharedCoreQuoteMappingLoader, SharedCoreVenueQuoteMappingRow } from "../core/sor/quote-snapshot.js";

const FRONTEND_CATALOG_EXCLUDED_TOPIC_PREFIXES = [
  "SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026"
] as const;

const VENUE_SUFFIX_PATTERN = /:(POLYMARKET|LIMITLESS|PREDICT|PREDICT_FUN|OPINION|MYRIAD)$/i;

const addFrontendCatalogExclusionCondition = (conditions: string[], params: unknown[]): void => {
  params.push([...FRONTEND_CATALOG_EXCLUDED_TOPIC_PREFIXES]);
  conditions.push(`NOT EXISTS (
    SELECT 1
      FROM unnest($${params.length}::text[]) excluded(prefix)
     WHERE upper(ce.proposition_key) = upper(excluded.prefix)
        OR upper(ce.proposition_key) LIKE '%' || upper(excluded.prefix) || '%'
        OR EXISTS (
          SELECT 1
            FROM canonical_executable_markets cem_excluded
           WHERE cem_excluded.canonical_event_id = ce.id
             AND (
               upper(cem_excluded.id) = upper(excluded.prefix)
               OR upper(cem_excluded.id) LIKE '%' || upper(excluded.prefix) || '%'
             )
        )
  )`);
};

export interface MarketCatalogFilter {
  category?: string;
  search?: string;
  limit?: number;
  includeUnapproved?: boolean;
}

export interface MarketCatalogCategory {
  category: string;
  marketCount: number;
  eventCount?: number;
}

export interface MarketCatalogVenueMarket {
  canonicalMarketId: string;
  canonicalMarketTitle: string;
  venue: string;
  venueMarketProfileId: string;
  venueMarketId: string;
  venueTitle: string;
  imageUrl: string | null;
  iconUrl: string | null;
  volume: string | null;
  volume24h: string | null;
  liquidity: string | null;
  buyVolume: string | null;
  sellVolume: string | null;
  tradeCount: string | null;
  buyCount: string | null;
  sellCount: string | null;
  change24h: string | null;
  changePercent24h: string | null;
  marketClass: string;
  outcomes: Array<{ id: string; label: string }>;
  network: string | null;
  chain: string | null;
  expiresAt: string | null;
  resolvesAt: string | null;
}

export interface MarketCatalogMarket {
  eventId?: string;
  eventTitle?: string;
  canonicalEventId: string;
  canonicalMarketIds: string[];
  displayTopic: string;
  displayOutcome: string;
  displayOutcomeKey: string;
  title: string;
  normalizedTitle: string;
  category: string;
  marketClass: string;
  status: "OPEN" | "RESOLVING" | "RESOLVED_OR_EXPIRED";
  startsAt: string | null;
  expiresAt: string | null;
  resolvesAt: string | null;
  venues: string[];
  venueCount: number;
  venueMarketCount: number;
  outcomeCount: number;
  routeability: {
    hasSingleVenue: boolean;
    hasCrossVenue: boolean;
  };
  imageUrl: string | null;
  iconUrl: string | null;
  volume: string | null;
  volume24h: string | null;
  liquidity: string | null;
  buyVolume: string | null;
  sellVolume: string | null;
  tradeCount: string | null;
  buyCount: string | null;
  sellCount: string | null;
  venueMarkets: MarketCatalogVenueMarket[];
  updatedAt: string;
}

export interface MarketCatalogEvent {
  eventId: string;
  title: string;
  normalizedTitle: string;
  category: string;
  status: MarketCatalogMarket["status"];
  marketCount: number;
  featuredMarkets: MarketCatalogMarket[];
  markets: MarketCatalogMarket[];
  venues: string[];
  venueCount: number;
  venueMarketCount: number;
  outcomeCount: number;
  routeability: MarketCatalogMarket["routeability"];
  imageUrl: string | null;
  iconUrl: string | null;
  volume: string | null;
  volume24h: string | null;
  liquidity: string | null;
  buyVolume: string | null;
  sellVolume: string | null;
  tradeCount: string | null;
  buyCount: string | null;
  sellCount: string | null;
  updatedAt: string;
}

export interface MarketDisplayMetadataInput {
  canonical_market_ids: string[];
  title: string;
  proposition_key: string;
  frontend_display_title: string | null;
}

interface MarketRow {
  canonical_event_id: string;
  proposition_key: string;
  title: string;
  normalized_proposition_text: string;
  canonical_category: string;
  market_class: string;
  starts_at: string | null;
  expires_at: string | null;
  resolves_at: string | null;
  updated_at: string;
  event_metadata: unknown;
  frontend_display_title: string | null;
  frontend_sort_priority: number | null;
  canonical_market_ids: string[];
  venues: string[];
  venue_market_count: string;
}

interface VenueMarketRow {
  canonical_event_id: string;
  canonical_market_id: string;
  canonical_market_title: string;
  venue_market_profile_id: string;
  venue: string;
  venue_market_id: string;
  venue_title: string;
  market_class: string;
  outcomes: unknown;
  network: string | null;
  chain: string | null;
  expires_at: string | null;
  resolves_at: string | null;
  normalized_payload: unknown;
  raw_source_payload: unknown;
}

interface CategoryRow {
  category: string;
  market_count: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const MAX_EVENT_SOURCE_LIMIT = 1000;
const FRONTEND_SHARED_CORE_APPROVAL_SOURCE = "frontend-curated-catalog";

export class MarketCatalogRepository {
  public constructor(private readonly pool: Pool) {}

  public async listCategories(): Promise<MarketCatalogCategory[]> {
    const events = await this.listEvents({ limit: MAX_LIMIT });
    const byCategory = new Map<string, number>();
    for (const event of events) {
      byCategory.set(event.category, (byCategory.get(event.category) ?? 0) + 1);
    }
    if (byCategory.size > 0) {
      return [...byCategory.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, count]) => ({
          category,
          marketCount: count,
          eventCount: count
        }));
    }

    const result = await this.pool.query<CategoryRow>(
      `SELECT ce.canonical_category AS category, COUNT(DISTINCT ce.id)::text AS market_count
         FROM canonical_events ce
         JOIN frontend_market_approvals fma
           ON fma.canonical_event_id = ce.id
          AND fma.status = 'APPROVED'
          AND fma.metadata->>'source' = '${FRONTEND_SHARED_CORE_APPROVAL_SOURCE}'
         LEFT JOIN canonical_executable_markets cem
           ON cem.canonical_event_id = ce.id
         LEFT JOIN venue_market_profiles vmp
           ON vmp.canonical_event_id = ce.id
        WHERE cem.id IS NOT NULL OR vmp.id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
             FROM unnest($1::text[]) excluded(prefix)
             WHERE upper(ce.proposition_key) = upper(excluded.prefix)
                OR upper(ce.proposition_key) LIKE '%' || upper(excluded.prefix) || '%'
                OR EXISTS (
                  SELECT 1
                    FROM canonical_executable_markets cem_excluded
                   WHERE cem_excluded.canonical_event_id = ce.id
                     AND (
                       upper(cem_excluded.id) = upper(excluded.prefix)
                       OR upper(cem_excluded.id) LIKE '%' || upper(excluded.prefix) || '%'
                     )
                )
          )
        GROUP BY ce.canonical_category
        ORDER BY ce.canonical_category`,
      [[...FRONTEND_CATALOG_EXCLUDED_TOPIC_PREFIXES]]
    );
    return result.rows.map((row) => ({
      category: row.category,
      marketCount: Number(row.market_count)
    }));
  }

  public async listMarkets(filter: MarketCatalogFilter = {}): Promise<MarketCatalogMarket[]> {
    const limit = clampLimit(filter.limit);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeUnapproved) {
      conditions.push(`fma.status = 'APPROVED'`);
      conditions.push(`fma.metadata->>'source' = '${FRONTEND_SHARED_CORE_APPROVAL_SOURCE}'`);
    }
    addFrontendCatalogExclusionCondition(conditions, params);
    if (filter.category?.trim()) {
      params.push(filter.category.trim().toUpperCase());
      conditions.push(`ce.canonical_category = $${params.length}`);
    }
    if (filter.search?.trim()) {
      params.push(`%${filter.search.trim().toLowerCase()}%`);
      conditions.push(`(
        lower(ce.title) LIKE $${params.length}
        OR lower(ce.normalized_proposition_text) LIKE $${params.length}
        OR lower(ce.proposition_key) LIKE $${params.length}
        OR EXISTS (
          SELECT 1
            FROM venue_market_profiles vmp_search
           WHERE vmp_search.canonical_event_id = ce.id
             AND lower(vmp_search.title) LIKE $${params.length}
        )
      )`);
    }
    params.push(limit);
    const limitParam = `$${params.length}`;
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query<MarketRow>(
      `SELECT
          ce.id::text AS canonical_event_id,
          ce.proposition_key,
          ce.title,
          ce.normalized_proposition_text,
          ce.canonical_category,
          ce.market_class,
          ce.starts_at::text,
          ce.expires_at::text,
          ce.resolves_at::text,
          ce.updated_at::text,
          ce.metadata AS event_metadata,
          MAX(fma.display_title) AS frontend_display_title,
          MIN(fma.sort_priority) AS frontend_sort_priority,
          COALESCE(
            array_agg(DISTINCT cem.id) FILTER (WHERE cem.id IS NOT NULL),
            array_agg(DISTINCT ce.proposition_key) FILTER (WHERE ce.proposition_key IS NOT NULL),
            '{}'
          ) AS canonical_market_ids,
          COALESCE(array_agg(DISTINCT vmp.venue) FILTER (WHERE vmp.venue IS NOT NULL), '{}') AS venues,
          COUNT(DISTINCT vmp.id)::text AS venue_market_count
         FROM canonical_events ce
         LEFT JOIN frontend_market_approvals fma
           ON fma.canonical_event_id = ce.id
         LEFT JOIN canonical_executable_markets cem
           ON cem.canonical_event_id = ce.id
         LEFT JOIN canonical_executable_market_members mem
           ON mem.canonical_executable_market_id = cem.id
         LEFT JOIN venue_market_profiles vmp
           ON vmp.id = mem.venue_market_profile_id OR vmp.canonical_event_id = ce.id
         ${where}
          ${where ? "AND" : "WHERE"} (cem.id IS NOT NULL OR vmp.id IS NOT NULL)
        GROUP BY ce.id
        ORDER BY COALESCE(MIN(fma.sort_priority), 1000) ASC,
                 ce.canonical_category ASC,
                 COALESCE(ce.expires_at, ce.resolves_at, ce.updated_at) DESC,
                 ce.title ASC
        LIMIT ${limitParam}`,
      params
    );
    return this.hydrateMarkets(result.rows);
  }

  public async listEvents(filter: MarketCatalogFilter = {}): Promise<MarketCatalogEvent[]> {
    const directLimit = Math.min(MAX_EVENT_SOURCE_LIMIT, Math.max(DEFAULT_LIMIT, clampLimit(filter.limit) * 10));
    const markets = await this.listMarkets({
      ...filter,
      limit: directLimit
    });
    const events = groupMarketsIntoEvents(markets);
    return events.slice(0, clampLimit(filter.limit));
  }

  public async getEvent(eventId: string): Promise<MarketCatalogEvent | null> {
    const events = await this.listEvents({ limit: MAX_LIMIT });
    return events.find((event) => event.eventId === eventId) ?? null;
  }

  public async getMarket(marketId: string): Promise<MarketCatalogMarket | null> {
    const lookupIds = marketLookupCandidates(marketId);
    const result = await this.pool.query<MarketRow>(
      `SELECT
          ce.id::text AS canonical_event_id,
          ce.proposition_key,
          ce.title,
          ce.normalized_proposition_text,
          ce.canonical_category,
          ce.market_class,
          ce.starts_at::text,
          ce.expires_at::text,
          ce.resolves_at::text,
          ce.updated_at::text,
          ce.metadata AS event_metadata,
          MAX(fma.display_title) AS frontend_display_title,
          MIN(fma.sort_priority) AS frontend_sort_priority,
          COALESCE(
            array_agg(DISTINCT cem.id) FILTER (WHERE cem.id IS NOT NULL),
            array_agg(DISTINCT ce.proposition_key) FILTER (WHERE ce.proposition_key IS NOT NULL),
            '{}'
          ) AS canonical_market_ids,
          COALESCE(array_agg(DISTINCT vmp.venue) FILTER (WHERE vmp.venue IS NOT NULL), '{}') AS venues,
          COUNT(DISTINCT vmp.id)::text AS venue_market_count
         FROM canonical_events ce
         JOIN frontend_market_approvals fma
           ON fma.canonical_event_id = ce.id
          AND fma.status = 'APPROVED'
          AND fma.metadata->>'source' = '${FRONTEND_SHARED_CORE_APPROVAL_SOURCE}'
         LEFT JOIN canonical_executable_markets cem
           ON cem.canonical_event_id = ce.id
         LEFT JOIN canonical_executable_market_members mem
           ON mem.canonical_executable_market_id = cem.id
         LEFT JOIN venue_market_profiles vmp
           ON vmp.id = mem.venue_market_profile_id OR vmp.canonical_event_id = ce.id
        WHERE (ce.id::text = ANY($1::text[]) OR cem.id = ANY($1::text[]) OR ce.proposition_key = ANY($1::text[]))
          AND NOT EXISTS (
            SELECT 1
             FROM unnest($2::text[]) excluded(prefix)
             WHERE upper(ce.proposition_key) = upper(excluded.prefix)
                OR upper(ce.proposition_key) LIKE '%' || upper(excluded.prefix) || '%'
                OR EXISTS (
                  SELECT 1
                    FROM canonical_executable_markets cem_excluded
                   WHERE cem_excluded.canonical_event_id = ce.id
                     AND (
                       upper(cem_excluded.id) = upper(excluded.prefix)
                       OR upper(cem_excluded.id) LIKE '%' || upper(excluded.prefix) || '%'
                     )
                )
          )
        GROUP BY ce.id
        ORDER BY MIN(
          CASE
            WHEN ce.id::text = $3 OR cem.id = $3 OR ce.proposition_key = $3 THEN 0
            ELSE 1
          END
        )
        LIMIT 1`,
      [lookupIds, [...FRONTEND_CATALOG_EXCLUDED_TOPIC_PREFIXES], marketId]
    );
    const [market] = await this.hydrateMarkets(result.rows);
    return market ?? null;
  }

  private async hydrateMarkets(rows: MarketRow[]): Promise<MarketCatalogMarket[]> {
    if (rows.length === 0) {
      return [];
    }
    const eventIds = rows.map((row) => row.canonical_event_id);
    const venueRows = await this.pool.query<VenueMarketRow>(
      `SELECT
          ce.id::text AS canonical_event_id,
          COALESCE(cem.id, ce.proposition_key) AS canonical_market_id,
          COALESCE(cem.display_name, ce.title) AS canonical_market_title,
          vmp.id AS venue_market_profile_id,
          vmp.venue,
          vmp.venue_market_id,
          vmp.title AS venue_title,
          vmp.market_class,
          vmp.outcomes,
          vmp.network,
          vmp.chain,
          vmp.expires_at::text,
          vmp.resolves_at::text,
          vmp.normalized_payload,
          vmp.raw_source_payload
         FROM canonical_events ce
         JOIN venue_market_profiles vmp
           ON vmp.canonical_event_id = ce.id
         LEFT JOIN canonical_executable_market_members mem
           ON mem.venue_market_profile_id = vmp.id
         LEFT JOIN canonical_executable_markets cem
           ON cem.id = mem.canonical_executable_market_id
        WHERE ce.id = ANY($1::uuid[])
        ORDER BY COALESCE(cem.id, ce.proposition_key), vmp.venue, vmp.title`,
      [eventIds]
    );
    const byEvent = new Map<string, VenueMarketRow[]>();
    for (const row of venueRows.rows) {
      const bucket = byEvent.get(row.canonical_event_id) ?? [];
      bucket.push(row);
      byEvent.set(row.canonical_event_id, bucket);
    }
    return rows.map((row) => toMarket(row, byEvent.get(row.canonical_event_id) ?? []));
  }
}

export class SharedCoreQuoteMappingRepository implements SharedCoreQuoteMappingLoader {
  public constructor(
    private readonly pool: Pool,
    private readonly options: { approvalSource?: string | undefined } = {}
  ) {}

  public async loadApprovedVenueMappings(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly SharedCoreVenueQuoteMappingRow[]> {
    const result = await this.pool.query<SharedCoreVenueQuoteMappingRow>(
      `WITH selected_event AS (
         SELECT ce.id
           FROM canonical_events ce
           LEFT JOIN canonical_executable_markets cem
             ON cem.canonical_event_id = ce.id
          WHERE (ce.id::text = $1
             OR ce.proposition_key = $1
             OR cem.id = $1
             OR regexp_replace(cem.id, ':(POLYMARKET|LIMITLESS|PREDICT|PREDICT_FUN|OPINION|MYRIAD)$', '') = $1)
            AND NOT EXISTS (
              SELECT 1
               FROM unnest($3::text[]) excluded(prefix)
               WHERE upper(ce.proposition_key) = upper(excluded.prefix)
                  OR upper(ce.proposition_key) LIKE '%' || upper(excluded.prefix) || '%'
                  OR EXISTS (
                    SELECT 1
                      FROM canonical_executable_markets cem_excluded
                     WHERE cem_excluded.canonical_event_id = ce.id
                       AND (
                         upper(cem_excluded.id) = upper(excluded.prefix)
                         OR upper(cem_excluded.id) LIKE '%' || upper(excluded.prefix) || '%'
                       )
                  )
            )
          LIMIT 1
       )
       SELECT
         vmp.venue,
         vmp.venue_market_id,
         vmp.normalized_payload,
         vmp.raw_source_payload
        FROM selected_event se
        JOIN frontend_market_approvals fma
          ON fma.canonical_event_id = se.id
         AND fma.status = 'APPROVED'
         AND fma.metadata->>'source' = $2
       JOIN venue_market_profiles vmp
          ON vmp.canonical_event_id = se.id
       ORDER BY vmp.venue`,
      [
        input.canonicalMarketId,
        this.options.approvalSource ?? FRONTEND_SHARED_CORE_APPROVAL_SOURCE,
        [...FRONTEND_CATALOG_EXCLUDED_TOPIC_PREFIXES]
      ]
    );
    return result.rows;
  }

  public async listApprovedVenueMappings(input: {
    limit: number;
  }): Promise<readonly SharedCoreVenueQuoteMappingRow[]> {
    const result = await this.pool.query<SharedCoreVenueQuoteMappingRow>(
      `WITH selected_events AS (
         SELECT ce.id
           FROM canonical_events ce
           JOIN frontend_market_approvals fma
             ON fma.canonical_event_id = ce.id
            AND fma.status = 'APPROVED'
            AND fma.metadata->>'source' = $2
          WHERE NOT EXISTS (
            SELECT 1
             FROM unnest($3::text[]) excluded(prefix)
             WHERE upper(ce.proposition_key) = upper(excluded.prefix)
                OR upper(ce.proposition_key) LIKE '%' || upper(excluded.prefix) || '%'
                OR EXISTS (
                  SELECT 1
                    FROM canonical_executable_markets cem_excluded
                   WHERE cem_excluded.canonical_event_id = ce.id
                     AND (
                       upper(cem_excluded.id) = upper(excluded.prefix)
                       OR upper(cem_excluded.id) LIKE '%' || upper(excluded.prefix) || '%'
                     )
                )
          )
          ORDER BY COALESCE(fma.sort_priority, 1000), ce.updated_at DESC
          LIMIT $1
       )
       SELECT
         ce.id::text AS canonical_event_id,
         cem.id AS canonical_market_id,
         ce.title,
         ce.canonical_category,
         vmp.venue,
         vmp.venue_market_id,
         vmp.normalized_payload,
         vmp.raw_source_payload
        FROM selected_events se
        JOIN canonical_events ce
          ON ce.id = se.id
        LEFT JOIN canonical_executable_markets cem
          ON cem.canonical_event_id = ce.id
        JOIN venue_market_profiles vmp
          ON vmp.canonical_event_id = ce.id
       ORDER BY ce.title, vmp.venue`,
      [
        Math.max(1, Math.min(1000, Math.floor(input.limit))),
        this.options.approvalSource ?? FRONTEND_SHARED_CORE_APPROVAL_SOURCE,
        [...FRONTEND_CATALOG_EXCLUDED_TOPIC_PREFIXES]
      ]
    );
    return result.rows;
  }
}

const toMarket = (row: MarketRow, venueRows: VenueMarketRow[]): MarketCatalogMarket => {
  const venues = normalizeStringArray(row.venues);
  const venueMarkets = venueRows.map(toVenueMarket);
  const outcomeLabels = new Set(venueMarkets.flatMap((market) => market.outcomes.map((outcome) => outcome.label)));
  const eventGroup = deriveEventGroup(row);
  const display = deriveMarketDisplayMetadata(row);
  const media = chooseMarketMedia(venueMarkets);
  const metrics = aggregateVenueMetrics(venueMarkets);
  const expiresAt = row.expires_at ?? venueMarkets.find((market) => market.expiresAt !== null)?.expiresAt ?? null;
  const resolvesAt = row.resolves_at ?? venueMarkets.find((market) => market.resolvesAt !== null)?.resolvesAt ?? null;
  return {
    eventId: eventGroup.eventId,
    eventTitle: eventGroup.title,
    canonicalEventId: row.canonical_event_id,
    canonicalMarketIds: normalizeStringArray(row.canonical_market_ids),
    displayTopic: display.displayTopic,
    displayOutcome: display.displayOutcome,
    displayOutcomeKey: display.displayOutcomeKey,
    title: row.frontend_display_title?.trim() || displayTitle(row.title, row.proposition_key),
    normalizedTitle: row.normalized_proposition_text,
    category: row.canonical_category,
    marketClass: row.market_class,
    status: marketStatus(expiresAt, resolvesAt),
    startsAt: row.starts_at,
    expiresAt,
    resolvesAt,
    venues,
    venueCount: venues.length,
    venueMarketCount: Number(row.venue_market_count),
    outcomeCount: outcomeLabels.size,
    routeability: {
      hasSingleVenue: venues.length > 0,
      hasCrossVenue: venues.length > 1
    },
    imageUrl: media.imageUrl,
    iconUrl: media.iconUrl,
    volume: metrics.volume,
    volume24h: metrics.volume24h,
    liquidity: metrics.liquidity,
    buyVolume: metrics.buyVolume,
    sellVolume: metrics.sellVolume,
    tradeCount: metrics.tradeCount,
    buyCount: metrics.buyCount,
    sellCount: metrics.sellCount,
    venueMarkets,
    updatedAt: row.updated_at
  };
};

export const deriveMarketDisplayMetadata = (row: MarketDisplayMetadataInput): {
  displayTopic: string;
  displayOutcome: string;
  displayOutcomeKey: string;
} => {
  const canonicalId = normalizeStringArray(row.canonical_market_ids)[0] ?? row.proposition_key;
  const parts = canonicalIdParts(canonicalId);
  const fallbackTitle = row.frontend_display_title?.trim() || displayTitle(row.title, row.proposition_key);
  const fallbackOutcome = deriveFallbackOutcomeLabel(fallbackTitle);
  const fallbackTopic = deriveFallbackTopicLabel(fallbackTitle);

  if (parts[0] === "CRYPTO" && parts[1] === "ATH_BY_DATE" && parts[2] && parts[3]) {
    const date = normalizeDateToken(parts[3]) ?? normalizeDateToken(parts[4]);
    if (date) {
      return {
        displayTopic: `${assetLabel(parts[2])} ATH by ____`,
        displayOutcome: formatDisplayDate(date),
        displayOutcomeKey: `date:${date}`
      };
    }
  }

  if (parts[0] === "GEOPOLITICAL_EVENT_BY_DATE" && parts[2] && parts[3]) {
    const date = normalizeDateToken(parts[3]);
    if (date) {
      return {
        displayTopic: `${toTitleCase(parts[2])} by ____`,
        displayOutcome: formatDisplayDate(date),
        displayOutcomeKey: `date:${date}`
      };
    }
  }

  if (parts[0] === "OFFICE_EXIT_BY_DATE" && parts[3] && parts[4]) {
    const date = normalizeDateToken(parts[4]);
    if (date) {
      return {
        displayTopic: `${toTitleCase(parts[3])} out by ____`,
        displayOutcome: formatDisplayDate(date),
        displayOutcomeKey: `date:${date}`
      };
    }
  }

  if (parts[0] === "NOMINEE" && parts[1] === "US_PRESIDENT" && parts[2] && parts[3] && parts[4]) {
    return {
      displayTopic: `${toTitleCase(parts[3])} Presidential Nominee ${parts[2]}`,
      displayOutcome: toTitleCase(parts[4]),
      displayOutcomeKey: `candidate:${parts[4].toUpperCase()}`
    };
  }

  if (parts[0] === "OFFICE_WINNER" && parts.length >= 5) {
    const candidate = parts[parts.length - 1];
    return {
      displayTopic: `${toTitleCase(parts.slice(1, -1).join(" "))} Winner`,
      displayOutcome: toTitleCase(candidate ?? fallbackOutcome),
      displayOutcomeKey: `candidate:${(candidate ?? fallbackOutcome).toUpperCase().replace(/\s+/g, "_")}`
    };
  }

  if (parts[0] === "SPORTS" && parts[1] === "TOURNAMENT_WINNER" && parts[2] && parts[3] && parts[4]) {
    const tournament = parts[2].toUpperCase() === "FIFA_WORLD_CUP" ? "FIFA World Cup" : toTitleCase(parts[2]);
    return {
      displayTopic: `${tournament} ${parts[3]} Winner`,
      displayOutcome: toTitleCase(parts[4]),
      displayOutcomeKey: `candidate:${parts[4].toUpperCase().replace(/\s+/g, "_")}`
    };
  }

  if (parts[0] === "CRYPTO" && parts[1] === "FDV_THRESHOLD_AFTER_LAUNCH" && parts[2]) {
    const amount = parts[parts.length - 1] ?? fallbackOutcome;
    const numeric = parts.find((part) => /^\d{5,}$/.test(part));
    return {
      displayTopic: `${toTitleCase(parts[2])} FDV One Day After Launch`,
      displayOutcome: formatMoneyCandidate(amount),
      displayOutcomeKey: `threshold:${numeric ?? amount.toUpperCase()}`
    };
  }

  if (parts[0] === "CRYPTO" && parts[1] === "TOKEN_LAUNCH_BY_DATE" && parts[2] && parts[3]) {
    const date = normalizeDateToken(parts[3]) ?? normalizeDateToken(parts[4]);
    if (date) {
      return {
        displayTopic: `${assetProjectLabel(parts[2])} to launch a token by ____`,
        displayOutcome: formatDisplayDate(date),
        displayOutcomeKey: `date:${date}`
      };
    }
  }

  if (parts[0] === "CRYPTO" && parts[1] === "THRESHOLD_BY_DATE" && parts[2] && parts[3] && parts[4] && parts[5]) {
    const date = normalizeDateToken(parts[3]);
    if (date) {
      return {
        displayTopic: `What price will ${assetProjectLabel(parts[2])} hit in ${formatMonthYear(date)}?`,
        displayOutcome: `${parts[4].toUpperCase() === "BELOW" ? "↓" : "↑"} ${formatPriceCandidate(parts[5])}`,
        displayOutcomeKey: `threshold:${parts[4].toUpperCase()}:${parts[5].replace(/[,_]/g, "")}`
      };
    }
  }

  if (parts[0] === "CRYPTO" && parts[1] === "FIRST_TO_THRESHOLD_BY_DATE" && parts[2] && parts[3] && parts[4]) {
    return {
      displayTopic: `${assetLabel(parts[2])} first to hit ____`,
      displayOutcome: `${formatPriceCandidate(parts[3])} or ${formatPriceCandidate(parts[4])} first`,
      displayOutcomeKey: `first-threshold:${parts[3].replace(/[,_]/g, "")}:${parts[4].replace(/[,_]/g, "")}`
    };
  }

  const fallbackDate = normalizeDateToken(fallbackOutcome);
  return {
    displayTopic: fallbackTopic,
    displayOutcome: fallbackDate ? formatDisplayDate(fallbackDate) : fallbackOutcome,
    displayOutcomeKey: fallbackDate ? `date:${fallbackDate}` : `label:${fallbackOutcome.toUpperCase().replace(/\s+/g, "_")}`
  };
};

const groupMarketsIntoEvents = (markets: MarketCatalogMarket[]): MarketCatalogEvent[] => {
  const groups = new Map<string, MarketCatalogMarket[]>();
  for (const market of markets) {
    const eventId = market.eventId ?? market.canonicalEventId;
    const group = groups.get(eventId) ?? [];
    group.push(market);
    groups.set(eventId, group);
  }
  return [...groups.entries()].map(([eventId, groupedMarkets]) => {
    const [firstMarket] = groupedMarkets;
    const venues = normalizeStringArray(groupedMarkets.flatMap((market) => market.venues));
    const outcomeCount = groupedMarkets.reduce((total, market) => total + market.outcomeCount, 0);
    const venueMarketCount = groupedMarkets.reduce((total, market) => total + market.venueMarketCount, 0);
    const metrics = aggregateVenueMetrics(groupedMarkets);
    const latestUpdatedAt = groupedMarkets
      .map((market) => market.updatedAt)
      .sort((left, right) => right.localeCompare(left))[0] ?? firstMarket!.updatedAt;
    const media = chooseMarketMedia(groupedMarkets);
    return {
      eventId,
      title: firstMarket!.eventTitle ?? firstMarket!.title,
      normalizedTitle: firstMarket!.normalizedTitle,
      category: firstMarket!.category,
      status: aggregateStatus(groupedMarkets),
      marketCount: groupedMarkets.length,
      featuredMarkets: groupedMarkets.slice(0, 4),
      markets: groupedMarkets,
      venues,
      venueCount: venues.length,
      venueMarketCount,
      outcomeCount,
      routeability: {
        hasSingleVenue: groupedMarkets.some((market) => market.routeability.hasSingleVenue),
        hasCrossVenue: groupedMarkets.some((market) => market.routeability.hasCrossVenue)
      },
      imageUrl: media.imageUrl,
      iconUrl: media.iconUrl,
      volume: metrics.volume,
      volume24h: metrics.volume24h,
      liquidity: metrics.liquidity,
      buyVolume: metrics.buyVolume,
      sellVolume: metrics.sellVolume,
      tradeCount: metrics.tradeCount,
      buyCount: metrics.buyCount,
      sellCount: metrics.sellCount,
      updatedAt: latestUpdatedAt
    };
  });
};

const aggregateStatus = (markets: MarketCatalogMarket[]): MarketCatalogMarket["status"] => {
  if (markets.some((market) => market.status === "OPEN")) {
    return "OPEN";
  }
  if (markets.some((market) => market.status === "RESOLVING")) {
    return "RESOLVING";
  }
  return "RESOLVED_OR_EXPIRED";
};

const deriveEventGroup = (row: MarketRow): { eventId: string; title: string } => {
  const metadata = isRecord(row.event_metadata) ? row.event_metadata : {};
  const curatedKey = typeof metadata["curatedKey"] === "string" ? metadata["curatedKey"] : row.proposition_key;
  const curatedGroup = deriveCuratedEventGroup(curatedKey);
  if (curatedGroup) {
    return curatedGroup;
  }
  const heuristicGroup = deriveTitleEventGroup(row.title);
  if (heuristicGroup) {
    return heuristicGroup;
  }
  return {
    eventId: `event:${row.canonical_event_id}`,
    title: row.frontend_display_title?.trim() || displayTitle(row.title, row.proposition_key)
  };
};

const deriveCuratedEventGroup = (key: string): { eventId: string; title: string } | null => {
  const parts = key.split("|").filter(Boolean);
  if (parts[0] === "NOMINEE" && parts[1] === "US_PRESIDENT" && parts[2] && parts[3]) {
    const eventKey = parts.slice(0, 4).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: `${toTitleCase(parts[3])} Presidential Nominee ${parts[2]}`
    };
  }
  if (parts[0] === "OFFICE_WINNER" && parts[1] === "USA" && parts[2] === "US_PRESIDENT" && parts[3]) {
    const eventKey = parts.slice(0, 4).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: `US Presidential Winner ${parts[3]}`
    };
  }
  if ((parts[0] === "SPORTS" || parts[0] === "ESPORTS") && parts[1] && parts[2] && parts[3]) {
    const eventKey = `${parts[2] === "LCK" || parts[2] === "LPL" ? "ESPORTS" : parts[0]}|${parts.slice(1, 4).join("|")}`;
    return {
      eventId: `event:${eventKey}`,
      title: `${toTitleCase(parts.slice(2, 4).join(" "))} Winner`
    };
  }
  if (parts[0] === "OFFICE_WINNER" && parts[1] && parts[2] && parts[3]) {
    const eventKey = parts.slice(0, 4).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: `${toTitleCase(parts.slice(1, 4).join(" "))} Winner`
    };
  }
  if (parts[0] === "PARTY_CONTROL" && parts.length >= 5) {
    const eventKey = parts.slice(0, 5).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: `${parts[3]} ${toTitleCase(parts.slice(4, 5).join(" "))}`.trim()
    };
  }
  if ((parts[0] === "GEOPOLITICAL_EVENT_BY_DATE" || parts[0] === "OFFICE_EXIT_BY_DATE") && parts.length >= 4) {
    const eventKey = parts.slice(0, -1).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: toTitleCase(parts.slice(1, -1).join(" "))
    };
  }
  if (parts[0] === "CRYPTO" && parts[1] === "ATH_BY_DATE" && parts[2]) {
    const eventKey = parts.slice(0, 3).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: `${toTitleCase(parts[2])} All-Time High By Date`
    };
  }
  if (parts[0] === "CRYPTO" && parts[1] === "THRESHOLD_BY_DATE" && parts[2] && parts[3]) {
    const eventKey = parts.slice(0, 4).join("|");
    const date = normalizeDateToken(parts[3]);
    return {
      eventId: `event:${eventKey}`,
      title: date ? `What price will ${assetProjectLabel(parts[2])} hit in ${formatMonthYear(date)}?` : `${toTitleCase(parts[2])} Threshold By ${parts[3]}`
    };
  }
  if (parts[0] === "CRYPTO" && parts[1] === "FDV_THRESHOLD_AFTER_LAUNCH" && parts[2]) {
    const eventKey = parts.slice(0, 4).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: `${toTitleCase(parts[2])} FDV One Day After Launch`
    };
  }
  if (parts[0] === "CRYPTO" && parts[1] === "TOKEN_LAUNCH_BY_DATE" && parts[2]) {
    const eventKey = parts.slice(0, 3).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: `${assetProjectLabel(parts[2])} to launch a token by ____`
    };
  }
  if (parts[0] === "CRYPTO" && parts[1] === "FIRST_TO_THRESHOLD_BY_DATE" && parts[2]) {
    const eventKey = parts.slice(0, 3).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: `${assetLabel(parts[2])} first to hit ____`
    };
  }
  return null;
};

const deriveTitleEventGroup = (title: string): { eventId: string; title: string } | null => {
  const normalized = title.trim();
  const republican = normalized.match(/Republican presidential nomination/i);
  if (republican) {
    return { eventId: "event:NOMINEE|US_PRESIDENT|2028|REPUBLICAN", title: "Republican Presidential Nominee 2028" };
  }
  const democratic = normalized.match(/Democratic presidential nomination/i);
  if (democratic) {
    return { eventId: "event:NOMINEE|US_PRESIDENT|2028|DEMOCRATIC", title: "Democratic Presidential Nominee 2028" };
  }
  const lck = normalized.match(/win the LCK 2026 season playoffs/i);
  if (lck) {
    return { eventId: "event:ESPORTS|LEAGUE_WINNER|LCK|2026", title: "LCK 2026 Season Winner" };
  }
  return null;
};

const toVenueMarket = (row: VenueMarketRow): MarketCatalogVenueMarket => {
  const payloadExpiresAt = extractSanitizedTimestamp(row.normalized_payload, row.raw_source_payload, [
    "expiresAt",
    "expires_at",
    "endDate",
    "end_date",
    "endDateIso",
    "end_date_iso",
    "closeTime",
    "close_time"
  ]);
  const payloadResolvesAt = extractSanitizedTimestamp(row.normalized_payload, row.raw_source_payload, [
    "resolvesAt",
    "resolves_at",
    "resolvedAt",
    "resolved_at",
    "resolutionTime",
    "resolution_time"
  ]);
  const curatedTimestamp = extractCuratedTimestamp(row.normalized_payload, row.raw_source_payload);
  return {
    canonicalMarketId: row.canonical_market_id,
    canonicalMarketTitle: displayTitle(row.canonical_market_title, row.canonical_market_id),
    venue: row.venue === "PREDICT" ? "PREDICT_FUN" : row.venue,
    venueMarketProfileId: row.venue_market_profile_id,
    venueMarketId: row.venue_market_id,
    venueTitle: row.venue_title,
    imageUrl: extractSanitizedMediaUrl(row.normalized_payload, row.raw_source_payload, ["imageUrl", "image_url", "image", "twitterCardImage", "thumbnailUrl", "thumbnail", "banner"]),
    iconUrl: extractSanitizedMediaUrl(row.normalized_payload, row.raw_source_payload, ["iconUrl", "icon_url", "icon", "logoUrl", "logo"]),
    volume: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["volume", "totalVolume", "total_volume", "volumeTotalUsd", "volume_total_usd"]),
    volume24h: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["volume24h", "volume24hr", "volume_24h", "volume24hUsd", "volume_24h_usd", "volume_1d"]),
    liquidity: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["liquidity", "totalLiquidity", "total_liquidity", "totalLiquidityUsd", "total_liquidity_usd", "openInterest", "open_interest"]),
    buyVolume: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["buyVolume", "buy_volume", "buyVolumeUsd", "buy_volume_usd", "totalBuyVolume", "total_buy_volume"]),
    sellVolume: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["sellVolume", "sell_volume", "sellVolumeUsd", "sell_volume_usd", "totalSellVolume", "total_sell_volume"]),
    tradeCount: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["tradeCount", "trade_count", "tradesCount", "trades_count", "transactionCount", "transaction_count"]),
    buyCount: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["buyCount", "buy_count", "buyTrades", "buy_trades", "buyTransactions", "buy_transactions"]),
    sellCount: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["sellCount", "sell_count", "sellTrades", "sell_trades", "sellTransactions", "sell_transactions"]),
    change24h: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["change24h", "change_24h", "priceChange24h", "price_change_24h", "oneDayPriceChange", "one_day_price_change", "dailyChange", "daily_change"]),
    changePercent24h: extractNumericMetric(row.normalized_payload, row.raw_source_payload, ["changePercent24h", "change_percent_24h", "priceChangePercent24h", "price_change_percent_24h", "oneDayPriceChangePercent", "one_day_price_change_percent", "percentChange24h", "percent_change_24h", "changePct24h", "change_pct_24h"]),
    marketClass: row.market_class,
    outcomes: normalizeOutcomes(row.outcomes),
    network: row.network,
    chain: row.chain,
    expiresAt: row.expires_at ?? payloadExpiresAt ?? curatedTimestamp,
    resolvesAt: row.resolves_at ?? payloadResolvesAt ?? payloadExpiresAt ?? curatedTimestamp
  };
};

const chooseMarketMedia = (
  items: Array<{ imageUrl: string | null; iconUrl: string | null }>
): { imageUrl: string | null; iconUrl: string | null } => ({
  imageUrl: items.find((item) => item.imageUrl !== null)?.imageUrl ?? null,
  iconUrl: items.find((item) => item.iconUrl !== null)?.iconUrl ?? null
});

const aggregateVenueMetrics = (
  items: Array<{
    volume?: string | null;
    volume24h?: string | null;
    liquidity?: string | null;
    buyVolume?: string | null;
    sellVolume?: string | null;
    tradeCount?: string | null;
    buyCount?: string | null;
    sellCount?: string | null;
  }>
): {
  volume: string | null;
  volume24h: string | null;
  liquidity: string | null;
  buyVolume: string | null;
  sellVolume: string | null;
  tradeCount: string | null;
  buyCount: string | null;
  sellCount: string | null;
} => ({
  volume: sumNumericStrings(items.map((item) => item.volume)),
  volume24h: sumNumericStrings(items.map((item) => item.volume24h)),
  liquidity: sumNumericStrings(items.map((item) => item.liquidity)),
  buyVolume: sumNumericStrings(items.map((item) => item.buyVolume)),
  sellVolume: sumNumericStrings(items.map((item) => item.sellVolume)),
  tradeCount: sumNumericStrings(items.map((item) => item.tradeCount)),
  buyCount: sumNumericStrings(items.map((item) => item.buyCount)),
  sellCount: sumNumericStrings(items.map((item) => item.sellCount))
});

const MEDIA_HOST_ALLOWLIST = [
  "polymarket-upload.s3.us-east-2.amazonaws.com",
  "polymarket.com",
  "gamma-api.polymarket.com",
  "cdn.polymarket.com",
  "myriad.markets",
  "myriad.social",
  "cdn.myriad.markets",
  "cdn.myriad.social",
  "limitless.exchange",
  "predict.fun"
];

const extractSanitizedMediaUrl = (
  normalizedPayload: unknown,
  rawSourcePayload: unknown,
  fieldNames: readonly string[]
): string | null => {
  const candidates = [
    ...collectStringFields(normalizedPayload, fieldNames, 3),
    ...collectStringFields(rawSourcePayload, fieldNames, 4)
  ];
  for (const candidate of candidates) {
    const sanitized = sanitizeMediaUrl(candidate);
    if (sanitized) {
      return sanitized;
    }
  }
  return null;
};

const extractSanitizedTimestamp = (
  normalizedPayload: unknown,
  rawSourcePayload: unknown,
  fieldNames: readonly string[]
): string | null => {
  const candidates = [
    ...collectStringFields(normalizedPayload, fieldNames, 3),
    ...collectStringFields(rawSourcePayload, fieldNames, 4)
  ];
  for (const candidate of candidates) {
    const sanitized = sanitizeTimestamp(candidate);
    if (sanitized) {
      return sanitized;
    }
  }
  return null;
};

const extractCuratedTimestamp = (
  normalizedPayload: unknown,
  rawSourcePayload: unknown
): string | null => {
  const curatedKeys = [
    ...collectStringFields(normalizedPayload, ["curatedKey", "curated_key"], 1),
    ...collectStringFields(rawSourcePayload, ["curatedKey", "curated_key"], 1)
  ];
  for (const key of curatedKeys) {
    const date = key.split("|").find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part));
    if (date) {
      return `${date}T12:00:00.000Z`;
    }
  }
  return null;
};

const extractNumericMetric = (
  normalizedPayload: unknown,
  rawSourcePayload: unknown,
  fieldNames: readonly string[]
): string | null => {
  const candidates = [
    ...collectNumericFields(normalizedPayload, fieldNames, 3),
    ...collectNumericFields(rawSourcePayload, fieldNames, 4)
  ];
  for (const candidate of candidates) {
    const parsed = parseFiniteMetric(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
};

const collectStringFields = (
  value: unknown,
  fieldNames: readonly string[],
  depth: number
): string[] => {
  if (depth < 0) {
    return [];
  }
  if (typeof value === "string") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringFields(entry, fieldNames, depth - 1));
  }
  if (!isRecord(value)) {
    return [];
  }
  const direct = fieldNames.flatMap((field) => {
    const candidate = value[field];
    return typeof candidate === "string" ? [candidate] : [];
  });
  const nested = Object.values(value).flatMap((entry) => collectStringFields(entry, fieldNames, depth - 1));
  return [...direct, ...nested];
};

const collectNumericFields = (
  value: unknown,
  fieldNames: readonly string[],
  depth: number
): unknown[] => {
  if (depth < 0 || typeof value === "string") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectNumericFields(entry, fieldNames, depth - 1));
  }
  if (!isRecord(value)) {
    return [];
  }
  const direct = fieldNames.flatMap((field) => {
    const candidate = value[field];
    return typeof candidate === "string" || typeof candidate === "number" ? [candidate] : [];
  });
  const nested = Object.values(value).flatMap((entry) => collectNumericFields(entry, fieldNames, depth - 1));
  return [...direct, ...nested];
};

const parseFiniteMetric = (value: unknown): string | null => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.replace(/[$,\s]/g, ""))
      : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed.toFixed(8).replace(/\.?0+$/, "");
};

const sumNumericStrings = (values: Array<string | null | undefined>): string | null => {
  const total = values.reduce((sum, value) => {
    const parsed = parseFiniteMetric(value);
    return parsed === null ? sum : sum + Number(parsed);
  }, 0);
  return total > 0 ? parseFiniteMetric(total) : null;
};

const sanitizeMediaUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  const hostname = parsed.hostname.toLowerCase();
  const allowed = MEDIA_HOST_ALLOWLIST.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  return allowed ? parsed.toString() : null;
};

const sanitizeTimestamp = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T12:00:00.000Z`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const normalizeOutcomes = (value: unknown): Array<{ id: string; label: string }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => {
      if (entry === null || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const label = typeof record["label"] === "string" ? record["label"] : null;
      if (!label) {
        return null;
      }
      const id = typeof record["id"] === "string" ? record["id"] : label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `outcome-${index}`;
      return { id, label };
    })
    .filter((entry): entry is { id: string; label: string } => entry !== null);
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry === "PREDICT" ? "PREDICT_FUN" : entry))].sort();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const clampLimit = (value: number | undefined): number => {
  if (!Number.isFinite(value ?? NaN)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value!)));
};

const marketLookupCandidates = (marketId: string): string[] => {
  const trimmed = marketId.trim();
  if (!trimmed) return [marketId];
  const withoutVenueSuffix = trimmed.replace(VENUE_SUFFIX_PATTERN, "");
  return withoutVenueSuffix === trimmed ? [trimmed] : [trimmed, withoutVenueSuffix];
};

const marketStatus = (expiresAt: string | null, resolvesAt: string | null): MarketCatalogMarket["status"] => {
  const now = Date.now();
  const resolvedAtMs = parseRealTimestamp(resolvesAt);
  if (resolvedAtMs !== null && resolvedAtMs <= now) {
    return "RESOLVED_OR_EXPIRED";
  }
  const expiresAtMs = parseRealTimestamp(expiresAt);
  if (expiresAtMs !== null && expiresAtMs <= now) {
    return "RESOLVING";
  }
  return "OPEN";
};

const parseRealTimestamp = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  // Some venue APIs use Unix epoch-ish timestamps as "not set" placeholders.
  return parsed <= Date.UTC(2001, 0, 1) ? null : parsed;
};

const displayTitle = (title: string, fallbackKey: string): string => {
  const source = title.trim() || fallbackKey.trim();
  const key = source.includes("|") ? source : fallbackKey.includes("|") ? fallbackKey : "";
  if (key) {
    const specialized = humanizeTopicKey(key);
    if (specialized) {
      return specialized;
    }
  }
  return toTitleCase(source.replace(/[_|]+/g, " "));
};

const canonicalIdParts = (value: string): string[] => {
  const withoutPrefix = value.replace(/^FRONTEND_CURATED:/i, "");
  const withoutVenue = withoutPrefix.replace(/:[A-Z_]+$/i, "");
  return withoutVenue.split("|").filter(Boolean);
};

const normalizeDateToken = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim().replace(/_/g, "-");
  const compact = trimmed.match(/\b(20\d{2})[-\s](\d{2})[-\s](\d{2})\b/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  const natural = Date.parse(trimmed);
  if (Number.isFinite(natural) && /\b20\d{2}\b/.test(trimmed) && /[A-Za-z]/.test(trimmed)) {
    return new Date(natural).toISOString().slice(0, 10);
  }
  return null;
};

const formatDisplayDate = (date: string): string =>
  new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });

const formatMonthYear = (date: string): string =>
  new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });

const assetLabel = (value: string): string => {
  const normalized = value.toUpperCase();
  if (["BTC", "ETH", "SOL", "XRP"].includes(normalized)) {
    return normalized;
  }
  return toTitleCase(value);
};

const assetProjectLabel = (value: string): string => {
  const normalized = value.toUpperCase();
  const labels: Record<string, string> = {
    BASE: "Base",
    BNB: "BNB",
    BTC: "Bitcoin",
    ETH: "Ethereum",
    SOL: "Solana",
    XRP: "XRP"
  };
  return labels[normalized] ?? toTitleCase(value);
};

const formatPriceCandidate = (value: string): string => {
  const normalized = value.trim().replace(/_/g, "").toUpperCase();
  if (/^\$/.test(normalized)) return normalized;
  const numeric = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return normalized;
  return `$${numeric.toLocaleString("en-US", {
    maximumFractionDigits: 2
  })}`;
};

const formatMoneyCandidate = (value: string): string => {
  const normalized = value.trim().replace(/_/g, "").toUpperCase();
  if (/^\$/.test(normalized)) return normalized;
  if (/^\d+(?:\.\d+)?[KMBT]$/.test(normalized)) return `$${normalized}`;
  const numeric = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return normalized;
  if (numeric >= 1_000_000_000_000) return `$${formatCompactNumber(numeric / 1_000_000_000_000)}T`;
  if (numeric >= 1_000_000_000) return `$${formatCompactNumber(numeric / 1_000_000_000)}B`;
  if (numeric >= 1_000_000) return `$${formatCompactNumber(numeric / 1_000_000)}M`;
  if (numeric >= 1_000) return `$${formatCompactNumber(numeric / 1_000)}K`;
  return `$${formatCompactNumber(numeric)}`;
};

const formatCompactNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");

const deriveFallbackOutcomeLabel = (title: string): string => {
  const suffix = title.match(/:\s*(.+)$/)?.[1]?.trim();
  if (suffix) return suffix;
  const datePhrase = title.match(/\b(?:by|before|after|on)\s+(.+?)(?:\?|$)/i)?.[1]?.trim();
  if (datePhrase) return datePhrase;
  return title.replace(/\?$/, "").trim();
};

const deriveFallbackTopicLabel = (title: string): string => {
  const withoutSuffix = title.replace(/\s*:\s*.+$/, "").trim();
  const dated = withoutSuffix.match(/^(.+?)\s+(?:by|before|after|on)\s+.+$/i);
  return (dated?.[1] ?? withoutSuffix).replace(/\?$/, "").trim();
};

const humanizeTopicKey = (key: string): string | null => {
  const parts = key.split("|").filter(Boolean);
  if (parts[0] === "NOMINEE" && parts[1] === "US_PRESIDENT" && parts[2] && parts[3]) {
    return `${toTitleCase(parts[3])} Presidential Nominee ${parts[2]}`;
  }
  if (parts[0] === "OFFICE_WINNER" && parts[1] === "USA" && parts[2] === "US_PRESIDENT" && parts[3]) {
    return `US Presidential Winner ${parts[3]}`;
  }
  if (parts[0] === "SPORTS" && parts.length >= 3) {
    return toTitleCase(parts.slice(2).join(" "));
  }
  return null;
};

const toTitleCase = (value: string): string =>
  value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => {
      if (word === "us" || word === "usa") {
        return word.toUpperCase();
      }
      if (["btc", "eth", "sol", "xrp", "fdv", "nba", "nhl", "epl", "lck", "lpl", "fifa", "f1", "uefa"].includes(word)) {
        return word.toUpperCase();
      }
      return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");

