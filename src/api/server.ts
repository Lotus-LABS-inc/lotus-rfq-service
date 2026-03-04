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
import { ComboRepository } from "../repositories/combo.repository.js";
import { registerAdminComboRoutes } from "./admin/combo.routes.js";
import { registerAdminSORRoutes } from "./admin/sor.routes.js";
import { SORAdminService } from "./admin/sor-admin-service.js";
import { CostModel, OrderRouter, PlanComposer, PlanRunner, RouteScout, Splitter, type SORAcceptancePolicy } from "../core/sor/index.js";
import { RFQStateMachine, type RFQState } from "../core/rfq-engine/rfq-state-machine.js";

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
  sorAcceptAonAwait: boolean;
  sorAcceptNonAonBackground: boolean;
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
  const comboRepository = new ComboRepository(dependencies.pgPool);
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

  const sorRouteScout = new RouteScout({
    redis: dependencies.redisClient,
    lpSource: {
      getWholeComboQuotes: async () => [],
      getPerLegQuotes: async (rfq) => {
        const dbQuotes = await quoteRepository.listBySessionId(rfq.rfqId, 50);
        return dbQuotes.map((quote) => ({
          quoteId: String(quote.quote_payload.quoteId ?? quote.id),
          providerId:
            typeof quote.quote_payload.lpId === "string"
              ? quote.quote_payload.lpId
              : quote.lp_key_id,
          providerType: "LP" as const,
          legId: rfq.rfqId,
          availableSize: Number.parseFloat(quote.quantity),
          quotedPrice: Number.parseFloat(quote.price),
          fees: {
            provider_fee: quote.fee_bps / 10000
          },
          latencyMs: 0,
          fillProb: 0.95,
          metadata: {
            quote_status: quote.quote_status
          }
        }));
      }
    },
    canonicalClient: {
      getOrderbookSnapshot: async () => null
    }
  });
  const orderRouter = new OrderRouter({
    routeScout: sorRouteScout,
    costModel: new CostModel(),
    splitter: new Splitter(),
    planComposer: new PlanComposer({
      pool: dependencies.pgPool,
      logger: dependencies.logger
    })
  });

  const sorExecutionRouter = {
    executeStep: async () => ({
      ok: true as const,
      executionRef: `sor-exec-${Date.now()}`
    })
  };

  const planRunner = new PlanRunner({
    pool: dependencies.pgPool,
    redis: dependencies.redisClient,
    executionRouter: sorExecutionRouter,
    riskEngine,
    logger: dependencies.logger
  });

  const transitionRFQState = async (
    sessionId: string,
    targetState: RFQState,
    reason: string
  ): Promise<void> => {
    const session = await sessionRepository.findById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found for transition.`);
    }

    const current = asRFQState(session.status);
    if (!current) {
      throw new Error(`Unknown RFQ state ${session.status} for session ${sessionId}.`);
    }
    if (current === targetState) {
      return;
    }

    const stateMachine = new RFQStateMachine({
      initialState: current,
      logger: dependencies.logger
    });
    if (!stateMachine.canTransitionTo(targetState)) {
      throw new Error(`Invalid RFQ transition ${current} -> ${targetState}`);
    }

    const next = stateMachine.transitionTo(targetState, {
      reason,
      metadata: { sessionId }
    });
    await sessionRepository.updateStatus(sessionId, next);
    domainEventEmitter.emitEvent({
      type: "STATE_TRANSITION",
      sessionId,
      occurredAt: new Date().toISOString(),
      payload: {
        from: current,
        to: next
      }
    });
  };

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

      const acceptancePolicy = readAcceptancePolicy(session.metadata);
      const reservationToken = await riskEngine.validateBeforeExecution(session, quote);
      const rfqInput = {
        rfqId: session.id,
        canonicalMarketId: session.canonical_market_id,
        takerId: session.taker_id,
        side: session.side,
        quantity: session.quantity,
        metadata: {
          reservation_token: reservationToken,
          legs: [
            {
              leg_id: session.id,
              canonical_market_id: session.canonical_market_id,
              side: session.side,
              quantity: Number.parseFloat(session.quantity)
            }
          ]
        }
      } as const;
      const selectedQuoteInput = {
        quoteId: request.quoteId,
        ...(typeof quote.quote_payload.lpId === "string"
          ? { lpId: quote.quote_payload.lpId }
          : {}),
        price: Number.parseFloat(quote.price),
        quantity: Number.parseFloat(quote.quantity),
        feeBps: quote.fee_bps,
        validUntil: quote.valid_until.toISOString(),
        payload: quote.quote_payload
      } as const;

      const plan = await orderRouter.buildPlan(rfqInput, selectedQuoteInput, acceptancePolicy);

      const runPlanAndTransition = async (): Promise<"COMPLETED" | "PARTIAL" | "FAILED" | "UNWOUND"> => {
        await transitionRFQState(sessionId, "ACCEPTED", "sor_plan_created");
        await transitionRFQState(sessionId, "EXECUTING", "sor_plan_running");

        const result = await planRunner.run(plan);
        if (result.status === "COMPLETED" || result.status === "PARTIAL") {
          await transitionRFQState(sessionId, "SETTLED", "sor_plan_completed");
        } else {
          await transitionRFQState(sessionId, "FAILED", "sor_plan_failed");
        }
        return result.status;
      };

      const shouldAwait =
        acceptancePolicy === "ALL_OR_NONE" ? dependencies.sorAcceptAonAwait : !dependencies.sorAcceptNonAonBackground;

      if (shouldAwait) {
        const finalStatus = await runPlanAndTransition();
        return {
          status: "PLAN_ACCEPTED" as const,
          plan_id: plan.id,
          plan_state: "DRAFT" as const,
          dispatch_mode: "awaited" as const,
          final_status: finalStatus
        };
      }

      void runPlanAndTransition().catch((error: unknown) => {
        dependencies.logger.error({ err: error, sessionId, planId: plan.id }, "Background SOR plan execution failed.");
      });

      return {
        status: "PLAN_ACCEPTED" as const,
        plan_id: plan.id,
        plan_state: "DRAFT" as const,
        dispatch_mode: "background" as const
      };
    }
  });
  const adminAuthMiddleware = createAdminAuthMiddleware();
  await registerAdminRiskRoutes(app, adminAuthMiddleware, {
    riskEngine,
    exposureRepo: exposureRepository,
    exposureCache,
  });
  await registerAdminComboRoutes(app, adminAuthMiddleware, {
    comboRepo: comboRepository,
    exposureRepo: exposureRepository,
    exposureCache
  });
  await registerAdminSORRoutes(app, adminAuthMiddleware, {
    sorAdminService: new SORAdminService({
      pool: dependencies.pgPool,
      planRunner,
      logger: dependencies.logger
    })
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

const readAcceptancePolicy = (metadata: Record<string, unknown>): SORAcceptancePolicy => {
  const value = metadata.acceptance_policy;
  if (value === "ALL_OR_NONE" || value === "PARTIAL_ALLOWED" || value === "BEST_EFFORT") {
    return value;
  }
  return "ALL_OR_NONE";
};

const asRFQState = (value: string): RFQState | null => {
  if (
    value === "CREATED" ||
    value === "BROADCAST" ||
    value === "COLLECTING_QUOTES" ||
    value === "RANKING" ||
    value === "AWAITING_USER" ||
    value === "ACCEPTED" ||
    value === "EXECUTING" ||
    value === "SETTLED" ||
    value === "FAILED" ||
    value === "EXPIRED"
  ) {
    return value;
  }
  return null;
};
