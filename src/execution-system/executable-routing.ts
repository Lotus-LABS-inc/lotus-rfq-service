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
  price: number;
  availableSize: string;
  routeType?: TradeRouteType | undefined;
  requiresUserSignature?: boolean | undefined;
  activationRequired?: boolean | undefined;
  settlementEvidenceSupported?: boolean | undefined;
  recoveryRequired?: boolean | undefined;
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
  size: string;
  price: number;
  requiresUserSignature: boolean;
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
  requiredUserSignatureSteps: string[];
  expiresAt: string;
  legs: ExecutableRouteLeg[];
}

export interface TradeQuoteSelection {
  quote: ExecutableTradeQuote | null;
  userMessage?: string;
  rejectedCandidates: RejectedRouteCandidate[];
  internalCandidateCount: number;
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
    private readonly now: () => Date = () => new Date()
  ) {}

  public async quote(input: TradeQuoteRequest): Promise<TradeQuoteSelection> {
    const amount = parsePositiveNumber(input.amount, "amount");
    const readinessByVenue = await this.readinessByVenue();
    const evaluated = input.candidates.map((candidate) => ({
      candidate,
      evaluation: evaluateCandidate(candidate, readinessByVenue.get(candidate.venue.toUpperCase()))
    }));
    const executable = evaluated
      .filter((entry) => entry.evaluation.executable)
      .map((entry) => entry.candidate)
      .sort((left, right) => input.side === "buy" ? left.price - right.price : right.price - left.price);
    const rejectedCandidates = evaluated
      .filter((entry) => !entry.evaluation.executable)
      .map((entry) => ({
        venue: entry.candidate.venue.toUpperCase(),
        status: entry.evaluation.status,
        blockerCategory: entry.evaluation.blockerCategory,
        adminReason: entry.evaluation.adminReason
      }));

    const crossVenue = this.buildCrossVenueQuote(input, executable, amount);
    const singleVenue = crossVenue ?? this.buildSingleVenueQuote(input, executable, amount);
    if (!singleVenue) {
      return {
        quote: null,
        userMessage: "No executable route available right now.",
        rejectedCandidates,
        internalCandidateCount: input.candidates.length
      };
    }

    await this.quoteRepository?.saveQuote({ quote: singleVenue, rejectedCandidates });
    return {
      quote: singleVenue,
      rejectedCandidates,
      internalCandidateCount: input.candidates.length
    };
  }

  public async getQuote(userId: string, quoteId: string): Promise<ExecutableTradeQuote | null> {
    return this.quoteRepository?.findQuote({ userId, quoteId }) ?? null;
  }

  private buildCrossVenueQuote(
    input: TradeQuoteRequest,
    executable: readonly TradeRouteCandidate[],
    amount: number
  ): ExecutableTradeQuote | null {
    if (executable.length < 2) {
      return null;
    }
    let remaining = amount;
    const legs: ExecutableRouteLeg[] = [];
    for (const candidate of executable) {
      if (remaining <= 0) {
        break;
      }
      const available = parseNonNegativeNumber(candidate.availableSize, "availableSize");
      const size = Math.min(available, remaining);
      if (size <= 0) {
        continue;
      }
      legs.push({
        venue: candidate.venue.toUpperCase(),
        size: decimal(size),
        price: candidate.price,
        requiresUserSignature: candidate.requiresUserSignature === true
      });
      remaining -= size;
    }
    if (remaining > 0 || legs.length < 2) {
      return null;
    }
    return this.buildQuote(input, "CROSS_VENUE", legs);
  }

  private buildSingleVenueQuote(
    input: TradeQuoteRequest,
    executable: readonly TradeRouteCandidate[],
    amount: number
  ): ExecutableTradeQuote | null {
    const candidate = executable.find((entry) => parseNonNegativeNumber(entry.availableSize, "availableSize") >= amount);
    if (!candidate) {
      return null;
    }
    return this.buildQuote(input, "SINGLE_VENUE", [{
      venue: candidate.venue.toUpperCase(),
      size: decimal(amount),
      price: candidate.price,
      requiresUserSignature: candidate.requiresUserSignature === true
    }]);
  }

  private buildQuote(
    input: TradeQuoteRequest,
    routeType: TradeRouteType,
    legs: readonly ExecutableRouteLeg[]
  ): ExecutableTradeQuote {
    const totalSize = legs.reduce((sum, leg) => sum + Number(leg.size), 0);
    const notional = legs.reduce((sum, leg) => sum + Number(leg.size) * leg.price, 0);
    const expiresAt = new Date(this.now().getTime() + 60_000).toISOString();
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
  if (candidate.recoveryRequired) {
    return { executable: false, status: "RECOVERY_REQUIRED", blockerCategory: "RECOVERY_REQUIRED", adminReason: `${candidate.venue} has unresolved recovery state.` };
  }
  if (candidate.activationRequired) {
    return { executable: false, status: "ACTIVATION_REQUIRED", blockerCategory: "ACTIVATION_REQUIRED", adminReason: `${candidate.venue} requires balance activation.` };
  }
  if (candidate.settlementEvidenceSupported === false) {
    return { executable: false, status: "SETTLEMENT_EVIDENCE_MISSING", blockerCategory: "SETTLEMENT_EVIDENCE_MISSING", adminReason: `${candidate.venue} settlement evidence is not supported.` };
  }
  if (!readiness.liveSubmissionSupported || !readiness.liveExecutionEnabled || readiness.operationalStatus !== "STRUCTURALLY_READY") {
    return {
      executable: false,
      status: "QUOTE_ONLY",
      blockerCategory: "LIVE_SUBMIT_NOT_READY",
      adminReason: readiness.operatorMessage
    };
  }
  if (readiness.venueAccountRequired && !readiness.venueAccountConfigured) {
    return {
      executable: false,
      status: "BLOCKED",
      blockerCategory: "VENUE_ACCOUNT_NOT_READY",
      adminReason: readiness.accountSetupBlockers.join("; ") || `${readiness.venue} venue account is not ready.`
    };
  }
  return {
    executable: true,
    status: candidate.requiresUserSignature ? "USER_SIGNATURE_REQUIRED" : "EXECUTION_READY",
    blockerCategory: "NONE",
    adminReason: "executable"
  };
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

const decimal = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

const roundPrice = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
