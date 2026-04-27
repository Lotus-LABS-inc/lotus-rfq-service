export type LimitlessSdkAuthDryRunStatus = "COMPLETED" | "FAILED" | "REFUSED_CONFIG_INCOMPLETE";

export interface LimitlessSdkHttpClientConstructor {
  new(config: {
    baseURL: string;
    timeout: number;
    hmacCredentials?: { tokenId: string; secret: string } | undefined;
    additionalHeaders?: Record<string, string> | undefined;
  }): LimitlessSdkHttpClientInstance;
}

export interface LimitlessSdkHttpClientInstance {
  get?<T = unknown>(url: string): Promise<T>;
}

export interface LimitlessSdkPortfolioFetcherConstructor {
  new(httpClient: unknown): {
    getPositions(): Promise<unknown>;
    getUserHistory(page?: number, limit?: number): Promise<unknown>;
    getProfile(address: string): Promise<unknown>;
  };
}

export interface LimitlessSdkAuthDryRunArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: LimitlessSdkAuthDryRunStatus;
  mode: "SDK_HMAC_READ_ONLY";
  config: {
    baseUrlHost: string | null;
    tokenIdConfigured: boolean;
    hmacSecretConfigured: boolean;
    onBehalfOfProfileIdConfigured: boolean;
    profileWalletAddressConfigured: boolean;
    timeoutMs: number;
  };
  calls: {
    positions: LimitlessSdkCallResult;
    history: LimitlessSdkCallResult;
    profile: LimitlessSdkCallResult;
  };
  redactionVerified: boolean;
  safety: {
    custodyModel: "MODEL_A_NON_CUSTODIAL";
    sdkServerSideOnly: true;
    liveVenueWithdrawalEndpointCalled: false;
    liveVenueWithdrawalExecutionEnabled: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    completionPersisted: false;
    userEndpointsChanged: false;
    liveLifiExecutionEnabled: false;
  };
  blockers: string[];
}

export interface LimitlessSdkCallResult {
  attempted: boolean;
  ok: boolean;
  summary: Record<string, unknown> | null;
  error: null | {
    name: string | null;
    status: number | null;
    code: string | null;
    message: string | null;
  };
}

export interface LimitlessSdkAuthDryRunOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  sdk: {
    HttpClient: LimitlessSdkHttpClientConstructor;
    PortfolioFetcher: LimitlessSdkPortfolioFetcherConstructor;
  };
}

export const runLimitlessSdkAuthDryRun = async (
  options: LimitlessSdkAuthDryRunOptions
): Promise<LimitlessSdkAuthDryRunArtifact> => {
  const env = options.env ?? process.env;
  const base = buildBaseArtifact(env, options.now);
  const tokenId = env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY?.trim();
  const secret = env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET?.trim();
  const baseURL = env.LIMITLESS_WITHDRAWAL_ADAPTER_BASE_URL?.trim() || env.LIMITLESS_BASE_URL?.trim() || "https://api.limitless.exchange";
  const blockers = [
    ...(!tokenId ? ["LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY is required for SDK HMAC dry-run."] : []),
    ...(!secret ? ["LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET is required for SDK HMAC dry-run."] : [])
  ];

  if (blockers.length > 0) {
    const refused = {
      ...base,
      status: "REFUSED_CONFIG_INCOMPLETE" as const,
      blockers
    };
    return {
      ...refused,
      redactionVerified: verifySdkDryRunRedaction(refused, env)
    };
  }

  const additionalHeaders = buildAdditionalHeaders(env);
  const requiredTokenId = tokenId as string;
  const requiredSecret = secret as string;
  const httpClient = new options.sdk.HttpClient({
    baseURL,
    timeout: base.config.timeoutMs,
    hmacCredentials: {
      tokenId: requiredTokenId,
      secret: requiredSecret
    },
    ...(Object.keys(additionalHeaders).length > 0 ? { additionalHeaders } : {})
  });
  const portfolio = new options.sdk.PortfolioFetcher(httpClient);

  const positions = await runCall(async () => summarizePositions(await portfolio.getPositions()), env);
  const history = await runHistoryCall(portfolio, httpClient, env);
  const profileWalletAddress = env.LIMITLESS_WITHDRAWAL_ADAPTER_PROFILE_WALLET_ADDRESS?.trim();
  const profile = profileWalletAddress
    ? await runCall(async () => summarizeProfile(await portfolio.getProfile(profileWalletAddress)), env)
    : notAttempted();
  const blockersFromCalls = [
    ...(!positions.ok ? ["SDK portfolio positions read failed."] : []),
    ...(!history.ok ? ["SDK portfolio history read failed."] : []),
    ...(profile.attempted && !profile.ok ? ["SDK profile read failed."] : [])
  ];
  const completed = {
    ...base,
    status: blockersFromCalls.length === 0 ? "COMPLETED" as const : "FAILED" as const,
    calls: {
      positions,
      history,
      profile
    },
    blockers: blockersFromCalls
  };
  return {
    ...completed,
    redactionVerified: verifySdkDryRunRedaction(completed, env)
  };
};

const buildBaseArtifact = (
  env: NodeJS.ProcessEnv,
  now: (() => Date) | undefined
): LimitlessSdkAuthDryRunArtifact => ({
  artifactSchemaVersion: 1,
  generatedAt: (now ?? (() => new Date()))().toISOString(),
  status: "FAILED",
  mode: "SDK_HMAC_READ_ONLY",
  config: {
    baseUrlHost: safeUrlHost(env.LIMITLESS_WITHDRAWAL_ADAPTER_BASE_URL ?? env.LIMITLESS_BASE_URL ?? null),
    tokenIdConfigured: Boolean(env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY),
    hmacSecretConfigured: Boolean(env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET),
    onBehalfOfProfileIdConfigured: Boolean(env.LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID),
    profileWalletAddressConfigured: Boolean(env.LIMITLESS_WITHDRAWAL_ADAPTER_PROFILE_WALLET_ADDRESS),
    timeoutMs: positiveInt(env.LIMITLESS_WITHDRAWAL_ADAPTER_TIMEOUT_MS, 5_000)
  },
  calls: {
    positions: notAttempted(),
    history: notAttempted(),
    profile: notAttempted()
  },
  redactionVerified: false,
  safety: {
    custodyModel: "MODEL_A_NON_CUSTODIAL",
    sdkServerSideOnly: true,
    liveVenueWithdrawalEndpointCalled: false,
    liveVenueWithdrawalExecutionEnabled: false,
    backendBroadcastedTransaction: false,
    backendSignedTransaction: false,
    completionPersisted: false,
    userEndpointsChanged: false,
    liveLifiExecutionEnabled: false
  },
  blockers: []
});

const buildAdditionalHeaders = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const profileId = env.LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID?.trim();
  return profileId ? { "x-on-behalf-of": profileId } : {};
};

const runCall = async (
  fn: () => Promise<Record<string, unknown>>,
  env: NodeJS.ProcessEnv
): Promise<LimitlessSdkCallResult> => {
  try {
    return {
      attempted: true,
      ok: true,
      summary: await fn(),
      error: null
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      summary: null,
      error: sanitizeSdkError(error, env)
    };
  }
};

const runHistoryCall = async (
  portfolio: InstanceType<LimitlessSdkPortfolioFetcherConstructor>,
  httpClient: LimitlessSdkHttpClientInstance,
  env: NodeJS.ProcessEnv
): Promise<LimitlessSdkCallResult> => {
  try {
    return {
      attempted: true,
      ok: true,
      summary: summarizeHistory(await portfolio.getUserHistory(1, 25), "PortfolioFetcher.getUserHistory"),
      error: null
    };
  } catch (error) {
    const sdkGet = httpClient.get?.bind(httpClient);
    if (!isRejectedPageParamError(error) || typeof sdkGet !== "function") {
      return {
        attempted: true,
        ok: false,
        summary: null,
        error: sanitizeSdkError(error, env)
      };
    }
    return runCall(
      async () => summarizeHistory(
        await sdkGet("/portfolio/history?limit=25"),
        "HttpClient.get:/portfolio/history?limit=25"
      ),
      env
    );
  }
};

const notAttempted = (): LimitlessSdkCallResult => ({
  attempted: false,
  ok: false,
  summary: null,
  error: null
});

const summarizePositions = (payload: unknown): Record<string, unknown> => {
  const record = asRecord(payload);
  return {
    clobCount: Array.isArray(record.clob) ? record.clob.length : null,
    ammCount: Array.isArray(record.amm) ? record.amm.length : null,
    hasAccumulativePoints: record.accumulativePoints !== undefined
  };
};

const summarizeHistory = (payload: unknown, source: string): Record<string, unknown> => {
  const record = asRecord(payload);
  return {
    source,
    fallbackUsed: source.startsWith("HttpClient.get:"),
    rowCount: Array.isArray(record.data) ? record.data.length : null,
    totalCount: numberOrNull(record.totalCount),
    hasNextCursor: Boolean(record.nextCursor ?? asRecord(record.pagination).nextCursor)
  };
};

const summarizeProfile = (payload: unknown): Record<string, unknown> => {
  const record = asRecord(payload);
  return {
    idPresent: Boolean(record.id),
    accountPresent: Boolean(record.account),
    rankPresent: Boolean(record.rank)
  };
};

const sanitizeSdkError = (
  error: unknown,
  env: NodeJS.ProcessEnv
): LimitlessSdkCallResult["error"] => {
  const record = asRecord(error);
  const response = asRecord(record.response);
  const data = asRecord(response.data ?? record.data);
  return {
    name: redactSecrets(stringOrNull(record.name), env),
    status: numberOrNull(record.status ?? response.status),
    code: redactSecrets(stringOrNull(record.code ?? data.code ?? data.error), env),
    message: truncate(redactSecrets(stringOrNull(record.message ?? data.message ?? data.error ?? data.msg), env))
  };
};

export const verifySdkDryRunRedaction = (
  artifact: LimitlessSdkAuthDryRunArtifact,
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  const serialized = JSON.stringify(artifact);
  const forbidden = [
    env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY,
    env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET,
    env.LIMITLESS_API_KEY,
    env.DATABASE_URL,
    env.TEST_DATABASE_URL,
    "lmts-signature",
    "lmts-api-key",
    "authorization",
    "privateKey",
    "rawProviderPayload"
  ].filter((value): value is string => Boolean(value));
  return forbidden.every((value) => !serialized.includes(value));
};

const safeUrlHost = (url: string | null): string | null => {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() :
    typeof value === "number" && Number.isFinite(value) ? String(value) :
      null;

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value :
    typeof value === "string" && Number.isFinite(Number(value)) ? Number(value) :
      null;

const isRejectedPageParamError = (error: unknown): boolean => {
  const record = asRecord(error);
  const response = asRecord(record.response);
  const data = asRecord(response.data ?? record.data);
  const message = [
    stringOrNull(record.message),
    stringOrNull(data.message),
    stringOrNull(data.error),
    stringOrNull(data.msg)
  ].filter(Boolean).join(" ").toLowerCase();
  return message.includes("page") && message.includes("should not exist");
};

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const truncate = (value: string | null): string | null =>
  value ? value.slice(0, 240) : null;

const redactSecrets = (value: string | null, env: NodeJS.ProcessEnv): string | null => {
  if (!value) {
    return null;
  }
  const secrets = [
    env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY,
    env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET,
    env.LIMITLESS_API_KEY,
    env.DATABASE_URL,
    env.TEST_DATABASE_URL
  ].filter((secret): secret is string => Boolean(secret));
  return secrets.reduce((redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"), value);
};
