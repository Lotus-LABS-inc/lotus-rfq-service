#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { CanonicalGraphProjector } from "../src/canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../src/canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../src/canonical/curated-canonical-graph.js";
import { PredexonHistoricalAdapter } from "../src/integrations/predexon/predexon-historical-adapter.js";
import { PredexonHistoricalClient } from "../src/integrations/predexon/predexon-client.js";
import { CanonicalCompatibilityRepository } from "../src/repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../src/repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../src/repositories/compatibility-version.repository.js";
import { CANONICAL_MARKET_REWRITE_SPEC } from "../src/simulation/canonical-market-rewrite-spec.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}
const predexonApiKey = process.env.PREDEXON_API_KEY;
if (!predexonApiKey) {
  throw new Error("PREDEXON_API_KEY is required.");
}
const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";

type Venue = "POLYMARKET";

interface LiveVenueMapping {
  venue: Venue;
  canonicalEventId: string;
  canonicalCategory: "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS";
  canonicalMarketId: string;
  venueMarketId: string;
  title: string;
}

interface ParsedArgs {
  venueMarketId?: string;
}

const LIVE_MAPPINGS: readonly LiveVenueMapping[] = [
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[0]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[0]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-NBA-LAL-ORL-2026-03-21-LAKERS-WIN",
    venueMarketId: "0x0954cc08de0ab8345bcf24f314d571e6a77d913ea9977ce2b4187983a70b450d",
    title: "Lakers vs. Magic"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[1]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[1]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-BTC-ALL-TIME-HIGH-BY-2026-03-31",
    venueMarketId: "0x3fd88dc4dde49dd20ceade22fda96dc345aa6932c46237ff7f47352e49475588",
    title: "Bitcoin all time high by March 31, 2026?"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[2]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[2]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-2028-DEM-NOM-GAVIN-NEWSOM",
    venueMarketId: "0x0f49db97f71c68b1e42a6d16e3de93d85dbf7d4148e3f018eb79e88554be9f75",
    title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[3]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[3]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-2028-GOP-NOM-MIKE-PENCE",
    venueMarketId: "0x41c6341dd79903aca4bb0c29f5a7976946c3774d2fd72f38cbb7de7092144520",
    title: "Will Mike Pence win the 2028 Republican presidential nomination?"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[4]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[4]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-LOL-WORLDS-2026-LCK-TEAM-WINS",
    venueMarketId: "0xbfc776a7f419fdc9bec5f026cb6bd115db75e22664f5d99873e4c330676015f8",
    title: "Will a team from LCK (South Korea) win LoL Worlds 2026?"
  },
  {
    venue: "POLYMARKET",
    canonicalEventId: CANONICAL_MARKET_REWRITE_SPEC[5]!.canonicalEventId,
    canonicalCategory: CANONICAL_MARKET_REWRITE_SPEC[5]!.canonicalCategory,
    canonicalMarketId: "POLYMARKET-LOL-2026-GENG-GOLDEN-ROAD",
    venueMarketId: "0xfd17453f83cd10bf3fa5fc46b30d23a7abc3d66da7aa3dc961187d30506573db",
    title: "Will Gen.G complete the League of Legends \"Golden Road\" in 2026?"
  }
] as const;

const metadataVersion = process.env.PREDEXON_METADATA_VERSION ?? "predexon-v2";

const parseArgs = (): ParsedArgs => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }
  return {
    venueMarketId: args.get("venueMarketId") || undefined
  };
};

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
  if (labels.length === 2 && labels.some((label) => label.toLowerCase() === "yes") && labels.some((label) => label.toLowerCase() === "no")) {
    const yesLabel = labels.find((label) => label.toLowerCase() === "yes") ?? "Yes";
    const noLabel = labels.find((label) => label.toLowerCase() === "no") ?? "No";
    return {
      marketShape: "binary",
      yesLabel,
      noLabel
    };
  }
  return {
    labels,
    marketShape: labels.length > 2 ? "categorical" : "binary"
  };
};

const buildEnrichedSeed = async (
  adapter: PredexonHistoricalAdapter,
  mapping: LiveVenueMapping
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
            metadata: {
              venue: mapping.venue
            }
          }
          : null
      )
      .filter((outcome): outcome is NonNullable<typeof outcome> => outcome !== null)
    : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const title = matched?.title ?? mapping.title;
  const description = typeof raw.description === "string" ? raw.description : null;
  const publishedAt = toDateOrNull(typeof raw.created_time === "string" ? raw.created_time : undefined);
  const expiresAt = toDateOrNull(typeof raw.end_time === "string" ? raw.end_time : undefined);

  return {
    canonicalEventId: mapping.canonicalEventId,
    canonicalMarketId: mapping.canonicalMarketId,
    canonicalCategory: mapping.canonicalCategory,
    venue: mapping.venue,
    venueMarketId: mapping.venueMarketId,
    title,
    ...(description !== null ? { description } : {}),
    marketType: "BINARY",
    marketClass: "BINARY",
    ...(outcomes.length > 0 ? { outcomes } : {}),
    outcomeSchema: outcomes.length > 0 ? toOutcomeSchema(outcomes) : { yes: true, no: true },
    topics: tags.length > 0 ? tags : [mapping.canonicalCategory.toLowerCase()],
    ...(publishedAt !== null ? { publishedAt } : {}),
    ...(expiresAt !== null ? { expiresAt, resolvesAt: expiresAt } : {}),
    resolutionSource: mapping.venue,
    resolutionTitle: title,
    ...(description !== null ? { resolutionRulesText: description } : {}),
    resolutionAuthorityType: "CENTRAL",
    settlementType: "unknown",
    rawSourcePayload: {
      source: "wire-live-predexon-venue-ids",
      market: raw
    },
    normalizedPayload: {
      canonicalEventId: mapping.canonicalEventId,
      canonicalMarketId: mapping.canonicalMarketId,
      marketId: matched?.marketId ?? null,
      eventId: matched?.eventId ?? null,
      eventSlug: matched?.eventSlug ?? null,
      marketSlug: matched?.marketSlug ?? null
    },
    mappingLineage: ["wire-live-predexon-venue-ids", "predexon_market_metadata"],
    sourceMetadataVersion: metadataVersion,
    eventPropositionKey: `curated-live:${mapping.canonicalMarketId}`,
    propositionHints: {
      normalizedPropositionText: description ? `${title} ${description}` : title,
      groupingHints: {
        canonicalMarketId: mapping.canonicalMarketId,
        marketId: matched?.marketId ?? null,
        tokenIds: matched?.tokenIds ?? []
      }
    },
    executableDisplayName: title,
    executableMetadata: {
      source: "wire-live-predexon-venue-ids",
      seeded: true,
      enriched: Boolean(matched)
    }
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    application_name: "wire-live-predexon-venue-ids"
  });

  try {
    const client = new PredexonHistoricalClient({
      baseUrl: predexonBaseUrl,
      apiKey: predexonApiKey
    });
    const adapter = new PredexonHistoricalAdapter({
      client,
      metadataVersion
    });
    const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
    const projector = new CanonicalGraphProjector(
      new CanonicalGraphRepository(pool),
      new CanonicalCompatibilityProjector(
        new CanonicalCompatibilityRepository(pool),
        new CompatibilityVersionRepository(pool)
      )
    );
    const selectedMappings = args.venueMarketId
      ? LIVE_MAPPINGS.filter((mapping) => mapping.venueMarketId === args.venueMarketId)
      : LIVE_MAPPINGS;
    if (selectedMappings.length === 0) {
      throw new Error(`No live mapping found for venueMarketId=${args.venueMarketId}`);
    }
    const enrichedSeeds = await Promise.all(selectedMappings.map((mapping) => buildEnrichedSeed(adapter, mapping)));
    const snapshot = snapshotBuilder.build(enrichedSeeds);
    await projector.persistAndProject(snapshot);
    for (const mapping of selectedMappings) {
      console.log(JSON.stringify(mapping));
    }
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error("Failed to wire live Predexon venue IDs.");
  console.error(error);
  process.exit(1);
});
