import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import pg from "pg";

const { Pool } = pg;

type Mode = "dry_run" | "apply";

interface RetentionConfig {
  orderbookDetailRetentionDays: number;
  fundingAuditDuplicateRetentionDays: number;
  fundingReconciliationSuccessRetentionDays: number;
  fundingReconciliationKeepPerLeg: number;
  batchLimit: number;
}

interface RetentionSummary {
  generatedAt: string;
  target: string;
  mode: Mode;
  config: RetentionConfig;
  orderbookSnapshots: {
    detailRowsBefore: number;
    compactRowsBefore: number;
    oldDetailRows: number;
    compactedBuckets: number;
    deletedDetailRows: number;
    detailRowsAfter: number | null;
    compactRowsAfter: number | null;
  };
  fundingAuditEvents: {
    rowsBefore: number;
    oldDuplicateRows: number;
    deletedDuplicateRows: number;
    rowsAfter: number | null;
  };
  fundingReconciliationRecords: {
    rowsBefore: number;
    oldSuccessfulRowsPrunable: number;
    deletedSuccessfulRows: number;
    rowsAfter: number | null;
  };
}

const OUTPUT_JSON = "artifacts/db/db-retention-compaction-summary.json";
const OUTPUT_MD = "artifacts/db/db-retention-compaction-summary.md";

const loadLocalEnv = (): void => {
  for (const path of [".env", "../.env"]) {
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
};

const hasArg = (name: string): boolean => process.argv.includes(name);

const valueArg = (name: string): string | null => {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

const intArg = (name: string, fallback: number, min: number, max: number): number => {
  const raw = valueArg(name);
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
};

const databaseUrl = (): string => {
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!url?.trim()) {
    throw new Error("DATABASE_URL or SUPABASE_DB_URL is required.");
  }
  return url.trim();
};

const poolConfigFor = (connectionString: string): pg.PoolConfig => {
  const host = new URL(connectionString).hostname;
  const local = host === "127.0.0.1" || host === "localhost";
  return {
    connectionString,
    ssl: process.env.DB_RETENTION_SSL === "false" || local ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: Number.parseInt(process.env.DB_RETENTION_CONNECT_TIMEOUT_MS ?? "30000", 10),
    application_name: "lotus-db-retention-compaction"
  };
};

const tableExists = async (pool: pg.Pool, table: string): Promise<boolean> => {
  const result = await pool.query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [table]
  );
  return result.rowCount > 0;
};

const assertRequiredTables = async (pool: pg.Pool): Promise<void> => {
  const required = [
    "venue_orderbook_snapshots",
    "venue_orderbook_snapshot_hourly_compactions",
    "funding_audit_events",
    "funding_reconciliation_records",
    "funding_intents",
    "funding_route_legs"
  ];
  const missing: string[] = [];
  for (const table of required) {
    if (!await tableExists(pool, table)) {
      missing.push(table);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Retention tables are missing: ${missing.join(", ")}. Run the latest DB migrations against this target before running db:retention:compact.`);
  }
};

const countRows = async (pool: pg.Pool, table: string): Promise<number> => {
  const result = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
};

const countOldOrderbookRows = async (pool: pg.Pool, retentionDays: number): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM venue_orderbook_snapshots
      WHERE received_at < now() - ($1::int * interval '1 day')`,
    [retentionDays]
  );
  return Number(result.rows[0]?.count ?? 0);
};

const compactOldOrderbookRows = async (pool: pg.Pool, retentionDays: number): Promise<number> => {
  const result = await pool.query(
    `INSERT INTO venue_orderbook_snapshot_hourly_compactions (
       canonical_event_id,
       canonical_market_id,
       canonical_outcome_id,
       venue,
       venue_market_id,
       venue_outcome_id,
       bucket_start,
       sample_count,
       first_received_at,
       last_received_at,
       avg_midpoint,
       avg_best_bid,
       avg_best_ask,
       last_midpoint,
       last_best_bid,
       last_best_ask,
       max_bid_depth,
       max_ask_depth,
       blocker_count,
       updated_at
     )
     SELECT canonical_event_id,
            canonical_market_id,
            COALESCE(canonical_outcome_id, '') AS canonical_outcome_id,
            venue,
            venue_market_id,
            COALESCE(venue_outcome_id, '') AS venue_outcome_id,
            date_trunc('hour', received_at) AS bucket_start,
            COUNT(*)::int AS sample_count,
            MIN(received_at) AS first_received_at,
            MAX(received_at) AS last_received_at,
            AVG(midpoint) FILTER (WHERE midpoint IS NOT NULL) AS avg_midpoint,
            AVG(best_bid) FILTER (WHERE best_bid IS NOT NULL) AS avg_best_bid,
            AVG(best_ask) FILTER (WHERE best_ask IS NOT NULL) AS avg_best_ask,
            (ARRAY_AGG(midpoint ORDER BY received_at DESC) FILTER (WHERE midpoint IS NOT NULL))[1] AS last_midpoint,
            (ARRAY_AGG(best_bid ORDER BY received_at DESC) FILTER (WHERE best_bid IS NOT NULL))[1] AS last_best_bid,
            (ARRAY_AGG(best_ask ORDER BY received_at DESC) FILTER (WHERE best_ask IS NOT NULL))[1] AS last_best_ask,
            COALESCE(MAX(bid_depth), 0) AS max_bid_depth,
            COALESCE(MAX(ask_depth), 0) AS max_ask_depth,
            COUNT(*) FILTER (WHERE COALESCE(jsonb_array_length(blockers), 0) > 0)::int AS blocker_count,
            now() AS updated_at
       FROM venue_orderbook_snapshots
      WHERE received_at < now() - ($1::int * interval '1 day')
      GROUP BY canonical_event_id,
               canonical_market_id,
               COALESCE(canonical_outcome_id, ''),
               venue,
               venue_market_id,
               COALESCE(venue_outcome_id, ''),
               date_trunc('hour', received_at)
     ON CONFLICT (
       canonical_market_id,
       canonical_outcome_id,
       venue,
       venue_market_id,
       venue_outcome_id,
       bucket_start
     )
     DO UPDATE SET
       canonical_event_id = EXCLUDED.canonical_event_id,
       sample_count = EXCLUDED.sample_count,
       first_received_at = EXCLUDED.first_received_at,
       last_received_at = EXCLUDED.last_received_at,
       avg_midpoint = EXCLUDED.avg_midpoint,
       avg_best_bid = EXCLUDED.avg_best_bid,
       avg_best_ask = EXCLUDED.avg_best_ask,
       last_midpoint = EXCLUDED.last_midpoint,
       last_best_bid = EXCLUDED.last_best_bid,
       last_best_ask = EXCLUDED.last_best_ask,
       max_bid_depth = EXCLUDED.max_bid_depth,
       max_ask_depth = EXCLUDED.max_ask_depth,
       blocker_count = EXCLUDED.blocker_count,
       updated_at = now()`,
    [retentionDays]
  );
  return result.rowCount ?? 0;
};

const deleteCompactedOrderbookRows = async (
  pool: pg.Pool,
  retentionDays: number,
  batchLimit: number
): Promise<number> => {
  const result = await pool.query(
    `WITH candidates AS (
       SELECT snapshot.id
         FROM venue_orderbook_snapshots snapshot
        WHERE snapshot.received_at < now() - ($1::int * interval '1 day')
          AND EXISTS (
            SELECT 1
              FROM venue_orderbook_snapshot_hourly_compactions hourly
             WHERE hourly.canonical_market_id = snapshot.canonical_market_id
               AND hourly.canonical_outcome_id = COALESCE(snapshot.canonical_outcome_id, '')
               AND hourly.venue = snapshot.venue
               AND hourly.venue_market_id = snapshot.venue_market_id
               AND hourly.venue_outcome_id = COALESCE(snapshot.venue_outcome_id, '')
               AND hourly.bucket_start = date_trunc('hour', snapshot.received_at)
          )
        ORDER BY snapshot.received_at ASC, snapshot.id ASC
        LIMIT $2
     ),
     deleted AS (
       DELETE FROM venue_orderbook_snapshots target
        USING candidates
        WHERE target.id = candidates.id
        RETURNING target.id
     )
     SELECT COUNT(*)::text AS deleted FROM deleted`,
    [retentionDays, batchLimit]
  );
  return Number(result.rows[0]?.deleted ?? 0);
};

const countOldFundingAuditDuplicates = async (pool: pg.Pool, retentionDays: number): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    `WITH ranked AS (
       SELECT row_number() OVER (
                PARTITION BY funding_intent_id, route_leg_id, event_type, payload::text
                ORDER BY created_at DESC, id DESC
              ) AS rn,
              created_at
         FROM funding_audit_events
     )
     SELECT COUNT(*)::text AS count
       FROM ranked
      WHERE rn > 1
        AND created_at < now() - ($1::int * interval '1 day')`,
    [retentionDays]
  );
  return Number(result.rows[0]?.count ?? 0);
};

const deleteOldFundingAuditDuplicates = async (
  pool: pg.Pool,
  retentionDays: number,
  batchLimit: number
): Promise<number> => {
  const result = await pool.query(
    `WITH ranked AS (
       SELECT id,
              row_number() OVER (
                PARTITION BY funding_intent_id, route_leg_id, event_type, payload::text
                ORDER BY created_at DESC, id DESC
              ) AS rn,
              created_at
         FROM funding_audit_events
     ),
     candidates AS (
       SELECT id
         FROM ranked
        WHERE rn > 1
          AND created_at < now() - ($1::int * interval '1 day')
        ORDER BY created_at ASC, id ASC
        LIMIT $2
     ),
     deleted AS (
       DELETE FROM funding_audit_events target
        USING candidates
        WHERE target.id = candidates.id
        RETURNING target.id
     )
     SELECT COUNT(*)::text AS deleted FROM deleted`,
    [retentionDays, batchLimit]
  );
  return Number(result.rows[0]?.deleted ?? 0);
};

const countOldSuccessfulFundingReconciliationRows = async (
  pool: pg.Pool,
  retentionDays: number,
  keepPerLeg: number
): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    `WITH ranked AS (
       SELECT fr.checked_at,
              row_number() OVER (
                PARTITION BY fr.funding_intent_id, fr.route_leg_id, fr.target_venue
                ORDER BY fr.checked_at DESC, fr.id DESC
              ) AS rn
         FROM funding_reconciliation_records fr
         JOIN funding_intents fi ON fi.id = fr.funding_intent_id
         JOIN funding_route_legs fl ON fl.id = fr.route_leg_id
        WHERE fr.ready_to_trade = true
          AND fr.destination_received = true
          AND fr.venue_credit_confirmed = true
          AND fi.status IN ('READY_TO_TRADE', 'PARTIALLY_READY_TO_TRADE')
          AND fl.status = 'LEG_READY_TO_TRADE'
     )
     SELECT COUNT(*)::text AS count
       FROM ranked
      WHERE rn > $2
        AND checked_at < now() - ($1::int * interval '1 day')`,
    [retentionDays, keepPerLeg]
  );
  return Number(result.rows[0]?.count ?? 0);
};

const deleteOldSuccessfulFundingReconciliationRows = async (
  pool: pg.Pool,
  retentionDays: number,
  keepPerLeg: number,
  batchLimit: number
): Promise<number> => {
  const result = await pool.query(
    `WITH ranked AS (
       SELECT fr.id,
              fr.checked_at,
              row_number() OVER (
                PARTITION BY fr.funding_intent_id, fr.route_leg_id, fr.target_venue
                ORDER BY fr.checked_at DESC, fr.id DESC
              ) AS rn
         FROM funding_reconciliation_records fr
         JOIN funding_intents fi ON fi.id = fr.funding_intent_id
         JOIN funding_route_legs fl ON fl.id = fr.route_leg_id
        WHERE fr.ready_to_trade = true
          AND fr.destination_received = true
          AND fr.venue_credit_confirmed = true
          AND fi.status IN ('READY_TO_TRADE', 'PARTIALLY_READY_TO_TRADE')
          AND fl.status = 'LEG_READY_TO_TRADE'
     ),
     candidates AS (
       SELECT id
         FROM ranked
        WHERE rn > $2
          AND checked_at < now() - ($1::int * interval '1 day')
        ORDER BY checked_at ASC, id ASC
        LIMIT $3
     ),
     deleted AS (
       DELETE FROM funding_reconciliation_records target
        USING candidates
        WHERE target.id = candidates.id
        RETURNING target.id
     )
     SELECT COUNT(*)::text AS deleted FROM deleted`,
    [retentionDays, keepPerLeg, batchLimit]
  );
  return Number(result.rows[0]?.deleted ?? 0);
};

const renderMarkdown = (summary: RetentionSummary): string => [
  "# DB Retention Compaction Summary",
  "",
  `Generated: ${summary.generatedAt}`,
  `Target: ${summary.target}`,
  `Mode: ${summary.mode}`,
  "",
  "## Policy",
  "",
  `Orderbook detail retention days: ${summary.config.orderbookDetailRetentionDays}`,
  `Funding audit duplicate retention days: ${summary.config.fundingAuditDuplicateRetentionDays}`,
  `Funding reconciliation success retention days: ${summary.config.fundingReconciliationSuccessRetentionDays}`,
  `Funding reconciliation rows kept per ready leg: ${summary.config.fundingReconciliationKeepPerLeg}`,
  `Delete batch limit: ${summary.config.batchLimit}`,
  "",
  "## Venue Orderbook Snapshots",
  "",
  `Detail rows before: ${summary.orderbookSnapshots.detailRowsBefore}`,
  `Hourly compact rows before: ${summary.orderbookSnapshots.compactRowsBefore}`,
  `Old detail rows eligible: ${summary.orderbookSnapshots.oldDetailRows}`,
  `Compacted hourly buckets touched: ${summary.orderbookSnapshots.compactedBuckets}`,
  `Deleted old detail rows: ${summary.orderbookSnapshots.deletedDetailRows}`,
  `Detail rows after: ${summary.orderbookSnapshots.detailRowsAfter ?? "not applied"}`,
  `Hourly compact rows after: ${summary.orderbookSnapshots.compactRowsAfter ?? "not applied"}`,
  "",
  "## Funding Audit Events",
  "",
  `Rows before: ${summary.fundingAuditEvents.rowsBefore}`,
  `Old exact duplicate rows: ${summary.fundingAuditEvents.oldDuplicateRows}`,
  `Deleted duplicate rows: ${summary.fundingAuditEvents.deletedDuplicateRows}`,
  `Rows after: ${summary.fundingAuditEvents.rowsAfter ?? "not applied"}`,
  "",
  "## Funding Reconciliation Records",
  "",
  `Rows before: ${summary.fundingReconciliationRecords.rowsBefore}`,
  `Old successful rows prunable: ${summary.fundingReconciliationRecords.oldSuccessfulRowsPrunable}`,
  `Deleted successful rows: ${summary.fundingReconciliationRecords.deletedSuccessfulRows}`,
  `Rows after: ${summary.fundingReconciliationRecords.rowsAfter ?? "not applied"}`,
  "",
  "## Safety Notes",
  "",
  "- `venue_orderbook_latest_snapshots` is not pruned by this script.",
  "- Orderbook detail rows are deleted only after matching hourly compaction rows exist.",
  "- Funding reconciliation failures, unresolved rows, and non-ready rows are preserved.",
  "- Funding audit cleanup removes exact old duplicates only."
].join("\n") + "\n";

const main = async (): Promise<void> => {
  loadLocalEnv();
  const apply = hasArg("--apply");
  const config: RetentionConfig = {
    orderbookDetailRetentionDays: intArg("--orderbook-detail-days", 14, 1, 365),
    fundingAuditDuplicateRetentionDays: intArg("--funding-audit-duplicate-days", 7, 1, 365),
    fundingReconciliationSuccessRetentionDays: intArg("--funding-reconciliation-success-days", 60, 1, 730),
    fundingReconciliationKeepPerLeg: intArg("--funding-reconciliation-keep-per-leg", 3, 1, 100),
    batchLimit: intArg("--batch-limit", 50_000, 100, 500_000)
  };
  const url = databaseUrl();
  const target = `${new URL(url).host}${new URL(url).pathname}`;
  const pool = new Pool(poolConfigFor(url));
  try {
    await assertRequiredTables(pool);
    const detailRowsBefore = await countRows(pool, "venue_orderbook_snapshots");
    const compactRowsBefore = await countRows(pool, "venue_orderbook_snapshot_hourly_compactions");
    const oldDetailRows = await countOldOrderbookRows(pool, config.orderbookDetailRetentionDays);
    const fundingAuditRowsBefore = await countRows(pool, "funding_audit_events");
    const oldDuplicateRows = await countOldFundingAuditDuplicates(pool, config.fundingAuditDuplicateRetentionDays);
    const reconciliationRowsBefore = await countRows(pool, "funding_reconciliation_records");
    const oldSuccessfulRowsPrunable = await countOldSuccessfulFundingReconciliationRows(
      pool,
      config.fundingReconciliationSuccessRetentionDays,
      config.fundingReconciliationKeepPerLeg
    );

    const compactedBuckets = apply && oldDetailRows > 0
      ? await compactOldOrderbookRows(pool, config.orderbookDetailRetentionDays)
      : 0;
    const deletedDetailRows = apply && oldDetailRows > 0
      ? await deleteCompactedOrderbookRows(pool, config.orderbookDetailRetentionDays, config.batchLimit)
      : 0;
    const deletedDuplicateRows = apply && oldDuplicateRows > 0
      ? await deleteOldFundingAuditDuplicates(pool, config.fundingAuditDuplicateRetentionDays, config.batchLimit)
      : 0;
    const deletedSuccessfulRows = apply && oldSuccessfulRowsPrunable > 0
      ? await deleteOldSuccessfulFundingReconciliationRows(
        pool,
        config.fundingReconciliationSuccessRetentionDays,
        config.fundingReconciliationKeepPerLeg,
        config.batchLimit
      )
      : 0;

    const summary: RetentionSummary = {
      generatedAt: new Date().toISOString(),
      target,
      mode: apply ? "apply" : "dry_run",
      config,
      orderbookSnapshots: {
        detailRowsBefore,
        compactRowsBefore,
        oldDetailRows,
        compactedBuckets,
        deletedDetailRows,
        detailRowsAfter: apply ? await countRows(pool, "venue_orderbook_snapshots") : null,
        compactRowsAfter: apply ? await countRows(pool, "venue_orderbook_snapshot_hourly_compactions") : null
      },
      fundingAuditEvents: {
        rowsBefore: fundingAuditRowsBefore,
        oldDuplicateRows,
        deletedDuplicateRows,
        rowsAfter: apply ? await countRows(pool, "funding_audit_events") : null
      },
      fundingReconciliationRecords: {
        rowsBefore: reconciliationRowsBefore,
        oldSuccessfulRowsPrunable,
        deletedSuccessfulRows,
        rowsAfter: apply ? await countRows(pool, "funding_reconciliation_records") : null
      }
    };

    await mkdir(dirname(OUTPUT_JSON), { recursive: true });
    await Promise.all([
      writeFile(OUTPUT_JSON, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
      writeFile(OUTPUT_MD, renderMarkdown(summary), "utf8")
    ]);
    console.log(`[db:retention:compact] mode=${summary.mode} old_orderbook_rows=${oldDetailRows} compacted_buckets=${compactedBuckets} deleted_orderbook_rows=${deletedDetailRows}`);
    console.log(`[db:retention:compact] old_funding_audit_duplicates=${oldDuplicateRows} deleted_funding_audit_duplicates=${deletedDuplicateRows}`);
    console.log(`[db:retention:compact] old_successful_reconciliation_rows=${oldSuccessfulRowsPrunable} deleted_reconciliation_rows=${deletedSuccessfulRows}`);
    console.log(`[db:retention:compact] wrote ${OUTPUT_JSON}`);
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("[db:retention:compact] failed", error);
  process.exit(1);
});
