import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { ResolutionPairComparator } from "../../src/core/rfq-engine/resolution-pair-comparator.js";
import { ResolutionRiskScoringEngine } from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import { ResolutionRiskAssessmentService } from "../../src/core/rfq-engine/resolution-risk-assessment-service.js";
import {
    ResolutionRiskAdminProfileNotFoundError,
    ResolutionRiskAdminService,
    ResolutionRiskKillSwitchActiveError,
} from "../../src/api/admin/resolution-risk-admin-service.js";
import {
    connectRedis,
    createRedisClient,
    disconnectRedis,
    type RedisClient,
} from "../../src/db/redis.js";
import { RESOLUTION_RISK_KILL_SWITCH_KEY } from "../../src/core/rfq-engine/resolution-risk-runtime-controls.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);

const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

const applyMigrations = async (pool: Pool): Promise<void> => {
    const migrationDirs = [
        path.resolve(process.cwd(), "sql", "migrations"),
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

describe.skipIf(!ENV_READY)("resolution risk admin service integration", () => {
    let pool: Pool | undefined;
    let redis: RedisClient | undefined;
    const createdProfileIds = new Set<string>();

    const must = <T>(value: T | undefined, name: string): T => {
        if (value === undefined) {
            throw new Error(`${name} not initialized`);
        }
        return value;
    };

    const createAssessmentService = () =>
        new ResolutionRiskAssessmentService({
            pool: must(pool, "pool"),
            comparator: new ResolutionPairComparator(),
            scoringEngine: new ResolutionRiskScoringEngine(),
            logger,
            config: { version: "resolution-risk-v1" },
        });

    const createAdminService = () =>
        new ResolutionRiskAdminService({
            pool: must(pool, "pool"),
            redis: must(redis, "redis"),
            assessmentService: createAssessmentService(),
            logger,
            version: "resolution-risk-v1",
        });

    const insertProfile = async (
        canonicalEventId: string,
        overrides: Partial<{
            venue: string;
            venueMarketId: string;
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
        }> = {},
    ): Promise<string> => {
        const db = must(pool, "pool");
        const id = randomUUID();
        createdProfileIds.add(id);

        await db.query(
            `INSERT INTO resolution_profiles
                (id, venue, venue_market_id, canonical_event_id, oracle_type, oracle_name, resolution_authority_type,
                 primary_resolution_text, supplemental_rules_text, dispute_window_hours, settlement_lag_hours,
                 market_type, outcome_schema, historical_divergence_rate, metadata)
             VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15::jsonb)`,
            [
                id,
                overrides.venue ?? "venue-a",
                overrides.venueMarketId ?? `market-${id}`,
                canonicalEventId,
                overrides.oracleType ?? "manual_committee",
                overrides.oracleName ?? "Resolution Committee",
                overrides.resolutionAuthorityType ?? "committee",
                overrides.primaryResolutionText ?? "Market resolves YES if the event occurs before deadline.",
                overrides.supplementalRulesText ?? "Primary bulletin governs disputes.",
                overrides.disputeWindowHours ?? "24",
                overrides.settlementLagHours ?? "12",
                overrides.marketType ?? "binary",
                JSON.stringify(overrides.outcomeSchema ?? { outcomes: ["YES", "NO"] }),
                overrides.historicalDivergenceRate ?? "0.01",
                JSON.stringify({ test_suite: "resolution-risk-admin-service" }),
            ],
        );

        return id;
    };

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DB_URL as string });
        await applyMigrations(must(pool, "pool"));
        redis = createRedisClient({ redisUrl: TEST_REDIS_URL as string, logger: logger as never });
        await connectRedis(must(redis, "redis"));
    }, 180000);

    afterEach(async () => {
        if (redis) {
            try {
                await redis.del(RESOLUTION_RISK_KILL_SWITCH_KEY);
            } catch (error) {
                const message = error instanceof Error ? error.message : "";
                if (!message.includes("Connection is closed")) {
                    throw error;
                }
            }
        }
        if (createdProfileIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM resolution_profiles WHERE id = ANY($1::uuid[])`, [[...createdProfileIds]]);
            createdProfileIds.clear();
        }
    });

    afterAll(async () => {
        if (redis) {
            try {
                await disconnectRedis(redis);
            } catch (error) {
                const message = error instanceof Error ? error.message : "";
                if (!message.includes("Connection is closed")) {
                    throw error;
                }
            }
        }
        if (pool) {
            await pool.end();
        }
    }, 180000);

    it("computes freshness correctly for incomplete and complete pair sets", async () => {
        const canonicalEventId = randomUUID();
        await insertProfile(canonicalEventId);
        await insertProfile(canonicalEventId, { venueMarketId: "market-b" });
        await insertProfile(canonicalEventId, { venueMarketId: "market-c" });

        const admin = createAdminService();
        const incomplete = await admin.getCanonicalInspection(canonicalEventId);
        expect(incomplete.freshness.profileCount).toBe(3);
        expect(incomplete.freshness.expectedPairCount).toBe(3);
        expect(incomplete.freshness.persistedPairCount).toBe(0);
        expect(incomplete.freshness.isComplete).toBe(false);
        expect(incomplete.freshness.isStale).toBe(true);
        expect(incomplete.scoringVersion).toBe("resolution-risk-v1");

        await admin.recomputeCanonicalAssessments({ canonicalEventId, requestedBy: "admin-1" });
        const complete = await admin.getCanonicalInspection(canonicalEventId);
        expect(complete.assessments).toHaveLength(3);
        expect(complete.freshness.persistedPairCount).toBe(3);
        expect(complete.freshness.isComplete).toBe(true);
        expect(complete.freshness.isStale).toBe(false);
        expect(complete.scoringVersion).toBe("resolution-risk-v1");
    });

    it("recomputes the full canonical event pair set for a profile", async () => {
        const canonicalEventId = randomUUID();
        const profileId = await insertProfile(canonicalEventId);
        await insertProfile(canonicalEventId, { oracleType: "api_oracle", venueMarketId: "market-b" });
        await insertProfile(canonicalEventId, { primaryResolutionText: "Market resolves YES only if officially confirmed before cutoff.", venueMarketId: "market-c" });

        const result = await createAdminService().recomputeProfileAssessments({
            profileId,
            requestedBy: "admin-1",
        });

        expect(result.canonicalEventId).toBe(canonicalEventId);
        expect(result.assessmentCount).toBe(3);

        const inspection = await createAdminService().getCanonicalInspection(canonicalEventId);
        expect(inspection.assessments).toHaveLength(3);
        expect(inspection.assessments.every((assessment) => assessment.version === "resolution-risk-v1")).toBe(true);
        expect(inspection.assessments).toEqual(
            [...inspection.assessments].sort(
                (left, right) =>
                    left.marketAProfileId.localeCompare(right.marketAProfileId) ||
                    left.marketBProfileId.localeCompare(right.marketBProfileId),
            ),
        );
    });

    it("canonical recompute upserts deterministically without duplicating same-version pairs", async () => {
        const canonicalEventId = randomUUID();
        await insertProfile(canonicalEventId);
        await insertProfile(canonicalEventId, { venueMarketId: "market-b" });
        await insertProfile(canonicalEventId, { venueMarketId: "market-c" });

        const admin = createAdminService();
        await admin.recomputeCanonicalAssessments({ canonicalEventId, requestedBy: "admin-1" });
        await admin.recomputeCanonicalAssessments({ canonicalEventId, requestedBy: "admin-1" });

        const countResult = await must(pool, "pool").query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
               FROM resolution_risk_assessments
              WHERE canonical_event_id = $1
                AND version = 'resolution-risk-v1'`,
            [canonicalEventId],
        );

        expect(countResult.rows[0]?.count).toBe("3");
    });

    it("kill switch blocks recompute but not inspection", async () => {
        const canonicalEventId = randomUUID();
        const profileId = await insertProfile(canonicalEventId);
        await insertProfile(canonicalEventId, { venueMarketId: "market-b" });

        await must(redis, "redis").set(RESOLUTION_RISK_KILL_SWITCH_KEY, "true", "PX", 60000);

        const admin = createAdminService();
        await expect(
            admin.recomputeProfileAssessments({ profileId, requestedBy: "admin-1" }),
        ).rejects.toBeInstanceOf(ResolutionRiskKillSwitchActiveError);

        const inspection = await admin.getCanonicalInspection(canonicalEventId);
        expect(inspection.canonicalEventId).toBe(canonicalEventId);
        expect(inspection.profiles).toHaveLength(2);
    });

    it("raises profile not found for profile recompute", async () => {
        await expect(
            createAdminService().recomputeProfileAssessments({
                profileId: randomUUID(),
                requestedBy: "admin-1",
            }),
        ).rejects.toBeInstanceOf(ResolutionRiskAdminProfileNotFoundError);
    });
});
