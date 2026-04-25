import type { ExecutionScopeBinding } from "../execution-control/execution-scope-token.js";
import { ApprovedLaneExecutionGate } from "./lane-authority.js";
import type { ExecutionCheckResult, ExecutionRequestV0 } from "./types.js";

export interface VenueHealthChecker {
  isVenueHealthy(venue: string): Promise<boolean>;
}

export interface MarketStateChecker {
  isMarketOpen(input: { venue: string; request: ExecutionRequestV0 }): Promise<boolean>;
  isOutcomePresent(input: { venue: string; request: ExecutionRequestV0 }): Promise<boolean>;
}

export interface LiquidityChecker {
  hasLiquidity(input: { venue: string; request: ExecutionRequestV0 }): Promise<boolean>;
}

export interface FundingChecker {
  hasFunding(input: { request: ExecutionRequestV0 }): Promise<boolean>;
}

export interface IdempotencyCompletionChecker {
  isAlreadyCompleted(idempotencyKey: string): Promise<boolean>;
}

export interface PriceChecker {
  isWithinSlippage(input: { venue: string; request: ExecutionRequestV0 }): Promise<boolean>;
}

export interface PreflightServiceDeps {
  laneGate: ApprovedLaneExecutionGate;
  venueHealth: VenueHealthChecker;
  marketState: MarketStateChecker;
  liquidity: LiquidityChecker;
  funding: FundingChecker;
  idempotency: IdempotencyCompletionChecker;
  price: PriceChecker;
}

export interface PreflightResult extends ExecutionCheckResult {
  checkedAt: string;
}

export class ExecutionPreflightService {
  public constructor(private readonly deps: PreflightServiceDeps) {}

  public async evaluate(input: {
    request: ExecutionRequestV0;
    scopeBinding?: ExecutionScopeBinding | null;
  }): Promise<PreflightResult> {
    const checkedAt = new Date().toISOString();
    const laneInput: Parameters<ApprovedLaneExecutionGate["evaluate"]>[0] = {
      request: input.request,
      scopeBinding: input.scopeBinding ?? null
    };
    if (input.request.fallbackLaneId) {
      laneInput.fallbackLaneId = input.request.fallbackLaneId;
    }
    const laneResult = await this.deps.laneGate.evaluate(laneInput);
    if (!laneResult.ok) {
      return {
        ok: false,
        ...(laneResult.code ? { code: laneResult.code } : {}),
        ...(laneResult.reason ? { reason: laneResult.reason } : {}),
        checkedAt
      };
    }

    if (await this.deps.idempotency.isAlreadyCompleted(input.request.idempotencyKey)) {
      return { ok: false, code: "IDEMPOTENCY_ALREADY_COMPLETED", reason: "Idempotency key already completed.", checkedAt };
    }

    if (!(await this.deps.funding.hasFunding({ request: input.request }))) {
      return { ok: false, code: "FUNDING_UNAVAILABLE", reason: "User funding is not available.", checkedAt };
    }

    for (const venue of input.request.venuePath) {
      if (!(await this.deps.venueHealth.isVenueHealthy(venue))) {
        return { ok: false, code: "VENUE_PAUSED", reason: `${venue} is not healthy.`, checkedAt };
      }
      if (!(await this.deps.marketState.isMarketOpen({ venue, request: input.request }))) {
        return { ok: false, code: "MARKET_CLOSED", reason: `${venue} market is closed.`, checkedAt };
      }
      if (!(await this.deps.marketState.isOutcomePresent({ venue, request: input.request }))) {
        return { ok: false, code: "OUTCOME_NOT_PRESENT", reason: `${venue} outcome is not present.`, checkedAt };
      }
      if (!(await this.deps.price.isWithinSlippage({ venue, request: input.request }))) {
        return { ok: false, code: "PRICE_OUTSIDE_SLIPPAGE", reason: `${venue} price is outside max slippage.`, checkedAt };
      }
      if (!(await this.deps.liquidity.hasLiquidity({ venue, request: input.request }))) {
        return { ok: false, code: "LIQUIDITY_UNAVAILABLE", reason: `${venue} liquidity is not available.`, checkedAt };
      }
    }

    return { ok: true, checkedAt };
  }
}

export const alwaysHealthyPreflightDeps = (laneGate: ApprovedLaneExecutionGate): PreflightServiceDeps => ({
  laneGate,
  venueHealth: { isVenueHealthy: async () => true },
  marketState: {
    isMarketOpen: async () => true,
    isOutcomePresent: async () => true
  },
  liquidity: { hasLiquidity: async () => true },
  funding: { hasFunding: async () => true },
  idempotency: { isAlreadyCompleted: async () => false },
  price: { isWithinSlippage: async () => true }
});
