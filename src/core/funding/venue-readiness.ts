import Decimal from "decimal.js";
import type {
  FundingIntent,
  FundingReconciliationRecord,
  FundingRouteLeg,
  FundingVenue
} from "./types.js";

export type VenueFundingReadinessStatus =
  | "DESTINATION_RECEIVED"
  | "VENUE_CREDIT_PENDING"
  | "READY_TO_TRADE"
  | "FAILED"
  | "UNKNOWN";

export interface VenueFundingReadinessResult {
  venue: FundingVenue;
  status: VenueFundingReadinessStatus;
  destinationReceived: boolean;
  venueCreditConfirmed: boolean;
  readyToTrade: boolean;
  usableBalance: string | null;
  token: string;
  checkedAt: string;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface VenueFundingReadinessChecker {
  readonly venue: FundingVenue;
  check(input: {
    userId: string;
    intent: FundingIntent;
    leg: FundingRouteLeg;
    reconciliations: readonly FundingReconciliationRecord[];
  }): Promise<VenueFundingReadinessResult>;
}

export interface PolymarketFundingBalanceReadClient {
  fetchUsableUsdcBalance(input: {
    userId: string;
    fundingIntentId: string;
    routeLegId: string;
    targetVenue: "POLYMARKET";
  }): Promise<{ usableBalance: string; raw?: Record<string, unknown> }>;
}

export interface LimitlessFundingBalanceReadClient {
  fetchUsableUsdcBalance(input: {
    userId: string;
    fundingIntentId: string;
    routeLegId: string;
    targetVenue: "LIMITLESS";
  }): Promise<{ usableBalance: string; raw?: Record<string, unknown> }>;
}

export type PolymarketFundingReadinessMode = "DISABLED" | "STUB" | "LIVE_READ";
export type PolymarketFundingReadinessAuthMode = "NONE" | "BEARER";
export type PolymarketFundingReadinessRedactionPolicy = "SERVER_SAFE_DEFAULT";
export type LimitlessFundingReadinessMode = "DISABLED" | "STUB" | "LIVE_READ";
export type LimitlessFundingReadinessAuthMode = "NONE" | "BEARER";
export type LimitlessFundingReadinessRedactionPolicy = "SERVER_SAFE_DEFAULT";

export interface PolymarketFundingReadinessConfig {
  enabled?: boolean;
  mode?: PolymarketFundingReadinessMode;
  balanceUrl?: string | null | undefined;
  authMode?: PolymarketFundingReadinessAuthMode;
  timeoutMs?: number;
  minimumConfirmations?: number;
  redactionPolicy?: PolymarketFundingReadinessRedactionPolicy;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface LimitlessFundingReadinessConfig {
  enabled?: boolean;
  mode?: LimitlessFundingReadinessMode;
  balanceUrl?: string | null | undefined;
  authMode?: LimitlessFundingReadinessAuthMode;
  timeoutMs?: number;
  minimumConfirmations?: number;
  redactionPolicy?: LimitlessFundingReadinessRedactionPolicy;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface OperatorPolymarketFundingReadinessConfig {
  enabled: boolean;
  mode: PolymarketFundingReadinessMode;
  balanceUrl: string | null;
  authMode: PolymarketFundingReadinessAuthMode;
  timeoutMs: number;
  minimumConfirmations: number;
  redactionPolicy: PolymarketFundingReadinessRedactionPolicy;
  configured: boolean;
}

export interface OperatorLimitlessFundingReadinessConfig {
  enabled: boolean;
  mode: LimitlessFundingReadinessMode;
  balanceUrl: string | null;
  authMode: LimitlessFundingReadinessAuthMode;
  timeoutMs: number;
  minimumConfirmations: number;
  redactionPolicy: LimitlessFundingReadinessRedactionPolicy;
  configured: boolean;
}

const safeDecimal = (value: string) => {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.greaterThanOrEqualTo(0) ? parsed : null;
  } catch {
    return null;
  }
};

const destinationReceivedForLeg = (leg: FundingRouteLeg): boolean =>
  leg.destinationStatus === "CONFIRMED" || leg.status === "LEG_DESTINATION_RECEIVED" || leg.status === "LEG_VENUE_CREDIT_PENDING" || leg.status === "LEG_READY_TO_TRADE";

export const getPolymarketFundingReadinessConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorPolymarketFundingReadinessConfig => {
  const configuredMode = env.POLYMARKET_FUNDING_READINESS_MODE?.toUpperCase();
  const mode: PolymarketFundingReadinessMode =
    configuredMode === "STUB" || configuredMode === "LIVE_READ" || configuredMode === "DISABLED"
      ? configuredMode
      : env.POLYMARKET_FUNDING_READINESS_ENABLED === "true"
        ? "LIVE_READ"
        : "DISABLED";
  const balanceUrl = env.POLYMARKET_FUNDING_BALANCE_URL?.trim() || null;
  const balanceUrlValid = isValidHttpUrl(balanceUrl);
  const authMode = env.POLYMARKET_FUNDING_READ_AUTH_MODE === "BEARER" ? "BEARER" : "NONE";
  const timeoutMs = Number.parseInt(env.POLYMARKET_FUNDING_READ_TIMEOUT_MS ?? "5000", 10);
  const minimumConfirmations = Number.parseInt(env.POLYMARKET_FUNDING_MIN_CONFIRMATIONS ?? "0", 10);
  return {
    enabled: mode !== "DISABLED",
    mode,
    balanceUrl,
    authMode,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000,
    minimumConfirmations: Number.isFinite(minimumConfirmations) && minimumConfirmations > 0 ? minimumConfirmations : 0,
    redactionPolicy: "SERVER_SAFE_DEFAULT",
    configured: mode === "STUB" || (mode === "LIVE_READ" && balanceUrlValid)
  };
};

export const getLimitlessFundingReadinessConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorLimitlessFundingReadinessConfig => {
  const configuredMode = env.LIMITLESS_FUNDING_READINESS_MODE?.toUpperCase();
  const mode: LimitlessFundingReadinessMode =
    configuredMode === "STUB" || configuredMode === "LIVE_READ" || configuredMode === "DISABLED"
      ? configuredMode
      : env.LIMITLESS_FUNDING_READINESS_ENABLED === "true"
        ? "LIVE_READ"
        : "DISABLED";
  const balanceUrl = env.LIMITLESS_FUNDING_BALANCE_URL?.trim() || null;
  const balanceUrlValid = isValidHttpUrl(balanceUrl);
  const authMode = env.LIMITLESS_FUNDING_READ_AUTH_MODE === "BEARER" ? "BEARER" : "NONE";
  const timeoutMs = Number.parseInt(env.LIMITLESS_FUNDING_READ_TIMEOUT_MS ?? "5000", 10);
  const minimumConfirmations = Number.parseInt(env.LIMITLESS_FUNDING_MIN_CONFIRMATIONS ?? "0", 10);
  return {
    enabled: mode !== "DISABLED",
    mode,
    balanceUrl,
    authMode,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000,
    minimumConfirmations: Number.isFinite(minimumConfirmations) && minimumConfirmations > 0 ? minimumConfirmations : 0,
    redactionPolicy: "SERVER_SAFE_DEFAULT",
    configured: mode === "STUB" || (mode === "LIVE_READ" && balanceUrlValid)
  };
};

const isValidHttpUrl = (url: string | null): boolean => {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

export class PolymarketFundingReadinessChecker implements VenueFundingReadinessChecker {
  public readonly venue = "POLYMARKET" as const;
  private readonly now: () => Date;
  private readonly operatorConfig: OperatorPolymarketFundingReadinessConfig;

  public constructor(
    private readonly client: PolymarketFundingBalanceReadClient,
    private readonly config: PolymarketFundingReadinessConfig
  ) {
    this.now = config.now ?? (() => new Date());
    this.operatorConfig = {
      enabled: config.mode ? config.mode !== "DISABLED" : config.enabled === true,
      mode: config.mode ?? (config.enabled ? "LIVE_READ" : "DISABLED"),
      balanceUrl: config.balanceUrl ?? null,
      authMode: config.authMode ?? "NONE",
      timeoutMs: config.timeoutMs ?? 5_000,
      minimumConfirmations: config.minimumConfirmations ?? 0,
      redactionPolicy: config.redactionPolicy ?? "SERVER_SAFE_DEFAULT",
      configured: config.mode === "STUB" || (config.mode === "LIVE_READ" && Boolean(config.balanceUrl)) || (config.enabled === true && !config.mode)
    };
  }

  public async check(input: {
    userId: string;
    intent: FundingIntent;
    leg: FundingRouteLeg;
    reconciliations: readonly FundingReconciliationRecord[];
  }): Promise<VenueFundingReadinessResult> {
    const destinationReceived = destinationReceivedForLeg(input.leg);
    if (!destinationReceived) {
      return this.result({
        status: "UNKNOWN",
        destinationReceived: false,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        reason: "DESTINATION_NOT_CONFIRMED",
        evidence: this.safeEvidence({ checkerMode: this.operatorConfig.mode })
      });
    }

    if (!this.operatorConfig.enabled) {
      return this.result({
        status: "UNKNOWN",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        reason: "POLYMARKET_FUNDING_READINESS_DISABLED",
        evidence: this.safeEvidence({ checkerMode: this.operatorConfig.mode })
      });
    }

    if (!this.operatorConfig.configured) {
      return this.result({
        status: "UNKNOWN",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        reason: "POLYMARKET_FUNDING_READINESS_NOT_CONFIGURED",
        evidence: this.safeEvidence({ checkerMode: this.operatorConfig.mode })
      });
    }

    try {
      const balance = await this.client.fetchUsableUsdcBalance({
        userId: input.userId,
        fundingIntentId: input.intent.fundingIntentId,
        routeLegId: input.leg.routeLegId,
        targetVenue: "POLYMARKET"
      });
      const usableBalance = safeDecimal(balance.usableBalance);
      const requiredAmount = safeDecimal(input.leg.destinationAmountEstimate);
      if (!usableBalance || !requiredAmount) {
        return this.result({
          status: "UNKNOWN",
          destinationReceived: true,
          venueCreditConfirmed: false,
          readyToTrade: false,
          usableBalance: balance.usableBalance,
          reason: "POLYMARKET_BALANCE_RESPONSE_MALFORMED",
          evidence: this.safeEvidence({ rawStatus: "malformed_balance" })
        });
      }
      if (usableBalance.greaterThanOrEqualTo(requiredAmount)) {
        return this.result({
          status: "READY_TO_TRADE",
          destinationReceived: true,
          venueCreditConfirmed: true,
          readyToTrade: true,
          usableBalance: usableBalance.toString(),
          reason: "POLYMARKET_USABLE_BALANCE_CONFIRMED",
          evidence: this.safeEvidence({ requiredAmount: requiredAmount.toString(), usableBalance: usableBalance.toString() })
        });
      }
      return this.result({
        status: "VENUE_CREDIT_PENDING",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: usableBalance.toString(),
        reason: "POLYMARKET_USABLE_BALANCE_BELOW_REQUIRED_AMOUNT",
        evidence: this.safeEvidence({ requiredAmount: requiredAmount.toString(), usableBalance: usableBalance.toString() })
      });
    } catch (error) {
      return this.result({
        status: "UNKNOWN",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        reason: "POLYMARKET_READINESS_READ_UNAVAILABLE",
        evidence: this.safeEvidence({
          error: error instanceof Error ? "READ_UNAVAILABLE" : "UNKNOWN_READ_ERROR"
        })
      });
    }
  }

  private safeEvidence(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      source: "polymarket_funding_readiness",
      checkerMode: this.operatorConfig.mode,
      authMode: this.operatorConfig.authMode,
      minimumConfirmations: this.operatorConfig.minimumConfirmations,
      redactionPolicy: this.operatorConfig.redactionPolicy,
      ...extra
    };
  }

  private result(input: Omit<VenueFundingReadinessResult, "venue" | "token" | "checkedAt">): VenueFundingReadinessResult {
    return {
      venue: this.venue,
      token: "USDC",
      checkedAt: this.now().toISOString(),
      ...input
    };
  }
}

export class LimitlessFundingReadinessChecker implements VenueFundingReadinessChecker {
  public readonly venue = "LIMITLESS" as const;
  private readonly now: () => Date;
  private readonly operatorConfig: OperatorLimitlessFundingReadinessConfig;

  public constructor(
    private readonly client: LimitlessFundingBalanceReadClient,
    private readonly config: LimitlessFundingReadinessConfig
  ) {
    this.now = config.now ?? (() => new Date());
    this.operatorConfig = {
      enabled: config.mode ? config.mode !== "DISABLED" : config.enabled === true,
      mode: config.mode ?? (config.enabled ? "LIVE_READ" : "DISABLED"),
      balanceUrl: config.balanceUrl ?? null,
      authMode: config.authMode ?? "NONE",
      timeoutMs: config.timeoutMs ?? 5_000,
      minimumConfirmations: config.minimumConfirmations ?? 0,
      redactionPolicy: config.redactionPolicy ?? "SERVER_SAFE_DEFAULT",
      configured: config.mode === "STUB" || (config.mode === "LIVE_READ" && Boolean(config.balanceUrl)) || (config.enabled === true && !config.mode)
    };
  }

  public async check(input: {
    userId: string;
    intent: FundingIntent;
    leg: FundingRouteLeg;
    reconciliations: readonly FundingReconciliationRecord[];
  }): Promise<VenueFundingReadinessResult> {
    const destinationReceived = destinationReceivedForLeg(input.leg);
    if (!destinationReceived) {
      return this.result({
        status: "UNKNOWN",
        destinationReceived: false,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        reason: "DESTINATION_NOT_CONFIRMED",
        evidence: this.safeEvidence({ checkerMode: this.operatorConfig.mode })
      });
    }

    if (!this.operatorConfig.enabled) {
      return this.result({
        status: "UNKNOWN",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        reason: "LIMITLESS_FUNDING_READINESS_DISABLED",
        evidence: this.safeEvidence({ checkerMode: this.operatorConfig.mode })
      });
    }

    if (!this.operatorConfig.configured) {
      return this.result({
        status: "UNKNOWN",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        reason: "LIMITLESS_FUNDING_READINESS_NOT_CONFIGURED",
        evidence: this.safeEvidence({ checkerMode: this.operatorConfig.mode })
      });
    }

    try {
      const balance = await this.client.fetchUsableUsdcBalance({
        userId: input.userId,
        fundingIntentId: input.intent.fundingIntentId,
        routeLegId: input.leg.routeLegId,
        targetVenue: "LIMITLESS"
      });
      const usableBalance = safeDecimal(balance.usableBalance);
      const requiredAmount = safeDecimal(input.leg.destinationAmountEstimate);
      if (!usableBalance || !requiredAmount) {
        return this.result({
          status: "UNKNOWN",
          destinationReceived: true,
          venueCreditConfirmed: false,
          readyToTrade: false,
          usableBalance: balance.usableBalance,
          reason: "LIMITLESS_BALANCE_RESPONSE_MALFORMED",
          evidence: this.safeEvidence({ rawStatus: "malformed_balance" })
        });
      }
      if (usableBalance.greaterThanOrEqualTo(requiredAmount)) {
        return this.result({
          status: "READY_TO_TRADE",
          destinationReceived: true,
          venueCreditConfirmed: true,
          readyToTrade: true,
          usableBalance: usableBalance.toString(),
          reason: "LIMITLESS_USABLE_BALANCE_CONFIRMED",
          evidence: this.safeEvidence({ requiredAmount: requiredAmount.toString(), usableBalance: usableBalance.toString() })
        });
      }
      return this.result({
        status: "VENUE_CREDIT_PENDING",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: usableBalance.toString(),
        reason: "LIMITLESS_USABLE_BALANCE_BELOW_REQUIRED_AMOUNT",
        evidence: this.safeEvidence({ requiredAmount: requiredAmount.toString(), usableBalance: usableBalance.toString() })
      });
    } catch (error) {
      return this.result({
        status: "UNKNOWN",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        reason: "LIMITLESS_READINESS_READ_UNAVAILABLE",
        evidence: this.safeEvidence({
          error: error instanceof Error ? "READ_UNAVAILABLE" : "UNKNOWN_READ_ERROR"
        })
      });
    }
  }

  private safeEvidence(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      source: "limitless_funding_readiness",
      checkerMode: this.operatorConfig.mode,
      authMode: this.operatorConfig.authMode,
      minimumConfirmations: this.operatorConfig.minimumConfirmations,
      redactionPolicy: this.operatorConfig.redactionPolicy,
      ...extra
    };
  }

  private result(input: Omit<VenueFundingReadinessResult, "venue" | "token" | "checkedAt">): VenueFundingReadinessResult {
    return {
      venue: this.venue,
      token: "USDC",
      checkedAt: this.now().toISOString(),
      ...input
    };
  }
}

export class DisabledPolymarketFundingBalanceReadClient implements PolymarketFundingBalanceReadClient {
  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    throw new Error("Polymarket funding balance read client is not configured.");
  }
}

export class DisabledLimitlessFundingBalanceReadClient implements LimitlessFundingBalanceReadClient {
  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    throw new Error("Limitless funding balance read client is not configured.");
  }
}

export class HttpPolymarketFundingBalanceReadClient implements PolymarketFundingBalanceReadClient {
  public constructor(
    private readonly config: {
      balanceUrl?: string | undefined;
      timeoutMs?: number | undefined;
      authMode?: PolymarketFundingReadinessAuthMode | undefined;
      apiKey?: string | undefined;
      fetchImpl?: typeof fetch | undefined;
    }
  ) {}

  public async fetchUsableUsdcBalance(input: {
    userId: string;
    fundingIntentId: string;
    routeLegId: string;
    targetVenue: "POLYMARKET";
  }): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    if (!this.config.balanceUrl) {
      throw new Error("POLYMARKET_FUNDING_BALANCE_URL is not configured.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5_000);
    try {
      const url = new URL(this.config.balanceUrl);
      url.searchParams.set("userId", input.userId);
      url.searchParams.set("fundingIntentId", input.fundingIntentId);
      url.searchParams.set("routeLegId", input.routeLegId);
      const response = await (this.config.fetchImpl ?? fetch)(url, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Polymarket funding balance read failed with ${response.status}.`);
      }
      const raw = await response.json() as Record<string, unknown>;
      const usableBalance = raw.usableBalance ?? raw.availableBalance ?? raw.balance;
      if (typeof usableBalance !== "string" && typeof usableBalance !== "number") {
        throw new Error("Polymarket funding balance response did not include usableBalance.");
      }
      return { usableBalance: String(usableBalance), raw };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(): Record<string, string> {
    if (this.config.authMode === "BEARER" && this.config.apiKey) {
      return { authorization: `Bearer ${this.config.apiKey}` };
    }
    return {};
  }
}

export class HttpLimitlessFundingBalanceReadClient implements LimitlessFundingBalanceReadClient {
  public constructor(
    private readonly config: {
      balanceUrl?: string | undefined;
      timeoutMs?: number | undefined;
      authMode?: LimitlessFundingReadinessAuthMode | undefined;
      apiKey?: string | undefined;
      fetchImpl?: typeof fetch | undefined;
    }
  ) {}

  public async fetchUsableUsdcBalance(input: {
    userId: string;
    fundingIntentId: string;
    routeLegId: string;
    targetVenue: "LIMITLESS";
  }): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    if (!this.config.balanceUrl) {
      throw new Error("LIMITLESS_FUNDING_BALANCE_URL is not configured.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5_000);
    try {
      const url = new URL(this.config.balanceUrl);
      url.searchParams.set("userId", input.userId);
      url.searchParams.set("fundingIntentId", input.fundingIntentId);
      url.searchParams.set("routeLegId", input.routeLegId);
      const response = await (this.config.fetchImpl ?? fetch)(url, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Limitless funding balance read failed with ${response.status}.`);
      }
      const raw = await response.json() as Record<string, unknown>;
      const usableBalance = raw.usableBalance ?? raw.availableBalance ?? raw.balance;
      if (typeof usableBalance !== "string" && typeof usableBalance !== "number") {
        throw new Error("Limitless funding balance response did not include usableBalance.");
      }
      return { usableBalance: String(usableBalance), raw };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(): Record<string, string> {
    if (this.config.authMode === "BEARER" && this.config.apiKey) {
      return { authorization: `Bearer ${this.config.apiKey}` };
    }
    return {};
  }
}

export const buildFundingVenueReadinessCheckersFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): Map<FundingVenue, VenueFundingReadinessChecker> => {
  const polymarketConfig = getPolymarketFundingReadinessConfigFromEnv(env);
  const polymarketClient = polymarketConfig.mode === "LIVE_READ"
    ? new HttpPolymarketFundingBalanceReadClient({
      balanceUrl: polymarketConfig.balanceUrl ?? undefined,
      timeoutMs: polymarketConfig.timeoutMs,
      authMode: polymarketConfig.authMode,
      apiKey: env.POLYMARKET_FUNDING_READ_API_KEY
    })
    : new DisabledPolymarketFundingBalanceReadClient();
  const limitlessConfig = getLimitlessFundingReadinessConfigFromEnv(env);
  const limitlessClient = limitlessConfig.mode === "LIVE_READ"
    ? new HttpLimitlessFundingBalanceReadClient({
      balanceUrl: limitlessConfig.balanceUrl ?? undefined,
      timeoutMs: limitlessConfig.timeoutMs,
      authMode: limitlessConfig.authMode,
      apiKey: env.LIMITLESS_FUNDING_READ_API_KEY
    })
    : new DisabledLimitlessFundingBalanceReadClient();
  return new Map<FundingVenue, VenueFundingReadinessChecker>([
    ["POLYMARKET", new PolymarketFundingReadinessChecker(polymarketClient, { ...polymarketConfig, env })],
    ["LIMITLESS", new LimitlessFundingReadinessChecker(limitlessClient, { ...limitlessConfig, env })]
  ]);
};
