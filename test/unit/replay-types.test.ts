import { describe, expect, it } from "vitest";
import type {
    CreateReplayEnvelopeInput,
    CreateReplayRunInput,
    ReplayDecisionType,
    ReplayEnvelope,
    ReplayMode,
    ReplayResultStatus,
    ReplayRun
} from "../../src/core/replay/replay.types.js";

describe("replay types", () => {
    it("keeps the decision type union aligned with the v1 replay families", () => {
        const decisionTypes: ReplayDecisionType[] = [
            "RESOLUTION_RISK_ASSESSMENT",
            "RFQ_GROUPING",
            "RFQ_RANKING",
            "SOR_PLAN",
            "INTERNAL_CROSS",
            "NETTING_PHASE2A",
            "CLEARING_PHASE2B"
        ];

        expect(decisionTypes).toHaveLength(7);
    });

    it("keeps the replay mode and result status unions aligned with v1", () => {
        const replayModes: ReplayMode[] = ["READ_ONLY", "VERIFY", "DIFF_ONLY"];
        const resultStatuses: ReplayResultStatus[] = ["MATCH", "DIFF", "FAILED", "SKIPPED"];

        expect(replayModes).toHaveLength(3);
        expect(resultStatuses).toHaveLength(4);
    });

    it("keeps replay envelope JSON fields structured", () => {
        const envelope: ReplayEnvelope = {
            id: "envelope-1",
            decisionType: "SOR_PLAN",
            entityId: "rfq-1",
            correlationId: "corr-1",
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: { resolutionRisk: true },
            inputSnapshot: { marketId: "market-1" },
            decisionTrace: { selectedVenue: "venue-a" },
            outputSnapshot: { planId: "plan-1" },
            createdAt: new Date("2026-03-11T00:00:00.000Z")
        };

        const createInput: CreateReplayEnvelopeInput = {
            decisionType: envelope.decisionType,
            entityId: envelope.entityId,
            correlationId: envelope.correlationId,
            configVersion: envelope.configVersion,
            engineVersion: envelope.engineVersion,
            featureFlags: envelope.featureFlags,
            inputSnapshot: envelope.inputSnapshot,
            decisionTrace: envelope.decisionTrace,
            outputSnapshot: envelope.outputSnapshot
        };

        expect(envelope.featureFlags).toEqual({ resolutionRisk: true });
        expect(createInput.inputSnapshot).toEqual({ marketId: "market-1" });
        expect(createInput.decisionTrace).toEqual({ selectedVenue: "venue-a" });
        expect(createInput.outputSnapshot).toEqual({ planId: "plan-1" });
    });

    it("keeps replay run diffSummary nullable", () => {
        const run: ReplayRun = {
            id: "run-1",
            replayEnvelopeId: "envelope-1",
            mode: "VERIFY",
            requestedBy: "ops@example.com",
            resultStatus: "DIFF",
            diffSummary: null,
            createdAt: new Date("2026-03-11T00:00:00.000Z")
        };

        const createInput: CreateReplayRunInput = {
            replayEnvelopeId: run.replayEnvelopeId,
            mode: run.mode,
            requestedBy: run.requestedBy,
            resultStatus: run.resultStatus,
            diffSummary: null
        };

        expect(run.diffSummary).toBeNull();
        expect(createInput.diffSummary).toBeNull();
    });
});
