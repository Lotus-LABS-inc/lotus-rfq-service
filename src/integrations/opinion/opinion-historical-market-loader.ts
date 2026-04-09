import type { Pool, QueryResultRow } from "pg";

import { CuratedCanonicalGraphSnapshotBuilder } from "../../canonical/curated-canonical-graph.js";
import { CanonicalGraphProjector } from "../../canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../canonical/canonical-compatibility-projector.js";
import { HistoricalMarketStateRepository } from "../../repositories/historical-market-state.repository.js";
import { CanonicalGraphRepository } from "../../repositories/canonical-graph.repository.js";
import { CanonicalCompatibilityRepository } from "../../repositories/canonical-compatibility.repository.js";
import { CompatibilityVersionRepository } from "../../repositories/compatibility-version.repository.js";
import { OpinionClient } from "./opinion-client.js";
import { OpinionMarketAdapter } from "./opinion-market-adapter.js";
import type { OpinionNormalizedMarket } from "./opinion-types.js";
import { classifyOpinionMarketFamily } from "./opinion-family-classifier.js";
import { PredexonHistoricalClient } from "../predexon/predexon-client.js";
import { PredexonHistoricalAdapter } from "../predexon/predexon-historical-adapter.js";
import { writeArtifact } from "../../operations/semantic-expansion/shared.js";
import type { CreateHistoricalMarketStateInput } from "../../core/historical-simulation/historical-simulation.types.js";

const metadataVersion = "opinion-historical-recovery-v1";
const TARGET_FAMILIES = new Set(["SAME_DAY_DIRECTIONAL", "THRESHOLD_BY_DATE", "ATH_BY_DATE", "PRICE_AT_CLOSE"]);

interface ExistingOpinionProfileRow extends QueryResultRow {
  venue_market_id: string;
  canonical_event_id: string;
  canonical_market_id: string | null;
}

export interface OpinionHistoricalRecoverySummary {
  observedAt: string;
  metadataVersion: string;
  discoveredMarkets: number;
  targetedMarkets: number;
  projectedMissingProfiles: number;
  recoveredHistoricalMarkets: number;
  insertedStates: number;
  skippedStates: number;
  families: Record<string, number>;
  assets: Record<string, number>;
  missingHistory: ReadonlyArray<{
    marketId: string;
    title: string;
    family: string;
    asset: string | null;
    reason: string;
  }>;
}

const selectTargetMarkets = (
  markets: readonly OpinionNormalizedMarket[],
  adapter: OpinionMarketAdapter,
  maxPerFamily: number
): readonly OpinionNormalizedMarket[] => {
  const byFamily = new Map<string, OpinionNormalizedMarket[]>();
  for (const market of markets) {
    const category = adapter.inferCanonicalCategory(market);
    if (category !== "CRYPTO") {
      continue;
    }
    const family = classifyOpinionMarketFamily(market, category).familyBucket;
    if (!TARGET_FAMILIES.has(family)) {
      continue;
    }
    const bucket = byFamily.get(family) ?? [];
    bucket.push(market);
    byFamily.set(family, bucket);
  }

  return [...byFamily.entries()]
    .flatMap(([, familyMarkets]) =>
      familyMarkets
        .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))
        .slice(0, maxPerFamily)
    );
};

const toWindow = (market: OpinionNormalizedMarket): { start: number; end: number } => {
  const end = market.cutoffAt ?? market.resolvedAt ?? new Date();
  const startBase = market.createdAt ?? new Date(end.getTime() - 14 * 24 * 60 * 60 * 1_000);
  const start = new Date(Math.min(startBase.getTime(), end.getTime() - 60 * 60 * 1_000));
  return {
    start: start.getTime(),
    end: end.getTime()
  };
};

const loadExistingProfiles = async (pool: Pool): Promise<ReadonlyMap<string, { canonicalEventId: string; canonicalMarketId: string | null }>> => {
  const result = await pool.query<ExistingOpinionProfileRow>(
    `SELECT
        vmp.venue_market_id,
        vmp.canonical_event_id,
        members.canonical_executable_market_id AS canonical_market_id
       FROM venue_market_profiles vmp
       LEFT JOIN canonical_executable_market_members members
         ON members.venue_market_profile_id = vmp.id
      WHERE vmp.venue = 'OPINION'`
  );

  return new Map(
    result.rows.map((row) => [
      row.venue_market_id,
      {
        canonicalEventId: row.canonical_event_id,
        canonicalMarketId: row.canonical_market_id
      }
    ])
  );
};

export const runOpinionHistoricalRecovery = async (input: {
  repoRoot: string;
  pool: Pool;
  opinionBaseUrl: string;
  opinionApiKey: string;
  predexonBaseUrl: string;
  predexonApiKey: string;
  pageSize?: number;
  maxPages?: number;
  maxPerFamily?: number;
}): Promise<OpinionHistoricalRecoverySummary> => {
  const client = new OpinionClient({
    baseUrl: input.opinionBaseUrl,
    apiKey: input.opinionApiKey
  });
  const adapter = new OpinionMarketAdapter({
    client,
    metadataVersion
  });

  const discovered: OpinionNormalizedMarket[] = [];
  for (let page = 1; page <= (input.maxPages ?? 10); page += 1) {
    const rows = await adapter.listMarkets({ page, limit: input.pageSize ?? 100 });
    if (rows.length === 0) {
      break;
    }
    discovered.push(...rows);
    if (rows.length < (input.pageSize ?? 100)) {
      break;
    }
  }

  const targeted = selectTargetMarkets(discovered, adapter, input.maxPerFamily ?? 6);
  const existingProfiles = await loadExistingProfiles(input.pool);
  const missingProfileMarkets = targeted.filter((market) => !existingProfiles.has(market.venueMarketId));
  const seeds = missingProfileMarkets.map((market) => adapter.buildCanonicalSeed(market));

  if (seeds.length > 0) {
    const projector = new CanonicalGraphProjector(
      new CanonicalGraphRepository(input.pool),
      new CanonicalCompatibilityProjector(
        new CanonicalCompatibilityRepository(input.pool),
        new CompatibilityVersionRepository(input.pool)
      )
    );
    await projector.persistAndProject(new CuratedCanonicalGraphSnapshotBuilder().build(seeds));
  }

  const predexonAdapter = new PredexonHistoricalAdapter({
    client: new PredexonHistoricalClient({
      baseUrl: input.predexonBaseUrl,
      apiKey: input.predexonApiKey
    }),
    metadataVersion
  });
  const historicalRepository = new HistoricalMarketStateRepository(input.pool);
  const states: CreateHistoricalMarketStateInput[] = [];
  const missingHistory: Array<OpinionHistoricalRecoverySummary["missingHistory"][number]> = [];

  for (const market of targeted) {
    const classification = classifyOpinionMarketFamily(market, "CRYPTO");
    const ids = existingProfiles.get(market.venueMarketId);
    const projected = seeds.find((seed) => seed.venueMarketId === market.venueMarketId);
    const canonicalEventId = ids?.canonicalEventId ?? projected?.canonicalEventId;
    const canonicalMarketId = ids?.canonicalMarketId ?? projected?.canonicalMarketId ?? null;
    if (!canonicalEventId) {
      missingHistory.push({
        marketId: market.venueMarketId,
        title: market.title,
        family: classification.familyBucket,
        asset: classification.subject,
        reason: "missing_canonical_identity"
      });
      continue;
    }

    const window = toWindow(market);
    const fragments = await predexonAdapter.buildOpinionOrderbookStateFragments(
      {
        canonicalEventId,
        venue: "OPINION",
        venueMarketId: market.venueMarketId
      },
      {
        market_id: market.venueMarketId,
        start_time: window.start,
        end_time: window.end
      }
    );

    if (fragments.length === 0) {
      missingHistory.push({
        marketId: market.venueMarketId,
        title: market.title,
        family: classification.familyBucket,
        asset: classification.subject,
        reason: "no_predexon_historical_snapshots"
      });
      continue;
    }

    states.push(
      ...fragments.map((fragment) => ({
        ...fragment,
        canonicalMarketId,
        canonicalCategory: "CRYPTO" as const,
        marketEvents: {
          ...(fragment.marketEvents ?? {}),
          historicalRecoverySource: "predexon_historical_backfill"
        }
      }))
    );
  }

  const insertResult = await historicalRepository.insertManyIgnoreDuplicates(states);
  const summary: OpinionHistoricalRecoverySummary = {
    observedAt: new Date().toISOString(),
    metadataVersion,
    discoveredMarkets: discovered.length,
    targetedMarkets: targeted.length,
    projectedMissingProfiles: missingProfileMarkets.length,
    recoveredHistoricalMarkets: targeted.length - missingHistory.length,
    insertedStates: insertResult.inserted,
    skippedStates: insertResult.skipped,
    families: targeted.reduce<Record<string, number>>((accumulator, market) => {
      const family = classifyOpinionMarketFamily(market, "CRYPTO").familyBucket;
      accumulator[family] = (accumulator[family] ?? 0) + 1;
      return accumulator;
    }, {}),
    assets: targeted.reduce<Record<string, number>>((accumulator, market) => {
      const key = classifyOpinionMarketFamily(market, "CRYPTO").subject ?? "UNKNOWN";
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {}),
    missingHistory
  };

  writeArtifact(input.repoRoot, "docs/opinion-historical-ingestion-summary.json", summary);
  return summary;
};
