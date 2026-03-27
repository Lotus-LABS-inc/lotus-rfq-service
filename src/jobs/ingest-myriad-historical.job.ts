import type { Logger } from "pino";

import { CanonicalGraphProjector } from "../canonical/canonical-graph-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder } from "../canonical/curated-canonical-graph.js";
import { MyriadHistoricalAdapter } from "../integrations/myriad/myriad-historical-adapter.js";
import type {
  HistoricalIngestionCategory,
  HistoricalIngestionJobInput,
  HistoricalIngestionJobResult,
  HistoricalMarketStateRepositoryContract
} from "./historical-ingestion.shared.js";
import {
  createNoopLogger,
  mergeHistoricalStates,
  recordHistoricalRunFailure,
  recordHistoricalRunSuccess,
  recordHistoricalStageFailure,
  resolveEffectiveWindowStart
} from "./historical-ingestion.shared.js";

const DEFAULT_CATEGORIES: readonly HistoricalIngestionCategory[] = ["sports", "crypto", "politics", "esports"];

export interface MyriadHistoricalIngestionJobConfig {
  adapter: MyriadHistoricalAdapter;
  repository: HistoricalMarketStateRepositoryContract;
  graphProjector: CanonicalGraphProjector;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export class MyriadHistoricalIngestionJob {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;
  private readonly snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();

  public constructor(private readonly config: MyriadHistoricalIngestionJobConfig) {
    this.logger = config.logger ?? createNoopLogger();
  }

  public async run(input: HistoricalIngestionJobInput): Promise<HistoricalIngestionJobResult> {
    const venue = "MYRIAD";
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

    this.logger.info(
      {
        venue,
        mode: input.mode,
        categories: input.categories ?? DEFAULT_CATEGORIES,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd
      },
      "Starting Myriad historical ingestion."
    );

    try {
      const scopes = await this.config.adapter.listScopedMarkets({
        categories: input.categories ?? DEFAULT_CATEGORIES,
        ...(input.batchSize !== undefined ? { batchSize: input.batchSize } : {}),
        ...(input.canonicalEventId ? { canonicalEventId: input.canonicalEventId } : {}),
        ...(input.canonicalMarketId ? { canonicalMarketId: input.canonicalMarketId } : {})
      });
      stats.discoveredMarkets = scopes.length;

      if (scopes.length > 0) {
        await this.config.graphProjector.persistAndProject(
          this.snapshotBuilder.build(scopes.map((scope) => this.config.adapter.buildCanonicalSeed(scope)))
        );
      }

      for (const scope of scopes) {
        try {
          const result = await this.ingestScope(scope, input);
          stats.fetchedFragments += result.fetchedFragments;
          stats.normalizedRecords += result.normalizedRecords;
          stats.insertedRows += result.insertedRows;
          stats.skippedRows += result.skippedRows;
        } catch (error) {
          stats.failedScopes += 1;
          recordHistoricalStageFailure(venue, "scope");
          this.logger.error(
            { err: error, canonicalMarketId: scope.canonicalMarketId, venueMarketId: scope.detail.id },
            "Myriad scope ingestion failed."
          );
        }
      }

      recordHistoricalRunSuccess(venue, input.mode, stats.insertedRows);
      this.logger.info(stats, "Completed Myriad historical ingestion.");
      return stats;
    } catch (error) {
      recordHistoricalRunFailure(venue, input.mode, "run");
      this.logger.error({ err: error }, "Myriad historical ingestion failed.");
      throw error;
    }
  }

  private async ingestScope(
    scope: Awaited<ReturnType<MyriadHistoricalAdapter["listScopedMarkets"]>>[number],
    input: HistoricalIngestionJobInput
  ): Promise<Pick<HistoricalIngestionJobResult, "fetchedFragments" | "normalizedRecords" | "insertedRows" | "skippedRows">> {
    const metadataVersion = this.config.adapter.getVenueAdapter().metadataVersion;
    const venueMarketId = String(scope.detail.id);
    const latestSourceTimestamp = await this.config.repository.getLatestSourceTimestamp({
      venue: "MYRIAD",
      venueMarketId,
      metadataVersion
    });
    const effectiveStart = resolveEffectiveWindowStart(input, latestSourceTimestamp);
    if (effectiveStart.getTime() >= input.windowEnd.getTime()) {
      return { fetchedFragments: 0, normalizedRecords: 0, insertedRows: 0, skippedRows: 0 };
    }

    const fragments = await this.config.adapter.buildHistoricalStateFragments({
      scope,
      windowStart: effectiveStart,
      windowEnd: input.windowEnd
    });
    const merged = mergeHistoricalStates(fragments);
    const insertResult = await this.config.repository.insertManyIgnoreDuplicates(merged);

    this.logger.info(
      {
        canonicalEventId: scope.canonicalEventId,
        canonicalMarketId: scope.canonicalMarketId,
        venueMarketId,
        fetchedFragments: fragments.length,
        normalizedRecords: merged.length,
        insertedRows: insertResult.inserted,
        skippedRows: insertResult.skipped
      },
      "Myriad market ingestion summary."
    );

    return {
      fetchedFragments: fragments.length,
      normalizedRecords: merged.length,
      insertedRows: insertResult.inserted,
      skippedRows: insertResult.skipped
    };
  }
}
