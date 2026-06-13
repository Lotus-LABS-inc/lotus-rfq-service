#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import { MarketDiscoveryService } from "../../src/market-discovery/market-discovery-service.js";
import { MarketDiscoveryRepository } from "../../src/repositories/market-discovery.repository.js";

const loadLocalEnv = (): void => {
  for (const envPath of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")]) {
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
      return;
    }
  }
};

const main = async (): Promise<void> => {
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL or SUPABASE_DB_URL is required.");
  }
  const pool = new Pool({ connectionString });
  try {
    const service = new MarketDiscoveryService(pool, new MarketDiscoveryRepository(pool), process.cwd());
    const summary = await service.runOnce();
    const artifactDir = path.resolve(process.cwd(), "artifacts", "market-discovery");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      path.join(artifactDir, "market-discovery-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8"
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
