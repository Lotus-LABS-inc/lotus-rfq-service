import { createHash } from "node:crypto";
import type { VerifiedExecutionPosition, VerifiedPositionRepository } from "./executable-routing.js";
import type {
  LiveSubmitReadinessSnapshot,
  SignedTradeBundleService,
  SignedTradeExecutionStatus,
  SignedTradeExecutionStatusRepository
} from "./signed-trade-bundle.js";

export interface ActiveSignedTradeExecutionStatusRepository extends SignedTradeExecutionStatusRepository {
  listActiveExecutionStatuses(input: {
    limit: number;
    activeWindowSeconds: number;
  }): Promise<SignedTradeExecutionStatus[]>;
}

export interface ExecutionUpdatePublisher {
  publishExecutionStatus(status: SignedTradeExecutionStatus): Promise<void>;
  publishPositions(input: {
    userId: string;
    marketId: string;
    outcomeId: string;
    positions: VerifiedExecutionPosition[];
  }): Promise<void>;
  publishReadiness?(readiness: LiveSubmitReadinessSnapshot, userId: string): Promise<void>;
  publishPortfolio?(input: {
    userId: string;
    marketId: string;
    outcomeId: string;
    positions: VerifiedExecutionPosition[];
  }): Promise<void>;
}

export interface ExecutionStatusWatcherLogger {
  info(input: Record<string, unknown>, message: string): void;
  warn(input: Record<string, unknown>, message: string): void;
  error(input: Record<string, unknown>, message: string): void;
}

export interface ExecutionStatusWatcherConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  activeWindowSeconds: number;
  settlementIntervalMs: number;
}

export interface ExecutionStatusWatcherRunResult {
  scanned: number;
  refreshed: number;
  failed: number;
}

export const buildExecutionStatusWatcherConfigFromEnv = (
  env: NodeJS.ProcessEnv
): ExecutionStatusWatcherConfig => ({
  enabled: env.EXECUTION_STATUS_WATCHER_ENABLED !== "false",
  intervalMs: parseBoundedInteger(env.EXECUTION_STATUS_WATCHER_INTERVAL_MS, 1_000, 1_000, 60_000),
  batchSize: parseBoundedInteger(env.EXECUTION_STATUS_WATCHER_BATCH_SIZE, 50, 1, 250),
  activeWindowSeconds: parseBoundedInteger(env.EXECUTION_STATUS_WATCHER_ACTIVE_WINDOW_SECONDS, 900, 60, 86_400),
  settlementIntervalMs: parseBoundedInteger(env.EXECUTION_STATUS_WATCHER_SETTLEMENT_INTERVAL_MS, 5_000, 1_000, 300_000)
});

export class ExecutionStatusWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(
    private readonly repository: ActiveSignedTradeExecutionStatusRepository,
    private readonly signedTradeBundleService: SignedTradeBundleService,
    private readonly positionRepository: VerifiedPositionRepository,
    private readonly publisher: ExecutionUpdatePublisher,
    private readonly logger: ExecutionStatusWatcherLogger,
    private readonly config: ExecutionStatusWatcherConfig
  ) {}

  public start(): void {
    if (!this.config.enabled || this.timer) {
      return;
    }
    this.logger.info({
      intervalMs: this.config.intervalMs,
      batchSize: this.config.batchSize,
      activeWindowSeconds: this.config.activeWindowSeconds
    }, "Execution status watcher started.");
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.intervalMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.logger.info({}, "Execution status watcher stopped.");
  }

  public async runOnce(): Promise<ExecutionStatusWatcherRunResult> {
    if (!this.config.enabled) {
      return { scanned: 0, refreshed: 0, failed: 0 };
    }
    if (this.running) {
      this.logger.warn({}, "Execution status watcher tick skipped because the previous tick is still running.");
      return { scanned: 0, refreshed: 0, failed: 0 };
    }
    this.running = true;
    let scanned = 0;
    let refreshed = 0;
    let failed = 0;
    try {
      const statuses = await this.repository.listActiveExecutionStatuses({
        limit: this.config.batchSize,
        activeWindowSeconds: this.config.activeWindowSeconds
      });
      scanned = statuses.length;
      for (const status of statuses) {
        try {
          await this.refreshStatus(status);
          refreshed += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn({
            executionId: status.executionId,
            errorName: error instanceof Error ? error.name : "UnknownError"
          }, "Execution status watcher failed to refresh execution.");
        }
      }
      if (scanned > 0) {
        this.logger.info({ scanned, refreshed, failed }, "Execution status watcher tick completed.");
      }
      return { scanned, refreshed, failed };
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError"
      }, "Execution status watcher tick failed.");
      return { scanned, refreshed, failed: failed + 1 };
    } finally {
      this.running = false;
    }
  }

  private async refreshStatus(status: SignedTradeExecutionStatus): Promise<void> {
    if (status.dryRun || status.status === "FAILED") {
      return;
    }
    const next = await this.signedTradeBundleService.refreshStoredExecutionStatus(status, {
      settlementIntervalMs: this.config.settlementIntervalMs
    });
    await this.repository.saveExecutionStatus(next);
    await this.signedTradeBundleService.recordFilledPositionsForStatus(next);
    await this.publisher.publishExecutionStatus(next);

    if (next.route) {
      const positions = await this.positionRepository.listVerifiedPositions({
        userId: next.userId,
        marketId: next.route.marketId,
        outcomeId: next.route.outcomeId
      });
      await this.publisher.publishPositions({
        userId: next.userId,
        marketId: next.route.marketId,
        outcomeId: next.route.outcomeId,
        positions
      });
      await this.publisher.publishPortfolio?.({
        userId: next.userId,
        marketId: next.route.marketId,
        outcomeId: next.route.outcomeId,
        positions
      });
      if (this.publisher.publishReadiness) {
        try {
          const readiness = await this.signedTradeBundleService.getLiveReadiness({
            userId: next.userId,
            quoteId: next.executionId
          });
          await this.publisher.publishReadiness(readiness, next.userId);
        } catch {
          // Live readiness is quote-expiry sensitive; status/position updates must still publish.
        }
      }
    }
  }
}

export const executionUserTopic = (userId: string): string => `execution:user:${safeTopicPart(userId)}`;
export const executionQuoteTopic = (executionId: string): string => `execution:quote:${safeTopicPart(executionId)}`;
export const executionPortfolioTopic = (userId: string): string => `execution:portfolio:${safeTopicPart(userId)}`;
export const notificationUserTopic = (userId: string): string => `notifications:user:${safeTopicPart(userId)}`;
export const executionPositionsTopic = (userId: string, marketId: string, outcomeId: string): string =>
  `execution:positions:${safeTopicPart(userId)}:${topicHash(marketId)}:${topicHash(outcomeId)}`;

const topicHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 24);

const safeTopicPart = (value: string): string => value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128);

const parseBoundedInteger = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
};
