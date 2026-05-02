import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { pino } from "pino";

import { createRedisClient, type RedisClient } from "../../src/db/redis.js";
import { ComboNettingCompatibilityEngine } from "../../src/core/combo-engine/combo-netting-compatibility-engine.js";
import { MultiLegInternalNettingEngine } from "../../src/core/combo-engine/multi-leg-internal-netting-engine.js";
import { ResourceLocker } from "../../src/core/combo-engine/resource-locker.js";
import { ResidualVectorBuilder } from "../../src/core/combo-engine/residual-vector-builder.js";
import { Phase2BCandidateRegistry } from "../../src/core/combo-engine/phase2b-candidate-registry.js";
import { OverlapGraphBuilder } from "../../src/core/combo-engine/overlap-graph-builder.js";
import { CandidateGroupEnumerator } from "../../src/core/combo-engine/candidate-group-enumerator.js";
import { ClearingCompressionScorer } from "../../src/core/combo-engine/clearing-compression-scorer.js";
import { ClearingRoundPlanner } from "../../src/core/combo-engine/clearing-round-planner.js";
import { ResolutionRiskReadService } from "../../src/core/rfq-engine/resolution-risk-read-service.js";
import { ResolutionRiskEligibilityService } from "../../src/core/rfq-engine/resolution-risk-eligibility-service.js";
import type { MultiLegInternalNettingInput, ResidualVectorEntity } from "../../src/core/combo-engine/types.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });
const VERSION = "resolution-risk-v1";

const applyMigrations = async (pool: Pool): Promise<void> => {
  const migrationDirs = [
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

const buildLegMetadata = (
  profileId: string,
  resolutionUniverse = "event-1"
): Record<string, unknown> => ({
  resolution_profile_id: profileId,
  resolutionUniverse,
  expiryClass: "fixed",
  settlementModel: "cash",
  resolutionRuleClass: "oracle"
});

describe.skipIf(!ENV_READY)("internal execution resolution-risk eligibility integration", () => {
  let pool: Pool;
  let redis: RedisClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
    redis = createRedisClient({ redisUrl: TEST_REDIS_URL as string, logger });
    await redis.connect();
  }, 180000);

  afterAll(async () => {
    if (redis) {
      try {
        await redis.quit();
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("Connection is closed")) {
          throw error;
        }
      }
    }
    await pool.end();
  }, 180000);

  beforeEach(async () => {
    await pool.query(
      `DELETE FROM combo_rfqs
        WHERE metadata->>'test_suite' = 'internal-execution-resolution-risk'`
    );
    await pool.query(
      `DELETE FROM resolution_risk_assessments
        WHERE canonical_event_id IN (
          SELECT canonical_event_id
            FROM resolution_profiles
           WHERE metadata->>'test_suite' = 'internal-execution-resolution-risk'
        )`
    );
    await pool.query(
      `DELETE FROM resolution_profiles
        WHERE metadata->>'test_suite' = 'internal-execution-resolution-risk'`
    );
  });

  const insertProfile = async (
    canonicalEventId: string,
    venue: string,
    venueMarketId: string
  ): Promise<string> => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO resolution_profiles (
         id, venue, venue_market_id, canonical_event_id, oracle_type, oracle_name,
         resolution_authority_type, primary_resolution_text, market_type, outcome_schema, metadata
       )
       VALUES (
         $1, $2, $3, $4, 'oracle', 'default-oracle',
         'oracle', 'Resolves to the declared outcome.', 'binary', '{"type":"binary"}'::jsonb, $5::jsonb
       )`,
      [
        id,
        venue,
        venueMarketId,
        canonicalEventId,
        JSON.stringify({ test_suite: "internal-execution-resolution-risk" })
      ]
    );
    return id;
  };

  const insertAssessment = async (
    canonicalEventId: string,
    marketAProfileId: string,
    marketBProfileId: string,
    equivalenceClass: "SAFE_EQUIVALENT" | "CAUTION" | "HIGH_RISK" | "DO_NOT_POOL"
  ): Promise<void> => {
    const [left, right] = marketAProfileId.localeCompare(marketBProfileId) <= 0
      ? [marketAProfileId, marketBProfileId]
      : [marketBProfileId, marketAProfileId];
    await pool.query(
      `INSERT INTO resolution_risk_assessments (
         id, canonical_event_id, market_a_profile_id, market_b_profile_id,
         risk_score, confidence_score, equivalence_class, factor_breakdown, reasons, version
       )
       VALUES (
         $1, $2, $3, $4, '0.1', '0.9', $5, '{}'::jsonb, '[]'::jsonb, $6
       )`,
      [randomUUID(), canonicalEventId, left, right, equivalenceClass, VERSION]
    );
  };

  const insertCombo = async (
    comboId: string,
    userId: string,
    legId: string,
    marketId: string,
    outcomeId: string,
    side: "buy" | "sell",
    profileId: string,
    resolutionUniverse = "event-1"
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO combo_rfqs (id, user_id, acceptance_policy, state, expires_at, metadata)
       VALUES ($1, $2, 'ALL_OR_NONE', 'OPEN', NOW() + INTERVAL '1 hour', $3::jsonb)`,
      [comboId, userId, JSON.stringify({ test_suite: "internal-execution-resolution-risk" })]
    );
    await pool.query(
      `INSERT INTO combo_legs (
         id, combo_rfq_id, canonical_market_id, canonical_outcome_id, side, size, remaining_size, price_hint, metadata
       )
       VALUES ($1, $2, $3, $4, $5, 10, 10, 0.60, $6::jsonb)`,
      [legId, comboId, marketId, outcomeId, side, JSON.stringify(buildLegMetadata(profileId, resolutionUniverse))]
    );
  };

  const loadResidualEntity = async (comboId: string): Promise<ResidualVectorEntity> => {
    const combo = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM combo_rfqs WHERE id = $1 LIMIT 1`,
      [comboId]
    );
    const userId = combo.rows[0]?.user_id;
    if (!userId) {
      throw new Error(`missing_combo:${comboId}`);
    }
    const legs = await pool.query<{
      id: string;
      canonical_market_id: string;
      canonical_outcome_id: string;
      side: "buy" | "sell";
      remaining_size: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, canonical_market_id::text, canonical_outcome_id::text, side, remaining_size::text, metadata
         FROM combo_legs
        WHERE combo_rfq_id = $1
        ORDER BY id ASC`,
      [comboId]
    );

    return {
      entityId: comboId,
      userId,
      legs: legs.rows.map((row) => ({
        id: row.id,
        canonicalMarketId: row.canonical_market_id,
        canonicalOutcomeId: row.canonical_outcome_id,
        side: row.side,
        remainingSize: row.remaining_size,
        metadata: row.metadata
      }))
    };
  };

  it.each(["CAUTION", "HIGH_RISK", "DO_NOT_POOL"] as const)(
    "Phase 2A excludes %s cross-profile candidate combos",
    async (equivalenceClass) => {
      const canonicalEventId = randomUUID();
      const marketId = randomUUID();
      const outcomeId = randomUUID();
      const incomingProfileId = await insertProfile(canonicalEventId, "venue-a", `market-${randomUUID()}`);
      const candidateProfileId = await insertProfile(canonicalEventId, "venue-b", `market-${randomUUID()}`);
      await insertAssessment(canonicalEventId, incomingProfileId, candidateProfileId, equivalenceClass);

      const incomingComboId = randomUUID();
      const candidateComboId = randomUUID();
      const incomingLegId = randomUUID();
      const candidateLegId = randomUUID();
      const incomingUserId = randomUUID();
      const candidateUserId = randomUUID();

      await insertCombo(incomingComboId, incomingUserId, incomingLegId, marketId, outcomeId, "buy", incomingProfileId);
      await insertCombo(candidateComboId, candidateUserId, candidateLegId, marketId, outcomeId, "sell", candidateProfileId);

      const readService = new ResolutionRiskReadService({ pool, version: VERSION });
      const eligibilityService = new ResolutionRiskEligibilityService({ readService });
      const engine = new MultiLegInternalNettingEngine(
        pool,
        {
          findCandidateCombos: vi.fn(async () => [candidateComboId]),
          registerComboCandidate: vi.fn(async (combo) => ({ comboId: combo.id, registeredKeys: [] as const })),
          unregisterComboCandidate: vi.fn(async (comboId: string) => ({ comboId, removedFromKeys: [] as const, removed: true }))
        },
        new ComboNettingCompatibilityEngine(),
        new ResourceLocker(redis, { baseDelayMs: 10, maxRetries: 2, lockTtlMs: 3000 }),
        logger,
        eligibilityService
      );

      const result = await engine.attemptNet({
        id: incomingComboId,
        userId: incomingUserId,
        state: "OPEN",
        legs: [
          {
            id: incomingLegId,
            canonicalMarketId: marketId,
            canonicalOutcomeId: outcomeId,
            side: "buy",
            remainingSize: "10",
            priceHint: "0.6"
          }
        ]
      } satisfies MultiLegInternalNettingInput);

      const nettingGroups = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM combo_netting_groups
          WHERE incoming_combo_id = $1 AND matched_combo_id = $2`,
        [incomingComboId, candidateComboId]
      );
      const journals = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM exposure_journal
          WHERE source = 'combo-internal-net'
            AND reference_id IN (
              SELECT id
                FROM combo_netting_groups
               WHERE incoming_combo_id = $1 AND matched_combo_id = $2
            )`,
        [incomingComboId, candidateComboId]
      );

      expect(result.nettedSize).toBe("0");
      expect(Number(nettingGroups.rows[0]?.count ?? "0")).toBe(0);
      expect(Number(journals.rows[0]?.count ?? "0")).toBe(0);
    }
  );

  it("Phase 2B planner excludes non-safe mixed-profile groups and allows SAFE_EQUIVALENT groups", async () => {
    const canonicalEventId = randomUUID();
    const marketId = randomUUID();
    const outcomeId = randomUUID();
    const resolutionUniverse = `event-${randomUUID()}`;
    const safeProfileA = await insertProfile(canonicalEventId, "venue-a", `market-${randomUUID()}`);
    const safeProfileB = await insertProfile(canonicalEventId, "venue-b", `market-${randomUUID()}`);
    const blockedProfile = await insertProfile(canonicalEventId, "venue-c", `market-${randomUUID()}`);
    await insertAssessment(canonicalEventId, safeProfileA, safeProfileB, "SAFE_EQUIVALENT");
    await insertAssessment(canonicalEventId, safeProfileA, blockedProfile, "CAUTION");
    await insertAssessment(canonicalEventId, safeProfileB, blockedProfile, "CAUTION");

    const comboA = randomUUID();
    const comboB = randomUUID();
    const comboC = randomUUID();
    await insertCombo(comboA, randomUUID(), randomUUID(), marketId, outcomeId, "buy", safeProfileA, resolutionUniverse);
    await insertCombo(comboB, randomUUID(), randomUUID(), marketId, outcomeId, "sell", safeProfileB, resolutionUniverse);
    await insertCombo(comboC, randomUUID(), randomUUID(), marketId, outcomeId, "sell", blockedProfile, resolutionUniverse);

    const vectorBuilder = new ResidualVectorBuilder();
    const registry = new Phase2BCandidateRegistry(redis as never);
    const readService = new ResolutionRiskReadService({ pool, version: VERSION });
    const eligibilityService = new ResolutionRiskEligibilityService({ readService });
    const planner = new ClearingRoundPlanner(
      registry,
      new OverlapGraphBuilder(),
      new CandidateGroupEnumerator(),
      new ClearingCompressionScorer(),
      eligibilityService
    );

    for (const comboId of [comboA, comboB, comboC]) {
      await registry.registerEntity(vectorBuilder.build(await loadResidualEntity(comboId)));
    }

    const blockedPlan = await planner.plan(`${resolutionUniverse}|fixed|cash|oracle`, {
      bucketWindowLimit: 10,
      maxParticipants: 4,
      maxUniqueLegs: 6,
      stpMode: "NONE"
    });

    expect(blockedPlan?.selectedGroup.participantIds).toEqual(
      [comboA, comboB].sort((left, right) => left.localeCompare(right))
    );
    expect(blockedPlan?.selectedGroup.participantIds).not.toContain(comboC);
  }, 20000);
});
