import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

interface PruneSummary {
  generatedAt: string;
  target: string;
  mode: "dry_run" | "apply";
  userFilter: string | null;
  beforeRows: number;
  duplicateRows: number;
  deletedRows: number;
  afterRows: number | null;
}

const OUTPUT_JSON = "artifacts/db/user-venue-account-audit-prune-summary.json";
const OUTPUT_MD = "artifacts/db/user-venue-account-audit-prune-summary.md";

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
    ssl: process.env.DB_PRUNE_SSL === "false" || local ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: Number.parseInt(process.env.DB_PRUNE_CONNECT_TIMEOUT_MS ?? "30000", 10)
  };
};

const maskUserId = (userId: string | null): string | null => (
  userId && userId.length > 18 ? `${userId.slice(0, 12)}...${userId.slice(-8)}` : userId
);

const countRows = async (pool: pg.Pool, userId: string | null): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM user_venue_account_audit_events
      WHERE ($1::text IS NULL OR user_id = $1)`,
    [userId]
  );
  return Number(result.rows[0]?.count ?? 0);
};

const countDuplicateRows = async (pool: pg.Pool, userId: string | null): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    `WITH ranked AS (
       SELECT row_number() OVER (
                PARTITION BY user_id, venue_account_id, event_type, payload::text
                ORDER BY created_at DESC, id DESC
              ) AS rn
         FROM user_venue_account_audit_events
        WHERE ($1::text IS NULL OR user_id = $1)
     )
     SELECT COUNT(*)::text AS count
       FROM ranked
      WHERE rn > 1`,
    [userId]
  );
  return Number(result.rows[0]?.count ?? 0);
};

const deleteDuplicateRows = async (pool: pg.Pool, userId: string | null): Promise<number> => {
  const result = await pool.query<{ id: string }>(
    `WITH ranked AS (
       SELECT id,
              row_number() OVER (
                PARTITION BY user_id, venue_account_id, event_type, payload::text
                ORDER BY created_at DESC, id DESC
              ) AS rn
         FROM user_venue_account_audit_events
        WHERE ($1::text IS NULL OR user_id = $1)
     ),
     deleted AS (
       DELETE FROM user_venue_account_audit_events target
        USING ranked
        WHERE target.id = ranked.id
          AND ranked.rn > 1
        RETURNING target.id
     )
     SELECT id FROM deleted`,
    [userId]
  );
  return result.rowCount ?? 0;
};

const renderMarkdown = (summary: PruneSummary): string => [
  "# User Venue Account Audit Prune Summary",
  "",
  `Generated: ${summary.generatedAt}`,
  `Target: ${summary.target}`,
  `Mode: ${summary.mode}`,
  `User filter: ${summary.userFilter ?? "none"}`,
  "",
  `Rows before: ${summary.beforeRows}`,
  `Exact duplicate rows: ${summary.duplicateRows}`,
  `Deleted rows: ${summary.deletedRows}`,
  `Rows after: ${summary.afterRows ?? "not applied"}`
].join("\n") + "\n";

const main = async (): Promise<void> => {
  loadLocalEnv();
  const apply = hasArg("--apply");
  const userId = valueArg("--user-id");
  const url = databaseUrl();
  const target = `${new URL(url).host}${new URL(url).pathname}`;
  const pool = new Pool(poolConfigFor(url));
  try {
    const beforeRows = await countRows(pool, userId);
    const duplicateRows = await countDuplicateRows(pool, userId);
    const deletedRows = apply && duplicateRows > 0 ? await deleteDuplicateRows(pool, userId) : 0;
    const afterRows = apply ? await countRows(pool, userId) : null;
    const summary: PruneSummary = {
      generatedAt: new Date().toISOString(),
      target,
      mode: apply ? "apply" : "dry_run",
      userFilter: maskUserId(userId),
      beforeRows,
      duplicateRows,
      deletedRows,
      afterRows
    };
    await mkdir(dirname(OUTPUT_JSON), { recursive: true });
    await Promise.all([
      writeFile(OUTPUT_JSON, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
      writeFile(OUTPUT_MD, renderMarkdown(summary), "utf8")
    ]);
    console.log(`[db:prune:user-venue-audit] mode=${summary.mode} before=${beforeRows} duplicates=${duplicateRows} deleted=${deletedRows} after=${afterRows ?? "n/a"}`);
    console.log(`[db:prune:user-venue-audit] wrote ${OUTPUT_JSON}`);
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("[db:prune:user-venue-audit] failed", error);
  process.exit(1);
});
