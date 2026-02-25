import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Logger } from "pino";
import type { RedisClient } from "../db/redis.js";
import type { LPKeyRecord } from "../db/repositories/lp-key-repository.js";

export interface LPAuthContext {
  lpId: string;
  keyId: string;
  lpKeyDbId: string;
}

export interface LPAuthenticatedRequest extends FastifyRequest {
  lpAuth: LPAuthContext;
}

export interface LPKeyLookupRepository {
  findByKeyId(keyId: string): Promise<LPKeyRecord | null>;
}

export interface LPAuthMiddlewareConfig {
  redisClient: RedisClient;
  lpKeyRepository: LPKeyLookupRepository;
  logger: Pick<Logger, "warn">;
  allowedClockSkewSeconds?: number;
  nonceTtlSeconds?: number;
}

const DEFAULT_CLOCK_SKEW_SECONDS = 300;
const DEFAULT_NONCE_TTL_SECONDS = 300;

const toTimestampSeconds = (rawTimestamp: string): number | null => {
  const parsed = Number(rawTimestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed > 1_000_000_000_000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
};

const serializeRequestBody = (body: unknown): string => {
  if (body === undefined || body === null) {
    return "";
  }

  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body);
};

const constantTimeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const createCanonicalPayload = (
  request: FastifyRequest,
  timestamp: string,
  nonce: string
): string => {
  const body = serializeRequestBody(request.body);
  return `${timestamp}.${nonce}.${request.method.toUpperCase()}.${request.url}.${body}`;
};

const sendAuthError = (
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
): FastifyReply => {
  return reply.status(statusCode).send({
    code,
    message
  });
};

export const createLPAuthMiddleware = (
  config: LPAuthMiddlewareConfig
): preHandlerHookHandler => {
  const allowedSkewSeconds = config.allowedClockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const nonceTtlSeconds = config.nonceTtlSeconds ?? DEFAULT_NONCE_TTL_SECONDS;

  return async (request, reply): Promise<void> => {
    const apiKey = request.headers["x-api-key"];
    const signature = request.headers["x-signature"];
    const timestampHeader = request.headers["x-timestamp"];
    const nonce = request.headers["x-nonce"];

    if (
      typeof apiKey !== "string" ||
      typeof signature !== "string" ||
      typeof timestampHeader !== "string" ||
      typeof nonce !== "string"
    ) {
      sendAuthError(reply, 401, "LP_AUTH_HEADERS_MISSING", "Missing LP authentication headers.");
      return;
    }

    const timestampSeconds = toTimestampSeconds(timestampHeader);
    if (timestampSeconds === null) {
      sendAuthError(reply, 401, "LP_AUTH_TIMESTAMP_INVALID", "Invalid LP authentication timestamp.");
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampSeconds) > allowedSkewSeconds) {
      sendAuthError(reply, 401, "LP_AUTH_TIMESTAMP_SKEW", "LP authentication timestamp out of range.");
      return;
    }

    const nonceKey = `lp:nonce:${apiKey}:${nonce}`;
    const nonceResult = await config.redisClient.set(nonceKey, "1", "EX", nonceTtlSeconds, "NX");
    if (nonceResult !== "OK") {
      sendAuthError(reply, 409, "LP_AUTH_NONCE_REPLAY", "LP authentication nonce already used.");
      return;
    }

    const keyRecord = await config.lpKeyRepository.findByKeyId(apiKey);
    if (!keyRecord || keyRecord.status.toUpperCase() !== "ACTIVE") {
      config.logger.warn({ apiKey }, "LP auth failed for unknown/inactive key.");
      sendAuthError(reply, 401, "LP_AUTH_KEY_INVALID", "Invalid LP API key.");
      return;
    }

    const payload = createCanonicalPayload(request, timestampHeader, nonce);
    const expectedSignature = createHmac("sha256", keyRecord.secret_hash).update(payload).digest("hex");
    if (!constantTimeEquals(expectedSignature, signature)) {
      sendAuthError(reply, 401, "LP_AUTH_SIGNATURE_INVALID", "Invalid LP authentication signature.");
      return;
    }

    (request as LPAuthenticatedRequest).lpAuth = {
      lpId: keyRecord.lp_id,
      keyId: keyRecord.key_id,
      lpKeyDbId: keyRecord.id
    };
  };
};
