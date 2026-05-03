export interface FundingReadinessWatcherRepository {
  listFundingIntentsForReadinessWatch(input: {
    limit: number;
    staleAfterSeconds: number;
  }): Promise<Array<{ fundingIntentId: string; userId: string }>>;
}

export interface FundingReadinessWatcherFundingService {
  refreshIntentStatus(userId: string, fundingIntentId: string): Promise<unknown>;
}

export interface FundingReadinessWatcherLogger {
  info(input: Record<string, unknown>, message: string): void;
  warn(input: Record<string, unknown>, message: string): void;
  error(input: Record<string, unknown>, message: string): void;
}

export interface FundingReadinessWatcherConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  staleAfterSeconds: number;
}

export interface FundingReadinessWatcherRunResult {
  scanned: number;
  refreshed: number;
  failed: number;
}

export const buildFundingReadinessWatcherConfigFromEnv = (
  env: NodeJS.ProcessEnv
): FundingReadinessWatcherConfig => ({
  enabled: env.FUNDING_READINESS_WATCHER_ENABLED === "true",
  intervalMs: parseBoundedInteger(env.FUNDING_READINESS_WATCHER_INTERVAL_MS, 60_000, 5_000, 3_600_000),
  batchSize: parseBoundedInteger(env.FUNDING_READINESS_WATCHER_BATCH_SIZE, 25, 1, 200),
  staleAfterSeconds: parseBoundedInteger(env.FUNDING_READINESS_WATCHER_STALE_AFTER_SECONDS, 30, 0, 86_400)
});

export class FundingReadinessWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(
    private readonly repository: FundingReadinessWatcherRepository,
    private readonly fundingService: FundingReadinessWatcherFundingService,
    private readonly logger: FundingReadinessWatcherLogger,
    private readonly config: FundingReadinessWatcherConfig
  ) {}

  public start(): void {
    if (!this.config.enabled || this.timer) {
      return;
    }
    this.logger.info({
      intervalMs: this.config.intervalMs,
      batchSize: this.config.batchSize,
      staleAfterSeconds: this.config.staleAfterSeconds
    }, "Funding readiness watcher started.");
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
    this.logger.info({}, "Funding readiness watcher stopped.");
  }

  public async runOnce(): Promise<FundingReadinessWatcherRunResult> {
    if (!this.config.enabled) {
      return { scanned: 0, refreshed: 0, failed: 0 };
    }
    if (this.running) {
      this.logger.warn({}, "Funding readiness watcher tick skipped because the previous tick is still running.");
      return { scanned: 0, refreshed: 0, failed: 0 };
    }
    this.running = true;
    let scanned = 0;
    let refreshed = 0;
    let failed = 0;
    try {
      const candidates = await this.repository.listFundingIntentsForReadinessWatch({
        limit: this.config.batchSize,
        staleAfterSeconds: this.config.staleAfterSeconds
      });
      scanned = candidates.length;
      for (const candidate of candidates) {
        try {
          await this.fundingService.refreshIntentStatus(candidate.userId, candidate.fundingIntentId);
          refreshed += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn({
            fundingIntentId: candidate.fundingIntentId,
            errorName: error instanceof Error ? error.name : "UnknownError"
          }, "Funding readiness watcher failed to refresh intent.");
        }
      }
      if (scanned > 0) {
        this.logger.info({ scanned, refreshed, failed }, "Funding readiness watcher tick completed.");
      }
      return { scanned, refreshed, failed };
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError"
      }, "Funding readiness watcher tick failed.");
      return { scanned, refreshed, failed: failed + 1 };
    } finally {
      this.running = false;
    }
  }
}

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
