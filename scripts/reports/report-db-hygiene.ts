import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

interface TableCount {
  table: string;
  rows: number;
}

interface EventCount {
  eventType: string;
  rows: number;
}

interface UserCount {
  userId: string;
  rows: number;
}

interface DbHygieneReport {
  generatedAt: string;
  target: string;
  publicTableCount: number;
  totalPublicRows: number;
  largestTables: TableCount[];
  retention: {
    venueOrderbookSnapshots: {
      detailRows: number;
      hourlyCompactRows: number;
      detailRowsOlderThan14Days: number;
    } | null;
    funding: {
      auditEventRows: number;
      reconciliationRows: number;
      auditDuplicateRowsOlderThan7Days: number;
      successfulReconciliationRowsOlderThan60Days: number;
    } | null;
  };
  userVenueAccountAudit: {
    rows: number;
    exactDuplicateRows: number;
    duplicateGroups: number;
    topEventTypes: EventCount[];
    topUsers: UserCount[];
  } | null;
}

const OUTPUT_JSON = "artifacts/db/db-hygiene-summary.json";
const OUTPUT_MD = "artifacts/db/db-hygiene-summary.md";

const loadLocalEnv = (): void => {
  for (const path of [".env", "../.env"]) {
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
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
    ssl: process.env.DB_HYGIENE_SSL === "false" || local ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: Number.parseInt(process.env.DB_HYGIENE_CONNECT_TIMEOUT_MS ?? "30000", 10)
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

const maskUserId = (userId: string): string => (
  userId.length <= 18 ? userId : `${userId.slice(0, 12)}...${userId.slice(-8)}`
);

const buildReport = async (pool: pg.Pool, target: string): Promise<DbHygieneReport> => {
  const countsResult = await pool.query<{ table_name: string; row_estimate: string }>(
    `SELECT relname AS table_name,
            GREATEST(reltuples::bigint, 0)::text AS row_estimate
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY GREATEST(reltuples::bigint, 0) DESC, relname ASC`
  );
  const largestTables = countsResult.rows.slice(0, 25).map((row) => ({
    table: row.table_name,
    rows: Number(row.row_estimate)
  }));
  const totalPublicRows = countsResult.rows.reduce((total, row) => total + Number(row.row_estimate), 0);

  let userVenueAccountAudit: DbHygieneReport["userVenueAccountAudit"] = null;
  if (await tableExists(pool, "user_venue_account_audit_events")) {
    const summary = await pool.query<{
      rows: string;
      exact_duplicate_rows: string;
      duplicate_groups: string;
    }>(
      `WITH grouped AS (
         SELECT COUNT(*)::bigint AS rows
           FROM user_venue_account_audit_events
          GROUP BY user_id, venue_account_id, event_type, payload::text
       )
       SELECT COALESCE(SUM(rows), 0)::text AS rows,
              COALESCE(SUM(GREATEST(rows - 1, 0)), 0)::text AS exact_duplicate_rows,
              COUNT(*) FILTER (WHERE rows > 1)::text AS duplicate_groups
         FROM grouped`
    );
    const topEvents = await pool.query<{ event_type: string; rows: string }>(
      `SELECT event_type, COUNT(*)::text AS rows
         FROM user_venue_account_audit_events
        GROUP BY event_type
        ORDER BY COUNT(*) DESC, event_type ASC
        LIMIT 15`
    );
    const topUsers = await pool.query<{ user_id: string; rows: string }>(
      `SELECT user_id, COUNT(*)::text AS rows
         FROM user_venue_account_audit_events
        GROUP BY user_id
        ORDER BY COUNT(*) DESC, user_id ASC
        LIMIT 15`
    );
    userVenueAccountAudit = {
      rows: Number(summary.rows[0]?.rows ?? 0),
      exactDuplicateRows: Number(summary.rows[0]?.exact_duplicate_rows ?? 0),
      duplicateGroups: Number(summary.rows[0]?.duplicate_groups ?? 0),
      topEventTypes: topEvents.rows.map((row) => ({ eventType: row.event_type, rows: Number(row.rows) })),
      topUsers: topUsers.rows.map((row) => ({ userId: maskUserId(row.user_id), rows: Number(row.rows) }))
    };
  }

  let venueOrderbookSnapshots: DbHygieneReport["retention"]["venueOrderbookSnapshots"] = null;
  if (
    await tableExists(pool, "venue_orderbook_snapshots") &&
    await tableExists(pool, "venue_orderbook_snapshot_hourly_compactions")
  ) {
    const result = await pool.query<{
      detail_rows: string;
      compact_rows: string;
      old_detail_rows: string;
    }>(
      `SELECT (SELECT COUNT(*) FROM venue_orderbook_snapshots)::text AS detail_rows,
              (SELECT COUNT(*) FROM venue_orderbook_snapshot_hourly_compactions)::text AS compact_rows,
              (SELECT COUNT(*) FROM venue_orderbook_snapshots
                WHERE received_at < now() - interval '14 days')::text AS old_detail_rows`
    );
    venueOrderbookSnapshots = {
      detailRows: Number(result.rows[0]?.detail_rows ?? 0),
      hourlyCompactRows: Number(result.rows[0]?.compact_rows ?? 0),
      detailRowsOlderThan14Days: Number(result.rows[0]?.old_detail_rows ?? 0)
    };
  }

  let funding: DbHygieneReport["retention"]["funding"] = null;
  if (
    await tableExists(pool, "funding_audit_events") &&
    await tableExists(pool, "funding_reconciliation_records")
  ) {
    const result = await pool.query<{
      audit_rows: string;
      reconciliation_rows: string;
      audit_duplicate_rows: string;
      old_successful_reconciliation_rows: string;
    }>(
      `WITH audit_ranked AS (
         SELECT row_number() OVER (
                  PARTITION BY funding_intent_id, route_leg_id, event_type, payload::text
                  ORDER BY created_at DESC, id DESC
                ) AS rn,
                created_at
           FROM funding_audit_events
       ),
       reconciliation_ranked AS (
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
       SELECT (SELECT COUNT(*) FROM funding_audit_events)::text AS audit_rows,
              (SELECT COUNT(*) FROM funding_reconciliation_records)::text AS reconciliation_rows,
              (SELECT COUNT(*) FROM audit_ranked
                WHERE rn > 1 AND created_at < now() - interval '7 days')::text AS audit_duplicate_rows,
              (SELECT COUNT(*) FROM reconciliation_ranked
                WHERE rn > 3 AND checked_at < now() - interval '60 days')::text AS old_successful_reconciliation_rows`
    );
    funding = {
      auditEventRows: Number(result.rows[0]?.audit_rows ?? 0),
      reconciliationRows: Number(result.rows[0]?.reconciliation_rows ?? 0),
      auditDuplicateRowsOlderThan7Days: Number(result.rows[0]?.audit_duplicate_rows ?? 0),
      successfulReconciliationRowsOlderThan60Days: Number(result.rows[0]?.old_successful_reconciliation_rows ?? 0)
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    target,
    publicTableCount: countsResult.rows.length,
    totalPublicRows,
    largestTables,
    retention: {
      venueOrderbookSnapshots,
      funding
    },
    userVenueAccountAudit
  };
};

const renderMarkdown = (report: DbHygieneReport): string => {
  const lines = [
    "# DB Hygiene Summary",
    "",
    `Generated: ${report.generatedAt}`,
    `Target: ${report.target}`,
    "",
    `Public tables: ${report.publicTableCount}`,
    `Estimated public rows: ${report.totalPublicRows}`,
    "",
    "## Largest Tables",
    "",
    "| Table | Estimated rows |",
    "| --- | ---: |",
    ...report.largestTables.map((row) => `| ${row.table} | ${row.rows} |`),
    "",
    "## Retention Candidates",
    "",
    "### Venue Orderbook Snapshots",
    ""
  ];
  if (report.retention.venueOrderbookSnapshots) {
    lines.push(
      `Detail rows: ${report.retention.venueOrderbookSnapshots.detailRows}`,
      `Hourly compact rows: ${report.retention.venueOrderbookSnapshots.hourlyCompactRows}`,
      `Detail rows older than 14 days: ${report.retention.venueOrderbookSnapshots.detailRowsOlderThan14Days}`
    );
  } else {
    lines.push("Orderbook retention tables not present.");
  }
  lines.push(
    "",
    "### Funding History",
    ""
  );
  if (report.retention.funding) {
    lines.push(
      `Funding audit rows: ${report.retention.funding.auditEventRows}`,
      `Funding reconciliation rows: ${report.retention.funding.reconciliationRows}`,
      `Old exact duplicate funding audit rows: ${report.retention.funding.auditDuplicateRowsOlderThan7Days}`,
      `Old successful reconciliation rows prunable: ${report.retention.funding.successfulReconciliationRowsOlderThan60Days}`
    );
  } else {
    lines.push("Funding retention tables not present.");
  }
  lines.push(
    "",
    "## User Venue Account Audit",
    ""
  );
  if (!report.userVenueAccountAudit) {
    lines.push("Table not present.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `Rows: ${report.userVenueAccountAudit.rows}`,
    `Exact duplicate rows: ${report.userVenueAccountAudit.exactDuplicateRows}`,
    `Duplicate groups: ${report.userVenueAccountAudit.duplicateGroups}`,
    "",
    "### Top Event Types",
    "",
    "| Event type | Rows |",
    "| --- | ---: |",
    ...report.userVenueAccountAudit.topEventTypes.map((row) => `| ${row.eventType} | ${row.rows} |`),
    "",
    "### Top Users",
    "",
    "| User | Rows |",
    "| --- | ---: |",
    ...report.userVenueAccountAudit.topUsers.map((row) => `| ${row.userId} | ${row.rows} |`)
  );
  return `${lines.join("\n")}\n`;
};

const main = async (): Promise<void> => {
  loadLocalEnv();
  const url = databaseUrl();
  const target = `${new URL(url).host}${new URL(url).pathname}`;
  const pool = new Pool(poolConfigFor(url));
  try {
    const report = await buildReport(pool, target);
    await mkdir(dirname(OUTPUT_JSON), { recursive: true });
    await Promise.all([
      writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
      writeFile(OUTPUT_MD, renderMarkdown(report), "utf8")
    ]);
    console.log(`[report:db:hygiene] wrote ${OUTPUT_JSON}`);
    console.log(`[report:db:hygiene] wrote ${OUTPUT_MD}`);
    if (report.userVenueAccountAudit) {
      console.log(`[report:db:hygiene] user_venue_account_audit_events rows=${report.userVenueAccountAudit.rows} exact_duplicates=${report.userVenueAccountAudit.exactDuplicateRows}`);
    }
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("[report:db:hygiene] failed", error);
  process.exit(1);
});
