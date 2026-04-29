import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { AdminAuthError, AdminAuthService } from "./admin-auth-service.js";

const loginBodySchema = z.object({
  email: z.string().email(),
  loginKey: z.string().min(24)
});

const magicLoginBodySchema = z.object({
  token: z.string().min(24)
});

const createMemberBodySchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).optional(),
  role: z.enum(["OWNER", "ADMIN"]).default("ADMIN"),
  sendInvite: z.boolean().default(true)
});

const memberParamsSchema = z.object({
  memberId: z.string().uuid()
});

const keyParamsSchema = z.object({
  keyId: z.string().uuid()
});

const createKeyBodySchema = z.object({
  expiresAt: z.string().datetime().optional()
});

export interface AdminAuthRouteDeps {
  adminAuthService: AdminAuthService;
  jwtTtlSeconds: number;
  ownerMiddleware: preHandlerHookHandler;
}

export const registerAdminAuthRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminAuthRouteDeps
): Promise<void> => {
  app.post("/admin/auth/login", async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }

    try {
      const result = await deps.adminAuthService.login(parsed.data.email, parsed.data.loginKey);
      return reply.send(buildJwtResponse(app, result.member, deps.jwtTtlSeconds));
    } catch (error) {
      return handleAdminAuthError(reply, error);
    }
  });

  app.post("/admin/auth/magic-login", async (request, reply) => {
    const parsed = magicLoginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }

    try {
      const result = await deps.adminAuthService.magicLogin(parsed.data.token);
      return reply.send(buildJwtResponse(app, result.member, deps.jwtTtlSeconds));
    } catch (error) {
      return handleAdminAuthError(reply, error);
    }
  });

  app.get("/admin/auth/me", { preHandler: adminMiddleware }, async (request, reply) => {
    return reply.send({
      member: {
        id: request.user.adminMemberId ?? request.user.userId,
        email: request.user.email ?? null,
        role: request.user.adminRole ?? "ADMIN"
      }
    });
  });

  app.get("/admin/auth/members", { preHandler: deps.ownerMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ members: await deps.adminAuthService.listMembers() });
    } catch (error) {
      return handleAdminAuthError(reply, error);
    }
  });

  app.post("/admin/auth/members", { preHandler: deps.ownerMiddleware }, async (request, reply) => {
    const parsed = createMemberBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const member = await deps.adminAuthService.createMember({
        email: parsed.data.email,
        role: parsed.data.role,
        displayName: parsed.data.displayName ?? null,
        actorId: request.user.adminMemberId ?? request.user.userId
      });
      if (!parsed.data.sendInvite) {
        return reply.status(201).send({ member: safeMember(member) });
      }
      const invite = await deps.adminAuthService.sendInvite({
        memberId: member.id,
        actorId: request.user.adminMemberId ?? request.user.userId
      });
      return reply.status(201).send({
        member: safeMember(member),
        invite: safeInvite(invite.invite)
      });
    } catch (error) {
      return handleAdminAuthError(reply, error);
    }
  });

  app.post("/admin/auth/members/:memberId/invite", { preHandler: deps.ownerMiddleware }, async (request, reply) => {
    const parsedParams = memberParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
    }
    try {
      const result = await deps.adminAuthService.sendInvite({
        memberId: parsedParams.data.memberId,
        actorId: request.user.adminMemberId ?? request.user.userId
      });
      return reply.status(201).send({
        member: safeMember(result.member),
        invite: safeInvite(result.invite)
      });
    } catch (error) {
      return handleAdminAuthError(reply, error);
    }
  });

  app.post("/admin/auth/members/:memberId/keys", { preHandler: deps.ownerMiddleware }, async (request, reply) => {
    const parsedParams = memberParamsSchema.safeParse(request.params);
    const parsedBody = createKeyBodySchema.safeParse(request.body ?? {});
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        details: parsedParams.success ? parsedBody.error?.flatten() : parsedParams.error.flatten()
      });
    }
    try {
      const key = await deps.adminAuthService.createKey({
        memberId: parsedParams.data.memberId,
        actorId: request.user.adminMemberId ?? request.user.userId,
        expiresAt: parsedBody.data.expiresAt ?? null
      });
      return reply.status(201).send(key);
    } catch (error) {
      return handleAdminAuthError(reply, error);
    }
  });

  app.post("/admin/auth/keys/:keyId/revoke", { preHandler: deps.ownerMiddleware }, async (request, reply) => {
    const parsed = keyParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({
        key: await deps.adminAuthService.revokeKey(parsed.data.keyId, request.user.adminMemberId ?? request.user.userId)
      });
    } catch (error) {
      return handleAdminAuthError(reply, error);
    }
  });

  app.post("/admin/auth/members/:memberId/disable", { preHandler: deps.ownerMiddleware }, async (request, reply) => {
    const parsed = memberParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({
        member: safeMember(await deps.adminAuthService.disableMember(parsed.data.memberId, request.user.adminMemberId ?? request.user.userId))
      });
    } catch (error) {
      return handleAdminAuthError(reply, error);
    }
  });
};

const safeMember = <T extends { createdAt: Date; updatedAt: Date }>(member: T): Omit<T, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
} => ({
  ...member,
  createdAt: member.createdAt.toISOString(),
  updatedAt: member.updatedAt.toISOString()
});

const safeInvite = <T extends {
  key: { createdAt: Date; expiresAt: Date | null };
  sent: boolean;
  expiresAt: Date;
  deliveryStatus: string;
}>(invite: T): {
  key: Record<string, unknown> & { createdAt: string; expiresAt: string | null };
  sent: boolean;
  expiresAt: string;
  deliveryStatus: string;
} => ({
  key: {
    ...(invite.key as Record<string, unknown>),
    createdAt: invite.key.createdAt.toISOString(),
    expiresAt: invite.key.expiresAt?.toISOString() ?? null
  },
  sent: invite.sent,
  expiresAt: invite.expiresAt.toISOString(),
  deliveryStatus: invite.deliveryStatus
});

const buildJwtResponse = (
  app: FastifyInstance,
  member: { id: string; email: string; role: string; createdAt: Date; updatedAt: Date },
  expiresInSeconds: number
) => {
  const token = app.jwt.sign(
    {
      userId: member.id,
      role: "ADMIN",
      email: member.email,
      adminMemberId: member.id,
      adminRole: member.role
    },
    { expiresIn: expiresInSeconds }
  );
  return {
    token,
    tokenType: "Bearer",
    expiresInSeconds,
    member: safeMember(member)
  };
};

const handleAdminAuthError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof AdminAuthError) {
    const status = error.code === "ADMIN_AUTH_NOT_CONFIGURED"
      ? 503
      : error.code === "ADMIN_EMAIL_NOT_CONFIGURED"
        ? 503
        : error.code === "ADMIN_EMAIL_DELIVERY_FAILED"
          ? 502
      : error.code.endsWith("_NOT_FOUND")
        ? 404
        : error.code === "EMAIL_DOMAIN_NOT_ALLOWED" || error.code === "CANNOT_DISABLE_SELF"
          ? 409
          : 401;
    return reply.status(status).send({ code: error.code, message: error.message });
  }
  return reply.status(500).send({ code: "ADMIN_AUTH_ERROR", message: "Admin auth request failed." });
};
