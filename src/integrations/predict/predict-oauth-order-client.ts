import {
  createPredictfunRelayNonce,
  predictfunRelayHeaders,
  signPredictfunRelayRequest
} from "../../execution-system/predictfun-execution-relay-auth.js";

export interface PredictOauthOrderClientConfig {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  orderCreatePath?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface PredictOauthCreateOrderPayload {
  signer: string;
  account: string;
  signature: string;
  data: Record<string, unknown>;
}

export interface PredictOauthCreateOrderResult {
  orderId: string;
  orderHash: string;
}

export interface PredictOauthOrderStatus {
  orderHash: string;
  status: string | null;
  size: string | null;
  remainingSize: string | null;
  price: string | null;
  raw: Record<string, unknown>;
}

export interface PredictfunExecutionRelayClientConfig {
  relayUrl?: string | undefined;
  relaySecret?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

interface PredictEnvelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export class PredictOauthOrderClientError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly reasonCode = "PREDICT_OAUTH_ORDER_CLIENT_ERROR"
  ) {
    super(message);
    this.name = "PredictOauthOrderClientError";
  }
}

export class PredictOauthOrderClient {
  private readonly baseUrl: string;
  private readonly orderCreatePath: string;
  private readonly timeoutMs: number;

  public constructor(private readonly config: PredictOauthOrderClientConfig) {
    this.baseUrl = (config.baseUrl ?? "https://api.predict.fun").replace(/\/+$/, "");
    this.orderCreatePath = config.orderCreatePath ?? "/v1/orders";
    this.timeoutMs = config.timeoutMs ?? 45_000;
  }

  public configured(): boolean {
    return Boolean(this.config.apiKey?.trim());
  }

  public async createOauthOrder(
    payload: PredictOauthCreateOrderPayload,
    jwt?: string | undefined
  ): Promise<PredictOauthCreateOrderResult> {
    const requestPayload = toPredictCreateOrderRequest(payload);
    const envelope = await this.request<Record<string, unknown>>(this.orderCreatePath, {
      method: "POST",
      body: requestPayload,
      jwt
    });
    const data = envelope.data ?? {};
    const order = isRecord(data.order) ? data.order : {};
    const orderId = stringField(data, "orderId") ?? stringField(data, "id") ?? stringField(order, "id") ?? stringField(order, "hash");
    const orderHash = stringField(data, "orderHash") ?? stringField(data, "hash") ?? stringField(order, "hash");
    if (typeof orderId !== "string" || orderId.trim().length === 0 || typeof orderHash !== "string" || orderHash.trim().length === 0) {
      throw new PredictOauthOrderClientError("Predict create-order response did not include an order id/hash.", 502);
    }
    return { orderId, orderHash };
  }

  public async getOrderByHash(orderHash: string, jwt?: string | undefined): Promise<PredictOauthOrderStatus> {
    const envelope = await this.request<Record<string, unknown>>(`/v1/orders/${encodeURIComponent(orderHash)}`, {
      method: "GET",
      jwt
    });
    const data = envelope.data;
    if (!data || typeof data !== "object") {
      throw new PredictOauthOrderClientError("Predict order status response did not include order data.", 502);
    }
    return {
      orderHash,
      status: stringField(data, "status"),
      size: stringField(data, "size"),
      remainingSize: stringField(data, "remainingSize") ?? stringField(data, "remaining_size"),
      price: stringField(data, "price"),
      raw: data
    };
  }

  private async request<T>(path: string, input: {
    method: "GET" | "POST";
    body?: unknown;
    jwt?: string | undefined;
  }): Promise<PredictEnvelope<T>> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) {
      throw new PredictOauthOrderClientError("Predict API key is not configured.", 503, "PREDICT_API_KEY_MISSING");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: input.method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": apiKey,
          ...(input.jwt ? { authorization: `Bearer ${input.jwt}` } : {})
        },
        ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {})
      });
      const body = await response.json().catch(() => ({})) as PredictEnvelope<T>;
      if (!response.ok || body.success === false) {
        throw new PredictOauthOrderClientError(safePredictOauthErrorMessage(body, response.status), response.status, "PREDICT_OAUTH_ORDER_REQUEST_FAILED");
      }
      return body;
    } catch (error) {
      if (error instanceof PredictOauthOrderClientError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new PredictOauthOrderClientError("Predict OAuth order request timed out.", 504, "PREDICT_OAUTH_ORDER_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class RelayPredictOauthOrderClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(config: PredictfunExecutionRelayClientConfig) {
    if (!config.relayUrl?.trim() || !config.relaySecret?.trim()) {
      throw new PredictOauthOrderClientError(
        "Predict.fun execution relay requires PREDICT_FUN_EXECUTION_RELAY_URL and PREDICT_FUN_EXECUTION_RELAY_SECRET.",
        503,
        "PREDICT_FUN_RELAY_ENV_INCOMPLETE"
      );
    }
    this.baseUrl = config.relayUrl.replace(/\/+$/, "");
    this.secret = config.relaySecret;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public configured(): boolean {
    return true;
  }

  public createOauthOrder(
    payload: PredictOauthCreateOrderPayload,
    jwt?: string | undefined
  ): Promise<PredictOauthCreateOrderResult> {
    return this.post<PredictOauthCreateOrderResult>("/internal/predictfun/v1/submit-order", { payload, jwt });
  }

  public getOrderByHash(orderHash: string, jwt?: string | undefined): Promise<PredictOauthOrderStatus> {
    return this.post<PredictOauthOrderStatus>("/internal/predictfun/v1/order-state", { orderHash, jwt });
  }

  public cancelOrder(orderHash: string): Promise<{ cancelled: boolean }> {
    return this.post<{ cancelled: boolean }>("/internal/predictfun/v1/cancel-order", { orderHash });
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const timestamp = new Date().toISOString();
    const nonce = createPredictfunRelayNonce();
    const signature = signPredictfunRelayRequest(this.secret, {
      timestamp,
      nonce,
      method: "POST",
      path,
      body
    });
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [predictfunRelayHeaders.timestamp]: timestamp,
        [predictfunRelayHeaders.nonce]: nonce,
        [predictfunRelayHeaders.signature]: signature
      },
      body: JSON.stringify(body)
    });
    const responseBody = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = isRecord(responseBody) && typeof responseBody.message === "string"
        ? responseBody.message
        : `Predict.fun execution relay request failed with status ${response.status}.`;
      throw new PredictOauthOrderClientError(
        message,
        response.status,
        response.status === 401 || response.status === 403
          ? "PREDICT_FUN_RELAY_UNAUTHORIZED"
          : "PREDICT_FUN_RELAY_ERROR"
      );
    }
    return responseBody as T;
  }
}

export const buildPredictOauthOrderClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): PredictOauthOrderClient | RelayPredictOauthOrderClient =>
  env.PREDICT_FUN_EXECUTION_SUBMIT_MODE === "relay"
    ? new RelayPredictOauthOrderClient({
        relayUrl: env.PREDICT_FUN_EXECUTION_RELAY_URL,
        relaySecret: env.PREDICT_FUN_EXECUTION_RELAY_SECRET
      })
    : new PredictOauthOrderClient({
        baseUrl: env.PREDICT_MAINNET_BASE_URL,
        apiKey: env.PREDICT_API_KEY,
        timeoutMs: parseTimeoutMs(env.PREDICT_FUN_EXECUTION_TIMEOUT_MS)
      });

const parseTimeoutMs = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const stringField = (value: Record<string, unknown>, key: string): string | null => {
  const candidate = value[key];
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }
  return null;
};

const safePredictOauthErrorMessage = (body: PredictEnvelope<unknown>, status: number): string => {
  const message = typeof body.message === "string" && body.message.length > 0
    ? body.message
    : typeof body.error === "string" && body.error.length > 0
      ? body.error
      : `Predict OAuth order request failed with status ${status}.`;
  return message.slice(0, 240);
};

const toPredictCreateOrderRequest = (payload: PredictOauthCreateOrderPayload): { data: Record<string, unknown> } => {
  const data = isRecord(payload.data) ? { ...payload.data } : {};
  const order = isRecord(data.order) ? { ...data.order } : {};
  data.order = {
    ...order,
    signature: payload.signature
  };
  return { data };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
