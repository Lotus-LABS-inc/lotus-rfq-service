import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it } from "vitest";
import { AdminAuthService } from "../src/api/admin/admin-auth-service.js";
import { registerAdminAuthRoutes } from "../src/api/admin/admin-auth.routes.js";
import { createAdminAuthMiddleware, createAdminOwnerAuthMiddleware } from "../src/api/user-auth-middleware.js";
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

  public async createAuditEvent(): Promise<void> {}
}

const buildApp = async () => {
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
  return { app, repository, owner, ownerKey };
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
      payload: { email: "ops@lotus.example", role: "ADMIN" }
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
});
