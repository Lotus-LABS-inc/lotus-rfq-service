import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  PredictOauthOrderClient,
  PredictOauthOrderClientError,
  type PredictOauthCreateOrderPayload
} from "./integrations/predict/predict-oauth-order-client.js";
import {
  predictfunRelayHeaders,
  verifyPredictfunRelayRequest
} from "./execution-system/predictfun-execution-relay-auth.js";
import { mapPredictOrderStatusToSettlementState } from "./execution-system/user-signed-relay-execution-adapter.js";
import { createLogger } from "./utils/logger.js";

const relaySecret = (): string => process.env.PREDICT_FUN_EXECUTION_RELAY_SECRET ?? "";

export const buildPredictfunExecutionRelayServer = () => {
  const logger = createLogger(process.env.LOG_LEVEL === "debug" ? "debug" : "info");
  const app = Fastify({ loggerInstance: logger });

  app.get("/health", async () => ({
    ok: true,
    service: "predictfun-execution-relay"
  }));

  app.get("/readiness", async () => ({
    service: "predictfun-execution-relay",
    venue: "PREDICT_FUN",
    requiredEnvPresent: Boolean(process.env.PREDICT_MAINNET_BASE_URL?.trim()) &&
      Boolean(process.env.PREDICT_API_KEY?.trim()) &&
      relaySecret().length > 0,
    missingEnv: [
      ...(!process.env.PREDICT_MAINNET_BASE_URL?.trim() ? ["PREDICT_MAINNET_BASE_URL"] : []),
      ...(!process.env.PREDICT_API_KEY?.trim() ? ["PREDICT_API_KEY"] : []),
      ...(relaySecret().length === 0 ? ["PREDICT_FUN_EXECUTION_RELAY_SECRET"] : [])
    ],
    relaySecretConfigured: relaySecret().length > 0,
    apiKeyConfigured: Boolean(process.env.PREDICT_API_KEY?.trim())
  }));

  const authenticated = (path: string) => async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = relaySecret();
    if (!secret) {
      return reply.status(503).send({
        code: "PREDICT_FUN_RELAY_SECRET_MISSING",
        message: "Predict.fun execution relay secret is not configured."
      });
    }
    const timestamp = headerValue(request.headers[predictfunRelayHeaders.timestamp]);
    const nonce = headerValue(request.headers[predictfunRelayHeaders.nonce]);
    const signature = headerValue(request.headers[predictfunRelayHeaders.signature]);
    if (!timestamp || !nonce || !signature) {
      return reply.status(401).send({
        code: "PREDICT_FUN_RELAY_AUTH_MISSING",
        message: "Predict.fun execution relay authentication headers are missing."
      });
    }
    const verified = verifyPredictfunRelayRequest(secret, {
      timestamp,
      nonce,
      signature,
      method: request.method,
      path,
      body: request.body ?? {},
      maxSkewMs: 30_000
    });
    if (!verified) {
      return reply.status(403).send({
        code: "PREDICT_FUN_RELAY_AUTH_INVALID",
        message: "Predict.fun execution relay authentication failed."
      });
    }
  };

  app.post("/internal/predictfun/v1/submit-order", {
    preHandler: authenticated("/internal/predictfun/v1/submit-order")
  }, async (request, reply) => {
    const { payload, jwt } = parseSubmitRequest(request.body);
    return handleRelayCall(reply, async () => orderClient().createOauthOrder(payload, jwt));
  });

  app.post("/internal/predictfun/v1/order-state", {
    preHandler: authenticated("/internal/predictfun/v1/order-state")
  }, async (request, reply) => {
    const orderHash = parseStringField(request.body, "orderHash");
    const jwt = optionalStringField(request.body, "jwt");
    return handleRelayCall(reply, async () => orderClient().getOrderByHash(orderHash, jwt));
  });

  app.post("/internal/predictfun/v1/settlement-state", {
    preHandler: authenticated("/internal/predictfun/v1/settlement-state")
  }, async (request, reply) => {
    const orderHash = parseStringField(request.body, "orderHash");
    const jwt = optionalStringField(request.body, "jwt");
    return handleRelayCall(reply, async () => {
      const status = await orderClient().getOrderByHash(orderHash, jwt);
      return mapPredictOrderStatusToSettlementState(status);
    });
  });

  app.post("/internal/predictfun/v1/cancel-order", {
    preHandler: authenticated("/internal/predictfun/v1/cancel-order")
  }, async (_request, reply) =>
    reply.status(501).send({
      code: "PREDICT_FUN_CANCEL_NOT_IMPLEMENTED",
      message: "Predict.fun cancel relay is reserved but not implemented until official signed cancel semantics are confirmed."
    }));

  return app;
};

const orderClient = (): PredictOauthOrderClient =>
  new PredictOauthOrderClient({
    baseUrl: process.env.PREDICT_MAINNET_BASE_URL,
    apiKey: process.env.PREDICT_API_KEY,
    timeoutMs: parseTimeoutMs(process.env.PREDICT_FUN_EXECUTION_TIMEOUT_MS)
  });

const handleRelayCall = async <T>(
  reply: FastifyReply,
  operation: () => Promise<T>
): Promise<T | unknown> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PredictOauthOrderClientError) {
      return reply.status(error.statusCode >= 400 ? error.statusCode : 502).send({
        code: error.reasonCode,
        message: error.message
      });
    }
    return reply.status(502).send({
      code: "PREDICT_FUN_RELAY_ERROR",
      message: error instanceof Error ? error.message : "Predict.fun execution relay failed."
    });
  }
};

const parseSubmitRequest = (body: unknown): {
  payload: PredictOauthCreateOrderPayload;
  jwt: string;
} => {
  const record = asRecord(body);
  const payload = asRecord(record.payload);
  const jwt = parseStringField(record, "jwt");
  if (
    !isEvmAddress(payload.signer) ||
    !isEvmAddress(payload.account) ||
    typeof payload.signature !== "string" ||
    !asRecord(payload.data).order
  ) {
    throw new PredictOauthOrderClientError(
      "Predict.fun relay submit request is missing signed order payload.",
      400,
      "PREDICT_FUN_RELAY_SUBMIT_INVALID"
    );
  }
  return {
    payload: {
      signer: payload.signer,
      account: payload.account,
      signature: payload.signature,
      data: asRecord(payload.data)
    },
    jwt
  };
};

const parseStringField = (body: unknown, field: string): string => {
  const value = asRecord(body)[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PredictOauthOrderClientError(
      `Predict.fun relay request is missing ${field}.`,
      400,
      "PREDICT_FUN_RELAY_REQUEST_INVALID"
    );
  }
  return value.trim();
};

const optionalStringField = (body: unknown, field: string): string | undefined => {
  const value = asRecord(body)[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const parseTimeoutMs = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const headerValue = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

const isEvmAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);

export const runPredictfunExecutionRelay = async (): Promise<void> => {
  loadDotenvFile();
  const app = buildPredictfunExecutionRelayServer();
  const port = Number(process.env.PORT ?? 10000);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ host, port });
};

const isMainModule = (): boolean => {
  const entryPath = process.argv[1];
  const thisPath = fileURLToPath(import.meta.url);
  return Boolean(entryPath) && entryPath === thisPath;
};

if (isMainModule()) {
  void runPredictfunExecutionRelay();
}
