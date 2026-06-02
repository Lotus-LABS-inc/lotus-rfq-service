import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import Fastify from "fastify";
import { QuoteSnapshotCache, SharedCoreVenueQuoteMappingResolver } from "./core/sor/quote-snapshot.js";
import { createPgPool, closePgPool } from "./db/postgres.js";
import { connectRedis, createRedisClient, disconnectRedis } from "./db/redis.js";
import {
  LimitlessSdkOrderbookConnector,
  OpinionSdkOrderbookConnector,
  PredictWebSocketOrderbookConnector,
  createPolymarketOrderbookConnector
} from "./integrations/orderbook-stream-connectors.js";
import { VenueOrderbookSnapshotRepository } from "./repositories/venue-orderbook-snapshot.repository.js";
import { SharedCoreQuoteMappingRepository } from "./repositories/market-catalog.repository.js";
import { HotQuoteSnapshotService, resolveHotQuoteRedisNamespace } from "./services/hot-quote-snapshot.service.js";
import { OrderbookStreamService, type VenueOrderbookStreamConnector } from "./services/orderbook-stream.service.js";
import { loadEnv } from "./utils/env.js";
import { createLogger } from "./utils/logger.js";

export interface OrderbookStreamRuntime {
  shutdown(): Promise<void>;
}

const DEFAULT_ORDERBOOK_STREAM_PORT = 3011;
const DEFAULT_PREDICT_WS_MAINNET_URL = "wss://ws.predict.fun/";
const DEFAULT_ORDERBOOK_STREAM_VENUES = ["POLYMARKET", "LIMITLESS", "PREDICT_FUN", "OPINION"] as const;
const ORDERBOOK_STREAM_VENUE_ALIASES: Record<string, string> = {
  PREDICT: "PREDICT_FUN",
  PREDICTFUN: "PREDICT_FUN",
  PREDICT_FUN: "PREDICT_FUN",
  POLY: "POLYMARKET",
  POLYMARKET: "POLYMARKET",
  LIMITLESS: "LIMITLESS",
  OPINION: "OPINION"
};

export const runOrderbookStreamService = async (): Promise<OrderbookStreamRuntime> => {
  loadDotenvFile();
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const redis = createRedisClient({ redisUrl: env.REDIS_URL, logger });
  const pgPool = createPgPool({ databaseUrl: env.DATABASE_URL, logger });
  const app = Fastify({ loggerInstance: logger });

  await connectRedis(redis);

  const hotSnapshots = new HotQuoteSnapshotService({
    memoryCache: new QuoteSnapshotCache(),
    redis,
    dbFallback: new VenueOrderbookSnapshotRepository(pgPool),
    logger,
    config: {
      redisNamespace: resolveHotQuoteRedisNamespace({
        LOTUS_DEPLOY_ENV: process.env.LOTUS_DEPLOY_ENV,
        LOTUS_ENV: process.env.LOTUS_ENV,
        APP_ENV: process.env.APP_ENV,
        NODE_ENV: process.env.NODE_ENV
      })
    }
  });
  const mappingResolver = new SharedCoreVenueQuoteMappingResolver(new SharedCoreQuoteMappingRepository(pgPool));
  const streamService = new OrderbookStreamService({
    activeMarkets: hotSnapshots,
    hotSnapshots,
    mappingResolver,
    connectors: buildConnectors(logger),
    publisher: redis,
    logger
  });

  app.get("/health", async () => ({ ok: true, service: "lotus-orderbook-stream-service" }));
  app.get("/ready", async () => {
    const activeMarkets = await hotSnapshots.listActiveMarketsFromRedis({ limit: 1 });
    await pgPool.query("select 1");
    return {
      ok: true,
      service: "lotus-orderbook-stream-service",
      activeMarketProbeCount: activeMarkets.length
    };
  });

  streamService.start();
  await app.listen({
    host: env.HOST,
    port: orderbookStreamPort(process.env)
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({}, "Orderbook stream runtime shutdown started.");
    await streamService.stop();
    await app.close();
    await disconnectRedis(redis);
    await closePgPool(pgPool);
    logger.info({}, "Orderbook stream runtime shutdown completed.");
  };

  registerSignals(shutdown);
  logger.info(
    {
      host: env.HOST,
      port: orderbookStreamPort(process.env),
      venues: Array.from(parseOrderbookStreamVenues(process.env.ORDERBOOK_STREAM_VENUES))
    },
    "Lotus orderbook stream service listening."
  );
  return { shutdown };
};

export const parseOrderbookStreamVenues = (raw: string | undefined): ReadonlySet<string> => {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return new Set(DEFAULT_ORDERBOOK_STREAM_VENUES);
  }
  const venues = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => ORDERBOOK_STREAM_VENUE_ALIASES[value.toUpperCase().replace(/[\s-]/g, "_")])
    .filter((value): value is string => Boolean(value));
  return new Set(venues);
};

const buildConnectors = (logger: ReturnType<typeof createLogger>) => {
  const enabledVenues = parseOrderbookStreamVenues(process.env.ORDERBOOK_STREAM_VENUES);
  const connectors: VenueOrderbookStreamConnector[] = [];
  const addConnector = (venue: string, create: () => VenueOrderbookStreamConnector): void => {
    if (!enabledVenues.has(venue)) {
      return;
    }
    try {
      connectors.push(create());
    } catch (error) {
      logger.warn({ err: error, venue }, "Venue orderbook websocket connector disabled after startup initialization failure.");
    }
  };

  logger.info({ venues: Array.from(enabledVenues) }, "Orderbook stream venue ownership configured.");
  addConnector("POLYMARKET", () => createPolymarketOrderbookConnector({ logger }));
  addConnector("LIMITLESS", () => new LimitlessSdkOrderbookConnector({ logger }));

  const predictUrl = process.env.PREDICT_WS_MAINNET_URL?.trim() || DEFAULT_PREDICT_WS_MAINNET_URL;
  addConnector("PREDICT_FUN", () => new PredictWebSocketOrderbookConnector({
    url: predictUrl,
    environment: "mainnet",
    logger
  }));

  const opinionApiKey = process.env.OPINION_BUILDER_API_KEY?.trim() ||
    process.env.OPINION_BUILDER_SERVICE_API_KEY?.trim();
  const opinionWalletAddress = process.env.OPINION_STREAM_WALLET_ADDRESS?.trim() ||
    process.env.OPINION_BUILDER_WALLET_ADDRESS?.trim();
  if (!enabledVenues.has("OPINION")) {
    return connectors;
  }
  if (opinionApiKey && opinionWalletAddress) {
    addConnector("OPINION", () => new OpinionSdkOrderbookConnector({
      apiKey: opinionApiKey,
      walletAddress: opinionWalletAddress,
      ...(process.env.OPINION_WS_URL?.trim() ? { wsUrl: process.env.OPINION_WS_URL.trim() } : {}),
      logger
    }));
  } else {
    logger.warn(
      {
        opinionConnector: "disabled",
        missing: [
          ...(!opinionApiKey ? ["OPINION_BUILDER_API_KEY"] : []),
          ...(!opinionWalletAddress ? ["OPINION_STREAM_WALLET_ADDRESS"] : [])
        ]
      },
      "Opinion orderbook websocket connector disabled because public stream auth config is incomplete."
    );
  }

  return connectors;
};

const orderbookStreamPort = (env: NodeJS.ProcessEnv): number => {
  const raw = env.ORDERBOOK_STREAM_SERVICE_PORT ?? env.PORT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_ORDERBOOK_STREAM_PORT;
};

const registerSignals = (shutdown: () => Promise<void>): void => {
  const onSignal = async (): Promise<void> => {
    await shutdown();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void onSignal();
  });
  process.once("SIGTERM", () => {
    void onSignal();
  });
};

const isMainModule = (): boolean => {
  const entryPath = process.argv[1];
  const thisPath = fileURLToPath(import.meta.url);
  return Boolean(entryPath) && entryPath === thisPath;
};

if (isMainModule()) {
  runOrderbookStreamService().catch((error) => {
    const logger = createLogger("error");
    logger.error({ err: error }, "Orderbook stream service failed to start.");
    process.exit(1);
  });
}
