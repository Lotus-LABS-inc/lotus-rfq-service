export interface FundingIntentCleanupInput {
  batchSize: number;
  deleteUnusedFundingAfterSeconds: number;
  cancelUnsubmittedFundingAfterSeconds: number;
  deleteUnusedWithdrawalAfterSeconds: number;
  cancelUnsubmittedWithdrawalAfterSeconds: number;
  reason: string;
}

export interface FundingIntentCleanupResult {
  deletedUnusedFundingIntents: number;
  cancelledUnsubmittedFundingIntents: number;
  deletedUnusedWithdrawalIntents: number;
  cancelledUnsubmittedWithdrawalIntents: number;
}

export interface FundingIntentCleanupRepository {
  cleanupStaleIntents(input: FundingIntentCleanupInput): Promise<FundingIntentCleanupResult>;
}

export interface FundingIntentCleanupLogger {
  info(input: Record<string, unknown>, message: string): void;
  warn(input: Record<string, unknown>, message: string): void;
  error(input: Record<string, unknown>, message: string): void;
}

export interface FundingIntentCleanupConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  deleteUnusedFundingAfterSeconds: number;
  cancelUnsubmittedFundingAfterSeconds: number;
  deleteUnusedWithdrawalAfterSeconds: number;
  cancelUnsubmittedWithdrawalAfterSeconds: number;
}

export const buildFundingIntentCleanupConfigFromEnv = (
  env: NodeJS.ProcessEnv
): FundingIntentCleanupConfig => ({
  enabled: env.FUNDING_INTENT_CLEANUP_ENABLED === "true",
  intervalMs: parseBoundedInteger(env.FUNDING_INTENT_CLEANUP_INTERVAL_MS, 300_000, 30_000, 86_400_000),
  batchSize: parseBoundedInteger(env.FUNDING_INTENT_CLEANUP_BATCH_SIZE, 100, 1, 1_000),
  deleteUnusedFundingAfterSeconds: parseBoundedInteger(env.FUNDING_UNUSED_INTENT_DELETE_AFTER_SECONDS, 1_800, 60, 604_800),
  cancelUnsubmittedFundingAfterSeconds: parseBoundedInteger(env.FUNDING_UNSUBMITTED_INTENT_CANCEL_AFTER_SECONDS, 7_200, 300, 604_800),
  deleteUnusedWithdrawalAfterSeconds: parseBoundedInteger(env.WITHDRAWAL_UNUSED_INTENT_DELETE_AFTER_SECONDS, 1_800, 60, 604_800),
  cancelUnsubmittedWithdrawalAfterSeconds: parseBoundedInteger(env.WITHDRAWAL_UNSUBMITTED_INTENT_CANCEL_AFTER_SECONDS, 7_200, 300, 604_800)
});

export class FundingIntentCleanupWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(
    private readonly repository: FundingIntentCleanupRepository,
    private readonly logger: FundingIntentCleanupLogger,
    private readonly config: FundingIntentCleanupConfig
  ) {}

  public start(): void {
    if (!this.config.enabled || this.timer) {
      return;
    }
    this.logger.info({
      intervalMs: this.config.intervalMs,
      batchSize: this.config.batchSize,
      deleteUnusedFundingAfterSeconds: this.config.deleteUnusedFundingAfterSeconds,
      cancelUnsubmittedFundingAfterSeconds: this.config.cancelUnsubmittedFundingAfterSeconds,
      deleteUnusedWithdrawalAfterSeconds: this.config.deleteUnusedWithdrawalAfterSeconds,
      cancelUnsubmittedWithdrawalAfterSeconds: this.config.cancelUnsubmittedWithdrawalAfterSeconds
    }, "Funding intent cleanup watcher started.");
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
    this.logger.info({}, "Funding intent cleanup watcher stopped.");
  }

  public async runOnce(): Promise<FundingIntentCleanupResult> {
    const empty = emptyResult();
    if (!this.config.enabled) {
      return empty;
    }
    if (this.running) {
      this.logger.warn({}, "Funding intent cleanup tick skipped because the previous tick is still running.");
      return empty;
    }
    this.running = true;
    try {
      const result = await this.repository.cleanupStaleIntents({
        batchSize: this.config.batchSize,
        deleteUnusedFundingAfterSeconds: this.config.deleteUnusedFundingAfterSeconds,
        cancelUnsubmittedFundingAfterSeconds: this.config.cancelUnsubmittedFundingAfterSeconds,
        deleteUnusedWithdrawalAfterSeconds: this.config.deleteUnusedWithdrawalAfterSeconds,
        cancelUnsubmittedWithdrawalAfterSeconds: this.config.cancelUnsubmittedWithdrawalAfterSeconds,
        reason: "Automatic cleanup removed stale unused or unsubmitted funding state."
      });
      if (Object.values(result).some((count) => count > 0)) {
        this.logger.info({ ...result }, "Funding intent cleanup tick completed.");
      }
      return result;
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError"
      }, "Funding intent cleanup tick failed.");
      return empty;
    } finally {
      this.running = false;
    }
  }
}

const emptyResult = (): FundingIntentCleanupResult => ({
  deletedUnusedFundingIntents: 0,
  cancelledUnsubmittedFundingIntents: 0,
  deletedUnusedWithdrawalIntents: 0,
  cancelledUnsubmittedWithdrawalIntents: 0
});

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
