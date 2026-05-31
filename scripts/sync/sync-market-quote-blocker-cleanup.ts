#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import { PredictClient, PredictClientError } from "../../src/integrations/predict/predict-client.js";
import { PredictMarketAdapter } from "../../src/integrations/predict/predict-market-adapter.js";
import type { PredictEnvironment, PredictNormalizedMarket } from "../../src/integrations/predict/predict-types.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  apply: boolean;
  lookbackMinutes: number;
  predictLimit: number;
  predictSearchLimit: number;
  predictTimeoutMs: number;
  predictEnvironment: PredictEnvironment;
  hidePredictVenueMarketIds: string[];
  hideFrontendCuratedKeys: string[];
}

interface HiddenPolymarketRow {
  canonical_event_id: string;
  canonical_market_id: string;
  display_title: string | null;
  proposition_key: string;
  blockers: unknown;
  latest_quote_at: Date | null;
}

interface PredictBlockedRow {
  profile_id: string;
  canonical_event_id: string;
  canonical_market_id: string | null;
  venue_market_id: string;
  title: string;
  event_title: string;
  proposition_key: string;
  normalized_payload: unknown;
  raw_source_payload: unknown;
  blockers: unknown;
  latest_quote_at: Date | null;
}

interface PredictRepairCandidate {
  profileId: string;
  canonicalEventId: string;
  canonicalMarketId: string | null;
  title: string;
  currentVenueMarketId: string;
  blockers: string[];
  status: "UPDATED" | "PLANNED" | "NEEDS_OPERATOR_LINK" | "HIDDEN" | "SKIPPED";
  reason: string;
  candidate: {
    venueMarketId: string;
    title: string;
    status: string | null;
    closesAt: string | null;
    tokenIds: string[];
    quoteOutcomeTokenIds: { YES: string; NO: string } | null;
  } | null;
  linkHints: {
    currentNumericMarketId: string | null;
    storedVenueMarketId: string;
    searchTerm: string;
    requestedVenueUrl: string | null;
  };
}

interface CleanupArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  mode: "DRY_RUN" | "APPLY";
  lookbackMinutes: number;
  summary: {
    polymarketEventsHiddenOrPlanned: number;
    predictRowsScanned: number;
    predictRowsUpdatedOrPlanned: number;
    predictRowsNeedingOperatorLinks: number;
    predictRowsHiddenOrPlanned: number;
    operatorConfirmedEventsHiddenOrPlanned: number;
  };
  safety: {
    hidesFrontendApprovalOnly: true;
    predictRepairsRequireSingleActiveExactCandidate: true;
    noVenueExecutionChanges: true;
    noSecretsOrRawPayloadsInArtifact: true;
  };
  polymarketClosedEvents: Array<{
    canonicalEventId: string;
    canonicalMarketId: string;
    displayTitle: string | null;
    propositionKey: string;
    blockers: string[];
    latestQuoteAt: string | null;
  }>;
  predictRepairCandidates: PredictRepairCandidate[];
}

const args = parseArgs();
const generatedAt = new Date().toISOString();
const artifactDir = path.join(process.cwd(), "artifacts", "shared", "optional");
const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL or DATABASE_URL is required.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  application_name: "sync-market-quote-blocker-cleanup",
  ...(requiresSsl(databaseUrl) ? { ssl: { rejectUnauthorized: false } } : {})
});

try {
  const [polymarketRows, predictRows] = await Promise.all([
    listAllBlockedPolymarketClosedRows(pool, args.lookbackMinutes),
    listPredictBlockedRows(pool, args.lookbackMinutes, args.predictLimit)
  ]);

  const predictRepairs = await buildPredictRepairCandidates(predictRows);

  if (args.apply) {
    await pool.query("BEGIN");
    try {
      await hidePolymarketClosedEvents(pool, polymarketRows);
      await deleteSnapshotsForPolymarketClosedEvents(pool, polymarketRows);
      await hideOperatorConfirmedEvents(pool, args.hideFrontendCuratedKeys);
      await hidePredictNonRepairableRows(pool, predictRepairs);
      await applyPredictRepairs(pool, predictRepairs);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  const artifact: CleanupArtifact = {
    artifactSchemaVersion: 1,
    generatedAt,
    mode: args.apply ? "APPLY" : "DRY_RUN",
    lookbackMinutes: args.lookbackMinutes,
    summary: {
      polymarketEventsHiddenOrPlanned: polymarketRows.length,
      predictRowsScanned: predictRows.length,
      predictRowsUpdatedOrPlanned: predictRepairs.filter((row) => row.status === "PLANNED" || row.status === "UPDATED").length,
      predictRowsNeedingOperatorLinks: predictRepairs.filter((row) => row.status === "NEEDS_OPERATOR_LINK").length,
      predictRowsHiddenOrPlanned: predictRepairs.filter((row) => row.status === "HIDDEN").length,
      operatorConfirmedEventsHiddenOrPlanned: args.hideFrontendCuratedKeys.length
    },
    safety: {
      hidesFrontendApprovalOnly: true,
      predictRepairsRequireSingleActiveExactCandidate: true,
      noVenueExecutionChanges: true,
      noSecretsOrRawPayloadsInArtifact: true
    },
    polymarketClosedEvents: polymarketRows.map((row) => ({
      canonicalEventId: row.canonical_event_id,
      canonicalMarketId: row.canonical_market_id,
      displayTitle: row.display_title,
      propositionKey: row.proposition_key,
      blockers: parseStringArray(row.blockers),
      latestQuoteAt: row.latest_quote_at?.toISOString() ?? null
    })),
    predictRepairCandidates: predictRepairs
  };

  await writeArtifacts(artifact);
  console.log(`Market quote blocker cleanup: ${artifact.mode}`);
  console.log(`polymarketEventsHiddenOrPlanned=${artifact.summary.polymarketEventsHiddenOrPlanned}`);
  console.log(`predictRowsScanned=${artifact.summary.predictRowsScanned}`);
  console.log(`predictRowsUpdatedOrPlanned=${artifact.summary.predictRowsUpdatedOrPlanned}`);
  console.log(`predictRowsNeedingOperatorLinks=${artifact.summary.predictRowsNeedingOperatorLinks}`);
  console.log(`predictRowsHiddenOrPlanned=${artifact.summary.predictRowsHiddenOrPlanned}`);
  console.log(`operatorConfirmedEventsHiddenOrPlanned=${artifact.summary.operatorConfirmedEventsHiddenOrPlanned}`);
} finally {
  await pool.end();
}

function parseArgs(): ParsedArgs {
  const values = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    if (!raw.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = raw.slice(2).split("=");
    values.set(key, rest.join("=") || "true");
  }
  const lookbackMinutes = Number.parseInt(values.get("lookbackMinutes") ?? "60", 10);
  const predictLimit = Number.parseInt(values.get("predictLimit") ?? "200", 10);
  const predictSearchLimit = Number.parseInt(values.get("predictSearchLimit") ?? "20", 10);
  const predictTimeoutMs = Number.parseInt(values.get("predictTimeoutMs") ?? "8_000".replace("_", ""), 10);
  const predictEnvironment = (values.get("predictEnvironment") ?? "mainnet") as PredictEnvironment;
  const hidePredictVenueMarketIds = parseCsv(values.get("hidePredictVenueMarketIds"));
  const hideFrontendCuratedKeys = parseCsv(values.get("hideFrontendCuratedKeys"));
  if (!Number.isFinite(lookbackMinutes) || lookbackMinutes <= 0) {
    throw new Error("lookbackMinutes must be a positive integer.");
  }
  if (!Number.isFinite(predictLimit) || predictLimit <= 0) {
    throw new Error("predictLimit must be a positive integer.");
  }
  if (!Number.isFinite(predictSearchLimit) || predictSearchLimit < 0) {
    throw new Error("predictSearchLimit must be zero or a positive integer.");
  }
  if (!Number.isFinite(predictTimeoutMs) || predictTimeoutMs <= 0) {
    throw new Error("predictTimeoutMs must be a positive integer.");
  }
  if (predictEnvironment !== "mainnet" && predictEnvironment !== "testnet") {
    throw new Error("predictEnvironment must be mainnet or testnet.");
  }
  return {
    apply: values.get("apply") === "true",
    lookbackMinutes,
    predictLimit,
    predictSearchLimit,
    predictTimeoutMs,
    predictEnvironment,
    hidePredictVenueMarketIds,
    hideFrontendCuratedKeys
  };
}

function requiresSsl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.hostname.includes("supabase.") || url.hostname.includes("pooler.supabase.com") || url.searchParams.has("sslmode");
  } catch {
    return false;
  }
}

async function listAllBlockedPolymarketClosedRows(db: Pool, lookbackMinutes: number): Promise<HiddenPolymarketRow[]> {
  const result = await db.query<HiddenPolymarketRow>(
    `WITH recent AS (
       SELECT canonical_event_id,
              canonical_market_id,
              venue,
              received_at,
              COALESCE(jsonb_array_length(blockers), 0) = 0
                AND COALESCE(midpoint, best_bid, best_ask) IS NOT NULL AS display_ready,
              blockers
         FROM venue_orderbook_latest_snapshots
        WHERE received_at >= now() - ($1::int * interval '1 minute')
     ),
     rolled AS (
       SELECT canonical_event_id,
              canonical_market_id,
              COUNT(*) FILTER (WHERE display_ready) AS ready_count,
              BOOL_OR(
                venue = 'POLYMARKET'
                AND EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements_text(blockers) blocker(value)
                   WHERE blocker.value ILIKE '%POLYMARKET_OFFICIAL_MARKET_CLOSED%'
                     AND blocker.value ILIKE '%POLYMARKET_OFFICIAL_MARKET_NOT_ACCEPTING_ORDERS%'
                )
              ) AS polymarket_closed,
              jsonb_agg(DISTINCT jsonb_build_object('venue', venue, 'blockers', blockers)) AS blockers,
              MAX(received_at) AS latest_quote_at
         FROM recent
        GROUP BY canonical_event_id, canonical_market_id
     )
     SELECT DISTINCT ON (rolled.canonical_event_id)
            rolled.canonical_event_id,
            rolled.canonical_market_id,
            fma.display_title,
            ce.proposition_key,
            rolled.blockers,
            rolled.latest_quote_at
       FROM rolled
       JOIN canonical_events ce
         ON ce.id::text = rolled.canonical_event_id
       JOIN frontend_market_approvals fma
         ON fma.canonical_event_id = ce.id
        AND fma.status = 'APPROVED'
        AND fma.metadata->>'source' = 'frontend-curated-catalog'
      WHERE rolled.ready_count = 0
        AND rolled.polymarket_closed
      ORDER BY rolled.canonical_event_id, rolled.latest_quote_at DESC`,
    [lookbackMinutes]
  );
  return result.rows;
}

async function listPredictBlockedRows(db: Pool, lookbackMinutes: number, limit: number): Promise<PredictBlockedRow[]> {
  const result = await db.query<PredictBlockedRow>(
    `WITH recent_predict_blockers AS (
       SELECT canonical_market_id,
              venue_market_id,
              jsonb_agg(DISTINCT blocker.value) AS blockers,
              MAX(received_at) AS latest_quote_at
         FROM venue_orderbook_latest_snapshots
         CROSS JOIN LATERAL jsonb_array_elements_text(blockers) AS blocker(value)
        WHERE venue IN ('PREDICT', 'PREDICT_FUN')
          AND received_at >= now() - ($1::int * interval '1 minute')
          AND (
            blockers ? 'QUOTE_PROVIDER_HTTP_404'
            OR blockers ? 'QUOTE_PROVIDER_HTTP_400'
            OR blockers ? 'PREDICT_FUN_TOKEN_ID_MISSING'
          )
        GROUP BY canonical_market_id, venue_market_id
     )
     SELECT vmp.id AS profile_id,
            vmp.canonical_event_id::text,
            cem.id AS canonical_market_id,
            vmp.venue_market_id,
            vmp.title,
            ce.title AS event_title,
            ce.proposition_key,
            vmp.normalized_payload,
            vmp.raw_source_payload,
            recent_predict_blockers.blockers,
            recent_predict_blockers.latest_quote_at
       FROM recent_predict_blockers
       JOIN venue_market_profiles vmp
         ON vmp.venue IN ('PREDICT', 'PREDICT_FUN')
       AND (
          vmp.venue_market_id = recent_predict_blockers.venue_market_id
          OR vmp.venue_market_id = replace(recent_predict_blockers.venue_market_id, 'PREDICT:', '')
          OR regexp_replace(vmp.venue_market_id, '^PREDICT:?([0-9]+).*$','\\1') = recent_predict_blockers.venue_market_id
        )
       JOIN canonical_events ce
         ON ce.id = vmp.canonical_event_id
       LEFT JOIN canonical_executable_market_members mem
         ON mem.venue_market_profile_id = vmp.id
       LEFT JOIN canonical_executable_markets cem
         ON cem.id = mem.canonical_executable_market_id
      ORDER BY recent_predict_blockers.latest_quote_at DESC
      LIMIT $2`,
    [lookbackMinutes, limit]
  );
  return [...new Map(result.rows.map((row) => [row.profile_id, row])).values()];
}

async function buildPredictRepairCandidates(rows: readonly PredictBlockedRow[]): Promise<PredictRepairCandidate[]> {
  const apiKey = process.env.PREDICT_API_KEY;
  if (!apiKey) {
    return rows.map((row) => ({
      profileId: row.profile_id,
      canonicalEventId: row.canonical_event_id,
      canonicalMarketId: row.canonical_market_id,
      title: row.title,
      currentVenueMarketId: row.venue_market_id,
      blockers: parseStringArray(row.blockers),
      status: "NEEDS_OPERATOR_LINK",
      reason: "PREDICT_API_KEY_MISSING",
      candidate: null,
      linkHints: buildPredictLinkHints(row)
    }));
  }

  const client = new PredictClient({
    environment: args.predictEnvironment,
    apiKey,
    fetchImpl: fetchWithTimeout(args.predictTimeoutMs),
    retry: { maxRetries: 0 }
  });
  const adapter = new PredictMarketAdapter({
    client,
    environment: args.predictEnvironment,
    metadataVersion: "predict-market-quote-blocker-cleanup-v1"
  });

  const results: PredictRepairCandidate[] = [];
  let searchedRows = 0;
  for (const row of rows) {
    if (args.hidePredictVenueMarketIds.some((id) => samePredictVenueMarketId(id, row.venue_market_id))) {
      results.push(toPredictUnresolved(row, "PREDICT_OPERATOR_CONFIRMED_NON_REPAIRABLE"));
      continue;
    }
    const currentId = extractNumericMarketId(row.venue_market_id);
    if (currentId) {
      try {
        const current = await adapter.getMarketById(currentId);
        if (isActivePredictMarket(current) && hasExecutablePredictToken(current)) {
          results.push(toPredictRepair(row, current, args.apply ? "UPDATED" : "PLANNED", "CURRENT_MARKET_ID_RECOVERED"));
          continue;
        }
      } catch (error) {
        if (!(error instanceof PredictClientError && (error.status === 400 || error.status === 404))) {
          results.push(toPredictUnresolved(row, `CURRENT_MARKET_LOOKUP_FAILED_${error instanceof PredictClientError ? error.status ?? "NETWORK" : "UNKNOWN"}`));
          continue;
        }
      }
    }

    if (searchedRows >= args.predictSearchLimit) {
      results.push(toPredictUnresolved(row, "PREDICT_OPERATOR_LINK_REQUIRED_SEARCH_LIMIT_REACHED"));
      continue;
    }
    searchedRows += 1;
    const candidates = await findPredictCandidates(client, adapter, row);
    if (candidates.length === 1) {
      results.push(toPredictRepair(row, candidates[0]!, args.apply ? "UPDATED" : "PLANNED", "SINGLE_ACTIVE_EXACT_TITLE_MATCH"));
      continue;
    }
    results.push(toPredictUnresolved(row, candidates.length === 0 ? "NO_ACTIVE_EXACT_TITLE_MATCH" : "AMBIGUOUS_ACTIVE_EXACT_TITLE_MATCH"));
  }
  return results;
}

async function findPredictCandidates(
  client: PredictClient,
  adapter: PredictMarketAdapter,
  row: PredictBlockedRow
): Promise<PredictNormalizedMarket[]> {
  const searchTerms = [...new Set([
    row.title,
    row.event_title,
    row.proposition_key
      .replace(/FRONTEND_CURATED:/i, "")
      .replace(/[|_:]+/g, " ")
  ].map((value) => value.trim()).filter(Boolean))];
  const normalizedTargets = new Set(searchTerms.map(normalizeTextForMatch));
  const candidates = new Map<string, PredictNormalizedMarket>();
  for (const search of searchTerms.slice(0, 3)) {
    try {
      const listed = await client.getMarkets({ search, limit: 20 });
      for (const item of listed) {
        const raw = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
        const id = String(raw.id ?? "");
        if (!id) {
          continue;
        }
        try {
          const market = await adapter.getMarketById(id);
          if (
            isActivePredictMarket(market) &&
            hasExecutablePredictToken(market) &&
            normalizedTargets.has(normalizeTextForMatch(market.title))
          ) {
            candidates.set(market.venueMarketId, market);
          }
        } catch {
          // Candidate hydration is best-effort; unresolved rows stay operator-visible.
        }
      }
    } catch {
      // Search failures should not abort the cleanup. The row remains unresolved.
    }
  }
  return [...candidates.values()];
}

async function hidePolymarketClosedEvents(db: Pool, rows: readonly HiddenPolymarketRow[]): Promise<void> {
  for (const row of rows) {
    await db.query(
      `UPDATE frontend_market_approvals
          SET status = 'HIDDEN',
              approval_reason = 'hidden because all recent quote-ready venues are blocked and Polymarket official source is closed/not accepting orders',
              metadata = metadata || $2::jsonb,
              updated_at = now()
        WHERE canonical_event_id = $1::uuid
          AND status = 'APPROVED'
          AND metadata->>'source' = 'frontend-curated-catalog'`,
      [
        row.canonical_event_id,
        JSON.stringify({
          hiddenBy: "sync-market-quote-blocker-cleanup",
          hiddenAt: generatedAt,
          hiddenReason: "POLYMARKET_OFFICIAL_MARKET_CLOSED_ALL_VENUES_BLOCKED",
          latestQuoteAt: row.latest_quote_at?.toISOString() ?? null
        })
      ]
    );
  }
}

async function deleteSnapshotsForPolymarketClosedEvents(db: Pool, rows: readonly HiddenPolymarketRow[]): Promise<void> {
  const eventIds = [...new Set(rows.map((row) => row.canonical_event_id))];
  if (eventIds.length === 0) {
    return;
  }
  await db.query(
    `DELETE FROM venue_orderbook_latest_snapshots
      WHERE canonical_event_id = ANY($1::text[])`,
    [eventIds]
  );
  await db.query(
    `DELETE FROM venue_orderbook_snapshots
      WHERE canonical_event_id = ANY($1::text[])`,
    [eventIds]
  );
}

async function applyPredictRepairs(db: Pool, rows: readonly PredictRepairCandidate[]): Promise<void> {
  for (const row of rows) {
    if (row.status !== "UPDATED" || !row.candidate) {
      continue;
    }
    await db.query(
      `UPDATE venue_market_profiles
          SET venue_market_id = $2,
              normalized_payload = normalized_payload || $3::jsonb,
              raw_source_payload = raw_source_payload || $4::jsonb,
              mapping_lineage = (
                SELECT jsonb_agg(DISTINCT value)
                  FROM jsonb_array_elements(mapping_lineage || '["predict-market-quote-blocker-cleanup"]'::jsonb)
              ),
              updated_at = now()
        WHERE id = $1`,
      [
        row.profileId,
        row.candidate.venueMarketId,
        JSON.stringify({
          marketId: row.candidate.venueMarketId,
          quoteMarketId: row.candidate.venueMarketId,
          quoteOutcomeTokenIds: row.candidate.quoteOutcomeTokenIds,
          quoteSource: "predict_openapi_market_detail",
          quoteRepairSource: "predict_openapi_market_search",
          quoteRepairedAt: generatedAt,
          quoteRepairPreviousVenueMarketId: row.currentVenueMarketId
        }),
        JSON.stringify({
          quoteRepairEvidence: {
            source: "predict_openapi_market_search",
            marketId: row.candidate.venueMarketId,
            title: row.candidate.title,
            status: row.candidate.status,
            checkedAt: generatedAt
          }
        })
      ]
    );
  }
}

async function hidePredictNonRepairableRows(db: Pool, rows: readonly PredictRepairCandidate[]): Promise<void> {
  const rowsToHide = rows.filter((row) =>
    row.status === "HIDDEN" &&
    args.hidePredictVenueMarketIds.some((id) => samePredictVenueMarketId(id, row.currentVenueMarketId))
  );
  for (const row of rowsToHide) {
    await db.query(
      `UPDATE frontend_market_approvals
          SET status = 'HIDDEN',
              approval_reason = 'hidden because operator confirmed the linked Predict market is inactive or does not contain the curated outcome',
              metadata = metadata || $2::jsonb,
              updated_at = now()
        WHERE canonical_event_id = $1::uuid
          AND status = 'APPROVED'
          AND metadata->>'source' = 'frontend-curated-catalog'`,
      [
        row.canonicalEventId,
        JSON.stringify({
          hiddenBy: "sync-market-quote-blocker-cleanup",
          hiddenAt: generatedAt,
          hiddenReason: "PREDICT_OPERATOR_CONFIRMED_NON_REPAIRABLE",
          currentVenueMarketId: row.currentVenueMarketId,
          latestBlockers: row.blockers
        })
      ]
    );
    await db.query(
      `DELETE FROM venue_orderbook_latest_snapshots
        WHERE venue IN ('PREDICT', 'PREDICT_FUN')
          AND (
            venue_market_id = $1
            OR venue_market_id = regexp_replace($1, '^PREDICT:?([0-9]+).*$', '\\1')
          )`,
      [row.currentVenueMarketId]
    );
    await db.query(
      `DELETE FROM venue_orderbook_snapshots
        WHERE venue IN ('PREDICT', 'PREDICT_FUN')
          AND (
            venue_market_id = $1
            OR venue_market_id = regexp_replace($1, '^PREDICT:?([0-9]+).*$', '\\1')
          )`,
      [row.currentVenueMarketId]
    );
  }
}

async function hideOperatorConfirmedEvents(db: Pool, curatedKeys: readonly string[]): Promise<void> {
  const keys = [...new Set(curatedKeys.map((key) => key.trim()).filter(Boolean))];
  if (keys.length === 0) {
    return;
  }
  await db.query(
    `UPDATE frontend_market_approvals
        SET status = 'HIDDEN',
            approval_reason = 'hidden because operator confirmed the linked venue market is inactive or does not contain the curated outcome',
            metadata = metadata || $2::jsonb,
            updated_at = now()
      WHERE status = 'APPROVED'
        AND metadata->>'source' = 'frontend-curated-catalog'
        AND metadata->>'curatedKey' = ANY($1::text[])`,
    [
      keys,
      JSON.stringify({
        hiddenBy: "sync-market-quote-blocker-cleanup",
        hiddenAt: generatedAt,
        hiddenReason: "OPERATOR_CONFIRMED_NON_REPAIRABLE"
      })
    ]
  );
  await db.query(
    `DELETE FROM venue_orderbook_latest_snapshots
      WHERE canonical_event_id IN (
        SELECT canonical_event_id::text
          FROM frontend_market_approvals
         WHERE metadata->>'curatedKey' = ANY($1::text[])
      )`,
    [keys]
  );
  await db.query(
    `DELETE FROM venue_orderbook_snapshots
      WHERE canonical_event_id IN (
        SELECT canonical_event_id::text
          FROM frontend_market_approvals
         WHERE metadata->>'curatedKey' = ANY($1::text[])
      )`,
    [keys]
  );
}

function toPredictRepair(
  row: PredictBlockedRow,
  market: PredictNormalizedMarket,
  status: "PLANNED" | "UPDATED",
  reason: string
): PredictRepairCandidate {
  return {
    profileId: row.profile_id,
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    title: row.title,
    currentVenueMarketId: row.venue_market_id,
    blockers: parseStringArray(row.blockers),
    status,
    reason,
    candidate: {
      venueMarketId: market.venueMarketId,
      title: market.title,
      status: market.status,
      closesAt: market.closesAt?.toISOString() ?? null,
      tokenIds: extractPredictTokenIds(market),
      quoteOutcomeTokenIds: extractPredictOutcomeTokenIds(market)
    },
    linkHints: buildPredictLinkHints(row)
  };
}

function toPredictUnresolved(row: PredictBlockedRow, reason: string): PredictRepairCandidate {
  const shouldHide = args.hidePredictVenueMarketIds.some((id) => samePredictVenueMarketId(id, row.venue_market_id));
  return {
    profileId: row.profile_id,
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    title: row.title,
    currentVenueMarketId: row.venue_market_id,
    blockers: parseStringArray(row.blockers),
    status: shouldHide ? "HIDDEN" : "NEEDS_OPERATOR_LINK",
    reason: shouldHide ? `PREDICT_OPERATOR_CONFIRMED_NON_REPAIRABLE:${reason}` : reason,
    candidate: null,
    linkHints: buildPredictLinkHints(row)
  };
}

function samePredictVenueMarketId(left: string, right: string): boolean {
  const leftTrimmed = left.trim();
  const rightTrimmed = right.trim();
  if (leftTrimmed.toUpperCase() === rightTrimmed.toUpperCase()) {
    return true;
  }
  const leftNumeric = extractNumericMarketId(leftTrimmed);
  const rightNumeric = extractNumericMarketId(rightTrimmed);
  return leftNumeric !== null && leftNumeric === rightNumeric;
}

function buildPredictLinkHints(row: PredictBlockedRow): PredictRepairCandidate["linkHints"] {
  return {
    currentNumericMarketId: extractNumericMarketId(row.venue_market_id),
    storedVenueMarketId: row.venue_market_id,
    searchTerm: row.title || row.event_title || row.proposition_key,
    requestedVenueUrl: null
  };
}

function isActivePredictMarket(market: PredictNormalizedMarket): boolean {
  const status = market.status?.trim().toUpperCase() ?? "";
  return !["CLOSED", "RESOLVED", "CANCELLED", "CANCELED", "EXPIRED", "INACTIVE"].includes(status);
}

function hasExecutablePredictToken(market: PredictNormalizedMarket): boolean {
  return extractPredictOutcomeTokenIds(market) !== null || extractPredictTokenIds(market).length > 0;
}

function extractPredictTokenIds(market: PredictNormalizedMarket): string[] {
  return [...new Set([
    market.tokenId,
    ...market.outcomes.map((outcome) => outcome.tokenId)
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function extractPredictOutcomeTokenIds(market: PredictNormalizedMarket): { YES: string; NO: string } | null {
  const byLabel = new Map<string, string>();
  for (const outcome of market.outcomes) {
    const label = outcome.label.trim().toUpperCase();
    const token = outcome.tokenId?.trim();
    if ((label === "YES" || label === "NO") && token) {
      byLabel.set(label, token);
    }
  }
  const yes = byLabel.get("YES");
  const no = byLabel.get("NO");
  return yes && no ? { YES: yes, NO: no } : null;
}

function extractNumericMarketId(value: string): string | null {
  const exact = value.trim().match(/^\d+$/);
  if (exact) {
    return exact[0];
  }
  const prefixed = value.trim().match(/^PREDICT:?(\d+)/i);
  return prefixed?.[1] ?? null;
}

function fetchWithTimeout(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        signal: init?.signal ?? controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

function normalizeTextForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => typeof item === "string" ? [item] : parseStringArray(item)))].sort();
  }
  if (value !== null && typeof value === "object") {
    return [...new Set(Object.values(value as Record<string, unknown>).flatMap(parseStringArray))].sort();
  }
  return [];
}

function parseCsv(value: string | undefined): string[] {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

async function writeArtifacts(artifact: CleanupArtifact): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "market-quote-blocker-cleanup-latest.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(artifactDir, "market-quote-blocker-cleanup-latest.md"),
    renderMarkdown(artifact),
    "utf8"
  );
}

function renderMarkdown(artifact: CleanupArtifact): string {
  return [
    "# Market Quote Blocker Cleanup",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Mode: ${artifact.mode}`,
    `Lookback minutes: ${artifact.lookbackMinutes}`,
    "",
    "## Summary",
    "",
    `- Polymarket closed events ${artifact.mode === "APPLY" ? "hidden" : "planned"}: ${artifact.summary.polymarketEventsHiddenOrPlanned}`,
    `- Predict rows scanned: ${artifact.summary.predictRowsScanned}`,
    `- Predict rows ${artifact.mode === "APPLY" ? "updated" : "planned"}: ${artifact.summary.predictRowsUpdatedOrPlanned}`,
    `- Predict rows needing operator links: ${artifact.summary.predictRowsNeedingOperatorLinks}`,
    `- Predict rows ${artifact.mode === "APPLY" ? "hidden" : "planned hidden"}: ${artifact.summary.predictRowsHiddenOrPlanned}`,
    `- Operator-confirmed events ${artifact.mode === "APPLY" ? "hidden" : "planned hidden"}: ${artifact.summary.operatorConfirmedEventsHiddenOrPlanned}`,
    "",
    "## Polymarket Closed Events",
    "",
    ...(artifact.polymarketClosedEvents.length === 0
      ? ["- none"]
      : artifact.polymarketClosedEvents.map((row) =>
        `- ${row.displayTitle ?? row.propositionKey} (${row.canonicalEventId}) blockers=${row.blockers.join(", ") || "n/a"}`)),
    "",
    "## Predict Repairs",
    "",
    ...(artifact.predictRepairCandidates.length === 0
      ? ["- none"]
      : artifact.predictRepairCandidates.map((row) =>
        `- ${row.status}: ${row.title} current=${row.currentVenueMarketId} reason=${row.reason}${row.candidate ? ` candidate=${row.candidate.venueMarketId}` : ""} search="${row.linkHints.searchTerm}"`)),
    "",
    "## Safety Notes",
    "",
    "- This cleanup hides stale frontend-approved markets; it does not delete canonical history.",
    "- Predict repair applies only to one active exact-title match.",
    "- No execution adapters, funding gates, approved lanes, scope tokens, or settlement logic are changed.",
    "- Artifacts do not include API keys, auth headers, signatures, or raw provider payloads.",
    ""
  ].join("\n");
}
