import { createHmac, randomUUID } from "node:crypto";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it } from "vitest";
import type { AdminEmailDelivery, AdminMagicLinkEmailInput } from "../src/api/admin/admin-email-delivery.js";
import {
  FallbackAdminAuthRateLimiter,
  InMemoryAdminAuthRateLimiter,
  RedisAdminAuthRateLimiter,
  type AdminAuthRateLimiter,
  type AdminAuthRateLimitInput,
  type AdminAuthRateLimitResult
} from "../src/api/admin/admin-auth-rate-limiter.js";
import { AdminAuthService } from "../src/api/admin/admin-auth-service.js";
import { registerAdminAuthRoutes } from "../src/api/admin/admin-auth.routes.js";
import { createAdminAuthMiddleware, createAdminOwnerAuthMiddleware } from "../src/api/user-auth-middleware.js";
import type { RedisClient } from "../src/db/redis.js";
import type {
  AdminAuthKey,
  AdminAuthRepository,
  AdminMember,
  CreateAdminAuthKeyInput,
  CreateAdminMemberInput
} from "../src/repositories/admin-auth.repository.js";

class FakeAdminAuthRepository {
  public readonly members = new Map<string, AdminMember>();
  public readonly keys = new Map<string, AdminAuthKey>();
  public readonly auditEvents: Array<{
    actorAdminMemberId?: string | null;
    eventType: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }> = [];

  public async findMemberByEmail(email: string): Promise<AdminMember | null> {
    return [...this.members.values()].find((member) => member.email === email.toLowerCase()) ?? null;
  }

  public async findMemberById(id: string): Promise<AdminMember | null> {
    return this.members.get(id) ?? null;
  }

  public async listMembers(): Promise<AdminMember[]> {
    return [...this.members.values()];
  }

  public async upsertMember(input: CreateAdminMemberInput): Promise<AdminMember> {
    const existing = await this.findMemberByEmail(input.email);
    const member: AdminMember = {
      id: existing?.id ?? randomUUID(),
      email: input.email.toLowerCase(),
      displayName: input.displayName ?? null,
      role: input.role,
      status: "ACTIVE",
      createdBy: input.createdBy ?? null,
      createdAt: existing?.createdAt ?? new Date("2026-04-29T00:00:00.000Z"),
      updatedAt: new Date("2026-04-29T00:00:00.000Z")
    };
    this.members.set(member.id, member);
    return member;
  }

  public async disableMember(id: string): Promise<AdminMember | null> {
    const member = this.members.get(id);
    if (!member) return null;
    const disabled = { ...member, status: "DISABLED" as const };
    this.members.set(id, disabled);
    return disabled;
  }

  public async createKey(input: CreateAdminAuthKeyInput): Promise<AdminAuthKey> {
    const key: AdminAuthKey = {
      id: randomUUID(),
      adminMemberId: input.adminMemberId,
      keyId: input.keyId,
      keyHash: input.keyHash,
      keyType: input.keyType ?? "LOGIN_KEY",
      status: "ACTIVE",
      lastUsedAt: null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdBy: input.createdBy ?? null,
      revokedBy: null,
      createdAt: new Date("2026-04-29T00:00:00.000Z"),
      revokedAt: null
    };
    this.keys.set(key.id, key);
    return key;
  }

  public async findKeyByKeyId(keyId: string): Promise<AdminAuthKey | null> {
    return [...this.keys.values()].find((key) => key.keyId === keyId) ?? null;
  }

  public async listKeysForMember(adminMemberId: string): Promise<AdminAuthKey[]> {
    return [...this.keys.values()].filter((key) => key.adminMemberId === adminMemberId);
  }

  public async markKeyUsed(id: string): Promise<void> {
    const key = this.keys.get(id);
    if (key) this.keys.set(id, { ...key, lastUsedAt: new Date("2026-04-29T00:01:00.000Z") });
  }

  public async revokeKey(id: string, actorId: string): Promise<AdminAuthKey | null> {
    const key = this.keys.get(id);
    if (!key) return null;
    const revoked = { ...key, status: "REVOKED" as const, revokedBy: actorId, revokedAt: new Date("2026-04-29T00:02:00.000Z") };
    this.keys.set(id, revoked);
    return revoked;
  }

  public async createAuditEvent(input: {
    actorAdminMemberId?: string | null;
    eventType: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.auditEvents.push(input);
  }
}

class FakeAdminEmailDelivery implements AdminEmailDelivery {
  public readonly sent: AdminMagicLinkEmailInput[] = [];

  public constructor(private readonly fail = false) {}

  public async sendAdminMagicLink(input: AdminMagicLinkEmailInput): Promise<{ providerMessageId: string | null }> {
    if (this.fail) {
      throw new Error("delivery failed");
    }
    this.sent.push(input);
    return { providerMessageId: "fake-message-id" };
  }
}

class FakeAdminAuthRateLimiter implements AdminAuthRateLimiter {
  public readonly consumed: AdminAuthRateLimitInput[] = [];

  public constructor(private readonly result: AdminAuthRateLimitResult = { allowed: true }) {}

  public async consume(input: AdminAuthRateLimitInput): Promise<AdminAuthRateLimitResult> {
    this.consumed.push(input);
    return this.result;
  }
}

const buildFallbackRateLimiterWithRedis = (redis: Partial<RedisClient>): AdminAuthRateLimiter => {
  const limits = {
    requestLoginLink: { windowSeconds: 900, maxPerEmail: 3, maxPerIp: 20 },
    manualLogin: { windowSeconds: 900, maxPerEmail: 5, maxPerIp: 30 }
  };
  return new FallbackAdminAuthRateLimiter(
    new RedisAdminAuthRateLimiter({
      redis: redis as RedisClient,
      logger: { warn: () => undefined },
      keyPepper: "admin-test-pepper-at-least-thirty-two-characters",
      operationTimeoutMs: 5,
      ...limits
    }),
    new InMemoryAdminAuthRateLimiter({
      keyPepper: "admin-test-pepper-at-least-thirty-two-characters",
      ...limits
    })
  );
};

const buildApp = async (options: {
  emailDeliveryFails?: boolean;
  rateLimiter?: AdminAuthRateLimiter;
} = {}) => {
  const repository = new FakeAdminAuthRepository();
  const emailDelivery = new FakeAdminEmailDelivery(options.emailDeliveryFails ?? false);
  const service = new AdminAuthService(repository as unknown as AdminAuthRepository, {
    keyPepper: "admin-test-pepper-at-least-thirty-two-characters",
    allowedEmailDomains: "lotus.example",
    adminFrontendBaseUrl: "https://admin.lotus.example",
    magicLinkTtlSeconds: 900
  }, emailDelivery);
  const owner = await service.createMember({
    email: "owner@lotus.example",
    role: "OWNER",
    actorId: null
  });
  const ownerKey = await service.createKey({ memberId: owner.id, actorId: owner.id });

  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret-at-least-thirty-two-characters" });
  await registerAdminAuthRoutes(app, createAdminAuthMiddleware(), {
    adminAuthService: service,
    rateLimiter: options.rateLimiter,
    ownerMiddleware: createAdminOwnerAuthMiddleware(),
    jwtTtlSeconds: 3600
  });
  return { app, repository, emailDelivery, owner, ownerKey };
};

const buildAppWithoutEmailDelivery = async () => {
  const repository = new FakeAdminAuthRepository();
  const service = new AdminAuthService(repository as unknown as AdminAuthRepository, {
    keyPepper: "admin-test-pepper-at-least-thirty-two-characters",
    allowedEmailDomains: "lotus.example"
  });
  const owner = await service.createMember({
    email: "owner@lotus.example",
    role: "OWNER",
    actorId: null
  });
  const ownerKey = await service.createKey({ memberId: owner.id, actorId: owner.id });

  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret-at-least-thirty-two-characters" });
  await registerAdminAuthRoutes(app, createAdminAuthMiddleware(), {
    adminAuthService: service,
    ownerMiddleware: createAdminOwnerAuthMiddleware(),
    jwtTtlSeconds: 3600
  });
  return { app, ownerKey };
};

describe("admin auth routes", () => {
  it("logs in with an owner-generated key and never returns key hashes", async () => {
    const { app, ownerKey } = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: {
        email: "owner@lotus.example",
        loginKey: ownerKey.loginKey
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tokenType: "Bearer",
      expiresInSeconds: 3600,
      member: { email: "owner@lotus.example", role: "OWNER" }
    });
    expect(response.body).not.toContain("keyHash");
    await app.close();
  });

  it("rejects non-work-domain login and revoked keys", async () => {
    const { app, repository, owner, ownerKey } = await buildApp();
    const badDomain = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "owner@gmail.com", loginKey: ownerKey.loginKey }
    });
    expect(badDomain.statusCode).toBe(409);

    await repository.revokeKey(ownerKey.key.id, owner.id);
    const revoked = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "owner@lotus.example", loginKey: ownerKey.loginKey }
    });
    expect(revoked.statusCode).toBe(401);
    expect(repository.auditEvents.map((event) => event.eventType)).toContain("ADMIN_AUTH_LOGIN_FAILED");
    await app.close();
  });

  it("rate limits manual break-glass login attempts without exposing account state", async () => {
    const rateLimiter = new FakeAdminAuthRateLimiter({ allowed: false, reason: "IP_LIMIT" });
    const { app, repository, ownerKey } = await buildApp({ rateLimiter });

    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: {
        email: "owner@lotus.example",
        loginKey: ownerKey.loginKey
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(rateLimiter.consumed[0]).toMatchObject({ scope: "manual_login", email: "owner@lotus.example" });
    expect(repository.auditEvents.map((event) => event.eventType)).toContain("ADMIN_AUTH_LOGIN_RATE_LIMITED");
    await app.close();
  });

  it("lets only owners create members and keys", async () => {
    const { app, ownerKey } = await buildApp();
    const login = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "owner@lotus.example", loginKey: ownerKey.loginKey }
    });
    const ownerToken = login.json().token;
    const createMember = await app.inject({
      method: "POST",
      url: "/admin/auth/members",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "ops@lotus.example", role: "ADMIN", sendInvite: false }
    });
    expect(createMember.statusCode).toBe(201);
    const memberId = createMember.json().member.id;

    const createKey = await app.inject({
      method: "POST",
      url: `/admin/auth/members/${memberId}/keys`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {}
    });
    expect(createKey.statusCode).toBe(201);
    expect(createKey.json().loginKey).toMatch(/^lotus_admin_/);
    expect(createKey.body).not.toContain("keyHash");

    const adminToken = app.jwt.sign({
      userId: memberId,
      role: "ADMIN",
      adminMemberId: memberId,
      adminRole: "ADMIN",
      email: "ops@lotus.example"
    });
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/auth/members",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: "second@lotus.example", role: "ADMIN" }
    });
    expect(forbidden.statusCode).toBe(403);
    await app.close();
  });

  it("fails closed when invite delivery is not configured", async () => {
    const { app, ownerKey } = await buildAppWithoutEmailDelivery();
    const login = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "owner@lotus.example", loginKey: ownerKey.loginKey }
    });
    const ownerToken = login.json().token;
    const createMember = await app.inject({
      method: "POST",
      url: "/admin/auth/members",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "no-delivery@lotus.example", role: "ADMIN" }
    });
    expect(createMember.statusCode).toBe(503);
    expect(createMember.json()).toMatchObject({ code: "ADMIN_EMAIL_NOT_CONFIGURED" });
    await app.close();
  });

  it("creates a member and emails a magic login link without returning plaintext credentials", async () => {
    const { app, emailDelivery, ownerKey } = await buildApp();
    const login = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "owner@lotus.example", loginKey: ownerKey.loginKey }
    });
    const ownerToken = login.json().token;
    const createMember = await app.inject({
      method: "POST",
      url: "/admin/auth/members",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "magic@lotus.example", role: "ADMIN" }
    });
    expect(createMember.statusCode).toBe(201);
    expect(createMember.json()).toMatchObject({
      member: { email: "magic@lotus.example", role: "ADMIN" },
      invite: { sent: true, deliveryStatus: "SENT" }
    });
    expect(createMember.body).not.toContain("loginKey");
    expect(createMember.body).not.toContain("lotus_magic_");
    expect(emailDelivery.sent).toHaveLength(1);
    expect(emailDelivery.sent[0]?.magicLink).toContain("/login?token=lotus_magic_");
    await app.close();
  });

  it("sends a self-service magic login link with an enumeration-safe response", async () => {
    const { app, emailDelivery, repository } = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/request-login-link",
      payload: { email: "owner@lotus.example" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      message: "If this email is authorized, a login link has been sent."
    });
    expect(response.body).not.toContain("lotus_magic_");
    expect(response.body).not.toContain("keyHash");
    expect(emailDelivery.sent).toHaveLength(1);
    expect(emailDelivery.sent[0]?.magicLink).toContain("/login?token=lotus_magic_");
    expect([...repository.keys.values()]).toEqual([
      expect.objectContaining({ keyType: "LOGIN_KEY" }),
      expect.objectContaining({ keyType: "MAGIC_LINK", status: "ACTIVE" })
    ]);
    expect(repository.auditEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "ADMIN_LOGIN_LINK_REQUESTED",
      "ADMIN_MAGIC_LINK_CREATED",
      "ADMIN_MAGIC_LINK_SENT"
    ]));
    await app.close();
  });

  it("returns the same self-service response for unknown, disabled, and disallowed emails without sending", async () => {
    const { app, emailDelivery, repository, owner } = await buildApp();
    const disabled = await repository.upsertMember({
      email: "disabled@lotus.example",
      role: "ADMIN",
      createdBy: owner.id
    });
    await repository.disableMember(disabled.id);
    const keyCountBefore = repository.keys.size;

    for (const email of ["missing@lotus.example", "disabled@lotus.example", "outside@example.com"]) {
      const response = await app.inject({
        method: "POST",
        url: "/admin/auth/request-login-link",
        payload: { email }
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        message: "If this email is authorized, a login link has been sent."
      });
    }

    expect(emailDelivery.sent).toHaveLength(0);
    expect(repository.keys.size).toBe(keyCountBefore);
    expect(repository.auditEvents.map((event) => event.eventType)).toContain("ADMIN_LOGIN_LINK_NOT_SENT");
    expect(repository.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "ADMIN_LOGIN_LINK_NOT_SENT",
        metadata: expect.objectContaining({ reason: "EMAIL_DOMAIN_NOT_ALLOWED" })
      })
    ]));
    await app.close();
  });

  it("returns the same self-service response when rate limited and sends no email", async () => {
    const rateLimiter = new FakeAdminAuthRateLimiter({ allowed: false, reason: "EMAIL_LIMIT" });
    const { app, emailDelivery, repository } = await buildApp({ rateLimiter });

    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/request-login-link",
      payload: { email: "owner@lotus.example" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      message: "If this email is authorized, a login link has been sent."
    });
    expect(emailDelivery.sent).toHaveLength(0);
    expect(rateLimiter.consumed[0]).toMatchObject({ scope: "request_login_link", email: "owner@lotus.example" });
    expect(repository.auditEvents.map((event) => event.eventType)).toContain("ADMIN_LOGIN_LINK_RATE_LIMITED");
    await app.close();
  });

  it("falls back in memory when Redis rate-limit storage is unavailable", async () => {
    const rateLimiter = buildFallbackRateLimiterWithRedis({
      incrbyfloat: async () => {
        throw new Error("redis unavailable");
      },
      expire: async () => 0
    });
    const { app, emailDelivery, repository } = await buildApp({ rateLimiter });

    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/request-login-link",
      payload: { email: "owner@lotus.example" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      message: "If this email is authorized, a login link has been sent."
    });
    expect(emailDelivery.sent).toHaveLength(1);
    expect(repository.auditEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "ADMIN_LOGIN_LINK_REQUESTED",
      "ADMIN_MAGIC_LINK_CREATED",
      "ADMIN_MAGIC_LINK_SENT"
    ]));
    await app.close();
  });

  it("bounds Redis rate-limit timeouts and still returns the generic response quickly", async () => {
    const rateLimiter = buildFallbackRateLimiterWithRedis({
      incrbyfloat: async () => new Promise<string>(() => undefined),
      expire: async () => 0
    });
    const { app, emailDelivery } = await buildApp({ rateLimiter });
    const startedAt = Date.now();

    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/request-login-link",
      payload: { email: "owner@lotus.example" }
    });

    expect(response.statusCode).toBe(202);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(emailDelivery.sent).toHaveLength(1);
    await app.close();
  });

  it("returns the same self-service response when email delivery fails", async () => {
    const { app, emailDelivery, repository } = await buildApp({ emailDeliveryFails: true });

    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/request-login-link",
      payload: { email: "owner@lotus.example" }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      message: "If this email is authorized, a login link has been sent."
    });
    expect(emailDelivery.sent).toHaveLength(0);
    expect(repository.auditEvents.map((event) => event.eventType)).toContain("ADMIN_MAGIC_LINK_SEND_FAILED");
    expect(repository.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "ADMIN_MAGIC_LINK_SEND_FAILED",
        metadata: expect.not.objectContaining({
          providerMessageId: expect.any(String)
        })
      })
    ]));
    await app.close();
  });

  it("exchanges a magic link once and rejects reuse", async () => {
    const { app, emailDelivery, ownerKey } = await buildApp();
    const login = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "owner@lotus.example", loginKey: ownerKey.loginKey }
    });
    const ownerToken = login.json().token;
    const createMember = await app.inject({
      method: "POST",
      url: "/admin/auth/members",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "once@lotus.example", role: "ADMIN" }
    });
    expect(createMember.statusCode).toBe(201);
    const magicToken = new URL(emailDelivery.sent[0]!.magicLink).searchParams.get("token");
    expect(magicToken).toMatch(/^lotus_magic_/);

    const first = await app.inject({
      method: "POST",
      url: "/admin/auth/magic-login",
      payload: { token: magicToken }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      tokenType: "Bearer",
      member: { email: "once@lotus.example", role: "ADMIN" }
    });

    const second = await app.inject({
      method: "POST",
      url: "/admin/auth/magic-login",
      payload: { token: magicToken }
    });
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("rejects expired magic links", async () => {
    const { app, repository, owner } = await buildApp();
    const member = await repository.upsertMember({
      email: "expired@lotus.example",
      role: "ADMIN",
      createdBy: owner.id
    });
    const keyId = "1234567890abcdef12";
    const token = `lotus_magic_${keyId}_expiredSecretExpiredSecretExpiredSecret`;
    await repository.createKey({
      adminMemberId: member.id,
      keyId,
      keyHash: createHmac("sha256", "admin-test-pepper-at-least-thirty-two-characters").update(token).digest("hex"),
      keyType: "MAGIC_LINK",
      expiresAt: "2026-04-28T00:00:00.000Z",
      createdBy: owner.id
    });
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/magic-login",
      payload: { token }
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
