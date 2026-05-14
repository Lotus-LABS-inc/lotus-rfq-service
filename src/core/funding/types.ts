import { z } from "zod";

const fundingAggregateStates = [
  "INTENT_CREATED",
  "ROUTES_QUOTED",
  "USER_SIGNATURE_REQUIRED",
  "USER_SIGNED",
  "ROUTES_SUBMITTED",
  "BRIDGING",
  "PARTIALLY_READY_TO_TRADE",
  "READY_TO_TRADE",
  "PARTIALLY_FAILED",
  "FAILED",
  "CANCELLED",
  "REFUNDED_OR_RETRY_REQUIRED"
] as const;

export type FundingAggregateState = (typeof fundingAggregateStates)[number];

const fundingLegStates = [
  "LEG_CREATED",
  "LEG_QUOTED",
  "LEG_SIGNATURE_REQUIRED",
  "LEG_SUBMITTED",
  "LEG_BRIDGE_PENDING",
  "LEG_DESTINATION_RECEIVED",
  "LEG_VENUE_CREDIT_PENDING",
  "LEG_READY_TO_TRADE",
  "LEG_FAILED",
  "LEG_CANCELLED",
  "LEG_RETRY_REQUIRED"
] as const;

export type FundingLegState = (typeof fundingLegStates)[number];

const fundingVenues = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const;
export type FundingVenue = (typeof fundingVenues)[number];

const withdrawalAggregateStates = [
  "WITHDRAWAL_CREATED",
  "WITHDRAWAL_QUOTED",
  "USER_SIGNATURE_REQUIRED",
  "USER_SIGNED",
  "WITHDRAWAL_SUBMITTED",
  "PARTIALLY_WITHDRAWING",
  "WITHDRAWING",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "PARTIALLY_FAILED",
  "FAILED",
  "CANCELLED",
  "RETRY_REQUIRED"
] as const;

export type WithdrawalAggregateState = (typeof withdrawalAggregateStates)[number];

const withdrawalLegStates = [
  "WITHDRAWAL_LEG_CREATED",
  "WITHDRAWAL_LEG_QUOTED",
  "WITHDRAWAL_LEG_SIGNATURE_REQUIRED",
  "WITHDRAWAL_LEG_SUBMITTED",
  "VENUE_RELEASE_PENDING",
  "DESTINATION_PENDING",
  "DESTINATION_RECEIVED",
  "WITHDRAWAL_LEG_COMPLETED",
  "WITHDRAWAL_LEG_FAILED",
  "WITHDRAWAL_LEG_RETRY_REQUIRED"
] as const;

export type WithdrawalLegState = (typeof withdrawalLegStates)[number];

const withdrawalCapabilityModes = [
  "USER_SIGNED",
  "AUTO_RESOLUTION_ONLY",
  "PARTNER_MANAGED_BACKEND",
  "UNSUPPORTED"
] as const;

export type WithdrawalCapabilityMode = (typeof withdrawalCapabilityModes)[number];

const fundingAuditEventTypes = [
  "FUNDING_INTENT_CREATED",
  "FUNDING_ROUTES_QUOTED",
  "FUNDING_USER_SIGNATURE_REQUIRED",
  "FUNDING_USER_SIGNED",
  "FUNDING_ROUTES_SUBMITTED",
  "FUNDING_LEG_SUBMITTED",
  "FUNDING_LEG_BRIDGE_PENDING",
  "FUNDING_LEG_DESTINATION_RECEIVED",
  "FUNDING_LEG_VENUE_CREDIT_PENDING",
  "FUNDING_LEG_READY_TO_TRADE",
  "FUNDING_LEG_FAILED",
  "FUNDING_PARTIALLY_READY_TO_TRADE",
  "FUNDING_READY_TO_TRADE",
  "FUNDING_FAILED",
  "FUNDING_RETRY_REQUESTED",
  "FUNDING_REFUND_REQUIRED",
  "FUNDING_CANCELLED"
] as const;

export type FundingAuditEventType = (typeof fundingAuditEventTypes)[number];

const positiveAmount = z.string().regex(/^\d+(\.\d+)?$/);
const isoDateString = z.string().datetime();

const FundingTargetRequestSchema = z.object({
  targetVenue: z.enum(fundingVenues),
  targetAmount: positiveAmount.optional(),
  targetPercentage: z.number().positive().max(100).optional()
}).refine((value) => Boolean(value.targetAmount ?? value.targetPercentage), {
  message: "Funding target requires targetAmount or targetPercentage."
});

export type FundingTargetRequest = z.infer<typeof FundingTargetRequestSchema>;

const WithdrawalSourceRequestSchema = z.object({
  sourceVenue: z.enum(fundingVenues),
  sourceAmount: positiveAmount.optional(),
  sourcePercentage: z.number().positive().max(100).optional()
}).refine((value) => Boolean(value.sourceAmount ?? value.sourcePercentage), {
  message: "Withdrawal source requires sourceAmount or sourcePercentage."
}).refine((value) => !(value.sourceAmount && value.sourcePercentage), {
  message: "Withdrawal source must use either sourceAmount or sourcePercentage, not both."
});

export type WithdrawalSourceRequest = z.infer<typeof WithdrawalSourceRequestSchema>;

export const CreateFundingIntentSchema = z.object({
  sourceChain: z.string().min(1),
  sourceToken: z.string().min(1),
  sourceAmount: positiveAmount,
  sourceWalletAddress: z.string().min(1).optional(),
  sourceWalletId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  targets: z.array(FundingTargetRequestSchema).min(1)
});

export type CreateFundingIntentInput = z.infer<typeof CreateFundingIntentSchema>;

export const CreateWithdrawalIntentSchema = z.object({
  token: z.string().min(1),
  amount: positiveAmount,
  destinationChain: z.string().min(1),
  destinationWalletAddress: z.string().min(1),
  idempotencyKey: z.string().min(1),
  sources: z.array(WithdrawalSourceRequestSchema).min(1)
});

export type CreateWithdrawalIntentInput = z.infer<typeof CreateWithdrawalIntentSchema>;

const FundingIntentSchema = z.object({
  fundingIntentId: z.string().min(1),
  userId: z.string().min(1),
  sourceChain: z.string().min(1),
  sourceToken: z.string().min(1),
  sourceAmount: positiveAmount,
  sourceWalletAddress: z.string().min(1),
  sourceWalletId: z.string().min(1).nullable().optional(),
  status: z.enum(fundingAggregateStates),
  idempotencyKey: z.string().min(1),
  aggregateRouteQuote: z.record(z.string(), z.unknown()),
  totalEstimatedFees: z.string(),
  totalEstimatedTimeSeconds: z.number().int().nonnegative().nullable(),
  auditEventIds: z.array(z.string()),
  createdAt: isoDateString,
  updatedAt: isoDateString
});

export type FundingIntent = z.infer<typeof FundingIntentSchema>;

const FundingTargetSchema = z.object({
  fundingTargetId: z.string().min(1),
  fundingIntentId: z.string().min(1),
  targetVenue: z.enum(fundingVenues),
  targetChain: z.string().min(1),
  targetToken: z.string().min(1),
  targetAmount: positiveAmount,
  targetPercentage: z.number().positive().max(100).nullable(),
  venueCapabilitySnapshot: z.record(z.string(), z.unknown()),
  status: z.enum(fundingLegStates),
  createdAt: isoDateString,
  updatedAt: isoDateString
});

export type FundingTarget = z.infer<typeof FundingTargetSchema>;

const SafeTransactionRequestSchema = z.object({
  to: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  data: z.string().min(1).optional(),
  value: z.string().optional(),
  chainId: z.number().int().positive().optional(),
  gasLimit: z.string().optional(),
  gasPrice: z.string().optional(),
  maxFeePerGas: z.string().optional(),
  maxPriorityFeePerGas: z.string().optional(),
  unsignedTransaction: z.string().optional(),
  signWith: z.string().optional(),
  recentBlockhash: z.string().optional()
});

export type SafeTransactionRequest = z.infer<typeof SafeTransactionRequestSchema>;

const fundingRouteProviders = ["LIFI", "DIRECT_TRANSFER"] as const;
export type FundingRouteProvider = (typeof fundingRouteProviders)[number];

const FundingRouteQuoteSchema = z.object({
  provider: z.enum(fundingRouteProviders),
  providerRouteId: z.string().nullable(),
  sourceChain: z.string().min(1),
  sourceToken: z.string().min(1),
  sourceAmount: positiveAmount,
  destinationChain: z.string().min(1),
  destinationToken: z.string().min(1),
  destinationAmountEstimate: z.string(),
  estimatedFees: z.string(),
  estimatedTimeSeconds: z.number().int().nonnegative().nullable(),
  expiresAt: isoDateString,
  transactionRequest: SafeTransactionRequestSchema.nullable(),
  userSafeSummary: z.string()
});

export type FundingRouteQuote = z.infer<typeof FundingRouteQuoteSchema>;

const FundingRouteLegSchema = z.object({
  routeLegId: z.string().min(1),
  fundingIntentId: z.string().min(1),
  fundingTargetId: z.string().min(1),
  targetVenue: z.enum(fundingVenues),
  sourceChain: z.string().min(1),
  sourceToken: z.string().min(1),
  sourceAmount: positiveAmount,
  destinationChain: z.string().min(1),
  destinationToken: z.string().min(1),
  destinationAmountEstimate: z.string(),
  routeProvider: z.enum(fundingRouteProviders),
  routeQuote: FundingRouteQuoteSchema,
  txHashes: z.array(z.string()),
  providerStatus: z.record(z.string(), z.unknown()),
  bridgeStatus: z.string(),
  destinationStatus: z.string(),
  venueCreditStatus: z.string(),
  status: z.enum(fundingLegStates),
  errorReason: z.string().nullable(),
  createdAt: isoDateString,
  updatedAt: isoDateString
});

export type FundingRouteLeg = z.infer<typeof FundingRouteLegSchema>;

const VenueCapabilitySchema = z.object({
  venue: z.enum(fundingVenues),
  supportedChains: z.array(z.string().min(1)),
  supportedTokens: z.array(z.string().min(1)),
  preferredChain: z.string().min(1),
  preferredToken: z.string().min(1),
  preferredChainId: z.number().int().positive(),
  preferredTokenAddress: z.string().min(1),
  sourceTokenAddressByChain: z.record(z.string(), z.string().min(1)),
  autoCreditSupported: z.boolean(),
  requiresFinalizationStep: z.boolean(),
  supportsDirectDeposit: z.boolean(),
  supportsWithdrawal: z.boolean(),
  withdrawalDestinations: z.array(z.object({
    chain: z.string().min(1),
    chainId: z.number().int().positive(),
    token: z.string().min(1),
    tokenAddress: z.string().min(1),
    supported: z.boolean(),
    notes: z.string().optional()
  })).optional(),
  withdrawalMode: z.enum(withdrawalCapabilityModes),
  userSignedWithdrawalSupported: z.boolean(),
  partnerManagedWithdrawal: z.object({
    mode: z.literal("PARTNER_MANAGED_BACKEND"),
    enabled: z.boolean(),
    requiresHmacAuth: z.boolean(),
    requiresWithdrawalScope: z.boolean(),
    requiresCustodySecurityApproval: z.boolean(),
    notes: z.string()
  }).nullable(),
  readinessStatus: z.enum(["READY", "DISABLED", "PLANNED", "UNKNOWN"]),
  depositAddressConfigured: z.boolean(),
  notes: z.string()
});

export type VenueCapability = z.infer<typeof VenueCapabilitySchema>;

const FundingReconciliationRecordSchema = z.object({
  reconciliationId: z.string().min(1),
  fundingIntentId: z.string().min(1),
  routeLegId: z.string().min(1),
  targetVenue: z.enum(fundingVenues),
  destinationTxHash: z.string().nullable(),
  destinationReceived: z.boolean(),
  venueCreditConfirmed: z.boolean(),
  readyToTrade: z.boolean(),
  checkedAt: isoDateString,
  notes: z.string()
});

export type FundingReconciliationRecord = z.infer<typeof FundingReconciliationRecordSchema>;

export interface FundingIntentView {
  intent: FundingIntent;
  targets: FundingTarget[];
  routeLegs: FundingRouteLeg[];
  reconciliations: FundingReconciliationRecord[];
  userSafeMessage: string;
}

export interface VenueBalanceView {
  venue: FundingVenue;
  token: string;
  readyAmount: string;
  pendingWithdrawalAmount: string;
  availableAmount: string;
  updatedAt: string | null;
}

export interface FundingHistoryItem {
  id: string;
  direction: "FUNDING" | "WITHDRAWAL";
  intentId: string;
  routeLegId: string | null;
  venue: FundingVenue;
  token: string;
  amount: string;
  sourceChain: string | null;
  destinationChain: string | null;
  status: FundingAggregateState | FundingLegState | WithdrawalAggregateState | WithdrawalLegState;
  aggregateStatus: FundingAggregateState | WithdrawalAggregateState;
  legStatus: FundingLegState | WithdrawalLegState | null;
  txHashes: string[];
  readyToTrade: boolean | null;
  completed: boolean | null;
  destinationReceived: boolean | null;
  venueConfirmed: boolean | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FundingHistoryPage {
  items: FundingHistoryItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface WithdrawalIntent {
  withdrawalIntentId: string;
  userId: string;
  token: string;
  amount: string;
  destinationChain: string;
  destinationWalletAddress: string;
  status: WithdrawalAggregateState;
  idempotencyKey: string;
  aggregateRouteQuote: Record<string, unknown>;
  totalEstimatedFees: string;
  totalEstimatedTimeSeconds: number | null;
  auditEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalSource {
  withdrawalSourceId: string;
  withdrawalIntentId: string;
  sourceVenue: FundingVenue;
  sourceToken: string;
  sourceAmount: string;
  sourcePercentage: number | null;
  venueCapabilitySnapshot: Record<string, unknown>;
  status: WithdrawalLegState;
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalRouteQuote {
  provider: "LOTUS_WITHDRAWAL_V0";
  providerRouteId: string | null;
  sourceVenue: FundingVenue;
  sourceToken: string;
  sourceAmount: string;
  destinationChain: string;
  destinationWalletAddress: string;
  destinationAmountEstimate: string;
  estimatedFees: string;
  estimatedTimeSeconds: number | null;
  expiresAt: string;
  transactionRequest: SafeTransactionRequest | null;
  userSafeSummary: string;
}

export interface WithdrawalRouteLeg {
  withdrawalRouteLegId: string;
  withdrawalIntentId: string;
  withdrawalSourceId: string;
  sourceVenue: FundingVenue;
  sourceToken: string;
  sourceAmount: string;
  destinationChain: string;
  destinationWalletAddress: string;
  destinationAmountEstimate: string;
  routeProvider: "LOTUS_WITHDRAWAL_V0";
  routeQuote: WithdrawalRouteQuote;
  txHashes: string[];
  providerStatus: Record<string, unknown>;
  venueReleaseStatus: string;
  destinationStatus: string;
  status: WithdrawalLegState;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalReconciliationRecord {
  withdrawalReconciliationId: string;
  withdrawalIntentId: string;
  withdrawalRouteLegId: string;
  sourceVenue: FundingVenue;
  withdrawalTxHash: string | null;
  venueReleased: boolean;
  destinationReceived: boolean;
  completed: boolean;
  checkedAt: string;
  notes: string;
}

export interface WithdrawalIntentView {
  intent: WithdrawalIntent;
  sources: WithdrawalSource[];
  routeLegs: WithdrawalRouteLeg[];
  reconciliations: WithdrawalReconciliationRecord[];
  userSafeMessage: string;
}

export type FundingFailureCode =
  | "FUNDING_DISABLED"
  | "LIFI_QUOTES_DISABLED"
  | "VENUE_CAPABILITY_UNKNOWN"
  | "VENUE_CAPABILITY_DISABLED"
  | "SOURCE_CHAIN_UNSUPPORTED"
  | "SOURCE_TOKEN_UNSUPPORTED"
  | "SOURCE_WALLET_NOT_FOUND"
  | "SOURCE_WALLET_FORBIDDEN"
  | "SOURCE_WALLET_UNAVAILABLE"
  | "TARGET_WALLET_NOT_CONFIGURED"
  | "TARGET_SPLIT_INVALID"
  | "TARGET_DESTINATION_NOT_CONFIGURED"
  | "ROUTE_QUOTE_FAILED"
  | "ROUTE_QUOTE_STALE"
  | "ROUTE_DESTINATION_MISMATCH"
  | "ROUTE_PROVIDER_STATUS_UNTRUSTED"
  | "ROUTE_SUBMISSION_FAILED"
  | "FUNDING_ROUTE_REPLAY_BLOCKED"
  | "FUNDING_INTENT_NOT_FOUND"
  | "FUNDING_INTENT_FORBIDDEN"
  | "FUNDING_SIGNATURE_REJECTED"
  | "READY_TO_TRADE_NOT_AVAILABLE"
  | "BALANCE_ACTIVATION_UNAVAILABLE"
  | "WITHDRAWAL_INTENT_NOT_FOUND"
  | "WITHDRAWAL_INTENT_FORBIDDEN"
  | "WITHDRAWAL_CAPABILITY_DISABLED"
  | "WITHDRAWAL_SOURCE_BALANCE_INSUFFICIENT"
  | "WITHDRAWAL_ROUTE_REPLAY_BLOCKED"
  | "WITHDRAWAL_ROUTE_STALE"
  | "WITHDRAWAL_PROVIDER_UNAVAILABLE"
  | "WITHDRAWAL_SUBMISSION_FAILED"
  | "WITHDRAWAL_DESTINATION_INVALID"
  | "WITHDRAWAL_DESTINATION_UNSUPPORTED"
  | "WITHDRAWAL_COMPLETION_PERSISTENCE_BLOCKED";

export class FundingError extends Error {
  public constructor(
    public readonly code: FundingFailureCode,
    message: string,
    public readonly statusCode = 409
  ) {
    super(message);
  }
}

export const aggregateFundingStatus = (legStates: readonly FundingLegState[]): FundingAggregateState => {
  if (legStates.length === 0) {
    return "INTENT_CREATED";
  }
  if (legStates.every((state) => state === "LEG_READY_TO_TRADE")) {
    return "READY_TO_TRADE";
  }
  if (legStates.some((state) => state === "LEG_READY_TO_TRADE")) {
    return "PARTIALLY_READY_TO_TRADE";
  }
  if (legStates.every((state) => state === "LEG_FAILED" || state === "LEG_CANCELLED")) {
    return "FAILED";
  }
  if (legStates.some((state) => state === "LEG_FAILED" || state === "LEG_RETRY_REQUIRED")) {
    return "PARTIALLY_FAILED";
  }
  if (legStates.some((state) => state === "LEG_SUBMITTED" || state === "LEG_BRIDGE_PENDING")) {
    return "BRIDGING";
  }
  if (legStates.some((state) => state === "LEG_VENUE_CREDIT_PENDING")) {
    return "ROUTES_SUBMITTED";
  }
  if (legStates.some((state) => state === "LEG_QUOTED" || state === "LEG_SIGNATURE_REQUIRED")) {
    return "USER_SIGNATURE_REQUIRED";
  }
  return "INTENT_CREATED";
};

export const aggregateWithdrawalStatus = (legStates: readonly WithdrawalLegState[]): WithdrawalAggregateState => {
  if (legStates.length === 0) {
    return "WITHDRAWAL_CREATED";
  }
  if (legStates.every((state) => state === "WITHDRAWAL_LEG_COMPLETED")) {
    return "COMPLETED";
  }
  if (legStates.some((state) => state === "WITHDRAWAL_LEG_COMPLETED")) {
    return "PARTIALLY_COMPLETED";
  }
  if (legStates.every((state) => state === "WITHDRAWAL_LEG_FAILED")) {
    return "FAILED";
  }
  if (legStates.some((state) => state === "WITHDRAWAL_LEG_FAILED" || state === "WITHDRAWAL_LEG_RETRY_REQUIRED")) {
    return "PARTIALLY_FAILED";
  }
  if (legStates.some((state) => state === "WITHDRAWAL_LEG_SUBMITTED" || state === "VENUE_RELEASE_PENDING" || state === "DESTINATION_PENDING")) {
    return "WITHDRAWING";
  }
  if (legStates.some((state) => state === "WITHDRAWAL_LEG_QUOTED" || state === "WITHDRAWAL_LEG_SIGNATURE_REQUIRED")) {
    return "USER_SIGNATURE_REQUIRED";
  }
  return "WITHDRAWAL_CREATED";
};

export const validateCreateFundingIntentInput = (value: unknown): CreateFundingIntentInput =>
  CreateFundingIntentSchema.parse(value);

export const validateCreateWithdrawalIntentInput = (value: unknown): CreateWithdrawalIntentInput =>
  CreateWithdrawalIntentSchema.parse(value);
