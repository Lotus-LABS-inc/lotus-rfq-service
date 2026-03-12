import type { Logger } from "pino";

import { replayDiffTotal, replayErrorTotal, replayExactMatchTotal } from "../../observability/metrics.js";
import {
  ReplayEnvelopeNotFoundError,
  type ControlPlaneAdminService,
  type ReplayEnvelopeMetadata,
} from "./control-plane-admin-service.js";
import type { IDiffReplayRunner } from "../../core/replay/diff-replay-runner.js";
import type { IExactReplayRunner } from "../../core/replay/exact-replay-runner.js";
import type { DiffReplayResult, ExactReplayResult } from "../../core/replay/replay.types.js";

export interface ReplayAdminServiceDeps {
  replayMetadataReader: Pick<ControlPlaneAdminService, "getReplayEnvelopeMetadata">;
  exactReplayRunner: IExactReplayRunner;
  diffReplayRunner: IDiffReplayRunner;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export interface RunExactReplayRequest {
  envelopeId: string;
  requestedBy: string;
}

export interface RunDiffReplayRequest {
  envelopeId: string;
  requestedBy: string;
  configVersion?: string;
  engineVersion?: string;
}

export class InvalidDiffReplayRequestError extends Error {
  public constructor() {
    super("At least one of configVersion or engineVersion must be provided.");
    this.name = "InvalidDiffReplayRequestError";
  }
}

export class ReplayAdminService {
  public constructor(private readonly deps: ReplayAdminServiceDeps) {}

  public async getReplayEnvelopeMetadata(envelopeId: string): Promise<ReplayEnvelopeMetadata> {
    return this.deps.replayMetadataReader.getReplayEnvelopeMetadata(envelopeId);
  }

  public async runExactReplay(input: RunExactReplayRequest): Promise<ExactReplayResult> {
    const metadata = await this.getReplayEnvelopeMetadata(input.envelopeId);

    this.deps.logger.info(
      {
        action: "replay_exact_run_started",
        requestedBy: input.requestedBy,
        envelopeId: input.envelopeId,
        decisionType: metadata.decisionType,
      },
      "Started exact replay."
    );

    try {
      const result = await this.deps.exactReplayRunner.run(input.envelopeId);
      this.recordReplayMetric(metadata.decisionType, result.status);
      this.logReplayResult(
        {
          action: "replay_exact_run_completed",
          requestedBy: input.requestedBy,
          envelopeId: input.envelopeId,
          decisionType: metadata.decisionType,
          status: result.status,
        },
        result.status
      );
      return result;
    } catch (error) {
      replayErrorTotal.labels(metadata.decisionType).inc();
      this.deps.logger.error(
        {
          err: error,
          action: "replay_exact_run_failed",
          requestedBy: input.requestedBy,
          envelopeId: input.envelopeId,
          decisionType: metadata.decisionType,
        },
        "Exact replay failed."
      );
      throw error;
    }
  }

  public async runDiffReplay(input: RunDiffReplayRequest): Promise<DiffReplayResult> {
    if (!input.configVersion && !input.engineVersion) {
      throw new InvalidDiffReplayRequestError();
    }

    const metadata = await this.getReplayEnvelopeMetadata(input.envelopeId);

    this.deps.logger.info(
      {
        action: "replay_diff_run_started",
        requestedBy: input.requestedBy,
        envelopeId: input.envelopeId,
        decisionType: metadata.decisionType,
        configVersion: input.configVersion,
        engineVersion: input.engineVersion,
      },
      "Started diff replay."
    );

    try {
      const result = await this.deps.diffReplayRunner.run(input.envelopeId, {
        ...(input.configVersion ? { configVersion: input.configVersion } : {}),
        ...(input.engineVersion ? { engineVersion: input.engineVersion } : {}),
      });
      this.recordReplayMetric(metadata.decisionType, result.status);
      this.logReplayResult(
        {
          action: "replay_diff_run_completed",
          requestedBy: input.requestedBy,
          envelopeId: input.envelopeId,
          decisionType: metadata.decisionType,
          configVersion: input.configVersion,
          engineVersion: input.engineVersion,
          status: result.status,
        },
        result.status
      );
      return result;
    } catch (error) {
      replayErrorTotal.labels(metadata.decisionType).inc();
      this.deps.logger.error(
        {
          err: error,
          action: "replay_diff_run_failed",
          requestedBy: input.requestedBy,
          envelopeId: input.envelopeId,
          decisionType: metadata.decisionType,
          configVersion: input.configVersion,
          engineVersion: input.engineVersion,
        },
        "Diff replay failed."
      );
      throw error;
    }
  }

  private logReplayResult(payload: Record<string, unknown>, status: "MATCH" | "DIFF" | "ERROR"): void {
    if (status === "DIFF") {
      this.deps.logger.warn(payload, "Replay completed with diff.");
      return;
    }

    if (status === "ERROR") {
      this.deps.logger.error(payload, "Replay completed with error.");
      return;
    }

    this.deps.logger.info(payload, "Replay completed successfully.");
  }

  private recordReplayMetric(decisionType: string, status: "MATCH" | "DIFF" | "ERROR"): void {
    if (status === "MATCH") {
      replayExactMatchTotal.labels(decisionType).inc();
      return;
    }

    if (status === "DIFF") {
      replayDiffTotal.labels(decisionType).inc();
      return;
    }

    replayErrorTotal.labels(decisionType).inc();
  }
}

export { ReplayEnvelopeNotFoundError };
