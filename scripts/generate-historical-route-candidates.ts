#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { historicalRouteCandidatesSchema } from "../src/simulation/historical-route-catalog-manifest.js";
import {
  buildSourceBackedHistoricalCandidate,
  historicalRouteDiscoverySeeds,
  type HistoricalRouteDiscoverySeed
} from "../src/simulation/historical-route-source-discovery.js";
import { PredexonHistoricalClient } from "../src/integrations/predexon/predexon-client.js";
import { LimitlessHistoricalClient } from "../src/integrations/limitless/limitless-client.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const predexonApiKey = process.env.PREDEXON_API_KEY;
const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";
const limitlessApiKey = process.env.LIMITLESS_API_KEY;
const limitlessBaseUrl = process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange";
const opinionApiKey = process.env.OPINION_API_KEY;
const opinionBaseUrl = process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi";

if (!predexonApiKey) {
  throw new Error("PREDEXON_API_KEY is required.");
}

if (!limitlessApiKey) {
  throw new Error("LIMITLESS_API_KEY is required.");
}

const predexonClient = new PredexonHistoricalClient({
  baseUrl: predexonBaseUrl,
  apiKey: predexonApiKey
});

const limitlessClient = new LimitlessHistoricalClient({
  baseUrl: limitlessBaseUrl,
  apiKey: limitlessApiKey
});

const normalizeComparableTitle = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const readOpinionCurationExclusions = (): Set<string> => {
  const reportPath = path.resolve(process.cwd(), "docs", "predexon-opinion-id-curation.json");
  if (!existsSync(reportPath)) {
    return new Set();
  }

  const payload = JSON.parse(readFileSync(reportPath, "utf8")) as {
    pairs?: Array<{ rejectedCandidates?: Array<{ marketId?: string }> }>;
  };

  return new Set(
    (payload.pairs ?? [])
      .flatMap((pair) => pair.rejectedCandidates ?? [])
      .map((candidate) => candidate.marketId)
      .filter((marketId): marketId is string => typeof marketId === "string" && marketId.length > 0)
  );
};

const fetchOpinionMarketList = async (): Promise<Array<{ marketId: string; title: string }>> => {
  if (!opinionApiKey) {
    return [];
  }

  const response = await fetch(`${opinionBaseUrl}/market?page=1&limit=200`, {
    headers: {
      "x-api-key": opinionApiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Opinion OpenAPI /market failed with HTTP ${response.status}.`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const candidates = [
    ...(Array.isArray(payload.data) ? payload.data : []),
    ...(Array.isArray((payload.data as Record<string, unknown> | undefined)?.markets)
      ? ((payload.data as Record<string, unknown>).markets as unknown[])
      : []),
    ...(Array.isArray((payload.data as Record<string, unknown> | undefined)?.items)
      ? ((payload.data as Record<string, unknown>).items as unknown[])
      : []),
    ...(Array.isArray(payload.markets) ? (payload.markets as unknown[]) : []),
    ...(Array.isArray(payload.items) ? (payload.items as unknown[]) : [])
  ];

  const seen = new Set<string>();
  const extracted: Array<{ marketId: string; title: string }> = [];
  for (const entry of candidates) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const marketId = typeof record.marketId === "string"
      ? record.marketId
      : typeof record.id === "string"
        ? record.id
        : typeof record.market_id === "string"
          ? record.market_id
          : null;
    const title = typeof record.title === "string"
      ? record.title
      : typeof record.marketTitle === "string"
        ? record.marketTitle
        : typeof record.question === "string"
          ? record.question
          : null;

    if (!marketId || !title || seen.has(marketId)) {
      continue;
    }

    seen.add(marketId);
    extracted.push({ marketId, title });
  }

  return extracted;
};

const buildOpinionWindow = (seed: HistoricalRouteDiscoverySeed) => {
  const start = seed.venueProfiles
    .map((profile) => new Date(profile.historyWindow.start).getTime())
    .reduce((left, right) => Math.min(left, right));
  const end = seed.venueProfiles
    .map((profile) => new Date(profile.historyWindow.end).getTime())
    .reduce((left, right) => Math.max(left, right));

  return {
    start,
    end
  };
};

const resolveOpinionExpansion = async (
  seed: HistoricalRouteDiscoverySeed,
  exclusions: ReadonlySet<string>,
  opinionMarkets: readonly Array<{ marketId: string; title: string }>
) => {
  if (!seed.opinionDiscovery) {
    return {
      discoveredFrom: [] as Array<{ type: "public_site" | "search_query" | "predexon_validation"; reference: string; observation: string }>,
      venueProfiles: [] as typeof seed.venueProfiles
    };
  }

  const discoveredFrom = [
    {
      type: "public_site" as const,
      reference: seed.opinionDiscovery.publicReference,
      observation: "Opinion historical pair discovery uses the documented Opinion OpenAPI /market listing surface when an API key is available."
    },
    ...seed.opinionDiscovery.searchQueries.map((query) => ({
      type: "search_query" as const,
      reference: query,
      observation: "Exact Opinion public discovery query retained for audit and repeatable exclusion review."
    }))
  ];

  if (!opinionApiKey) {
    return {
      discoveredFrom: [
        ...discoveredFrom,
        {
          type: "public_site" as const,
          reference: "OPINION_API_KEY",
          observation:
            "Opinion OpenAPI discovery was skipped because OPINION_API_KEY is not configured. Exact historical Opinion pair expansion remains blocked until direct Opinion discovery is enabled."
        }
      ],
      venueProfiles: [] as typeof seed.venueProfiles
    };
  }

  const titleSet = new Set(seed.opinionDiscovery.expectedTitles.map((title) => normalizeComparableTitle(title)));
  const window = buildOpinionWindow(seed);
  for (const market of opinionMarkets) {
    if (!titleSet.has(normalizeComparableTitle(market.title)) || exclusions.has(market.marketId)) {
      continue;
    }

    const snapshots = await predexonClient.getOpinionOrderbookHistory({
      market_id: market.marketId,
      start_time: window.start,
      end_time: window.end,
      limit: 1
    });

    if (snapshots.length === 0) {
      continue;
    }

    return {
      discoveredFrom: [
        ...discoveredFrom,
        {
          type: "predexon_validation" as const,
          reference: `${predexonBaseUrl}/v2/opinion/orderbooks?market_id=${market.marketId}&start_time=${window.start}&end_time=${window.end}`,
          observation: `Predexon Opinion historical validation returned non-empty orderbook history for exact market ${market.marketId}.`
        }
      ],
      venueProfiles: [
        {
          venue: "OPINION" as const,
          venueMarketId: market.marketId,
          title: market.title,
          historySource: "predexon_opinion" as const,
          historyWindow: {
            start: new Date(window.start).toISOString(),
            end: new Date(window.end).toISOString()
          }
        }
      ] as typeof seed.venueProfiles
    };
  }

  return { discoveredFrom, venueProfiles: [] as typeof seed.venueProfiles };
};

const validateSeed = async (seed: HistoricalRouteDiscoverySeed): Promise<void> => {
  for (const validation of seed.validations) {
    if (validation.validationKind === "predexon_polymarket") {
      const markets = await predexonClient.listMarkets({ condition_id: [validation.expectedReference] });
      const market = markets[0];
      if (!market) {
        throw new Error(`Predexon market not found for ${validation.expectedReference}.`);
      }
      if (market.title !== validation.expectedTitle) {
        throw new Error(
          `Predexon title mismatch for ${validation.expectedReference}: expected "${validation.expectedTitle}", received "${market.title}".`
        );
      }
      continue;
    }

    if (validation.validationKind === "limitless_market_detail") {
      const market = await limitlessClient.getMarketDetail(validation.expectedReference);
      if (market.title !== validation.expectedTitle) {
        throw new Error(
          `Limitless title mismatch for ${validation.expectedReference}: expected "${validation.expectedTitle}", received "${market.title}".`
        );
      }
      continue;
    }

    if (validation.validationKind === "predexon_opinion") {
      const opinionProfile = seed.venueProfiles.find((profile) => profile.venue === "OPINION");
      if (!opinionProfile) {
        throw new Error(`Missing Opinion venue profile for ${seed.historicalCanonicalMarketId}.`);
      }
      const snapshots = await predexonClient.getOpinionOrderbookHistory({
        market_id: validation.expectedReference,
        start_time: new Date(opinionProfile.historyWindow.start).getTime(),
        end_time: new Date(opinionProfile.historyWindow.end).getTime(),
        limit: 1
      });
      if (snapshots.length === 0) {
        throw new Error(`Predexon Opinion orderbook history is empty for ${validation.expectedReference}.`);
      }
      continue;
    }
  }
};

const main = async (): Promise<void> => {
  const opinionExclusions = readOpinionCurationExclusions();
  const opinionMarkets = await fetchOpinionMarketList();
  const candidates = [];
  for (const seed of historicalRouteDiscoverySeeds) {
    await validateSeed(seed);
    const opinionExpansion = await resolveOpinionExpansion(seed, opinionExclusions, opinionMarkets);
    candidates.push(buildSourceBackedHistoricalCandidate(seed, {
      additionalDiscoveredFrom: opinionExpansion.discoveredFrom,
      additionalVenueProfiles: opinionExpansion.venueProfiles
    }));
  }

  const payload = historicalRouteCandidatesSchema.parse({
    version: 2,
    observedAt: new Date().toISOString(),
    policy: {
      exactMatchRule: "exact_semantic_equivalence_only",
      approvalMode: "checked_in_curated_manifest",
      catalogScope: "historical_simulation"
    },
    candidates
  });

  const outputPath = path.resolve(process.cwd(), "docs", "historical-route-candidates.json");
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      outputPath,
      candidateCount: payload.candidates.length,
      opinionDiscoveryEnabled: Boolean(opinionApiKey),
      opinionCandidateCount: opinionMarkets.length
    })
  );
};

main().catch((error) => {
  console.error("Failed to generate historical route candidates.");
  console.error(error);
  process.exit(1);
});
