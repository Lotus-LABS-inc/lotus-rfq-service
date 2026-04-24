#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { HistoricalMarketClass, type CreateHistoricalMarketStateInput } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { HistoricalMarketStateRepository } from "../../src/repositories/historical-market-state.repository.js";
import {
  historicalRouteCurationSchema,
  type HistoricalCatalogManifestEntry
} from "../../src/simulation/historical-route-catalog-manifest.js";
import { PredexonHistoricalAdapter } from "../../src/integrations/predexon/predexon-historical-adapter.js";
import { PredexonHistoricalClient } from "../../src/integrations/predexon/predexon-client.js";
import { LimitlessHistoricalAdapter } from "../../src/integrations/limitless/limitless-historical-adapter.js";
import { LimitlessHistoricalClient } from "../../src/integrations/limitless/limitless-client.js";
import { mergeHistoricalStates } from "../../src/jobs/historical-ingestion.shared.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const predexonApiKey = process.env.PREDEXON_API_KEY;
const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";
const predexonMetadataVersion = process.env.PREDEXON_METADATA_VERSION ?? "predexon-v2";
const limitlessApiKey = process.env.LIMITLESS_API_KEY;
const limitlessBaseUrl = process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

if (!predexonApiKey) {
  throw new Error("PREDEXON_API_KEY is required.");
}

type LiveProfileRow = {
  oracle_type: string | null;
  oracle_name: string | null;
  resolution_authority_type: string | null;
  primary_resolution_text: string | null;
  supplemental_rules_text: string | null;
  dispute_window_hours: string | null;
  settlement_lag_hours: string | null;
  market_type: string | null;
  outcome_schema: Record<string, unknown> | null;
  has_ambiguous_time_boundary: boolean;
  has_ambiguous_jurisdiction_boundary: boolean;
  has_ambiguous_source_reference: boolean;
  historical_divergence_rate: string | null;
  metadata: Record<string, unknown>;
};

const logger = {
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args)
};

const asJson = (value: Record<string, unknown>): string => JSON.stringify(value);

const applyCanonicalIdentity = (
  states: readonly CreateHistoricalMarketStateInput[],
  entry: HistoricalCatalogManifestEntry
): CreateHistoricalMarketStateInput[] =>
  states.map((state) => ({
    ...state,
    canonicalEventId: entry.historicalCanonicalEventId,
    canonicalMarketId: entry.historicalCanonicalMarketId,
    canonicalCategory: entry.canonicalCategory,
    marketClass: HistoricalMarketClass.BINARY
  }));

const loadCuration = () => {
  const curationPath = path.resolve(process.cwd(), "docs", "historical-route-curation.json");
  return {
    curationPath,
    payload: historicalRouteCurationSchema.parse(JSON.parse(readFileSync(curationPath, "utf8")))
  };
};

const listMarketsByMappedIdentifier = async (
  adapter: PredexonHistoricalAdapter,
  venueMarketId: string
) => {
  if (venueMarketId.startsWith("0x")) {
    return adapter.listHistoricalMarkets({ condition_id: [venueMarketId] });
  }
  if (/^\d+$/.test(venueMarketId)) {
    return adapter.listHistoricalMarkets({ market_id: [venueMarketId] });
  }
  return adapter.listHistoricalMarkets({ market_slug: [venueMarketId] });
};

const upsertHistoricalProfile = async (input: {
  pool: Pool;
  entry: HistoricalCatalogManifestEntry;
  venueProfile: HistoricalCatalogManifestEntry["venueProfiles"][number];
  liveProfile: LiveProfileRow | null;
}): Promise<{ id: string; venue: string }> => {
  const override = input.venueProfile.profileOverride;
  const liveProfile = input.liveProfile;

  const result = await input.pool.query<{ id: string; venue: string }>(
    `INSERT INTO historical_simulation_profiles (
       venue,
       venue_market_id,
       canonical_event_id,
       canonical_market_id,
       canonical_category,
       oracle_type,
       oracle_name,
       resolution_authority_type,
       primary_resolution_text,
       supplemental_rules_text,
       dispute_window_hours,
       settlement_lag_hours,
       market_type,
       outcome_schema,
       has_ambiguous_time_boundary,
       has_ambiguous_jurisdiction_boundary,
       has_ambiguous_source_reference,
       historical_divergence_rate,
       metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19::jsonb
     )
     ON CONFLICT (canonical_event_id, canonical_market_id, venue, venue_market_id)
     DO UPDATE SET
       primary_resolution_text = EXCLUDED.primary_resolution_text,
       supplemental_rules_text = EXCLUDED.supplemental_rules_text,
       metadata = EXCLUDED.metadata,
       updated_at = now()
     RETURNING id, venue`,
    [
      input.venueProfile.venue,
      input.venueProfile.venueMarketId,
      input.entry.historicalCanonicalEventId,
      input.entry.historicalCanonicalMarketId,
      input.entry.canonicalCategory,
      override?.oracleType ?? liveProfile?.oracle_type ?? null,
      override?.oracleName ?? liveProfile?.oracle_name ?? null,
      override?.resolutionAuthorityType ?? liveProfile?.resolution_authority_type ?? null,
      override?.primaryResolutionText ?? input.venueProfile.title ?? liveProfile?.primary_resolution_text ?? null,
      override?.supplementalRulesText ?? liveProfile?.supplemental_rules_text ?? null,
      override?.disputeWindowHours ?? liveProfile?.dispute_window_hours ?? null,
      override?.settlementLagHours ?? liveProfile?.settlement_lag_hours ?? null,
      override?.marketType ?? liveProfile?.market_type ?? null,
      override?.outcomeSchema ?? liveProfile?.outcome_schema ?? null,
      override?.hasAmbiguousTimeBoundary ?? liveProfile?.has_ambiguous_time_boundary ?? false,
      override?.hasAmbiguousJurisdictionBoundary ?? liveProfile?.has_ambiguous_jurisdiction_boundary ?? false,
      override?.hasAmbiguousSourceReference ?? liveProfile?.has_ambiguous_source_reference ?? false,
      override?.historicalDivergenceRate ?? liveProfile?.historical_divergence_rate ?? null,
      asJson({
        ...(liveProfile?.metadata ?? {}),
        ...(override?.metadata ?? {}),
        historySource: input.venueProfile.historySource,
        catalogScope: "historical_simulation"
      })
    ]
  );

  return result.rows[0]!;
};

const fetchLiveProfile = async (
  pool: Pool,
  venue: string,
  venueMarketId: string
): Promise<LiveProfileRow | null> => {
  const result = await pool.query<LiveProfileRow>(
    `SELECT
       oracle_type,
       oracle_name,
       resolution_authority_type,
       primary_resolution_text,
       supplemental_rules_text,
       dispute_window_hours,
       settlement_lag_hours,
       market_type,
       outcome_schema,
       has_ambiguous_time_boundary,
       has_ambiguous_jurisdiction_boundary,
       has_ambiguous_source_reference,
       historical_divergence_rate,
       metadata
     FROM resolution_profiles
    WHERE venue = $1
      AND venue_market_id = $2
    LIMIT 1`,
    [venue, venueMarketId]
  );

  return result.rows[0] ?? null;
};

const buildPredexonHistoricalStates = async (input: {
  adapter: PredexonHistoricalAdapter;
  entry: HistoricalCatalogManifestEntry;
  venueProfile: HistoricalCatalogManifestEntry["venueProfiles"][number];
}): Promise<CreateHistoricalMarketStateInput[]> => {
  const start = new Date(input.venueProfile.historyWindow.start);
  const end = new Date(input.venueProfile.historyWindow.end);
  const windowSeconds = {
    start_time: Math.floor(start.getTime() / 1_000),
    end_time: Math.floor(end.getTime() / 1_000)
  };
  const orderbookWindow = {
    start_time: start.getTime(),
    end_time: end.getTime()
  };

  if (input.venueProfile.venue === "OPINION") {
    const fragments = await input.adapter.buildOpinionOrderbookStateFragments(
      {
        canonicalEventId: input.entry.historicalCanonicalEventId,
        venue: "OPINION",
        venueMarketId: input.venueProfile.venueMarketId
      },
      {
        market_id: input.venueProfile.venueMarketId,
        start_time: orderbookWindow.start_time,
        end_time: orderbookWindow.end_time
      }
    );
    return applyCanonicalIdentity(fragments, input.entry);
  }

  if (input.venueProfile.venue === "LIMITLESS") {
    const fragments = await input.adapter.buildLimitlessOrderbookStateFragments(
      {
        canonicalEventId: input.entry.historicalCanonicalEventId,
        venue: "LIMITLESS",
        venueMarketId: input.venueProfile.venueMarketId
      },
      {
        market_slug: input.venueProfile.venueMarketId,
        start_time: orderbookWindow.start_time,
        end_time: orderbookWindow.end_time
      }
    );
    return applyCanonicalIdentity(fragments, input.entry);
  }

  const markets = await listMarketsByMappedIdentifier(input.adapter, input.venueProfile.venueMarketId);
  const market = markets[0];
  if (!market) {
    throw new Error(`No Predexon Polymarket metadata found for ${input.venueProfile.venueMarketId}.`);
  }

  const fragments = [
    ...(await input.adapter.buildCandleStateFragments(
      {
        canonicalEventId: input.entry.historicalCanonicalEventId,
        venue: "POLYMARKET",
        venueMarketId: market.conditionId
      },
      {
        condition_id: market.conditionId,
        start_time: windowSeconds.start_time,
        end_time: windowSeconds.end_time,
        interval: 60
      }
    ))
  ];

  if (market.tokenIds[0]) {
    fragments.push(
      ...(await input.adapter.buildVolumeOpenInterestFragments({
        canonicalEventId: input.entry.historicalCanonicalEventId,
        venue: "POLYMARKET",
        venueMarketId: market.conditionId,
        tokenId: market.tokenIds[0],
        conditionId: market.conditionId,
        volumeQuery: windowSeconds,
        openInterestQuery: windowSeconds
      }))
    );
    fragments.push(
      ...(await input.adapter.buildOrderbookStateFragments(
        {
          canonicalEventId: input.entry.historicalCanonicalEventId,
          venue: "POLYMARKET",
          venueMarketId: market.conditionId
        },
        {
          token_id: market.tokenIds[0],
          start_time: orderbookWindow.start_time,
          end_time: orderbookWindow.end_time
        }
      ))
    );
  }

  return applyCanonicalIdentity(fragments, input.entry);
};

const buildLimitlessSupplementalStates = async (input: {
  adapter: LimitlessHistoricalAdapter;
  entry: HistoricalCatalogManifestEntry;
  venueProfile: HistoricalCatalogManifestEntry["venueProfiles"][number];
}): Promise<CreateHistoricalMarketStateInput[]> => {
  const start = input.venueProfile.historyWindow.start;
  const end = input.venueProfile.historyWindow.end;
  const fragments = [
    ...(await input.adapter.buildHistoricalPriceFragments(
      {
        canonicalEventId: input.entry.historicalCanonicalEventId,
        venueMarketId: input.venueProfile.venueMarketId
      },
      {
        slug: input.venueProfile.venueMarketId,
        from: start,
        to: end
      }
    )),
    ...(await input.adapter.buildMarketEventFragments(
      {
        canonicalEventId: input.entry.historicalCanonicalEventId,
        venueMarketId: input.venueProfile.venueMarketId
      },
      {
        slug: input.venueProfile.venueMarketId,
        page: 1,
        limit: 100
      }
    ))
  ];

  return applyCanonicalIdentity(fragments, input.entry);
};

const upsertAcceptedAssessments = async (input: {
  pool: Pool;
  entry: HistoricalCatalogManifestEntry;
  profilesByVenue: ReadonlyMap<string, string>;
}): Promise<void> => {
  for (const assessment of input.entry.acceptedAssessments) {
    const leftProfileId = input.profilesByVenue.get(assessment.marketAVenue);
    const rightProfileId = input.profilesByVenue.get(assessment.marketBVenue);
    if (!leftProfileId || !rightProfileId) {
      throw new Error(
        `Cannot create assessment for ${input.entry.historicalCanonicalMarketId}; missing profile IDs for ${assessment.marketAVenue}/${assessment.marketBVenue}.`
      );
    }

    const ordered = [leftProfileId, rightProfileId].sort((left, right) => left.localeCompare(right));
    await input.pool.query(
      `INSERT INTO historical_simulation_risk_assessments (
         canonical_event_id,
         canonical_market_id,
         market_a_profile_id,
         market_b_profile_id,
         risk_score,
         confidence_score,
         equivalence_class,
         factor_breakdown,
         reasons,
         version,
         liquidity_cost,
         max_settlement_delay_hours
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12
       )
       ON CONFLICT (canonical_event_id, canonical_market_id, market_a_profile_id, market_b_profile_id, version)
       DO UPDATE SET
         risk_score = EXCLUDED.risk_score,
         confidence_score = EXCLUDED.confidence_score,
         equivalence_class = EXCLUDED.equivalence_class,
         factor_breakdown = EXCLUDED.factor_breakdown,
         reasons = EXCLUDED.reasons,
         liquidity_cost = EXCLUDED.liquidity_cost,
         max_settlement_delay_hours = EXCLUDED.max_settlement_delay_hours,
         computed_at = now()`,
      [
        input.entry.historicalCanonicalEventId,
        input.entry.historicalCanonicalMarketId,
        ordered[0],
        ordered[1],
        assessment.riskScore,
        assessment.confidenceScore,
        assessment.equivalenceClass,
        JSON.stringify(assessment.factorBreakdown),
        JSON.stringify(assessment.reasons),
        assessment.version,
        assessment.liquidityCost ?? null,
        assessment.maxSettlementDelayHours ?? null
      ]
    );
  }
};

const main = async (): Promise<void> => {
  const { curationPath, payload } = loadCuration();
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-historical-route-curation"
  });

  const repository = new HistoricalMarketStateRepository(pool);
  const predexonClient = new PredexonHistoricalClient({
    baseUrl: predexonBaseUrl,
    apiKey: predexonApiKey,
    logger
  });
  const predexonAdapter = new PredexonHistoricalAdapter({
    client: predexonClient,
    metadataVersion: predexonMetadataVersion,
    logger
  });
  const limitlessAdapter = limitlessApiKey
    ? new LimitlessHistoricalAdapter({
        client: new LimitlessHistoricalClient({
          baseUrl: limitlessBaseUrl,
          apiKey: limitlessApiKey,
          logger
        }),
        metadataVersion: "limitless-direct-v1",
        logger
      })
    : null;

  let accepted = 0;
  let unresolved = 0;

  try {
    for (const entry of payload.routes) {
      if (entry.decision.status !== "accepted") {
        unresolved += 1;
        console.log(JSON.stringify({
          status: entry.decision.status,
          historicalCanonicalMarketId: entry.historicalCanonicalMarketId,
          reasonCode: entry.decision.reasonCode
        }));
        continue;
      }

      const profilesByVenue = new Map<string, string>();
      for (const venueProfile of entry.venueProfiles) {
        const liveProfile = venueProfile.copyFromLiveResolutionProfile
          ? await fetchLiveProfile(pool, venueProfile.venue, venueProfile.venueMarketId)
          : null;
        const insertedProfile = await upsertHistoricalProfile({
          pool,
          entry,
          venueProfile,
          liveProfile
        });
        profilesByVenue.set(insertedProfile.venue, insertedProfile.id);
      }

      await upsertAcceptedAssessments({
        pool,
        entry,
        profilesByVenue
      });

      const accumulatedStates: CreateHistoricalMarketStateInput[] = [];
      for (const venueProfile of entry.venueProfiles) {
        if (venueProfile.historySource === "limitless_direct") {
          if (!limitlessAdapter) {
            throw new Error("LIMITLESS_API_KEY is required for limitless_direct history sync.");
          }
          accumulatedStates.push(...(await buildLimitlessSupplementalStates({
            adapter: limitlessAdapter,
            entry,
            venueProfile
          })));
          continue;
        }

        accumulatedStates.push(...(await buildPredexonHistoricalStates({
          adapter: predexonAdapter,
          entry,
          venueProfile
        })));

        if (venueProfile.venue === "LIMITLESS" && limitlessAdapter) {
          accumulatedStates.push(...(await buildLimitlessSupplementalStates({
            adapter: limitlessAdapter,
            entry,
            venueProfile
          })));
        }
      }

      const insertResult = await repository.insertManyIgnoreDuplicates(mergeHistoricalStates(accumulatedStates));
      accepted += 1;
      console.log(JSON.stringify({
        status: "accepted",
        historicalCanonicalMarketId: entry.historicalCanonicalMarketId,
        profileCount: entry.venueProfiles.length,
        insertedRows: insertResult.inserted,
        skippedRows: insertResult.skipped
      }));
    }

    console.log(JSON.stringify({ accepted, unresolved, curationPath }));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync historical route curation.");
  console.error(error);
  process.exit(1);
});
