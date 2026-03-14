import type { Logger } from "pino";

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

const DEFAULT_CATEGORIES = ["sports", "crypto"] as const satisfies readonly HistoricalIngestionCategory[];
const DEFAULT_CANONICAL_EVENT_ID = "UNMAPPED_CANONICAL_EVENT";

export interface PredexonScopedMarket {
  category: HistoricalIngestionCategory;
  event: PredexonHistoricalEventMetadata;
  market: PredexonHistoricalMarketMetadata;
}

export class PredexonHistoricalScopeProvider implements HistoricalIngestScopeProvider<PredexonScopedMarket> {
  public constructor(private readonly adapter: PredexonHistoricalAdapter) {}

  public async listScopedMarkets(input: {
    categories: readonly HistoricalIngestionCategory[];
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

export interface PredexonHistoricalIngestionJobConfig {
  adapter: PredexonHistoricalAdapter;
  canonicalNormalizer: CanonicalHistoricalNormalizer;
  repository: HistoricalMarketStateRepositoryContract;
  scopeProvider: HistoricalIngestScopeProvider<PredexonScopedMarket>;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

const toUnixSeconds = (date: Date): number => Math.floor(date.getTime() / 1_000);

const buildSourceMarketMetadata = (scope: PredexonScopedMarket): Record<string, unknown> => ({
  category: scope.category,
  event: scope.event.raw,
  market: scope.market.raw
});

const buildContext = (venueMarketId: string) => ({
  canonicalEventId: DEFAULT_CANONICAL_EVENT_ID,
  venueMarketId
});

export class PredexonHistoricalIngestionJob {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;

  public constructor(private readonly config: PredexonHistoricalIngestionJobConfig) {
    this.logger = config.logger ?? createNoopLogger();
  }

  public async run(input: HistoricalIngestionJobInput): Promise<HistoricalIngestionJobResult> {
    const venue = "POLYMARKET";
    const categories = [...DEFAULT_CATEGORIES];
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
      const scopes = await this.config.scopeProvider.listScopedMarkets({ categories });
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
      venue: "POLYMARKET",
      venueMarketId: scope.market.conditionId,
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

    const fetched = await this.fetchFragments(scope, window);
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
    window: { start_time: number; end_time: number }
  ) {
    const fragments = [
      ...(await this.config.adapter.buildCandleStateFragments(buildContext(scope.market.conditionId), {
        condition_id: scope.market.conditionId,
        start_time: window.start_time,
        end_time: window.end_time
      }))
    ];

    if (scope.market.tokenIds.length > 0) {
      fragments.push(
        ...(await this.config.adapter.buildVolumeOpenInterestFragments({
          ...buildContext(scope.market.conditionId),
          tokenId: scope.market.tokenIds[0]!,
          conditionId: scope.market.conditionId,
          volumeQuery: window,
          openInterestQuery: window
        }))
      );
    }

    for (const tokenId of scope.market.tokenIds.slice(0, 1)) {
      fragments.push(
        ...(await this.config.adapter.buildOrderbookStateFragments(buildContext(scope.market.conditionId), {
          token_id: tokenId,
          start_time: window.start_time,
          end_time: window.end_time
        }))
      );
      fragments.push(
        ...(await this.config.adapter.buildTradeStateFragments(buildContext(scope.market.conditionId), {
          token_id: tokenId,
          start_time: window.start_time,
          end_time: window.end_time,
          limit: 500,
          order: "asc"
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
