#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { historicalRouteCurationSchema } from "../../src/simulation/historical-route-catalog-manifest.js";
import {
  opinionExactMatchCurationSchema,
  selectHybridFourSeeds,
  toOpinionCandidateSnapshot,
  evaluateOpinionCandidate,
  buildAcceptedImpact,
  buildRejectedCandidate,
  shouldConsiderLooseCandidate,
  type OpinionLiveFallbackSeed,
  type HybridOpinionSeed,
  type OpinionExactMatchCurationEntry
} from "../../src/simulation/opinion-exact-match-curation.js";
import { DEFAULT_SEMANTICS_RULEPACK_VERSION } from "../../src/canonical/semantics-rulepack-versioning.js";
import { OpinionClient } from "../../src/integrations/opinion/opinion-client.js";
import { OpinionMarketAdapter } from "../../src/integrations/opinion/opinion-market-adapter.js";
import { PredexonHistoricalClient } from "../../src/integrations/predexon/predexon-client.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  pageSize: number;
  maxPages: number;
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
    pageSize: parsePositiveInt("pageSize", "100"),
    maxPages: parsePositiveInt("maxPages", "20")
  };
};

const databaseUrl = process.env.DATABASE_URL;
const opinionApiKey = process.env.OPINION_API_KEY;
const opinionBaseUrl = process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi";
const predexonApiKey = process.env.PREDEXON_API_KEY;
const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";
const outputPath = path.resolve(process.cwd(), "docs", "opinion-exact-match-curation.json");
const curationPath = path.resolve(process.cwd(), "docs", "historical-route-curation.json");
const metadataVersion = "opinion-exact-match-curation-v1";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

if (!opinionApiKey) {
  throw new Error("OPINION_API_KEY is required.");
}

if (!predexonApiKey) {
  throw new Error("PREDEXON_API_KEY is required.");
}

const loadHistoricalCuration = () =>
  historicalRouteCurationSchema.parse(JSON.parse(readFileSync(curationPath, "utf8")));

const fetchOpinionInventory = async (input: {
  pageSize: number;
  maxPages: number;
}) => {
  const adapter = new OpinionMarketAdapter({
    client: new OpinionClient({
      baseUrl: opinionBaseUrl,
      apiKey: opinionApiKey
    }),
    metadataVersion
  });

  const markets = [];
  for (let page = 1; page <= input.maxPages; page += 1) {
    const pageMarkets = await adapter.listMarkets({ page, limit: input.pageSize });
    if (pageMarkets.length === 0) {
      break;
    }
    markets.push(...pageMarkets);
    if (pageMarkets.length < input.pageSize) {
      break;
    }
  }

  return { adapter, markets };
};

const loadLiveOpinionFallbackSeeds = async (pool: Pool): Promise<readonly OpinionLiveFallbackSeed[]> => {
  const result = await pool.query<{
    canonical_category: string;
    canonical_event_id: string;
    canonical_market_id: string;
    title: string;
    venue_market_id: string;
  }>(
    `SELECT DISTINCT ON (vmp.canonical_category)
        vmp.canonical_category,
        rp.canonical_event_id,
        rp.canonical_market_id,
        vmp.title,
        vmp.venue_market_id
       FROM venue_market_profiles vmp
       JOIN resolution_profiles rp
         ON rp.venue = vmp.venue
        AND rp.venue_market_id = vmp.venue_market_id
      WHERE vmp.venue = 'OPINION'
        AND vmp.source_metadata_version = 'opinion-current-bootstrap-v1'
        AND vmp.canonical_category IN ('POLITICS', 'CRYPTO', 'SPORTS', 'ESPORTS')
      ORDER BY vmp.canonical_category, vmp.published_at DESC NULLS LAST, vmp.updated_at DESC`
  );

  return result.rows.map((row) => ({
    category: row.canonical_category as OpinionLiveFallbackSeed["category"],
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    title: row.title,
    venueMarketId: row.venue_market_id
  }));
};

const buildHistoryReference = (seed: HybridOpinionSeed, marketId: string): string | null => {
  if (seed.basis !== "historical" || !seed.historyWindow) {
    return null;
  }

  const url = new URL("/v2/opinion/orderbooks", predexonBaseUrl);
  url.searchParams.set("market_id", marketId);
  url.searchParams.set("start_time", String(new Date(seed.historyWindow.start).getTime()));
  url.searchParams.set("end_time", String(new Date(seed.historyWindow.end).getTime()));
  url.searchParams.set("limit", "1");
  return url.toString();
};

const validateHistoricalCoverage = async (
  client: PredexonHistoricalClient,
  seed: HybridOpinionSeed,
  marketId: string
): Promise<{ passed: boolean; reference: string | null; observation: string }> => {
  if (seed.basis !== "historical" || !seed.historyWindow) {
    return {
      passed: true,
      reference: null,
      observation: "Historical validation was not required because the selected hybrid seed is live."
    };
  }

  const reference = buildHistoryReference(seed, marketId);
  const snapshots = await client.getOpinionOrderbookHistory({
    market_id: marketId,
    start_time: new Date(seed.historyWindow.start).getTime(),
    end_time: new Date(seed.historyWindow.end).getTime(),
    limit: 1
  });

  return snapshots.length > 0
    ? {
        passed: true,
        reference,
        observation: `Predexon returned non-empty documented Opinion orderbook history for market ${marketId} in the selected historical seed window.`
      }
    : {
        passed: false,
        reference,
        observation: `Predexon returned no Opinion orderbook history for market ${marketId} in the selected historical seed window.`
      };
};

const buildCandidatePool = (
  seed: HybridOpinionSeed,
  candidates: readonly ReturnType<typeof toOpinionCandidateSnapshot>[]
) =>
  candidates
    .filter((candidate) => candidate.category === seed.category)
    .sort((left, right) =>
      left.marketId.localeCompare(right.marketId) || left.title.localeCompare(right.title)
    );

const buildEntry = async (input: {
  seed: HybridOpinionSeed;
  candidatePool: readonly ReturnType<typeof toOpinionCandidateSnapshot>[];
  predexonClient: PredexonHistoricalClient;
}): Promise<OpinionExactMatchCurationEntry> => {
  const searchedSources = [
    {
      type: "seed_selection" as const,
      reference: input.seed.seedReference,
      observation: `Hybrid seed selected on a ${input.seed.basis} basis for ${input.seed.category}.`
    },
    {
      type: "public_site" as const,
      reference: input.seed.publicReference,
      observation: "Opinion exact-match discovery uses the documented Opinion OpenAPI market list as the primary search surface."
    },
    {
      type: "opinion_openapi_market_list" as const,
      reference: `${opinionBaseUrl.replace(/\/$/, "")}/market`,
      observation: "Opinion candidate discovery scanned the documented /market listing surface."
    },
    ...input.seed.searchQueries.map((query) => ({
      type: "search_query" as const,
      reference: query,
      observation: "Seed-specific search query retained for auditability."
    }))
  ];

  const evaluations = [];
  for (const candidate of input.candidatePool) {
    if (!shouldConsiderLooseCandidate(input.seed, candidate)) {
      continue;
    }
    const historyValidation = await validateHistoricalCoverage(input.predexonClient, input.seed, candidate.marketId);
    const evaluation = evaluateOpinionCandidate({
        seed: input.seed,
        candidate,
        historyPassed: historyValidation.passed
      });
    evaluations.push(opinionExactMatchCurationSchema.shape.entries.element.shape.candidateEvaluations.element.parse({
      ...evaluation,
      historicalQualification: {
        required: evaluation.historicalQualification.required,
        passed: historyValidation.passed,
        reference: historyValidation.reference,
        observation: historyValidation.observation
      }
    }));
  }

  const rankedEvaluations = evaluations
    .sort((left, right) =>
      right.rankingScore - left.rankingScore
      || left.candidateSnapshot.marketId.localeCompare(right.candidateSnapshot.marketId)
    );
  const nearMissCandidates = rankedEvaluations.filter((entry) => entry.comparison.classification === "semantic_near_exact");
  const acceptedExacts = rankedEvaluations.filter((entry) =>
    entry.comparison.classification === "semantic_exact_historical_qualified"
    || entry.comparison.classification === "semantic_exact_live_only"
  );

  if (acceptedExacts.length === 1) {
    const accepted = acceptedExacts[0]!;
    if (accepted.historicalQualification.reference) {
      searchedSources.push({
        type: "predexon_validation",
        reference: accepted.historicalQualification.reference,
        observation: accepted.historicalQualification.observation
      });
    }

    return opinionExactMatchCurationSchema.shape.entries.element.parse({
      category: input.seed.category,
      selectedSeed: input.seed,
      decision: {
        status: accepted.comparison.classification,
        reasonCode: accepted.comparison.classification,
        reason: accepted.comparison.classification === "semantic_exact_historical_qualified"
          ? `Exactly one Opinion candidate satisfied the strict structured exact-match policy for ${input.seed.category} and has historical evidence.`
          : `Exactly one Opinion candidate satisfied the strict structured exact-match policy for ${input.seed.category}, but it is live-only because historical qualification is absent.`
      },
      searchedSources,
      candidateEvaluations: rankedEvaluations,
      nearMissCandidates,
      rejectedCandidates: rankedEvaluations
        .filter((entry) => entry.candidateSnapshot.marketId !== accepted.candidateSnapshot.marketId)
        .map((entry) => buildRejectedCandidate(entry)),
      acceptedCandidate: {
        marketId: accepted.candidateSnapshot.marketId,
        title: accepted.candidateSnapshot.title,
        classification: accepted.comparison.classification,
        evidenceReference: `${opinionBaseUrl.replace(/\/$/, "")}/market`,
        candidateSnapshot: accepted.candidateSnapshot,
        structuredProposition: accepted.structuredProposition,
        comparison: accepted.comparison,
        semanticProvenance: accepted.semanticProvenance,
        semanticValidation: accepted.semanticValidation,
        historicalQualification: accepted.historicalQualification,
        impact: buildAcceptedImpact({
          seed: input.seed,
          classification: accepted.comparison.classification
        })
      }
    });
  }

  if (acceptedExacts.length > 1) {
    return opinionExactMatchCurationSchema.shape.entries.element.parse({
      category: input.seed.category,
      selectedSeed: input.seed,
      decision: {
        status: "rejected_ambiguous",
        reasonCode: "multiple_exact_candidates",
        reason: `Multiple Opinion candidates satisfied the strict structured exact-match policy for ${input.seed.category}; manual review is required.`
      },
      searchedSources,
      candidateEvaluations: rankedEvaluations,
      nearMissCandidates,
      rejectedCandidates: acceptedExacts.map((entry) => ({
        marketId: entry.candidateSnapshot.marketId,
        title: entry.candidateSnapshot.title,
        classification: entry.comparison.classification,
        primaryFailureReason: "ambiguous_exact_match",
        failedDimensions: [],
        reasonCode: "ambiguous_exact_match",
        reason: "Candidate is exact enough to qualify but conflicts with another exact candidate."
      }))
    });
  }

  if (rankedEvaluations.length > 0) {
    const dominantClassification = nearMissCandidates.length > 0 ? "semantic_near_exact" : "proxy_or_mismatch";
    return opinionExactMatchCurationSchema.shape.entries.element.parse({
      category: input.seed.category,
      selectedSeed: input.seed,
      decision: {
        status: dominantClassification,
        reasonCode: dominantClassification === "semantic_near_exact" ? "structured_near_exact_candidates_found" : "only_proxy_or_mismatch_candidates_found",
        reason: dominantClassification === "semantic_near_exact"
          ? `Opinion candidates were found for ${input.seed.category}, but the best ones still fail one or more required structured dimensions.`
          : `Opinion candidates were found for ${input.seed.category}, but they are proxies or semantic mismatches rather than exact executable markets.`
      },
      searchedSources,
      candidateEvaluations: rankedEvaluations,
      nearMissCandidates,
      rejectedCandidates: rankedEvaluations.map((entry) => buildRejectedCandidate(entry))
    });
  }

  return opinionExactMatchCurationSchema.shape.entries.element.parse({
      category: input.seed.category,
      selectedSeed: input.seed,
      decision: {
        status: "unresolved_no_candidate",
        reasonCode: "no_candidate_in_opinion_inventory",
        reason: `No Opinion market in the scanned inventory produced even a loose candidate for ${input.seed.category}.`
      },
      searchedSources,
      candidateEvaluations: [],
      nearMissCandidates: [],
      rejectedCandidates: []
    });
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const curation = loadHistoricalCuration();
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "generate-opinion-exact-match-curation"
  });

  try {
    const liveOpinionSeeds = await loadLiveOpinionFallbackSeeds(pool);
    const selectedSeeds = selectHybridFourSeeds({
      curation,
      liveOpinionSeeds
    });
    const { adapter, markets } = await fetchOpinionInventory(args);
    const candidateSnapshots = markets.map((market) =>
      toOpinionCandidateSnapshot({
        marketId: market.venueMarketId,
        title: market.title,
        slug: market.slug,
        status: market.status,
        labels: market.labels,
        rules: market.rules,
        yesLabel: market.yesLabel,
        noLabel: market.noLabel,
        quoteToken: market.quoteToken,
        chainId: market.chainId,
        questionId: market.questionId,
        createdAt: market.createdAt,
        cutoffAt: market.cutoffAt,
        resolvedAt: market.resolvedAt,
        category: adapter.inferCanonicalCategory(market) as OpinionExactMatchCurationEntry["category"],
        metadataVersion: market.sourceMetadataVersion
      })
    );
    const predexonClient = new PredexonHistoricalClient({
      baseUrl: predexonBaseUrl,
      apiKey: predexonApiKey
    });
    const entries = [];
    for (const seed of selectedSeeds) {
      const candidatePool = buildCandidatePool(seed, candidateSnapshots);
      entries.push(await buildEntry({
        seed,
        candidatePool,
        predexonClient
      }));
    }

    const payload = opinionExactMatchCurationSchema.parse({
      version: 1,
      observedAt: new Date().toISOString(),
      policy: {
        matchRule: "structured_deterministic_dimension_match_only",
        autoAcceptRule: "auto_accept_only_single_structured_exact",
        historicalValidationRule: "semantic exacts without documented Predexon Opinion history are accepted as live-only exact overlap and remain blocked for historical pair or tri promotion",
        mutationRule: "only semantic_exact_historical_qualified and semantic_exact_live_only entries may be projected into canonicalization",
        semanticsRulepackVersion: DEFAULT_SEMANTICS_RULEPACK_VERSION
      },
      entries
    });

    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      outputPath,
      entryCount: payload.entries.length,
      acceptedCount: payload.entries.filter((entry) =>
        entry.decision.status === "semantic_exact_historical_qualified"
        || entry.decision.status === "semantic_exact_live_only"
      ).length,
      unresolvedCount: payload.entries.filter((entry) => entry.decision.status === "unresolved_no_candidate").length,
      rejectedCount: payload.entries.filter((entry) =>
        entry.decision.status !== "semantic_exact_historical_qualified"
        && entry.decision.status !== "semantic_exact_live_only"
        && entry.decision.status !== "unresolved_no_candidate"
      ).length,
      seedBasis: payload.entries.map((entry) => ({
        category: entry.category,
        basis: entry.selectedSeed.basis,
        canonicalMarketId: entry.selectedSeed.canonicalMarketId
      }))
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to generate targeted Opinion exact-match curation.");
  console.error(error);
  process.exit(1);
});
