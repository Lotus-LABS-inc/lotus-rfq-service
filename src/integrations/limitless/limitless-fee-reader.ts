import { HttpClient, PortfolioFetcher } from "@limitless-exchange/sdk";

export interface LimitlessFeeReader {
  getFeeBps(input?: {
    marketSlug?: string | undefined;
  }): Promise<number | null>;
}

export interface LimitlessProfileFeeReaderConfig {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  hmacTokenId?: string | undefined;
  hmacSecret?: string | undefined;
  account?: string | undefined;
  ttlMs?: number | undefined;
  timeoutMs?: number | undefined;
}

export class LimitlessProfileFeeReader implements LimitlessFeeReader {
  private cached: { feeBps: number | null; expiresAt: number } | null = null;

  public constructor(private readonly config: LimitlessProfileFeeReaderConfig) {}

  public async getFeeBps(): Promise<number | null> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.feeBps;
    }
    const feeBps = await this.fetchFeeBps();
    this.cached = {
      feeBps,
      expiresAt: now + (this.config.ttlMs ?? 10 * 60_000)
    };
    return feeBps;
  }

  private async fetchFeeBps(): Promise<number | null> {
    const account = this.config.account?.trim();
    if (!account) {
      return null;
    }
    try {
      const httpClient = new HttpClient({
        baseURL: this.config.baseUrl ?? "https://api.limitless.exchange",
        timeout: this.config.timeoutMs ?? 10_000,
        ...(this.config.apiKey?.trim() ? { apiKey: this.config.apiKey.trim() } : {}),
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
      return parseProfileFeeBps(profile);
    } catch {
      return null;
    }
  }
}

export const parseProfileFeeBps = (profile: unknown): number | null => {
  if (!isRecord(profile)) {
    return null;
  }
  const direct = numberField(profile, "feeRateBps");
  if (direct !== null) {
    return direct;
  }
  const rank = profile.rank;
  if (!isRecord(rank)) {
    return null;
  }
  return numberField(rank, "feeRateBps");
};

const numberField = (value: Record<string, unknown>, key: string): number | null => {
  const candidate = value[key];
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
    return candidate;
  }
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
