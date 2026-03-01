import { pino } from "pino";
import crypto from "crypto";
import { ComboRFQSession, ComboQuote, AcceptancePolicy } from "../combo-engine/types.js";

// Ensure local typings match the rigorous request output constraints
export interface ExecutionStep {
    id: string; // Internal step ID
    legId: string;
    targetSize: string;
    price: string;
    lpId: string;
    connector: string;
    clientOrderId: string;
    idempotencyKey: string;
    timeoutMs: number;
    retryPolicy: { maxRetries: number; backoffMs: number };
    unwindStrategy: "REVERT_FILL" | "HOLD_POSITION" | "MARKET_SELL"; // Defines response to a broken ALL_OR_NONE execution
    fallbackProviders?: Array<{ lpId: string; price: string }>;
}

export interface ExecutionPlan {
    id: string;
    comboSessionId: string;
    reservationToken: string;
    policy: AcceptancePolicy;
    steps: ExecutionStep[];
    totalCostBasis: string;
    status: "DRAFT" | "READY" | "EXECUTING" | "COMPLETED" | "FAILED";
}

export interface IExecutionPlanBuilder {
    buildExecutionPlan(
        combo: ComboRFQSession,
        comboQuote: ComboQuote,
        reservationToken: string,
        acceptancePolicy: AcceptancePolicy
    ): Promise<ExecutionPlan>;

    finalizePlan(planId: string): Promise<void>;
}

// Pseudo Database interface reference
export interface IExecutionPlanRepository {
    savePlan(plan: ExecutionPlan): Promise<void>;
    updatePlanStatus(planId: string, status: ExecutionPlan["status"]): Promise<void>;
}

export class ExecutionPlanBuilder implements IExecutionPlanBuilder {
    public constructor(
        private readonly repository: IExecutionPlanRepository,
        private readonly logger: pino.Logger
    ) { }

    /**
     * Builds a concrete, actionable ExecutionPlan from the selected Quote, respecting the AcceptancePolicy.
     * Generates internal UUIDs for client OrderIds and idempotency.
     * 
     * @param combo The authoritative RFQ session configuration.
     * @param comboQuote The exact quote elected by the Taker or best-execution router.
     * @param reservationToken The cryptographic Risk Lock token proving capital solvency.
     * @param acceptancePolicy Determines fail-closed (ALL_OR_NONE) or ratio fills (PARTIAL_ALLOWED).
     */
    public async buildExecutionPlan(
        combo: ComboRFQSession,
        comboQuote: ComboQuote,
        reservationToken: string,
        acceptancePolicy: AcceptancePolicy
    ): Promise<ExecutionPlan> {

        const planId = crypto.randomUUID();
        const steps: ExecutionStep[] = [];

        // Check if LP provided a composite fill via a known connector 
        // Example: The LP acts as a composite router or the canonical exchange supports native combo objects.
        const canUseCompositeRouting = comboQuote.isComboQuote && comboQuote.rawPayload?.connector;

        for (const leg of combo.legs) {
            let stepPrice = "0";
            let fallbackProviders: Array<{ lpId: string; price: string }> = [];

            if (canUseCompositeRouting) {
                // Rely on the composite execution engine - pricing is aggregated at the combo level
                stepPrice = "0"; // Handled exclusively at the total cost basis level
            } else {
                // Must route to single-leg provider
                const explicitPricing = comboQuote.perLegPrices?.find(p => p.legId === leg.id);
                if (!explicitPricing) {
                    throw new Error(`Missing leg pricing for ${leg.id} in non-composite routing`);
                }
                stepPrice = explicitPricing.price;
                // Ex: If other quotes exist in DB, we would populate fallbacks here. Assuming comboQuote is terminal.
            }

            // Determine strict unwinding strategy for failure tolerance
            let unwindStrategy: ExecutionStep["unwindStrategy"] = "REVERT_FILL";
            if (acceptancePolicy === AcceptancePolicy.BEST_EFFORT) {
                unwindStrategy = "HOLD_POSITION"; // We don't care about leg correlation breaks
            } else if (acceptancePolicy === AcceptancePolicy.PARTIAL_ALLOWED) {
                unwindStrategy = "MARKET_SELL"; // Offset residual if the ratio breaches bounds
            }

            steps.push({
                id: crypto.randomUUID(),
                legId: leg.id,
                targetSize: leg.quantity,
                price: stepPrice,
                lpId: comboQuote.lpId,
                connector: comboQuote.rawPayload?.connector ?? "DEFAULT_SOR",
                clientOrderId: crypto.randomUUID(),
                idempotencyKey: crypto.randomUUID(), // Guarantee strictly once dispatch
                timeoutMs: 5000, // Explicit 5s SLA to conform to Exchange norms
                retryPolicy: {
                    maxRetries: canUseCompositeRouting ? 0 : 2, // Composites usually FOK (Fill Or Kill), single legs may retry timeouts
                    backoffMs: 250
                },
                unwindStrategy,
                fallbackProviders
            });
        }

        const plan: ExecutionPlan = {
            id: planId,
            comboSessionId: combo.id,
            reservationToken,
            policy: acceptancePolicy,
            steps,
            totalCostBasis: comboQuote.effectiveCost,
            status: "DRAFT"
        };

        // Persist the DRAFT plan to `combo_execution_plans` (and steps)
        await this.repository.savePlan(plan);
        this.logger.info({ planId, comboId: combo.id, numSteps: steps.length }, "Execution Plan DRAFT generated");

        return plan;
    }

    /**
     * Commits the DRAFT plan as READY, sealing it for immediate routing ingestion.
     * Prevents race conditions where a router picks up an uncommitted multi-leg transaction.
     */
    public async finalizePlan(planId: string): Promise<void> {
        // Enforce state transition
        await this.repository.updatePlanStatus(planId, "READY");
        this.logger.info({ planId }, "Execution Plan finalised and READY for routing");
    }
}
