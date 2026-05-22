import { BuilderClient, type SafeTxResult, type UserInfo } from "@opinion-labs/opinion-clob-sdk";

export const OPINION_BUILDER_DEFAULT_HOST = "https://openapi.opinion.trade/openapi";
export const OPINION_BUILDER_DEFAULT_CHAIN_ID = 56;
export const OPINION_BUILDER_DEFAULT_RPC_URL = "https://bsc-dataseed.binance.org/";
export const OPINION_BUILDER_DEFAULT_TIMEOUT_MS = 8_000;

export interface OpinionBuilderAccountClientConfig {
  enabled: boolean;
  host?: string | null | undefined;
  builderApiKey?: string | null | undefined;
  rpcUrl?: string | null | undefined;
  requestTimeoutMs?: number | null | undefined;
}

export interface OpinionBuilderSafeAccount {
  walletAddress: string;
  multiSigWallet: string;
  builderName: string | null;
  enableTrading: boolean;
  userApiKeyCreated: boolean;
  walletCreationTxHashPresent: boolean;
}

export interface OpinionEnableTradingRequest {
  safeTxHash: string;
  typedData: Record<string, unknown>;
  safeTx: Record<string, unknown>;
}

export interface OpinionBuilderAccountClientContract {
  configured(): boolean;
  accountSetupEnabled(): boolean;
  createOrRecoverSafe(input: { walletAddress: string }): Promise<OpinionBuilderSafeAccount>;
  buildEnableTradingRequest(input: { safeAddress: string }): Promise<OpinionEnableTradingRequest>;
  submitEnableTrading(input: {
    safeAddress: string;
    signature: string;
    expectedSafeTxHash: string;
    request: OpinionEnableTradingRequest;
  }): Promise<{ safeTxHash: string | null }>;
}

export class OpinionBuilderAccountClient implements OpinionBuilderAccountClientContract {
  private readonly client: BuilderClient | null;

  public constructor(private readonly config: OpinionBuilderAccountClientConfig) {
    this.client = this.configured()
      ? new BuilderClient({
          host: clean(config.host) ?? OPINION_BUILDER_DEFAULT_HOST,
          builderApiKey: clean(config.builderApiKey)!,
          chainId: OPINION_BUILDER_DEFAULT_CHAIN_ID,
          rpcUrl: clean(config.rpcUrl) ?? OPINION_BUILDER_DEFAULT_RPC_URL
        })
      : null;
  }

  public configured(): boolean {
    return this.accountSetupEnabled() && Boolean(clean(this.config.builderApiKey));
  }

  public accountSetupEnabled(): boolean {
    return this.config.enabled === true;
  }

  public async createOrRecoverSafe(input: { walletAddress: string }): Promise<OpinionBuilderSafeAccount> {
    const client = this.requireClient();
    try {
      return toSafeAccount(await client.getUser(input.walletAddress), false);
    } catch (error) {
      if (!isRecoverableGetUserError(error)) {
        throw sanitizeOpinionBuilderError(error, "Opinion builder Safe lookup failed.");
      }
    }
    try {
      return toSafeAccount(await client.createUser(input.walletAddress), true);
    } catch (error) {
      try {
        return toSafeAccount(await client.getUser(input.walletAddress), false);
      } catch {
        throw sanitizeOpinionBuilderError(error, "Opinion builder Safe creation failed.");
      }
    }
  }

  public async buildEnableTradingRequest(input: { safeAddress: string }): Promise<OpinionEnableTradingRequest> {
    const request = await this.requireClient()
      .buildEnableTradingTx(input.safeAddress)
      .catch((error: unknown) => {
        throw sanitizeOpinionBuilderError(error, "Opinion enable-trading transaction build failed.");
      });
    return toEnableTradingRequest(request);
  }

  public async submitEnableTrading(input: {
    safeAddress: string;
    signature: string;
    expectedSafeTxHash: string;
    request: OpinionEnableTradingRequest;
  }): Promise<{ safeTxHash: string | null }> {
    if (input.request.safeTxHash !== input.expectedSafeTxHash) {
      throw new Error("Opinion enable-trading request hash changed before submit.");
    }
    const result = await this.requireClient()
      .submitSafeTx(input.safeAddress, fromEnableTradingRequest(input.request), input.signature)
      .catch((error: unknown) => {
        throw sanitizeOpinionBuilderError(error, "Opinion enable-trading submit failed.");
      });
    const safeTxHash = typeof result.safeTxHash === "string" && result.safeTxHash.trim().length > 0
      ? result.safeTxHash.trim()
      : null;
    return { safeTxHash };
  }

  private requireClient(): BuilderClient {
    if (!this.client) {
      throw new Error("Opinion builder account setup is not configured.");
    }
    return this.client;
  }
}

export const buildOpinionBuilderAccountClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): OpinionBuilderAccountClient => new OpinionBuilderAccountClient({
  enabled: env.OPINION_BUILDER_ACCOUNT_SETUP_ENABLED === "true",
  host: env.OPINION_BUILDER_BASE_URL ?? null,
  builderApiKey: env.OPINION_BUILDER_API_KEY ?? env.OPINION_API_KEY ?? null,
  rpcUrl: env.OPINION_BUILDER_RPC_URL ?? null,
  requestTimeoutMs: parsePositiveInt(env.OPINION_BUILDER_ACCOUNT_SETUP_TIMEOUT_MS) ?? OPINION_BUILDER_DEFAULT_TIMEOUT_MS
});

const toSafeAccount = (
  user: Omit<UserInfo, "apikey" | "walletCreationTxHash"> | UserInfo,
  created: boolean
): OpinionBuilderSafeAccount => ({
  walletAddress: user.walletAddress,
  multiSigWallet: user.multiSigWallet,
  builderName: user.builderName?.trim() || null,
  enableTrading: user.enableTrading === true,
  userApiKeyCreated: created && "apikey" in user && typeof user.apikey === "string" && user.apikey.length > 0,
  walletCreationTxHashPresent: "walletCreationTxHash" in user && typeof user.walletCreationTxHash === "string" && user.walletCreationTxHash.length > 0
});

const toEnableTradingRequest = (request: SafeTxResult): OpinionEnableTradingRequest => ({
  safeTxHash: request.safeTxHash,
  typedData: jsonSafeRecord(request.eip712Data),
  safeTx: jsonSafeRecord(request.safeTx)
});

const fromEnableTradingRequest = (request: OpinionEnableTradingRequest): SafeTxResult => ({
  safeTx: request.safeTx as unknown as SafeTxResult["safeTx"],
  eip712Data: request.typedData as SafeTxResult["eip712Data"],
  safeTxHash: request.safeTxHash,
  submissionDataTemplate: {}
});

const clean = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const jsonSafeRecord = (value: unknown): Record<string, unknown> => {
  const converted = jsonSafe(value);
  return converted && typeof converted === "object" && !Array.isArray(converted)
    ? converted as Record<string, unknown>
    : {};
};

const jsonSafe = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, jsonSafe(nested)]));
  }
  return value;
};

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isRecoverableGetUserError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("404") ||
    message.includes("not found") ||
    message.includes("no result") ||
    message.includes("does not exist");
};

const sanitizeOpinionBuilderError = (error: unknown, fallback: string): Error => {
  const message = error instanceof Error && error.message.trim().length > 0
    ? error.message.replace(/apikey|api key|builder-apikey|authorization/gi, "credential").slice(0, 240)
    : fallback;
  return new Error(message);
};
