import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { config as loadDotenvFile } from "dotenv";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PolymarketFundingBalanceReadAccountUnavailableError,
  PolymarketFundingBalanceReadNotConfiguredError,
  PolymarketFundingBalanceReadService,
  buildPolymarketFundingBalanceReadConfigFromEnv,
  type PolymarketFundingVenueAccountReader,
  type PolymarketFundingBalanceReadInput,
  type PolymarketFundingBalanceReadOutput
} from "./core/funding/polymarket-balance-read-service.js";
import {
  InternalWithdrawalEvidenceReadService,
  LimitlessWithdrawalEvidenceMalformedError,
  LimitlessWithdrawalEvidenceNotFoundError,
  LimitlessWithdrawalEvidenceReadNotConfiguredError,
  type InternalWithdrawalEvidenceReadInput,
  type InternalWithdrawalEvidenceReadOutput
} from "./core/funding/limitless-withdrawal-evidence-read-service.js";
import type { FundingVenue } from "./core/funding/types.js";
import { isWithdrawalEvidenceVenueSupported } from "./core/funding/withdrawal-evidence.js";
import { createPgPool, closePgPool } from "./db/postgres.js";
import { UserVenueAccountRepository } from "./repositories/user-venue-account.repository.js";
import { createLogger } from "./utils/logger.js";

const fundingVenues = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const;
const nonPolymarketFundingVenues = ["LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const;

const balanceQuerySchema = z.object({
  userId: z.string().min(1),
  fundingIntentId: z.string().min(1),
  routeLegId: z.string().min(1),
  targetVenue: z.string().min(1).optional(),
  sourceChain: z.string().min(1).optional(),
  sourceToken: z.string().min(1).optional(),
  destinationChain: z.string().min(1).optional(),
  destinationToken: z.string().min(1).optional()
});

const evidenceQuerySchema = z.object({
  userId: z.string().min(1),
  withdrawalIntentId: z.string().min(1),
  withdrawalRouteLegId: z.string().min(1),
  sourceVenue: z.string().min(1),
  withdrawalTxHash: z.string().min(1)
});

type OpsFundingBalanceInput = z.infer<typeof balanceQuerySchema>;

interface FundingBalanceReader {
  readUsableBalance(input: PolymarketFundingBalanceReadInput): Promise<PolymarketFundingBalanceReadOutput>;
}

interface WithdrawalEvidenceReader {
  readEvidence(input: InternalWithdrawalEvidenceReadInput): Promise<InternalWithdrawalEvidenceReadOutput>;
}

export interface OpsReadServerDeps {
  env?: NodeJS.ProcessEnv | undefined;
  fetchImpl?: typeof fetch | undefined;
  polymarketFundingBalanceReader?: FundingBalanceReader | undefined;
  polymarketVenueAccountReader?: PolymarketFundingVenueAccountReader | undefined;
  withdrawalEvidenceReader?: WithdrawalEvidenceReader | undefined;
}

export interface OpsReadRuntime {
  app: FastifyInstance;
  shutdown: () => Promise<void>;
}

class OpsFundingBalanceNotConfiguredError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OpsFundingBalanceNotConfiguredError";
  }
}

class OpsFundingBalanceMalformedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OpsFundingBalanceMalformedError";
  }
}

class OpsFundingBalanceUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OpsFundingBalanceUnavailableError";
  }
}

const isFundingVenue = (value: string): value is FundingVenue =>
  fundingVenues.includes(value as FundingVenue);

const normalizeVenuePathSegment = (value: string | undefined): FundingVenue | null => {
  const normalized = `${value ?? ""}`.trim().toUpperCase().replaceAll("-", "_");
  if (normalized === "PREDICTFUN") {
    return "PREDICT_FUN";
  }
  return isFundingVenue(normalized) ? normalized : null;
};

const nonEmpty = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isLoopbackRequest = (request: FastifyRequest): boolean => {
  const hostHeader = typeof request.headers.host === "string" ? request.headers.host : "";
  const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";
  return host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    request.ip === "127.0.0.1" ||
    request.ip === "::1" ||
    request.ip === "::ffff:127.0.0.1";
};

const bearerToken = (request: FastifyRequest): string | null => {
  const authorization = typeof request.headers.authorization === "string" ? request.headers.authorization : "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
};

const authorizeOpsRead = (request: FastifyRequest, expectedToken: string | undefined, nodeEnv: string | undefined): boolean => {
  const token = expectedToken?.trim();
  if (token) {
    return bearerToken(request) === token;
  }
  if (nodeEnv === "production") {
    return false;
  }
  return isLoopbackRequest(request);
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(`${value ?? ""}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(`${value ?? ""}`, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() :
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? `${value}` :
      null;

const isEvmAddress = (value: string | undefined): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());

const readDotPath = (raw: unknown, path: string | undefined): unknown => {
  const parts = path?.split(".").map((part) => part.trim()).filter(Boolean) ?? [];
  if (parts.length === 0) {
    return undefined;
  }
  return parts.reduce<unknown>((current, part) => {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      return Number.isInteger(index) && index >= 0 ? current[index] : undefined;
    }
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[part];
  }, raw);
};

const normalizeDirectBalanceFallback = (raw: unknown): string => {
  if (!raw || typeof raw !== "object") {
    throw new OpsFundingBalanceMalformedError("Funding balance direct response was not an object.");
  }
  const record = raw as Record<string, unknown>;
  const candidate = record.usableBalance ?? record.availableBalance ?? record.balance;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
    return `${candidate}`;
  }
  throw new OpsFundingBalanceMalformedError("Funding balance direct response did not contain a balance field.");
};

const normalizeDirectBalance = (raw: unknown, responseField: string | undefined): string => {
  const configuredField = stringValue(readDotPath(raw, responseField));
  if (configuredField) {
    return configuredField;
  }
  return normalizeDirectBalanceFallback(raw);
};

const normalizeChainEnvKey = (value: string | undefined): string | null => {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized && normalized.length > 0 ? normalized : null;
};

const resolveDirectFundingBalancePath = (
  venue: Exclude<FundingVenue, "POLYMARKET">,
  input: OpsFundingBalanceInput,
  env: NodeJS.ProcessEnv,
  mode: string
): string | undefined => {
  if (mode !== "MULTI_DIRECT_HTTP") {
    return env[`${venue}_OPS_FUNDING_BALANCE_PATH`]?.trim();
  }

  const destinationChain = normalizeChainEnvKey(input.destinationChain);
  const sourceChain = normalizeChainEnvKey(input.sourceChain);
  const chainCandidates = [destinationChain, sourceChain].filter((chain): chain is string => Boolean(chain));
  for (const chain of chainCandidates) {
    const chainSpecificPath = env[`${venue}_OPS_FUNDING_BALANCE_PATH_BY_CHAIN_${chain}`]?.trim() ||
      env[`${venue}_OPS_FUNDING_BALANCE_PATH_${chain}`]?.trim();
    if (chainSpecificPath) {
      return chainSpecificPath;
    }
  }

  return undefined;
};

const encodeErc20BalanceOfCall = (walletAddress: string): string =>
  `0x70a08231${walletAddress.trim().toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

const parseJsonRpcHexQuantity = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new OpsFundingBalanceMalformedError("ERC20 balance response did not contain a hex result.");
  }
  return BigInt(value || "0x0");
};

const formatAtomicUnits = (value: bigint, decimals: number): string => {
  if (value < 0n) {
    throw new OpsFundingBalanceMalformedError("ERC20 balance response was negative.");
  }
  if (decimals === 0) {
    return value.toString();
  }
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText}`;
};

const buildDirectFundingBalanceHeaders = (
  venue: Exclude<FundingVenue, "POLYMARKET">,
  env: NodeJS.ProcessEnv,
  method: string,
  pathWithSearch: string
): Headers => {
  const headers = new Headers();
  const authMode = `${env[`${venue}_OPS_FUNDING_BALANCE_AUTH_MODE`] ?? "NONE"}`.trim().toUpperCase();
  if (authMode === "BEARER") {
    const apiKey = env[`${venue}_OPS_FUNDING_BALANCE_API_KEY`]?.trim();
    if (!apiKey) {
      throw new OpsFundingBalanceNotConfiguredError(`${venue} funding balance bearer token is not configured.`);
    }
    headers.set("authorization", `Bearer ${apiKey}`);
  }
  if (authMode === "API_KEY") {
    const apiKey = env[`${venue}_OPS_FUNDING_BALANCE_API_KEY`]?.trim();
    if (!apiKey) {
      throw new OpsFundingBalanceNotConfiguredError(`${venue} funding balance API key is not configured.`);
    }
    headers.set(env[`${venue}_OPS_FUNDING_BALANCE_API_KEY_HEADER`]?.trim() || "x-api-key", apiKey);
  }
  if (authMode === "HMAC") {
    const apiKey = env[`${venue}_OPS_FUNDING_BALANCE_API_KEY`]?.trim();
    const secret = env[`${venue}_OPS_FUNDING_BALANCE_HMAC_SECRET`]?.trim();
    if (!apiKey || !secret) {
      throw new OpsFundingBalanceNotConfiguredError(`${venue} funding balance HMAC credentials are not configured.`);
    }
    const timestamp = new Date().toISOString();
    const payload = `${timestamp}\n${method.toUpperCase()}\n${pathWithSearch}\n`;
    headers.set(env[`${venue}_OPS_FUNDING_BALANCE_HMAC_API_KEY_HEADER`]?.trim() || "lmts-api-key", apiKey);
    headers.set(env[`${venue}_OPS_FUNDING_BALANCE_HMAC_TIMESTAMP_HEADER`]?.trim() || "lmts-timestamp", timestamp);
    headers.set(
      env[`${venue}_OPS_FUNDING_BALANCE_HMAC_SIGNATURE_HEADER`]?.trim() || "lmts-signature",
      createHmac("sha256", decodeBase64Secret(secret)).update(payload).digest("base64")
    );
  }
  const onBehalfOf = env[`${venue}_OPS_FUNDING_BALANCE_ON_BEHALF_OF_PROFILE_ID`]?.trim();
  if (onBehalfOf) {
    headers.set("x-on-behalf-of", onBehalfOf);
  }
  return headers;
};

const readDirectHttpFundingBalance = async (
  venue: Exclude<FundingVenue, "POLYMARKET">,
  input: OpsFundingBalanceInput,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch
): Promise<PolymarketFundingBalanceReadOutput> => {
  const mode = `${env[`${venue}_OPS_FUNDING_BALANCE_MODE`] ?? "DISABLED"}`.trim().toUpperCase();
  if (mode !== "DIRECT_HTTP" && mode !== "MULTI_DIRECT_HTTP") {
    throw new OpsFundingBalanceNotConfiguredError(`${venue} direct funding balance mode is disabled.`);
  }

  const baseUrl = env[`${venue}_OPS_FUNDING_BALANCE_BASE_URL`]?.trim() ||
    (venue === "LIMITLESS" ? env.LIMITLESS_BASE_URL?.trim() :
      venue === "OPINION" ? env.OPINION_OPENAPI_BASE_URL?.trim() :
        venue === "MYRIAD" ? env.MYRIAD_BASE_URL?.trim() :
          venue === "PREDICT_FUN" ? env.PREDICT_MAINNET_BASE_URL?.trim() :
            undefined);
  const path = resolveDirectFundingBalancePath(venue, input, env, mode);
  if (!baseUrl || !path) {
    throw new OpsFundingBalanceNotConfiguredError(`${venue} direct funding balance base URL or path is not configured.`);
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(path, normalizedBaseUrl);
  url.searchParams.set("userId", input.userId);
  url.searchParams.set("fundingIntentId", input.fundingIntentId);
  url.searchParams.set("routeLegId", input.routeLegId);
  url.searchParams.set("targetVenue", venue);

  const timeoutMs = parsePositiveInt(env[`${venue}_FUNDING_READ_TIMEOUT_MS`], 5_000);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const pathWithSearch = `${url.pathname}${url.search}`;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: buildDirectFundingBalanceHeaders(venue, env, "GET", pathWithSearch),
      signal: abortController.signal
    });
    if (!response.ok) {
      throw new OpsFundingBalanceUnavailableError(`${venue} direct funding balance read returned HTTP ${response.status}.`);
    }
    return {
      usableBalance: normalizeDirectBalance(
        await response.json(),
        env[`${venue}_OPS_FUNDING_BALANCE_RESPONSE_FIELD`]
      )
    };
  } catch (error) {
    if (error instanceof OpsFundingBalanceNotConfiguredError || error instanceof OpsFundingBalanceMalformedError) {
      throw error;
    }
    throw new OpsFundingBalanceUnavailableError(`${venue} direct funding balance read is unavailable.`);
  } finally {
    clearTimeout(timeout);
  }
};

const readOnchainErc20FundingBalance = async (
  venue: Exclude<FundingVenue, "POLYMARKET">,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch
): Promise<PolymarketFundingBalanceReadOutput> => {
  const rpcUrl = env[`${venue}_OPS_FUNDING_BALANCE_RPC_URL`]?.trim();
  const tokenAddress = env[`${venue}_OPS_FUNDING_BALANCE_TOKEN_ADDRESS`]?.trim();
  const walletAddress = env[`${venue}_OPS_FUNDING_BALANCE_WALLET_ADDRESS`]?.trim();
  const decimals = parseNonNegativeInt(env[`${venue}_OPS_FUNDING_BALANCE_TOKEN_DECIMALS`], 6);
  if (!rpcUrl || !isEvmAddress(tokenAddress) || !isEvmAddress(walletAddress)) {
    throw new OpsFundingBalanceNotConfiguredError(`${venue} ERC20 balance read is not configured.`);
  }
  if (decimals > 36) {
    throw new OpsFundingBalanceNotConfiguredError(`${venue} ERC20 token decimals are not supported.`);
  }

  const timeoutMs = parsePositiveInt(env[`${venue}_FUNDING_READ_TIMEOUT_MS`], 5_000);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: tokenAddress,
            data: encodeErc20BalanceOfCall(walletAddress)
          },
          "latest"
        ]
      }),
      signal: abortController.signal
    });
    if (!response.ok) {
      throw new OpsFundingBalanceUnavailableError(`${venue} ERC20 balance read returned HTTP ${response.status}.`);
    }
    const raw = await response.json() as Record<string, unknown>;
    if (raw.error) {
      throw new OpsFundingBalanceUnavailableError(`${venue} ERC20 balance read returned a JSON-RPC error.`);
    }
    return {
      usableBalance: formatAtomicUnits(parseJsonRpcHexQuantity(raw.result), decimals)
    };
  } catch (error) {
    if (
      error instanceof OpsFundingBalanceNotConfiguredError ||
      error instanceof OpsFundingBalanceMalformedError ||
      error instanceof OpsFundingBalanceUnavailableError
    ) {
      throw error;
    }
    throw new OpsFundingBalanceUnavailableError(`${venue} ERC20 balance read is unavailable.`);
  } finally {
    clearTimeout(timeout);
  }
};

const readOpsFundingBalance = async (
  venue: Exclude<FundingVenue, "POLYMARKET">,
  input: OpsFundingBalanceInput,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch
): Promise<PolymarketFundingBalanceReadOutput> => {
  const mode = `${env[`${venue}_OPS_FUNDING_BALANCE_MODE`] ?? "DISABLED"}`.trim().toUpperCase();
  if (mode === "DIRECT_HTTP") {
    return readDirectHttpFundingBalance(venue, input, env, fetchImpl);
  }
  if (mode === "MULTI_DIRECT_HTTP") {
    return readDirectHttpFundingBalance(venue, input, env, fetchImpl);
  }
  if (mode === "ONCHAIN_ERC20") {
    return readOnchainErc20FundingBalance(venue, env, fetchImpl);
  }
  throw new OpsFundingBalanceNotConfiguredError(`${venue} funding balance mode is disabled.`);
};

const decodeBase64Secret = (secret: string): Buffer => {
  const normalized = secret.trim();
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
};

const handleFundingBalanceError = (venue: FundingVenue, error: unknown, reply: FastifyReply) => {
  if (error instanceof PolymarketFundingBalanceReadNotConfiguredError || error instanceof OpsFundingBalanceNotConfiguredError) {
    return reply.status(503).send({
      code: `${venue}_FUNDING_BALANCE_READ_NOT_CONFIGURED`,
      message: `${venue} funding balance read is disabled or incomplete.`
    });
  }
  if (error instanceof PolymarketFundingBalanceReadAccountUnavailableError) {
    return reply.status(409).send({
      code: `${venue}_FUNDING_BALANCE_READ_ACCOUNT_UNAVAILABLE`,
      message: `${venue} deposit wallet account is not ready for funding balance reads.`
    });
  }
  if (error instanceof OpsFundingBalanceMalformedError) {
    return reply.status(502).send({
      code: `${venue}_FUNDING_BALANCE_READ_MALFORMED`,
      message: `${venue} funding balance read returned malformed data.`
    });
  }
  return reply.status(502).send({
    code: `${venue}_FUNDING_BALANCE_READ_UNAVAILABLE`,
    message: `${venue} funding balance read is unavailable.`
  });
};

const handleWithdrawalEvidenceReadError = (venue: FundingVenue, error: unknown, reply: FastifyReply) => {
  if (error instanceof LimitlessWithdrawalEvidenceReadNotConfiguredError) {
    return reply.status(503).send({
      code: `${venue}_WITHDRAWAL_EVIDENCE_READ_NOT_CONFIGURED`,
      message: `${venue} withdrawal evidence read is disabled or incomplete.`
    });
  }
  if (error instanceof LimitlessWithdrawalEvidenceNotFoundError) {
    return reply.status(404).send({
      code: `${venue}_WITHDRAWAL_EVIDENCE_NOT_FOUND`,
      message: `${venue} withdrawal evidence was not found.`
    });
  }
  if (error instanceof LimitlessWithdrawalEvidenceMalformedError) {
    return reply.status(502).send({
      code: `${venue}_WITHDRAWAL_EVIDENCE_MALFORMED`,
      message: `${venue} withdrawal evidence is malformed.`
    });
  }
  return reply.status(502).send({
    code: `${venue}_WITHDRAWAL_EVIDENCE_READ_UNAVAILABLE`,
    message: `${venue} withdrawal evidence read is unavailable.`
  });
};

export const buildOpsReadServer = async (deps: OpsReadServerDeps = {}): Promise<FastifyInstance> => {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const app = Fastify({ logger: false });
  const polymarketFundingBalanceReader = deps.polymarketFundingBalanceReader ??
    new PolymarketFundingBalanceReadService(
      buildPolymarketFundingBalanceReadConfigFromEnv(env),
      undefined,
      deps.polymarketVenueAccountReader
    );
  const withdrawalEvidenceReader = deps.withdrawalEvidenceReader ??
    new InternalWithdrawalEvidenceReadService({ env, fetchImpl });

  app.get("/health", async () => ({
    status: "ok",
    service: "lotus-ops-read-service"
  }));

  app.get("/lotus/:venue/funding-balance", async (request, reply) => {
    const venue = normalizeVenuePathSegment((request.params as { venue?: string }).venue);
    if (!venue) {
      return reply.status(404).send({
        code: "FUNDING_BALANCE_VENUE_NOT_SUPPORTED",
        message: "Funding balance venue is not supported."
      });
    }

    if (!authorizeOpsRead(request, env[`${venue}_FUNDING_READ_API_KEY`], env.NODE_ENV)) {
      return reply.status(401).send({
        code: "UNAUTHORIZED",
        message: `${venue} funding balance read is not authorized.`
      });
    }

    const parsed = balanceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: `${venue} funding balance request validation failed.`,
        details: parsed.error.flatten()
      });
    }

    if (parsed.data.targetVenue && normalizeVenuePathSegment(parsed.data.targetVenue) !== venue) {
      return reply.status(400).send({
        code: "FUNDING_BALANCE_VENUE_MISMATCH",
        message: "Funding balance path venue and target venue must match."
      });
    }

    try {
      const result = venue === "POLYMARKET"
        ? await polymarketFundingBalanceReader.readUsableBalance(parsed.data)
        : await readOpsFundingBalance(
            venue as (typeof nonPolymarketFundingVenues)[number],
            parsed.data,
            env,
            fetchImpl
          );
      return reply.status(200).send({ usableBalance: result.usableBalance });
    } catch (error) {
      return handleFundingBalanceError(venue, error, reply);
    }
  });

  app.get("/internal/polymarket/funding-balance", async (request, reply) => {
    const venue = "POLYMARKET";
    if (!authorizeOpsRead(request, env.POLYMARKET_FUNDING_READ_API_KEY, env.NODE_ENV)) {
      return reply.status(401).send({
        code: "UNAUTHORIZED",
        message: "POLYMARKET funding balance read is not authorized."
      });
    }

    const parsed = balanceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "POLYMARKET funding balance request validation failed.",
        details: parsed.error.flatten()
      });
    }

    if (parsed.data.targetVenue && normalizeVenuePathSegment(parsed.data.targetVenue) !== venue) {
      return reply.status(400).send({
        code: "FUNDING_BALANCE_VENUE_MISMATCH",
        message: "Funding balance path venue and target venue must match."
      });
    }

    try {
      const result = await polymarketFundingBalanceReader.readUsableBalance(parsed.data);
      return reply.status(200).send({ usableBalance: result.usableBalance });
    } catch (error) {
      return handleFundingBalanceError(venue, error, reply);
    }
  });

  app.get("/lotus/:venue/withdrawal-evidence", async (request, reply) => {
    const venue = normalizeVenuePathSegment((request.params as { venue?: string }).venue);
    if (!venue || !isWithdrawalEvidenceVenueSupported(venue)) {
      return reply.status(404).send({
        code: "WITHDRAWAL_EVIDENCE_VENUE_NOT_SUPPORTED",
        message: "Withdrawal evidence venue is not supported."
      });
    }

    if (!authorizeOpsRead(request, env[`${venue}_WITHDRAWAL_EVIDENCE_API_KEY`], env.NODE_ENV)) {
      return reply.status(401).send({
        code: "UNAUTHORIZED",
        message: `${venue} withdrawal evidence read is not authorized.`
      });
    }

    const parsed = evidenceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: `${venue} withdrawal evidence request validation failed.`,
        details: parsed.error.flatten()
      });
    }

    if (normalizeVenuePathSegment(parsed.data.sourceVenue) !== venue) {
      return reply.status(400).send({
        code: "WITHDRAWAL_EVIDENCE_VENUE_MISMATCH",
        message: "Withdrawal evidence path venue and source venue must match."
      });
    }

    try {
      const result = await withdrawalEvidenceReader.readEvidence({
        ...parsed.data,
        sourceVenue: venue
      });
      return reply.status(200).send(result);
    } catch (error) {
      return handleWithdrawalEvidenceReadError(venue, error, reply);
    }
  });

  return app;
};

export const startOpsReadService = async (): Promise<OpsReadRuntime> => {
  loadDotenvFile();
  const logger = createLogger((process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error" | "silent") ?? "info");
  const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  const pgPool = databaseUrl
    ? createPgPool({ databaseUrl, logger })
    : null;
  const app = await buildOpsReadServer({
    polymarketVenueAccountReader: pgPool ? new UserVenueAccountRepository(pgPool) : undefined
  });
  const host = process.env.HOST ?? "0.0.0.0";
  const port = parsePositiveInt(process.env.PORT, 10_000);
  await app.listen({ host, port });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("Ops read service shutdown started.");
    await app.close();
    if (pgPool) {
      await closePgPool(pgPool);
    }
    logger.info("Ops read service shutdown completed.");
  };

  logger.info({ host, port }, "Ops read service started.");
  return { app, shutdown };
};

const registerSignals = (runtime: OpsReadRuntime): void => {
  const onSignal = async (signal: NodeJS.Signals): Promise<void> => {
    const logger = createLogger("info");
    logger.info({ signal }, "Signal received.");
    await runtime.shutdown();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void onSignal("SIGINT");
  });
  process.once("SIGTERM", () => {
    void onSignal("SIGTERM");
  });
};

export const run = async (): Promise<void> => {
  try {
    const runtime = await startOpsReadService();
    registerSignals(runtime);
  } catch (error) {
    const logger = createLogger("error");
    logger.error({ err: error }, "Ops read service failed to start.");
    process.exit(1);
  }
};

const isMainModule = (): boolean => {
  const entryPath = process.argv[1];
  const thisPath = fileURLToPath(import.meta.url);
  return Boolean(entryPath) && entryPath === thisPath;
};

if (isMainModule()) {
  void run();
}
