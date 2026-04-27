import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PolymarketFundingBalanceReadNotConfiguredError,
  PolymarketFundingBalanceReadService,
  buildPolymarketFundingBalanceReadConfigFromEnv,
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
import { createLogger } from "./utils/logger.js";

const fundingVenues = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const;
const nonPolymarketFundingVenues = ["LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const;

const balanceQuerySchema = z.object({
  userId: z.string().min(1),
  fundingIntentId: z.string().min(1),
  routeLegId: z.string().min(1),
  targetVenue: z.string().min(1).optional()
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

const normalizeUpstreamBalance = (raw: unknown): string => {
  if (!raw || typeof raw !== "object") {
    throw new OpsFundingBalanceMalformedError("Funding balance upstream response was not an object.");
  }
  const record = raw as Record<string, unknown>;
  const candidate = record.usableBalance ?? record.availableBalance ?? record.balance;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
    return `${candidate}`;
  }
  throw new OpsFundingBalanceMalformedError("Funding balance upstream response did not contain a balance field.");
};

const readHttpUpstreamFundingBalance = async (
  venue: Exclude<FundingVenue, "POLYMARKET">,
  input: OpsFundingBalanceInput,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch
): Promise<PolymarketFundingBalanceReadOutput> => {
  const mode = `${env[`${venue}_OPS_FUNDING_BALANCE_MODE`] ?? "DISABLED"}`.trim().toUpperCase();
  if (mode !== "HTTP_UPSTREAM") {
    throw new OpsFundingBalanceNotConfiguredError(`${venue} funding balance upstream mode is disabled.`);
  }

  const upstreamUrl = env[`${venue}_OPS_FUNDING_BALANCE_UPSTREAM_URL`]?.trim();
  if (!upstreamUrl) {
    throw new OpsFundingBalanceNotConfiguredError(`${venue} funding balance upstream URL is not configured.`);
  }

  const url = new URL(upstreamUrl);
  url.searchParams.set("userId", input.userId);
  url.searchParams.set("fundingIntentId", input.fundingIntentId);
  url.searchParams.set("routeLegId", input.routeLegId);
  url.searchParams.set("targetVenue", venue);

  const headers = new Headers();
  const authMode = `${env[`${venue}_OPS_FUNDING_BALANCE_UPSTREAM_AUTH_MODE`] ?? "NONE"}`.trim().toUpperCase();
  if (authMode === "BEARER") {
    const apiKey = env[`${venue}_OPS_FUNDING_BALANCE_UPSTREAM_API_KEY`]?.trim();
    if (!apiKey) {
      throw new OpsFundingBalanceNotConfiguredError(`${venue} funding balance upstream bearer token is not configured.`);
    }
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  const timeoutMs = parsePositiveInt(env[`${venue}_FUNDING_READ_TIMEOUT_MS`], 5_000);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: abortController.signal
    });
    if (!response.ok) {
      throw new OpsFundingBalanceUnavailableError(`${venue} funding balance upstream returned HTTP ${response.status}.`);
    }
    return { usableBalance: normalizeUpstreamBalance(await response.json()) };
  } catch (error) {
    if (error instanceof OpsFundingBalanceNotConfiguredError || error instanceof OpsFundingBalanceMalformedError) {
      throw error;
    }
    throw new OpsFundingBalanceUnavailableError(`${venue} funding balance upstream is unavailable.`);
  } finally {
    clearTimeout(timeout);
  }
};

const handleFundingBalanceError = (venue: FundingVenue, error: unknown, reply: FastifyReply) => {
  if (error instanceof PolymarketFundingBalanceReadNotConfiguredError || error instanceof OpsFundingBalanceNotConfiguredError) {
    return reply.status(503).send({
      code: `${venue}_FUNDING_BALANCE_READ_NOT_CONFIGURED`,
      message: `${venue} funding balance read is disabled or incomplete.`
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
    new PolymarketFundingBalanceReadService(buildPolymarketFundingBalanceReadConfigFromEnv(env));
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
        : await readHttpUpstreamFundingBalance(
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
  const app = await buildOpsReadServer();
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
