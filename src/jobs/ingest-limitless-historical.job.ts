import type { Logger } from "pino";

import type { LimitlessHistoricalAdapter, LimitlessHistoricalMarketMetadata } from "../integrations/limitless/limitless-historical-adapter.js";
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

const DEFAULT_CANONICAL_EVENT_ID = "UNMAPPED_CANONICAL_EVENT";

export interface LimitlessSeededScope {
  slug: string;
  category: HistoricalIngestionCategory;
  metadata?: Record<string, unknown>;
}

export interface LimitlessHistoricalIngestionJobInput extends HistoricalIngestionJobInput {
  includeOwnExecutionHistory?: boolean;
}

export interface LimitlessHistoricalIngestionJobConfig {
  adapter: LimitlessHistoricalAdapter;
  canonicalNormalizer: CanonicalHistoricalNormalizer;
  repository: HistoricalMarketStateRepositoryContract;
  scopeProvider: HistoricalIngestScopeProvider<LimitlessSeededScope>;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

const toIso = (date: Date): string => date.toISOString();

const buildContext = (venueMarketId: string) => ({
  canonicalEventId: DEFAULT_CANONICAL_EVENT_ID,
  venueMarketId
});

const buildSourceMarketMetadata = (
  scope: LimitlessSeededScope,
  market: LimitlessHistoricalMarketMetadata
): Record<string, unknown> => ({
  category: scope.category,
  scopeMetadata: scope.metadata ?? null,
  market: market.raw
});

export class LimitlessHistoricalIngestionJob {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;

  public constructor(private readonly config: LimitlessHistoricalIngestionJobConfig) {
    this.logger = config.logger ?? createNoopLogger();
  }

  public async run(input: LimitlessHistoricalIngestionJobInput): Promise<HistoricalIngestionJobResult> {
    const venue = "LIMITLESS";
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

    this.logger.info({ venue, mode: input.mode, windowStart: input.windowStart, windowEnd: input.windowEnd }, "Starting Limitless historical ingestion.");

    try {
      const scopes = await this.config.scopeProvider.listScopedMarkets({ categories: ["sports", "crypto"] });
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
          this.logger.error({ err: error, slug: scope.slug }, "Limitless scope ingestion failed.");
        }
      }

      recordHistoricalRunSuccess(venue, input.mode, stats.insertedRows);
      this.logger.info(stats, "Completed Limitless historical ingestion.");
      return stats;
    } catch (error) {
      recordHistoricalRunFailure(venue, input.mode, "run");
      this.logger.error({ err: error }, "Limitless historical ingestion failed.");
      throw error;
    }
  }

  private async ingestScopedMarket(
    scope: LimitlessSeededScope,
    input: LimitlessHistoricalIngestionJobInput
  ): Promise<Pick<HistoricalIngestionJobResult, "fetchedFragments" | "normalizedRecords" | "insertedRows" | "skippedRows">> {
    const metadataVersion = this.config.adapter.getVenueAdapter().metadataVersion;
    const latestSourceTimestamp = await this.config.repository.getLatestSourceTimestamp({
      venue: "LIMITLESS",
      venueMarketId: scope.slug,
      metadataVersion
    });
    const effectiveStart = resolveEffectiveWindowStart(input, latestSourceTimestamp);

    if (effectiveStart.getTime() >= input.windowEnd.getTime()) {
      return { fetchedFragments: 0, normalizedRecords: 0, insertedRows: 0, skippedRows: 0 };
    }

    const market = await this.config.adapter.getHistoricalMarket(scope.slug);
    const fetched = await this.fetchFragments(scope.slug, effectiveStart, input.windowEnd, input.includeOwnExecutionHistory ?? false);
    const normalized = await this.normalizeFragments(scope, market, fetched);
    const merged = mergeHistoricalStates(normalized.map((record) => record.state));
    const insertResult = await this.config.repository.insertManyIgnoreDuplicates(merged);

    this.logger.info(
      {
        slug: scope.slug,
        fetchedFragments: fetched.length,
        normalizedRecords: normalized.length,
        insertedRows: insertResult.inserted,
        skippedRows: insertResult.skipped
      },
      "Limitless market ingestion summary."
    );

    return {
      fetchedFragments: fetched.length,
      normalizedRecords: normalized.length,
      insertedRows: insertResult.inserted,
      skippedRows: insertResult.skipped
    };
  }

  private async fetchFragments(
    slug: string,
    windowStart: Date,
    windowEnd: Date,
    includeOwnExecutionHistory: boolean
  ) {
    const context = buildContext(slug);
    const fragments = await this.config.adapter.buildHistoricalPriceFragments(context, {
      slug,
      from: toIso(windowStart),
      to: toIso(windowEnd)
    });

    fragments.push(...(await this.fetchEventFragments(slug, windowStart)));

    if (includeOwnExecutionHistory) {
      fragments.push(
        ...(await this.config.adapter.buildPortfolioHistoryFragments(context, {
          page: 1,
          limit: 250,
          from: toIso(windowStart),
          to: toIso(windowEnd)
        }))
      );
    }

    return fragments;
  }

  private async fetchEventFragments(slug: string, windowStart: Date) {
    const context = buildContext(slug);
    const pageSize = 100;
    const fragments: import("../integrations/limitless/limitless-historical-adapter.js").HistoricalMarketStateFragment[] = [];

    for (let page = 1; page <= 10; page += 1) {
      const current = await this.config.adapter.buildMarketEventFragments(context, {
        slug,
        page,
        limit: pageSize
      });

      const eligible = current.filter((fragment) => fragment.sourceTimestamp.getTime() >= windowStart.getTime());
      fragments.push(...eligible);

      if (current.length < pageSize || current.every((fragment) => fragment.sourceTimestamp.getTime() < windowStart.getTime())) {
        break;
      }
    }

    return fragments;
  }

  private normalizeFragments(
    scope: LimitlessSeededScope,
    market: LimitlessHistoricalMarketMetadata,
    fragments: readonly import("../integrations/limitless/limitless-historical-adapter.js").HistoricalMarketStateFragment[]
  ) {
    const sources: CanonicalHistoricalNormalizeSource[] = fragments.map((state) => ({
      state,
      sourceMarketMetadata: buildSourceMarketMetadata(scope, market)
    }));

    return this.config.canonicalNormalizer.normalize({
      mode: "singleVenue",
      records: sources
    });
  }
}
