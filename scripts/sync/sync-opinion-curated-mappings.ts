#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { Pool } from "pg";
import { z } from "zod";

import { buildStableTextId } from "../../src/canonical/canonicalization-types.js";
import { CanonicalGraphProjector } from "../../src/canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../src/canonical/canonical-compatibility-projector.js";
import {
  CuratedCanonicalGraphSnapshotBuilder,
  type CuratedCanonicalGraphSeed
} from "../../src/canonical/curated-canonical-graph.js";
import { HistoricalMarketClass, type CreateHistoricalMarketStateInput } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { HistoricalMarketStateRepository } from "../../src/repositories/historical-market-state.repository.js";
import { opinionExactMatchCurationSchema } from "../../src/simulation/opinion-exact-match-curation.js";
import { CanonicalCompatibilityRepository } from "../../src/repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../../src/repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../../src/repositories/compatibility-version.repository.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const predexonApiKey = process.env.PREDEXON_API_KEY;
const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

if (!predexonApiKey) {
  throw new Error("PREDEXON_API_KEY is required.");
}

type CurationArtifactMode = "legacy" | "hybrid-four" | "all";

interface ParsedArgs {
  artifactMode: CurationArtifactMode;
}

interface SyncEntry {
  source: "legacy" | "hybrid-four";
  category: "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS";
  canonicalEventId: string;
  canonicalMarketId: string;
  venueMarketId: string;
  title: string;
  rules: string | null;
  labels: readonly string[];
  yesLabel: string | null;
  noLabel: string | null;
  quoteToken: string | null;
  chainId: string | null;
  questionId: string | null;
  createdAt: Date | null;
  cutoffAt: Date | null;
  resolvedAt: Date | null;
  evidenceReference: string;
  historicalWindow: { start: string; end: string } | null;
  historicalValidationRequired: boolean;
  historicalValidationPassed: boolean;
  classification: "semantic_exact_historical_qualified" | "semantic_exact_live_only";
}

interface ExistingCanonicalSeedRow {
  canonical_event_id: string;
  venue: "POLYMARKET" | "LIMITLESS" | "OPINION" | "MYRIAD" | "PREDICT";
  venue_market_id: string;
  title: string;
  description: string | null;
  market_type: string | null;
  market_class: string | null;
  outcomes: unknown;
  outcome_schema: unknown;
  topics: unknown;
  canonical_category: string | null;
  published_at: Date | null;
  expires_at: Date | null;
  resolves_at: Date | null;
  fees: unknown;
  fee_model: string | null;
  resolution_source: string | null;
  resolution_title: string | null;
  resolution_rules_text: string | null;
  network: string | null;
  chain: string | null;
  raw_source_payload: unknown;
  normalized_payload: unknown;
  mapping_lineage: unknown;
  confidence_score: string | null;
  source_metadata_version: string;
  normalized_resolution_authority_type: string | null;
  rule_text: string | null;
  source_hierarchy: unknown;
  dispute_window_hours: string | null;
  ambiguous_time_boundary: boolean | null;
  ambiguous_source_reference: boolean | null;
  ambiguous_jurisdiction_or_scope: boolean | null;
  settlement_type: string | null;
  settlement_lag_hours: string | null;
  finality_lag_hours: string | null;
  payout_timing_hours: string | null;
  fee_on_entry: boolean | null;
  fee_on_exit: boolean | null;
  time_sensitive_fee_behavior: string | null;
  requires_conservative_anchor: boolean | null;
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

  const artifactMode = (args.get("artifact") ?? "all") as CurationArtifactMode;
  if (!["legacy", "hybrid-four", "all"].includes(artifactMode)) {
    throw new Error(`Invalid --artifact mode: ${artifactMode}`);
  }

  return { artifactMode };
};

const legacyCurationPath = path.resolve(process.cwd(), "docs", "predexon-opinion-id-curation.json");
const hybridCurationPath = path.resolve(process.cwd(), "docs", "opinion-exact-match-curation.json");
const metadataVersion = process.env.PREDEXON_METADATA_VERSION ?? "predexon-v2";

const legacyCurationEntrySchema = z.object({
  resolutionProfileId: z.string().uuid(),
  canonicalEventId: z.string(),
  canonicalMarketId: z.string(),
  category: z.enum(["SPORTS", "CRYPTO", "POLITICS", "ESPORTS"]),
  crossVenueAssessment: z.object({
    status: z.enum(["exact", "inconsistent"])
  }),
  decision: z.object({
    status: z.enum(["accepted", "unresolved"]),
    reasonCode: z.string(),
    reason: z.string()
  }),
  acceptedCandidate: z.object({
    marketId: z.string(),
    title: z.string(),
    evidenceReference: z.string()
  }).optional()
});

const legacyCurationSchema = z.object({
  version: z.number().int().positive(),
  observedAt: z.string(),
  pairs: z.array(legacyCurationEntrySchema)
});

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const parseDateOrNull = (value: string | null | undefined): Date | null =>
  value ? new Date(value) : null;

const loadLegacyAcceptedEntries = (): readonly SyncEntry[] => {
  if (!existsSync(legacyCurationPath)) {
    return [];
  }
  const payload = legacyCurationSchema.parse(JSON.parse(readFileSync(legacyCurationPath, "utf8")));
  return payload.pairs.flatMap((entry) => {
    if (entry.decision.status !== "accepted" || !entry.acceptedCandidate || entry.crossVenueAssessment.status !== "exact") {
      return [];
    }
    return [{
      source: "legacy" as const,
      category: entry.category,
      canonicalEventId: entry.canonicalEventId,
      canonicalMarketId: entry.canonicalMarketId,
      venueMarketId: entry.acceptedCandidate.marketId,
      title: entry.acceptedCandidate.title,
      rules: null,
      labels: [entry.category],
      yesLabel: "Yes",
      noLabel: "No",
      quoteToken: null,
      chainId: "56",
      questionId: null,
      createdAt: null,
      cutoffAt: null,
      resolvedAt: null,
      evidenceReference: entry.acceptedCandidate.evidenceReference,
      historicalWindow: null,
      historicalValidationRequired: true,
      historicalValidationPassed: true,
      classification: "semantic_exact_historical_qualified"
    }];
  });
};

const loadHybridAcceptedEntries = (): readonly SyncEntry[] => {
  if (!existsSync(hybridCurationPath)) {
    return [];
  }
  const payload = opinionExactMatchCurationSchema.parse(JSON.parse(readFileSync(hybridCurationPath, "utf8")));
  return payload.entries.flatMap((entry) => {
    if (
      (entry.decision.status !== "semantic_exact_historical_qualified" && entry.decision.status !== "semantic_exact_live_only")
      || !entry.acceptedCandidate
    ) {
      return [];
    }
    return [{
      source: "hybrid-four" as const,
      category: entry.category,
      canonicalEventId: entry.selectedSeed.canonicalEventId,
      canonicalMarketId: entry.selectedSeed.canonicalMarketId,
      venueMarketId: entry.acceptedCandidate.marketId,
      title: entry.acceptedCandidate.title,
      rules: entry.acceptedCandidate.candidateSnapshot.rules,
      labels: entry.acceptedCandidate.candidateSnapshot.labels,
      yesLabel: entry.acceptedCandidate.candidateSnapshot.yesLabel,
      noLabel: entry.acceptedCandidate.candidateSnapshot.noLabel,
      quoteToken: entry.acceptedCandidate.candidateSnapshot.quoteToken,
      chainId: entry.acceptedCandidate.candidateSnapshot.chainId,
      questionId: entry.acceptedCandidate.candidateSnapshot.questionId,
      createdAt: parseDateOrNull(entry.acceptedCandidate.candidateSnapshot.createdAt),
      cutoffAt: parseDateOrNull(entry.acceptedCandidate.candidateSnapshot.cutoffAt),
      resolvedAt: parseDateOrNull(entry.acceptedCandidate.candidateSnapshot.resolvedAt),
      evidenceReference: entry.acceptedCandidate.evidenceReference,
      historicalWindow: entry.selectedSeed.historyWindow,
      historicalValidationRequired: entry.acceptedCandidate.historicalQualification.required,
      historicalValidationPassed: entry.acceptedCandidate.historicalQualification.passed,
      classification: entry.acceptedCandidate.classification
    }];
  });
};

const buildSyncEntries = (mode: CurationArtifactMode): readonly SyncEntry[] => {
  const entries = [
    ...(mode === "legacy" || mode === "all" ? loadLegacyAcceptedEntries() : []),
    ...(mode === "hybrid-four" || mode === "all" ? loadHybridAcceptedEntries() : [])
  ];

  const uniqueByVenueMarket = new Map<string, SyncEntry>();
  for (const entry of entries) {
    uniqueByVenueMarket.set(`${entry.canonicalMarketId}|${entry.venueMarketId}`, entry);
  }
  return [...uniqueByVenueMarket.values()];
};

const toOpinionCanonicalSeed = (entry: SyncEntry): CuratedCanonicalGraphSeed => ({
  canonicalEventId: entry.canonicalEventId,
  canonicalMarketId: entry.canonicalMarketId,
  canonicalCategory: entry.category,
  venue: "OPINION",
  venueMarketId: entry.venueMarketId,
  title: entry.title,
  description: entry.rules,
  marketType: "BINARY",
  marketClass: "BINARY",
  outcomes: [
    { id: "YES", label: entry.yesLabel ?? "Yes" },
    { id: "NO", label: entry.noLabel ?? "No" }
  ],
  outcomeSchema: {
    marketShape: "binary",
    yesLabel: entry.yesLabel ?? "Yes",
    noLabel: entry.noLabel ?? "No"
  },
  topics: [...entry.labels],
  publishedAt: entry.createdAt,
  expiresAt: entry.cutoffAt,
  resolvesAt: entry.resolvedAt,
  resolutionSource: "opinion_exact_match_curation",
  resolutionTitle: entry.title,
  resolutionRulesText: entry.rules,
  resolutionAuthorityType: "CENTRAL",
  settlementType: "onchain",
  network: entry.chainId === "56" ? "BNB_MAINNET" : null,
  chain: entry.chainId === "56" ? "BNB" : null,
  rawSourcePayload: {
    source: "sync-opinion-curated-mappings",
    evidenceReference: entry.evidenceReference,
    exactMatchClassification: entry.classification,
    historicalQualified: entry.classification === "semantic_exact_historical_qualified"
  },
  normalizedPayload: {
    marketId: entry.venueMarketId,
    questionId: entry.questionId,
    exactMatchClassification: entry.classification
  },
  mappingLineage: ["sync-opinion-curated-mappings", entry.source],
  sourceMetadataVersion: entry.source === "hybrid-four" ? "opinion-exact-match-curation-v1" : metadataVersion,
  propositionHints: {
    normalizedPropositionText: entry.rules ? `${entry.title} ${entry.rules}` : entry.title
  },
  executableDisplayName: entry.title,
  executableMetadata: {
    source: entry.source,
    exactMatchCuration: true,
    exactMatchClassification: entry.classification,
    historicalQualified: entry.classification === "semantic_exact_historical_qualified"
  }
});

const toSeedFromGraphRow = (row: ExistingCanonicalSeedRow, canonicalMarketId: string): CuratedCanonicalGraphSeed => ({
  canonicalEventId: row.canonical_event_id,
  canonicalMarketId,
  canonicalCategory: row.canonical_category ?? "OTHER",
  venue: row.venue,
  venueMarketId: row.venue_market_id,
  title: row.title,
  description: row.description,
  marketType: row.market_type,
  marketClass: row.market_class,
  outcomes: Array.isArray(row.outcomes) ? (row.outcomes as CuratedCanonicalGraphSeed["outcomes"]) : [],
  outcomeSchema: asRecord(row.outcome_schema),
  topics: asStringArray(row.topics),
  publishedAt: row.published_at,
  expiresAt: row.expires_at,
  resolvesAt: row.resolves_at,
  fees: asRecord(row.fees),
  feeModel: row.fee_model,
  resolutionSource: row.resolution_source,
  resolutionTitle: row.resolution_title,
  resolutionRulesText: row.resolution_rules_text ?? row.rule_text,
  resolutionAuthorityType: row.normalized_resolution_authority_type,
  sourceHierarchy: asRecord(row.source_hierarchy),
  disputeWindowHours: row.dispute_window_hours,
  ambiguousTimeBoundary: row.ambiguous_time_boundary ?? false,
  ambiguousSourceReference: row.ambiguous_source_reference ?? false,
  ambiguousJurisdictionOrScope: row.ambiguous_jurisdiction_or_scope ?? false,
  settlementType: row.settlement_type as CuratedCanonicalGraphSeed["settlementType"],
  settlementLagHours: row.settlement_lag_hours,
  finalityLagHours: row.finality_lag_hours,
  payoutTimingHours: row.payout_timing_hours,
  feeOnEntry: row.fee_on_entry ?? false,
  feeOnExit: row.fee_on_exit ?? false,
  timeSensitiveFeeBehavior: row.time_sensitive_fee_behavior,
  requiresConservativeAnchor: row.requires_conservative_anchor ?? false,
  network: row.network,
  chain: row.chain,
  rawSourcePayload: asRecord(row.raw_source_payload),
  normalizedPayload: asRecord(row.normalized_payload),
  mappingLineage: asStringArray(row.mapping_lineage),
  confidenceScore: row.confidence_score ?? undefined,
  sourceMetadataVersion: row.source_metadata_version
});

const loadExistingCanonicalMarketSeeds = async (
  pool: Pool,
  canonicalMarketId: string
): Promise<readonly CuratedCanonicalGraphSeed[]> => {
  const result = await pool.query<ExistingCanonicalSeedRow>(
    `SELECT
        vmp.canonical_event_id,
        vmp.venue,
        vmp.venue_market_id,
        vmp.title,
        vmp.description,
        vmp.market_type,
        vmp.market_class,
        vmp.outcomes,
        vmp.outcome_schema,
        vmp.topics,
        vmp.canonical_category,
        vmp.published_at,
        vmp.expires_at,
        vmp.resolves_at,
        vmp.fees,
        vmp.fee_model,
        vmp.resolution_source,
        vmp.resolution_title,
        vmp.resolution_rules_text,
        vmp.network,
        vmp.chain,
        vmp.raw_source_payload,
        vmp.normalized_payload,
        vmp.mapping_lineage,
        vmp.confidence_score,
        vmp.source_metadata_version,
        vrp.normalized_resolution_authority_type,
        vrp.rule_text,
        vrp.source_hierarchy,
        vrp.dispute_window_hours,
        vrp.ambiguous_time_boundary,
        vrp.ambiguous_source_reference,
        vrp.ambiguous_jurisdiction_or_scope,
        vsp.settlement_type,
        vsp.settlement_lag_hours,
        vsp.finality_lag_hours,
        vsp.payout_timing_hours,
        vsp.fee_on_entry,
        vsp.fee_on_exit,
        vsp.time_sensitive_fee_behavior,
        vsp.requires_conservative_anchor
       FROM canonical_executable_market_members members
       JOIN venue_market_profiles vmp
         ON vmp.id = members.venue_market_profile_id
       LEFT JOIN venue_resolution_profiles vrp
         ON vrp.venue_market_profile_id = vmp.id
       LEFT JOIN venue_settlement_profiles vsp
         ON vsp.venue_market_profile_id = vmp.id
      WHERE members.canonical_executable_market_id = $1
      ORDER BY vmp.venue, vmp.venue_market_id`,
    [canonicalMarketId]
  );

  return result.rows.map((row) => toSeedFromGraphRow(row, canonicalMarketId));
};

const cleanupStaleExecutableMembership = async (
  pool: Pool,
  venueMarketId: string,
  canonicalMarketId: string
): Promise<void> => {
  const profileId = buildStableTextId("vmp_", `OPINION:${venueMarketId}`);
  await pool.query(
    `DELETE FROM canonical_executable_market_members
      WHERE venue_market_profile_id = $1
        AND canonical_executable_market_id <> $2`,
    [profileId, canonicalMarketId]
  );
};

const remapCurrentStateRows = async (pool: Pool, entry: SyncEntry): Promise<void> => {
  await pool.query(
    `UPDATE historical_market_states
        SET canonical_event_id = $1,
            canonical_market_id = $2,
            canonical_category = $3
      WHERE venue = 'OPINION'
        AND venue_market_id = $4
        AND metadata_version = 'opinion-current-bootstrap-v1'`,
    [entry.canonicalEventId, entry.canonicalMarketId, entry.category, entry.venueMarketId]
  );
};

const validateHistoricalAcceptance = async (entry: SyncEntry): Promise<void> => {
  if (entry.historicalValidationRequired && !entry.historicalValidationPassed) {
    throw new Error(
      `Accepted Opinion exact-match ${entry.venueMarketId} for ${entry.canonicalMarketId} does not satisfy documented historical validation.`
    );
  }

  if (!entry.historicalValidationRequired) {
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const startSeconds = entry.historicalWindow
    ? Math.floor(new Date(entry.historicalWindow.start).getTime() / 1_000)
    : nowSeconds - 86_400;
  const endSeconds = entry.historicalWindow
    ? Math.floor(new Date(entry.historicalWindow.end).getTime() / 1_000)
    : nowSeconds;
  const url = new URL("/v2/opinion/orderbooks", predexonBaseUrl);
  url.searchParams.set("market_id", entry.venueMarketId);
  url.searchParams.set("start_time", String(startSeconds));
  url.searchParams.set("end_time", String(endSeconds));
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-api-key": predexonApiKey
    }
  });

  if (response.status !== 200) {
    throw new Error(
      `Predexon validation failed for ${entry.canonicalMarketId} candidate ${entry.venueMarketId}: ${response.status}.`
    );
  }
}

const runOpinionIngestion = (entry: SyncEntry): void => {
  if (!entry.historicalValidationRequired || entry.classification !== "semantic_exact_historical_qualified") {
    return;
  }

  const end = entry.historicalWindow ? new Date(entry.historicalWindow.end) : new Date();
  const start = entry.historicalWindow
    ? new Date(entry.historicalWindow.start)
    : new Date(end.getTime() - 10 * 24 * 60 * 60 * 1_000);
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    command,
    [
      "tsx",
      "scripts/backfill/ingest-predexon-mapped-historical.ts",
      "--venue=OPINION",
      "--mode=backfill",
      `--category=${entry.category.toLowerCase()}`,
      `--canonicalEventId=${entry.canonicalEventId}`,
      `--canonicalMarketId=${entry.canonicalMarketId}`,
      `--start=${start.toISOString()}`,
      `--end=${end.toISOString()}`
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    }
  );

  if (result.status !== 0) {
    throw new Error(`Opinion ingestion failed for ${entry.canonicalMarketId}.`);
  }
};

const toExactOverlapState = (entry: SyncEntry): CreateHistoricalMarketStateInput => {
  const timestamp = entry.cutoffAt ?? entry.createdAt ?? new Date();
  return {
    canonicalEventId: entry.canonicalEventId,
    canonicalMarketId: entry.canonicalMarketId,
    canonicalCategory: entry.category,
    venue: "OPINION",
    venueMarketId: entry.venueMarketId,
    marketClass: HistoricalMarketClass.BINARY,
    timestamp,
    midpoint: null,
    bestBid: null,
    bestAsk: null,
    spread: null,
    lastPrice: null,
    volume: null,
    openInterest: null,
    orderbookSnapshot: {
      source: "opinion_exact_overlap_projection",
      market_title: entry.title,
      labels: entry.labels,
      status: null,
      yesLabel: entry.yesLabel,
      noLabel: entry.noLabel,
      exactMatchClassification: entry.classification,
      historicalQualified: entry.classification === "semantic_exact_historical_qualified"
    },
    marketEvents: {
      source: "opinion_exact_overlap_projection",
      exactMatchClassification: entry.classification,
      historicalQualified: entry.classification === "semantic_exact_historical_qualified"
    },
    metadataVersion: "opinion-exact-overlap-v1",
    sourceTimestamp: timestamp
  };
};

const ensureOpinionInventoryRow = async (pool: Pool, entry: SyncEntry): Promise<void> => {
  const repository = new HistoricalMarketStateRepository(pool);
  await repository.insertManyIgnoreDuplicates([toExactOverlapState(entry)]);
};

const verifyHistoricalRows = async (pool: Pool, entry: SyncEntry): Promise<number> => {
  const verification = await pool.query<{ row_count: string }>(
    `SELECT COUNT(*)::text AS row_count
       FROM historical_market_states
      WHERE venue = 'OPINION'
        AND canonical_event_id = $1
        AND canonical_market_id = $2
        AND venue_market_id = $3`,
    [entry.canonicalEventId, entry.canonicalMarketId, entry.venueMarketId]
  );

  return Number.parseInt(verification.rows[0]?.row_count ?? "0", 10);
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const entries = buildSyncEntries(args.artifactMode);
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-opinion-curated-mappings"
  });
  const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(pool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(pool),
      new CompatibilityVersionRepository(pool)
    )
  );

  let updated = 0;
  let unresolved = 0;

  try {
    if (entries.length === 0) {
      console.log(JSON.stringify({
        updated,
        unresolved,
        artifactMode: args.artifactMode,
        legacyCurationPath,
        hybridCurationPath
      }));
      return;
    }

    for (const entry of entries) {
      await validateHistoricalAcceptance(entry);
      const existingSeeds = await loadExistingCanonicalMarketSeeds(pool, entry.canonicalMarketId);
      const mergedSeeds = new Map<string, CuratedCanonicalGraphSeed>();
      for (const seed of existingSeeds) {
        mergedSeeds.set(`${seed.venue}:${seed.venueMarketId}`, seed);
      }
      mergedSeeds.set(`OPINION:${entry.venueMarketId}`, toOpinionCanonicalSeed(entry));

      await projector.persistAndProject(snapshotBuilder.build([...mergedSeeds.values()]));
      await cleanupStaleExecutableMembership(pool, entry.venueMarketId, entry.canonicalMarketId);
      await remapCurrentStateRows(pool, entry);
      await ensureOpinionInventoryRow(pool, entry);
      runOpinionIngestion(entry);

      const rowCount = await verifyHistoricalRows(pool, entry);
      if (entry.classification === "semantic_exact_historical_qualified" && rowCount <= 0) {
        throw new Error(`No OPINION historical rows were inserted for ${entry.canonicalMarketId}.`);
      }

      updated += 1;
      console.log(JSON.stringify({
        status: "accepted",
        source: entry.source,
        classification: entry.classification,
        canonicalMarketId: entry.canonicalMarketId,
        venueMarketId: entry.venueMarketId,
        insertedRows: rowCount
      }));
    }

    console.log(JSON.stringify({
      updated,
      unresolved,
      artifactMode: args.artifactMode,
      legacyCurationPath,
      hybridCurationPath
    }));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync curated Opinion mappings.");
  console.error(error);
  process.exit(1);
});
