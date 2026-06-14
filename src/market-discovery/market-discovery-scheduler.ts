import type { Logger } from "pino";

import type { MarketDiscoveryService } from "./market-discovery-service.js";

export interface MarketDiscoverySchedulerEnv {
  [key: string]: string | undefined;
  LOTUS_DEPLOY_ENV?: string | undefined;
  LOTUS_ENV?: string | undefined;
  APP_ENV?: string | undefined;
  NODE_ENV?: string | undefined;
}

export interface MarketDiscoverySchedulerConfig {
  intervalMs?: number | undefined;
  runImmediately?: boolean | undefined;
  env?: MarketDiscoverySchedulerEnv | undefined;
}

export interface MarketDiscoverySchedulerHandle {
  stop: () => void;
}

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

const normalizeEnvValues = (env: MarketDiscoverySchedulerEnv): readonly string[] =>
  [env.LOTUS_DEPLOY_ENV, env.LOTUS_ENV, env.APP_ENV, env.NODE_ENV]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

export const isMarketDiscoverySchedulerEnabled = (env: MarketDiscoverySchedulerEnv = process.env): boolean => {
  const values = normalizeEnvValues(env);
  return values.includes("staging") || values.includes("preview");
};

export const startMarketDiscoveryScheduler = (
  service: Pick<MarketDiscoveryService, "runOnce">,
  logger: Logger,
  config: MarketDiscoverySchedulerConfig = {}
): MarketDiscoverySchedulerHandle | null => {
  const env = config.env ?? process.env;
  if (!isMarketDiscoverySchedulerEnabled(env)) {
    logger.info(
      {
        lotusDeployEnv: env.LOTUS_DEPLOY_ENV,
        lotusEnv: env.LOTUS_ENV,
        appEnv: env.APP_ENV,
        nodeEnv: env.NODE_ENV
      },
      "Market discovery scheduler disabled outside staging/preview."
    );
    return null;
  }

  const intervalMs = Math.max(60_000, Math.floor(config.intervalMs ?? DEFAULT_INTERVAL_MS));
  let running = false;
  let stopped = false;

  const run = async (reason: "startup" | "interval"): Promise<void> => {
    if (running || stopped) {
      if (running) {
        logger.warn({ reason }, "Market discovery scheduler skipped overlapping run.");
      }
      return;
    }
    running = true;
    try {
      const summary = await service.runOnce();
      logger.info(
        {
          reason,
          observedAt: summary.observedAt,
          candidateCount: summary.candidateCount,
          newDiscoveryCount: summary.newDiscoveryCount,
          ingestedCount: summary.ingestedCount,
          lowConfidenceCount: summary.lowConfidenceCount,
          persistedCount: summary.persistedCount,
          snapshotPersistedCount: summary.snapshotPersistedCount
        },
        "Market discovery scheduler refreshed review queue."
      );
    } catch (error) {
      logger.error({ err: error, reason }, "Market discovery scheduler run failed.");
    } finally {
      running = false;
    }
  };

  if (config.runImmediately === true) {
    void run("startup");
  }
  const timer = setInterval(() => {
    void run("interval");
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    }
  };
};
