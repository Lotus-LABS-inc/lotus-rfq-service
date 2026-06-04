import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import Fastify from "fastify";
import {
  QuoteSnapshotCache,
  SharedCoreVenueQuoteMappingResolver,
  type VenueQuoteSnapshotReader
} from "./core/sor/quote-snapshot.js";
import { createPgPool, closePgPool } from "./db/postgres.js";
import { connectRedis, createRedisClient, disconnectRedis } from "./db/redis.js";
import { LimitlessProfileFeeReader } from "./integrations/limitless/limitless-fee-reader.js";
import { LimitlessQuoteReader, LimitlessRestOrderbookClient } from "./integrations/limitless/limitless-quote-reader.js";
import {
  createOpinionOrderbookClient,
  resolveOpinionOrderbookApiKeys
} from "./integrations/opinion/opinion-orderbook-client.js";
import { OpinionQuoteReader } from "./integrations/opinion/opinion-quote-reader.js";
import { PolymarketClobFeeReader } from "./integrations/polymarket/polymarket-fee-reader.js";
import { PolymarketGammaClient } from "./integrations/polymarket/polymarket-gamma-client.js";
import { PolymarketQuoteReader, PolymarketRestOrderbookClient } from "./integrations/polymarket/polymarket-quote-reader.js";
import { PredictClient } from "./integrations/predict/predict-client.js";
import { PredictQuoteReader } from "./integrations/predict/predict-quote-reader.js";
import {
  LimitlessSdkOrderbookConnector,
  OpinionSdkOrderbookConnector,
  PredictWebSocketOrderbookConnector,
  createPolymarketOrderbookConnector
} from "./integrations/orderbook-stream-connectors.js";
import { VenueOrderbookSnapshotRepository } from "./repositories/venue-orderbook-snapshot.repository.js";
import { SharedCoreQuoteMappingRepository } from "./repositories/market-catalog.repository.js";
import { HotQuoteSnapshotService, resolveHotQuoteRedisNamespace } from "./services/hot-quote-snapshot.service.js";
import {
  RedisMarketOrderbookLiveCache,
  resolveMarketOrderbookLiveCacheNamespace
} from "./services/market-orderbook-live-cache.js";
import {
  OrderbookStreamService,
  type VenueOrderbookRestRefresher,
  type VenueOrderbookStreamConnector
} from "./services/orderbook-stream.service.js";
import { loadEnv } from "./utils/env.js";
import { createLogger } from "./utils/logger.js";

export interface OrderbookStreamRuntime {
  shutdown(): Promise<void>;
}

const DEFAULT_ORDERBOOK_STREAM_PORT = 3011;
const DEFAULT_PREDICT_WS_MAINNET_URL = "wss://ws.predict.fun/ws";
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

  const venueOrderbookSnapshotRepository = new VenueOrderbookSnapshotRepository(pgPool);
  const hotSnapshots = new HotQuoteSnapshotService({
    memoryCache: new QuoteSnapshotCache(),
    redis,
    dbFallback: venueOrderbookSnapshotRepository,
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
  const liveOrderbooks = new RedisMarketOrderbookLiveCache(redis, {
    namespace: resolveMarketOrderbookLiveCacheNamespace({
      LOTUS_DEPLOY_ENV: process.env.LOTUS_DEPLOY_ENV,
      LOTUS_ENV: process.env.LOTUS_ENV,
      APP_ENV: process.env.APP_ENV,
      NODE_ENV: process.env.NODE_ENV
    }),
    ttlMs: 30_000,
    maxSnapshotsPerTopic: 16
  });
  const streamService = new OrderbookStreamService({
    activeMarkets: hotSnapshots,
    hotSnapshots,
    liveOrderbooks,
    mappingResolver,
    connectors: buildConnectors(logger),
    restRefreshers: buildRestRefreshers(logger),
    latestSnapshots: venueOrderbookSnapshotRepository,
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

  const predictUrl = resolvePredictWebSocketUrl({
    configuredUrl: process.env.PREDICT_WS_MAINNET_URL,
    apiKey: process.env.PREDICT_API_KEY
  });
  addConnector("PREDICT_FUN", () => new PredictWebSocketOrderbookConnector({
    url: predictUrl,
    environment: "mainnet",
    logger
  }));

  const opinionAuth = resolveOpinionStreamAuth(process.env);
  if (!enabledVenues.has("OPINION")) {
    return connectors;
  }
  if (opinionAuth) {
    addConnector("OPINION", () => new OpinionSdkOrderbookConnector({
      apiKey: opinionAuth.apiKey,
      walletAddress: opinionAuth.walletAddress,
      ...(process.env.OPINION_WS_URL?.trim() ? { wsUrl: process.env.OPINION_WS_URL.trim() } : {}),
      logger
    }));
  } else {
    logger.warn(
      {
        opinionConnector: "disabled",
        missing: [
          ...(!resolveFirstEnvValue(process.env, OPINION_STREAM_API_KEY_ENV_NAMES) ? ["OPINION_BUILDER_API_KEY"] : []),
          ...(!resolveFirstEnvValue(process.env, OPINION_STREAM_WALLET_ENV_NAMES) ? ["OPINION_STREAM_WALLET_ADDRESS"] : [])
        ]
      },
      "Opinion orderbook websocket connector disabled because public stream auth config is incomplete."
    );
  }

  return connectors;
};

const buildRestRefreshers = (logger: ReturnType<typeof createLogger>): readonly VenueOrderbookRestRefresher[] => {
  const polymarketClobHost = process.env.POLYMARKET_CLOB_HOST ?? process.env.POLY_CLOB_HOST ?? "https://clob.polymarket.com";
  const polymarketGammaBaseUrl = process.env.POLYMARKET_GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com";
  const limitlessBaseUrl = process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange";
  const predictEnvironment = process.env.PREDICT_ENVIRONMENT === "testnet" ? "testnet" : "mainnet";
  const polymarketReader = new PolymarketQuoteReader({
    client: new PolymarketRestOrderbookClient({
      clobHost: polymarketClobHost
    }),
    streamCache: new QuoteSnapshotCache(),
    feeBps: parseOptionalNumber(process.env.POLYMARKET_QUOTE_FEE_BPS),
    feeReader: new PolymarketClobFeeReader({ clobHost: polymarketClobHost }),
    metadataClient: new PolymarketGammaClient({
      baseUrl: polymarketGammaBaseUrl,
      clobHost: polymarketClobHost
    })
  });
  const limitlessReader = new LimitlessQuoteReader({
    client: new LimitlessRestOrderbookClient({
      baseUrl: limitlessBaseUrl
    }),
    streamCache: new QuoteSnapshotCache(),
    feeBps: parseOptionalNumber(process.env.LIMITLESS_QUOTE_FEE_BPS),
    feeReader: new LimitlessProfileFeeReader({
      baseUrl: limitlessBaseUrl,
      apiKey: process.env.LIMITLESS_API_KEY,
      hmacTokenId: process.env.LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID ?? process.env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY,
      hmacSecret: process.env.LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET ?? process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET,
      account: process.env.LIMITLESS_QUOTE_FEE_PROFILE_ACCOUNT ?? process.env.LIMITLESS_WITHDRAWAL_ADAPTER_PROFILE_WALLET_ADDRESS
    })
  });
  const predictReader = new PredictQuoteReader({
    client: new PredictClient({
      environment: predictEnvironment,
      ...(process.env.PREDICT_MAINNET_BASE_URL ? { baseUrl: process.env.PREDICT_MAINNET_BASE_URL } : {}),
      ...(process.env.PREDICT_API_KEY ? { apiKey: process.env.PREDICT_API_KEY } : {}),
      logger
    }),
    streamCache: new QuoteSnapshotCache(),
    environment: predictEnvironment,
    feeBps: parseOptionalNumber(process.env.PREDICT_QUOTE_FEE_BPS)
  });
  const refreshers: VenueOrderbookRestRefresher[] = [
    toRestRefresher(polymarketReader),
    toRestRefresher(limitlessReader),
    toRestRefresher(predictReader)
  ];
  const opinionApiKeys = resolveOpinionOrderbookApiKeys(process.env);
  if (opinionApiKeys.length > 0) {
    const opinionReader = new OpinionQuoteReader({
      client: createOpinionOrderbookClient({
        baseUrl: process.env.OPINION_OPENAPI_BASE_URL ?? process.env.OPINION_CLOB_BASE_URL ?? "https://openapi.opinion.trade/openapi",
        apiKeys: opinionApiKeys,
        requestTimeoutMs: parseOptionalNumber(process.env.OPINION_QUOTE_TIMEOUT_MS) ?? 1_500,
        logger
      }),
      streamCache: new QuoteSnapshotCache(),
      topicRate: parseOptionalNumber(process.env.OPINION_QUOTE_TOPIC_RATE),
      feeBps: parseOptionalNumber(process.env.OPINION_QUOTE_FEE_BPS)
    });
    refreshers.push(toRestRefresher(opinionReader));
  } else {
    logger.warn(
      { venue: "OPINION", restRefresher: "disabled" },
      "Opinion orderbook REST refresher disabled because no Opinion API key is configured."
    );
  }
  return refreshers;
};

const toRestRefresher = (reader: VenueQuoteSnapshotReader): VenueOrderbookRestRefresher => ({
  venue: reader.venue,
  refresh: (target) => reader.getQuoteSnapshot({
    canonicalMarketId: target.canonicalMarketId,
    ...(target.canonicalOutcomeId ? { canonicalOutcomeId: target.canonicalOutcomeId } : {}),
    venueMarketId: target.venueMarketId,
    ...(target.venueOutcomeId ? { venueOutcomeId: target.venueOutcomeId } : {}),
    side: "buy",
    quantity: 1
  })
});

const OPINION_STREAM_API_KEY_ENV_NAMES = [
  "OPINION_BUILDER_API_KEY",
  "OPINION_BUILDER_SERVICE_API_KEY",
  "OPINION_BUILDER_API",
  "OPINION_API_KEY"
] as const;

const OPINION_STREAM_WALLET_ENV_NAMES = [
  "OPINION_STREAM_WALLET_ADDRESS",
  "OPINION_BUILDER_WALLET_ADDRESS",
  "OPINION_EOA"
] as const;

export const resolveOpinionStreamAuth = (
  env: NodeJS.ProcessEnv
): { apiKey: string; walletAddress: string } | null => {
  const apiKey = resolveFirstEnvValue(env, OPINION_STREAM_API_KEY_ENV_NAMES);
  const walletAddress = resolveFirstEnvValue(env, OPINION_STREAM_WALLET_ENV_NAMES);
  return apiKey && walletAddress ? { apiKey, walletAddress } : null;
};

export const resolvePredictWebSocketUrl = (input: {
  configuredUrl?: string | undefined;
  apiKey?: string | undefined;
}): string => {
  const rawUrl = input.configuredUrl?.trim() || DEFAULT_PREDICT_WS_MAINNET_URL;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    parsed = new URL(DEFAULT_PREDICT_WS_MAINNET_URL);
  }
  if (parsed.pathname === "/" || parsed.pathname.length === 0) {
    parsed.pathname = "/ws";
  }
  const apiKey = input.apiKey?.trim();
  if (apiKey && !parsed.searchParams.has("apiKey")) {
    parsed.searchParams.set("apiKey", apiKey);
  }
  return parsed.toString();
};

const resolveFirstEnvValue = (env: NodeJS.ProcessEnv, names: readonly string[]): string | null => {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
};

const orderbookStreamPort = (env: NodeJS.ProcessEnv): number => {
  const raw = env.ORDERBOOK_STREAM_SERVICE_PORT ?? env.PORT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_ORDERBOOK_STREAM_PORT;
};

const parseOptionalNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
