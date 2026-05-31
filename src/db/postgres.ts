import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import { Pool } from "pg";

export interface PostgresModuleConfig {
  databaseUrl: string;
  logger: Logger;
  max?: number | undefined;
}

export type AppDb = NodePgDatabase<Record<string, never>>;

export const createPgPool = ({ databaseUrl, logger, max }: PostgresModuleConfig): Pool => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: max ?? resolvePoolMax(process.env.PG_POOL_MAX),
    connectionTimeoutMillis: resolvePositiveInteger(process.env.PG_POOL_CONNECTION_TIMEOUT_MS, 5_000),
    idleTimeoutMillis: resolvePositiveInteger(process.env.PG_POOL_IDLE_TIMEOUT_MS, 10_000)
  });

  pool.on("error", (error: Error) => {
    logger.error({ err: error }, "Postgres pool error.");
  });

  return pool;
};

const resolvePoolMax = (value: string | undefined): number => {
  const parsed = resolvePositiveInteger(value, 3);
  return Math.min(Math.max(parsed, 1), 25);
};

const resolvePositiveInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const createDrizzleDb = (pool: Pool): AppDb => drizzle(pool);

export const closePgPool = async (pool: Pool): Promise<void> => {
  await pool.end();
};
