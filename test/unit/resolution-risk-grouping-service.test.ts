import { describe, expect, it, vi } from "vitest";
import { ResolutionRiskGroupingService } from "../../src/core/rfq-engine/resolution-risk-grouping-service.js";
import type { IResolutionRiskReadService } from "../../src/core/rfq-engine/resolution-risk-read-service.js";
import type { ResolutionRiskAssessment } from "../../src/core/rfq-engine/resolution-risk.types.js";

const makeProfileRow = (id: string, canonicalEventId = "event-1") => ({
    id,
    venue: `venue-${id}`,
    venue_market_id: `market-${id}`,
    canonical_event_id: canonicalEventId,
    oracle_type: "oracle",
    oracle_name: "oracle-name",
    resolution_authority_type: "authority",
    primary_resolution_text: "resolve by source",
    supplemental_rules_text: "rules",
    dispute_window_hours: "24",
    settlement_lag_hours: "2",
    market_type: "binary",
    outcome_schema: { yes: true, no: true },
    has_ambiguous_time_boundary: false,
    has_ambiguous_jurisdiction_boundary: false,
    has_ambiguous_source_reference: false,
    historical_divergence_rate: null,
    metadata: {},
    created_at: new Date("2026-03-11T00:00:00.000Z"),
    updated_at: new Date("2026-03-11T00:00:00.000Z")
});

const makeAssessment = (
    marketAProfileId: string,
    marketBProfileId: string,
    equivalenceClass: ResolutionRiskAssessment["equivalenceClass"],
    reasons: readonly string[] = []
): ResolutionRiskAssessment => ({
    id: `${marketAProfileId}-${marketBProfileId}`,
    canonicalEventId: "event-1",
    marketAProfileId,
    marketBProfileId,
    riskScore: "0.1",
    confidenceScore: "1",
    equivalenceClass,
    factorBreakdown: {},
    reasons,
    version: "resolution-risk-v1",
    computedAt: new Date("2026-03-11T00:00:00.000Z")
});

describe("ResolutionRiskGroupingService", () => {
    it("groups safe-equivalent profiles into one pool deterministically", async () => {
        const pool = {
            query: vi.fn(async () => ({
                rows: [makeProfileRow("profile-a"), makeProfileRow("profile-b"), makeProfileRow("profile-c")]
            }))
        };
        const readService: IResolutionRiskReadService = {
            getAssessmentByProfilePair: vi.fn(),
            getAssessmentsByProfilePairs: vi.fn(async () => new Map([
                ["profile-a|profile-b", makeAssessment("profile-a", "profile-b", "SAFE_EQUIVALENT")],
                ["profile-a|profile-c", makeAssessment("profile-a", "profile-c", "SAFE_EQUIVALENT")],
                ["profile-b|profile-c", makeAssessment("profile-b", "profile-c", "SAFE_EQUIVALENT")]
            ]))
        };

        const service = new ResolutionRiskGroupingService({
            pool: pool as any,
            readService,
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        });

        const grouping = await service.groupProfilesForCanonicalEvent("event-1");

        expect(grouping.safePools).toEqual([["profile-a", "profile-b", "profile-c"]]);
        expect(grouping.cautionLanes).toEqual([]);
        expect(grouping.blockedProfiles).toEqual([]);
    });

    it("separates caution profiles into isolated lanes", async () => {
        const pool = {
            query: vi.fn(async () => ({
                rows: [makeProfileRow("profile-a"), makeProfileRow("profile-b")]
            }))
        };
        const readService: IResolutionRiskReadService = {
            getAssessmentByProfilePair: vi.fn(),
            getAssessmentsByProfilePairs: vi.fn(async () => new Map([
                [
                    "profile-a|profile-b",
                    makeAssessment("profile-a", "profile-b", "CAUTION", ["cautionary rule mismatch"])
                ]
            ]))
        };

        const service = new ResolutionRiskGroupingService({
            pool: pool as any,
            readService,
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        });

        const grouping = await service.groupProfilesForCanonicalEvent("event-1");

        expect(grouping.safePools).toEqual([]);
        expect(grouping.cautionLanes).toEqual([["profile-a"], ["profile-b"]]);
        expect(grouping.reasonsByProfile["profile-a"]?.[0]).toContain("cautionary rule mismatch");
    });

    it("blocks high-risk and do-not-pool profiles and fails closed on missing assessments", async () => {
        const pool = {
            query: vi.fn(async () => ({
                rows: [makeProfileRow("profile-a"), makeProfileRow("profile-b"), makeProfileRow("profile-c")]
            }))
        };
        const readService: IResolutionRiskReadService = {
            getAssessmentByProfilePair: vi.fn(),
            getAssessmentsByProfilePairs: vi.fn(async () => new Map([
                [
                    "profile-a|profile-b",
                    makeAssessment("profile-a", "profile-b", "HIGH_RISK", ["authority mismatch"])
                ]
            ]))
        };

        const service = new ResolutionRiskGroupingService({
            pool: pool as any,
            readService,
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        });

        const grouping = await service.groupProfilesForCanonicalEvent("event-1");

        expect(grouping.blockedProfiles).toEqual(["profile-a", "profile-b"]);
        expect(grouping.cautionLanes).toEqual([["profile-c"]]);
        expect(grouping.pairMatrix["profile-a|profile-c"]?.equivalenceClass).toBe("DO_NOT_POOL");
        expect(grouping.pairMatrix["profile-a|profile-c"]?.reasons[0]).toContain("missing persisted resolution risk assessment");
    });
});
