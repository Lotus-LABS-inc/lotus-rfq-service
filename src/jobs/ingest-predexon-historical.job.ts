import type { Logger } from "pino";
import type { Pool, QueryResultRow } from "pg";

import type {
  PredexonHistoricalAdapter,
  PredexonHistoricalEventMetadata,
  PredexonHistoricalMarketMetadata
} from "../integrations/predexon/predexon-historical-adapter.js";
import {
  CanonicalHistoricalNormalizer,
  type CanonicalHistoricalNormalizeSource
} from "../simulation/canonical-historical-normalizer.js";
import type { HistoricalMarketStateRepositoryContract, HistoricalIngestScopeProvider, HistoricalIngestionCategory, HistoricalIngestionJobInput, HistoricalIngestionJobResult } from "./historical-ingestion.shared.js";
import {
  createNoopLogger,
  mergeHistoricalStates,
  recordHistoricalRunFailure,
  recordHistoricalRunSuccess,
  recordHistoricalStageFailure,
  resolveEffectiveWindowStart
} from "./historical-ingestion.shared.js";

const DEFAULT_CATEGORIES = ["sports", "crypto", "politics", "esports"] as const satisfies readonly HistoricalIngestionCategory[];
const DEFAULT_CANONICAL_EVENT_ID = "UNMAPPED_CANONICAL_EVENT";
export type PredexonSimulationVenue = "POLYMARKET" | "LIMITLESS" | "OPINION";

export interface PredexonScopedMarket {
  venue?: PredexonSimulationVenue;
  category: HistoricalIngestionCategory;
  canonicalEventId?: string;
  canonicalMarketId?: string;
  event: PredexonHistoricalEventMetadata;
  market: PredexonHistoricalMarketMetadata;
}

interface MappedProfileScopeRow extends QueryResultRow {
  venue: PredexonSimulationVenue;
  venue_market_id: string;
  canonical_event_id: string;
  canonical_market_id: string;
  canonical_category: "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS" | null;
  metadata_canonical_category: "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS" | null;
  title: string | null;
}

export class PredexonHistoricalScopeProvider implements HistoricalIngestScopeProvider<PredexonScopedMarket> {
  public constructor(private readonly adapter: PredexonHistoricalAdapter) {}

  public async listScopedMarkets(input: {
    categories: readonly HistoricalIngestionCategory[];
    canonicalEventId?: string;
    canonicalMarketId?: string;
    venue?: string;
  }): Promise<readonly PredexonScopedMarket[]> {
    const scoped: PredexonScopedMarket[] = [];

    for (const category of input.categories) {
      const events = await this.adapter.listHistoricalEvents({ category });
      for (const event of events) {
        if (!event.slug) {
          continue;
        }
        const markets = await this.adapter.listHistoricalMarkets({ event_slug: [event.slug] });
        for (const market of markets) {
          scoped.push({ category, event, market });
        }
      }
    }

    return scoped;
  }
}

const normalizeCanonicalCategory = (
  category: MappedProfileScopeRow["canonical_category"] | MappedProfileScopeRow["metadata_canonical_category"]
): HistoricalIngestionCategory | null => {
  switch (category) {
    case "SPORTS":
      return "sports";
    case "CRYPTO":
      return "crypto";
    case "POLITICS":
      return "politics";
    case "ESPORTS":
      return "esports";
    default:
      return null;
  }
};

const buildSyntheticEventMetadata = (
  row: MappedProfileScopeRow,
  category: HistoricalIngestionCategory
): PredexonHistoricalEventMetadata => ({
  eventId: row.canonical_event_id,
  title: row.title ?? row.canonical_market_id,
  slug: null,
  category,
  status: null,
  startDate: null,
  endDate: null,
  raw: {
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    venue: row.venue
  }
});

const buildSyntheticMarketMetadata = (row: MappedProfileScopeRow): PredexonHistoricalMarketMetadata => ({
  marketId: row.venue === "OPINION" ? row.venue_market_id : null,
  conditionId: row.venue_market_id,
  title: row.title ?? row.canonical_market_id,
  eventId: row.canonical_event_id,
  eventSlug: null,
  marketSlug: row.venue === "LIMITLESS" ? row.venue_market_id : null,
  tokenIds: [],
  status: null,
  volume: null,
  liquidity: null,
  raw: {
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    venue: row.venue
  }
});

const listMarketsByMappedIdentifier = async (
  adapter: PredexonHistoricalAdapter,
  venueMarketId: string
): Promise<readonly PredexonHistoricalMarketMetadata[]> => {
  if (venueMarketId.startsWith("0x")) {
    return adapter.listHistoricalMarkets({ condition_id: [venueMarketId] });
  }

  if (/^\d+$/.test(venueMarketId)) {
    return adapter.listHistoricalMarkets({ market_id: [venueMarketId] });
  }

  return adapter.listHistoricalMarkets({ market_slug: [venueMarketId] });
};

export interface PredexonMappedMarketScopeProviderConfig {
  adapter: PredexonHistoricalAdapter;
  pool: Pool;
}

export class PredexonMappedMarketScopeProvider implements HistoricalIngestScopeProvider<PredexonScopedMarket> {
  public constructor(private readonly config: PredexonMappedMarketScopeProviderConfig) {}

  public async listScopedMarkets(input: {
    categories: readonly HistoricalIngestionCategory[];
    canonicalEventId?: string;
    canonicalMarketId?: string;
    venue?: string;
  }): Promise<readonly PredexonScopedMarket[]> {
    const mappedRows = await this.loadMappedProfiles(input);
    const scoped: PredexonScopedMarket[] = [];
    const requestedVenue = input.venue as PredexonSimulationVenue | undefined;

    if (!requestedVenue || requestedVenue === "POLYMARKET") {
      scoped.push(...(await this.loadMappedPolymarketScopes(mappedRows, input.categories)));
    }

    for (const row of mappedRows) {
      if (row.venue === "POLYMARKET") {
        continue;
      }

      const category = normalizeCanonicalCategory(row.canonical_category ?? row.metadata_canonical_category);
      if (!category || !input.categories.includes(category)) {
        continue;
      }

      scoped.push({
        venue: row.venue,
        category,
        canonicalEventId: row.canonical_event_id,
        canonicalMarketId: row.canonical_market_id,
        event: buildSyntheticEventMetadata(row, category),
        market: buildSyntheticMarketMetadata(row)
      });
    }

    return scoped.sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        (left.canonicalEventId ?? "").localeCompare(right.canonicalEventId ?? "") ||
        (left.canonicalMarketId ?? "").localeCompare(right.canonicalMarketId ?? "") ||
        (left.venue ?? "POLYMARKET").localeCompare(right.venue ?? "POLYMARKET") ||
        left.market.conditionId.localeCompare(right.market.conditionId)
    );
  }

  private async loadMappedProfiles(input: {
    categories: readonly HistoricalIngestionCategory[];
    canonicalEventId?: string;
    canonicalMarketId?: string;
    venue?: string;
  }): Promise<readonly MappedProfileScopeRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (input.canonicalEventId) {
      values.push(input.canonicalEventId);
      conditions.push(`rp.canonical_event_id = $${values.length}`);
    }

    if (input.canonicalMarketId) {
      values.push(input.canonicalMarketId);
      conditions.push(`rp.canonical_market_id = $${values.length}`);
    }

    if (input.venue) {
      values.push(input.venue);
      conditions.push(`rp.venue = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await this.config.pool.query<MappedProfileScopeRow>(
      `WITH latest_state_category AS (
         SELECT DISTINCT ON (canonical_event_id, canonical_market_id, venue, venue_market_id)
                canonical_event_id,
                canonical_market_id,
                venue,
                venue_market_id,
                canonical_category
           FROM historical_market_states
          WHERE canonical_category IN ('SPORTS', 'CRYPTO', 'POLITICS', 'ESPORTS')
          ORDER BY canonical_event_id, canonical_market_id, venue, venue_market_id, "timestamp" DESC
       ),
       event_category AS (
         SELECT canonical_event_id, MAX(canonical_category) AS canonical_category
           FROM historical_market_states
          WHERE canonical_category IN ('SPORTS', 'CRYPTO', 'POLITICS', 'ESPORTS')
          GROUP BY canonical_event_id
       )
       SELECT DISTINCT
              rp.venue,
              rp.venue_market_id,
              rp.canonical_event_id,
              rp.canonical_market_id,
              COALESCE(ls.canonical_category, ec.canonical_category) AS canonical_category,
              UPPER(NULLIF(rp.metadata->>'canonicalCategory', ''))::text AS metadata_canonical_category,
              rp.primary_resolution_text AS title
         FROM resolution_profiles rp
         LEFT JOIN latest_state_category ls
           ON ls.canonical_event_id::text = rp.canonical_event_id::text
          AND ls.canonical_market_id::text = rp.canonical_market_id::text
          AND ls.venue = rp.venue
          AND ls.venue_market_id = rp.venue_market_id
         LEFT JOIN event_category ec
           ON ec.canonical_event_id::text = rp.canonical_event_id::text
         ${whereClause}
         ORDER BY rp.canonical_event_id, rp.canonical_market_id, rp.venue, rp.venue_market_id`,
      values
    );

    return result.rows.filter((row) => {
      const normalizedCategory = normalizeCanonicalCategory(row.canonical_category ?? row.metadata_canonical_category);
      return normalizedCategory !== null && input.categories.includes(normalizedCategory);
    });
  }

  private async loadMappedPolymarketScopes(
    mappedRows: readonly MappedProfileScopeRow[],
    categories: readonly HistoricalIngestionCategory[]
  ): Promise<readonly PredexonScopedMarket[]> {
    const mappedPolymarketRows = mappedRows.filter((row) => row.venue === "POLYMARKET");
    if (mappedPolymarketRows.length === 0) {
      return [];
    }

    const byIdentifier = new Map<string, MappedProfileScopeRow>();
    for (const row of mappedPolymarketRows) {
      byIdentifier.set(row.venue_market_id, row);
    }

    const discoveredMarkets: PredexonHistoricalMarketMetadata[] = [];
    for (const row of mappedPolymarketRows) {
      discoveredMarkets.push(...(await listMarketsByMappedIdentifier(this.config.adapter, row.venue_market_id)));
    }

    const scoped: PredexonScopedMarket[] = [];
    const seenKeys = new Set<string>();

    for (const market of discoveredMarkets) {
      const matched =
        byIdentifier.get(market.conditionId) ??
        (market.marketId ? byIdentifier.get(market.marketId) : undefined) ??
        (market.marketSlug ? byIdentifier.get(market.marketSlug) : undefined);

      if (!matched) {
        continue;
      }

      const category = normalizeCanonicalCategory(matched.canonical_category);
      if (!category || !categories.includes(category)) {
        continue;
      }

      const dedupeKey = `${matched.canonical_event_id}|${matched.canonical_market_id}|${market.conditionId}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      seenKeys.add(dedupeKey);
      scoped.push({
        venue: "POLYMARKET",
        category,
        canonicalEventId: matched.canonical_event_id,
        canonicalMarketId: matched.canonical_market_id,
        event: {
          eventId: market.eventId ?? matched.canonical_event_id,
          title: matched.title ?? market.title,
          slug: market.eventSlug,
          category,
          status: market.status,
          startDate: null,
          endDate: null,
          raw: {
            ...market.raw,
            canonicalEventId: matched.canonical_event_id,
            canonicalMarketId: matched.canonical_market_id
          }
        },
        market: {
          ...market,
          raw: {
            ...market.raw,
            canonicalEventId: matched.canonical_event_id,
            canonicalMarketId: matched.canonical_market_id
          }
        }
      });
    }

    return scoped;
  }
}

export interface PredexonHistoricalIngestionJobConfig {
  adapter: PredexonHistoricalAdapter;
  canonicalNormalizer: CanonicalHistoricalNormalizer;
  repository: HistoricalMarketStateRepositoryContract;
  scopeProvider: HistoricalIngestScopeProvider<PredexonScopedMarket>;
  venue?: PredexonSimulationVenue;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

const toUnixSeconds = (date: Date): number => Math.floor(date.getTime() / 1_000);
const toUnixMilliseconds = (date: Date): number => date.getTime();

const buildSourceMarketMetadata = (scope: PredexonScopedMarket): Record<string, unknown> => ({
  category: scope.category,
  event: scope.event.raw,
  market: scope.market.raw
});

const buildContext = (venue: PredexonSimulationVenue, venueMarketId: string) => ({
  canonicalEventId: DEFAULT_CANONICAL_EVENT_ID,
  venueMarketId,
  venue
});

const resolveSourceMarketKey = (venue: PredexonSimulationVenue, scope: PredexonScopedMarket): string => {
  if (venue === "LIMITLESS") {
    return scope.market.marketSlug ?? scope.market.conditionId
  }

  if (venue === "OPINION") {
    return scope.market.marketId ?? scope.market.conditionId
  }

  return scope.market.conditionId
}

export class PredexonHistoricalIngestionJob {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;

  public constructor(private readonly config: PredexonHistoricalIngestionJobConfig) {
    this.logger = config.logger ?? createNoopLogger();
  }

  private get venue(): PredexonSimulationVenue {
    return this.config.venue ?? "POLYMARKET";
  }

  public async run(input: HistoricalIngestionJobInput): Promise<HistoricalIngestionJobResult> {
    const venue = this.venue;
    const categories = [...(input.categories ?? DEFAULT_CATEGORIES)];
    const scopeInput = {
      categories,
      venue,
      ...(input.canonicalEventId ? { canonicalEventId: input.canonicalEventId } : {}),
      ...(input.canonicalMarketId ? { canonicalMarketId: input.canonicalMarketId } : {})
    };
    const stats: HistoricalIngestionJobResult = {
      venue,
      mode: input.mode,
      discoveredMarkets: 0,
      fetchedFragments: 0,
      normalizedRecords: 0,
      insertedRows: 0,
      skippedRows: 0,
      failedScopes: 0
    };

    this.logger.info({ venue, mode: input.mode, windowStart: input.windowStart, windowEnd: input.windowEnd }, "Starting Predexon historical ingestion.");

    try {
      const scopes = await this.config.scopeProvider.listScopedMarkets(scopeInput);
      stats.discoveredMarkets = scopes.length;

      for (const scope of scopes) {
        try {
          const records = await this.ingestScopedMarket(scope, input);
          stats.fetchedFragments += records.fetchedFragments;
          stats.normalizedRecords += records.normalizedRecords;
          stats.insertedRows += records.insertedRows;
          stats.skippedRows += records.skippedRows;
        } catch (error) {
          stats.failedScopes += 1;
          recordHistoricalStageFailure(venue, "scope");
          this.logger.error({ err: error, market: scope.market.conditionId }, "Predexon scope ingestion failed.");
        }
      }

      recordHistoricalRunSuccess(venue, input.mode, stats.insertedRows);
      this.logger.info(stats, "Completed Predexon historical ingestion.");
      return stats;
    } catch (error) {
      recordHistoricalRunFailure(venue, input.mode, "run");
      this.logger.error({ err: error }, "Predexon historical ingestion failed.");
      throw error;
    }
  }

  private async ingestScopedMarket(
    scope: PredexonScopedMarket,
    input: HistoricalIngestionJobInput
  ): Promise<Pick<HistoricalIngestionJobResult, "fetchedFragments" | "normalizedRecords" | "insertedRows" | "skippedRows">> {
    const latestSourceTimestamp = await this.config.repository.getLatestSourceTimestamp({
      venue: this.venue,
      venueMarketId: resolveSourceMarketKey(this.venue, scope),
      metadataVersion: this.config.adapter.getVenueAdapter().metadataVersion
    });

    const effectiveStart = resolveEffectiveWindowStart(input, latestSourceTimestamp);
    if (effectiveStart.getTime() >= input.windowEnd.getTime()) {
      return { fetchedFragments: 0, normalizedRecords: 0, insertedRows: 0, skippedRows: 0 };
    }

    const window = {
      start_time: toUnixSeconds(new Date(effectiveStart.getTime() + 1_000)),
      end_time: toUnixSeconds(input.windowEnd)
    };
    const orderbookWindow = {
      start_time: toUnixMilliseconds(new Date(effectiveStart.getTime() + 1_000)),
      end_time: toUnixMilliseconds(input.windowEnd)
    };

    const fetched = await this.fetchFragments(scope, window, orderbookWindow);
    const normalized = await this.normalizeFragments(scope, fetched);
    const merged = mergeHistoricalStates(normalized.map((record) => record.state));
    const insertResult = await this.config.repository.insertManyIgnoreDuplicates(merged);

    this.logger.info(
      {
        market: scope.market.conditionId,
        fetchedFragments: fetched.length,
        normalizedRecords: normalized.length,
        insertedRows: insertResult.inserted,
        skippedRows: insertResult.skipped
      },
      "Predexon market ingestion summary."
    );

    return {
      fetchedFragments: fetched.length,
      normalizedRecords: normalized.length,
      insertedRows: insertResult.inserted,
      skippedRows: insertResult.skipped
    };
  }

  private async fetchFragments(
    scope: PredexonScopedMarket,
    window: { start_time: number; end_time: number },
    orderbookWindow: { start_time: number; end_time: number }
  ) {
    const fragments = [
      ...(this.venue === "POLYMARKET"
        ? await this.config.adapter.buildCandleStateFragments(buildContext("POLYMARKET", scope.market.conditionId), {
            condition_id: scope.market.conditionId,
            start_time: window.start_time,
            end_time: window.end_time,
            interval: 60
          })
        : [])
    ];

    if (this.venue === "POLYMARKET" && scope.market.tokenIds.length > 0) {
      fragments.push(
        ...(await this.config.adapter.buildVolumeOpenInterestFragments({
          ...buildContext("POLYMARKET", scope.market.conditionId),
          tokenId: scope.market.tokenIds[0]!,
          conditionId: scope.market.conditionId,
          volumeQuery: window,
          openInterestQuery: window
        }))
      );
    }

    if (this.venue === "POLYMARKET") {
      for (const tokenId of scope.market.tokenIds.slice(0, 1)) {
        fragments.push(
          ...(await this.config.adapter.buildOrderbookStateFragments(buildContext("POLYMARKET", scope.market.conditionId), {
            token_id: tokenId,
            start_time: orderbookWindow.start_time,
            end_time: orderbookWindow.end_time
          }))
        );
        fragments.push(
          ...(await this.config.adapter.buildTradeStateFragments(buildContext("POLYMARKET", scope.market.conditionId), {
            token_id: tokenId,
            start_time: window.start_time,
            end_time: window.end_time,
            limit: 500,
            order: "asc"
          }))
        );
      }
    } else if (this.venue === "LIMITLESS") {
      const marketSlug = scope.market.marketSlug ?? scope.market.conditionId;
      fragments.push(
        ...(await this.config.adapter.buildLimitlessOrderbookStateFragments(buildContext("LIMITLESS", marketSlug), {
          market_slug: marketSlug,
          start_time: orderbookWindow.start_time,
          end_time: orderbookWindow.end_time
        }))
      );
    } else {
      const marketId = scope.market.marketId ?? scope.market.conditionId;
      fragments.push(
        ...(await this.config.adapter.buildOpinionOrderbookStateFragments(buildContext("OPINION", marketId), {
          market_id: marketId,
          start_time: orderbookWindow.start_time,
          end_time: orderbookWindow.end_time
        }))
      );
    }

    return fragments;
  }

  private normalizeFragments(
    scope: PredexonScopedMarket,
    fragments: readonly import("../integrations/predexon/predexon-historical-adapter.js").HistoricalMarketStateFragment[]
  ) {
    const sources: CanonicalHistoricalNormalizeSource[] = fragments.map((state) => ({
      state,
      sourceMarketMetadata: buildSourceMarketMetadata(scope)
    }));

    return this.config.canonicalNormalizer.normalize({
      mode: "singleVenue",
      records: sources
    });
  }
}
