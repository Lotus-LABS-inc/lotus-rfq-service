import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { Pool } from "pg";

import type { RedisClient } from "../../src/db/redis.js";
import type { ResidualVectorEntity } from "../../src/core/combo-engine/types.js";
import type { ReconciliationV2Job } from "../../src/jobs/reconciliation-v2.job.js";

export interface InsertComboInput {
  comboId: string;
  userId: string;
  createdAt: string;
  state?: string;
  metadataTag: string;
  legs: Array<{
    legId: string;
    marketId: string;
    outcomeId: string;
    side: "buy" | "sell";
    size: string;
    remainingSize: string;
    priceHint: string;
    metadata: Record<string, unknown>;
  }>;
}

export const buildStableUuid = (seed: string, runId: string, namespace: string): string => {
  const digest = createHash("sha256").update(`${seed}:${runId}:${namespace}`).digest("hex");
  const versionNibble = "4";
  const variantNibble = ((Number.parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `${versionNibble}${digest.slice(13, 16)}`,
    `${variantNibble}${digest.slice(17, 20)}`,
    digest.slice(20, 32)
  ].join("-");
};

export const buildCreatedAt = (prefixHour: string, index: number): string =>
  `2026-03-11T${prefixHour}:${String(index % 60).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}.000Z`;

export const buildResolutionMetadata = (tag: string, resolutionProfileId?: string): Record<string, unknown> => ({
  resolutionUniverse: `u-${tag}`,
  expiryClass: `e-${tag}`,
  settlementModel: `s-${tag}`,
  resolutionRuleClass: `r-${tag}`,
  ...(resolutionProfileId ? { resolution_profile_id: resolutionProfileId } : {})
});

export const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const isTransientDbError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Connection terminated unexpectedly") ||
    error.message.includes("Query read timeout") ||
    error.message.includes("canceling statement due to statement timeout")
  );
};

export const withTransientRetry = async <T>(operation: () => Promise<T>, attempt = 0): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (attempt < 2 && isTransientDbError(error)) {
      await sleep((attempt + 1) * 250);
      return withTransientRetry(operation, attempt + 1);
    }

    throw error;
  }
};

export const applyMigrations = async (pool: Pool): Promise<void> => {
  const migrationDirs = [
    path.resolve(process.cwd(), "infra", "migrations"),
    path.resolve(process.cwd(), "sql", "migrations")
  ];

  for (const migrationsDir of migrationDirs) {
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      try {
        await pool.query(sql);
      } catch (error) {
        const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
        if (code === "42P07" || code === "42710") {
          continue;
        }
        throw error;
      }
    }
  }
};

export const insertCombo = async (pool: Pool, input: InsertComboInput): Promise<void> => {
  await pool.query(
    `INSERT INTO combo_rfqs (id, user_id, acceptance_policy, state, expires_at, metadata, created_at)
     VALUES ($1, $2, 'ALL_OR_NONE', $3, NOW() + INTERVAL '1 hour', $4::jsonb, $5)`,
    [
      input.comboId,
      input.userId,
      input.state ?? "OPEN",
      JSON.stringify({ test_suite: "phase3a-proof", tag: input.metadataTag }),
      input.createdAt
    ]
  );

  for (const leg of input.legs) {
    await pool.query(
      `INSERT INTO combo_legs
        (id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side, size, remaining_size, price_hint, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        leg.legId,
        input.comboId,
        leg.marketId,
        leg.outcomeId,
        leg.side,
        leg.size,
        leg.remainingSize,
        leg.priceHint,
        JSON.stringify(leg.metadata)
      ]
    );
  }
};

export const loadResidualEntity = async (pool: Pool, comboId: string): Promise<ResidualVectorEntity> => {
  const combo = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM combo_rfqs WHERE id = $1 LIMIT 1`,
    [comboId]
  );
  const comboRow = combo.rows[0];
  if (!comboRow) {
    throw new Error(`missing_combo:${comboId}`);
  }

  const legs = await pool.query<{
    id: string;
    canonical_market_id: string;
    canonical_outcome_id: string;
    side: "buy" | "sell";
    remaining_size: string;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT id,
            canonical_market_id::text,
            canonical_outcome_id::text,
            side,
            remaining_size::text,
            metadata
       FROM combo_legs
      WHERE combo_rfq_id = $1
      ORDER BY id ASC`,
    [comboId]
  );

  return {
    entityId: comboRow.id,
    userId: comboRow.user_id,
    legs: legs.rows.map((row) => ({
      id: row.id,
      canonicalMarketId: row.canonical_market_id,
      canonicalOutcomeId: row.canonical_outcome_id,
      side: row.side,
      remainingSize: row.remaining_size,
      ...(row.metadata ? { metadata: row.metadata } : {})
    }))
  };
};

export const countRows = async (pool: Pool, sql: string, params: readonly unknown[]): Promise<number> => {
  const result = await pool.query<{ count: string }>(sql, params as unknown[]);
  return Number(result.rows[0]?.count ?? "0");
};

export const computeScopedComboFingerprint = async (pool: Pool, comboIds: readonly string[]): Promise<string> => {
  const result = await pool.query<{
    combo_id: string;
    user_id: string;
    state: string;
    leg_id: string;
    canonical_market_id: string;
    canonical_outcome_id: string;
    side: "buy" | "sell";
    size: string;
    remaining_size: string;
    price_hint: string | null;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT cr.id::text AS combo_id,
            cr.user_id::text AS user_id,
            cr.state,
            cl.id::text AS leg_id,
            cl.canonical_market_id::text,
            cl.canonical_outcome_id::text,
            cl.side,
            cl.size::text,
            cl.remaining_size::text,
            cl.price_hint::text,
            cl.metadata
       FROM combo_rfqs cr
       JOIN combo_legs cl ON cl.combo_rfq_id = cr.id
      WHERE cr.id::text = ANY($1::text[])
      ORDER BY cr.id::text ASC, cl.id::text ASC`,
    [comboIds]
  );

  return createHash("sha256").update(JSON.stringify(result.rows)).digest("hex");
};

export const safeDisconnectRedis = async (redis: RedisClient): Promise<void> => {
  try {
    await redis.quit();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("Connection is closed")) {
      throw error;
    }
  }
};

export const scopeReconciliationJobToCombos = (
  job: ReconciliationV2Job,
  pool: Pool,
  comboIds: readonly string[]
): void => {
  const scopedIds = [...new Set(comboIds)];
  const internals = job as unknown as {
    loadResidualComboLegRows: (domain: "netting_phase2a" | "clearing_phase2b", batchSize: number) => Promise<unknown[]>;
    collectPagedRows: <T>(input: {
      domain: string;
      operation: string;
      batchSize: number;
      fetchPage: (cursor: string | null) => Promise<readonly T[]>;
      cursorOf: (row: T) => string;
    }) => Promise<T[]>;
  };
  const originalCollectPagedRows = internals.collectPagedRows.bind(job);

  internals.loadResidualComboLegRows = async () => {
    if (scopedIds.length === 0) {
      return [];
    }

    const result = await pool.query(
      `SELECT cr.id::text AS combo_id,
              cr.user_id::text,
              cr.state,
              cl.id::text AS leg_id,
              cl.canonical_market_id::text,
              cl.canonical_outcome_id::text,
              cl.side,
              cl.remaining_size::text,
              cl.price_hint::text,
              cl.metadata
         FROM combo_rfqs cr
         JOIN combo_legs cl ON cl.combo_rfq_id = cr.id
        WHERE cr.id::text = ANY($1::text[])
          AND cl.remaining_size > 0
        ORDER BY cr.id::text ASC, cl.id::text ASC`,
      [scopedIds]
    );
    return result.rows;
  };

  internals.collectPagedRows = async (input) => {
    if (
      input.operation === "combo_netting_groups_page" ||
      input.operation === "clearing_rounds_page" ||
      input.operation === "clearing_participants_missing_page"
    ) {
      return [];
    }
    return originalCollectPagedRows(input);
  };
};
