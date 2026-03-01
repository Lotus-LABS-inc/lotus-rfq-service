import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { Pool } from "pg";
import type { AppDb } from "../db/postgres.js";
import type { RedisClient } from "../db/redis.js";
import { createCanonicalMarketClient } from "../core/rfq-engine/canonical-market-client.js";
import { CreateRFQService } from "../core/rfq-engine/create-rfq-service.js";
import { InMemoryRFQEventEmitter } from "../core/rfq-engine/rfq-domain-events.js";
import { RFQSessionManager } from "../core/rfq-engine/rfq-session-manager.js";
import { RFQEventRepository } from "../db/repositories/rfq-event-repository.js";
import { LPKeyRepository } from "../db/repositories/lp-key-repository.js";
import { RFQQuoteRepository } from "../db/repositories/rfq-quote-repository.js";
import { RFQSessionRepository } from "../db/repositories/rfq-session-repository.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerRFQRoute } from "./routes/rfq.js";
import { ExecutionRouterService } from "../core/execution-router/execution-router.js";
import { createLPAuthMiddleware } from "../lp/lp-auth-middleware.js";
import { registerLPQuotesRoute } from "../lp/routes/lp-quotes-route.js";
import { ReceiveLPQuoteService } from "../lp/receive-lp-quote-service.js";
import { registerWebSocketPlugin } from "../ws/plugin.js";
import type { RFQDomainEvent } from "../core/rfq-engine/rfq-domain-events.js";
import { LPStatsRepository } from "../repositories/lp-stats.repository.js";
import fastifyJwt from "@fastify/jwt";
import { createUserAuthMiddleware, createAdminAuthMiddleware } from "./user-auth-middleware.js";
import { ExposureRepository } from "../repositories/exposure.repository.js";
import { ExposureRedisCache } from "../repositories/exposure-redis-cache.js";
import { RiskEngine } from "../core/risk-engine.js";
import { registerAdminRiskRoutes } from "./admin/risk.routes.js";

export interface ServerDependencies {
  logger: Logger;
  redisClient: RedisClient;
  pgPool: Pool;
  db: AppDb;
  canonicalServiceBaseUrl: string;
  jwtSecret: string;
  reliabilityWeight: number;
  latencyWeight: number;
  failureWeight: number;
}

export const buildServer = async (dependencies: ServerDependencies): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false
  });

  await app.register(fastifyJwt, {
    secret: dependencies.jwtSecret
  });

  app.decorate("infraLogger", dependencies.logger);
  const domainEventEmitter = new InMemoryRFQEventEmitter();
  const sessionRepository = new RFQSessionRepository(dependencies.pgPool);
  const eventRepository = new RFQEventRepository(dependencies.pgPool);
  const quoteRepository = new RFQQuoteRepository(dependencies.pgPool);
  const lpKeyRepository = new LPKeyRepository(dependencies.pgPool);
  const lpStatsRepository = new LPStatsRepository(dependencies.pgPool, dependencies.logger);
  const sessionManager = new RFQSessionManager({
    redis: dependencies.redisClient
  });

  const exposureRepository = new ExposureRepository(dependencies.pgPool, dependencies.logger);
  const exposureCache = new ExposureRedisCache(dependencies.redisClient);
  const riskEngine = new RiskEngine(
    exposureRepository,
    exposureCache,
    createCanonicalMarketClient({ baseUrl: dependencies.canonicalServiceBaseUrl }),
    dependencies.pgPool,
    {
      userNotionalCap: Number(process.env.RISK_USER_NOTIONAL_CAP || "1000000"),
      marketNotionalCap: Number(process.env.RISK_MARKET_NOTIONAL_CAP || "10000000"),
      lpNotionalCap: Number(process.env.RISK_LP_NOTIONAL_CAP || "5000000"),
      globalNotionalCap: Number(process.env.RISK_GLOBAL_NOTIONAL_CAP || "50000000"),
      maxOrderNotional: Number(process.env.RISK_MAX_ORDER_NOTIONAL || "500000"),
    },
    dependencies.logger
  );

  const createRFQService = new CreateRFQService({
    sessionRepository,
    eventRepository,
    sessionManager,
    canonicalMarketClient: createCanonicalMarketClient({
      baseUrl: dependencies.canonicalServiceBaseUrl
    }),
    eventEmitter: domainEventEmitter,
    logger: dependencies.logger,
    riskEngine
  });
  const lpAuthMiddleware = createLPAuthMiddleware({
    redisClient: dependencies.redisClient,
    lpKeyRepository,
    logger: dependencies.logger
  });
  const userAuthMiddleware = createUserAuthMiddleware();
  const receiveLPQuoteService = new ReceiveLPQuoteService({
    sessionRepository,
    quoteRepository,
    eventRepository,
    sessionManager,
    redisClient: dependencies.redisClient,
    eventEmitter: domainEventEmitter,
    lpStatsRepository,
    logger: dependencies.logger
  });

  const executionRouterService = new ExecutionRouterService({
    sessionRepository,
    quoteRepository,
    executionRepository: new (await import("../db/repositories/rfq-execution-repository.js")).RFQExecutionRepository(dependencies.pgPool),
    sessionManager,
    executionGateway: {
      execute: async (req) => {
        dependencies.logger.info({ sessionId: req.sessionId }, "Execution gateway placeholder called.");
        return { ok: false, reason: "GATEWAY_NOT_CONFIGURED" };
      }
    },
    eventEmitter: domainEventEmitter,
    logger: dependencies.logger,
    lpStatsRepository,
    riskEngine
  });

  const wsGateway = await registerWebSocketPlugin(app, {
    redisClient: dependencies.redisClient,
    logger: dependencies.logger
  });
  await registerHealthRoute(app);
  await registerMetricsRoute(app);
  await registerRFQRoute(app, userAuthMiddleware, {
    createRFQ: (request) =>
      createRFQService.execute(request, {
        weights: {
          reliabilityWeight: dependencies.reliabilityWeight,
          latencyWeight: dependencies.latencyWeight,
          failureWeight: dependencies.failureWeight
        }
      }),
    acceptRFQ: async (sessionId, request) => {
      const session = await sessionRepository.findById(sessionId);
      if (!session) throw new Error("Session not found");

      const quote = await quoteRepository.findByExternalQuoteId(sessionId, request.quoteId);
      if (!quote) throw new Error("Quote not found");

      const reservationToken = await riskEngine.validateBeforeExecution(session, quote);

      return executionRouterService.execute({
        sessionId,
        rankedQuotes: [{
          quoteId: request.quoteId,
          basePrice: Number.parseFloat(quote.price),
          venueFee: 0,
          protocolFee: 0,
          gasCost: 0,
          slippageEstimate: 0,
          reliabilityScore: 0,
          latencyScore: 0,
          expires_at: quote.valid_until.toISOString(),
          effectiveCost: Number.parseFloat(quote.price),
          score: 1,
          reliabilityBonus: 0,
          latencyBonus: 0,
          failurePenalty: 0,
          rank: 1,
          soft_refresh_flag: false
        }],
        fallbackToNextQuote: false,
        reservationToken
      });
    }
  });
  const adminAuthMiddleware = createAdminAuthMiddleware();
  await registerAdminRiskRoutes(app, adminAuthMiddleware, {
    riskEngine,
    exposureRepo: exposureRepository,
    exposureCache,
  });
  await registerLPQuotesRoute(app, lpAuthMiddleware, receiveLPQuoteService);

  const forwardableEventTypes: ReadonlySet<string> = new Set([
    "QUOTE_RECEIVED",
    "STATE_TRANSITION",
    "EXECUTION_UPDATE",
    "RISK_REJECTED",
    "RISK_EXECUTION_REJECTED"
  ]);

  for (const eventType of forwardableEventTypes.values()) {
    domainEventEmitter.on(eventType, (event: RFQDomainEvent) => {
      if (
        (event.type as string) !== "QUOTE_RECEIVED" &&
        (event.type as string) !== "STATE_TRANSITION" &&
        (event.type as string) !== "EXECUTION_UPDATE" &&
        (event.type as string) !== "RISK_REJECTED" &&
        (event.type as string) !== "RISK_EXECUTION_REJECTED"
      ) {
        return;
      }

      void wsGateway.publishEvent({
        type: event.type as any,
        topic: `rfq:${event.sessionId}`,
        emittedAt: event.occurredAt,
        payload: event.payload
      });
    });
  }

  return app;
};
