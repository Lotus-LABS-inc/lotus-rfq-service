import Decimal from "decimal.js";

export type MyriadWithdrawalMode = "DISABLED" | "USER_WALLET_DRY_RUN";
export type MyriadWithdrawalReadinessStatus = "DISABLED" | "DRY_RUN_READY" | "NOT_CONFIGURED";

export interface OperatorMyriadWithdrawalConfig {
  enabled: boolean;
  mode: MyriadWithdrawalMode;
  instructionsUrl: string;
  timeoutMs: number;
  dryRunOnly: boolean;
  configured: boolean;
}

export interface MyriadWithdrawalQuote {
  provider: "MYRIAD_USER_WALLET";
  sourceVenue: "MYRIAD";
  destinationChain: "BSC";
  destinationToken: "USD1";
  destinationAddress: string;
  amount: string;
  estimatedFees: string;
  estimatedTimeSeconds: number | null;
  expiresAt: string;
  instructionsUrl: string;
  userSafeSummary: string;
  warnings: string[];
}

export interface MyriadUserWalletAction {
  actionType: "USER_COMPLETE_MYRIAD_WALLET_WITHDRAWAL";
  walletModel: "THIRDWEB";
  instructionsUrl: string;
  destinationChain: "BSC";
  destinationToken: "USD1";
  destinationAddress: string;
  amount: string;
  warnings: string[];
}

export interface MyriadWithdrawalAdapterOptions {
  now?: () => Date;
}

export const getMyriadWithdrawalConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OperatorMyriadWithdrawalConfig => {
  const enabled = env.MYRIAD_WITHDRAWAL_ADAPTER_ENABLED === "true";
  const requestedMode = env.MYRIAD_WITHDRAWAL_ADAPTER_MODE?.trim().toUpperCase();
  const mode: MyriadWithdrawalMode = enabled && requestedMode === "USER_WALLET_DRY_RUN"
    ? "USER_WALLET_DRY_RUN"
    : "DISABLED";
  const instructionsUrl = env.MYRIAD_WITHDRAWAL_INSTRUCTIONS_URL?.trim() ||
    "https://docs.myriad.markets/deposit-and-withdraw";
  const dryRunOnly = env.MYRIAD_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY !== "false";
  const timeoutMs = positiveInt(env.MYRIAD_WITHDRAWAL_ADAPTER_TIMEOUT_MS, 5_000);
  return {
    enabled,
    mode,
    instructionsUrl,
    timeoutMs,
    dryRunOnly,
    configured: enabled && mode === "USER_WALLET_DRY_RUN" && dryRunOnly && isValidHttpUrl(instructionsUrl)
  };
};

export class MyriadWalletWithdrawalAdapter {
  private readonly now: () => Date;

  public constructor(
    private readonly config: OperatorMyriadWithdrawalConfig,
    options: MyriadWithdrawalAdapterOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public getWithdrawalCapabilities(): {
    venue: "MYRIAD";
    classification: "USER_WALLET_AUTHORIZED_ACTION_CANDIDATE";
    supportsWithdrawal: boolean;
    supportsApiInitiatedWithdrawal: false;
    supportsUserBroadcastReference: true;
    requiresUserSignature: true;
    requiresVenueAuth: false;
    readinessStatus: MyriadWithdrawalReadinessStatus;
  } {
    return {
      venue: "MYRIAD",
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
  }): Promise<MyriadWithdrawalQuote> {
    this.assertUserWalletDryRunConfigured();
    assertSafeString(input.destinationChain, "destinationChain");
    assertSafeString(input.destinationToken, "destinationToken");
    assertSafeString(input.destinationAddress, "destinationAddress");
    assertPositiveAmount(input.amount);
    if (input.destinationChain.toUpperCase() !== "BSC" || input.destinationToken.toUpperCase() !== "USD1") {
      throw new Error("MYRIAD_WITHDRAWAL_BSC_USD1_REQUIRED");
    }
    return {
      provider: "MYRIAD_USER_WALLET",
      sourceVenue: "MYRIAD",
      destinationChain: "BSC",
      destinationToken: "USD1",
      destinationAddress: input.destinationAddress,
      amount: input.amount,
      estimatedFees: "0",
      estimatedTimeSeconds: null,
      expiresAt: new Date(this.now().getTime() + this.config.timeoutMs).toISOString(),
      instructionsUrl: this.config.instructionsUrl,
      userSafeSummary: "Myriad user-wallet dry run: user must complete withdrawal through the Myriad/ThirdWeb wallet UI. Lotus does not hold keys, sign, broadcast, or move funds.",
      warnings: myriadWarnings(this.config.instructionsUrl)
    };
  }

  public async prepareUserAction(input: MyriadWithdrawalQuote): Promise<MyriadUserWalletAction> {
    this.assertUserWalletDryRunConfigured();
    return {
      actionType: "USER_COMPLETE_MYRIAD_WALLET_WITHDRAWAL",
      walletModel: "THIRDWEB",
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
      code: error instanceof Error ? error.message : "MYRIAD_WITHDRAWAL_ADAPTER_ERROR",
      message: "Myriad withdrawal adapter failed closed in user-wallet dry-run mode."
    };
  }

  private assertUserWalletDryRunConfigured(): void {
    if (!this.config.enabled) {
      throw new Error("MYRIAD_WITHDRAWAL_ADAPTER_DISABLED");
    }
    if (this.config.mode !== "USER_WALLET_DRY_RUN") {
      throw new Error("MYRIAD_WITHDRAWAL_ADAPTER_MODE_UNSUPPORTED");
    }
    if (!this.config.dryRunOnly) {
      throw new Error("MYRIAD_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY_REQUIRED");
    }
    if (!this.config.configured) {
      throw new Error("MYRIAD_WITHDRAWAL_ADAPTER_NOT_CONFIGURED");
    }
  }
}

export const buildMyriadUserWalletProviderStatus = (input: {
  quote: MyriadWithdrawalQuote;
  userAction: MyriadUserWalletAction;
}): Record<string, unknown> => ({
  provider: "MYRIAD_USER_WALLET",
  mode: "USER_WALLET_DRY_RUN",
  walletModel: "THIRDWEB",
  classification: "USER_WALLET_AUTHORIZED_ACTION_CANDIDATE",
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

export const verifyMyriadWithdrawalRedaction = (
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  const serialized = JSON.stringify(payload);
  const forbidden = [
    env.MYRIAD_API_KEY,
    env.MYRIAD_WITHDRAWAL_EVIDENCE_API_KEY,
    env.DATABASE_URL,
    env.TEST_DATABASE_URL,
    "authorization",
    "authHeader",
    "privateKey",
    "walletSeed",
    "seedPhrase",
    "thirdwebSigner",
    "thirdwebSecret",
    "sessionToken",
    "sessionCookie",
    "rawProviderPayload",
    "providerInternals"
  ].filter((value): value is string => Boolean(value));
  return forbidden.every((value) => !serialized.includes(value));
};

const myriadWarnings = (instructionsUrl: string): string[] => [
  "User must complete withdrawal through the Myriad/ThirdWeb wallet UI.",
  "Lotus does not hold private keys, wallet seeds, ThirdWeb signer material, or session tokens.",
  "Lotus does not sign, broadcast, custody, or move funds in this dry run.",
  "First supported Myriad withdrawal rail is BNB Smart Chain USD1.",
  `Review Myriad withdrawal instructions before proceeding: ${instructionsUrl}`
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
    throw new Error(`MYRIAD_WITHDRAWAL_${label.toUpperCase()}_REQUIRED`);
  }
};

const assertPositiveAmount = (value: string): void => {
  try {
    if (new Decimal(value).lte(0)) {
      throw new Error("MYRIAD_WITHDRAWAL_AMOUNT_INVALID");
    }
  } catch {
    throw new Error("MYRIAD_WITHDRAWAL_AMOUNT_INVALID");
  }
};
