#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

import { historicalRouteCandidatesSchema } from "../src/simulation/historical-route-catalog-manifest.js";
import {
  buildSourceBackedHistoricalCandidate,
  historicalRouteDiscoverySeeds,
  type HistoricalRouteDiscoverySeed
} from "../src/simulation/historical-route-source-discovery.js";
import {
  canLooseMatchCategoryText,
  compareStructuredPropositions,
  parseStructuredProposition,
  type PropositionMatchCategory
} from "../src/simulation/proposition-matching.js";
import {
  buildSemanticsRulepackProvenance,
  DEFAULT_SEMANTICS_RULEPACK_VERSION
} from "../src/canonical/semantics-rulepack-versioning.js";
import { validateSemanticsRulepackCandidate } from "../src/canonical/semantics-rulepack-validator.js";
import { summarizeSemanticsRulepackMetrics } from "../src/canonical/semantics-rulepack-metrics.js";
import { PredexonHistoricalClient } from "../src/integrations/predexon/predexon-client.js";
import { LimitlessHistoricalClient } from "../src/integrations/limitless/limitless-client.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
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
const databaseUrl = process.env.DATABASE_URL;

if (!predexonApiKey) {
  throw new Error("PREDEXON_API_KEY is required.");
}

if (!limitlessApiKey) {
  throw new Error("LIMITLESS_API_KEY is required.");
}

interface ParsedArgs {
  opinionPageSize: number;
  opinionMaxPages: number;
}

interface OpinionDiscoveryMarket {
  marketId: string;
  title: string;
  rules: string | null;
  source: "openapi" | "db_inventory";
}

const parseArgs = (): ParsedArgs => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }

  const parsePositiveInt = (key: string, fallback: string): number => {
    const value = Number.parseInt(args.get(key) ?? fallback, 10);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer.`);
    }
    return value;
  };

  return {
    opinionPageSize: parsePositiveInt("opinionPageSize", "200"),
    opinionMaxPages: parsePositiveInt("opinionMaxPages", "10")
  };
};

const predexonClient = new PredexonHistoricalClient({
  baseUrl: predexonBaseUrl,
  apiKey: predexonApiKey
});

const limitlessClient = new LimitlessHistoricalClient({
  baseUrl: limitlessBaseUrl,
  apiKey: limitlessApiKey
});

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

const fetchOpinionMarketList = async (input: ParsedArgs): Promise<OpinionDiscoveryMarket[]> => {
  if (!opinionApiKey) {
    return [];
  }

  const seen = new Set<string>();
  const extracted: OpinionDiscoveryMarket[] = [];
  try {
    for (let page = 1; page <= input.opinionMaxPages; page += 1) {
      const response = await fetch(`${opinionBaseUrl}/market?page=${page}&limit=${input.opinionPageSize}`, {
        headers: {
          apikey: opinionApiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Opinion OpenAPI /market failed with HTTP ${response.status} on page ${page}.`);
      }

      const payload = await response.json() as Record<string, unknown>;
      const candidates = [
        ...(Array.isArray((payload.result as Record<string, unknown> | undefined)?.list)
          ? ((payload.result as Record<string, unknown>).list as unknown[])
          : []),
        ...(Array.isArray((payload.result as Record<string, unknown> | undefined)?.items)
          ? ((payload.result as Record<string, unknown>).items as unknown[])
          : []),
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

      let pageAdded = 0;
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
        const rules = typeof record.rules === "string"
          ? record.rules
          : typeof record.rule === "string"
            ? record.rule
            : typeof record.description === "string"
              ? record.description
              : null;

        if (!marketId || !title || seen.has(marketId)) {
          continue;
        }

        seen.add(marketId);
        extracted.push({ marketId, title, rules, source: "openapi" });
        pageAdded += 1;
      }

      if (pageAdded === 0 || candidates.length < input.opinionPageSize) {
        break;
      }
    }
  } catch (error) {
    console.warn("Opinion OpenAPI discovery failed; falling back to local Opinion inventory.", error);
    return [];
  }

  return extracted;
};

const loadOpinionMarketListFromDb = async (): Promise<OpinionDiscoveryMarket[]> => {
  if (!databaseUrl) {
    return [];
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "generate-historical-route-candidates-opinion-fallback"
  });

  try {
    const result = await pool.query<{
      venue_market_id: string;
      title: string;
      rules: string | null;
    }>(
      `SELECT DISTINCT ON (vmp.venue_market_id)
          vmp.venue_market_id,
          vmp.title,
          COALESCE(rp.primary_resolution_text, rp.supplemental_rules_text) AS rules
         FROM venue_market_profiles vmp
         LEFT JOIN resolution_profiles rp
           ON rp.venue = vmp.venue
          AND rp.venue_market_id = vmp.venue_market_id
        WHERE vmp.venue = 'OPINION'
          AND vmp.source_metadata_version = 'opinion-current-bootstrap-v1'
        ORDER BY vmp.venue_market_id, vmp.updated_at DESC`
    );

    return result.rows.map((row) => ({
      marketId: row.venue_market_id,
      title: row.title,
      rules: row.rules,
      source: "db_inventory"
    }));
  } finally {
    await pool.end();
  }
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

const buildSeedStructuredProposition = (seed: HistoricalRouteDiscoverySeed) =>
  parseStructuredProposition({
    category: seed.canonicalCategory as PropositionMatchCategory,
    title: [seed.title, ...(seed.opinionDiscovery?.expectedTitles ?? [])].join(" | "),
    rules: null,
    yesLabel: "Yes",
    noLabel: "No"
  });

const resolveOpinionExpansion = async (
  seed: HistoricalRouteDiscoverySeed,
  exclusions: ReadonlySet<string>,
  opinionMarkets: readonly OpinionDiscoveryMarket[]
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

  const structuredSeed = buildSeedStructuredProposition(seed);
  const window = buildOpinionWindow(seed);
  const semanticMatches: Array<{
    marketId: string;
    title: string;
    source: OpinionDiscoveryMarket["source"];
    semanticReason: string;
    evaluationId: string;
    finalConfidence: number;
  }> = [];
  const semanticMetricSamples: Parameters<typeof summarizeSemanticsRulepackMetrics>[0] = [];
  for (const market of opinionMarkets) {
    if (exclusions.has(market.marketId)) {
      continue;
    }

    const candidateText = `${market.title} ${market.rules ?? ""}`;
    if (!canLooseMatchCategoryText(seed.canonicalCategory as PropositionMatchCategory, candidateText)) {
      continue;
    }

    const candidateStructured = parseStructuredProposition({
      category: seed.canonicalCategory as PropositionMatchCategory,
      title: market.title,
      rules: market.rules,
      yesLabel: "Yes",
      noLabel: "No"
    });
    const semanticComparison = compareStructuredPropositions({
      seed: structuredSeed,
      candidate: candidateStructured,
      historyQualified: false,
      requireHistoricalQualification: false
    });
    const snapshots = await predexonClient.getOpinionOrderbookHistory({
      market_id: market.marketId,
      start_time: window.start,
      end_time: window.end,
      limit: 1
    });
    const historyQualified = snapshots.length > 0;
    const finalizedComparison = compareStructuredPropositions({
      seed: structuredSeed,
      candidate: candidateStructured,
      historyQualified,
      requireHistoricalQualification: true
    });
    const semanticProvenance = buildSemanticsRulepackProvenance({
      seed: structuredSeed,
      candidate: candidateStructured,
      comparison: finalizedComparison,
      semanticConfidenceContribution: 0,
      createdAt: new Date(window.start).toISOString(),
      replayLinkage: {
        parentDecisionType: "historical_route_candidate_discovery",
        parentDecisionId: seed.historicalCanonicalMarketId
      }
    });
    const semanticValidation = validateSemanticsRulepackCandidate({
      seed: structuredSeed,
      candidate: candidateStructured,
      comparison: finalizedComparison,
      provenance: semanticProvenance,
      baseConfidence: 0.55
    });
    semanticMetricSamples.push({
      validation: semanticValidation,
      provenance: semanticProvenance,
      compatibilityDecisionClass: null
    });

    if (
      finalizedComparison.classification !== "semantic_exact_historical_qualified"
      || semanticValidation.discoveryStatus !== "candidate_expanded"
    ) {
      continue;
    }

    semanticMatches.push({
      marketId: market.marketId,
      title: market.title,
      source: market.source,
      semanticReason: semanticValidation.semanticReasons[0] ?? "semantic_exact_historical_candidate",
      evaluationId: semanticProvenance.evaluationId,
      finalConfidence: semanticValidation.finalConfidence
    });
  }

  const metrics = summarizeSemanticsRulepackMetrics(semanticMetricSamples);
  const summaryObservation = `semantic rulepack ${DEFAULT_SEMANTICS_RULEPACK_VERSION} scanned ${semanticMetricSamples.length} Opinion candidates; safeDiscoveryLift=${metrics.safeDiscoveryLift}, blockedUnsafeExpansionRate=${metrics.blockedUnsafeExpansionRate}, lowConfidenceSemanticRate=${metrics.lowConfidenceSemanticRate}.`;

  if (semanticMatches.length === 1) {
    const match = semanticMatches[0]!;
    return {
      discoveredFrom: [
        ...discoveredFrom,
        {
          type: "semantic_validation" as const,
          reference: `${DEFAULT_SEMANTICS_RULEPACK_VERSION}:${match.evaluationId}`,
          observation: `${summaryObservation} Deterministic semantic exact survived live validation for Opinion market ${match.marketId} from ${match.source} with finalConfidence=${match.finalConfidence}.`
        },
        {
          type: "predexon_validation" as const,
          reference: `${predexonBaseUrl}/v2/opinion/orderbooks?market_id=${match.marketId}&start_time=${window.start}&end_time=${window.end}`,
          observation: `Predexon Opinion historical validation returned non-empty orderbook history for deterministic semantic exact market ${match.marketId}.`
        }
      ],
      venueProfiles: [
        {
          venue: "OPINION" as const,
          venueMarketId: match.marketId,
          title: match.title,
          historySource: "predexon_opinion" as const,
          historyWindow: {
            start: new Date(window.start).toISOString(),
            end: new Date(window.end).toISOString()
          }
        }
      ] as typeof seed.venueProfiles
    };
  }

  if (semanticMatches.length > 1) {
    return {
      discoveredFrom: [
        ...discoveredFrom,
        {
          type: "semantic_validation" as const,
          reference: `${DEFAULT_SEMANTICS_RULEPACK_VERSION}:ambiguous`,
          observation: `${summaryObservation} Multiple deterministic semantic exact Opinion candidates survived validation for ${seed.historicalCanonicalMarketId}; leaving expansion unresolved.`
        },
        {
          type: "predexon_validation" as const,
          reference: "semantic_exact_ambiguous",
          observation: `Multiple semantically exact Opinion markets survived validation for ${seed.historicalCanonicalMarketId}; leaving expansion unresolved.`
        }
      ],
      venueProfiles: [] as typeof seed.venueProfiles
    };
  }

  return {
    discoveredFrom: [
      ...discoveredFrom,
      {
        type: "semantic_validation" as const,
        reference: `${DEFAULT_SEMANTICS_RULEPACK_VERSION}:no_exact`,
        observation: summaryObservation
      }
    ],
    venueProfiles: [] as typeof seed.venueProfiles
  };
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
  const args = parseArgs();
  const opinionExclusions = readOpinionCurationExclusions();
  const opinionMarketsFromApi = await fetchOpinionMarketList(args);
  const opinionMarketsFromDb = opinionMarketsFromApi.length === 0 ? await loadOpinionMarketListFromDb() : [];
  const opinionMarkets = opinionMarketsFromApi.length > 0
    ? opinionMarketsFromApi
    : opinionMarketsFromDb;
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
      opinionCandidateCount: opinionMarkets.length,
      opinionCandidateSource: opinionMarketsFromApi.length > 0 ? "openapi" : opinionMarketsFromDb.length > 0 ? "db_inventory" : "none"
    })
  );
};

main().catch((error) => {
  console.error("Failed to generate historical route candidates.");
  console.error(error);
  process.exit(1);
});
