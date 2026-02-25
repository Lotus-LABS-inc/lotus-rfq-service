import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import { Pool } from "pg";

export interface PostgresModuleConfig {
  databaseUrl: string;
  logger: Logger;
}

export type AppDb = NodePgDatabase<Record<string, never>>;

export const createPgPool = ({ databaseUrl, logger }: PostgresModuleConfig): Pool => {
  const pool = new Pool({ connectionString: databaseUrl });

  pool.on("error", (error: Error) => {
    logger.error({ err: error }, "Postgres pool error.");
  });

  return pool;
};

export const createDrizzleDb = (pool: Pool): AppDb => drizzle(pool);

export const closePgPool = async (pool: Pool): Promise<void> => {
  await pool.end();
};
