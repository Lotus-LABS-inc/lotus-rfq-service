import Decimal from "decimal.js";

export type PredictFunWithdrawalMode = "DISABLED" | "USER_WALLET_DRY_RUN";
export type PredictFunWithdrawalReadinessStatus = "DISABLED" | "DRY_RUN_READY" | "NOT_CONFIGURED";

export interface OperatorPredictFunWithdrawalConfig {
  enabled: boolean;
  mode: PredictFunWithdrawalMode;
  instructionsUrl: string;
  timeoutMs: number;
  dryRunOnly: boolean;
  configured: boolean;
}

export interface PredictFunWithdrawalQuote {
  provider: "PREDICT_FUN_USER_WALLET";
  sourceVenue: "PREDICT_FUN";
  destinationChain: string;
  destinationToken: string;
  destinationAddress: string;
  amount: string;
  estimatedFees: string;
  estimatedTimeSeconds: number | null;
  expiresAt: string;
  instructionsUrl: string;
  userSafeSummary: string;
  warnings: string[];
}

export interface PredictFunUserWalletAction {
  actionType: "USER_COMPLETE_PREDICT_FUN_WALLET_WITHDRAWAL";
  walletModel: "PRIVY_ZERODEV";
  instructionsUrl: string;
  destinationChain: string;
  destinationToken: string;
  destinationAddress: string;
  amount: string;
  warnings: string[];
}

export interface PredictFunWithdrawalAdapterOptions {
  now?: () => Date;
}

export const getPredictFunWithdrawalConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorPredictFunWithdrawalConfig => {
  const enabled = env.PREDICT_FUN_WITHDRAWAL_ADAPTER_ENABLED === "true";
  const requestedMode = env.PREDICT_FUN_WITHDRAWAL_ADAPTER_MODE?.trim().toUpperCase();
  const mode: PredictFunWithdrawalMode = enabled && requestedMode === "USER_WALLET_DRY_RUN"
    ? "USER_WALLET_DRY_RUN"
    : "DISABLED";
  const instructionsUrl = env.PREDICT_FUN_WITHDRAWAL_INSTRUCTIONS_URL?.trim() ||
    "https://docs.predict.fun/knowledge-base/wallets";
  const dryRunOnly = env.PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY !== "false";
  const timeoutMs = positiveInt(env.PREDICT_FUN_WITHDRAWAL_ADAPTER_TIMEOUT_MS, 5_000);
  return {
    enabled,
    mode,
    instructionsUrl,
    timeoutMs,
    dryRunOnly,
    configured: enabled && mode === "USER_WALLET_DRY_RUN" && dryRunOnly && isValidHttpUrl(instructionsUrl)
  };
};

export class PredictFunWithdrawalAdapter {
  private readonly now: () => Date;

  public constructor(
    private readonly config: OperatorPredictFunWithdrawalConfig,
    options: PredictFunWithdrawalAdapterOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public getWithdrawalCapabilities(): {
    venue: "PREDICT_FUN";
    classification: "USER_WALLET_AUTHORIZED_ACTION_CANDIDATE";
    supportsWithdrawal: boolean;
    supportsApiInitiatedWithdrawal: false;
    supportsUserBroadcastReference: true;
    requiresUserSignature: true;
    requiresVenueAuth: false;
    readinessStatus: PredictFunWithdrawalReadinessStatus;
  } {
    return {
      venue: "PREDICT_FUN",
      classification: "USER_WALLET_AUTHORIZED_ACTION_CANDIDATE",
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
  }): Promise<PredictFunWithdrawalQuote> {
    this.assertUserWalletDryRunConfigured();
    assertSafeString(input.destinationChain, "destinationChain");
    assertSafeString(input.destinationToken, "destinationToken");
    assertSafeString(input.destinationAddress, "destinationAddress");
    assertPositiveAmount(input.amount);
    if (input.destinationChain.toUpperCase() !== "BSC" || input.destinationToken.toUpperCase() !== "USDT") {
      throw new Error("PREDICT_FUN_WITHDRAWAL_BSC_USDT_REQUIRED");
    }
    return {
      provider: "PREDICT_FUN_USER_WALLET",
      sourceVenue: "PREDICT_FUN",
      destinationChain: input.destinationChain,
      destinationToken: input.destinationToken,
      destinationAddress: input.destinationAddress,
      amount: input.amount,
      estimatedFees: "0",
      estimatedTimeSeconds: null,
      expiresAt: new Date(this.now().getTime() + this.config.timeoutMs).toISOString(),
      instructionsUrl: this.config.instructionsUrl,
      userSafeSummary: "Predict.fun user-wallet dry run: user must complete withdrawal through Predict.fun, Privy, ZeroDev, or a user-controlled wallet path. Lotus does not hold keys, sign, broadcast, or move funds.",
      warnings: predictFunWarnings(this.config.instructionsUrl)
    };
  }

  public async prepareUserAction(input: PredictFunWithdrawalQuote): Promise<PredictFunUserWalletAction> {
    this.assertUserWalletDryRunConfigured();
    return {
      actionType: "USER_COMPLETE_PREDICT_FUN_WALLET_WITHDRAWAL",
      walletModel: "PRIVY_ZERODEV",
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
      code: error instanceof Error ? error.message : "PREDICT_FUN_WITHDRAWAL_ADAPTER_ERROR",
      message: "Predict.fun withdrawal adapter failed closed in user-wallet dry-run mode."
    };
  }

  private assertUserWalletDryRunConfigured(): void {
    if (!this.config.enabled) {
      throw new Error("PREDICT_FUN_WITHDRAWAL_ADAPTER_DISABLED");
    }
    if (this.config.mode !== "USER_WALLET_DRY_RUN") {
      throw new Error("PREDICT_FUN_WITHDRAWAL_ADAPTER_MODE_UNSUPPORTED");
    }
    if (!this.config.dryRunOnly) {
      throw new Error("PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY_REQUIRED");
    }
    if (!this.config.configured) {
      throw new Error("PREDICT_FUN_WITHDRAWAL_ADAPTER_NOT_CONFIGURED");
    }
  }
}

export const buildPredictFunUserWalletProviderStatus = (input: {
  quote: PredictFunWithdrawalQuote;
  userAction: PredictFunUserWalletAction;
  evmWithdrawalWalletPresent?: boolean;
}): Record<string, unknown> => ({
  provider: "PREDICT_FUN_USER_WALLET",
  mode: "USER_WALLET_DRY_RUN",
  walletModel: "PRIVY_ZERODEV",
  classification: "USER_WALLET_AUTHORIZED_ACTION_CANDIDATE",
  completionPersisted: false,
  destinationWalletProfileRequired: true,
  evmWithdrawalWalletPresent: input.evmWithdrawalWalletPresent === true,
  instructionsUrl: input.quote.instructionsUrl,
  status: "ACTION_REQUIRED",
  warnings: [
    ...(input.evmWithdrawalWalletPresent === true ? [] : ["Add an EVM-compatible wallet to receive BSC USDT withdrawals."]),
    ...input.quote.warnings
  ],
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

export const verifyPredictFunWithdrawalRedaction = (
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  const serialized = JSON.stringify(payload);
  const forbidden = [
    env.PREDICT_FUN_API_KEY,
    env.PREDICT_FUN_WITHDRAWAL_EVIDENCE_API_KEY,
    env.DATABASE_URL,
    env.TEST_DATABASE_URL,
    "authorization",
    "authHeader",
    "privateKey",
    "walletSeed",
    "seedPhrase",
    "privySecret",
    "zeroDevSigner",
    "jwt",
    "sessionCookie",
    "rawProviderPayload",
    "providerInternals"
  ].filter((value): value is string => Boolean(value));
  return forbidden.every((value) => !serialized.includes(value));
};

const predictFunWarnings = (instructionsUrl: string): string[] => [
  "User must complete withdrawal through Predict.fun, Privy, ZeroDev, or a user-controlled wallet path.",
  "Lotus does not hold private keys, wallet seeds, Privy secrets, or ZeroDev signer material.",
  "Lotus does not sign, broadcast, custody, or move funds in this dry run.",
  `Review Predict.fun wallet instructions before proceeding: ${instructionsUrl}`
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
    throw new Error(`PREDICT_FUN_WITHDRAWAL_${label.toUpperCase()}_REQUIRED`);
  }
};

const assertPositiveAmount = (value: string): void => {
  try {
    if (new Decimal(value).lte(0)) {
      throw new Error("PREDICT_FUN_WITHDRAWAL_AMOUNT_INVALID");
    }
  } catch {
    throw new Error("PREDICT_FUN_WITHDRAWAL_AMOUNT_INVALID");
  }
};
