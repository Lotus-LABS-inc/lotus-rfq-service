import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  buildPolymarketExecutionAdapterV2ConfigFromEnv,
  getPolymarketExecutionAdapterV2EnvStatus,
  PolymarketExecutionNotConfiguredError,
  SdkPolymarketClobV2LiveClient,
  type PreparedVenueOrder
} from "./execution-system/index.js";
import {
  polymarketRelayHeaders,
  verifyPolymarketRelayRequest
} from "./execution-system/polymarket-execution-relay-auth.js";
import { createLogger } from "./utils/logger.js";

const relaySecret = (): string => process.env.POLYMARKET_EXECUTION_RELAY_SECRET ?? "";

export const buildPolymarketExecutionRelayServer = () => {
  const logger = createLogger(process.env.LOG_LEVEL === "debug" ? "debug" : "info");
  const app = Fastify({ loggerInstance: logger });

  app.get("/health", async () => ({
    ok: true,
    service: "polymarket-execution-relay"
  }));

  app.get("/readiness", async () => {
    const status = getPolymarketExecutionAdapterV2EnvStatus({
      ...process.env,
      POLYMARKET_EXECUTION_SUBMIT_MODE: "direct"
    });
    return {
      service: "polymarket-execution-relay",
      venue: "POLYMARKET",
      readinessState: status.readinessState,
      liveExecutionEnabled: status.liveExecutionEnabled,
      requiredEnvPresent: status.requiredEnvPresent,
      missingEnv: status.missingEnv,
      dryRunRequiredEnvPresent: status.dryRunRequiredEnvPresent,
      missingDryRunEnv: status.missingDryRunEnv,
      relaySecretConfigured: relaySecret().length > 0
    };
  });

  const authenticated = (path: string) => async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = relaySecret();
    if (!secret) {
      return reply.status(503).send({
        code: "POLYMARKET_RELAY_SECRET_MISSING",
        message: "Polymarket execution relay secret is not configured."
      });
    }
    const timestamp = headerValue(request.headers[polymarketRelayHeaders.timestamp]);
    const nonce = headerValue(request.headers[polymarketRelayHeaders.nonce]);
    const signature = headerValue(request.headers[polymarketRelayHeaders.signature]);
    if (!timestamp || !nonce || !signature) {
      return reply.status(401).send({
        code: "POLYMARKET_RELAY_AUTH_MISSING",
        message: "Polymarket execution relay authentication headers are missing."
      });
    }
    const verified = verifyPolymarketRelayRequest(secret, {
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
        code: "POLYMARKET_RELAY_AUTH_INVALID",
        message: "Polymarket execution relay authentication failed."
      });
    }
  };

  app.post("/internal/polymarket/v2/submit-order", {
    preHandler: authenticated("/internal/polymarket/v2/submit-order")
  }, async (request, reply) => {
    const order = parsePreparedOrder(request.body);
    return handleRelayCall(reply, async () => liveClient().submitOrder(order));
  });

  app.post("/internal/polymarket/v2/fill-state", {
    preHandler: authenticated("/internal/polymarket/v2/fill-state")
  }, async (request, reply) => {
    const venueOrderId = parseStringField(request.body, "venueOrderId");
    return handleRelayCall(reply, async () => liveClient().fetchFillState(venueOrderId));
  });

  app.post("/internal/polymarket/v2/cancel-order", {
    preHandler: authenticated("/internal/polymarket/v2/cancel-order")
  }, async (request, reply) => {
    const venueOrderId = parseStringField(request.body, "venueOrderId");
    return handleRelayCall(reply, async () => liveClient().cancelOrder(venueOrderId));
  });

  app.post("/internal/polymarket/v2/settlement-state", {
    preHandler: authenticated("/internal/polymarket/v2/settlement-state")
  }, async (request, reply) => {
    const fillOrOrderId = parseStringField(request.body, "fillOrOrderId");
    return handleRelayCall(reply, async () => liveClient().fetchSettlementState(fillOrOrderId));
  });

  return app;
};

const liveClient = (): SdkPolymarketClobV2LiveClient =>
  new SdkPolymarketClobV2LiveClient(buildPolymarketExecutionAdapterV2ConfigFromEnv({
    ...process.env,
    POLYMARKET_EXECUTION_SUBMIT_MODE: "direct"
  }));

const handleRelayCall = async <T>(
  reply: FastifyReply,
  operation: () => Promise<T>
): Promise<T | unknown> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PolymarketExecutionNotConfiguredError) {
      return reply.status(502).send({
        code: error.reasonCode,
        message: error.message,
        ...(safePolymarketRelayDiagnostics(error.diagnostics)
          ? { diagnostics: safePolymarketRelayDiagnostics(error.diagnostics) }
          : {})
      });
    }
    return reply.status(502).send({
      code: "POLYMARKET_RELAY_ERROR",
      message: error instanceof Error ? error.message : "Polymarket execution relay failed."
    });
  }
};

const parsePreparedOrder = (body: unknown): PreparedVenueOrder => {
  const record = asRecord(body);
  const order = asRecord(record.order);
  if (
    order.venue !== "POLYMARKET" ||
    typeof order.clientOrderId !== "string" ||
    typeof order.payload !== "object" ||
    order.payload === null
  ) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_RELAY_ORDER_INVALID",
      "Polymarket relay submit request is missing a prepared Polymarket order."
    );
  }
  return {
    venue: "POLYMARKET",
    clientOrderId: order.clientOrderId,
    payload: order.payload as Record<string, unknown>
  };
};

const parseStringField = (body: unknown, field: string): string => {
  const value = asRecord(body)[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PolymarketExecutionNotConfiguredError(
      "POLYMARKET_RELAY_REQUEST_INVALID",
      `Polymarket relay request is missing ${field}.`
    );
  }
  return value.trim();
};

const headerValue = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const safePolymarketRelayDiagnostics = (
  diagnostics: Record<string, unknown> | undefined
): Record<string, unknown> | null => {
  const postOrderDiagnostic = asRecord(diagnostics?.postOrderRejectionDiagnostic);
  if (Object.keys(postOrderDiagnostic).length === 0) {
    return null;
  }
  return {
    diagnosticArtifact: diagnostics?.diagnosticArtifact ?? null,
    rawVenueErrorCode: diagnostics?.rawVenueErrorCode ?? null,
    postOrderRejectionDiagnostic: postOrderDiagnostic
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

export const runPolymarketExecutionRelay = async (): Promise<void> => {
  loadDotenvFile();
  const app = buildPolymarketExecutionRelayServer();
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
  void runPolymarketExecutionRelay();
}
