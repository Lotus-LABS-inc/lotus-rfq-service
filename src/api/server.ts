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
import { registerRFQRoute } from "./routes/rfq.js";
import { createLPAuthMiddleware } from "../lp/lp-auth-middleware.js";
import { registerLPQuotesRoute } from "../lp/routes/lp-quotes-route.js";
import { ReceiveLPQuoteService } from "../lp/receive-lp-quote-service.js";
import { registerWebSocketPlugin } from "../ws/plugin.js";
import type { RFQDomainEvent } from "../core/rfq-engine/rfq-domain-events.js";

export interface ServerDependencies {
  logger: Logger;
  redisClient: RedisClient;
  pgPool: Pool;
  db: AppDb;
  canonicalServiceBaseUrl: string;
}

export const buildServer = async (dependencies: ServerDependencies): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false
  });

  app.decorate("infraLogger", dependencies.logger);
  const domainEventEmitter = new InMemoryRFQEventEmitter();
  const sessionRepository = new RFQSessionRepository(dependencies.pgPool);
  const eventRepository = new RFQEventRepository(dependencies.pgPool);
  const quoteRepository = new RFQQuoteRepository(dependencies.pgPool);
  const lpKeyRepository = new LPKeyRepository(dependencies.pgPool);
  const sessionManager = new RFQSessionManager({
    redis: dependencies.redisClient
  });

  const createRFQService = new CreateRFQService({
    sessionRepository,
    eventRepository,
    sessionManager,
    canonicalMarketClient: createCanonicalMarketClient({
      baseUrl: dependencies.canonicalServiceBaseUrl
    }),
    eventEmitter: domainEventEmitter,
    logger: dependencies.logger
  });
  const lpAuthMiddleware = createLPAuthMiddleware({
    redisClient: dependencies.redisClient,
    lpKeyRepository,
    logger: dependencies.logger
  });
  const receiveLPQuoteService = new ReceiveLPQuoteService({
    sessionRepository,
    quoteRepository,
    eventRepository,
    sessionManager,
    redisClient: dependencies.redisClient,
    eventEmitter: domainEventEmitter,
    logger: dependencies.logger
  });

  const wsGateway = await registerWebSocketPlugin(app, {
    redisClient: dependencies.redisClient,
    logger: dependencies.logger
  });
  await registerHealthRoute(app);
  await registerRFQRoute(app, {
    createRFQ: (request) => createRFQService.execute(request)
  });
  await registerLPQuotesRoute(app, lpAuthMiddleware, receiveLPQuoteService);

  const forwardableEventTypes: ReadonlySet<RFQDomainEvent["type"]> = new Set([
    "QUOTE_RECEIVED",
    "STATE_TRANSITION",
    "EXECUTION_UPDATE"
  ]);

  for (const eventType of forwardableEventTypes.values()) {
    domainEventEmitter.on(eventType, (event: RFQDomainEvent) => {
      if (
        event.type !== "QUOTE_RECEIVED" &&
        event.type !== "STATE_TRANSITION" &&
        event.type !== "EXECUTION_UPDATE"
      ) {
        return;
      }

      void wsGateway.publishEvent({
        type: event.type,
        topic: `rfq:${event.sessionId}`,
        emittedAt: event.occurredAt,
        payload: event.payload
      });
    });
  }

  return app;
};
