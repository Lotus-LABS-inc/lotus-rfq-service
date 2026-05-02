import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { metricsRegistry, resolutionRiskShadowDivergenceTotal } from "../../src/observability/metrics.js";
import { ResolutionRiskGroupingService } from "../../src/core/rfq-engine/resolution-risk-grouping-service.js";
import { ResolutionRiskReadService } from "../../src/core/rfq-engine/resolution-risk-read-service.js";
import { ResolutionRiskPolicyService } from "../../src/core/rfq-engine/resolution-risk-policy-service.js";
import { ResolutionRiskEligibilityService } from "../../src/core/rfq-engine/resolution-risk-eligibility-service.js";
import { decisionFromEquivalenceClass } from "../../src/core/sor/resolution-risk-routing-policy.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);
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

describe.skipIf(!ENV_READY)("resolution risk shadow integration", () => {
  let pool: Pool | undefined;
  const createdProfileIds = new Set<string>();

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name} not initialized`);
    }
    return value;
  };

  const makePolicyService = () =>
    new ResolutionRiskPolicyService({
      enabled: false,
      shadowEnabled: true,
      shadowPercent: 1,
      now: () => new Date("2026-03-11T12:00:00.000Z"),
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      }
    });

  const makeReadService = () =>
    new ResolutionRiskReadService({
      pool: must(pool, "pool"),
      version: VERSION
    });

  const insertProfile = async (
    canonicalEventId: string,
    venue: string,
    venueMarketId: string
  ): Promise<string> => {
    const id = randomUUID();
    createdProfileIds.add(id);
    await must(pool, "pool").query(
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
        JSON.stringify({ test_suite: "resolution-risk-shadow" })
      ]
    );
    return id;
  };

  const insertAssessment = async (
    canonicalEventId: string,
    profileAId: string,
    profileBId: string,
    equivalenceClass: "SAFE_EQUIVALENT" | "CAUTION" | "HIGH_RISK" | "DO_NOT_POOL"
  ): Promise<void> => {
    const [left, right] =
      profileAId.localeCompare(profileBId) <= 0
        ? [profileAId, profileBId]
        : [profileBId, profileAId];

    await must(pool, "pool").query(
      `INSERT INTO resolution_risk_assessments (
         id, canonical_event_id, market_a_profile_id, market_b_profile_id,
         risk_score, confidence_score, equivalence_class, factor_breakdown, reasons, version
       )
       VALUES (
         $1, $2, $3, $4, '0.8', '0.9', $5, '{}'::jsonb, '["shadow-test"]'::jsonb, $6
       )`,
      [randomUUID(), canonicalEventId, left, right, equivalenceClass, VERSION]
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(must(pool, "pool"));
  }, 180000);

  afterEach(async () => {
    metricsRegistry.resetMetrics();
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

  it("computes RFQ grouping in shadow mode without enforcing blocked or caution lanes", async () => {
    const canonicalEventId = randomUUID();
    const safeProfile = await insertProfile(canonicalEventId, "venue-a", `market-${randomUUID()}`);
    const cautionProfile = await insertProfile(canonicalEventId, "venue-b", `market-${randomUUID()}`);
    const blockedProfile = await insertProfile(canonicalEventId, "venue-c", `market-${randomUUID()}`);

    await insertAssessment(canonicalEventId, safeProfile, cautionProfile, "CAUTION");
    await insertAssessment(canonicalEventId, safeProfile, blockedProfile, "DO_NOT_POOL");
    await insertAssessment(canonicalEventId, cautionProfile, blockedProfile, "HIGH_RISK");

    const groupingService = new ResolutionRiskGroupingService({
      pool: must(pool, "pool"),
      readService: makeReadService(),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });
    const rawGrouping = await groupingService.groupProfilesForCanonicalEvent(canonicalEventId);
    const result = makePolicyService().applyRFQGrouping(rawGrouping, "rfq-shadow-event");

    expect(rawGrouping.cautionLanes).toEqual([]);
    expect(rawGrouping.blockedProfiles).toEqual(
      [blockedProfile, cautionProfile, safeProfile].sort((left, right) => left.localeCompare(right))
    );
    expect(result.enforcementActive).toBe(false);
    expect(result.mode).toBe("shadow");
    expect(result.grouping.safePools).toEqual([[blockedProfile, cautionProfile, safeProfile].sort((a, b) => a.localeCompare(b))]);
    expect(result.grouping.cautionLanes).toEqual([]);
    expect(result.grouping.blockedProfiles).toEqual([]);
    expect(result.shadowGrouping).toEqual(rawGrouping);
  });

  it("computes SOR shadow decisions from persisted assessments without enforcing the penalty or block", async () => {
    const canonicalEventId = randomUUID();
    const profileA = await insertProfile(canonicalEventId, "venue-a", `market-${randomUUID()}`);
    const profileB = await insertProfile(canonicalEventId, "venue-b", `market-${randomUUID()}`);
    await insertAssessment(canonicalEventId, profileA, profileB, "DO_NOT_POOL");

    const assessment = await makeReadService().getAssessmentByProfilePair(profileA, profileB);
    expect(assessment?.equivalenceClass).toBe("DO_NOT_POOL");

    const rawDecision = decisionFromEquivalenceClass(assessment!.equivalenceClass, 0.05);
    const result = makePolicyService().evaluateSORDecision({
      stableKey: "sor-shadow-event",
      intendedDecision: rawDecision.mode,
      reason: rawDecision.reason ?? rawDecision.mode,
      equivalenceClass: assessment!.equivalenceClass,
      canonicalEventId,
      profileAId: profileA,
      profileBId: profileB
    });

    expect(result.enforcementActive).toBe(false);
    expect(result.enforcedDecision).toBe("normal");
    expect(result.shadowDecision).toMatchObject({
      outcome: "blocked",
      equivalenceClass: "DO_NOT_POOL"
    });

    const divergenceMetric = await resolutionRiskShadowDivergenceTotal.get();
    const divergenceValue = divergenceMetric.values.find(
      (value) => value.labels.domain === "sor" && value.labels.reason === "blocked_vs_allowed"
    );
    expect(divergenceValue?.value).toBe(1);
  });

  it("computes internal-execution shadow exclusions without rejecting the candidate", async () => {
    const canonicalEventId = randomUUID();
    const profileA = await insertProfile(canonicalEventId, "venue-a", `market-${randomUUID()}`);
    const profileB = await insertProfile(canonicalEventId, "venue-b", `market-${randomUUID()}`);
    await insertAssessment(canonicalEventId, profileA, profileB, "HIGH_RISK");

    const eligibilityService = new ResolutionRiskEligibilityService({
      readService: makeReadService(),
      policyService: makePolicyService()
    });

    const allowed = await eligibilityService.isSafeForCrossVenueNetting(profileA, profileB, {
      stableKey: "internal-shadow-event",
      canonicalEventId
    });

    expect(allowed).toBe(true);
  });
});
