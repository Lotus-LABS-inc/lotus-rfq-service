import Decimal from "decimal.js";

export type OpinionWithdrawalMode = "DISABLED" | "USER_SAFE_DRY_RUN";
export type OpinionWithdrawalReadinessStatus = "DISABLED" | "DRY_RUN_READY" | "NOT_CONFIGURED";

export interface OperatorOpinionWithdrawalConfig {
  enabled: boolean;
  mode: OpinionWithdrawalMode;
  instructionsUrl: string;
  timeoutMs: number;
  dryRunOnly: boolean;
  configured: boolean;
}

export interface OpinionWithdrawalQuote {
  provider: "OPINION_SAFE_USER_ACTION";
  sourceVenue: "OPINION";
  destinationChain: "BSC";
  destinationToken: "USDT";
  destinationAddress: string;
  amount: string;
  estimatedFees: string;
  estimatedTimeSeconds: number | null;
  expiresAt: string;
  instructionsUrl: string;
  userSafeSummary: string;
  warnings: string[];
}

export interface OpinionSafeUserAction {
  actionType: "USER_COMPLETE_OPINION_SAFE_WITHDRAWAL";
  walletModel: "GNOSIS_SAFE_OR_USER_EOA";
  instructionsUrl: string;
  destinationChain: "BSC";
  destinationToken: "USDT";
  destinationAddress: string;
  amount: string;
  warnings: string[];
}

export interface OpinionWithdrawalAdapterOptions {
  now?: () => Date;
}

export const getOpinionWithdrawalConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorOpinionWithdrawalConfig => {
  const enabled = env.OPINION_WITHDRAWAL_ADAPTER_ENABLED === "true";
  const requestedMode = env.OPINION_WITHDRAWAL_ADAPTER_MODE?.trim().toUpperCase();
  const mode: OpinionWithdrawalMode = enabled && requestedMode === "USER_SAFE_DRY_RUN"
    ? "USER_SAFE_DRY_RUN"
    : "DISABLED";
  const instructionsUrl = env.OPINION_WITHDRAWAL_INSTRUCTIONS_URL?.trim() ||
    "https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode/split-merge-redeem";
  const dryRunOnly = env.OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY !== "false";
  const timeoutMs = positiveInt(env.OPINION_WITHDRAWAL_ADAPTER_TIMEOUT_MS, 5_000);
  return {
    enabled,
    mode,
    instructionsUrl,
    timeoutMs,
    dryRunOnly,
    configured: enabled && mode === "USER_SAFE_DRY_RUN" && dryRunOnly && isValidHttpUrl(instructionsUrl)
  };
};

export class OpinionSafeWithdrawalAdapter {
  private readonly now: () => Date;

  public constructor(
    private readonly config: OperatorOpinionWithdrawalConfig,
    options: OpinionWithdrawalAdapterOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public getWithdrawalCapabilities(): {
    venue: "OPINION";
    classification: "USER_SAFE_AUTHORIZED_ACTION_CANDIDATE";
    supportsWithdrawal: boolean;
    supportsApiInitiatedWithdrawal: false;
    supportsUserBroadcastReference: true;
    requiresUserSignature: true;
    requiresVenueAuth: false;
    readinessStatus: OpinionWithdrawalReadinessStatus;
  } {
    return {
      venue: "OPINION",
      classification: "USER_SAFE_AUTHORIZED_ACTION_CANDIDATE",
      supportsWithdrawal: this.config.enabled,
      supportsApiInitiatedWithdrawal: false,
      supportsUserBroadcastReference: true,
      requiresUserSignature: true,
      requiresVenueAuth: false,
      readinessStatus: !this.config.enabled ? "DISABLED" : this.config.configured ? "DRY_RUN_READY" : "NOT_CONFIGURED"
    };
  }

  public async prepareWithdrawalQuote(input: {
    destinationChain: string;
    destinationToken: string;
    destinationAddress: string;
    amount: string;
  }): Promise<OpinionWithdrawalQuote> {
    this.assertUserSafeDryRunConfigured();
    assertSafeString(input.destinationChain, "destinationChain");
    assertSafeString(input.destinationToken, "destinationToken");
    assertSafeString(input.destinationAddress, "destinationAddress");
    assertPositiveAmount(input.amount);
    if (input.destinationChain.toUpperCase() !== "BSC" || input.destinationToken.toUpperCase() !== "USDT") {
      throw new Error("OPINION_WITHDRAWAL_BSC_USDT_REQUIRED");
    }
    return {
      provider: "OPINION_SAFE_USER_ACTION",
      sourceVenue: "OPINION",
      destinationChain: "BSC",
      destinationToken: "USDT",
      destinationAddress: input.destinationAddress,
      amount: input.amount,
      estimatedFees: "0",
      estimatedTimeSeconds: null,
      expiresAt: new Date(this.now().getTime() + this.config.timeoutMs).toISOString(),
      instructionsUrl: this.config.instructionsUrl,
      userSafeSummary: "Opinion Safe dry run: user must complete withdrawal through Opinion/Gnosis Safe/user wallet. Lotus does not hold keys, sign, broadcast, or move funds.",
      warnings: opinionWarnings(this.config.instructionsUrl)
    };
  }

  public async prepareUserAction(input: OpinionWithdrawalQuote): Promise<OpinionSafeUserAction> {
    this.assertUserSafeDryRunConfigured();
    return {
      actionType: "USER_COMPLETE_OPINION_SAFE_WITHDRAWAL",
      walletModel: "GNOSIS_SAFE_OR_USER_EOA",
      instructionsUrl: input.instructionsUrl,
      destinationChain: input.destinationChain,
      destinationToken: input.destinationToken,
      destinationAddress: input.destinationAddress,
      amount: input.amount,
      warnings: input.warnings
    };
  }

  public normalizeWithdrawalError(error: unknown): { code: string; message: string } {
    return {
      code: error instanceof Error ? error.message : "OPINION_WITHDRAWAL_ADAPTER_ERROR",
      message: "Opinion withdrawal adapter failed closed in user Safe dry-run mode."
    };
  }

  private assertUserSafeDryRunConfigured(): void {
    if (!this.config.enabled) {
      throw new Error("OPINION_WITHDRAWAL_ADAPTER_DISABLED");
    }
    if (this.config.mode !== "USER_SAFE_DRY_RUN") {
      throw new Error("OPINION_WITHDRAWAL_ADAPTER_MODE_UNSUPPORTED");
    }
    if (!this.config.dryRunOnly) {
      throw new Error("OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY_REQUIRED");
    }
    if (!this.config.configured) {
      throw new Error("OPINION_WITHDRAWAL_ADAPTER_NOT_CONFIGURED");
    }
  }
}

export const buildOpinionSafeUserActionProviderStatus = (input: {
  quote: OpinionWithdrawalQuote;
  userAction: OpinionSafeUserAction;
}): Record<string, unknown> => ({
  provider: "OPINION_SAFE_USER_ACTION",
  mode: "USER_SAFE_DRY_RUN",
  walletModel: "GNOSIS_SAFE_OR_USER_EOA",
  classification: "USER_SAFE_AUTHORIZED_ACTION_CANDIDATE",
  completionPersisted: false,
  instructionsUrl: input.quote.instructionsUrl,
  status: "ACTION_REQUIRED",
  warnings: input.quote.warnings,
  quote: {
    provider: input.quote.provider,
    destinationChain: input.quote.destinationChain,
    destinationToken: input.quote.destinationToken,
    destinationAddress: input.quote.destinationAddress,
    amount: input.quote.amount,
    estimatedFees: input.quote.estimatedFees,
    estimatedTimeSeconds: input.quote.estimatedTimeSeconds,
    expiresAt: input.quote.expiresAt
  },
  userAction: {
    actionType: input.userAction.actionType,
    walletModel: input.userAction.walletModel,
    instructionsUrl: input.userAction.instructionsUrl,
    destinationChain: input.userAction.destinationChain,
    destinationToken: input.userAction.destinationToken,
    destinationAddress: input.userAction.destinationAddress,
    amount: input.userAction.amount,
    warnings: input.userAction.warnings
  }
});

export const verifyOpinionWithdrawalRedaction = (
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  const serialized = JSON.stringify(payload);
  const forbidden = [
    env.OPINION_API_KEY,
    env.OPINION_WITHDRAWAL_EVIDENCE_API_KEY,
    env.DATABASE_URL,
    env.TEST_DATABASE_URL,
    "authorization",
    "authHeader",
    "privateKey",
    "walletSeed",
    "seedPhrase",
    "safeOwnerKey",
    "gnosisSafeSigner",
    "sessionToken",
    "sessionCookie",
    "rawProviderPayload",
    "providerInternals"
  ].filter((value): value is string => Boolean(value));
  return forbidden.every((value) => !serialized.includes(value));
};

const opinionWarnings = (instructionsUrl: string): string[] => [
  "User must complete withdrawal through Opinion, Gnosis Safe, or a user-controlled wallet path.",
  "Lotus does not hold private keys, wallet seeds, Safe owner keys, signer material, or session tokens.",
  "Lotus does not sign, broadcast, custody, or move funds in this dry run.",
  "First supported Opinion withdrawal rail is BNB Smart Chain USDT.",
  `Review Opinion withdrawal instructions before proceeding: ${instructionsUrl}`
];

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const assertSafeString = (value: string, label: string): void => {
  if (!value.trim()) {
    throw new Error(`OPINION_WITHDRAWAL_${label.toUpperCase()}_REQUIRED`);
  }
};

const assertPositiveAmount = (value: string): void => {
  try {
    if (new Decimal(value).lte(0)) {
      throw new Error("OPINION_WITHDRAWAL_AMOUNT_INVALID");
    }
  } catch {
    throw new Error("OPINION_WITHDRAWAL_AMOUNT_INVALID");
  }
};
