import { randomUUID } from "node:crypto";
import type { ExecutionVenueReadinessSummary } from "../api/admin/execution-venues-admin-service.js";

export type TradeRouteType = "CROSS_VENUE" | "SINGLE_VENUE";
export type TradeSide = "buy" | "sell";
export type ExecutabilityStatus =
  | "QUOTE_ONLY"
  | "EXECUTION_READY"
  | "USER_SIGNATURE_REQUIRED"
  | "ACTIVATION_REQUIRED"
  | "SETTLEMENT_EVIDENCE_MISSING"
  | "RECOVERY_REQUIRED"
  | "BLOCKED";

export type SellMode = "SINGLE_VENUE_SELL" | "SELL_ALL";
export type SellSizeMode = "PERCENT" | "CUSTOM_AMOUNT";
export type RecoveryEvidenceState = "MATCHED" | "MISSING" | "MISMATCHED" | "AMBIGUOUS";
export type AutomatedRecoveryAction =
  | "AUTO_RETRY_STATUS"
  | "AUTO_WAIT_FOR_FINALITY"
  | "AUTO_REFUND"
  | "AUTO_REROUTE"
  | "MANUAL_REVIEW"
  | "NO_ACTION_SAFE_PENDING";

export interface TradeRouteCandidate {
  venue: string;
  venueMarketId?: string | undefined;
  venueOutcomeId?: string | undefined;
  price: number;
  availableSize: string;
  routeType?: TradeRouteType | undefined;
  requiresUserSignature?: boolean | undefined;
  activationRequired?: boolean | undefined;
  settlementEvidenceSupported?: boolean | undefined;
  recoveryRequired?: boolean | undefined;
  feeBps?: number | undefined;
  feeAmount?: number | undefined;
  effectiveFeeBps?: number | undefined;
  feeModel?: string | undefined;
  feeSource?: string | undefined;
  feeConfidence?: string | undefined;
  fixedFee?: number | undefined;
  spreadBps?: number | undefined;
  slippageBps?: number | undefined;
  liquidityScore?: number | undefined;
  quoteQuality?: string | undefined;
  freshnessMs?: number | undefined;
  confidencePenaltyBps?: number | undefined;
  quoteBlockers?: readonly string[] | undefined;
  missingFactors?: readonly string[] | undefined;
}

export interface TradeQuoteRequest {
  userId: string;
  side: TradeSide;
  marketId: string;
  outcomeId: string;
  amount: string;
  candidates: readonly TradeRouteCandidate[];
}

export interface ExecutableRouteLeg {
  venue: string;
  venueMarketId?: string | undefined;
  venueOutcomeId?: string | undefined;
  size: string;
  price: number;
  feeAmount?: number | undefined;
  effectiveFeeBps?: number | undefined;
  feeConfidence?: string | undefined;
  requiresUserSignature: boolean;
}

export interface SavingsBreakdown {
  priceSavings: number;
  feeSavings: number;
  slippageSavings: number;
  totalSavings: number;
  displayAllowed: boolean;
  displayBlockedReason?: string | undefined;
}

export interface RejectedRouteCandidate {
  venue: string;
  status: ExecutabilityStatus;
  blockerCategory: string;
  adminReason: string;
}

export interface ExecutableTradeQuote {
  quoteId: string;
  userId: string;
  side: TradeSide;
  marketId: string;
  outcomeId: string;
  routeType: TradeRouteType;
  venuePath: string[];
  executableAmount: string;
  skippedAmount: string;
  expectedPrice: number;
  effectivePrice?: number | undefined;
  estimatedSavings?: number | undefined;
  savingsBreakdown?: SavingsBreakdown | undefined;
  routeDecisionReason?: string | undefined;
  requiredUserSignatureSteps: string[];
  expiresAt: string;
  legs: ExecutableRouteLeg[];
}

export interface TradeQuoteSelection {
  quote: ExecutableTradeQuote | null;
  userMessage?: string;
  rejectedCandidates: RejectedRouteCandidate[];
  internalCandidateCount: number;
  routeDiagnostics?: RouteDecisionDiagnostics | undefined;
}

export interface RouteDecisionDiagnostics {
  bestSingleRouteScore: number | null;
  bestMultiRouteScore: number | null;
  selectedRouteReason: string;
  improvementThreshold: number;
  skippedDustVenues: string[];
}

export type SmartRoutePolicyMode = "PRODUCTION" | "STAGING";

export interface SmartRoutePolicy {
  mode: SmartRoutePolicyMode;
  highNotionalUsd: number;
  productionHighNotionalMinBps: number;
  productionLowNotionalMinBps: number;
  stagingHighNotionalMinBps: number;
  stagingLowNotionalMinBps: number;
  minimumPositiveImprovement: number;
}

interface ScoredRoute {
  routeType: TradeRouteType;
  legs: ExecutableRouteLeg[];
  rawNotional: number;
  feeNotional: number;
  slippageNotional: number;
  feeEvidenceComplete: boolean;
  effectiveNotional: number;
  score: number;
  skippedDustVenues: string[];
}

export interface VerifiedExecutionPosition {
  positionId: string;
  userId: string;
  venue: string;
  marketId: string;
  outcomeId: string;
  venueAccountAddress: string | null;
  verifiedSize: string;
  averageEntryPrice: number;
  sellableSize: string;
  lastSettlementEvidenceId: string | null;
  status: "VERIFIED" | "PENDING" | "RECOVERY" | "DISABLED";
  metadata?: Record<string, unknown>;
}

export interface PreparedSellAllocation {
  venue: string;
  positionId: string;
  sellSize: string;
  availableSize: string;
  price: number;
}

export interface PrepareExitRequest {
  userId: string;
  sellMode: SellMode;
  venue?: string | undefined;
  sizeMode: SellSizeMode;
  percent?: 25 | 50 | 100 | undefined;
  amount?: string | undefined;
  marketId: string;
  outcomeId: string;
  candidates: readonly TradeRouteCandidate[];
}

export interface PreparedExitQuote {
  quote: ExecutableTradeQuote | null;
  allocations: PreparedSellAllocation[];
  skippedAmount: string;
  userMessage?: string;
  rejectedCandidates: RejectedRouteCandidate[];
}

export interface VerifiedPositionRepository {
  listVerifiedPositions(input: {
    userId: string;
    marketId: string;
    outcomeId: string;
    venue?: string | undefined;
  }): Promise<VerifiedExecutionPosition[]>;
  applySettlementDelta?(input: {
    userId: string;
    venue: string;
    marketId: string;
    outcomeId: string;
    venueAccountAddress?: string | null;
    side: TradeSide;
    size: string;
    averagePrice: number;
    settlementEvidenceId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<VerifiedExecutionPosition>;
}

export interface ExecutionQuoteRepository {
  saveQuote(input: {
    quote: ExecutableTradeQuote;
    rejectedCandidates: readonly RejectedRouteCandidate[];
  }): Promise<void>;
  findQuote(input: { userId: string; quoteId: string }): Promise<ExecutableTradeQuote | null>;
}

export interface RecoveryClassificationInput {
  evidenceState: RecoveryEvidenceState;
  statusFailureTransient?: boolean;
  finalityDelayLikely?: boolean;
  fundsStillAvailable?: boolean;
  positionExists?: boolean;
  userNeedsRestoration?: boolean;
  possibleDuplicatePosition?: boolean;
}

export interface RecoveryClassification {
  action: AutomatedRecoveryAction;
  reason: string;
  automated: boolean;
}

export interface TradeReadinessProvider {
  listVenues(): Promise<ExecutionVenueReadinessSummary[]>;
}

export class ExecutableRouteService {
  public constructor(
    private readonly readiness: TradeReadinessProvider,
    private readonly quoteRepository?: ExecutionQuoteRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly smartRoutePolicy: SmartRoutePolicy = smartRoutePolicyFromEnv()
  ) {}

  public async quote(input: TradeQuoteRequest): Promise<TradeQuoteSelection> {
    const amount = parsePositiveNumber(input.amount, "amount");
    const readinessByVenue = await this.readinessByVenue();
    const evaluated = input.candidates.map((candidate) => ({
      candidate,
      evaluation: evaluateCandidate(candidate, readinessByVenue.get(candidate.venue.toUpperCase()))
    }));
    const executable = evaluated
      .filter((entry) => entry.evaluation.executable && entry.evaluation.status !== "QUOTE_ONLY")
      .map((entry) => entry.candidate);
    const quoteOnly = evaluated
      .filter((entry) => isQuotePreviewableEvaluation(entry.evaluation))
      .map((entry) => entry.candidate);
    const liveRejectedCandidates = evaluated
      .filter((entry) => !entry.evaluation.executable)
      .map((entry) => ({
        venue: entry.candidate.venue.toUpperCase(),
        status: entry.evaluation.status,
        blockerCategory: entry.evaluation.blockerCategory,
        adminReason: entry.evaluation.adminReason
      }));

    let selected = this.selectBestRoute(input, executable, amount);
    const selectedQuoteOnly = !selected.route && quoteOnly.length > 0;
    if (selectedQuoteOnly) {
      selected = this.selectBestRoute(input, quoteOnly, amount);
    }
    if (!selected.route) {
      return {
        quote: null,
        userMessage: "No executable route available right now.",
        rejectedCandidates: liveRejectedCandidates,
        internalCandidateCount: input.candidates.length,
        routeDiagnostics: selected.diagnostics
      };
    }

    const selectedQuoteVenues = new Set(selected.route.legs.map((leg) => leg.venue.toUpperCase()));
    const rejectedCandidates = selectedQuoteOnly
      ? liveRejectedCandidates.filter((candidate) => !selectedQuoteVenues.has(candidate.venue.toUpperCase()))
      : liveRejectedCandidates;
    await this.quoteRepository?.saveQuote({ quote: selected.route, rejectedCandidates });
    return {
      quote: selected.route,
      rejectedCandidates,
      internalCandidateCount: input.candidates.length,
      routeDiagnostics: selected.diagnostics
    };
  }

  public async getQuote(userId: string, quoteId: string): Promise<ExecutableTradeQuote | null> {
    return this.quoteRepository?.findQuote({ userId, quoteId }) ?? null;
  }

  private selectBestRoute(
    input: TradeQuoteRequest,
    executable: readonly TradeRouteCandidate[],
    amount: number
  ): { route: ExecutableTradeQuote | null; diagnostics: RouteDecisionDiagnostics } {
    const singleRoute = this.buildSingleVenueRoute(input, executable, amount);
    const multiRoute = this.buildMultiVenueRoute(input, executable, amount);
    const threshold = multiRoute && singleRoute ? routeImprovementThreshold(singleRoute, multiRoute, this.smartRoutePolicy) : 0;
    const selected = chooseRoute(input.side, singleRoute, multiRoute, threshold);
    const diagnostics: RouteDecisionDiagnostics = {
      bestSingleRouteScore: singleRoute?.score ?? null,
      bestMultiRouteScore: multiRoute?.score ?? null,
      selectedRouteReason: selected.reason,
      improvementThreshold: roundPrice(threshold),
      skippedDustVenues: multiRoute?.skippedDustVenues ?? []
    };
    if (!selected.route) {
      return { route: null, diagnostics };
    }
    const alternative = selected.route.routeType === "SINGLE_VENUE" ? multiRoute : singleRoute;
    return {
      route: this.buildQuote(input, selected.route, alternative, selected.reason),
      diagnostics
    };
  }

  private buildMultiVenueRoute(
    input: TradeQuoteRequest,
    executable: readonly TradeRouteCandidate[],
    amount: number
  ): ScoredRoute | null {
    if (executable.length < 2) {
      return null;
    }
    let remaining = amount;
    const legs: ExecutableRouteLeg[] = [];
    const skippedDust: TradeRouteCandidate[] = [];
    const skippedDustVenues: string[] = [];
    const sorted = [...executable].sort((left, right) => compareCandidatesByEffectivePrice(input.side, left, right));
    const minimumLegSize = Math.max(0.01, amount * 0.05);
    for (const candidate of sorted) {
      if (remaining <= 0) {
        break;
      }
      const available = parseNonNegativeNumber(candidate.availableSize, "availableSize");
      if (available > 0 && available < minimumLegSize && remaining > minimumLegSize) {
        skippedDust.push(candidate);
        skippedDustVenues.push(candidate.venue.toUpperCase());
        continue;
      }
      const size = Math.min(available, remaining);
      if (size <= 0) {
        continue;
      }
      legs.push(toLeg(candidate, size));
      remaining -= size;
    }
    for (const candidate of skippedDust) {
      if (remaining <= routeDustTolerance) {
        break;
      }
      const available = parseNonNegativeNumber(candidate.availableSize, "availableSize");
      const size = Math.min(available, remaining);
      if (size <= 0) {
        continue;
      }
      legs.push(toLeg(candidate, size));
      remaining -= size;
    }
    if (remaining > routeDustTolerance || legs.length < 2 || new Set(legs.map((leg) => leg.venue)).size < 2) {
      return null;
    }
    return scoreRoute(input.side, "CROSS_VENUE", legs, executable, skippedDustVenues);
  }

  private buildSingleVenueRoute(
    input: TradeQuoteRequest,
    executable: readonly TradeRouteCandidate[],
    amount: number
  ): ScoredRoute | null {
    const routes = executable
      .filter((entry) => parseNonNegativeNumber(entry.availableSize, "availableSize") >= amount)
      .map((candidate) => scoreRoute(input.side, "SINGLE_VENUE", [toLeg(candidate, amount)], [candidate], []))
      .sort((left, right) => input.side === "buy" ? left.score - right.score : right.score - left.score);
    return routes[0] ?? null;
  }

  private buildQuote(
    input: TradeQuoteRequest,
    selectedRoute: ScoredRoute,
    alternativeRoute: ScoredRoute | null,
    routeDecisionReason: string
  ): ExecutableTradeQuote {
    const { routeType, legs } = selectedRoute;
    const totalSize = legs.reduce((sum, leg) => sum + Number(leg.size), 0);
    const notional = legs.reduce((sum, leg) => sum + Number(leg.size) * leg.price, 0);
    const expiresAt = new Date(this.now().getTime() + 60_000).toISOString();
    const estimatedSavings = alternativeRoute
      ? Math.max(0, routeSavings(input.side, selectedRoute, alternativeRoute))
      : 0;
    const savingsBreakdown = buildSavingsBreakdown(input.side, selectedRoute, alternativeRoute);
    return {
      quoteId: `exec_quote_${randomUUID()}`,
      userId: input.userId,
      side: input.side,
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      routeType,
      venuePath: legs.map((leg) => leg.venue),
      executableAmount: decimal(totalSize),
      skippedAmount: "0",
      expectedPrice: totalSize > 0 ? roundPrice(notional / totalSize) : 0,
      effectivePrice: totalSize > 0 ? roundPrice(selectedRoute.effectiveNotional / totalSize) : 0,
      estimatedSavings: roundPrice(estimatedSavings),
      savingsBreakdown,
      routeDecisionReason,
      requiredUserSignatureSteps: legs
        .filter((leg) => leg.requiresUserSignature)
        .map((leg) => `${leg.venue} user signature required`),
      expiresAt,
      legs: legs.map((leg) => ({ ...leg }))
    };
  }

  private async readinessByVenue(): Promise<Map<string, ExecutionVenueReadinessSummary>> {
    const rows = await this.readiness.listVenues();
    return new Map(rows.map((row) => [row.venue.toUpperCase(), row]));
  }
}

export class SellQuoteService {
  public constructor(
    private readonly positions: VerifiedPositionRepository,
    private readonly routes: ExecutableRouteService
  ) {}

  public async prepareExit(input: PrepareExitRequest): Promise<PreparedExitQuote> {
    const positions = await this.positions.listVerifiedPositions({
      userId: input.userId,
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      ...(input.sellMode === "SINGLE_VENUE_SELL" ? { venue: requireVenue(input.venue) } : {})
    });
    const verifiedPositions = positions.filter((position) =>
      position.status === "VERIFIED" && parseNonNegativeNumber(position.sellableSize, "sellableSize") > 0
    );
    if (verifiedPositions.length === 0) {
      return {
        quote: null,
        allocations: [],
        skippedAmount: "0",
        userMessage: "No verified sellable position is available.",
        rejectedCandidates: []
      };
    }
    const allocations = allocateSellSizes(input, verifiedPositions);
    const amount = allocations.reduce((sum, allocation) => sum + Number(allocation.sellSize), 0);
    const quote = await this.routes.quote({
      userId: input.userId,
      side: "sell",
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      amount: decimal(amount),
      candidates: allocations.map((allocation) => {
        const source = input.candidates.find((candidate) => candidate.venue.toUpperCase() === allocation.venue);
        return {
          venue: allocation.venue,
          price: allocation.price,
          availableSize: allocation.sellSize,
          ...(source?.requiresUserSignature !== undefined ? { requiresUserSignature: source.requiresUserSignature } : {})
        };
      })
    });
    return {
      quote: quote.quote,
      allocations,
      skippedAmount: quote.quote ? "0" : decimal(amount),
      ...(quote.userMessage ? { userMessage: quote.userMessage } : {}),
      rejectedCandidates: quote.rejectedCandidates
    };
  }
}

export const classifyGhostFillRecovery = (input: RecoveryClassificationInput): RecoveryClassification => {
  if (input.possibleDuplicatePosition || input.evidenceState === "AMBIGUOUS" || input.evidenceState === "MISMATCHED") {
    return {
      action: "MANUAL_REVIEW",
      reason: input.possibleDuplicatePosition
        ? "possible_duplicate_position"
        : input.evidenceState === "MISMATCHED"
          ? "evidence_mismatched"
          : "evidence_ambiguous",
      automated: false
    };
  }
  if (input.evidenceState === "MATCHED") {
    return { action: "NO_ACTION_SAFE_PENDING", reason: "evidence_matched", automated: true };
  }
  if (input.statusFailureTransient) {
    return { action: "AUTO_RETRY_STATUS", reason: "transient_status_failure", automated: true };
  }
  if (input.finalityDelayLikely) {
    return { action: "AUTO_WAIT_FOR_FINALITY", reason: "finality_delay_likely", automated: true };
  }
  if (!input.positionExists && input.fundsStillAvailable) {
    return { action: "AUTO_REROUTE", reason: "no_position_and_funds_available", automated: true };
  }
  if (!input.positionExists && input.userNeedsRestoration) {
    return { action: "AUTO_REFUND", reason: "no_position_user_needs_restoration", automated: true };
  }
  return { action: "MANUAL_REVIEW", reason: "missing_evidence_not_safely_recoverable", automated: false };
};

const evaluateCandidate = (
  candidate: TradeRouteCandidate,
  readiness: ExecutionVenueReadinessSummary | undefined
): {
  executable: boolean;
  status: ExecutabilityStatus;
  blockerCategory: string;
  adminReason: string;
} => {
  if (!readiness) {
    return {
      executable: false,
      status: "BLOCKED",
      blockerCategory: "VENUE_NOT_CONFIGURED",
      adminReason: `${candidate.venue} is not present in execution readiness.`
    };
  }
  if ((candidate.quoteBlockers?.length ?? 0) > 0) {
    return {
      executable: false,
      status: "BLOCKED",
      blockerCategory: "QUOTE_EVIDENCE_BLOCKED",
      adminReason: `${candidate.venue} quote evidence blocked: ${candidate.quoteBlockers!.join("; ")}`
    };
  }
  if (candidate.recoveryRequired) {
    return { executable: false, status: "RECOVERY_REQUIRED", blockerCategory: "RECOVERY_REQUIRED", adminReason: `${candidate.venue} has unresolved recovery state.` };
  }
  if (candidate.activationRequired) {
    return { executable: false, status: "ACTIVATION_REQUIRED", blockerCategory: "ACTIVATION_REQUIRED", adminReason: `${candidate.venue} requires balance activation.` };
  }
  if (candidate.settlementEvidenceSupported === false) {
    return { executable: false, status: "SETTLEMENT_EVIDENCE_MISSING", blockerCategory: "SETTLEMENT_EVIDENCE_MISSING", adminReason: `${candidate.venue} settlement evidence is not supported.` };
  }
  if (readiness.venueAccountRequired && !readiness.venueAccountConfigured) {
    return {
      executable: false,
      status: "BLOCKED",
      blockerCategory: "VENUE_ACCOUNT_NOT_READY",
      adminReason: readiness.accountSetupBlockers.join("; ") || `${readiness.venue} venue account is not ready.`
    };
  }
  if (!readiness.liveSubmissionSupported || (readiness.operationalStatus !== "STRUCTURALLY_READY" && readiness.operationalStatus !== "LIVE_DISABLED")) {
    return {
      executable: false,
      status: "QUOTE_ONLY",
      blockerCategory: "LIVE_SUBMIT_NOT_READY",
      adminReason: readiness.operatorMessage
    };
  }
  return {
    executable: true,
    status: candidate.requiresUserSignature ? "USER_SIGNATURE_REQUIRED" : "EXECUTION_READY",
    blockerCategory: "NONE",
    adminReason: "executable"
  };
};

const isQuotePreviewableEvaluation = (evaluation: {
  executable: boolean;
  status: ExecutabilityStatus;
  blockerCategory: string;
}): boolean => {
  if (evaluation.executable) {
    return false;
  }
  return evaluation.status === "QUOTE_ONLY" ||
    evaluation.blockerCategory === "VENUE_ACCOUNT_NOT_READY" ||
    evaluation.blockerCategory === "VENUE_NOT_CONFIGURED";
};

const allocateSellSizes = (
  input: PrepareExitRequest,
  positions: readonly VerifiedExecutionPosition[]
): PreparedSellAllocation[] => {
  const priceByVenue = new Map(input.candidates.map((candidate) => [candidate.venue.toUpperCase(), candidate.price]));
  if (input.sizeMode === "PERCENT") {
    const percent = input.percent;
    if (percent !== 25 && percent !== 50 && percent !== 100) {
      throw new Error("Sell percent must be 25, 50, or 100.");
    }
    return positions.map((position) => {
      const available = parseNonNegativeNumber(position.sellableSize, "sellableSize");
      return {
        venue: position.venue.toUpperCase(),
        positionId: position.positionId,
        sellSize: decimal(available * percent / 100),
        availableSize: decimal(available),
        price: priceByVenue.get(position.venue.toUpperCase()) ?? position.averageEntryPrice
      };
    }).filter((allocation) => Number(allocation.sellSize) > 0);
  }
  const customAmount = parsePositiveNumber(input.amount ?? "", "amount");
  const totalAvailable = positions.reduce((sum, position) => sum + Number(position.sellableSize), 0);
  if (customAmount > totalAvailable) {
    throw new Error("Custom sell amount cannot exceed verified sellable position size.");
  }
  if (input.sellMode === "SINGLE_VENUE_SELL") {
    const position = positions[0]!;
    return [{
      venue: position.venue.toUpperCase(),
      positionId: position.positionId,
      sellSize: decimal(customAmount),
      availableSize: decimal(Number(position.sellableSize)),
      price: priceByVenue.get(position.venue.toUpperCase()) ?? position.averageEntryPrice
    }];
  }
  return positions.map((position) => {
    const available = Number(position.sellableSize);
    return {
      venue: position.venue.toUpperCase(),
      positionId: position.positionId,
      sellSize: decimal(customAmount * (available / totalAvailable)),
      availableSize: decimal(available),
      price: priceByVenue.get(position.venue.toUpperCase()) ?? position.averageEntryPrice
    };
  }).filter((allocation) => Number(allocation.sellSize) > 0);
};

const requireVenue = (venue: string | undefined): string => {
  if (!venue || venue.trim().length === 0) {
    throw new Error("SINGLE_VENUE_SELL requires venue.");
  }
  return venue.trim().toUpperCase();
};

const chooseRoute = (
  side: TradeSide,
  singleRoute: ScoredRoute | null,
  multiRoute: ScoredRoute | null,
  threshold: number
): { route: ScoredRoute | null; reason: string } => {
  if (!singleRoute && !multiRoute) {
    return { route: null, reason: "no_executable_route" };
  }
  if (!singleRoute && multiRoute) {
    return { route: multiRoute, reason: "multi_venue_selected_no_single_venue_can_fill" };
  }
  if (singleRoute && !multiRoute) {
    return { route: singleRoute, reason: "single_venue_selected_no_multi_venue_improvement" };
  }
  const single = singleRoute!;
  const multi = multiRoute!;
  const improvement = routeSavings(side, multi, single);
  if (improvement >= threshold) {
    return { route: multi, reason: "multi_venue_selected_best_net_execution" };
  }
  return { route: single, reason: "single_venue_selected_multi_venue_improvement_below_threshold" };
};

const routeSavings = (side: TradeSide, selected: ScoredRoute, alternative: ScoredRoute): number =>
  side === "buy"
    ? alternative.effectiveNotional - selected.effectiveNotional
    : selected.effectiveNotional - alternative.effectiveNotional;

const routeImprovementThreshold = (
  singleRoute: ScoredRoute,
  multiRoute: ScoredRoute,
  policy: SmartRoutePolicy
): number => {
  const referenceNotional = Math.max(singleRoute.effectiveNotional, multiRoute.effectiveNotional, 0);
  const highNotional = referenceNotional >= policy.highNotionalUsd;
  const bpsRate = policy.mode === "STAGING"
    ? highNotional ? policy.stagingHighNotionalMinBps : policy.stagingLowNotionalMinBps
    : highNotional ? policy.productionHighNotionalMinBps : policy.productionLowNotionalMinBps;
  const bps = referenceNotional * bpsRate / 10_000;
  const extraFixedFees = Math.max(0, multiRoute.legs.length - singleRoute.legs.length) * 0.0001;
  return Math.max(policy.minimumPositiveImprovement, bps, extraFixedFees);
};

const defaultSmartRoutePolicy: SmartRoutePolicy = {
  mode: "PRODUCTION",
  highNotionalUsd: 99.9,
  productionHighNotionalMinBps: 2,
  productionLowNotionalMinBps: 10,
  stagingHighNotionalMinBps: 0,
  stagingLowNotionalMinBps: 1,
  minimumPositiveImprovement: 0.000001
};

const smartRoutePolicyFromEnv = (): SmartRoutePolicy => {
  const explicitMode = process.env.EXECUTION_SMART_ROUTE_MODE?.trim().toUpperCase();
  const deployEnv = [
    process.env.LOTUS_DEPLOY_ENV,
    process.env.APP_ENV,
    process.env.RENDER_SERVICE_NAME,
    process.env.FLY_APP_NAME
  ].filter(Boolean).join(" ").trim().toUpperCase();
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  const mode: SmartRoutePolicyMode = explicitMode === "STAGING" || explicitMode === "CASUAL" || deployEnv.includes("STAGING")
    ? "STAGING"
    : nodeEnv === "production"
      ? "PRODUCTION"
      : "STAGING";
  return { ...defaultSmartRoutePolicy, mode };
};

const compareCandidatesByEffectivePrice = (
  side: TradeSide,
  left: TradeRouteCandidate,
  right: TradeRouteCandidate
): number => {
  const leftPrice = effectiveCandidatePrice(side, left);
  const rightPrice = effectiveCandidatePrice(side, right);
  return side === "buy" ? leftPrice - rightPrice : rightPrice - leftPrice;
};

const toLeg = (candidate: TradeRouteCandidate, size: number): ExecutableRouteLeg => ({
  venue: candidate.venue.toUpperCase(),
  ...(candidate.venueMarketId ? { venueMarketId: candidate.venueMarketId } : {}),
  ...(candidate.venueOutcomeId ? { venueOutcomeId: candidate.venueOutcomeId } : {}),
  size: decimal(size),
  price: candidate.price,
  ...(candidate.feeAmount !== undefined ? { feeAmount: prorateFee(candidate, size) } : {}),
  ...(candidate.effectiveFeeBps !== undefined ? { effectiveFeeBps: candidate.effectiveFeeBps } : {}),
  ...(candidate.feeConfidence ? { feeConfidence: candidate.feeConfidence } : {}),
  requiresUserSignature: candidate.requiresUserSignature === true
});

const scoreRoute = (
  side: TradeSide,
  routeType: TradeRouteType,
  legs: readonly ExecutableRouteLeg[],
  sourceCandidates: readonly TradeRouteCandidate[],
  skippedDustVenues: readonly string[]
): ScoredRoute => {
  const candidateByVenue = new Map(sourceCandidates.map((candidate) => [candidate.venue.toUpperCase(), candidate]));
  const rawNotional = legs.reduce((sum, leg) => sum + Number(leg.size) * leg.price, 0);
  const feeNotional = legs.reduce((sum, leg) => {
    const candidate = candidateByVenue.get(leg.venue);
    return sum + (candidate ? prorateFee(candidate, Number(leg.size)) : 0);
  }, 0);
  const slippageNotional = legs.reduce((sum, leg) => {
    const candidate = candidateByVenue.get(leg.venue);
    const slippageBps = nonNegative(candidate?.slippageBps);
    return sum + Number(leg.size) * leg.price * slippageBps / 10_000;
  }, 0);
  const feeEvidenceComplete = legs.every((leg) => {
    const candidate = candidateByVenue.get(leg.venue);
    return Boolean(candidate) &&
      !(candidate?.missingFactors ?? []).includes("FEE_DISCOVERY") &&
      (candidate?.feeAmount !== undefined || candidate?.effectiveFeeBps !== undefined || candidate?.feeBps !== undefined) &&
      candidate?.feeConfidence !== "LOW";
  });
  const candidateAdjustedNotional = legs.reduce((sum, leg) => {
    const candidate = candidateByVenue.get(leg.venue);
    const effectivePrice = candidate ? effectiveCandidatePrice(side, candidate, Number(leg.size)) : leg.price;
    return sum + Number(leg.size) * effectivePrice;
  }, 0);
  const effectiveNotional = candidateAdjustedNotional + routeFrictionNotional(side, legs);
  return {
    routeType,
    legs: legs.map((leg) => ({ ...leg })),
    rawNotional,
    feeNotional,
    slippageNotional,
    feeEvidenceComplete,
    effectiveNotional,
    score: effectiveNotional,
    skippedDustVenues: [...new Set(skippedDustVenues.map((venue) => venue.toUpperCase()))]
  };
};

const effectiveCandidatePrice = (
  side: TradeSide,
  candidate: TradeRouteCandidate,
  size = parseNonNegativeNumber(candidate.availableSize, "availableSize")
): number => {
  const basis = Math.max(candidate.price, 0);
  const feeBps = candidate.effectiveFeeBps ?? candidate.feeBps;
  const variableBps = nonNegative(feeBps) + nonNegative(candidate.spreadBps) + nonNegative(candidate.slippageBps);
  const fixedFeeImpact = size > 0 ? nonNegative(candidate.fixedFee) / size : 0;
  const liquidityPenaltyBps = liquidityPenalty(candidate.liquidityScore);
  const signaturePenaltyBps = candidate.requiresUserSignature ? userSignaturePenaltyBps : 0;
  const confidencePenaltyBps = nonNegative(candidate.confidencePenaltyBps);
  const adjustment = basis * ((variableBps + liquidityPenaltyBps + signaturePenaltyBps + confidencePenaltyBps) / 10_000) + fixedFeeImpact;
  return side === "buy" ? basis + adjustment : basis - adjustment;
};

const buildSavingsBreakdown = (
  side: TradeSide,
  selected: ScoredRoute,
  alternative: ScoredRoute | null
): SavingsBreakdown => {
  if (!alternative) {
    return {
      priceSavings: 0,
      feeSavings: 0,
      slippageSavings: 0,
      totalSavings: 0,
      displayAllowed: false,
      displayBlockedReason: "NO_BASELINE_ROUTE"
    };
  }
  const direction = side === "buy" ? 1 : -1;
  const priceSavings = Math.max(0, direction * (alternative.rawNotional - selected.rawNotional));
  const feeSavings = Math.max(0, alternative.feeNotional - selected.feeNotional);
  const slippageSavings = Math.max(0, alternative.slippageNotional - selected.slippageNotional);
  const totalSavings = Math.max(0, routeSavings(side, selected, alternative));
  const displayAllowed = totalSavings > 0 && selected.feeEvidenceComplete && alternative.feeEvidenceComplete;
  return {
    priceSavings: roundPrice(priceSavings),
    feeSavings: roundPrice(feeSavings),
    slippageSavings: roundPrice(slippageSavings),
    totalSavings: roundPrice(totalSavings),
    displayAllowed,
    ...(displayAllowed
      ? {}
      : { displayBlockedReason: totalSavings > 0 ? "FEE_EVIDENCE_INCOMPLETE" : "NO_POSITIVE_SAVINGS" })
  };
};

const prorateFee = (candidate: TradeRouteCandidate, size: number): number => {
  if (candidate.feeAmount !== undefined) {
    const available = parseNonNegativeNumber(candidate.availableSize, "availableSize");
    return available > 0 ? nonNegative(candidate.feeAmount) * (size / available) : nonNegative(candidate.feeAmount);
  }
  const feeBps = candidate.effectiveFeeBps ?? candidate.feeBps;
  return candidate.price * size * nonNegative(feeBps) / 10_000;
};

const routeFrictionNotional = (side: TradeSide, legs: readonly ExecutableRouteLeg[]): number => {
  const extraVenueCount = Math.max(0, legs.length - 1);
  if (extraVenueCount === 0) {
    return 0;
  }
  const rawNotional = legs.reduce((sum, leg) => sum + Number(leg.size) * leg.price, 0);
  const friction = rawNotional * (extraVenueCount * extraVenuePenaltyBps) / 10_000;
  return side === "buy" ? friction : -friction;
};

const liquidityPenalty = (score: number | undefined): number => {
  if (score === undefined) {
    return 0;
  }
  const normalized = Math.max(0, Math.min(1, score));
  return (1 - normalized) * liquidityPenaltyBps;
};

const nonNegative = (value: number | undefined): number =>
  Number.isFinite(value) && value !== undefined && value > 0 ? value : 0;

const parsePositiveNumber = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
};

const parseNonNegativeNumber = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be non-negative.`);
  }
  return parsed;
};

const extraVenuePenaltyBps = 2;
const userSignaturePenaltyBps = 5;
const liquidityPenaltyBps = 1;
const routeDustTolerance = 1e-8;

const decimal = (value: number): string => {
  const roundedInteger = Math.round(value);
  if (Number.isInteger(value) || Math.abs(value - roundedInteger) <= routeDustTolerance) {
    return String(roundedInteger);
  }
  return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
};

const roundPrice = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
