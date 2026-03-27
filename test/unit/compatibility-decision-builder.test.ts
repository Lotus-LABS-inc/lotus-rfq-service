import { describe, expect, it } from "vitest";

import { CompatibilityDecisionBuilder } from "../../src/canonical/compatibility-decision-builder.js";
import type { CompatibilityEdge } from "../../src/canonical/canonicalization-types.js";
import type { InterpretedContract } from "../../src/canonical/interpreted-contract-types.js";

const buildContract = (id: string): InterpretedContract => ({
    id,
    venue: "POLYMARKET",
    venueMarketId: id,
    canonicalEventId: "11111111-1111-4111-8111-111111111111",
    venueMarketProfileId: `${id}-profile`,
    propositionFingerprintId: `${id}-fingerprint`,
    resolutionProfileId: `${id}-resolution`,
    settlementProfileId: `${id}-settlement`,
    normalizedPropositionSemantics: {},
    normalizedOutcomeSemantics: { marketClass: "BINARY" },
    normalizedTimingSemantics: {},
    normalizedResolutionSemantics: { normalizedResolutionAuthorityType: "exchange_price_feed" },
    normalizedSettlementSemantics: { settlementLagHours: "24" },
    ambiguityFlags: {
        ambiguousTimeBoundary: false,
        ambiguousSourceReference: false,
        ambiguousJurisdictionOrScope: false,
        missingCriticalOutcomeSemantics: false,
        missingCriticalTimingSemantics: false,
        missingCriticalResolutionSemantics: false
    },
    interpretationConfidence: "0.9",
    sourceMetadataVersion: "test-v1",
    rawLineageReferences: {},
    isPoolable: true,
    createdAt: new Date(),
    updatedAt: new Date()
});

describe("CompatibilityDecisionBuilder", () => {
    it("builds caution and hard-block metadata from factor scores", () => {
        const edge: CompatibilityEdge = {
            id: "edge-1",
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            marketAProfileId: "a",
            marketBProfileId: "b",
            compatibilityClass: "DO_NOT_POOL",
            reasons: ["structural mismatch"],
            propositionSimilarityScore: "1",
            outcomeSchemaCompatibilityScore: "0.2",
            timingCompatibilityScore: "1",
            resolutionRiskScore: "0",
            settlementRiskScore: "0",
            structureRiskScore: "1",
            feeCompatibilityScore: "1",
            confidenceScore: "0.9",
            capitalLockHours: null,
            maxSettlementDelayHours: null,
            liquidityCostModelVersion: null,
            liquidityCostBps: null,
            anchoredFinalityHours: null,
            requiresConservativeSettlementAnchor: false,
            factorBreakdown: {
                outcomeCompatibility: 0.2,
                structureRisk: 1,
                timingCompatibility: 1,
                resolutionRisk: 0,
                settlementRisk: 0,
                confidence: 0.9
            },
            scoringVersion: "compatibility-v1",
            computedAt: new Date()
        };

        const decision = new CompatibilityDecisionBuilder().build({
            canonicalEventId: edge.canonicalEventId,
            interpretedContractA: buildContract("a"),
            interpretedContractB: buildContract("b"),
            compatibilityEdge: edge,
            compatibilityVersionId: "version-1"
        });

        expect(decision.compatibilityClass).toBe("DO_NOT_POOL");
        expect(decision.reasonCodes).toContain("OUTCOME_SCHEMA_MISMATCH");
        expect(decision.hardBlocks.length).toBeGreaterThan(0);
    });

    it("downgrades reasoning to low-confidence when interpreted contracts are not poolable", () => {
        const left = buildContract("left");
        const right = {
            ...buildContract("right"),
            isPoolable: false,
            normalizedResolutionSemantics: {
                normalizedResolutionAuthorityType: "court",
                ruleText: "Different final rule"
            }
        } satisfies InterpretedContract;
        const edge: CompatibilityEdge = {
            id: "edge-2",
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            marketAProfileId: "left",
            marketBProfileId: "right",
            compatibilityClass: "COMPATIBLE_WITH_CAUTION",
            reasons: ["low confidence"],
            propositionSimilarityScore: "1",
            outcomeSchemaCompatibilityScore: "1",
            timingCompatibilityScore: "1",
            resolutionRiskScore: "0.5",
            settlementRiskScore: "0",
            structureRiskScore: "0",
            feeCompatibilityScore: "1",
            confidenceScore: "0.9",
            capitalLockHours: null,
            maxSettlementDelayHours: "24",
            liquidityCostModelVersion: null,
            liquidityCostBps: null,
            anchoredFinalityHours: null,
            requiresConservativeSettlementAnchor: false,
            factorBreakdown: {
                outcomeCompatibility: 1,
                structureRisk: 0,
                timingCompatibility: 1,
                resolutionRisk: 0.5,
                settlementRisk: 0
            },
            scoringVersion: "compatibility-v1",
            computedAt: new Date()
        };

        const decision = new CompatibilityDecisionBuilder().build({
            canonicalEventId: edge.canonicalEventId,
            interpretedContractA: left,
            interpretedContractB: right,
            compatibilityEdge: edge,
            compatibilityVersionId: "version-2"
        });

        expect(decision.reasonCodes).toContain("LOW_METADATA_CONFIDENCE");
        expect(decision.reasonCodes).toContain("RULE_TEXT_CONFLICT");
        expect(decision.reasonCodes).toContain("RESOLUTION_AUTHORITY_CONFLICT");
    });
});
