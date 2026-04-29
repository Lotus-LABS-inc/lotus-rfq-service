import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  AdminAuthKey,
  AdminAuthRepository,
  AdminMember,
  AdminMemberRole
} from "../../repositories/admin-auth.repository.js";
import type { AdminEmailDelivery } from "./admin-email-delivery.js";

export class AdminAuthError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export interface AdminAuthServiceConfig {
  keyPepper: string | undefined;
  allowedEmailDomains?: string | undefined;
  adminFrontendBaseUrl?: string | undefined;
  magicLinkTtlSeconds?: number | undefined;
}

export interface AdminLoginResult {
  member: AdminMember;
  key: AdminAuthKey;
}

export interface AdminKeyCreatedResult {
  key: Omit<AdminAuthKey, "keyHash">;
  loginKey: string;
}

export interface AdminInviteResult {
  member: AdminMember;
  invite: {
    key: Omit<AdminAuthKey, "keyHash">;
    sent: boolean;
    expiresAt: Date;
    deliveryStatus: "SENT";
  };
}

export class AdminAuthService {
  private readonly allowedDomains: string[];

  public constructor(
    private readonly repository: AdminAuthRepository,
    private readonly config: AdminAuthServiceConfig,
    private readonly emailDelivery: AdminEmailDelivery | null = null
  ) {
    this.allowedDomains = parseAllowedDomains(config.allowedEmailDomains);
  }

  public async login(email: string, loginKey: string): Promise<AdminLoginResult> {
    const normalizedEmail = normalizeEmail(email);
    this.assertWorkEmail(normalizedEmail);
    this.assertPepperConfigured();

    const parsedKey = parseLoginKey(loginKey);
    if (!parsedKey) {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }

    const [member, key] = await Promise.all([
      this.repository.findMemberByEmail(normalizedEmail),
      this.repository.findKeyByKeyId(parsedKey.keyId)
    ]);
    if (!member || member.status !== "ACTIVE" || !key || key.status !== "ACTIVE" || key.keyType !== "LOGIN_KEY") {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }
    if (key.adminMemberId !== member.id) {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }
    if (!constantTimeEqual(hashLoginKey(loginKey, this.config.keyPepper!), key.keyHash)) {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }

    await this.repository.markKeyUsed(key.id);
    await this.repository.createAuditEvent({
      actorAdminMemberId: member.id,
      eventType: "ADMIN_AUTH_LOGIN",
      targetType: "admin_member",
      targetId: member.id,
      metadata: { keyId: key.keyId }
    });
    return { member, key };
  }

  public async magicLogin(magicToken: string): Promise<AdminLoginResult> {
    this.assertPepperConfigured();
    const parsedKey = parseMagicToken(magicToken);
    if (!parsedKey) {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }

    const key = await this.repository.findKeyByKeyId(parsedKey.keyId);
    if (!key || key.status !== "ACTIVE" || key.keyType !== "MAGIC_LINK") {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }
    if (key.lastUsedAt) {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }
    if (!constantTimeEqual(hashLoginKey(magicToken, this.config.keyPepper!), key.keyHash)) {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }

    const member = await this.repository.findMemberById(key.adminMemberId);
    if (!member || member.status !== "ACTIVE") {
      throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid admin credentials.");
    }
    this.assertWorkEmail(member.email);

    await this.repository.markKeyUsed(key.id);
    await this.repository.createAuditEvent({
      actorAdminMemberId: member.id,
      eventType: "ADMIN_MAGIC_LOGIN",
      targetType: "admin_member",
      targetId: member.id,
      metadata: { keyId: key.keyId }
    });
    return { member, key };
  }

  public async listMembers(): Promise<Array<AdminMember & { keys: Array<Omit<AdminAuthKey, "keyHash">> }>> {
    const members = await this.repository.listMembers(100);
    return Promise.all(members.map(async (member) => ({
      ...member,
      keys: (await this.repository.listKeysForMember(member.id)).map(safeKey)
    })));
  }

  public async createMember(input: {
    email: string;
    displayName?: string | null;
    role: AdminMemberRole;
    actorId: string | null;
  }): Promise<AdminMember> {
    const email = normalizeEmail(input.email);
    this.assertWorkEmail(email);
    const member = await this.repository.upsertMember({
      email,
      displayName: input.displayName ?? null,
      role: input.role,
      createdBy: input.actorId
    });
    await this.repository.createAuditEvent({
      actorAdminMemberId: input.actorId,
      eventType: "ADMIN_MEMBER_UPSERTED",
      targetType: "admin_member",
      targetId: member.id,
      metadata: { email: member.email, role: member.role }
    });
    return member;
  }

  public async createKey(input: {
    memberId: string;
    actorId: string;
    expiresAt?: string | null;
  }): Promise<AdminKeyCreatedResult> {
    this.assertPepperConfigured();
    const member = await this.repository.findMemberById(input.memberId);
    if (!member || member.status !== "ACTIVE") {
      throw new AdminAuthError("ADMIN_MEMBER_NOT_FOUND", "Admin member not found.");
    }
    const generated = generateLoginKey();
    const key = await this.repository.createKey({
      adminMemberId: member.id,
      keyId: generated.keyId,
      keyHash: hashLoginKey(generated.loginKey, this.config.keyPepper!),
      keyType: "LOGIN_KEY",
      expiresAt: input.expiresAt ?? null,
      createdBy: input.actorId
    });
    await this.repository.createAuditEvent({
      actorAdminMemberId: input.actorId,
      eventType: "ADMIN_AUTH_KEY_CREATED",
      targetType: "admin_auth_key",
      targetId: key.id,
      metadata: { adminMemberId: member.id, keyId: key.keyId }
    });
    return {
      key: safeKey(key),
      loginKey: generated.loginKey
    };
  }

  public async sendInvite(input: {
    memberId: string;
    actorId: string;
  }): Promise<AdminInviteResult> {
    this.assertPepperConfigured();
    this.assertInviteDeliveryConfigured();

    const member = await this.repository.findMemberById(input.memberId);
    if (!member || member.status !== "ACTIVE") {
      throw new AdminAuthError("ADMIN_MEMBER_NOT_FOUND", "Admin member not found.");
    }
    this.assertWorkEmail(member.email);

    const generated = generateMagicToken();
    const expiresAt = new Date(Date.now() + resolveMagicLinkTtlSeconds(this.config.magicLinkTtlSeconds) * 1000);
    const key = await this.repository.createKey({
      adminMemberId: member.id,
      keyId: generated.keyId,
      keyHash: hashLoginKey(generated.magicToken, this.config.keyPepper!),
      keyType: "MAGIC_LINK",
      expiresAt: expiresAt.toISOString(),
      createdBy: input.actorId
    });

    await this.repository.createAuditEvent({
      actorAdminMemberId: input.actorId,
      eventType: "ADMIN_MAGIC_LINK_CREATED",
      targetType: "admin_auth_key",
      targetId: key.id,
      metadata: { adminMemberId: member.id, keyId: key.keyId, expiresAt: expiresAt.toISOString() }
    });

    try {
      const delivery = await this.emailDelivery!.sendAdminMagicLink({
        to: member.email,
        magicLink: buildMagicLink(this.config.adminFrontendBaseUrl!, generated.magicToken),
        expiresAt
      });
      await this.repository.createAuditEvent({
        actorAdminMemberId: input.actorId,
        eventType: "ADMIN_MAGIC_LINK_SENT",
        targetType: "admin_auth_key",
        targetId: key.id,
        metadata: {
          adminMemberId: member.id,
          keyId: key.keyId,
          providerMessageId: delivery.providerMessageId
        }
      });
    } catch (error) {
      await this.repository.createAuditEvent({
        actorAdminMemberId: input.actorId,
        eventType: "ADMIN_MAGIC_LINK_SEND_FAILED",
        targetType: "admin_auth_key",
        targetId: key.id,
        metadata: {
          adminMemberId: member.id,
          keyId: key.keyId,
          reason: error instanceof Error ? error.message : "unknown"
        }
      });
      throw new AdminAuthError("ADMIN_EMAIL_DELIVERY_FAILED", "Admin invite email delivery failed.");
    }

    return {
      member,
      invite: {
        key: safeKey(key),
        sent: true,
        expiresAt,
        deliveryStatus: "SENT"
      }
    };
  }

  public async revokeKey(keyId: string, actorId: string): Promise<Omit<AdminAuthKey, "keyHash">> {
    const key = await this.repository.revokeKey(keyId, actorId);
    if (!key) {
      throw new AdminAuthError("ADMIN_AUTH_KEY_NOT_FOUND", "Admin auth key not found.");
    }
    return safeKey(key);
  }

  public async disableMember(memberId: string, actorId: string): Promise<AdminMember> {
    if (memberId === actorId) {
      throw new AdminAuthError("CANNOT_DISABLE_SELF", "Owner cannot disable their own admin member from this route.");
    }
    const member = await this.repository.disableMember(memberId, actorId);
    if (!member) {
      throw new AdminAuthError("ADMIN_MEMBER_NOT_FOUND", "Admin member not found.");
    }
    return member;
  }

  private assertPepperConfigured(): void {
    if (!this.config.keyPepper || this.config.keyPepper.length < 32) {
      throw new AdminAuthError("ADMIN_AUTH_NOT_CONFIGURED", "ADMIN_AUTH_KEY_PEPPER must be configured.");
    }
  }

  private assertInviteDeliveryConfigured(): void {
    if (!this.emailDelivery || !this.config.adminFrontendBaseUrl) {
      throw new AdminAuthError("ADMIN_EMAIL_NOT_CONFIGURED", "Admin invite email delivery is not configured.");
    }
  }

  private assertWorkEmail(email: string): void {
    if (this.allowedDomains.length === 0) {
      return;
    }
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || !this.allowedDomains.includes(domain)) {
      throw new AdminAuthError("EMAIL_DOMAIN_NOT_ALLOWED", "Admin email domain is not allowed.");
    }
  }
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const parseAllowedDomains = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

const generateLoginKey = (): { keyId: string; loginKey: string } => {
  const keyId = randomBytes(9).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return {
    keyId,
    loginKey: `lotus_admin_${keyId}_${secret}`
  };
};

const generateMagicToken = (): { keyId: string; magicToken: string } => {
  const keyId = randomBytes(9).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return {
    keyId,
    magicToken: `lotus_magic_${keyId}_${secret}`
  };
};

const parseLoginKey = (loginKey: string): { keyId: string } | null => {
  const match = /^lotus_admin_([a-f0-9]{18})_[A-Za-z0-9_-]{32,}$/.exec(loginKey);
  return match?.[1] ? { keyId: match[1] } : null;
};

const parseMagicToken = (magicToken: string): { keyId: string } | null => {
  const match = /^lotus_magic_([a-f0-9]{18})_[A-Za-z0-9_-]{32,}$/.exec(magicToken);
  return match?.[1] ? { keyId: match[1] } : null;
};

const hashLoginKey = (loginKey: string, pepper: string): string =>
  createHmac("sha256", pepper).update(loginKey).digest("hex");

const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const safeKey = (key: AdminAuthKey): Omit<AdminAuthKey, "keyHash"> => {
  const { keyHash: _keyHash, ...rest } = key;
  return rest;
};

const resolveMagicLinkTtlSeconds = (value: number | undefined): number =>
  Number.isFinite(value) && value ? Math.max(60, Math.min(3600, Math.trunc(value))) : 900;

const buildMagicLink = (adminFrontendBaseUrl: string, magicToken: string): string => {
  const url = new URL("/admin-access/magic", adminFrontendBaseUrl);
  url.searchParams.set("token", magicToken);
  return url.toString();
};
