import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifySessionJwtSignature } from "@turnkey/crypto";

const exchangeBodySchema = z.object({
  turnkeySessionToken: z.string().min(32),
  turnkeyUserId: z.string().min(1),
  turnkeyOrganizationId: z.string().min(1)
});

export interface TurnkeyAuthRouteDeps {
  jwtTtlSeconds: number;
  verifySessionJwt?: (sessionToken: string) => Promise<boolean>;
  provisionUserAccount?: (input: {
    userId: string;
    turnkeyUserId: string;
    turnkeyOrganizationId: string;
  }) => Promise<TurnkeyAccountSetupStatus>;
}

export interface TurnkeyAccountSetupStatus {
  status: "READY" | "ACTION_REQUIRED" | "UNAVAILABLE";
  walletCount: number;
  venueAccountCount: number;
  blockers: string[];
}

type TurnkeySessionPayload = {
  userId?: string;
  user_id?: string;
  organizationId?: string;
  organization_id?: string;
  exp?: number;
  expiry?: number;
};

export const registerTurnkeyAuthRoutes = async (
  app: FastifyInstance,
  deps: TurnkeyAuthRouteDeps
): Promise<void> => {
  const verifySessionJwt = deps.verifySessionJwt ?? verifySessionJwtSignature;

  app.post("/auth/turnkey/exchange", async (request, reply) => {
    const parsed = exchangeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }

    const { turnkeySessionToken, turnkeyUserId, turnkeyOrganizationId } = parsed.data;
    let payload: TurnkeySessionPayload;
    try {
      payload = decodeTurnkeySessionPayload(turnkeySessionToken);
    } catch {
      return reply.status(401).send({
        code: "INVALID_TURNKEY_SESSION",
        message: "Invalid Turnkey session."
      });
    }

    const payloadUserId = readTurnkeySessionUserId(payload);
    const payloadOrganizationId = readTurnkeySessionOrganizationId(payload);
    if (payloadUserId !== turnkeyUserId || payloadOrganizationId !== turnkeyOrganizationId) {
      return reply.status(401).send({
        code: "TURNKEY_SESSION_MISMATCH",
        message: "Turnkey session does not match the requested user."
      });
    }

    if (isTurnkeySessionExpired(payload)) {
      return reply.status(401).send({
        code: "TURNKEY_SESSION_EXPIRED",
        message: "Turnkey session has expired."
      });
    }

    const isValid = await verifySessionJwt(turnkeySessionToken).catch(() => false);
    if (!isValid) {
      return reply.status(401).send({
        code: "INVALID_TURNKEY_SESSION",
        message: "Invalid Turnkey session."
      });
    }

    const userId = lotusUserIdForTurnkeySession(turnkeyOrganizationId, turnkeyUserId);
    const userJwt = app.jwt.sign(
      {
        userId,
        role: "USER",
        turnkeyUserId,
        turnkeyOrganizationId
      },
      { expiresIn: deps.jwtTtlSeconds }
    );

    const accountSetup = await provisionUserAccount(deps, {
      userId,
      turnkeyUserId,
      turnkeyOrganizationId
    });

    return reply.send({
      userJwt,
      tokenType: "Bearer",
      expiresInSeconds: deps.jwtTtlSeconds,
      user: {
        userId,
        turnkeyUserId,
        turnkeyOrganizationId
      },
      accountSetup
    });
  });
};

const provisionUserAccount = async (
  deps: TurnkeyAuthRouteDeps,
  input: {
    userId: string;
    turnkeyUserId: string;
    turnkeyOrganizationId: string;
  }
): Promise<TurnkeyAccountSetupStatus> => {
  if (!deps.provisionUserAccount) {
    return {
      status: "UNAVAILABLE",
      walletCount: 0,
      venueAccountCount: 0,
      blockers: ["Automatic wallet provisioning is not configured."]
    };
  }
  try {
    return await deps.provisionUserAccount(input);
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      walletCount: 0,
      venueAccountCount: 0,
      blockers: [safeProvisioningBlocker(error)]
    };
  }
};

const safeProvisioningBlocker = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Account setup is temporarily unavailable.";
  if (/turnkey/i.test(message) || /wallet/i.test(message) || /venue/i.test(message)) {
    return message;
  }
  return "Account setup is temporarily unavailable.";
};

const decodeTurnkeySessionPayload = (sessionToken: string): TurnkeySessionPayload => {
  const parts = sessionToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed Turnkey session JWT.");
  }
  return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as TurnkeySessionPayload;
};

const isTurnkeySessionExpired = (payload: TurnkeySessionPayload, nowSeconds = Math.floor(Date.now() / 1000)): boolean => {
  const expiresAt = typeof payload.exp === "number"
    ? payload.exp
    : typeof payload.expiry === "number"
      ? payload.expiry
      : null;
  return expiresAt !== null && expiresAt <= nowSeconds;
};

const readTurnkeySessionUserId = (payload: TurnkeySessionPayload): string | undefined =>
  payload.user_id ?? payload.userId;

const readTurnkeySessionOrganizationId = (payload: TurnkeySessionPayload): string | undefined =>
  payload.organization_id ?? payload.organizationId;

const lotusUserIdForTurnkeySession = (organizationId: string, userId: string): string => {
  const stableId = createHash("sha256")
    .update(`${organizationId}:${userId}`)
    .digest("hex")
    .slice(0, 32);
  return `turnkey_${stableId}`;
};
