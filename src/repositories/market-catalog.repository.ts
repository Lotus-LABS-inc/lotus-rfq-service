import type { Pool } from "pg";

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
  updatedAt: string;
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
        GROUP BY ce.canonical_category
        ORDER BY ce.canonical_category`
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
        WHERE ce.id::text = $1 OR cem.id = $1 OR ce.proposition_key = $1
        GROUP BY ce.id
        LIMIT 1`,
      [marketId]
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
          vmp.resolves_at::text
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

const toMarket = (row: MarketRow, venueRows: VenueMarketRow[]): MarketCatalogMarket => {
  const venues = normalizeStringArray(row.venues);
  const venueMarkets = venueRows.map(toVenueMarket);
  const outcomeLabels = new Set(venueMarkets.flatMap((market) => market.outcomes.map((outcome) => outcome.label)));
  const eventGroup = deriveEventGroup(row);
  return {
    eventId: eventGroup.eventId,
    eventTitle: eventGroup.title,
    canonicalEventId: row.canonical_event_id,
    canonicalMarketIds: normalizeStringArray(row.canonical_market_ids),
    title: row.frontend_display_title?.trim() || displayTitle(row.title, row.proposition_key),
    normalizedTitle: row.normalized_proposition_text,
    category: row.canonical_category,
    marketClass: row.market_class,
    status: marketStatus(row.expires_at, row.resolves_at),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    resolvesAt: row.resolves_at,
    venues,
    venueCount: venues.length,
    venueMarketCount: Number(row.venue_market_count),
    outcomeCount: outcomeLabels.size,
    routeability: {
      hasSingleVenue: venues.length > 0,
      hasCrossVenue: venues.length > 1
    },
    venueMarkets,
    updatedAt: row.updated_at
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
    const latestUpdatedAt = groupedMarkets
      .map((market) => market.updatedAt)
      .sort((left, right) => right.localeCompare(left))[0] ?? firstMarket!.updatedAt;
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
    return {
      eventId: `event:${eventKey}`,
      title: `${toTitleCase(parts[2])} Threshold By ${parts[3]}`
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
      title: `${toTitleCase(parts[2])} Token Launch By Date`
    };
  }
  if (parts[0] === "CRYPTO" && parts[1] === "FIRST_TO_THRESHOLD_BY_DATE" && parts[2]) {
    const eventKey = parts.slice(0, 3).join("|");
    return {
      eventId: `event:${eventKey}`,
      title: `${toTitleCase(parts[2])} First To Threshold By Date`
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

const toVenueMarket = (row: VenueMarketRow): MarketCatalogVenueMarket => ({
  canonicalMarketId: row.canonical_market_id,
  canonicalMarketTitle: displayTitle(row.canonical_market_title, row.canonical_market_id),
  venue: row.venue === "PREDICT" ? "PREDICT_FUN" : row.venue,
  venueMarketProfileId: row.venue_market_profile_id,
  venueMarketId: row.venue_market_id,
  venueTitle: row.venue_title,
  marketClass: row.market_class,
  outcomes: normalizeOutcomes(row.outcomes),
  network: row.network,
  chain: row.chain,
  expiresAt: row.expires_at,
  resolvesAt: row.resolves_at
});

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
