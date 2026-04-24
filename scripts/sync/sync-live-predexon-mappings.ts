#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { CanonicalGraphProjector } from "../../src/canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../src/canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../../src/canonical/curated-canonical-graph.js";
import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput
} from "../../src/core/historical-simulation/historical-simulation.types.js";
import { OpinionClient } from "../../src/integrations/opinion/opinion-client.js";
import { OpinionMarketAdapter } from "../../src/integrations/opinion/opinion-market-adapter.js";
import type { OpinionNormalizedMarket } from "../../src/integrations/opinion/opinion-types.js";
import { LimitlessHistoricalClient, type LimitlessMarketDetail } from "../../src/integrations/limitless/limitless-client.js";
import { hydrateLimitlessExecutableProfile } from "../../src/integrations/limitless/limitless-detail-hydration.js";
import { PredexonHistoricalAdapter } from "../../src/integrations/predexon/predexon-historical-adapter.js";
import { PredexonHistoricalClient } from "../../src/integrations/predexon/predexon-client.js";
import { CanonicalCompatibilityRepository } from "../../src/repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../../src/repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../../src/repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../../src/repositories/historical-market-state.repository.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to sync live Predexon mappings.");
}

type LiveVenue = "POLYMARKET" | "LIMITLESS" | "OPINION";
type LiveCategory = "CRYPTO" | "POLITICS";

interface LiveMappingSeed {
  resolutionProfileId: string;
  canonicalEventId: string;
  canonicalMarketId: string;
  canonicalCategory: LiveCategory;
  venue: LiveVenue;
  venueMarketId: string;
  title: string;
  seededTimestamp: string;
}

interface SeededOpinionFallbackMetadata {
  title: string;
  description: string | null;
  rulesText: string | null;
  expiresAt: Date | null;
  resolvesAt: Date | null;
}

const metadataVersion = "predexon-live-mapping-seed-v2";
const limitlessBaseUrl = process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange";
const limitlessApiKey = process.env.LIMITLESS_API_KEY;
const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";
const predexonApiKey = process.env.PREDEXON_API_KEY;
const opinionBaseUrl = process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi";
const opinionApiKey = process.env.OPINION_API_KEY;

// Live identifiers below were validated against the active official venue catalogs on 2026-03-19.
const liveMappings: readonly LiveMappingSeed[] = [
  {
    resolutionProfileId: "7e04af6d-e649-4a33-8780-4d376331a111",
    canonicalEventId: "6c6ca772-bf16-49f9-a4d5-b3b4fb26a111",
    canonicalMarketId: "LIVE-POLYMARKET-BTC-UPDOWN-2026-03-21",
    canonicalCategory: "CRYPTO",
    venue: "POLYMARKET",
    venueMarketId: "0xd1436b9fb82e252c5a1482c33920e68ff6e64c977ff1bec70585ce6586321917",
    title: "Bitcoin Up or Down on March 21?",
    seededTimestamp: "2026-03-19T16:06:08.883Z"
  },
  {
    resolutionProfileId: "7e04af6d-e649-4a33-8780-4d376331a222",
    canonicalEventId: "6c6ca772-bf16-49f9-a4d5-b3b4fb26a222",
    canonicalMarketId: "LIVE-LIMITLESS-BTC-ABOVE-2026-03-19T20Z",
    canonicalCategory: "CRYPTO",
    venue: "LIMITLESS",
    venueMarketId: "btc-above-dollar6982012-on-mar-19-2000-utc-1773946806488",
    title: "BTC above $69820.12 on Mar 19, 20:00 UTC?",
    seededTimestamp: "2026-03-19T19:00:00.000Z"
  },
  {
    resolutionProfileId: "7e04af6d-e649-4a33-8780-4d376331a333",
    canonicalEventId: "6c6ca772-bf16-49f9-a4d5-b3b4fb26a333",
    canonicalMarketId: "LIVE-OPINION-DEM-NOM-2028-JON-OSSOFF",
    canonicalCategory: "POLITICS",
    venue: "OPINION",
    venueMarketId: "6808",
    title: "Democratic Presidential Nominee 2028: Jon Ossoff",
    seededTimestamp: "2026-02-06T00:00:00.000Z"
  }
] as const;

const opinionSeedFallbackMetadata: Readonly<Record<string, SeededOpinionFallbackMetadata>> = Object.freeze({
  "6808": {
    title: "Will Jon Ossoff win the 2028 Democratic presidential nomination?",
    description: "Binary nomination market for Jon Ossoff in the 2028 Democratic presidential field.",
    rulesText: "This market resolves YES if Jon Ossoff wins the 2028 Democratic presidential nomination.",
    expiresAt: new Date("2028-11-08T04:59:00.000Z"),
    resolvesAt: new Date("2028-11-08T04:59:00.000Z")
  }
});

const toSeedState = (mapping: LiveMappingSeed): CreateHistoricalMarketStateInput => ({
  canonicalEventId: mapping.canonicalEventId,
  canonicalMarketId: mapping.canonicalMarketId,
  canonicalCategory: mapping.canonicalCategory,
  venue: mapping.venue,
  venueMarketId: mapping.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: new Date(mapping.seededTimestamp),
  metadataVersion,
  sourceTimestamp: new Date(mapping.seededTimestamp),
  lastPrice: "0.5",
  orderbookSnapshot: {
    seeded: true,
    title: mapping.title
  }
});

const toDateOrNull = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toOutcomeSchema = (outcomes: readonly { label?: string }[]) => {
  const labels = outcomes
    .map((outcome) => outcome.label?.trim())
    .filter((label): label is string => Boolean(label));
  if (labels.length === 2) {
    return {
      marketShape: "binary",
      outcomeLabels: labels
    };
  }
  return {
    labels,
    marketShape: labels.length > 2 ? "categorical" : "binary"
  };
};

const buildPolymarketHydratedSeed = async (
  adapter: PredexonHistoricalAdapter,
  mapping: LiveMappingSeed
): Promise<CuratedCanonicalGraphSeed> => {
  const markets = await adapter.listHistoricalMarkets({ condition_id: [mapping.venueMarketId] });
  const matched = markets[0];
  const raw = matched?.raw ?? {};
  const outcomes = Array.isArray(raw.outcomes)
    ? raw.outcomes
      .map((outcome, index) =>
        typeof outcome === "object" && outcome !== null
          ? {
            id:
              typeof outcome.token_id === "string" ? outcome.token_id : `${mapping.venueMarketId}:${index}`,
            label: typeof outcome.label === "string" ? outcome.label : `Outcome ${index + 1}`,
            metadata: { venue: "POLYMARKET" }
          }
          : null
      )
      .filter((outcome): outcome is NonNullable<typeof outcome> => outcome !== null)
    : [];
  const title = matched?.title ?? mapping.title;
  const description = typeof raw.description === "string" ? raw.description : null;
  const publishedAt = toDateOrNull(typeof raw.created_time === "string" ? raw.created_time : undefined) ?? new Date(mapping.seededTimestamp);
  const expiresAt = toDateOrNull(typeof raw.end_time === "string" ? raw.end_time : undefined);
  const closesAt = toDateOrNull(typeof raw.close_time === "string" ? raw.close_time : undefined);
  const resolvedAt = closesAt ?? expiresAt;
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [mapping.canonicalCategory.toLowerCase()];

  return {
    canonicalEventId: mapping.canonicalEventId,
    canonicalMarketId: mapping.canonicalMarketId,
    canonicalCategory: mapping.canonicalCategory,
    venue: "POLYMARKET",
    venueMarketId: mapping.venueMarketId,
    title,
    ...(description !== null ? { description } : {}),
    marketType: "BINARY",
    marketClass: "BINARY",
    ...(outcomes.length > 0 ? { outcomes } : {}),
    outcomeSchema: outcomes.length > 0 ? toOutcomeSchema(outcomes) : { yes: true, no: true },
    topics: tags,
    publishedAt,
    ...(expiresAt ? { expiresAt } : {}),
    ...(resolvedAt ? { resolvesAt: resolvedAt } : {}),
    resolutionSource: "POLYMARKET",
    resolutionTitle: title,
    ...(description !== null ? { resolutionRulesText: description } : {}),
    resolutionAuthorityType: "CENTRAL",
    settlementType: "unknown",
    rawSourcePayload: {
      seeded: true,
      source: "sync-live-predexon-mappings",
      predexonMarket: raw
    },
    normalizedPayload: {
      canonicalEventId: mapping.canonicalEventId,
      canonicalMarketId: mapping.canonicalMarketId,
      conditionId: matched?.conditionId ?? mapping.venueMarketId,
      eventId: matched?.eventId ?? null,
      marketId: matched?.marketId ?? null
    },
    mappingLineage: ["sync-live-predexon-mappings", "predexon_market_metadata"],
    sourceMetadataVersion: metadataVersion,
    eventPropositionKey: `curated-live:${mapping.canonicalMarketId}`,
    propositionHints: {
      normalizedPropositionText: description ? `${title} ${description}` : title,
      groupingHints: {
        canonicalMarketId: mapping.canonicalMarketId,
        marketId: matched?.marketId ?? null,
        endTime: typeof raw.end_time === "string" ? raw.end_time : null,
        closeTime: typeof raw.close_time === "string" ? raw.close_time : null
      }
    },
    executableDisplayName: title,
    executableMetadata: {
      source: "sync-live-predexon-mappings",
      seeded: true,
      enriched: Boolean(matched)
    }
  };
};

const loadOpinionCurrentStateProfile = async (
  pool: Pool,
  marketId: string
): Promise<{
  title: string;
  description: string | null;
  rulesText: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  resolvesAt: Date | null;
  rawSourcePayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
} | null> => {
  const result = await pool.query<{
    title: string;
    description: string | null;
    resolution_rules_text: string | null;
    published_at: Date | null;
    expires_at: Date | null;
    resolves_at: Date | null;
    raw_source_payload: Record<string, unknown> | null;
    normalized_payload: Record<string, unknown> | null;
  }>(
    `SELECT title, description, resolution_rules_text, published_at, expires_at, resolves_at, raw_source_payload, normalized_payload
       FROM venue_market_profiles
      WHERE venue = 'OPINION'
        AND venue_market_id = $1
        AND source_metadata_version = 'opinion-current-bootstrap-v1'
      ORDER BY updated_at DESC
      LIMIT 1`,
    [marketId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    title: row.title,
    description: row.description,
    rulesText: row.resolution_rules_text,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    resolvesAt: row.resolves_at,
    rawSourcePayload: row.raw_source_payload ?? {},
    normalizedPayload: row.normalized_payload ?? {}
  };
};

const loadOpinionMarketById = async (
  client: OpinionClient,
  adapter: OpinionMarketAdapter,
  marketId: string
): Promise<OpinionNormalizedMarket | null> => {
  for (let page = 1; page <= 50; page += 1) {
    const markets = await adapter.listMarkets({ page, limit: 100 });
    const matched = markets.find((market) => market.venueMarketId === marketId);
    if (matched) {
      return matched;
    }
    if (markets.length < 100) {
      break;
    }
  }
  return null;
};

const buildOpinionHydratedSeed = async (
  pool: Pool,
  mapping: LiveMappingSeed
): Promise<CuratedCanonicalGraphSeed> => {
  const currentProfile = await loadOpinionCurrentStateProfile(pool, mapping.venueMarketId);
  let liveMarket: OpinionNormalizedMarket | null = null;

  if (opinionApiKey) {
    try {
      const client = new OpinionClient({
        baseUrl: opinionBaseUrl,
        apiKey: opinionApiKey
      });
      const adapter = new OpinionMarketAdapter({
        client,
        metadataVersion
      });
      liveMarket = await loadOpinionMarketById(client, adapter, mapping.venueMarketId);
    } catch {
      liveMarket = null;
    }
  }

  const seededFallback = opinionSeedFallbackMetadata[mapping.venueMarketId] ?? null;
  const title = liveMarket?.title ?? currentProfile?.title ?? seededFallback?.title ?? mapping.title;
  const description = liveMarket?.rules ?? currentProfile?.description ?? seededFallback?.description ?? null;
  const publishedAt = liveMarket?.createdAt ?? currentProfile?.publishedAt ?? new Date(mapping.seededTimestamp);
  const expiresAt = liveMarket?.cutoffAt ?? currentProfile?.expiresAt ?? seededFallback?.expiresAt ?? null;
  const resolvesAt = liveMarket?.resolvedAt ?? currentProfile?.resolvesAt ?? seededFallback?.resolvesAt ?? null;
  const rulesText = liveMarket?.rules ?? currentProfile?.rulesText ?? seededFallback?.rulesText ?? description;
  const yesLabel = liveMarket?.yesLabel ?? "Yes";
  const noLabel = liveMarket?.noLabel ?? "No";
  const labels = liveMarket?.labels ?? [];

  return {
    canonicalEventId: mapping.canonicalEventId,
    canonicalMarketId: mapping.canonicalMarketId,
    canonicalCategory: mapping.canonicalCategory,
    venue: "OPINION",
    venueMarketId: mapping.venueMarketId,
    title: liveMarket?.title ?? currentProfile?.title ?? seededFallback?.title ?? mapping.title,
    ...(description !== null ? { description } : {}),
    marketType: "BINARY",
    marketClass: "BINARY",
    outcomes: [
      { id: "YES", label: yesLabel, metadata: { venue: "OPINION" } },
      { id: "NO", label: noLabel, metadata: { venue: "OPINION" } }
    ],
    outcomeSchema: {
      marketShape: "binary",
      yesLabel,
      noLabel
    },
    topics: labels.length > 0 ? labels : [mapping.canonicalCategory.toLowerCase()],
    publishedAt,
    ...(expiresAt ? { expiresAt } : {}),
    ...(resolvesAt ? { resolvesAt } : {}),
    resolutionSource: "OPINION",
    resolutionTitle: title,
    ...(rulesText !== null ? { resolutionRulesText: rulesText } : {}),
    resolutionAuthorityType: "CENTRAL",
    settlementType: "onchain",
    rawSourcePayload: {
      seeded: true,
      source: "sync-live-predexon-mappings",
      opinionCurrentProfile: currentProfile?.rawSourcePayload ?? null,
      opinionLiveMarket: liveMarket?.raw ?? null
    },
    normalizedPayload: {
      canonicalEventId: mapping.canonicalEventId,
      canonicalMarketId: mapping.canonicalMarketId,
      marketId: mapping.venueMarketId,
      hydratedFromCurrentState: Boolean(currentProfile),
      hydratedFromLiveApi: Boolean(liveMarket),
      hydratedFromSeedFallback: Boolean(!currentProfile && !liveMarket && seededFallback),
      ...(currentProfile?.normalizedPayload ?? {})
    },
    mappingLineage: [
      "sync-live-predexon-mappings",
      ...(currentProfile ? ["opinion-current-bootstrap"] : []),
      ...(liveMarket ? ["opinion-openapi-market"] : []),
      ...(!currentProfile && !liveMarket && seededFallback ? ["seeded-opinion-fallback-metadata"] : [])
    ],
    sourceMetadataVersion: metadataVersion,
    eventPropositionKey: `curated-live:${mapping.canonicalMarketId}`,
    propositionHints: {
      normalizedPropositionText: rulesText ? `${title} ${rulesText}` : title,
      groupingHints: {
        canonicalMarketId: mapping.canonicalMarketId,
        hydratedFromCurrentState: Boolean(currentProfile),
        hydratedFromLiveApi: Boolean(liveMarket),
        hydratedFromSeedFallback: Boolean(!currentProfile && !liveMarket && seededFallback)
      }
    },
    executableDisplayName: title,
    executableMetadata: {
      source: "sync-live-predexon-mappings",
      seeded: true,
      enriched: Boolean(currentProfile || liveMarket || seededFallback)
    }
  };
};

const toCanonicalSeed = async (
  pool: Pool,
  predexonAdapter: PredexonHistoricalAdapter,
  mapping: LiveMappingSeed,
  detail: LimitlessMarketDetail | null
): Promise<CuratedCanonicalGraphSeed> => {
  if (mapping.venue === "POLYMARKET") {
    return buildPolymarketHydratedSeed(predexonAdapter, mapping);
  }
  if (mapping.venue === "OPINION") {
    return buildOpinionHydratedSeed(pool, mapping);
  }
  const limitlessHydrated = mapping.venue === "LIMITLESS"
    ? hydrateLimitlessExecutableProfile({
      detail,
      fallbackTitle: mapping.title,
      fallbackDescription: mapping.title
    })
    : null;

  return ({
  canonicalEventId: mapping.canonicalEventId,
  canonicalMarketId: mapping.canonicalMarketId,
  canonicalCategory: mapping.canonicalCategory,
  venue: mapping.venue,
  venueMarketId: mapping.venueMarketId,
  title: limitlessHydrated?.title ?? mapping.title,
  description: limitlessHydrated?.description ?? null,
  marketType: "BINARY",
  marketClass: "BINARY",
  outcomes: mapping.venue === "LIMITLESS"
    ? [
      { id: "YES", label: "Yes", metadata: { venue: "LIMITLESS" } },
      { id: "NO", label: "No", metadata: { venue: "LIMITLESS" } }
    ]
    : undefined,
  outcomeSchema: { yes: true, no: true },
  topics: [mapping.canonicalCategory.toLowerCase()],
  publishedAt: limitlessHydrated?.publishedAt ?? new Date(mapping.seededTimestamp),
  ...(limitlessHydrated?.expiresAt ? { expiresAt: limitlessHydrated.expiresAt, resolvesAt: limitlessHydrated.resolvesAt } : {}),
  resolutionSource: limitlessHydrated?.resolutionSource ?? mapping.venue,
  resolutionTitle: limitlessHydrated?.resolutionTitle ?? mapping.title,
  resolutionRulesText: limitlessHydrated?.resolutionRulesText ?? null,
  resolutionAuthorityType: "CENTRAL",
  disputeWindowHours: null,
  settlementType: "unknown",
  settlementLagHours: null,
  rawSourcePayload: {
    seeded: true,
    source: "sync-live-predexon-mappings",
    resolutionProfileId: mapping.resolutionProfileId,
    limitlessMarketDetail: detail
  },
  normalizedPayload: {
    canonicalEventId: mapping.canonicalEventId,
    canonicalMarketId: mapping.canonicalMarketId,
    category: mapping.canonicalCategory,
    limitlessDetailHydrated: Boolean(limitlessHydrated?.detailHydrated)
  },
  mappingLineage: [
    "sync-live-predexon-mappings",
    ...(limitlessHydrated?.detailHydrated ? ["limitless-market-detail"] : [])
  ],
  sourceMetadataVersion: metadataVersion,
  eventPropositionKey: `curated-live:${mapping.canonicalMarketId}`,
  propositionHints: {
    normalizedPropositionText: [limitlessHydrated?.title ?? mapping.title, limitlessHydrated?.resolutionRulesText ?? ""].join(" ").trim(),
    groupingHints: {
      canonicalMarketId: mapping.canonicalMarketId,
      resolutionProfileId: mapping.resolutionProfileId,
      deadline: limitlessHydrated?.expiresAt?.toISOString() ?? null
    }
  },
  executableDisplayName: limitlessHydrated?.title ?? mapping.title,
  executableMetadata: {
    source: "sync-live-predexon-mappings",
    seeded: true,
    detailHydrated: Boolean(limitlessHydrated?.detailHydrated)
  }
})};

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-live-predexon-mappings"
  });

  try {
    if (!predexonApiKey) {
      throw new Error("PREDEXON_API_KEY is required.");
    }
    const predexonAdapter = new PredexonHistoricalAdapter({
      client: new PredexonHistoricalClient({
        baseUrl: predexonBaseUrl,
        apiKey: predexonApiKey
      }),
      metadataVersion
    });
    const limitlessClient = limitlessApiKey
      ? new LimitlessHistoricalClient({
        baseUrl: limitlessBaseUrl,
        apiKey: limitlessApiKey
      })
      : null;
    const detailByMarketId = new Map<string, LimitlessMarketDetail | null>();
    for (const mapping of liveMappings) {
      if (mapping.venue !== "LIMITLESS" || !limitlessClient || detailByMarketId.has(mapping.venueMarketId)) {
        continue;
      }
      try {
        detailByMarketId.set(mapping.venueMarketId, await limitlessClient.getMarketDetail(mapping.venueMarketId));
      } catch {
        detailByMarketId.set(mapping.venueMarketId, null);
      }
    }

    const repository = new HistoricalMarketStateRepository(pool);
    const graphRepository = new CanonicalGraphRepository(pool);
    const projector = new CanonicalGraphProjector(
      graphRepository,
      new CanonicalCompatibilityProjector(
        new CanonicalCompatibilityRepository(pool),
        new CompatibilityVersionRepository(pool)
      )
    );
    const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
    await projector.persistAndProject(
      snapshotBuilder.build(
        await Promise.all(
          liveMappings.map((mapping) =>
            toCanonicalSeed(pool, predexonAdapter, mapping, detailByMarketId.get(mapping.venueMarketId) ?? null)
          )
        )
      )
    );

    const seedResult = await repository.insertManyIgnoreDuplicates(liveMappings.map(toSeedState));

    console.log("Synced live Predexon mappings.");
    console.log(`Canonical graph profiles upserted: ${liveMappings.length}`);
    console.log(`Category anchor rows inserted: ${seedResult.inserted}`);
    console.log(`Category anchor rows skipped: ${seedResult.skipped}`);
    for (const mapping of liveMappings) {
      console.log(
        `${mapping.venue} ${mapping.canonicalEventId} ${mapping.canonicalMarketId} -> ${mapping.venueMarketId}`
      );
    }
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync live Predexon mappings.");
  console.error(error);
  process.exit(1);
});
