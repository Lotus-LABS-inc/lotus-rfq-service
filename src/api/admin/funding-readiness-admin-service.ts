import type { FundingAdminReadinessRecord } from "../../repositories/funding.repository.js";
import {
  getLimitlessFundingReadinessConfigFromEnv,
  getPolymarketFundingReadinessConfigFromEnv
} from "../../core/funding/venue-readiness.js";

export type FundingCheckerMode = "DISABLED" | "STUB" | "LIVE_READ" | "NOT_CONFIGURED";

export type FundingReadinessStatus =
  | "UNKNOWN"
  | "DESTINATION_NOT_CONFIRMED"
  | "VENUE_CREDIT_PENDING"
  | "READY_TO_TRADE"
  | "FAILED";

export interface AdminFundingReadinessRow {
  fundingIntentId: string;
  userId: string;
  targetVenue: string;
  sourceChain: string;
  sourceToken: string;
  sourceAmount: string;
  destinationChain: string | null;
  destinationToken: string | null;
  destinationAmountEstimate: string | null;
  routeProvider: string | null;
  routeLegId: string | null;
  aggregateFundingStatus: string;
  routeLegStatus: string | null;
  bridgeStatus: string | null;
  destinationStatus: string | null;
  venueCreditStatus: string | null;
  readinessStatus: FundingReadinessStatus;
  readyToTrade: boolean;
  usableBalanceObserved: string | null;
  requiredAmount: string;
  checkerMode: FundingCheckerMode;
  checkerSource: string;
  lastCheckedAt: string | null;
  reasonNotReady: string | null;
  txHashes: string[];
  auditEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FundingReadinessOperatorSummary {
  generatedAt: string;
  totalFundingIntents: number;
  totalRouteLegs: number;
  readyToTrade: number;
  venueCreditPending: number;
  destinationNotConfirmed: number;
  failed: number;
  unknown: number;
  splitCapableIntents: number;
  partialReadyIntents: number;
  countsByVenue: Record<string, number>;
  countsByAggregateStatus: Record<string, number>;
  countsByReadinessStatus: Record<FundingReadinessStatus, number>;
  countsByCheckerMode: Record<FundingCheckerMode, number>;
  countsByRouteProvider: Record<string, number>;
  staleAgeBuckets: Record<FundingReadinessAgeBucket, number>;
  blockedRows: {
    destinationNotConfirmed: AdminFundingReadinessRow[];
    venueCreditPending: AdminFundingReadinessRow[];
    checkerDisabledOrNotConfigured: AdminFundingReadinessRow[];
    failed: AdminFundingReadinessRow[];
    unknown: AdminFundingReadinessRow[];
  };
  rows: AdminFundingReadinessRow[];
}

export type FundingReadinessAgeBucket =
  | "NEVER_CHECKED"
  | "UNDER_1H"
  | "ONE_TO_24H"
  | "ONE_TO_7D"
  | "OVER_7D";

export interface FundingReadinessAdminRepository {
  listAdminReadinessRows(filter?: {
    fundingIntentId?: string;
    userId?: string;
    venue?: string;
    limit?: number;
  }): Promise<FundingAdminReadinessRecord[]>;
}

export interface FundingReadinessAdminServiceDeps {
  repository: FundingReadinessAdminRepository;
  env?: NodeJS.ProcessEnv;
  checkerModeOverrides?: Partial<Record<string, FundingCheckerMode>>;
}

export class FundingReadinessAdminService {
  private readonly repository: FundingReadinessAdminRepository;
  private readonly env: NodeJS.ProcessEnv;
  private readonly checkerModeOverrides: Partial<Record<string, FundingCheckerMode>>;

  public constructor(deps: FundingReadinessAdminServiceDeps) {
    this.repository = deps.repository;
    this.env = deps.env ?? process.env;
    this.checkerModeOverrides = deps.checkerModeOverrides ?? {};
  }

  public async listReadiness(): Promise<AdminFundingReadinessRow[]> {
    const rows = await this.repository.listAdminReadinessRows();
    return rows.map((row) => this.toAdminRow(row));
  }

  public async listByIntent(fundingIntentId: string): Promise<AdminFundingReadinessRow[]> {
    const rows = await this.repository.listAdminReadinessRows({ fundingIntentId });
    return rows.map((row) => this.toAdminRow(row));
  }

  public async listByUser(userId: string): Promise<AdminFundingReadinessRow[]> {
    const rows = await this.repository.listAdminReadinessRows({ userId });
    return rows.map((row) => this.toAdminRow(row));
  }

  public async listByVenue(venue: string): Promise<AdminFundingReadinessRow[]> {
    const rows = await this.repository.listAdminReadinessRows({ venue: venue.toUpperCase() });
    return rows.map((row) => this.toAdminRow(row));
  }

  public async getSummary(): Promise<FundingReadinessOperatorSummary> {
    return buildFundingReadinessOperatorSummary(await this.listReadiness());
  }

  private toAdminRow(record: FundingAdminReadinessRecord): AdminFundingReadinessRow {
    const readinessStatus = resolveReadinessStatus(record);
    const requiredAmount = record.destinationAmountEstimate ?? record.targetAmount;
    const reasonNotReady = readinessStatus === "READY_TO_TRADE"
      ? null
      : redactSensitiveText(resolveReasonNotReady(record, readinessStatus), this.env);
    return {
      fundingIntentId: record.fundingIntentId,
      userId: record.userId,
      targetVenue: record.targetVenue,
      sourceChain: record.sourceChain,
      sourceToken: record.sourceToken,
      sourceAmount: record.sourceAmount,
      destinationChain: record.destinationChain,
      destinationToken: record.destinationToken,
      destinationAmountEstimate: record.destinationAmountEstimate,
      routeProvider: record.routeProvider,
      routeLegId: record.routeLegId,
      aggregateFundingStatus: record.aggregateFundingStatus,
      routeLegStatus: record.routeLegStatus,
      bridgeStatus: record.bridgeStatus,
      destinationStatus: record.destinationStatus,
      venueCreditStatus: record.venueCreditStatus,
      readinessStatus,
      readyToTrade: readinessStatus === "READY_TO_TRADE",
      usableBalanceObserved: null,
      requiredAmount,
      checkerMode: this.resolveCheckerMode(record.targetVenue),
      checkerSource: resolveCheckerSource(record.targetVenue),
      lastCheckedAt: record.reconciliationCheckedAt,
      reasonNotReady,
      txHashes: record.txHashes.map((hash) => redactSensitiveText(hash, this.env)),
      auditEventIds: record.auditEventIds,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  private resolveCheckerMode(venue: string): FundingCheckerMode {
    const normalizedVenue = venue.toUpperCase();
    const override = this.checkerModeOverrides[normalizedVenue];
    if (override) {
      return override;
    }
    if (this.env.FUNDING_VENUE_READINESS_CHECKS_ENABLED !== "true") {
      return "DISABLED";
    }
    if (normalizedVenue === "LIMITLESS") {
      const config = getLimitlessFundingReadinessConfigFromEnv(this.env);
      if (config.mode === "DISABLED") {
        return "DISABLED";
      }
      if (config.mode === "STUB") {
        return "STUB";
      }
      return config.configured ? "LIVE_READ" : "NOT_CONFIGURED";
    }
    if (normalizedVenue !== "POLYMARKET") {
      return "NOT_CONFIGURED";
    }
    const config = getPolymarketFundingReadinessConfigFromEnv(this.env);
    if (config.mode === "DISABLED") {
      return "DISABLED";
    }
    if (config.mode === "STUB") {
      return "STUB";
    }
    return config.configured ? "LIVE_READ" : "NOT_CONFIGURED";
  }
}

export class FundingReadinessNotFoundError extends Error {
  public constructor(fundingIntentId: string) {
    super(`Funding readiness for intent ${fundingIntentId} was not found.`);
    this.name = "FundingReadinessNotFoundError";
  }
}

const failedLegStates = new Set(["LEG_FAILED", "LEG_RETRY_REQUIRED", "LEG_CANCELLED"]);
const failedAggregateStates = new Set(["FAILED", "PARTIALLY_FAILED", "REFUNDED_OR_RETRY_REQUIRED", "CANCELLED"]);

const resolveReadinessStatus = (record: FundingAdminReadinessRecord): FundingReadinessStatus => {
  if (record.readyToTrade === true) {
    return "READY_TO_TRADE";
  }
  if ((record.routeLegStatus && failedLegStates.has(record.routeLegStatus)) ||
    failedAggregateStates.has(record.aggregateFundingStatus)) {
    return "FAILED";
  }
  if (isAmbiguousCheckerEvidence(record)) {
    return "UNKNOWN";
  }
  if (record.destinationReceived === true || record.destinationStatus === "CONFIRMED") {
    return "VENUE_CREDIT_PENDING";
  }
  if (!record.routeLegId || record.destinationStatus === null || record.destinationStatus === "UNKNOWN") {
    return "DESTINATION_NOT_CONFIRMED";
  }
  return "DESTINATION_NOT_CONFIRMED";
};

const isAmbiguousCheckerEvidence = (record: FundingAdminReadinessRecord): boolean => {
  if (record.venueCreditStatus === "UNKNOWN") {
    return true;
  }
  const notes = record.reconciliationNotes?.toLowerCase() ?? "";
  return notes.includes("malformed") || notes.includes("unavailable") || notes.includes("unknown");
};

const resolveReasonNotReady = (
  record: FundingAdminReadinessRecord,
  readinessStatus: FundingReadinessStatus
): string => {
  if (record.errorReason) {
    return record.errorReason;
  }
  if (record.reconciliationNotes) {
    return record.reconciliationNotes;
  }
  if (readinessStatus === "FAILED") {
    return "Funding route leg failed or requires retry.";
  }
  if (readinessStatus === "VENUE_CREDIT_PENDING") {
    return "Destination receipt exists, but venue usable balance has not been confirmed.";
  }
  if (readinessStatus === "UNKNOWN") {
    return "Venue readiness evidence is malformed, unavailable, or ambiguous.";
  }
  return "Destination receipt has not been confirmed.";
};

const resolveCheckerSource = (venue: string): string => {
  if (venue.toUpperCase() === "POLYMARKET") {
    return "polymarket_funding_readiness";
  }
  if (venue.toUpperCase() === "LIMITLESS") {
    return "limitless_funding_readiness";
  }
  return "not_configured";
};

export const buildFundingReadinessOperatorSummary = (
  rows: AdminFundingReadinessRow[],
  generatedAt = new Date().toISOString()
): FundingReadinessOperatorSummary => {
  const readinessCounts = emptyReadinessCounts();
  const checkerModeCounts = emptyCheckerModeCounts();
  const ageBuckets = emptyAgeBuckets();
  const rowsByIntent = new Map<string, AdminFundingReadinessRow[]>();
  const countsByVenue: Record<string, number> = {};
  const countsByAggregateStatus: Record<string, number> = {};
  const countsByRouteProvider: Record<string, number> = {};

  for (const row of rows) {
    addCount(countsByVenue, row.targetVenue);
    addCount(countsByAggregateStatus, row.aggregateFundingStatus);
    addCount(countsByRouteProvider, row.routeProvider ?? "NONE");
    readinessCounts[row.readinessStatus] += 1;
    checkerModeCounts[row.checkerMode] += 1;
    ageBuckets[resolveAgeBucket(row.lastCheckedAt ?? row.updatedAt, generatedAt)] += 1;
    rowsByIntent.set(row.fundingIntentId, [...(rowsByIntent.get(row.fundingIntentId) ?? []), row]);
  }

  return {
    generatedAt,
    totalFundingIntents: rowsByIntent.size,
    totalRouteLegs: rows.filter((row) => row.routeLegId !== null).length,
    readyToTrade: readinessCounts.READY_TO_TRADE,
    venueCreditPending: readinessCounts.VENUE_CREDIT_PENDING,
    destinationNotConfirmed: readinessCounts.DESTINATION_NOT_CONFIRMED,
    failed: readinessCounts.FAILED,
    unknown: readinessCounts.UNKNOWN,
    splitCapableIntents: [...rowsByIntent.values()].filter((intentRows) => intentRows.length > 1).length,
    partialReadyIntents: [...rowsByIntent.values()].filter((intentRows) =>
      intentRows.some((row) => row.readinessStatus === "READY_TO_TRADE") &&
      intentRows.some((row) => row.readinessStatus !== "READY_TO_TRADE")
    ).length,
    countsByVenue,
    countsByAggregateStatus,
    countsByReadinessStatus: readinessCounts,
    countsByCheckerMode: checkerModeCounts,
    countsByRouteProvider,
    staleAgeBuckets: ageBuckets,
    blockedRows: {
      destinationNotConfirmed: rows.filter((row) => row.readinessStatus === "DESTINATION_NOT_CONFIRMED"),
      venueCreditPending: rows.filter((row) => row.readinessStatus === "VENUE_CREDIT_PENDING"),
      checkerDisabledOrNotConfigured: rows.filter((row) => row.checkerMode === "DISABLED" || row.checkerMode === "NOT_CONFIGURED"),
      failed: rows.filter((row) => row.readinessStatus === "FAILED"),
      unknown: rows.filter((row) => row.readinessStatus === "UNKNOWN")
    },
    rows
  };
};

const emptyReadinessCounts = (): Record<FundingReadinessStatus, number> => ({
  UNKNOWN: 0,
  DESTINATION_NOT_CONFIRMED: 0,
  VENUE_CREDIT_PENDING: 0,
  READY_TO_TRADE: 0,
  FAILED: 0
});

const emptyCheckerModeCounts = (): Record<FundingCheckerMode, number> => ({
  DISABLED: 0,
  STUB: 0,
  LIVE_READ: 0,
  NOT_CONFIGURED: 0
});

const emptyAgeBuckets = (): Record<FundingReadinessAgeBucket, number> => ({
  NEVER_CHECKED: 0,
  UNDER_1H: 0,
  ONE_TO_24H: 0,
  ONE_TO_7D: 0,
  OVER_7D: 0
});

const addCount = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const resolveAgeBucket = (timestamp: string | null, generatedAt: string): FundingReadinessAgeBucket => {
  if (!timestamp) {
    return "NEVER_CHECKED";
  }
  const checkedAtMs = Date.parse(timestamp);
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(checkedAtMs) || !Number.isFinite(generatedAtMs)) {
    return "NEVER_CHECKED";
  }
  const ageMs = Math.max(0, generatedAtMs - checkedAtMs);
  if (ageMs < 60 * 60 * 1000) {
    return "UNDER_1H";
  }
  if (ageMs < 24 * 60 * 60 * 1000) {
    return "ONE_TO_24H";
  }
  if (ageMs < 7 * 24 * 60 * 60 * 1000) {
    return "ONE_TO_7D";
  }
  return "OVER_7D";
};

const sensitiveMarkers = [
  /api[_-]?key/i,
  /authorization/i,
  /auth[_-]?header/i,
  /private[_-]?key/i,
  /passphrase/i,
  /secret/i,
  /transactionRequest/i
];

const redactSensitiveText = (value: string, env: NodeJS.ProcessEnv): string => {
  if (sensitiveMarkers.some((marker) => marker.test(value))) {
    return "Sensitive provider evidence was redacted.";
  }
  return Object.entries(env).reduce((redacted, [key, secretValue]) => {
    if (!secretValue || secretValue.length < 8) {
      return redacted;
    }
    if (!sensitiveMarkers.some((marker) => marker.test(key))) {
      return redacted;
    }
    return redacted.split(secretValue).join("[REDACTED]");
  }, value);
};
