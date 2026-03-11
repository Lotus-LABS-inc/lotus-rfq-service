import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const hasTradeTables = async (pool: Pool): Promise<boolean> => {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [[
      "trades",
      "internal_orders",
      "combo_rfqs",
      "combo_legs"
    ]]
  );

  return result.rows.length === 4;
};

const applyMigrations = async (pool: Pool): Promise<void> => {
  if (await hasTradeTables(pool)) {
    return;
  }

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

const hasComboNettingTables = async (pool: Pool): Promise<boolean> => {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [[
      "combo_netting_groups",
      "combo_netting_match_legs",
      "combo_netting_events",
      "combo_netting_attempts"
    ]]
  );

  return result.rows.length === 4;
};

const hasClearingRoundTables = async (pool: Pool): Promise<boolean> => {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [[
      "clearing_rounds",
      "clearing_round_participants",
      "clearing_round_leg_matches",
      "clearing_round_events"
    ]]
  );

  return result.rows.length === 4;
};

const applyComboNettingMigrationIfNeeded = async (pool: Pool): Promise<void> => {
  if (await hasComboNettingTables(pool)) {
    return;
  }

  const migrationPath = path.resolve(process.cwd(), "sql", "migrations", "2026_03_10_create_combo_netting_tables.sql");
  const sql = await readFile(migrationPath, "utf8");
  try {
    await pool.query(sql);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
    if (code !== "42P07" && code !== "42710") {
      throw error;
    }
  }
  const attemptsPath = path.resolve(process.cwd(), "sql", "migrations", "2026_03_10_create_combo_netting_attempts.sql");
  const attemptsSql = await readFile(attemptsPath, "utf8");
  try {
    await pool.query(attemptsSql);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
    if (code !== "42P07" && code !== "42710") {
      throw error;
    }
  }
};

const hasComboLegRemainingSize = async (pool: Pool): Promise<boolean> => {
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'combo_legs'
        AND column_name = 'remaining_size'`
  );

  return result.rows.length === 1;
};

const applyComboLegRemainingMigrationIfNeeded = async (pool: Pool): Promise<void> => {
  if (await hasComboLegRemainingSize(pool)) {
    return;
  }

  const migrationPath = path.resolve(process.cwd(), "sql", "migrations", "2026_03_10_add_combo_leg_remaining_size.sql");
  const sql = await readFile(migrationPath, "utf8");
  await pool.query(sql);
};

const applyClearingRoundMigrationIfNeeded = async (pool: Pool): Promise<void> => {
  if (await hasClearingRoundTables(pool)) {
    return;
  }

  const migrationPath = path.resolve(process.cwd(), "sql", "migrations", "2026_03_10_create_clearing_round_tables.sql");
  const sql = await readFile(migrationPath, "utf8");
  try {
    await pool.query(sql);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
    if (code !== "42P07" && code !== "42710") {
      throw error;
    }
  }
};

describe.skipIf(!ENV_READY)("internal trades schema integration", () => {
  let pool: Pool | undefined;

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name} not initialized`);
    }
    return value;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(must(pool, "pool"));
    await applyComboNettingMigrationIfNeeded(must(pool, "pool"));
    await applyComboLegRemainingMigrationIfNeeded(must(pool, "pool"));
    await applyClearingRoundMigrationIfNeeded(must(pool, "pool"));
  }, 180000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 180000);

  it("creates the trades table with the required indexes", async () => {
    const db = must(pool, "pool");

    const tableResult = await db.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'trades'`
    );

    const indexResult = await db.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'trades'`
    );

    const indexNames = new Set(indexResult.rows.map((row) => row.indexname));

    expect(tableResult.rowCount).toBe(1);
    expect(indexNames.has("idx_trades_market_id")).toBe(true);
    expect(indexNames.has("idx_trades_buy_order_id")).toBe(true);
    expect(indexNames.has("idx_trades_sell_order_id")).toBe(true);
  });

  it("extends internal_order_status enum with PARTIAL", async () => {
    const db = must(pool, "pool");
    const enumResult = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel
       FROM pg_enum
       JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
       WHERE pg_type.typname = 'internal_order_status'
       ORDER BY enumsortorder`
    );

    expect(enumResult.rows.map((row) => row.enumlabel)).toContain("PARTIAL");
  });

  it("prevents duplicate match insertion via the unique constraint", async () => {
    const db = must(pool, "pool");
    const marketId = `market-${randomUUID()}`;
    const buyOrderId = randomUUID();
    const sellOrderId = randomUUID();

    await db.query(
      `INSERT INTO trades (id, market_id, buy_order_id, sell_order_id, price, size)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), marketId, buyOrderId, sellOrderId, "1.25", "10"]
    );

    await expect(
      db.query(
        `INSERT INTO trades (id, market_id, buy_order_id, sell_order_id, price, size)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), marketId, buyOrderId, sellOrderId, "1.25", "10"]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_trades_match"
    });
  });

  it("creates combo netting tables with required indexes and foreign keys", async () => {
    const db = must(pool, "pool");

    expect(await hasComboNettingTables(db)).toBe(true);

    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [[
        "combo_netting_groups",
        "combo_netting_match_legs",
        "combo_netting_events",
        "combo_netting_attempts"
      ]]
    );

    const indexes = await db.query<{ tablename: string; indexname: string }>(
      `SELECT tablename, indexname
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])`,
      [[
        "combo_netting_groups",
        "combo_netting_match_legs",
        "combo_netting_events",
        "combo_netting_attempts"
      ]]
    );

    const constraints = await db.query<{ conname: string; pg_get_constraintdef: string }>(
      `SELECT conname, pg_get_constraintdef(pg_constraint.oid)
         FROM pg_constraint
        WHERE conname = ANY($1::text[])`,
      [[
        "uq_combo_netting_group_pair",
        "uq_combo_netting_match_leg_pair"
      ]]
    );

    const foreignKeys = await db.query<{ table_name: string; constraint_name: string }>(
      `SELECT tc.table_name, tc.constraint_name
         FROM information_schema.table_constraints tc
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = ANY($1::text[])`,
      [[
        "combo_netting_groups",
        "combo_netting_match_legs",
        "combo_netting_events",
        "combo_netting_attempts"
      ]]
    );

    const tableNames = new Set(tables.rows.map((row) => row.table_name));
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    const constraintNames = new Set(constraints.rows.map((row) => row.conname));

    expect(tableNames.has("combo_netting_groups")).toBe(true);
    expect(tableNames.has("combo_netting_match_legs")).toBe(true);
    expect(tableNames.has("combo_netting_events")).toBe(true);
    expect(tableNames.has("combo_netting_attempts")).toBe(true);

    expect(indexNames.has("idx_combo_netting_groups_incoming_combo_id")).toBe(true);
    expect(indexNames.has("idx_combo_netting_groups_matched_combo_id")).toBe(true);
    expect(indexNames.has("idx_combo_netting_groups_created_at")).toBe(true);
    expect(indexNames.has("idx_combo_netting_match_legs_group_id")).toBe(true);
    expect(indexNames.has("idx_combo_netting_match_legs_incoming_leg_id")).toBe(true);
    expect(indexNames.has("idx_combo_netting_match_legs_matched_leg_id")).toBe(true);
    expect(indexNames.has("idx_combo_netting_match_legs_market_outcome")).toBe(true);
    expect(indexNames.has("idx_combo_netting_events_group_id")).toBe(true);
    expect(indexNames.has("idx_combo_netting_events_event_type_created_at")).toBe(true);
    expect(indexNames.has("idx_combo_netting_attempts_incoming_combo_id")).toBe(true);
    expect(indexNames.has("idx_combo_netting_attempts_matched_combo_id")).toBe(true);
    expect(indexNames.has("idx_combo_netting_attempts_group_id")).toBe(true);

    expect(constraintNames.has("uq_combo_netting_group_pair")).toBe(true);
    expect(constraintNames.has("uq_combo_netting_match_leg_pair")).toBe(true);

    expect(foreignKeys.rows.some((row) => row.table_name === "combo_netting_groups")).toBe(true);
    expect(foreignKeys.rows.some((row) => row.table_name === "combo_netting_match_legs")).toBe(true);
    expect(foreignKeys.rows.some((row) => row.table_name === "combo_netting_events")).toBe(true);
    expect(foreignKeys.rows.some((row) => row.table_name === "combo_netting_attempts")).toBe(true);
  });

  it("adds combo_legs.remaining_size with supporting index", async () => {
    const db = must(pool, "pool");

    expect(await hasComboLegRemainingSize(db)).toBe(true);

    const columnResult = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'combo_legs'
          AND column_name = 'remaining_size'`
    );

    const indexResult = await db.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'combo_legs'`
    );

    expect(columnResult.rows[0]?.column_name).toBe("remaining_size");
    expect(columnResult.rows[0]?.is_nullable).toBe("NO");
    expect(indexResult.rows.some((row) => row.indexname === "idx_combo_legs_combo_remaining")).toBe(true);
  });

  it("prevents duplicate combo netting pair matching via unique constraints", async () => {
    const db = must(pool, "pool");
    const comboA = randomUUID();
    const comboB = randomUUID();
    const legA = randomUUID();
    const legB = randomUUID();
    const legC = randomUUID();
    const legD = randomUUID();
    const nettingGroupId = randomUUID();

    await db.query(
      `INSERT INTO combo_rfqs (id, user_id, acceptance_policy, state, expires_at, metadata)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', '{}'::jsonb),
              ($5, $6, $7, $8, NOW() + INTERVAL '1 hour', '{}'::jsonb)`,
      [comboA, randomUUID(), "ALL_OR_NONE", "OPEN", comboB, randomUUID(), "ALL_OR_NONE", "OPEN"]
    );

    await db.query(
      `INSERT INTO combo_legs
        (id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side, size, remaining_size, price_hint, metadata)
       VALUES
        ($1, $2, $3, $4, 'buy', 10, 10, 0.4, '{}'::jsonb),
        ($5, $6, $7, $8, 'sell', 10, 10, 0.4, '{}'::jsonb),
        ($9, $10, $11, $12, 'buy', 10, 10, 0.4, '{}'::jsonb),
        ($13, $14, $15, $16, 'sell', 10, 10, 0.4, '{}'::jsonb)`,
      [
        legA, comboA, randomUUID(), randomUUID(),
        legB, comboA, randomUUID(), randomUUID(),
        legC, comboB, randomUUID(), randomUUID(),
        legD, comboB, randomUUID(), randomUUID()
      ]
    );

    await db.query(
      `INSERT INTO combo_netting_groups (id, incoming_combo_id, matched_combo_id, state, matched_size)
       VALUES ($1, $2, $3, $4, $5)`,
      [nettingGroupId, comboA, comboB, "MATCHED", "5"]
    );

    await expect(
      db.query(
        `INSERT INTO combo_netting_groups (id, incoming_combo_id, matched_combo_id, state, matched_size)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), comboA, comboB, "MATCHED", "5"]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_combo_netting_group_pair"
    });

    await db.query(
      `INSERT INTO combo_netting_match_legs
        (id, netting_group_id, incoming_leg_id, matched_leg_id, market_id, outcome_id, matched_size, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), nettingGroupId, legA, legC, "market-a", "outcome-yes", "5", "0.40"]
    );

    await expect(
      db.query(
        `INSERT INTO combo_netting_match_legs
          (id, netting_group_id, incoming_leg_id, matched_leg_id, market_id, outcome_id, matched_size, price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), nettingGroupId, legA, legC, "market-a", "outcome-yes", "5", "0.40"]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_combo_netting_match_leg_pair"
    });
  });

  it("creates clearing round tables with required indexes and foreign keys", async () => {
    const db = must(pool, "pool");

    expect(await hasClearingRoundTables(db)).toBe(true);

    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [[
        "clearing_rounds",
        "clearing_round_participants",
        "clearing_round_leg_matches",
        "clearing_round_events"
      ]]
    );

    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])`,
      [[
        "clearing_rounds",
        "clearing_round_participants",
        "clearing_round_leg_matches",
        "clearing_round_events"
      ]]
    );

    const constraints = await db.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE conname = ANY($1::text[])`,
      [[
        "uq_clearing_rounds_participant_signature",
        "uq_clearing_round_participants_entry",
        "uq_clearing_round_leg_match"
      ]]
    );

    const foreignKeys = await db.query<{ table_name: string; constraint_name: string }>(
      `SELECT tc.table_name, tc.constraint_name
         FROM information_schema.table_constraints tc
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = ANY($1::text[])`,
      [[
        "clearing_round_participants",
        "clearing_round_leg_matches",
        "clearing_round_events"
      ]]
    );

    const tableNames = new Set(tables.rows.map((row) => row.table_name));
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    const constraintNames = new Set(constraints.rows.map((row) => row.conname));

    expect(tableNames.has("clearing_rounds")).toBe(true);
    expect(tableNames.has("clearing_round_participants")).toBe(true);
    expect(tableNames.has("clearing_round_leg_matches")).toBe(true);
    expect(tableNames.has("clearing_round_events")).toBe(true);

    expect(indexNames.has("idx_clearing_rounds_bucket_created_at")).toBe(true);
    expect(indexNames.has("idx_clearing_rounds_state_created_at")).toBe(true);
    expect(indexNames.has("idx_clearing_rounds_participant_hash")).toBe(true);
    expect(indexNames.has("idx_clearing_round_participants_round_id")).toBe(true);
    expect(indexNames.has("idx_clearing_round_participants_combo_or_order_id")).toBe(true);
    expect(indexNames.has("idx_clearing_round_participants_user_id")).toBe(true);
    expect(indexNames.has("idx_clearing_round_leg_matches_round_id")).toBe(true);
    expect(indexNames.has("idx_clearing_round_leg_matches_market_outcome")).toBe(true);
    expect(indexNames.has("idx_clearing_round_leg_matches_participant_id")).toBe(true);
    expect(indexNames.has("idx_clearing_round_events_round_id")).toBe(true);
    expect(indexNames.has("idx_clearing_round_events_type_created_at")).toBe(true);

    expect(constraintNames.has("uq_clearing_rounds_participant_signature")).toBe(true);
    expect(constraintNames.has("uq_clearing_round_participants_entry")).toBe(true);
    expect(constraintNames.has("uq_clearing_round_leg_match")).toBe(true);

    expect(foreignKeys.rows.some((row) => row.table_name === "clearing_round_participants")).toBe(true);
    expect(foreignKeys.rows.some((row) => row.table_name === "clearing_round_leg_matches")).toBe(true);
    expect(foreignKeys.rows.some((row) => row.table_name === "clearing_round_events")).toBe(true);
  });

  it("prevents duplicate clearing-round replay and participant/leg duplication", async () => {
    const db = must(pool, "pool");
    const roundId = randomUUID();
    const participantId = randomUUID();

    await db.query(
      `INSERT INTO clearing_rounds
        (id, compatibility_bucket, state, participant_count, unique_leg_count, compression_score, participant_set_hash, match_signature_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [roundId, "bucket-a", "MATCHED", 3, 2, "1.50", "participants-hash-a", "signature-hash-a"]
    );

    await expect(
      db.query(
        `INSERT INTO clearing_rounds
          (id, compatibility_bucket, state, participant_count, unique_leg_count, compression_score, participant_set_hash, match_signature_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), "bucket-a", "MATCHED", 3, 2, "1.50", "participants-hash-a", "signature-hash-a"]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_clearing_rounds_participant_signature"
    });

    await db.query(
      `INSERT INTO clearing_round_participants
        (id, clearing_round_id, combo_or_order_id, participant_user_id, role, original_remaining, matched_remaining)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        participantId,
        roundId,
        randomUUID(),
        randomUUID(),
        "INCOMING",
        JSON.stringify({ marketA: "5.0" }),
        JSON.stringify({ marketA: "2.5" })
      ]
    );

    const duplicateComboOrOrderId = await db.query<{ combo_or_order_id: string }>(
      `SELECT combo_or_order_id
         FROM clearing_round_participants
        WHERE id = $1`,
      [participantId]
    );

    await expect(
      db.query(
        `INSERT INTO clearing_round_participants
          (id, clearing_round_id, combo_or_order_id, participant_user_id, role, original_remaining, matched_remaining)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          randomUUID(),
          roundId,
          duplicateComboOrOrderId.rows[0]?.combo_or_order_id,
          randomUUID(),
          "INCOMING",
          JSON.stringify({ marketA: "5.0" }),
          JSON.stringify({ marketA: "2.5" })
        ]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_clearing_round_participants_entry"
    });

    await db.query(
      `INSERT INTO clearing_round_leg_matches
        (id, clearing_round_id, market_id, outcome_id, participant_id, signed_matched_size, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), roundId, "market-a", "outcome-yes", participantId, "2.50", "0.40"]
    );

    await expect(
      db.query(
        `INSERT INTO clearing_round_leg_matches
          (id, clearing_round_id, market_id, outcome_id, participant_id, signed_matched_size, price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), roundId, "market-a", "outcome-yes", participantId, "1.25", "0.41"]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_clearing_round_leg_match"
    });
  });
});
