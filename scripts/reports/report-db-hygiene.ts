import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

  return {
    generatedAt: new Date().toISOString(),
    target,
    publicTableCount: countsResult.rows.length,
    totalPublicRows,
    largestTables,
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
    "## User Venue Account Audit",
    ""
  ];
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
