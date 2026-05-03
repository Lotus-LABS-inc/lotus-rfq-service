export interface PredictAccountClientConfig {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface PredictConnectedAccount {
  name: string | null;
  address: string;
}

interface PredictEnvelope<T> {
  success?: boolean;
  data?: T;
  code?: number;
  error?: string;
  message?: string;
}

export class PredictAccountClientError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly reasonCode = "PREDICT_ACCOUNT_CLIENT_ERROR"
  ) {
    super(message);
    this.name = "PredictAccountClientError";
  }
}

export class PredictAccountClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  public constructor(private readonly config: PredictAccountClientConfig) {
    this.baseUrl = (config.baseUrl ?? "https://api.predict.fun").replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  public configured(): boolean {
    return Boolean(this.config.apiKey?.trim());
  }

  public async getAuthMessage(): Promise<string> {
    const envelope = await this.request<{ message?: string }>("/v1/auth/message", { method: "GET" });
    const message = envelope.data?.message;
    if (typeof message !== "string" || message.length === 0) {
      throw new PredictAccountClientError("Predict auth message response did not include a message.", 502);
    }
    return message;
  }

  public async getJwtWithSignature(input: {
    signer: string;
    signature: string;
    message: string;
  }): Promise<string> {
    const envelope = await this.request<{ token?: string }>("/v1/auth", {
      method: "POST",
      body: {
        signer: input.signer,
        signature: input.signature,
        message: input.message
      }
    });
    const token = envelope.data?.token;
    if (typeof token !== "string" || token.length === 0) {
      throw new PredictAccountClientError("Predict auth response did not include a token.", 502);
    }
    return token;
  }

  public async getConnectedAccount(jwt: string): Promise<PredictConnectedAccount> {
    const envelope = await this.request<{ name?: string; address?: string }>("/v1/account", {
      method: "GET",
      bearerToken: jwt
    });
    const address = envelope.data?.address;
    if (typeof address !== "string" || !isEvmAddress(address)) {
      throw new PredictAccountClientError("Predict account response did not include a valid address.", 502);
    }
    return {
      name: typeof envelope.data?.name === "string" && envelope.data.name.length > 0 ? envelope.data.name : null,
      address
    };
  }

  private async request<T>(path: string, input: {
    method: "GET" | "POST";
    body?: Record<string, unknown>;
    bearerToken?: string;
  }): Promise<PredictEnvelope<T>> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) {
      throw new PredictAccountClientError("Predict API key is not configured.", 503, "PREDICT_ACCOUNT_API_KEY_MISSING");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: input.method,
        signal: controller.signal,
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "x-api-key": apiKey,
          ...(input.bearerToken ? { "authorization": `Bearer ${input.bearerToken}` } : {})
        },
        ...(input.body ? { body: JSON.stringify(input.body) } : {})
      });
      const body = await response.json().catch(() => ({})) as PredictEnvelope<T>;
      if (!response.ok || body.success === false) {
        throw new PredictAccountClientError(
          safePredictErrorMessage(body, response.status),
          response.status,
          "PREDICT_ACCOUNT_REQUEST_FAILED"
        );
      }
      return body;
    } catch (error) {
      if (error instanceof PredictAccountClientError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new PredictAccountClientError("Predict account request timed out.", 504, "PREDICT_ACCOUNT_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const buildPredictAccountClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): PredictAccountClient =>
  new PredictAccountClient({
    baseUrl: env.PREDICT_MAINNET_BASE_URL,
    apiKey: env.PREDICT_API_KEY,
    timeoutMs: parseTimeoutMs(env.PREDICT_ACCOUNT_AUTH_TIMEOUT_MS)
  });

const parseTimeoutMs = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const isEvmAddress = (value: string): boolean =>
  /^0x[a-fA-F0-9]{40}$/.test(value);

const safePredictErrorMessage = (body: PredictEnvelope<unknown>, status: number): string => {
  const message = typeof body.message === "string" && body.message.length > 0
    ? body.message
    : typeof body.error === "string" && body.error.length > 0
      ? body.error
      : `Predict account request failed with status ${status}.`;
  return message.slice(0, 240);
};
