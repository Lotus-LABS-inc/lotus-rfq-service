export interface AdminMagicLinkEmailInput {
  to: string;
  magicLink: string;
  expiresAt: Date;
}

export interface AdminEmailDeliveryResult {
  providerMessageId: string | null;
}

export interface AdminEmailDelivery {
  sendAdminMagicLink(input: AdminMagicLinkEmailInput): Promise<AdminEmailDeliveryResult>;
}

export interface ResendAdminEmailDeliveryConfig {
  apiKey: string;
  from: string;
}

export class ResendAdminEmailDelivery implements AdminEmailDelivery {
  public constructor(private readonly config: ResendAdminEmailDeliveryConfig) {}

  public async sendAdminMagicLink(input: AdminMagicLinkEmailInput): Promise<AdminEmailDeliveryResult> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.to],
        subject: "Your Lotus admin login link",
        text: buildTextBody(input),
        html: buildHtmlBody(input)
      })
    });

    if (!response.ok) {
      throw new Error(`resend_email_failed:${response.status}`);
    }

    const payload = await response.json().catch(() => ({})) as { id?: string };
    return { providerMessageId: payload.id ?? null };
  }
}

export const buildAdminEmailDeliveryFromEnv = (env: NodeJS.ProcessEnv): AdminEmailDelivery | null => {
  if ((env.ADMIN_EMAIL_PROVIDER ?? "").trim().toUpperCase() !== "RESEND") {
    return null;
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.ADMIN_EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    return null;
  }

  return new ResendAdminEmailDelivery({ apiKey, from });
};

const buildTextBody = (input: AdminMagicLinkEmailInput): string =>
  [
    "Use this one-time link to sign in to Lotus Admin:",
    input.magicLink,
    "",
    `This link expires at ${input.expiresAt.toISOString()}.`,
    "If you did not expect this email, ignore it."
  ].join("\n");

const buildHtmlBody = (input: AdminMagicLinkEmailInput): string =>
  [
    "<p>Use this one-time link to sign in to Lotus Admin:</p>",
    `<p><a href="${escapeHtml(input.magicLink)}">Sign in to Lotus Admin</a></p>`,
    `<p>This link expires at ${escapeHtml(input.expiresAt.toISOString())}.</p>`,
    "<p>If you did not expect this email, ignore it.</p>"
  ].join("");

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
