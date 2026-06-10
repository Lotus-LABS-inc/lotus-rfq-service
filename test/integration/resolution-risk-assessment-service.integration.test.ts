import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { config as loadDotenv } from "dotenv";
import { ResolutionPairComparator } from "../../src/core/rfq-engine/resolution-pair-comparator.js";
import { ResolutionRiskScoringEngine } from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import { ResolutionRiskAssessmentService } from "../../src/core/rfq-engine/resolution-risk-assessment-service.js";

loadDotenv({ path: path.resolve(process.cwd(), ".env"), override: true });

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

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
        if (code === "42P07" || code === "42710" || code === "42701" || code === "42P06" || code === "42723" || code === "42701") {
          continue;
        }
        throw error;
      }
    }
  }
};

describe.skipIf(!ENV_READY)("resolution risk assessment service integration", () => {
  let pool: Pool | undefined;
  const createdProfileIds = new Set<string>();

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name} not initialized`);
    }
    return value;
  };

  const service = () =>
    new ResolutionRiskAssessmentService({
      pool: must(pool, "pool"),
      comparator: new ResolutionPairComparator(),
      scoringEngine: new ResolutionRiskScoringEngine(),
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      },
      config: { version: "resolution-risk-v1" }
    });

  const insertProfile = async (
    canonicalEventId: string,
    overrides: Partial<{
      oracleType: string;
      oracleName: string | null;
      resolutionAuthorityType: string;
      primaryResolutionText: string;
      supplementalRulesText: string | null;
      disputeWindowHours: string | null;
      settlementLagHours: string | null;
      marketType: string;
      outcomeSchema: Record<string, unknown>;
      historicalDivergenceRate: string | null;
    }> = {}
  ): Promise<string> => {
    const db = must(pool, "pool");
    const id = randomUUID();
    createdProfileIds.add(id);

    await db.query(
      `INSERT INTO resolution_profiles
        (id, venue, venue_market_id, canonical_event_id, canonical_market_id, oracle_type, oracle_name, resolution_authority_type,
         primary_resolution_text, supplemental_rules_text, dispute_window_hours, settlement_lag_hours,
         market_type, outcome_schema, historical_divergence_rate, metadata)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16::jsonb)`,
      [
        id,
        "venue-a",
        `market-${id}`,
        canonicalEventId,
        `canonical-market-${canonicalEventId}`,
        overrides.oracleType ?? "manual_committee",
        overrides.oracleName ?? "Resolution Committee",
        overrides.resolutionAuthorityType ?? "committee",
        overrides.primaryResolutionText ?? "Market resolves YES if the event occurs before deadline.",
        overrides.supplementalRulesText ?? "Primary venue bulletin controls if disputes arise.",
        overrides.disputeWindowHours ?? "24",
        overrides.settlementLagHours ?? "12",
        overrides.marketType ?? "binary",
        JSON.stringify(overrides.outcomeSchema ?? { outcomes: ["YES", "NO"] }),
        overrides.historicalDivergenceRate ?? "0.01",
        JSON.stringify({ testSuite: "resolution-risk-assessment-service" })
      ]
    );

    return id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(must(pool, "pool"));
  }, 180000);

  afterEach(async () => {
    if (createdProfileIds.size === 0) {
      return;
    }

    await must(pool, "pool").query(`DELETE FROM resolution_profiles WHERE id = ANY($1::uuid[])`, [[...createdProfileIds]]);
    createdProfileIds.clear();
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 180000);

  it("builds all unique pairs exactly once for one canonical event", async () => {
    const canonicalEventId = randomUUID();
    await insertProfile(canonicalEventId);
    await insertProfile(canonicalEventId, { oracleName: "Backup Committee" });
    await insertProfile(canonicalEventId, { supplementalRulesText: "Supplemental bulletin adds settlement clarifications." });

    const assessments = await service().buildAssessmentsForCanonicalEvent(canonicalEventId);

    expect(assessments).toHaveLength(3);

    const persisted = await must(pool, "pool").query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM resolution_risk_assessments
        WHERE canonical_event_id = $1
          AND version = 'resolution-risk-v1'`,
      [canonicalEventId]
    );

    expect(persisted.rows[0]?.count).toBe("3");
  });

  it("persists one pair with canonical ordering regardless of comparePair input order", async () => {
    const canonicalEventId = randomUUID();
    const higher = await insertProfile(canonicalEventId);
    const lower = await insertProfile(canonicalEventId);

    const result = await service().comparePair(higher, lower);

    expect([result.marketAProfileId, result.marketBProfileId]).toEqual(
      [higher, lower].sort((left, right) => left.localeCompare(right))
    );
  });

  it("recomputes the full canonical event pair set for one profile", async () => {
    const canonicalEventId = randomUUID();
    const profileA = await insertProfile(canonicalEventId);
    await insertProfile(canonicalEventId, { oracleType: "api_oracle" });
    await insertProfile(canonicalEventId, { primaryResolutionText: "Market resolves YES if the event is officially confirmed before expiry." });

    await service().buildAssessmentsForCanonicalEvent(canonicalEventId);

    await must(pool, "pool").query(
      `UPDATE resolution_profiles
          SET oracle_type = $2,
              updated_at = now()
        WHERE id = $1`,
      [profileA, "third_party_oracle"]
    );

    const recomputed = await service().recomputeProfileAssessments(profileA);

    expect(recomputed).toHaveLength(3);

    const persisted = await must(pool, "pool").query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM resolution_risk_assessments
        WHERE canonical_event_id = $1
          AND version = 'resolution-risk-v1'`,
      [canonicalEventId]
    );

    expect(persisted.rows[0]?.count).toBe("3");
  });

  it("updates same-version assessments instead of inserting duplicates", async () => {
    const canonicalEventId = randomUUID();
    const profileA = await insertProfile(canonicalEventId);
    const profileB = await insertProfile(canonicalEventId, { oracleType: "api_oracle" });

    const first = await service().comparePair(profileA, profileB);

    await must(pool, "pool").query(
      `UPDATE resolution_profiles
          SET primary_resolution_text = $2,
              updated_at = now()
        WHERE id = $1`,
      [profileB, "Market resolves YES only if the event is confirmed before official cutoff."]
    );

    const second = await service().comparePair(profileA, profileB);

    expect(second.id).toBe(first.id);

    const persisted = await must(pool, "pool").query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM resolution_risk_assessments
        WHERE canonical_event_id = $1
          AND market_a_profile_id = LEAST($2::uuid, $3::uuid)
          AND market_b_profile_id = GREATEST($2::uuid, $3::uuid)
          AND version = 'resolution-risk-v1'`,
      [canonicalEventId, profileA, profileB]
    );

    expect(persisted.rows[0]?.count).toBe("1");
  });

  it("fails closed for cross-event comparePair and persists nothing", async () => {
    const profileA = await insertProfile(randomUUID());
    const profileB = await insertProfile(randomUUID());

    await expect(service().comparePair(profileA, profileB)).rejects.toThrow("cross_event_pair_not_allowed");

    const persisted = await must(pool, "pool").query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM resolution_risk_assessments
        WHERE market_a_profile_id = LEAST($1::uuid, $2::uuid)
           OR market_b_profile_id = GREATEST($1::uuid, $2::uuid)`,
      [profileA, profileB]
    );

    expect(persisted.rows[0]?.count).toBe("0");
  });
});
