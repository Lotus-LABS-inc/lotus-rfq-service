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

export interface FundingBalanceReadInput {
  userId: string;
  fundingIntentId: string;
  routeLegId: string;
  targetVenue: FundingVenue;
  sourceChain?: string;
  sourceToken?: string;
  destinationChain?: string;
  destinationToken?: string;
}

export interface FundingBalanceReadClient {
  fetchUsableUsdcBalance(input: FundingBalanceReadInput): Promise<{ usableBalance: string; raw?: Record<string, unknown> }>;
}

export interface PolymarketFundingBalanceReadClient {
  fetchUsableUsdcBalance(input: FundingBalanceReadInput & { targetVenue: "POLYMARKET" }): Promise<{ usableBalance: string; raw?: Record<string, unknown> }>;
}

export interface LimitlessFundingBalanceReadClient {
  fetchUsableUsdcBalance(input: FundingBalanceReadInput & { targetVenue: "LIMITLESS" }): Promise<{ usableBalance: string; raw?: Record<string, unknown> }>;
}

export type FundingReadinessMode = "DISABLED" | "STUB" | "LIVE_READ";
export type FundingReadinessAuthMode = "NONE" | "BEARER";
export type FundingReadinessRedactionPolicy = "SERVER_SAFE_DEFAULT";

export type PolymarketFundingReadinessMode = FundingReadinessMode;
export type PolymarketFundingReadinessAuthMode = FundingReadinessAuthMode;
export type PolymarketFundingReadinessRedactionPolicy = FundingReadinessRedactionPolicy;
export type LimitlessFundingReadinessMode = FundingReadinessMode;
export type LimitlessFundingReadinessAuthMode = FundingReadinessAuthMode;
export type LimitlessFundingReadinessRedactionPolicy = FundingReadinessRedactionPolicy;
export type OpinionFundingReadinessMode = FundingReadinessMode;
export type OpinionFundingReadinessAuthMode = FundingReadinessAuthMode;
export type OpinionFundingReadinessRedactionPolicy = FundingReadinessRedactionPolicy;
export type MyriadFundingReadinessMode = FundingReadinessMode;
export type MyriadFundingReadinessAuthMode = FundingReadinessAuthMode;
export type MyriadFundingReadinessRedactionPolicy = FundingReadinessRedactionPolicy;
export type PredictFunFundingReadinessMode = FundingReadinessMode;
export type PredictFunFundingReadinessAuthMode = FundingReadinessAuthMode;
export type PredictFunFundingReadinessRedactionPolicy = FundingReadinessRedactionPolicy;

export interface FundingReadinessConfig {
  enabled?: boolean;
  mode?: FundingReadinessMode;
  balanceUrl?: string | null | undefined;
  authMode?: FundingReadinessAuthMode;
  timeoutMs?: number;
  minimumConfirmations?: number;
  balanceTolerance?: string;
  redactionPolicy?: FundingReadinessRedactionPolicy;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export type PolymarketFundingReadinessConfig = FundingReadinessConfig;
export type LimitlessFundingReadinessConfig = FundingReadinessConfig;
export type OpinionFundingReadinessConfig = FundingReadinessConfig;
export type MyriadFundingReadinessConfig = FundingReadinessConfig;
export type PredictFunFundingReadinessConfig = FundingReadinessConfig;

export interface OperatorFundingReadinessConfig {
  venue: FundingVenue;
  enabled: boolean;
  mode: FundingReadinessMode;
  balanceUrl: string | null;
  authMode: FundingReadinessAuthMode;
  timeoutMs: number;
  minimumConfirmations: number;
  balanceTolerance: string;
  redactionPolicy: FundingReadinessRedactionPolicy;
  configured: boolean;
}

export type OperatorPolymarketFundingReadinessConfig = Omit<OperatorFundingReadinessConfig, "venue">;
export type OperatorLimitlessFundingReadinessConfig = Omit<OperatorFundingReadinessConfig, "venue">;
export type OperatorOpinionFundingReadinessConfig = Omit<OperatorFundingReadinessConfig, "venue">;
export type OperatorMyriadFundingReadinessConfig = Omit<OperatorFundingReadinessConfig, "venue">;
export type OperatorPredictFunFundingReadinessConfig = Omit<OperatorFundingReadinessConfig, "venue">;

const readinessVenues: readonly FundingVenue[] = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"];

export const isFundingVenueReadinessSupported = (venue: string): venue is FundingVenue =>
  readinessVenues.includes(venue.toUpperCase() as FundingVenue);

const safeDecimal = (value: string) => {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.greaterThanOrEqualTo(0) ? parsed : null;
  } catch {
    return null;
  }
};

const parseBalanceTolerance = (value: string | undefined): string => {
  const parsed = safeDecimal(value?.trim() || "0.000001");
  return parsed ? parsed.toString() : "0.000001";
};

const destinationReceivedForLeg = (leg: FundingRouteLeg): boolean =>
  leg.destinationStatus === "CONFIRMED" ||
  leg.status === "LEG_DESTINATION_RECEIVED" ||
  leg.status === "LEG_VENUE_CREDIT_PENDING" ||
  leg.status === "LEG_READY_TO_TRADE";

const envPrefix = (venue: FundingVenue): string => venue;

export const fundingReadinessSourceForVenue = (venue: string): string => {
  const normalizedVenue = venue.toUpperCase();
  return isFundingVenueReadinessSupported(normalizedVenue)
    ? `${normalizedVenue.toLowerCase()}_funding_readiness`
    : "not_configured";
};

const titleVenue = (venue: FundingVenue): string =>
  venue.split("_").map((part) => `${part[0] ?? ""}${part.slice(1).toLowerCase()}`).join(" ");

export const getFundingReadinessConfigFromEnv = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv = process.env
): OperatorFundingReadinessConfig => {
  const prefix = envPrefix(venue);
  const configuredMode = env[`${prefix}_FUNDING_READINESS_MODE`]?.toUpperCase();
  const mode: FundingReadinessMode =
    configuredMode === "STUB" || configuredMode === "LIVE_READ" || configuredMode === "DISABLED"
      ? configuredMode
      : env[`${prefix}_FUNDING_READINESS_ENABLED`] === "true"
        ? "LIVE_READ"
        : "DISABLED";
  const balanceUrl = env[`${prefix}_FUNDING_BALANCE_URL`]?.trim() || null;
  const balanceUrlValid = isValidHttpUrl(balanceUrl);
  const authMode = env[`${prefix}_FUNDING_READ_AUTH_MODE`] === "BEARER" ? "BEARER" : "NONE";
  const timeoutMs = Number.parseInt(env[`${prefix}_FUNDING_READ_TIMEOUT_MS`] ?? "5000", 10);
  const minimumConfirmations = Number.parseInt(env[`${prefix}_FUNDING_MIN_CONFIRMATIONS`] ?? "0", 10);
  const balanceTolerance = parseBalanceTolerance(env[`${prefix}_FUNDING_BALANCE_TOLERANCE`]);
  return {
    venue,
    enabled: mode !== "DISABLED",
    mode,
    balanceUrl,
    authMode,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000,
    minimumConfirmations: Number.isFinite(minimumConfirmations) && minimumConfirmations > 0 ? minimumConfirmations : 0,
    balanceTolerance,
    redactionPolicy: "SERVER_SAFE_DEFAULT",
    configured: mode === "STUB" || (mode === "LIVE_READ" && balanceUrlValid)
  };
};

const stripVenue = (config: OperatorFundingReadinessConfig): Omit<OperatorFundingReadinessConfig, "venue"> => ({
  enabled: config.enabled,
  mode: config.mode,
  balanceUrl: config.balanceUrl,
  authMode: config.authMode,
  timeoutMs: config.timeoutMs,
  minimumConfirmations: config.minimumConfirmations,
  balanceTolerance: config.balanceTolerance,
  redactionPolicy: config.redactionPolicy,
  configured: config.configured
});

export const getPolymarketFundingReadinessConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorPolymarketFundingReadinessConfig => stripVenue(getFundingReadinessConfigFromEnv("POLYMARKET", env));

export const getLimitlessFundingReadinessConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorLimitlessFundingReadinessConfig => stripVenue(getFundingReadinessConfigFromEnv("LIMITLESS", env));

export const getOpinionFundingReadinessConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorOpinionFundingReadinessConfig => stripVenue(getFundingReadinessConfigFromEnv("OPINION", env));

export const getMyriadFundingReadinessConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorMyriadFundingReadinessConfig => stripVenue(getFundingReadinessConfigFromEnv("MYRIAD", env));

export const getPredictFunFundingReadinessConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorPredictFunFundingReadinessConfig => stripVenue(getFundingReadinessConfigFromEnv("PREDICT_FUN", env));

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

export class ConfigurableVenueFundingReadinessChecker implements VenueFundingReadinessChecker {
  private readonly now: () => Date;
  private readonly operatorConfig: OperatorFundingReadinessConfig;

  public constructor(
    public readonly venue: FundingVenue,
    private readonly client: FundingBalanceReadClient,
    config: FundingReadinessConfig
  ) {
    this.now = config.now ?? (() => new Date());
    this.operatorConfig = {
      venue,
      enabled: config.mode ? config.mode !== "DISABLED" : config.enabled === true,
      mode: config.mode ?? (config.enabled ? "LIVE_READ" : "DISABLED"),
      balanceUrl: config.balanceUrl ?? null,
      authMode: config.authMode ?? "NONE",
      timeoutMs: config.timeoutMs ?? 5_000,
      minimumConfirmations: config.minimumConfirmations ?? 0,
      balanceTolerance: parseBalanceTolerance(config.balanceTolerance),
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
        reason: `${this.venue}_FUNDING_READINESS_DISABLED`,
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
        reason: `${this.venue}_FUNDING_READINESS_NOT_CONFIGURED`,
        evidence: this.safeEvidence({ checkerMode: this.operatorConfig.mode })
      });
    }

    try {
      const balance = await this.client.fetchUsableUsdcBalance({
        userId: input.userId,
        fundingIntentId: input.intent.fundingIntentId,
        routeLegId: input.leg.routeLegId,
        targetVenue: this.venue,
        sourceChain: input.leg.sourceChain,
        sourceToken: input.leg.sourceToken,
        destinationChain: input.leg.destinationChain,
        destinationToken: input.leg.destinationToken
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
          reason: `${this.venue}_BALANCE_RESPONSE_MALFORMED`,
          evidence: this.safeEvidence({ rawStatus: "malformed_balance" })
        });
      }
      const balanceTolerance = safeDecimal(this.operatorConfig.balanceTolerance) ?? new Decimal(0);
      const effectiveRequiredAmount = Decimal.max(requiredAmount.minus(balanceTolerance), 0);
      const comparisonEvidence = {
        requiredAmount: requiredAmount.toString(),
        usableBalance: usableBalance.toString(),
        balanceTolerance: balanceTolerance.toString(),
        effectiveRequiredAmount: effectiveRequiredAmount.toString()
      };
      if (usableBalance.greaterThanOrEqualTo(effectiveRequiredAmount)) {
        return this.result({
          status: "READY_TO_TRADE",
          destinationReceived: true,
          venueCreditConfirmed: true,
          readyToTrade: true,
          usableBalance: usableBalance.toString(),
          reason: `${this.venue}_USABLE_BALANCE_CONFIRMED`,
          evidence: this.safeEvidence(comparisonEvidence)
        });
      }
      return this.result({
        status: "VENUE_CREDIT_PENDING",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: usableBalance.toString(),
        reason: `${this.venue}_USABLE_BALANCE_BELOW_REQUIRED_AMOUNT`,
        evidence: this.safeEvidence(comparisonEvidence)
      });
    } catch (error) {
      return this.result({
        status: "UNKNOWN",
        destinationReceived: true,
        venueCreditConfirmed: false,
        readyToTrade: false,
        usableBalance: null,
        reason: `${this.venue}_READINESS_READ_UNAVAILABLE`,
        evidence: this.safeEvidence({
          error: error instanceof Error ? "READ_UNAVAILABLE" : "UNKNOWN_READ_ERROR"
        })
      });
    }
  }

  private safeEvidence(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      source: fundingReadinessSourceForVenue(this.venue),
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

export class PolymarketFundingReadinessChecker extends ConfigurableVenueFundingReadinessChecker {
  public constructor(client: PolymarketFundingBalanceReadClient, config: PolymarketFundingReadinessConfig) {
    super("POLYMARKET", client as unknown as FundingBalanceReadClient, config);
  }
}

export class LimitlessFundingReadinessChecker extends ConfigurableVenueFundingReadinessChecker {
  public constructor(client: LimitlessFundingBalanceReadClient, config: LimitlessFundingReadinessConfig) {
    super("LIMITLESS", client as unknown as FundingBalanceReadClient, config);
  }
}

export class OpinionFundingReadinessChecker extends ConfigurableVenueFundingReadinessChecker {
  public constructor(client: FundingBalanceReadClient, config: OpinionFundingReadinessConfig) {
    super("OPINION", client, config);
  }
}

export class MyriadFundingReadinessChecker extends ConfigurableVenueFundingReadinessChecker {
  public constructor(client: FundingBalanceReadClient, config: MyriadFundingReadinessConfig) {
    super("MYRIAD", client, config);
  }
}

export class PredictFunFundingReadinessChecker extends ConfigurableVenueFundingReadinessChecker {
  public constructor(client: FundingBalanceReadClient, config: PredictFunFundingReadinessConfig) {
    super("PREDICT_FUN", client, config);
  }
}

export class DisabledFundingBalanceReadClient implements FundingBalanceReadClient {
  public constructor(private readonly venue: FundingVenue) {}

  public async fetchUsableUsdcBalance(): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    throw new Error(`${titleVenue(this.venue)} funding balance read client is not configured.`);
  }
}

export class DisabledPolymarketFundingBalanceReadClient extends DisabledFundingBalanceReadClient implements PolymarketFundingBalanceReadClient {
  public constructor() {
    super("POLYMARKET");
  }
}

export class DisabledLimitlessFundingBalanceReadClient extends DisabledFundingBalanceReadClient implements LimitlessFundingBalanceReadClient {
  public constructor() {
    super("LIMITLESS");
  }
}

export class HttpFundingBalanceReadClient implements FundingBalanceReadClient {
  public constructor(
    private readonly venue: FundingVenue,
    private readonly config: {
      balanceUrl?: string | undefined;
      timeoutMs?: number | undefined;
      authMode?: FundingReadinessAuthMode | undefined;
      apiKey?: string | undefined;
      fetchImpl?: typeof fetch | undefined;
    }
  ) {}

  public async fetchUsableUsdcBalance(input: FundingBalanceReadInput): Promise<{ usableBalance: string; raw?: Record<string, unknown> }> {
    if (!this.config.balanceUrl) {
      throw new Error(`${this.venue}_FUNDING_BALANCE_URL is not configured.`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5_000);
    try {
      const url = new URL(this.config.balanceUrl);
      url.searchParams.set("userId", input.userId);
      url.searchParams.set("fundingIntentId", input.fundingIntentId);
      url.searchParams.set("routeLegId", input.routeLegId);
      url.searchParams.set("targetVenue", input.targetVenue);
      if (input.sourceChain) {
        url.searchParams.set("sourceChain", input.sourceChain);
      }
      if (input.sourceToken) {
        url.searchParams.set("sourceToken", input.sourceToken);
      }
      if (input.destinationChain) {
        url.searchParams.set("destinationChain", input.destinationChain);
      }
      if (input.destinationToken) {
        url.searchParams.set("destinationToken", input.destinationToken);
      }
      const response = await (this.config.fetchImpl ?? fetch)(url, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`${titleVenue(this.venue)} funding balance read failed with ${response.status}.`);
      }
      const raw = await response.json() as Record<string, unknown>;
      const usableBalance = raw.usableBalance ?? raw.availableBalance ?? raw.balance;
      if (typeof usableBalance !== "string" && typeof usableBalance !== "number") {
        throw new Error(`${titleVenue(this.venue)} funding balance response did not include usableBalance.`);
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

export class HttpPolymarketFundingBalanceReadClient extends HttpFundingBalanceReadClient implements PolymarketFundingBalanceReadClient {
  public constructor(config: ConstructorParameters<typeof HttpFundingBalanceReadClient>[1]) {
    super("POLYMARKET", config);
  }
}

export class HttpLimitlessFundingBalanceReadClient extends HttpFundingBalanceReadClient implements LimitlessFundingBalanceReadClient {
  public constructor(config: ConstructorParameters<typeof HttpFundingBalanceReadClient>[1]) {
    super("LIMITLESS", config);
  }
}

export const buildFundingVenueReadinessCheckersFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): Map<FundingVenue, VenueFundingReadinessChecker> =>
  new Map<FundingVenue, VenueFundingReadinessChecker>(
    readinessVenues.map((venue) => [venue, buildCheckerFromEnv(venue, env)])
  );

const buildCheckerFromEnv = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv
): VenueFundingReadinessChecker => {
  const config = getFundingReadinessConfigFromEnv(venue, env);
  const client = config.mode === "LIVE_READ"
    ? new HttpFundingBalanceReadClient(venue, {
      balanceUrl: config.balanceUrl ?? undefined,
      timeoutMs: config.timeoutMs,
      authMode: config.authMode,
      apiKey: env[`${envPrefix(venue)}_FUNDING_READ_API_KEY`]
    })
    : new DisabledFundingBalanceReadClient(venue);
  return new ConfigurableVenueFundingReadinessChecker(venue, client, { ...config, env });
};
