import type {
    ExecutionControlReasonCode,
    ExecutionControlRequest,
    ExecutionFreshnessStatus
} from "./execution-control-types.js";

export interface ExecutionFreshnessResult {
    status: ExecutionFreshnessStatus;
    fresh: boolean;
    blockReasonCodes: readonly ExecutionControlReasonCode[];
}

export class ExecutionFreshnessGuard {
    public constructor(private readonly now: () => Date = () => new Date()) {}

    public evaluate(request: ExecutionControlRequest): ExecutionFreshnessResult {
        const reasons: ExecutionControlReasonCode[] = [];
        const currentTime = this.now().getTime();
        const freshness = request.routeFreshnessMetadata;

        if (currentTime - freshness.routeGeneratedAt.getTime() > freshness.maxRouteAgeMs) {
            reasons.push("ROUTE_PLAN_STALE");
        }

        if (
            freshness.quoteObservedAt &&
            freshness.maxQuoteAgeMs !== null &&
            freshness.maxQuoteAgeMs !== undefined &&
            currentTime - freshness.quoteObservedAt.getTime() > freshness.maxQuoteAgeMs
        ) {
            reasons.push("QUOTE_STALE");
        }

        if (freshness.quoteValidUntil && freshness.quoteValidUntil.getTime() < currentTime) {
            reasons.push("QUOTE_STALE");
        }

        if (
            freshness.marketStateObservedAt &&
            freshness.maxMarketStateAgeMs !== null &&
            freshness.maxMarketStateAgeMs !== undefined &&
            currentTime - freshness.marketStateObservedAt.getTime() > freshness.maxMarketStateAgeMs
        ) {
            reasons.push("MARKET_STATE_STALE");
        }

        if (
            freshness.compatibilityEvaluatedAt &&
            freshness.maxCompatibilityAgeMs !== null &&
            freshness.maxCompatibilityAgeMs !== undefined &&
            currentTime - freshness.compatibilityEvaluatedAt.getTime() > freshness.maxCompatibilityAgeMs
        ) {
            reasons.push("COMPATIBILITY_STALE");
        }

        if (
            freshness.approvalGrantedAt &&
            freshness.maxApprovalAgeMs !== null &&
            freshness.maxApprovalAgeMs !== undefined &&
            currentTime - freshness.approvalGrantedAt.getTime() > freshness.maxApprovalAgeMs
        ) {
            reasons.push("APPROVAL_STALE");
        }

        return {
            status: resolveFreshnessStatus(reasons),
            fresh: reasons.length === 0,
            blockReasonCodes: reasons
        };
    }
}

const resolveFreshnessStatus = (
    reasons: readonly ExecutionControlReasonCode[]
): ExecutionFreshnessStatus => {
    if (reasons.includes("ROUTE_PLAN_STALE")) {
        return "STALE_ROUTE";
    }
    if (reasons.includes("QUOTE_STALE")) {
        return "STALE_QUOTE";
    }
    if (reasons.includes("MARKET_STATE_STALE")) {
        return "STALE_MARKET_STATE";
    }
    if (reasons.includes("COMPATIBILITY_STALE")) {
        return "STALE_COMPATIBILITY";
    }
    if (reasons.includes("APPROVAL_STALE")) {
        return "STALE_APPROVAL";
    }
    return "FRESH";
};
