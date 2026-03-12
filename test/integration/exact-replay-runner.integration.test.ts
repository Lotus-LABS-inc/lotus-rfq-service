import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { ReplayEnvelopeWriter } from "../../src/core/replay/replay-envelope-writer.js";
import { ExactReplayRunner } from "../../src/core/replay/exact-replay-runner.js";
import { ResolutionRiskSnapshotBuilder } from "../../src/core/replay/builders/resolution-risk-snapshot-builder.js";
import { RFQGroupingSnapshotBuilder } from "../../src/core/replay/builders/rfq-grouping-snapshot-builder.js";
import { SORSnapshotBuilder } from "../../src/core/replay/builders/sor-snapshot-builder.js";
import { ResolutionPairComparator } from "../../src/core/rfq-engine/resolution-pair-comparator.js";
import { ResolutionRiskScoringEngine } from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import { CostModel } from "../../src/core/sor/cost-model.js";
import { Splitter } from "../../src/core/sor/splitter.js";
import { replayRFQGrouping } from "../../src/core/replay/evaluators/rfq-grouping-replay-evaluator.js";
import { replaySORPlan } from "../../src/core/replay/evaluators/sor-plan-replay-evaluator.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

const applyMigrations = async (pool: Pool): Promise<void> => {
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

describe.skipIf(!ENV_READY)("ExactReplayRunner integration", () => {
    let pool: Pool | undefined;
    const createdEnvelopeIds = new Set<string>();

    const must = <T>(value: T | undefined, name: string): T => {
        if (value === undefined) {
            throw new Error(`${name} not initialized`);
        }
        return value;
    };

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DB_URL as string });
        await applyMigrations(must(pool, "pool"));
    }, 180000);

    afterAll(async () => {
        if (createdEnvelopeIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM replay_envelopes WHERE id = ANY($1::uuid[])`, [[...createdEnvelopeIds]]);
        }

        if (pool) {
            await pool.end();
        }
    }, 180000);

    const makeRunner = () =>
        new ExactReplayRunner({
            pool: must(pool, "pool"),
            resolutionPairComparator: new ResolutionPairComparator(),
            resolutionRiskScoringEngine: new ResolutionRiskScoringEngine(),
            costModel: new CostModel(),
            splitter: new Splitter(),
            overlapGraphBuilder: {
                build: (vectors) => ({
                    nodes: vectors.map((vector: any) => ({
                        entityId: vector.entityId,
                        userId: vector.userId,
                        compatibilityBucket: vector.compatibilityBucket,
                        vector: vector.vector,
                        legCount: vector.legCount,
                        grossAbsSize: vector.grossAbsSize,
                        ...(vector.resolutionProfileId !== undefined ? { resolutionProfileId: vector.resolutionProfileId } : {})
                    })),
                    edges: []
                })
            },
            candidateGroupEnumerator: {
                enumerate: () => []
            },
            clearingCompressionScorer: {
                score: () => {
                    throw new Error("not used in this integration slice");
                }
            }
        });

    it("loads and replays a stored resolution risk envelope to MATCH", async () => {
        const builder = new ResolutionRiskSnapshotBuilder();
        const comparator = new ResolutionPairComparator();
        const scoringEngine = new ResolutionRiskScoringEngine();
        const profileA = {
            id: `profile-${randomUUID()}`,
            venue: "venue-a",
            venueMarketId: "mkt-a",
            canonicalEventId: `event-${randomUUID()}`,
            oracleType: "manual",
            oracleName: "oracle-a",
            resolutionAuthorityType: "committee",
            primaryResolutionText: "Will event happen",
            supplementalRulesText: "same rules",
            disputeWindowHours: "24",
            settlementLagHours: "12",
            marketType: "binary",
            outcomeSchema: { yes: 1, no: 0 },
            hasAmbiguousTimeBoundary: false,
            hasAmbiguousJurisdictionBoundary: false,
            hasAmbiguousSourceReference: false,
            historicalDivergenceRate: "0.001",
            metadata: {},
            createdAt: new Date("2026-03-11T00:00:00.000Z"),
            updatedAt: new Date("2026-03-11T00:00:00.000Z")
        };
        const profileB = { ...profileA, id: `profile-${randomUUID()}`, venue: "venue-b", venueMarketId: "mkt-b" };
        const factorComparison = comparator.compare(profileA as any, profileB as any);
        const scoredAssessment = scoringEngine.score({
            canonicalEventId: profileA.canonicalEventId,
            marketAProfileId: profileA.id < profileB.id ? profileA.id : profileB.id,
            marketBProfileId: profileA.id < profileB.id ? profileB.id : profileA.id,
            factorComparison,
            version: "resolution-risk-v1"
        });

        const envelope = builder.build({
            correlationId: `corr-${randomUUID()}`,
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: {},
            canonicalEventId: profileA.canonicalEventId,
            profileA: profileA.id < profileB.id ? profileA : profileB,
            profileB: profileA.id < profileB.id ? profileB : profileA,
            factorComparison: factorComparison as unknown as Record<string, unknown>,
            scoredAssessment: scoredAssessment as unknown as Record<string, unknown>,
            scoringWeights: {},
            confidenceInputs: {},
            equivalenceThresholds: {}
        });

        const persisted = await new ReplayEnvelopeWriter({ pool: must(pool, "pool") }).write(envelope);
        createdEnvelopeIds.add(persisted.id);

        const result = await makeRunner().run(persisted.id);
        expect(result.status).toBe("MATCH");
    });

    it("loads and replays stored RFQ grouping and SOR plan envelopes to MATCH", async () => {
        const writer = new ReplayEnvelopeWriter({ pool: must(pool, "pool") });
        const rfqId = "11111111-1111-4111-8111-111111111111";
        const canonicalEventId = `event-${randomUUID()}`;
        const orderedCandidateProfiles = [
            { id: "profile-a", canonicalEventId },
            { id: "profile-b", canonicalEventId }
        ];
        const computedGrouping = replayRFQGrouping({
            canonicalEventId,
            orderedCandidateProfiles,
            orderedAssessments: []
        }).grouping;

        const groupingBuilder = new RFQGroupingSnapshotBuilder();
        const groupingEnvelope = groupingBuilder.build({
            correlationId: `corr-${randomUUID()}`,
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: {},
            rfqId,
            canonicalEventId,
            orderedCandidateProfiles,
            orderedAssessments: [],
            pairGenerationOrder: ["profile-a:profile-b"],
            grouping: computedGrouping as unknown as Record<string, unknown>
        });

        const persistedGrouping = await writer.write(groupingEnvelope);
        createdEnvelopeIds.add(persistedGrouping.id);
        expect((await makeRunner().run(persistedGrouping.id)).status).toBe("MATCH");

        const sorInputSnapshot = {
            rfqId,
            rfq: {
                rfqId,
                idempotencyKey: "idem-1",
                canonicalMarketId: "market-1",
                takerId: "22222222-2222-4222-8222-222222222222",
                side: "buy",
                quantity: "10",
                stpMode: "CANCEL_NEWEST"
            },
            selectedQuote: {
                quoteId: "quote-1",
                price: 0.51,
                quantity: 10,
                feeBps: 0
            },
            policy: "BEST_EFFORT",
            routeCandidates: [
                {
                    id: "33333333-3333-4333-8333-333333333333",
                    leg_id: "44444444-4444-4444-8444-444444444444",
                    provider_type: "LP",
                    provider_id: "lp-a",
                    available_size: 10,
                    quoted_price: 0.51,
                    fees: {},
                    latency_ms: 10,
                    fill_prob: 1
                }
            ],
            resolutionRiskPairPolicies: [],
            buildResult: {
                kind: "plan_created",
                crossingFilledSize: "0",
                remainingSize: "10",
                plan: { id: "plan-1" }
            }
        };
        const sorReplay = await replaySORPlan(sorInputSnapshot, new CostModel(), new Splitter());
        const sorEnvelope = new SORSnapshotBuilder().build({
            correlationId: `corr-${randomUUID()}`,
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: {},
            rfqId,
            rfq: sorInputSnapshot.rfq,
            selectedQuote: sorInputSnapshot.selectedQuote,
            policy: "BEST_EFFORT",
            routeCandidates: sorInputSnapshot.routeCandidates,
            scoredCandidates: (sorReplay.decisionTrace as Record<string, unknown>).scoredCandidates as any,
            allocations: (sorReplay.decisionTrace as Record<string, unknown>).allocations as any,
            resolutionRiskPairPolicies: [],
            candidateOrdering: ["33333333-3333-4333-8333-333333333333"],
            splitEligibilityDecisions: [],
            buildResult: sorReplay.buildResult as Record<string, unknown>
        });

        const persistedSor = await writer.write(sorEnvelope);
        createdEnvelopeIds.add(persistedSor.id);
        expect((await makeRunner().run(persistedSor.id)).status).toBe("MATCH");
    });

    it("returns DIFF when stored output_snapshot is intentionally altered", async () => {
        const writer = new ReplayEnvelopeWriter({ pool: must(pool, "pool") });
        const envelope = await writer.write({
            decisionType: "RFQ_GROUPING",
            entityId: `entity-${randomUUID()}`,
            correlationId: `corr-${randomUUID()}`,
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: {},
            inputSnapshot: {
                canonicalEventId: "event-1",
                orderedCandidateProfiles: [
                    { id: "profile-a", canonicalEventId: "event-1" },
                    { id: "profile-b", canonicalEventId: "event-1" }
                ],
                orderedAssessments: []
            },
            decisionTrace: {},
            outputSnapshot: {
                grouping: {
                    canonicalEventId: "event-1",
                    safePools: [["profile-a", "profile-b"]],
                    cautionLanes: [],
                    blockedProfiles: [],
                    reasonsByProfile: {},
                    pairMatrix: {}
                }
            }
        });
        createdEnvelopeIds.add(envelope.id);

        const result = await makeRunner().run(envelope.id);
        expect(result.status).toBe("DIFF");
    });
});
