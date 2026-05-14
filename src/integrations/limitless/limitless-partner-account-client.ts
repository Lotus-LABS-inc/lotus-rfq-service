import { createHmac } from "node:crypto";
import { Client, HttpClient, PortfolioFetcher } from "@limitless-exchange/sdk";

export const LIMITLESS_PARTNER_ACCOUNT_DEFAULT_BASE_URL = "https://api.limitless.exchange";

export interface LimitlessPartnerAccountClientConfig {
  enabled?: boolean | undefined;
  serverWalletDelegationEnabled?: boolean | undefined;
  eoaPartnerAccountRegistrationEnabled?: boolean | undefined;
  baseUrl?: string | undefined;
  hmacTokenId?: string | undefined;
  hmacSecret?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface LimitlessPartnerAccount {
  profileId: string;
  account: string;
}

export class LimitlessPartnerAccountClientError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly reasonCode = "LIMITLESS_PARTNER_ACCOUNT_CLIENT_ERROR"
  ) {
    super(message);
    this.name = "LimitlessPartnerAccountClientError";
  }
}

export class LimitlessPartnerAccountClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  public constructor(private readonly config: LimitlessPartnerAccountClientConfig) {
    this.baseUrl = (config.baseUrl ?? LIMITLESS_PARTNER_ACCOUNT_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  public configured(): boolean {
    return Boolean(
      this.config.enabled === true &&
      this.config.hmacTokenId?.trim() &&
      this.config.hmacSecret?.trim()
    );
  }

  public serverWalletDelegationEnabled(): boolean {
    return this.config.serverWalletDelegationEnabled === true;
  }

  public eoaPartnerAccountRegistrationEnabled(): boolean {
    return this.config.eoaPartnerAccountRegistrationEnabled === true;
  }

  public async getSigningMessage(): Promise<string> {
    const response = await this.fetchWithTimeout("/auth/signing-message", { method: "GET" });
    if (!response.ok) {
      throw new LimitlessPartnerAccountClientError(
        `Limitless signing message request failed with status ${response.status}.`,
        response.status,
        "LIMITLESS_SIGNING_MESSAGE_FAILED"
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json().catch(() => null) as { message?: unknown; signingMessage?: unknown } | null;
      const message = typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.signingMessage === "string"
          ? payload.signingMessage
          : null;
      if (message) {
        return message;
      }
    }
    const message = await response.text();
    if (!message.trim()) {
      throw new LimitlessPartnerAccountClientError("Limitless signing message response was empty.", 502);
    }
    return message;
  }

  public async createEoaPartnerAccount(input: {
    account: string;
    signingMessage: string;
    signature: string;
    displayName?: string | null;
  }): Promise<LimitlessPartnerAccount> {
    const body = JSON.stringify({
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim().slice(0, 44) } : {}),
      createServerWallet: false
    });
    const path = "/profiles/partner-accounts";
    const response = await this.fetchWithTimeout(path, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...this.buildHmacHeaders("POST", path, body),
        "x-account": input.account,
        "x-signing-message": hexEncodeUtf8(input.signingMessage),
        "x-signature": input.signature
      }
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new LimitlessPartnerAccountClientError(
        safeLimitlessPartnerAccountErrorMessage(payload, response.status),
        response.status,
        response.status === 409 ? "LIMITLESS_PARTNER_ACCOUNT_CONFLICT" : "LIMITLESS_PARTNER_ACCOUNT_CREATE_FAILED"
      );
    }
    return parsePartnerAccountResponse(payload);
  }

  public async getEoaPartnerAccount(account: string): Promise<LimitlessPartnerAccount | null> {
    if (!isEvmAddress(account)) {
      return null;
    }
    try {
      const httpClient = new HttpClient({
        baseURL: this.baseUrl,
        timeout: this.timeoutMs,
        ...(this.config.hmacTokenId?.trim() && this.config.hmacSecret?.trim()
          ? {
              hmacCredentials: {
                tokenId: this.config.hmacTokenId.trim(),
                secret: this.config.hmacSecret.trim()
              }
            }
          : {})
      });
      const profile = await new PortfolioFetcher(httpClient).getProfile(account);
      return parseProfilePartnerAccountResponse(profile, account);
    } catch {
      return null;
    }
  }

  public async createServerWalletPartnerAccount(input: {
    displayName?: string | null;
  } = {}): Promise<LimitlessPartnerAccount> {
    const tokenId = this.config.hmacTokenId?.trim();
    const secret = this.config.hmacSecret?.trim();
    if (!tokenId || !secret) {
      throw new LimitlessPartnerAccountClientError("Limitless partner HMAC credentials are not configured.", 503, "LIMITLESS_PARTNER_ACCOUNT_HMAC_MISSING");
    }
    try {
      const client = new Client({
        baseURL: this.baseUrl,
        timeout: this.timeoutMs,
        hmacCredentials: {
          tokenId,
          secret
        }
      });
      const response = await client.partnerAccounts.createAccount({
        ...(input.displayName?.trim() ? { displayName: input.displayName.trim().slice(0, 44) } : {}),
        createServerWallet: true
      });
      return parsePartnerAccountResponse(response as unknown as Record<string, unknown>);
    } catch (error) {
      if (error instanceof LimitlessPartnerAccountClientError) {
        throw error;
      }
      throw new LimitlessPartnerAccountClientError(
        safeLimitlessSdkErrorMessage(error),
        502,
        "LIMITLESS_PARTNER_ACCOUNT_CREATE_FAILED"
      );
    }
  }

  private async fetchWithTimeout(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new LimitlessPartnerAccountClientError("Limitless partner account request timed out.", 504, "LIMITLESS_PARTNER_ACCOUNT_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHmacHeaders(method: string, pathWithSearch: string, body: string): Record<string, string> {
    const tokenId = this.config.hmacTokenId?.trim();
    const secret = this.config.hmacSecret?.trim();
    if (!tokenId || !secret) {
      throw new LimitlessPartnerAccountClientError("Limitless partner HMAC credentials are not configured.", 503, "LIMITLESS_PARTNER_ACCOUNT_HMAC_MISSING");
    }
    const timestamp = new Date().toISOString();
    const payload = `${timestamp}\n${method.toUpperCase()}\n${pathWithSearch}\n${body}`;
    return {
      "lmts-api-key": tokenId,
      "lmts-timestamp": timestamp,
      "lmts-signature": createHmac("sha256", decodeBase64Secret(secret)).update(payload).digest("base64")
    };
  }
}

export const buildLimitlessPartnerAccountClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): LimitlessPartnerAccountClient =>
  new LimitlessPartnerAccountClient({
    enabled: env.LIMITLESS_PARTNER_ACCOUNT_ENABLED === "true",
    serverWalletDelegationEnabled: env.LIMITLESS_EXECUTION_MODE === "delegated_partner_server_wallet",
    eoaPartnerAccountRegistrationEnabled: env.LIMITLESS_EXECUTION_MODE === "user_signed_backend_relay" || env.LIMITLESS_EXECUTION_MODE === "partner_eoa_account",
    baseUrl: env.LIMITLESS_PARTNER_ACCOUNT_BASE_URL ?? env.LIMITLESS_BASE_URL,
    hmacTokenId: env.LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID ?? env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY,
    hmacSecret: env.LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET ?? env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET,
    timeoutMs: parseTimeoutMs(env.LIMITLESS_PARTNER_ACCOUNT_TIMEOUT_MS)
  });

const parseTimeoutMs = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const decodeBase64Secret = (secret: string): Buffer => {
  const normalized = secret.trim();
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
};

const hexEncodeUtf8 = (value: string): `0x${string}` =>
  `0x${Buffer.from(value, "utf8").toString("hex")}`;

const isEvmAddress = (value: string): boolean =>
  /^0x[a-fA-F0-9]{40}$/.test(value);

const parsePartnerAccountResponse = (payload: Record<string, unknown>): LimitlessPartnerAccount => {
  const profileId = payload.profileId;
  const account = payload.account;
  if ((typeof profileId !== "number" && typeof profileId !== "string") || typeof account !== "string" || !isEvmAddress(account)) {
    throw new LimitlessPartnerAccountClientError("Limitless partner account response did not include profileId and account.", 502);
  }
  return {
    profileId: String(profileId),
    account
  };
};

const parseProfilePartnerAccountResponse = (payload: unknown, fallbackAccount: string): LimitlessPartnerAccount | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const profileId = firstPresent(payload.profileId, payload.id, payload.userId, payload.ownerId);
  const account = firstPresent(payload.account, payload.address, payload.walletAddress) ?? fallbackAccount;
  if ((typeof profileId !== "number" && typeof profileId !== "string") || typeof account !== "string" || !isEvmAddress(account)) {
    return null;
  }
  return {
    profileId: String(profileId),
    account
  };
};

const safeLimitlessPartnerAccountErrorMessage = (payload: Record<string, unknown>, status: number): string => {
  const message = typeof payload.message === "string" && payload.message.length > 0
    ? payload.message
    : typeof payload.error === "string" && payload.error.length > 0
      ? payload.error
      : `Limitless partner account request failed with status ${status}.`;
  return message.slice(0, 240);
};

const safeLimitlessSdkErrorMessage = (error: unknown): string => {
  const message = error instanceof Error && error.message.length > 0
    ? error.message
    : "Limitless server-wallet partner account request failed.";
  return message.slice(0, 240);
};

const firstPresent = (...values: unknown[]): unknown =>
  values.find((value) => (typeof value === "string" && value.trim().length > 0) || typeof value === "number");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
