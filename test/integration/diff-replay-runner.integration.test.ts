import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { ReplayEnvelopeWriter } from "../../src/core/replay/replay-envelope-writer.js";
import { DiffReplayRunner } from "../../src/core/replay/diff-replay-runner.js";
import { ResolutionRiskSnapshotBuilder } from "../../src/core/replay/builders/resolution-risk-snapshot-builder.js";
import { ResolutionPairComparator } from "../../src/core/rfq-engine/resolution-pair-comparator.js";
import { ResolutionRiskScoringEngine } from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import { CostModel } from "../../src/core/sor/cost-model.js";
import { Splitter } from "../../src/core/sor/splitter.js";

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

describe.skipIf(!ENV_READY)("DiffReplayRunner integration", () => {
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
        new DiffReplayRunner({
            pool: must(pool, "pool"),
            resolutionPairComparator: new ResolutionPairComparator(),
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
                        grossAbsSize: vector.grossAbsSize
                    })),
                    edges: []
                })
            },
            candidateGroupEnumerator: {
                enumerate: () => [{
                    participantIds: ["entity-a", "entity-b"],
                    uniqueLegs: ["m1:o1"],
                    estimatedCompressionScore: "1",
                    residualAfterNetting: [],
                    exactnessScore: "1"
                }]
            },
            clearingCompressionScorer: {
                score: () => ({
                    compressionScore: "1",
                    preNetAbsExposure: "2",
                    postNetAbsResidual: "0",
                    residualVectorByParticipant: {},
                    rankingPenalty: "0",
                    finalScore: "1",
                    tieBreak: {
                        smallestResidual: "0",
                        oldestParticipantAt: "2026-03-11T00:00:00.000Z",
                        participantCount: 2
                    }
                })
            },
            configRegistry: {
                RESOLUTION_RISK_ASSESSMENT: {
                    "cfg-weighted": {
                        config: {
                            weights: {
                                oracleMismatch: "0.9",
                                ruleMismatch: "0.02",
                                wordingAmbiguity: "0.02",
                                disputeWindowMismatch: "0.02",
                                settlementLagMismatch: "0.01",
                                structuralMismatch: "0.01",
                                historicalDivergence: "0.02"
                            }
                        }
                    },
                    "cfg-thresholds": {
                        config: {
                            thresholds: {
                                safeEquivalentMaxRisk: "0.05",
                                cautionMaxRisk: "0.10",
                                highRiskMaxRisk: "0.20",
                                doNotPoolMinRisk: "0.20",
                                safeEquivalentMinConfidence: "0.70",
                                lowConfidenceThreshold: "0.50"
                            }
                        }
                    }
                }
            },
            engineRegistry: {
                CLEARING_PHASE2B: {
                    "eng-v2": {
                        evaluate: async () => ({
                            selectedPlan: {
                                compatibilityBucket: "bucket-1",
                                selectedGroup: {
                                    participantIds: ["entity-a", "entity-b"],
                                    uniqueLegs: ["m1:o1"],
                                    estimatedCompressionScore: "1",
                                    residualAfterNetting: [],
                                    exactnessScore: "1"
                                },
                                score: {
                                    compressionScore: "1",
                                    preNetAbsExposure: "2",
                                    postNetAbsResidual: "0",
                                    residualVectorByParticipant: {},
                                    rankingPenalty: "0",
                                    finalScore: "1",
                                    tieBreak: {
                                        smallestResidual: "0",
                                        oldestParticipantAt: "2026-03-11T00:00:00.000Z",
                                        participantCount: 2
                                    }
                                },
                                residuals: [],
                                participantLockOrder: ["entity-b", "entity-a"]
                            }
                        })
                    }
                }
            }
        });

    it("returns MATCH under the same effective behavior", async () => {
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
        const orderedA = profileA.id < profileB.id ? profileA : profileB;
        const orderedB = profileA.id < profileB.id ? profileB : profileA;
        const factorComparison = comparator.compare(orderedA as any, orderedB as any);
        const scoredAssessment = scoringEngine.score({
            canonicalEventId: orderedA.canonicalEventId,
            marketAProfileId: orderedA.id,
            marketBProfileId: orderedB.id,
            factorComparison,
            version: "resolution-risk-v1"
        });
        const envelope = builder.build({
            correlationId: `corr-${randomUUID()}`,
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: {},
            canonicalEventId: orderedA.canonicalEventId,
            profileA: orderedA,
            profileB: orderedB,
            factorComparison: factorComparison as unknown as Record<string, unknown>,
            scoredAssessment: scoredAssessment as unknown as Record<string, unknown>,
            scoringWeights: {},
            confidenceInputs: {},
            equivalenceThresholds: {}
        });
        const persisted = await new ReplayEnvelopeWriter({ pool: must(pool, "pool") }).write(envelope);
        createdEnvelopeIds.add(persisted.id);

        const result = await makeRunner().run(persisted.id, { configVersion: "cfg-v1" });
        expect(result.status).toBe("MATCH");
    });

    it("returns DIFF for changed scoring weight and thresholds", async () => {
        const writer = new ReplayEnvelopeWriter({ pool: must(pool, "pool") });
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
        const profileB = { ...profileA, id: `profile-${randomUUID()}`, venue: "venue-b", venueMarketId: "mkt-b", oracleName: "oracle-b" };
        const orderedA = profileA.id < profileB.id ? profileA : profileB;
        const orderedB = profileA.id < profileB.id ? profileB : profileA;
        const factorComparison = comparator.compare(orderedA as any, orderedB as any);
        const scoredAssessment = scoringEngine.score({
            canonicalEventId: orderedA.canonicalEventId,
            marketAProfileId: orderedA.id,
            marketBProfileId: orderedB.id,
            factorComparison,
            version: "resolution-risk-v1"
        });
        const persisted = await writer.write(builder.build({
            correlationId: `corr-${randomUUID()}`,
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: {},
            canonicalEventId: orderedA.canonicalEventId,
            profileA: orderedA,
            profileB: orderedB,
            factorComparison: factorComparison as unknown as Record<string, unknown>,
            scoredAssessment: scoredAssessment as unknown as Record<string, unknown>,
            scoringWeights: {},
            confidenceInputs: {},
            equivalenceThresholds: {}
        }));
        createdEnvelopeIds.add(persisted.id);

        const weightDiff = await makeRunner().run(persisted.id, { configVersion: "cfg-weighted" });
        expect(weightDiff.status).toBe("DIFF");

        const thresholdDiff = await makeRunner().run(persisted.id, { configVersion: "cfg-thresholds" });
        expect(thresholdDiff.status).toBe("DIFF");
    });

    it("returns DIFF for changed tie-break order", async () => {
        const writer = new ReplayEnvelopeWriter({ pool: must(pool, "pool") });
        const envelope = await writer.write({
            decisionType: "CLEARING_PHASE2B",
            entityId: `bucket-1:entity-a|entity-b`,
            correlationId: `corr-${randomUUID()}`,
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: {},
            inputSnapshot: {
                bucketId: "bucket-1",
                plannerConfig: { maxParticipants: 4, maxUniqueLegs: 6, stpMode: "CANCEL_NEWEST" },
                candidateSnapshots: [
                    { entityId: "entity-a", userId: "user-a", compatibilityBucket: "bucket-1", vector: { "m1:o1": "1" }, legCount: 1, grossAbsSize: "1", registeredAt: "2026-03-11T00:00:00.000Z" },
                    { entityId: "entity-b", userId: "user-b", compatibilityBucket: "bucket-1", vector: { "m1:o1": "-1" }, legCount: 1, grossAbsSize: "1", registeredAt: "2026-03-11T00:00:00.000Z" }
                ]
            },
            decisionTrace: {},
            outputSnapshot: {
                selectedPlan: {
                    compatibilityBucket: "bucket-1",
                    selectedGroup: {
                        participantIds: ["entity-a", "entity-b"],
                        uniqueLegs: ["m1:o1"],
                        estimatedCompressionScore: "1",
                        residualAfterNetting: [],
                        exactnessScore: "1"
                    },
                    score: {
                        compressionScore: "1",
                        preNetAbsExposure: "2",
                        postNetAbsResidual: "0",
                        residualVectorByParticipant: {},
                        rankingPenalty: "0",
                        finalScore: "1",
                        tieBreak: {
                            smallestResidual: "0",
                            oldestParticipantAt: "2026-03-11T00:00:00.000Z",
                            participantCount: 2
                        }
                    },
                    residuals: [],
                    participantLockOrder: ["entity-a", "entity-b"]
                }
            }
        });
        createdEnvelopeIds.add(envelope.id);

        const result = await makeRunner().run(envelope.id, { engineVersion: "eng-v2" });
        expect(result.status).toBe("DIFF");
        expect(result.diffSummary?.changedRanking.length).toBeGreaterThan(0);
    });
});
