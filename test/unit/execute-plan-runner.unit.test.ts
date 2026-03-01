import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutePlanRunner } from "../../src/core/combo-engine/execute-plan-runner.js";
import { ExecutionPlan } from "../../src/core/execution-plan/execution-plan-builder.js";
import { AcceptancePolicy } from "../../src/core/combo-engine/types.js";
import { pino } from "pino";

const mockLogger = pino({ level: "silent" });

describe("ExecutePlanRunner", () => {
    let runner: ExecutePlanRunner;
    let clientMock: any;
    let repoMock: any;
    let riskMock: any;

    const basePlan: ExecutionPlan = {
        id: "plan-123",
        comboSessionId: "combo-123",
        reservationToken: "res-123",
        policy: AcceptancePolicy.ALL_OR_NONE,
        totalCostBasis: "100",
        status: "READY",
        steps: [
            {
                id: "step-1",
                legId: "leg-1",
                targetSize: "10",
                price: "5",
                lpId: "lp-1",
                connector: "BINANCE",
                clientOrderId: "order-1",
                idempotencyKey: "idem-1",
                timeoutMs: 1000,
                retryPolicy: { maxRetries: 0, backoffMs: 0 },
                unwindStrategy: "REVERT_FILL"
            },
            {
                id: "step-2",
                legId: "leg-2",
                targetSize: "20",
                price: "2.5",
                lpId: "lp-2",
                connector: "ORCA",
                clientOrderId: "order-2",
                idempotencyKey: "idem-2",
                timeoutMs: 1000,
                retryPolicy: { maxRetries: 0, backoffMs: 0 },
                unwindStrategy: "REVERT_FILL"
            }
        ]
    };

    beforeEach(() => {
        clientMock = {
            executeTrade: vi.fn(),
            cancelOrder: vi.fn()
        };
        repoMock = {
            getFilledSteps: vi.fn().mockResolvedValue([]),
            recordFill: vi.fn().mockResolvedValue(true),
            recordFailure: vi.fn().mockResolvedValue(true)
        };
        riskMock = {
            updateExposureAfterExecution: vi.fn().mockResolvedValue(true),
            validateRFQCreation: vi.fn(),
            validateBeforeExecution: vi.fn()
        };

        runner = new ExecutePlanRunner(clientMock, repoMock, riskMock, mockLogger);
    });

    it("should successfully execute all steps for ALL_OR_NONE and notify risk engine", async () => {
        clientMock.executeTrade.mockResolvedValue({ status: "FILLED", filledQuantity: "10" });

        const result = await runner.runPlan(basePlan);

        expect(result.status).toBe("COMPLETED");
        expect(clientMock.executeTrade).toHaveBeenCalledTimes(2);

        // Ensure risk updates happen for filled legs
        expect(riskMock.updateExposureAfterExecution).toHaveBeenCalledTimes(2);
        expect(repoMock.recordFill).toHaveBeenCalledTimes(2);
    });

    it("should fail entire plan if one leg fails under ALL_OR_NONE policy", async () => {
        clientMock.executeTrade.mockImplementation(async (step: any) => {
            if (step.legId === "leg-1") return { status: "FILLED", filledQuantity: "10" };
            return { status: "REJECTED", filledQuantity: "0" }; // Leg 2 fails
        });

        const result = await runner.runPlan(basePlan);

        expect(result.status).toBe("FAILED");
        expect(clientMock.executeTrade).toHaveBeenCalledTimes(2); // Both were dispatched

        // Critical: NO risk exposure updates should be fired on a severed ALL_OR_NONE combo
        // to prevent partial exposures leaking into portfolio.
        expect(riskMock.updateExposureAfterExecution).not.toHaveBeenCalled();
        expect(repoMock.recordFailure).toHaveBeenCalledWith("plan-123", "leg-2", expect.any(String));
    });

    it("should allow partial completion under BEST_EFFORT policy", async () => {
        const partialPlan = { ...basePlan, policy: AcceptancePolicy.BEST_EFFORT };

        clientMock.executeTrade.mockImplementation(async (step: any) => {
            if (step.legId === "leg-1") return { status: "FILLED", filledQuantity: "10" };
            return { status: "REJECTED", filledQuantity: "0" }; // Leg 2 fails
        });

        const result = await runner.runPlan(partialPlan);

        expect(result.status).toBe("PARTIAL");

        // Leg 1 succeeded, so it SHOULD be pushed to risk
        expect(riskMock.updateExposureAfterExecution).toHaveBeenCalledTimes(1);
        expect(repoMock.recordFill).toHaveBeenCalledWith("plan-123", "leg-1", "10", "5");
        expect(repoMock.recordFailure).toHaveBeenCalledWith("plan-123", "leg-2", expect.any(String));
    });

    it("should skip execution and return COMPLETED if idempotency check proves all legs were already filled", async () => {
        // Mock that DB says both leg 1 and 2 are already filled for this plan.
        repoMock.getFilledSteps.mockResolvedValue(["leg-1", "leg-2"]);

        const result = await runner.runPlan(basePlan);

        expect(result.status).toBe("COMPLETED");
        expect(clientMock.executeTrade).not.toHaveBeenCalled(); // No network requests!
        expect(riskMock.updateExposureAfterExecution).not.toHaveBeenCalled(); // Already processed!
    });
});
